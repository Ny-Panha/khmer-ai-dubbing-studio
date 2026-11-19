#!/usr/bin/env python3
"""
dub_pipeline.py — Standalone Chinese audio -> Khmer dubbing script pipeline.

Flow: audio/video file -> Gemini (hardened prompt) -> JSON parse + repair ->
schema-safe normalize -> regex sanitizer -> export JSON + SRT (Khmer).

Usage:
    pip install google-genai
    set GEMINI_API_KEY=your_key            (Windows: setx GEMINI_API_KEY "...")
    python dub_pipeline.py episode01.mp4 --glossary glossary.txt --out out/
    python dub_pipeline.py series/PseudoSpiritualRoot

Multiple keys (rotation on 429/503): set GEMINI_API_KEYS=key1,key2,key3
Requires: ffmpeg + ffprobe on PATH (for video input / long-file chunking).
"""

import argparse
import json
import math
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

# ----------------------------------------------------------------------------
# Config
# ----------------------------------------------------------------------------
MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash-lite")
CHUNK_SECONDS = 600          # split audio longer than this into chunks
AUDIO_EXTS = {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"}
MEDIA_EXTS = AUDIO_EXTS | {".mp4", ".mkv", ".mov", ".webm", ".avi"}
SPEAKER_CLASSES = {"grandpa", "grandma", "man", "woman", "boy", "girl"}

GEMINI_PROMPT = """You are a professional Chinese-to-Khmer dubbing translator. Listen to the audio and return every spoken sentence.
Output ONLY a valid JSON array of objects. No markdown fences, no commentary, no text outside the array.
For every subtitle entry, emit fields in this order: "start", "end", "chinese", "english", "khmer", "speaker", "speakerName".
SERIES GLOSSARY (follow exactly in every clip; never invent a different spelling or transliteration for a listed name/term):
{GLOSSARY}
1. "chinese": transcribe the exact Simplified Chinese dialogue.
2. First translate the Chinese into natural, concise English in "english". Romanize every Chinese name and proper noun in standard Hanyu Pinyin, not by literal meaning (for example Lin Feng for the name written with the characters Lin + Feng). Keep Pinyin spelling consistent and follow the SERIES GLOSSARY.
3. Generate "khmer" from that English bridge, not by translating the Chinese independently. Translate Asian honorifics/titles into natural Khmer equivalents, for example Gege -> បងប្រុស, Shixiong -> សិស្សច្បង, and Laoban -> ថៅកែ. Transliterate Pinyin names phonetically into clean Khmer script, exactly as listed in the SERIES GLOSSARY.
4. "khmer" must use Khmer Unicode U+1780-U+17FF, spaces, and punctuation only. Strictly forbid Thai characters U+0E00-U+0E7F and Chinese characters U+4E00-U+9FFF in this field, as well as Latin letters, pinyin, numerals, Lao, Burmese, or romanized Khmer. Write numbers as Khmer words.
5. Keep Khmer short enough for the line duration: maxKhmerWords = ceil((end-start)*2.5), minimum 2, maximum 14. If a line is over budget, compress filler words first - never drop degree words (rule 8).
6. "start"/"end": exact elapsed seconds from 0.0s at the START OF THIS AUDIO CLIP. Do not guess timestamps or drift forward during background music, action sound effects, or pauses. Every timestamp must strictly be within this audio clip and end must be greater than start.
7. One spoken sentence = one entry. Never merge two sentences or two speakers into one entry. If a speech span is longer than about 6 seconds, split it at natural sentence boundaries into multiple entries with their own timestamps. Do not invent dialogue; skip music and sound effects.
8. Meaning fidelity: (a) never drop degree/quantity words - a little/slightly must stay បន្តិច/ល្មមៗ, very must stay ខ្លាំង/ណាស់, more must stay ជាង/ទៀត; (b) if dropping the subject would change WHO does the action, name the subject explicitly in Khmer; (c) Chinese rhetorical questions become natural Khmer questions with ONE question marker only - never stack two question markers in one line.
9. "speaker": exactly one of grandpa, grandma, man, woman, boy, girl (judge by pitch and tone of the SPEAKER, never by who is being spoken to). "speakerName": the character's Pinyin name if identifiable from context or the glossary, otherwise "unknown" - keep the same name for the same character across all entries.
Before answering, verify the fields are in the specified order, the output is a pure JSON array, and every "khmer" value contains no Thai or Chinese characters and only Khmer script, spaces, and punctuation.
"""

# ----------------------------------------------------------------------------
# Sanitizer (defense-in-depth, mirrors the Studio's sanitizeKhmerDialogue)
# ----------------------------------------------------------------------------
_FORBIDDEN = re.compile(r"[\u0E00-\u0E7F\u4E00-\u9FFF]")
_SPACES = re.compile(r"\s+")


def sanitize_khmer(text: str) -> str:
    cleaned = _FORBIDDEN.sub("", text or "")
    return _SPACES.sub(" ", cleaned).strip()


# ----------------------------------------------------------------------------
# Media helpers (ffmpeg / ffprobe)
# ----------------------------------------------------------------------------
def probe_duration(path: Path) -> float:
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "json", str(path)],
            capture_output=True, text=True, timeout=60,
        )
        return float(json.loads(out.stdout)["format"]["duration"])
    except Exception:
        return 0.0


