#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DragonDub AI - Local Chinese OCR Worker
High-speed local Chinese text recognition powered by RapidOCR (ONNXRuntime).
Extracts burned-in Chinese dialogue subtitles locally with sub-second latency per frame.
Zero cloud API dependency, CPU & GPU compatible, Windows safe.
"""

import sys
import os
import argparse
import json
import time
import re
import traceback

# Force UTF-8 encoding on Windows to prevent console character corruption
if sys.platform.startswith("win"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass


def clean_chinese_text(text: str) -> str:
    """Strip decorative symbols, brackets, and watermark noise from raw Chinese OCR text."""
    if not text:
        return ""
    cleaned = str(text).strip()
    # Strip music notes ♪ ♫
    cleaned = re.sub(r"[♪♫♬♩]+", "", cleaned)
    # Strip episode badges like 《第一集》
    cleaned = re.sub(r"^《第[0-9一二三四五六七八九十百千万]+[集话章]》$", "", cleaned)
    # Strip decorative outer brackets 【...】
    cleaned = re.sub(r"^[【〖『\[]([^】〗』\]]+)[】〗』\]]$", r"\1", cleaned)
    # Strip whitespace inside Chinese text if desired, but keep punctuation
    cleaned = cleaned.strip()
    return cleaned


def parse_args():
    parser = argparse.ArgumentParser(description="DragonDub Local Chinese OCR Worker")
    parser.add_argument("--check", action="store_true", help="Check RapidOCR availability and exit")
    parser.add_argument("--input_json", default="", help="Path to input JSON file containing frames to process")
    parser.add_argument("--output_json", default="", help="Path to write output JSON results")
    parser.add_argument("--det_limit_side_len", type=int, default=360, help="Max detection side length (default 360 for high speed)")
    parser.add_argument("--roi_ymin", type=float, default=0.72, help="Normalized Y min for subtitle safe zone")
    parser.add_argument("--roi_ymax", type=float, default=0.98, help="Normalized Y max for subtitle safe zone")
    parser.add_argument("--roi_xmin", type=float, default=0.10, help="Normalized X min for subtitle safe zone")
    parser.add_argument("--roi_xmax", type=float, default=0.90, help="Normalized X max for subtitle safe zone")
    return parser.parse_args()


def check_engine():
    try:
        from rapidocr_onnxruntime import RapidOCR
        engine = RapidOCR()
        return {
            "available": True,
            "engine": "rapidocr-onnxruntime",
            "status": "ready"
        }
    except Exception as e:
        return {
            "available": False,
            "engine": "none",
            "error": str(e)
        }


def run_ocr(args):
    # Verify input JSON
    if not args.input_json or not os.path.exists(args.input_json):
        sys.stderr.write(f"Input JSON file not found: {args.input_json}\n")
        sys.exit(1)

    with open(args.input_json, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    frames = manifest.get("frames", [])
    if not isinstance(frames, list):
        sys.stderr.write("Invalid input JSON: frames must be an array\n")
        sys.exit(1)

    import cv2
    from rapidocr_onnxruntime import RapidOCR

    # Initialize RapidOCR engine once per worker process
    engine = RapidOCR(det_limit_side_len=args.det_limit_side_len)

    total_frames = len(frames)
    results = []
    start_time = time.time()

    for idx, item in enumerate(frames):
        file_path = item.get("filePath", "")
        timestamp_sec = float(item.get("timestampSec", 0.0))
        item_id = item.get("id", str(idx + 1))

        if not file_path or not os.path.exists(file_path):
            results.append({
                "id": item_id,
                "timestampSec": timestamp_sec,
                "hasText": False,
                "textZh": "",
                "chineseText": "",
                "confidence": 0.0,
                "isSharp": False,
                "position": "bottom_subtitle",
                "ocrStatus": "failed",
                "error": f"Frame file not found: {file_path}",
                "bboxes": []
            })
            continue

        try:
            img = cv2.imread(file_path)
            if img is None:
                results.append({
                    "id": item_id,
                    "timestampSec": timestamp_sec,
                    "hasText": False,
                    "textZh": "",
                    "chineseText": "",
                    "confidence": 0.0,
                    "isSharp": False,
                    "position": "bottom_subtitle",
                    "ocrStatus": "failed",
                    "error": f"Failed to decode image: {file_path}",
                    "bboxes": []
                })
                continue

            h, w = img.shape[:2]

            # Crop center-bottom subtitle safe zone
            y_min = int(h * max(0.0, min(1.0, args.roi_ymin)))
            y_max = int(h * max(0.0, min(1.0, args.roi_ymax)))
            x_min = int(w * max(0.0, min(1.0, args.roi_xmin)))
            x_max = int(w * max(0.0, min(1.0, args.roi_xmax)))

            if y_max <= y_min or x_max <= x_min:
                roi = img
            else:
                roi = img[y_min:y_max, x_min:x_max]

            # Run RapidOCR on subtitle region crop
            ocr_res, elapse = engine(roi, use_det=True, use_cls=False, use_rec=True)

            if not ocr_res:
                # No text detected in subtitle region
                results.append({
                    "id": item_id,
                    "timestampSec": timestamp_sec,
                    "hasText": False,
                    "textZh": "",
                    "chineseText": "",
                    "confidence": 1.0,
                    "isSharp": True,
                    "position": "bottom_subtitle",
                    "ocrStatus": "verified_empty",
                    "bboxes": []
                })
            else:
                # Filter valid text lines
                valid_lines = []
                confidences = []
                bboxes = []

                # Sort lines by y coordinate (supports multi-line subtitles)
                sorted_res = sorted(ocr_res, key=lambda r: min(pt[1] for pt in r[0]) if r[0] else 0)

                for box, raw_text, conf in sorted_res:
                    cleaned = clean_chinese_text(raw_text)
                    if cleaned and float(conf) >= 0.40:
                        valid_lines.append(cleaned)
                        confidences.append(float(conf))
                        bboxes.append(box)

                if valid_lines:
                    combined_text = "\n".join(valid_lines) if len(valid_lines) > 1 else valid_lines[0]
                    avg_conf = sum(confidences) / len(confidences)
                    results.append({
                        "id": item_id,
                        "timestampSec": timestamp_sec,
                        "hasText": True,
                        "textZh": combined_text,
                        "chineseText": combined_text,
                        "confidence": round(avg_conf, 4),
                        "isSharp": avg_conf >= 0.70,
                        "position": "bottom_subtitle",
                        "ocrStatus": "verified_text",
                        "bboxes": bboxes
                    })
                else:
                    results.append({
                        "id": item_id,
                        "timestampSec": timestamp_sec,
                        "hasText": False,
                        "textZh": "",
                        "chineseText": "",
                        "confidence": 0.85,
                        "isSharp": True,
                        "position": "bottom_subtitle",
                        "ocrStatus": "verified_empty",
                        "bboxes": []
                    })
        except Exception as err:
            results.append({
                "id": item_id,
                "timestampSec": timestamp_sec,
                "hasText": False,
                "textZh": "",
                "chineseText": "",
                "confidence": 0.0,
                "isSharp": False,
                "position": "bottom_subtitle",
                "ocrStatus": "failed",
                "error": str(err),
                "bboxes": []
            })

        # Emit progress update to stdout as JSON line
        if (idx + 1) % 5 == 0 or (idx + 1) == total_frames:
            progress_msg = {
                "type": "progress",
                "completed": idx + 1,
                "total": total_frames,
                "percent": round(((idx + 1) / max(1, total_frames)) * 100, 1),
                "elapsedSec": round(time.time() - start_time, 2)
            }
            sys.stdout.write(json.dumps(progress_msg) + "\n")
            sys.stdout.flush()

    total_wall_ms = round((time.time() - start_time) * 1000)
    output_data = {
        "success": True,
        "engine": "rapidocr-onnxruntime",
        "totalFrames": total_frames,
        "totalWallMs": total_wall_ms,
        "results": results
    }

    if args.output_json:
        out_dir = os.path.dirname(os.path.abspath(args.output_json))
        if not os.path.exists(out_dir):
            os.makedirs(out_dir, exist_ok=True)
        with open(args.output_json, "w", encoding="utf-8") as f:
            json.dump(output_data, f, ensure_ascii=False, indent=2)

    # Also emit completion JSON to stdout
    sys.stdout.write(json.dumps({"type": "complete", "totalFrames": total_frames, "wallTimeMs": total_wall_ms}) + "\n")
    sys.stdout.flush()


def main():
    args = parse_args()
    if args.check:
        res = check_engine()
        sys.stdout.write(json.dumps(res) + "\n")
        sys.stdout.flush()
        sys.exit(0 if res.get("available") else 1)

    run_ocr(args)


if __name__ == "__main__":
    main()
