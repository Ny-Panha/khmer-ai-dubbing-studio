#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Demucs CPU Inference Optimization & Quality Benchmark Suite
Automates STEP 0, STEP 1, and STEP 2 benchmarking across variants:
- Baseline: worker as-is (shifts=1, overlap=0.5, segment=4, jobs=1)
- Variant (a): --shifts 0
- Variant (b): --shifts 0 --overlap 0.25
- Variant (c): --shifts 0 --overlap 0.25 --segment 7
- Variant (d): --shifts 0 --overlap 0.25 --segment 7 -j 2
- Fallback (e) if needed: --shifts 0 --overlap 0.35 --segment 7
"""

import sys
import os
import time
import json
import subprocess
import numpy as np
import soundfile as sf

if sys.platform.startswith("win"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, "../.."))
PYTHON_EXE = sys.executable
WORKER_SCRIPT = os.path.join(PROJECT_ROOT, "backend/workers/demucs_worker.py")
EXCERPT_PATH = os.path.join(PROJECT_ROOT, "backend/uploads/temp/benchmarks/benchmark_3min.wav")
BENCH_DIR = os.path.join(PROJECT_ROOT, "backend/uploads/temp/benchmarks")


def evaluate_audio_quality(orig_path, base_voc_path, base_nv_path, cand_nv_path, window_start=150.0, window_dur=30.0):
    """
    Evaluates Step 2 Quality Gate over a 30s dialogue-dense window (150s-180s in excerpt = 14 lines).
    Focuses on frames where Chinese speech is genuinely active (guided by baseline vocals.wav).
    """
    try:
        orig, sr = sf.read(orig_path)
        voc, _ = sf.read(base_voc_path)
        base_nv, _ = sf.read(base_nv_path)
        cand_nv, _ = sf.read(cand_nv_path)

        s_idx = int(window_start * sr)
        e_idx = int((window_start + window_dur) * sr)

        def to_mono(arr):
            arr_w = arr[s_idx:e_idx]
            return np.mean(arr_w, axis=1) if len(arr_w.shape) > 1 else arr_w

        orig_m = to_mono(orig)
        voc_m = to_mono(voc)
        base_m = to_mono(base_nv)
        cand_m = to_mono(cand_nv)

        n_fft = 2048
        hop = 512
        freqs = np.fft.rfftfreq(n_fft, 1.0 / sr)
        speech_band = (freqs >= 300) & (freqs <= 3400)
        win = np.hanning(n_fft)

        orig_speech_frames = []
        voc_speech_frames = []
        base_speech_frames = []
        cand_speech_frames = []

        # Collect frame energies in speech band
        for i in range(0, len(orig_m) - n_fft, hop):
            v_frame = voc_m[i:i + n_fft] * win
            v_rms = np.sqrt(np.mean(v_frame ** 2))
            if v_rms < 0.015:
                continue  # Ignore silence / non-speech frames for vocal leakage test

            o_mag = np.abs(np.fft.rfft(orig_m[i:i + n_fft] * win))[speech_band]
            v_mag = np.abs(np.fft.rfft(v_frame))[speech_band]
            b_mag = np.abs(np.fft.rfft(base_m[i:i + n_fft] * win))[speech_band]
            c_mag = np.abs(np.fft.rfft(cand_m[i:i + n_fft] * win))[speech_band]

            orig_speech_frames.append(np.sqrt(np.mean(o_mag ** 2)))
            voc_speech_frames.append(np.sqrt(np.mean(v_mag ** 2)))
            base_speech_frames.append(np.sqrt(np.mean(b_mag ** 2)))
            cand_speech_frames.append(np.sqrt(np.mean(c_mag ** 2)))

        orig_e = float(np.mean(orig_speech_frames)) if orig_speech_frames else 1e-6
        base_e = float(np.mean(base_speech_frames)) if base_speech_frames else 1e-6
        cand_e = float(np.mean(cand_speech_frames)) if cand_speech_frames else 1e-6

        base_att_db = 20.0 * np.log10(max(1e-6, base_e) / max(1e-6, orig_e))
        cand_att_db = 20.0 * np.log10(max(1e-6, cand_e) / max(1e-6, orig_e))

        # Check worst 10% loudest residual speech frames (peak leakage spikes)
        base_p90 = float(np.percentile(base_speech_frames, 90)) if base_speech_frames else 1e-6
        cand_p90 = float(np.percentile(cand_speech_frames, 90)) if cand_speech_frames else 1e-6
        p90_delta_db = 20.0 * np.log10(max(1e-6, cand_p90) / max(1e-6, base_p90))

        # Full-window waveform correlation with baseline no_vocals.wav
        corr = float(np.corrcoef(cand_m, base_m)[0, 1])

        # Divergence RMS in dB
        diff_rms = float(np.sqrt(np.mean((cand_m - base_m) ** 2)))
        base_rms = float(np.sqrt(np.mean(base_m ** 2)))
        snr_vs_base_db = 20.0 * np.log10(max(1e-6, base_rms) / max(1e-6, diff_rms))

        # Step 2 Pass Criteria:
        # Mean speech-band attenuation within 1.0 dB of baseline AND peak leakage delta <= 1.2 dB
        gate_passed = (cand_att_db <= (base_att_db + 1.0)) and (p90_delta_db <= 1.2)

        return {
            "windowStart": window_start,
            "windowDuration": window_dur,
            "activeSpeechFrames": len(orig_speech_frames),
            "baselineVocalAttDb": round(base_att_db, 2),
            "candidateVocalAttDb": round(cand_att_db, 2),
            "deltaMeanAttDb": round(cand_att_db - base_att_db, 2),
            "p90SpikeDeltaDb": round(p90_delta_db, 2),
            "snrVsBaseDb": round(snr_vs_base_db, 2),
            "correlationWithBase": round(corr, 4),
            "gatePassed": bool(gate_passed),
        }
    except Exception as e:
        return {
            "error": str(e),
            "gatePassed": False,
        }


def run_benchmark_variant(name, out_dir, extra_args=None):
    print(f"\n=======================================================", flush=True)
    print(f"🚀 Running: {name}", flush=True)
    print(f"Args: {extra_args or '[worker defaults]'}", flush=True)
    print(f"=======================================================", flush=True)

    os.makedirs(out_dir, exist_ok=True)
    t0 = time.time()

    cmd = [
        PYTHON_EXE, WORKER_SCRIPT,
        "--audio", EXCERPT_PATH,
        "--output_dir", out_dir,
        "--model", "htdemucs",
        "--device", "cpu",
        "--suppress_residuals"
    ]
    if extra_args:
        cmd.extend(extra_args)

    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8")
    stdout, stderr = p.communicate()
    wall_time = round(time.time() - t0, 2)

    if p.returncode != 0:
        print(f"❌ Failed ({name}): exit code {p.returncode}", flush=True)
        print(f"Stderr: {stderr[-500:]}", flush=True)
        return None

    res = {}
    for line in stdout.strip().split("\n"):
        line = line.strip()
        if line.startswith("{") and line.endswith("}"):
            try:
                res = json.loads(line)
                break
            except Exception:
                pass

    res["name"] = name
    res["wallTimeSec"] = wall_time
    demucs_t = res.get("demucsDurationSec", 0)
    sup_t = res.get("suppressionDurationSec", 0)
    sup_share = round((sup_t / max(0.01, res.get("processingTimeSec", wall_time))) * 100, 2)
    res["suppressSharePct"] = sup_share

    print(f"✅ Completed {name}: Wall={wall_time}s | Demucs={demucs_t}s | Suppress={sup_t}s ({sup_share}%)", flush=True)
    return res


def main():
    all_results = {}
    summary_path = os.path.join(BENCH_DIR, "benchmark_summary.json")

    def save_progress():
        with open(summary_path, "w", encoding="utf-8") as f:
            json.dump(all_results, f, indent=2, ensure_ascii=False)

    # 1. Baseline (worker as-is)
    baseline_out = os.path.join(BENCH_DIR, "run_baseline")
    base_nv = os.path.join(baseline_out, "no_vocals.wav")
    base_voc = os.path.join(baseline_out, "vocals.wav")
    if os.path.exists(base_nv) and os.path.exists(os.path.join(baseline_out, "meta.json")):
        print("Using cached Baseline...", flush=True)
        with open(os.path.join(baseline_out, "meta.json"), "r", encoding="utf-8") as mf:
            all_results["Baseline"] = json.load(mf)
    else:
        base_res = run_benchmark_variant("Baseline (shifts=1, overlap=0.5, segment=4, j=1)", baseline_out, [])
        if base_res:
            with open(os.path.join(baseline_out, "meta.json"), "w", encoding="utf-8") as mf:
                json.dump(base_res, mf, indent=2)
            all_results["Baseline"] = base_res
            save_progress()

    # Variants (a), (b), (c), (d)
    variants = [
        ("a_shifts_0", "Variant (a) [--shifts 0]", os.path.join(BENCH_DIR, "run_a"), ["--shifts", "0"]),
        ("b_overlap_025", "Variant (b) [--shifts 0 --overlap 0.25]", os.path.join(BENCH_DIR, "run_b"), ["--shifts", "0", "--overlap", "0.25"]),
        ("c_segment_7", "Variant (c) [(b) + --segment 7]", os.path.join(BENCH_DIR, "run_c"), ["--shifts", "0", "--overlap", "0.25", "--segment", "7"]),
        ("d_jobs_2", "Variant (d) [(c) + -j 2]", os.path.join(BENCH_DIR, "run_d"), ["--shifts", "0", "--overlap", "0.25", "--segment", "7", "-j", "2"]),
    ]

    for key, label, out_dir, extra_args in variants:
        res = run_benchmark_variant(label, out_dir, extra_args)
        if res and os.path.exists(base_nv) and os.path.exists(base_voc):
            cand_nv = os.path.join(out_dir, "no_vocals.wav")
            gate = evaluate_audio_quality(EXCERPT_PATH, base_voc, base_nv, cand_nv, window_start=150.0, window_dur=30.0)
            res["qualityGate"] = gate
            print(f"📊 Step 2 Quality Gate [{key}]: {gate}", flush=True)
        all_results[key] = res
        save_progress()

    # Check if fastest candidate (c or d) passed Step 2 gate; if overlap=0.25 failed, test fallback overlap=0.35
    c_passed = all_results.get("c_segment_7", {}).get("qualityGate", {}).get("gatePassed", False)
    d_passed = all_results.get("d_jobs_2", {}).get("qualityGate", {}).get("gatePassed", False)
    if not (c_passed or d_passed):
        print("\n⚠️ Variant (c)/(d) with overlap 0.25 did NOT pass Step 2 Quality Gate! Testing overlap 0.35 fallback...", flush=True)
        fb_variants = [
            ("fb_overlap_035_j1", "Fallback [--shifts 0 --overlap 0.35 --segment 7 -j 1]", os.path.join(BENCH_DIR, "run_fb_j1"), ["--shifts", "0", "--overlap", "0.35", "--segment", "7", "-j", "1"]),
            ("fb_overlap_035_j2", "Fallback [--shifts 0 --overlap 0.35 --segment 7 -j 2]", os.path.join(BENCH_DIR, "run_fb_j2"), ["--shifts", "0", "--overlap", "0.35", "--segment", "7", "-j", "2"]),
        ]
        for key, label, out_dir, extra_args in fb_variants:
            res = run_benchmark_variant(label, out_dir, extra_args)
            if res and os.path.exists(base_nv) and os.path.exists(base_voc):
                cand_nv = os.path.join(out_dir, "no_vocals.wav")
                gate = evaluate_audio_quality(EXCERPT_PATH, base_voc, base_nv, cand_nv, window_start=150.0, window_dur=30.0)
                res["qualityGate"] = gate
                print(f"📊 Step 2 Quality Gate [{key}]: {gate}", flush=True)
            all_results[key] = res
            save_progress()

    print(f"\n🎉 All benchmarks complete! Results saved to {summary_path}", flush=True)


if __name__ == "__main__":
    main()