def extract_audio(src: Path, dst: Path) -> None:
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-i", str(src),
         "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", str(dst)],
        check=True, timeout=1800,
    )


def cut_chunk(src: Path, dst: Path, start: float, length: float) -> None:
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-ss", f"{start:.2f}", "-t", f"{length:.2f}",
         "-i", str(src), "-ac", "1", "-ar", "16000", "-b:a", "64k", str(dst)],
        check=True, timeout=1800,
    )


# ----------------------------------------------------------------------------
# Gemini call with key rotation
# ----------------------------------------------------------------------------
def load_dotenv() -> None:
    env_file = Path(__file__).with_name(".env")
    if not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"'))


def load_keys() -> list:
    load_dotenv()
    raw = os.environ.get("GEMINI_API_KEYS") or os.environ.get("GEMINI_API_KEY") or ""
    keys = [k.strip() for k in raw.split(",") if k.strip()]
    if not keys:
        sys.exit("ERROR: set GEMINI_API_KEY (or GEMINI_API_KEYS=key1,key2) first.")
    return keys


def call_gemini(audio_path: Path, prompt: str, keys: list) -> str:
    from google import genai
    from google.genai import types

    last_err = None
    for idx, key in enumerate(keys):
        try:
            client = genai.Client(api_key=key)
            uploaded = client.files.upload(file=str(audio_path))
            # Wait until the file is ACTIVE (audio is usually instant).
            for _ in range(60):
                state = getattr(uploaded.state, "name", str(uploaded.state))
                if state == "ACTIVE":
                    break
                if state == "FAILED":
                    raise RuntimeError("Gemini file processing FAILED")
                time.sleep(2)
                uploaded = client.files.get(name=uploaded.name)
            resp = client.models.generate_content(
                model=MODEL,
                contents=[uploaded, prompt],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    temperature=0.25,
                ),
            )
            return resp.text or ""
        except Exception as e:  # rotate on quota / busy, else bubble up
            last_err = e
            msg = str(e)
            if any(code in msg for code in ("429", "503", "RESOURCE_EXHAUSTED", "UNAVAILABLE")):
                print(f"  key #{idx + 1}: busy/quota ({msg[:80]}...) -> rotating")
                time.sleep(3)
                continue
            raise
    raise RuntimeError(f"All {len(keys)} keys failed. Last error: {last_err}")


# ----------------------------------------------------------------------------
# Parse + repair + normalize
# ----------------------------------------------------------------------------
def parse_response(raw: str, debug_path: Path) -> list:
    text = (raw or "").strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("["), text.rfind("]")
        if start == -1 or end <= start:
            debug_path.write_text(raw or "", encoding="utf-8")
            raise ValueError(f"Response is not JSON. Raw saved to {debug_path}")
        data = json.loads(text[start:end + 1])
    if isinstance(data, dict):  # tolerate {"segments": [...]} style wrappers
        for v in data.values():
            if isinstance(v, list):
                data = v
                break
    if not isinstance(data, list):
        debug_path.write_text(raw or "", encoding="utf-8")
        raise ValueError(f"Response JSON is not an array. Raw saved to {debug_path}")
    return data


def normalize(items: list, offset: float, clip_duration: float) -> tuple:
    entries, warnings = [], []
    for i, item in enumerate(items):
        if not isinstance(item, dict):
            continue
        try:
            start = float(item.get("start", 0)) + offset
            end = float(item.get("end", 0)) + offset
        except (TypeError, ValueError):
            warnings.append(f"entry {i}: bad timestamps, skipped")
            continue
        if end <= start:
            warnings.append(f"entry {i}: end <= start, skipped")
            continue
        khmer = sanitize_khmer(str(item.get("khmer", "")))
        speaker = str(item.get("speaker", "man")).strip().lower()
        if speaker not in SPEAKER_CLASSES:
            warnings.append(f"entry {i}: speaker '{speaker}' not in class set -> 'man'")
            speaker = "man"
        entry = {
            "start": round(start, 2),
            "end": round(end, 2),
            "chinese": str(item.get("chinese", "")).strip(),
            "english": str(item.get("english", "")).strip(),
            "khmer": khmer,
            "speaker": speaker,
            "speakerName": str(item.get("speakerName", "unknown")).strip() or "unknown",
        }
        dur = end - start
        budget = min(14, max(2, math.ceil(dur * 2.5)))
        if len(khmer.split()) > budget:
            warnings.append(
                f"entry {i} @{start:.2f}s: khmer {len(khmer.split())} words > budget {budget}"
            )
        entries.append(entry)
    entries.sort(key=lambda e: e["start"])
    return entries, warnings


