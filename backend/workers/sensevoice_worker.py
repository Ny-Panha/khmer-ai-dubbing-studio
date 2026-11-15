#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DragonDub AI - SenseVoice-Small Local ASR Worker
Features:
- FunASR SenseVoiceSmall (Chinese verbatim speech transcription)
- FSMN-VAD (Sentence-level timestamp boundary detection)
- CAM++ (Speaker diarization & clustering)
- YIN Acoustic Pitch & Gender Classifier (F0 estimation: male/female classification)
- Resilient fallback to local Sherpa-ONNX if FunASR is unavailable
"""

import sys
import os
import argparse
import json
import re
import math
import time
import subprocess
import tempfile
import traceback
import contextlib
import numpy as np
import soundfile as sf

# Force UTF-8 encoding on Windows to prevent console charset corruption
if sys.platform.startswith("win"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass


def parse_args():
    parser = argparse.ArgumentParser(description="DragonDub SenseVoice-Small Local ASR Worker")
    parser.add_argument("--audio", default="", help="Path to input audio or video file")
    parser.add_argument("--model_dir", default="", help="Optional model cache directory")
    parser.add_argument("--device", default="cpu", help="Inference device: cpu (default)")
    parser.add_argument("--start_offset", type=float, default=0.0, help="Timeline offset in seconds")
    parser.add_argument("--output_json", default="", help="Optional path to write output JSON")
    parser.add_argument("--threads", type=int, default=8, help="CPU thread count (default 8)")
    parser.add_argument("--prepare", action="store_true", help="Download and cache models then exit")
    args = parser.parse_args()
    if not args.prepare and not args.audio:
        parser.error("the following arguments are required: --audio")
    return args


def ensure_wav_16k_mono(audio_path):
    """
    Ensures input audio is 16kHz mono WAV format using FFmpeg if needed.
    Returns (audio_samples: np.ndarray, sample_rate: int, temp_file_path: str|None)
    """
    try:
        info = sf.info(audio_path)
        if info.samplerate == 16000 and info.channels == 1 and info.format.upper() == "WAV":
            audio, sr = sf.read(audio_path, dtype="float32")
            return audio, sr, None
    except Exception:
        pass

    temp_wav = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    temp_wav_path = temp_wav.name
    temp_wav.close()

    cmd = [
        "ffmpeg", "-y", "-i", audio_path,
        "-threads", "1",
        "-vn", "-ar", "16000", "-ac", "1",
        "-c:a", "pcm_s16le", temp_wav_path
    ]
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
    audio, sr = sf.read(temp_wav_path, dtype="float32")
    return audio, sr, temp_wav_path


def compute_yin_pitch(samples, sample_rate=16000, threshold=0.15):
    """
    YIN Fundamental Frequency (F0) Estimation on 16kHz audio samples.
    Identical acoustic boundaries to DragonDub audioClassifierService.js:
    - Male: 85 Hz to 155 Hz (typical ~120 Hz)
    - Female: 170 Hz to 280 Hz (typical ~215 Hz)
    - Ambiguous: 155 Hz to 170 Hz
    """
    if len(samples) < 1024:
        return 0.0, 0.0, "unknown"

    # Cap: analyse only the middle min(2.0s, segment length) slice
    max_samples = int(2.0 * sample_rate)
    if len(samples) > max_samples:
        mid = len(samples) // 2
        half = max_samples // 2
        samples = samples[mid - half:mid - half + max_samples]

    min_freq = 80
    max_freq = 340
    min_lag = int(sample_rate / max_freq)  # ~47
    max_lag = int(sample_rate / min_freq)  # ~200
    window_size = 1024
    hop_size = 1024  # Capped for speed (prev 512)
    num_frames = (len(samples) - window_size - max_lag) // hop_size

    if num_frames <= 0:
        return 0.0, 0.0, "unknown"

    f0_list = []

    for f in range(num_frames):
        offset = f * hop_size
        frame = samples[offset:offset + window_size]
        rms = np.sqrt(np.mean(frame ** 2))
        if rms < 0.02:
            continue  # Silence / pause frame

        # Step 1: Difference function d(tau)
        d = np.zeros(max_lag + 1, dtype=np.float32)
        for tau in range(max_lag + 1):
            diff = frame - samples[offset + tau:offset + tau + window_size]
            d[tau] = np.sum(diff ** 2)

        # Step 2: Cumulative mean normalized difference d'(tau)
        d_prime = np.ones(max_lag + 1, dtype=np.float32)
        running_sum = 0.0
        for tau in range(1, max_lag + 1):
            running_sum += d[tau]
            d_prime[tau] = (d[tau] * tau) / running_sum if running_sum > 0 else 1.0

        # Step 3: Absolute threshold
        best_tau = -1
        for tau in range(min_lag, max_lag + 1):
            if d_prime[tau] < threshold:
                while tau + 1 <= max_lag and d_prime[tau + 1] < d_prime[tau]:
                    tau += 1
                best_tau = tau
                break

        if best_tau == -1:
            local_min = np.argmin(d_prime[min_lag:max_lag + 1]) + min_lag
            if d_prime[local_min] <= 0.40:
                best_tau = local_min

        if best_tau > 0:
            pitch = sample_rate / best_tau
            if min_freq <= pitch <= max_freq:
                f0_list.append(pitch)

    if not f0_list:
        return 0.0, 0.0, "unknown"

    median_f0 = float(np.median(f0_list))
    confidence = float(len(f0_list) / max(1, num_frames))

    gender = "unknown"
    if median_f0 >= 175 and confidence >= 0.45:
        gender = "female"
    elif 0 < median_f0 <= 150 and confidence >= 0.45:
        gender = "male"
    elif median_f0 > 165:
        gender = "female"
    elif median_f0 < 155 and median_f0 > 0:
        gender = "male"

    return round(median_f0, 2), round(min(1.0, confidence), 2), gender


def clean_sensevoice_text(text):
    """
    Strips SenseVoice emotion & event tags (e.g. <|HAPPY|>, <|BGM|>, <|Speech|>, <|zh|>)
    leaving verbatim spoken Chinese text.
    """
    if not text:
        return ""
    cleaned = re.sub(r"<\|.*?\|>", "", str(text))
    return cleaned.strip()


def handle_prepare(args):
    """
    --prepare mode: ONLY downloads + loads the models and exits.
    Download progress visible (does not suppress modelscope logger).
    Logs "[SenseVoice Worker] models ready" at the end.
    """
    sys.stderr.write(f"[SenseVoice Worker] Preparing models (SenseVoiceSmall + FSMN-VAD + CAM++), threads={args.threads}...\n")
    sys.stderr.flush()

    import torch
    torch.set_num_threads(args.threads)

    t0 = time.time()
    from funasr import AutoModel
    # Note: Do not suppress modelscope/funasr loggers so download progress is visible
    model = AutoModel(
        model="iic/SenseVoiceSmall",
        vad_model="fsmn-vad",
        spk_model="cam++",
        disable_update=True,
        hub="ms",
        device=args.device,
    )
    t1 = time.time()
    sys.stderr.write(f"[SenseVoice Worker] Model load done in {t1 - t0:.2f}s\n")
    sys.stderr.write("[SenseVoice Worker] models ready\n")
    sys.stderr.flush()
    sys.exit(0)


def run_funasr_pipeline(audio_path, start_offset=0.0, threads=8):
    """
    Executes FunASR SenseVoiceSmall + FSMN-VAD + CAM++ diarization pipeline.
    """
    import torch
    torch.set_num_threads(threads)

    t_total_start = time.time()

    with contextlib.redirect_stdout(sys.stderr):
        from funasr import AutoModel

        # Suppress verbose modelscope and funasr logs during normal run
        import logging
        logging.getLogger("modelscope").setLevel(logging.ERROR)
        logging.getLogger("funasr").setLevel(logging.ERROR)

        t_load_start = time.time()
        sys.stderr.write(f"[SenseVoice Worker] Model load start (threads={threads})...\n")
        sys.stderr.flush()

        model = AutoModel(
            model="iic/SenseVoiceSmall",
            vad_model="fsmn-vad",
            spk_model="cam++",
            disable_update=True,
            hub="ms",
            device="cpu",
        )
        t_load_done = time.time()
        sys.stderr.write(f"[SenseVoice Worker] Model load done ({t_load_done - t_load_start:.2f}s)\n")
        sys.stderr.flush()

        t_gen_start = time.time()
        sys.stderr.write("[SenseVoice Worker] Generate start (batch_size_s=60)...\n")
        sys.stderr.flush()

        res = model.generate(
            input=audio_path,
            batch_size_s=60,
            hotword="",
            merge_vad=True,
            merge_thr=0.8,
        )
        t_gen_done = time.time()
        sys.stderr.write(f"[SenseVoice Worker] Generate done ({t_gen_done - t_gen_start:.2f}s)\n")
        sys.stderr.flush()

    if not res or len(res) == 0:
        return []

    raw_items = res[0]
    segments_raw = raw_items.get("sentence_info", []) if isinstance(raw_items, dict) else []

    # Fallback to top-level text if sentence_info is empty
    if not segments_raw and isinstance(raw_items, dict):
        text = clean_sensevoice_text(raw_items.get("text", ""))
        if text:
            segments_raw = [{
                "text": text,
                "start": 0,
                "end": int(raw_items.get("timestamp", [[0, 2000]])[-1][-1] if raw_items.get("timestamp") else 2000),
                "spk": 0
            }]

    t_pitch_start = time.time()
    total_raw = len(segments_raw)
    sys.stderr.write(f"[SenseVoice Worker] Pitch stage start ({total_raw} raw segments)...\n")
    sys.stderr.flush()

    audio_samples, sr, _ = ensure_wav_16k_mono(audio_path)
    final_segments = []

    for idx, item in enumerate(segments_raw):
        raw_text = item.get("text", "")
        clean_text = clean_sensevoice_text(raw_text)
        if not clean_text or not re.search(r"[\u4e00-\u9fa5]", clean_text):
            continue

        start_sec = round(float(item.get("start", 0)) / 1000.0, 2)
        end_sec = round(float(item.get("end", 0)) / 1000.0, 2)
        duration = round(max(0.4, end_sec - start_sec), 2)

        global_start = round(start_offset + start_sec, 2)
        global_end = round(global_start + duration, 2)

        spk_val = item.get("spk", None)
        if spk_val is not None:
            spk_id = f"spk_{int(spk_val) + 1}"
        else:
            spk_id = f"spk_{(idx % 2) + 1}"

        # Segment-level pitch & gender classification via YIN
        s_idx = int(start_sec * sr)
        e_idx = min(len(audio_samples), int(end_sec * sr))
        f0 = 0.0
        pitch_conf = 0.0
        gender = "unknown"
        if e_idx > s_idx + 1024:
            f0, pitch_conf, gender = compute_yin_pitch(audio_samples[s_idx:e_idx], sr)

        norm_gender = gender if gender in ["male", "female"] else "unknown"
        if not spk_id.endswith(f"_{norm_gender}") and norm_gender != "unknown":
            spk_id = f"{spk_id}_{norm_gender}"

        final_segments.append({
            "startSec": global_start,
            "endSec": global_end,
            "duration": duration,
            "sourceStartSec": global_start,
            "sourceEndSec": global_end,
            "spokenChineseText": clean_text,
            "speakerId": spk_id,
            "audioGender": norm_gender,
            "pitchHz": f0 if f0 > 0 else None,
            "acousticF0": f0 if f0 > 0 else None,
            "acousticGender": norm_gender if norm_gender != "unknown" else None,
            "acousticConfidence": pitch_conf,
            "audioConfidence": 0.95,
            "source": "sense_voice_local",
            "evidenceSource": "audio_asr",
        })

        if (idx + 1) % 10 == 0 or (idx + 1) == total_raw:
            sys.stderr.write(f"[SenseVoice Worker] Pitch analysis progress: {idx + 1}/{total_raw} segments\n")
            sys.stderr.flush()

    t_pitch_done = time.time()
    sys.stderr.write(f"[SenseVoice Worker] Pitch stage done ({t_pitch_done - t_pitch_start:.2f}s, {len(final_segments)} valid Chinese segments)\n")
    sys.stderr.flush()

    t_total_done = time.time()
    sys.stderr.write(f"[SenseVoice Worker] Total funasr time: {t_total_done - t_total_start:.2f}s (load: {t_load_done - t_load_start:.2f}s, generate: {t_gen_done - t_gen_start:.2f}s, pitch: {t_pitch_done - t_pitch_start:.2f}s)\n")
    sys.stderr.flush()

    return final_segments


def run_sherpa_onnx_fallback(audio_path, model_dir="", start_offset=0.0, threads=8):
    """
    Offline Sherpa-ONNX fallback if FunASR is unavailable.
    Uses pre-downloaded ONNX models in backend/models/sense-voice.
    """
    import sherpa_onnx

    base_dir = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        model_dir,
        os.path.join(base_dir, "..", "models", "sense-voice"),
        os.path.join(base_dir, "models", "sense-voice"),
        os.path.abspath("backend/models/sense-voice"),
    ]
    resolved_dir = None
    for c in candidates:
        if c and os.path.isdir(c) and os.path.isfile(os.path.join(c, "tokens.txt")):
            resolved_dir = os.path.abspath(c)
            break

    if not resolved_dir:
        raise FileNotFoundError(f"Sherpa-ONNX SenseVoice model not found in candidates: {candidates}")

    model_file = os.path.join(resolved_dir, "model.int8.onnx")
    if not os.path.isfile(model_file):
        model_file = os.path.join(resolved_dir, "model.onnx")
    tokens_file = os.path.join(resolved_dir, "tokens.txt")
    vad_file = os.path.join(resolved_dir, "silero_vad.onnx")

    sys.stderr.write(f"[SenseVoice Worker] Falling back to Sherpa-ONNX model at {resolved_dir} (threads={threads})...\n")
    sys.stderr.flush()

    recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
        model=model_file,
        tokens=tokens_file,
        num_threads=threads,
        language="auto",
        use_itn=True,
    )

    silero_config = sherpa_onnx.SileroVadModelConfig(
        model=vad_file,
        threshold=0.5,
        min_silence_duration=0.45,
        min_speech_duration=0.25,
        window_size=512,
        max_speech_duration=6.5,
    )
    vad_config = sherpa_onnx.VadModelConfig(silero_vad=silero_config, sample_rate=16000, num_threads=max(1, threads // 4))
    vad = sherpa_onnx.VoiceActivityDetector(vad_config, buffer_size_in_seconds=60)

    audio_samples, sr, _ = ensure_wav_16k_mono(audio_path)

    raw_segments = []
    window_size = 512

    def drain_vad():
        while not vad.empty():
            seg = vad.front
            if len(seg.samples) > 0:
                start_rel = round(seg.start / sr, 2)
                end_rel = round((seg.start + len(seg.samples)) / sr, 2)
                dur = round(end_rel - start_rel, 2)
                if dur >= 0.2:
                    stream = recognizer.create_stream()
                    stream.accept_waveform(sr, np.array(seg.samples, dtype=np.float32))
                    recognizer.decode_stream(stream)
                    raw_txt = stream.result.text or ""
                    clean_txt = clean_sensevoice_text(raw_txt)
                    if clean_txt and re.search(r"[\u4e00-\u9fa5]", clean_txt):
                        raw_segments.append((start_rel, end_rel, dur, clean_txt, seg.samples))
            vad.pop()

    for i in range(0, len(audio_samples), window_size):
        chunk = audio_samples[i:i + window_size]
        if len(chunk) < window_size:
            break
        vad.accept_waveform(chunk)
        drain_vad()

    vad.flush()
    drain_vad()

    final_segments = []
    curr_speaker_num = 1
    for idx, (s_rel, e_rel, dur, text, samples) in enumerate(raw_segments):
        global_start = round(start_offset + s_rel, 2)
        global_end = round(global_start + dur, 2)

        if idx > 0 and (s_rel - raw_segments[idx - 1][1] >= 1.5):
            curr_speaker_num = 2 if curr_speaker_num == 1 else 1

        f0, pitch_conf, gender = compute_yin_pitch(np.array(samples, dtype=np.float32), sr)
        norm_gender = gender if gender in ["male", "female"] else "unknown"
        spk_id = f"spk_{curr_speaker_num}"
        if norm_gender != "unknown":
            spk_id = f"{spk_id}_{norm_gender}"

        final_segments.append({
            "startSec": global_start,
            "endSec": global_end,
            "duration": dur,
            "sourceStartSec": global_start,
            "sourceEndSec": global_end,
            "spokenChineseText": text,
            "speakerId": spk_id,
            "audioGender": norm_gender,
            "pitchHz": f0 if f0 > 0 else None,
            "acousticF0": f0 if f0 > 0 else None,
            "acousticGender": norm_gender if norm_gender != "unknown" else None,
            "acousticConfidence": pitch_conf,
            "audioConfidence": 0.95,
            "source": "sense_voice_local",
            "evidenceSource": "audio_asr",
        })

    return final_segments


def main():
    args = parse_args()

    if args.prepare:
        handle_prepare(args)
        return

    temp_wav_path = None
    t_main_start = time.time()

    try:
        if not os.path.isfile(args.audio):
            raise FileNotFoundError(f"Input audio file not found: {args.audio}")

        # Ensure audio file is 16kHz mono WAV for fast processing
        _, _, temp_wav_path = ensure_wav_16k_mono(args.audio)
        effective_audio = temp_wav_path if temp_wav_path else args.audio

        speech_segments = []
        engine_used = "funasr-sensevoice"

        # 1. Primary: FunASR (SenseVoiceSmall + FSMN-VAD + CAM++)
        try:
            speech_segments = run_funasr_pipeline(
                effective_audio,
                start_offset=args.start_offset,
                threads=args.threads
            )
        except Exception as funasr_err:
            sys.stderr.write(f"[SenseVoice Worker] FunASR pipeline failed ({funasr_err}). Attempting Sherpa-ONNX fallback...\n")
            sys.stderr.flush()
            # 2. Resilient Secondary Fallback: Sherpa-ONNX
            try:
                speech_segments = run_sherpa_onnx_fallback(
                    effective_audio,
                    model_dir=args.model_dir,
                    start_offset=args.start_offset,
                    threads=args.threads
                )
                engine_used = "sherpa-onnx-sensevoice"
            except Exception as onnx_err:
                raise RuntimeError(f"Both FunASR and Sherpa-ONNX failed. FunASR: {funasr_err}; ONNX: {onnx_err}")

        result = {
            "status": "success",
            "engine": engine_used,
            "totalSegments": len(speech_segments),
            "speechSegments": speech_segments,
        }

        output_json = json.dumps(result, ensure_ascii=False)

        if args.output_json:
            with open(args.output_json, "w", encoding="utf-8") as f:
                f.write(output_json)

        t_main_total = time.time() - t_main_start
        sys.stderr.write(f"[SenseVoice Worker] Total execution time: {t_main_total:.2f}s\n")
        sys.stderr.flush()

        print(output_json)
        sys.exit(0)

    except Exception as e:
        sys.stderr.write(f"[SenseVoice Worker Error] {traceback.format_exc()}\n")
        sys.stderr.flush()
        err_res = {
            "status": "error",
            "message": str(e),
            "speechSegments": [],
        }
        print(json.dumps(err_res, ensure_ascii=False))
        sys.exit(1)

    finally:
        if temp_wav_path and os.path.isfile(temp_wav_path):
            try:
                os.remove(temp_wav_path)
            except Exception:
                pass


if __name__ == "__main__":
    main()
