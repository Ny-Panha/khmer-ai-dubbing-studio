#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DragonDub AI - Local SenseVoice ASR Worker (Sherpa-ONNX)
Provides high-speed, 100% free Chinese Speech-to-Text with VAD & Timestamps.
"""

import sys
import os
import argparse
import json
import re
import subprocess
import tempfile
import sherpa_onnx  # type: ignore
import soundfile as sf
import numpy as np

# Force UTF-8 on Windows
if sys.platform.startswith("win"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass


def parse_args():
    parser = argparse.ArgumentParser(description="SenseVoice-Small Speech-to-Text Worker")
    parser.add_argument("--audio", required=True, help="Path to input audio file")
    parser.add_argument("--model_dir", default="", help="Path to model directory")
    parser.add_argument("--start_offset", type=float, default=0.0, help="Start offset in seconds")
    parser.add_argument("--language", default="auto", help="Language code (auto, zh, yue, en)")
    parser.add_argument("--threshold", type=float, default=0.5, help="VAD speech threshold")
    parser.add_argument("--min_silence", type=float, default=0.45, help="VAD min silence duration in seconds")
    parser.add_argument("--min_speech", type=float, default=0.25, help="VAD min speech duration in seconds")
    parser.add_argument("--max_speech", type=float, default=6.5, help="VAD max single segment duration in seconds")
    return parser.parse_args()


def resolve_model_dir(provided_dir):
    if provided_dir and os.path.isdir(provided_dir):
        return provided_dir

    # Default relative paths
    base_dir = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.join(base_dir, "..", "models", "sense-voice"),
        os.path.join(base_dir, "models", "sense-voice"),
        os.path.abspath("backend/models/sense-voice"),
        os.path.abspath("models/sense-voice"),
    ]
    for c in candidates:
        if os.path.isdir(c) and os.path.isfile(os.path.join(c, "tokens.txt")):
            return os.path.abspath(c)

    raise FileNotFoundError(f"SenseVoice model directory not found. Searched: {candidates}")


def ensure_wav_16k_mono(audio_path):
    """
    Ensures audio is 16kHz mono WAV format using FFmpeg if needed.
    """
    try:
        info = sf.info(audio_path)
        if info.samplerate == 16000 and info.channels == 1 and info.format.upper() == "WAV":
            audio, sr = sf.read(audio_path, dtype="float32")
            return audio, sr, None
    except Exception:
        pass

    # Convert using FFmpeg
    temp_wav = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    temp_wav_path = temp_wav.name
    temp_wav.close()

    cmd = [
        "ffmpeg", "-y", "-i", audio_path,
        "-vn", "-ar", "16000", "-ac", "1",
        "-c:a", "pcm_s16le", temp_wav_path
    ]
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
    audio, sr = sf.read(temp_wav_path, dtype="float32")
    return audio, sr, temp_wav_path


def parse_emotion_and_text(raw_text):
    """
    Extracts emotion tags (<|HAPPY|>, <|SAD|>, <|ANGRY|>, <|NEUTRAL|>)
    and preserves event tags (<|Speech|>, <|BGM|>, <|Singing|>, <|Laughter|>, etc.)
    without discarding acoustic event context.
    """
    emotion = "neutral"
    m = re.search(r"<\|(HAPPY|SAD|ANGRY|NEUTRAL)\|>", raw_text, re.IGNORECASE)
    if m:
        emotion = m.group(1).lower()

    # Extract all acoustic/environmental event tags
    events = re.findall(
        r"<\|(Speech|BGM|Applause|Laughter|Cry|Sneeze|Breath|Cough|Singing|Music)\|>",
        raw_text,
        re.IGNORECASE
    )
    events_lower = [e.lower() for e in events]
    has_speech = any(e in ["speech", "laughter", "cry"] for e in events_lower)
    has_bgm = any(e in ["bgm", "music", "singing"] for e in events_lower)
    is_singing = any(e in ["singing"] for e in events_lower)
    is_pure_bgm = has_bgm and not has_speech

    # Remove all <|...|> tags for clean dialogue text
    clean = re.sub(r"<\|.*?\|>", "", raw_text)
    clean = clean.strip()
    return clean, emotion, events_lower, is_pure_bgm, has_speech, is_singing


def main():
    args = parse_args()
    temp_cleanup = None

    try:
        model_dir = resolve_model_dir(args.model_dir)
        model_file = os.path.join(model_dir, "model.int8.onnx")
        if not os.path.isfile(model_file):
            model_file = os.path.join(model_dir, "model.onnx")

        tokens_file = os.path.join(model_dir, "tokens.txt")
        silero_vad_file = os.path.join(model_dir, "silero_vad.onnx")

        if not os.path.isfile(model_file):
            raise FileNotFoundError(f"Model weights not found in {model_dir}")
        if not os.path.isfile(tokens_file):
            raise FileNotFoundError(f"Tokens file not found in {model_dir}")
        if not os.path.isfile(silero_vad_file):
            raise FileNotFoundError(f"Silero VAD model not found in {model_dir}")

        # 1. Initialize Recognizer
        recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
            model=model_file,
            tokens=tokens_file,
            num_threads=4,
            language=args.language,
            use_itn=True,
        )

        # 2. Initialize VAD
        silero_config = sherpa_onnx.SileroVadModelConfig(
            model=silero_vad_file,
            threshold=args.threshold,
            min_silence_duration=args.min_silence,
            min_speech_duration=args.min_speech,
            window_size=512,
            max_speech_duration=args.max_speech,
        )
        vad_config = sherpa_onnx.VadModelConfig(
            silero_vad=silero_config,
            sample_rate=16000,
            num_threads=2,
        )
        vad = sherpa_onnx.VoiceActivityDetector(vad_config, buffer_size_in_seconds=60)

        # 3. Load Audio
        audio, sample_rate, temp_cleanup = ensure_wav_16k_mono(args.audio)

        # 4. Feed audio into VAD and extract speech segments
        segments = []
        window_size = 512

        def process_vad_segments():
            while not vad.empty():
                seg = vad.front
                if len(seg.samples) > 0:
                    start_rel = round(seg.start / sample_rate, 2)
                    end_rel = round((seg.start + len(seg.samples)) / sample_rate, 2)
                    duration = round(end_rel - start_rel, 2)

                    if duration >= 0.2:
                        stream = recognizer.create_stream()
                        stream.accept_waveform(sample_rate, np.array(seg.samples, dtype=np.float32))
                        recognizer.decode_stream(stream)
                        raw_result = stream.result.text or ""
                        clean_text, emotion, events, is_pure_bgm, has_speech, is_singing = parse_emotion_and_text(raw_result)

                        # Filter out non-speech / empty outputs
                        if clean_text and re.search(r"[\u4e00-\u9fa5a-zA-Z0-9]", clean_text):
                            global_start = round(args.start_offset + start_rel, 2)
                            global_end = round(global_start + duration, 2)
                            segments.append({
                                "startSec": global_start,
                                "endSec": global_end,
                                "duration": duration,
                                "sourceStartSec": global_start,
                                "sourceEndSec": global_end,
                                "spokenChineseText": clean_text,
                                "rawSenseVoiceText": raw_result,
                                "emotion": emotion,
                                "audioEvents": events,
                                "isBgm": bool(events and "bgm" in events),
                                "isPureBgm": is_pure_bgm,
                                "isSinging": is_singing,
                                "hasSpeechEvent": has_speech,
                                "audioGender": "unknown",
                                "speakerId": "spk_1",
                                "audioConfidence": 0.98,
                                "source": "sense_voice_local",
                                "evidenceSource": "audio_asr",
                            })
                vad.pop()

        for i in range(0, len(audio), window_size):
            chunk = audio[i:i + window_size]
            if len(chunk) < window_size:
                break
            vad.accept_waveform(chunk)
            process_vad_segments()

        vad.flush()
        process_vad_segments()

        # Simple speaker alternation heuristic if dialogue turns have clear gap
        current_speaker_idx = 1
        for idx in range(len(segments)):
            if idx > 0:
                prev = segments[idx - 1]
                curr = segments[idx]
                gap = curr["startSec"] - prev["endSec"]
                if gap >= 1.5:
                    current_speaker_idx = 2 if current_speaker_idx == 1 else 1
            segments[idx]["speakerId"] = f"spk_{current_speaker_idx}"

        result = {
            "status": "success",
            "engine": "sense-voice-small-onnx",
            "totalSegments": len(segments),
            "speechSegments": segments,
        }
        print(json.dumps(result, ensure_ascii=False))

    except Exception as e:
        err_res = {
            "status": "error",
            "message": str(e),
            "speechSegments": [],
        }
        print(json.dumps(err_res, ensure_ascii=False))
        sys.exit(1)

    finally:
        if temp_cleanup and os.path.isfile(temp_cleanup):
            try:
                os.remove(temp_cleanup)
            except Exception:
                pass


if __name__ == "__main__":
    main()