# ----------------------------------------------------------------------------
# Export
# ----------------------------------------------------------------------------
def srt_time(sec: float) -> str:
    ms = int(round(sec * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def export(entries: list, base: Path) -> None:
    base.with_suffix(".json").write_text(
        json.dumps(entries, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    lines = []
    for n, e in enumerate(entries, 1):
        lines.append(
            f"{n}\n{srt_time(e['start'])} --> {srt_time(e['end'])}\n{e['khmer']}\n"
        )
    base.with_suffix(".srt").write_text("\n".join(lines), encoding="utf-8")


# ----------------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------------
def process_one(src: Path, prompt: str, keys: list, out_dir: Path) -> None:
    base = out_dir / src.stem
    duration = probe_duration(src)
    print(f"input: {src.name}  duration: {duration:.1f}s  model: {MODEL}  keys: {len(keys)}")

    all_entries, all_warnings = [], []
    with tempfile.TemporaryDirectory() as td:
        td = Path(td)
        audio = src
        if src.suffix.lower() not in AUDIO_EXTS or duration > CHUNK_SECONDS:
            audio = td / "audio.mp3"
            print("extracting audio (mono 16k)...")
            extract_audio(src, audio)
            if duration <= 0:
                duration = probe_duration(audio)

        if duration > CHUNK_SECONDS:
            n = math.ceil(duration / CHUNK_SECONDS)
            print(f"long file -> {n} chunks of {CHUNK_SECONDS}s")
            for c in range(n):
                off = c * CHUNK_SECONDS
                chunk = td / f"chunk_{c}.mp3"
                cut_chunk(audio, chunk, off, CHUNK_SECONDS)
                print(f"chunk {c + 1}/{n} (offset {off:.0f}s) -> Gemini...")
                raw = call_gemini(chunk, prompt, keys)
                items = parse_response(raw, base.with_suffix(".raw.txt"))
                entries, warns = normalize(items, off, CHUNK_SECONDS)
                all_entries += entries
                all_warnings += warns
        else:
            print("sending to Gemini...")
            raw = call_gemini(audio, prompt, keys)
            items = parse_response(raw, base.with_suffix(".raw.txt"))
            entries, warns = normalize(items, 0.0, duration)
            all_entries += entries
            all_warnings += warns

    all_entries.sort(key=lambda e: e["start"])
    export(all_entries, base)

    from collections import Counter
    speakers = Counter(e["speaker"] for e in all_entries)
    print(f"\nDONE: {len(all_entries)} entries")
    print(f"  -> {base.with_suffix('.json')}")
    print(f"  -> {base.with_suffix('.srt')}  (Khmer)")
    print(f"speakers: {dict(speakers)}")
    if all_warnings:
        print(f"warnings ({len(all_warnings)}):")
        for w in all_warnings[:20]:
            print(f"  - {w}")


def main() -> None:
    ap = argparse.ArgumentParser(description="Chinese audio -> Khmer dubbing script")
    ap.add_argument("input", help="audio/video file OR a series folder")
    ap.add_argument("--glossary", default="", help="glossary file (file mode only)")
    ap.add_argument("--out", default="", help="output directory (file mode only)")
    args = ap.parse_args()

    target = Path(args.input)
    if not target.exists():
        sys.exit(f"ERROR: input not found: {target}")
    keys = load_keys()

    if target.is_dir():
        # Series mode: one folder per series; its glossary.txt lives inside.
        gfile = target / "glossary.txt"
        glossary = gfile.read_text(encoding="utf-8").strip() if gfile.exists() else ""
        if not glossary:
            print("WARNING: no glossary.txt in series folder - names may drift.")
            glossary = "(no glossary provided)"
        prompt = GEMINI_PROMPT.replace("{GLOSSARY}", glossary)
        out_dir = target / "out"
        out_dir.mkdir(exist_ok=True)
        files = sorted(p for p in target.iterdir()
                       if p.is_file() and p.suffix.lower() in MEDIA_EXTS)
        if not files:
            sys.exit("ERROR: no media files in series folder.")
        print(f"SERIES MODE: {target.name} - {len(files)} file(s), model {MODEL}")
        done = skipped = 0
        for f in files:
            if (out_dir / f"{f.stem}.json").exists():
                print(f"skip (done): {f.name}")
                skipped += 1
                continue
            print(f"\n=== {f.name} ===")
            process_one(f, prompt, keys, out_dir)
            done += 1
        print(f"\nSERIES DONE: {done} processed, {skipped} skipped (already done)")
    else:
        glossary = "(no glossary provided)"
        if args.glossary and Path(args.glossary).exists():
            glossary = Path(args.glossary).read_text(encoding="utf-8").strip() or glossary
        prompt = GEMINI_PROMPT.replace("{GLOSSARY}", glossary)
        out_dir = Path(args.out) if args.out else Path("out")
        out_dir.mkdir(parents=True, exist_ok=True)
        process_one(target, prompt, keys, out_dir)


if __name__ == "__main__":
    main()
