#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DragonDub AI - Local Chinese OCR Worker
High-speed local Chinese text recognition powered by RapidOCR (ONNXRuntime).
Extracts burned-in Chinese dialogue subtitles locally with sub-second latency per frame.
Supports persistent streaming mode (single model init) and legacy one-shot CLI.
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
    # Strip trailing/leading HUD bullet/dash artifacts (e.g. "魔都空旷街区·")
    cleaned = re.sub(r"^[·•・\-—\s]+|[·•・\-—\s]+$", "", cleaned)
    cleaned = cleaned.strip()
    return cleaned


def parse_args():
    parser = argparse.ArgumentParser(description="DragonDub Local Chinese OCR Worker")
    parser.add_argument("--check", action="store_true", help="Check RapidOCR availability and exit")
    parser.add_argument("--persistent", action="store_true", help="Run in persistent JSON-lines streaming mode over stdin/stdout")
    parser.add_argument("--input_json", default="", help="Path to input JSON file containing frames to process")
    parser.add_argument("--output_json", default="", help="Path to write output JSON results")
    parser.add_argument("--det_limit_side_len", type=int, default=480, help="Max detection side length (default 480 for accuracy & speed balance)")
    parser.add_argument("--roi_ymin", type=float, default=0.72, help="Normalized Y min for subtitle safe zone")
    parser.add_argument("--roi_ymax", type=float, default=0.98, help="Normalized Y max for subtitle safe zone")
    parser.add_argument("--roi_xmin", type=float, default=0.10, help="Normalized X min for subtitle safe zone")
    parser.add_argument("--roi_xmax", type=float, default=0.90, help="Normalized X max for subtitle safe zone")
    parser.add_argument("--intra_op_num_threads", type=int, default=2, help="ONNXRuntime intra_op_num_threads (default 2 for optimal CPU performance)")
    return parser.parse_args()


def create_engine(rapidocr, det_limit_side_len, threads=None):
    if threads is None:
        raw_env = os.environ.get("RAPIDOCR_INTRA_OP_THREADS", "2")
        threads = int(raw_env) if raw_env.isdigit() else 2
    if threads not in (0, 1, 2, 4):
        threads = 2
    import cv2
    cv2.setNumThreads(1)
    return rapidocr(det_limit_side_len=det_limit_side_len, intra_op_num_threads=threads, inter_op_num_threads=1)


def peak_rss_mb():
    if sys.platform == "win32":
        try:
            import psutil
            return round(psutil.Process().memory_info().peak_wset / 1048576, 2)
        except (ImportError, AttributeError):
            return None
    import resource
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return round(peak / (1048576 if sys.platform == "darwin" else 1024), 2)


def check_engine():
    try:
        from rapidocr_onnxruntime import RapidOCR
        create_engine(RapidOCR, 480)
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


WATERMARK_TEXT_RE = re.compile(
    r"(?:bilibili|抖音|快手|小红书|西瓜视频|小饼漫播|偷了.*的视频|^@[A-Za-z0-9_.-]+$)",
    re.IGNORECASE,
)
CORNER_ID_WATERMARK_RE = re.compile(r"^[\u4e00-\u9fa5A-Za-z_-]{1,8}\d{3,}$")


def is_corner_watermark_item(it: dict) -> bool:
    """Reject platform watermarks, pure-numeric HUD counters, and extreme-corner creator IDs."""
    txt = it.get("text", "")
    if not txt:
        return True
    if WATERMARK_TEXT_RE.search(txt):
        return True
    # Pure numbers/decimal HUD counters (e.g. "587.46") are never Chinese dialogue
    if re.match(r"^[\d.,:%+\-/\s|]+$", txt):
        return True
    has_hanzi = bool(re.search(r"[\u3400-\u4dbf\u4e00-\u9fa5]", txt))
    # Reject low-confidence 1-char noise or off-center 1-char non-Hanzi artifacts,
    # while preserving confident single-character Chinese dialogue replies (e.g. 一, 嗯, 谁).
    if len(txt) == 1 and (it.get("conf", 0.0) < 0.80 or (not has_hanzi and not it.get("is_centered"))):
        return True
    in_extreme_x_corner = it["x_min"] >= 0.78 or it["x_max"] <= 0.22
    in_extreme_y_corner = it["y_min"] >= 0.72 or it["y_max"] <= 0.22
    if in_extreme_x_corner and in_extreme_y_corner:
        if CORNER_ID_WATERMARK_RE.match(txt) or re.search(r"[A-Za-z0-9@]", txt):
            return True
    return False


def filter_dialogue_ocr_results(ocr_res, roi_w: int, roi_h: int):
    """
    Filter out corner watermarks, off-center side/corner time-cards (e.g. '几个月前'),
    vertical nameplates, and upper HUD overlays when centered or off-center dialogue is present.
    Preserves legitimate off-center dialogue subtitles and stacked 2-line centered subtitles.
    """
    if not ocr_res:
        return []

    safe_w = max(1.0, float(roi_w or 1))
    safe_h = max(1.0, float(roi_h or 1))

    items = []
    for box, raw_text, conf in ocr_res:
        cleaned = clean_chinese_text(raw_text)
        if not cleaned or float(conf) < 0.40:
            continue
        xs = [pt[0] for pt in box] if box else [0.0]
        ys = [pt[1] for pt in box] if box else [0.0]
        x_min = min(xs) / safe_w
        x_max = max(xs) / safe_w
        y_min = min(ys) / safe_h
        y_max = max(ys) / safe_h
        x_center = (x_min + x_max) / 2.0
        y_center = (y_min + y_max) / 2.0
        box_w_px = max(1.0, max(xs) - min(xs))
        box_h_px = max(1.0, max(ys) - min(ys))
        is_vertical = (box_h_px > box_w_px * 1.55) and (len(cleaned) >= 2)
        is_centered = (0.30 <= x_center <= 0.70) or (x_min <= 0.46 and x_max >= 0.54)
        it = {
            "box": box,
            "text": cleaned,
            "conf": float(conf),
            "x_min": x_min,
            "x_max": x_max,
            "y_min": y_min,
            "y_max": y_max,
            "x_center": x_center,
            "y_center": y_center,
            "box_h": y_max - y_min,
            "is_vertical": is_vertical,
            "is_centered": is_centered,
        }
        if is_corner_watermark_item(it):
            continue
        items.append(it)

    if len(items) >= 2:
        centered_horiz = [it for it in items if it["is_centered"] and not it["is_vertical"]]
        if centered_horiz:
            max_centered_h = max(it["box_h"] for it in centered_horiz)
            anchor = max(
                centered_horiz,
                key=lambda it: (it["box_h"] >= max_centered_h * 0.75, it["y_center"], it["box_h"]),
            )
            anchor_h = max(1e-6, anchor["box_h"])
            kept = []
            for it in items:
                if it["is_vertical"]:
                    continue
                # Drop smaller overlaid HUD/stat rows sitting behind or around the main dialogue anchor
                height_ratio = it["box_h"] / anchor_h
                if height_ratio < 0.65:
                    continue
                # Preserve off-center horizontal dialogue at same subtitle band, drop side corner stamps
                in_side_corner = (it["x_min"] >= 0.76 or it["x_max"] <= 0.24) and abs(it["y_center"] - anchor["y_center"]) > 0.12
                if in_side_corner:
                    continue
                # Drop upper HUD/badge lines separated vertically above the main subtitle anchor
                # while keeping stacked 2-line centered dialogue subtitles of matching font height
                y_gap = anchor["y_min"] - it["y_max"]
                is_stacked_dialogue = (
                    it["is_centered"]
                    and abs(it["x_center"] - anchor["x_center"]) <= 0.12
                    and y_gap <= 0.10
                    and 0.68 <= height_ratio <= 1.45
                )
                if y_gap > 0.08 and not is_stacked_dialogue:
                    continue
                # Drop pure non-Hanzi prop words (e.g. LISTENING) when main Hanzi dialogue anchor exists
                if re.search(r"[\u4e00-\u9fa5]", anchor["text"]) and not re.search(r"[\u4e00-\u9fa50-9]", it["text"]):
                    continue
                # Drop non-centered wall/side labels not on the same horizontal text row as the centered anchor
                same_horizontal_row = abs(it["y_center"] - anchor["y_center"]) <= anchor_h * 0.45
                if not it["is_centered"] and not same_horizontal_row and abs(it["x_center"] - anchor["x_center"]) > 0.24:
                    continue
                kept.append(it)
            if kept:
                items = kept

    # Sort lines top-to-bottom, then left-to-right
    items.sort(key=lambda it: (round(it["y_min"], 2), it["x_min"]))
    return items


def detect_top_center_subtitle(img, engine):
    """
    Fast pre-checked fallback for top-center subtitles / scene title cards (y=0.06..0.28, x=0.20..0.80)
    when bottom ROI is empty. Runs RapidOCR only if bright centered stroke density is present (<0.5ms skip).
    """
    import cv2
    if img is None or not hasattr(img, "shape"):
        return None
    h, w = img.shape[:2]
    if h < 80 or w < 160:
        return None
    ty0, ty1 = int(h * 0.06), int(h * 0.28)
    tx0, tx1 = int(w * 0.20), int(w * 0.80)
    top_roi = img[ty0:ty1, tx0:tx1]
    if top_roi.size == 0:
        return None
    gray = cv2.cvtColor(top_roi, cv2.COLOR_BGR2GRAY) if len(top_roi.shape) == 3 else top_roi
    bright_ratio = float((gray >= 215).mean())
    if bright_ratio < 0.004 or bright_ratio > 0.22:
        return None
    edges = cv2.Canny(gray, 80, 180)
    edge_ratio = float(edges.mean()) / 255.0
    if edge_ratio < 0.015:
        return None
    ocr_res, _ = engine(top_roi, use_det=True, use_cls=False, use_rec=True)
    if not ocr_res:
        return None
    th, tw = top_roi.shape[:2]
    items = filter_dialogue_ocr_results(ocr_res, tw, th)
    # Require centered Chinese Hanzi (>= 2 Han chars) for top-zone capture
    centered_cn = [
        it for it in items
        if it["is_centered"] and len(re.findall(r"[\u4e00-\u9fa5]", it["text"])) >= 2 and it["conf"] >= 0.70
    ]
    if not centered_cn:
        return None
    text = "\n".join(it["text"] for it in centered_cn) if len(centered_cn) > 1 else centered_cn[0]["text"]
    avg_conf = sum(it["conf"] for it in centered_cn) / len(centered_cn)
    return {
        "hasText": True,
        "textZh": text,
        "chineseText": text,
        "confidence": round(avg_conf, 4),
        "isSharp": avg_conf >= 0.70,
        "position": "title_card",
        "ocrStatus": "verified_text",
        "bboxes": [it["box"] for it in centered_cn],
    }


def read_ocr_result(roi, ocr_res):
    import cv2
    if not ocr_res:
        # Check edge activity to determine empty confidence
        # Clean uniform background = 0.75, high stroke/edge activity = 0.40 (uncertain)
        try:
            gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY) if len(roi.shape) == 3 else roi
            edges = cv2.Canny(gray, 50, 150)
            edge_ratio = float(edges.mean()) / 255.0
            empty_conf = 0.40 if edge_ratio > 0.035 else 0.75
        except Exception:
            empty_conf = 0.50

        return {
            "hasText": False,
            "textZh": "",
            "chineseText": "",
            "confidence": round(empty_conf, 2),
            "isSharp": True,
            "position": "bottom_subtitle",
            "ocrStatus": "empty",
            "bboxes": []
        }

    roi_h, roi_w = roi.shape[:2] if roi is not None and hasattr(roi, "shape") else (1, 1)
    filtered_items = filter_dialogue_ocr_results(ocr_res, roi_w, roi_h)

    valid_lines = [it["text"] for it in filtered_items]
    confidences = [it["conf"] for it in filtered_items]
    bboxes = [it["box"] for it in filtered_items]

    if valid_lines:
        combined_text = "\n".join(valid_lines) if len(valid_lines) > 1 else valid_lines[0]
        avg_conf = sum(confidences) / len(confidences)
        return {
            "hasText": True,
            "textZh": combined_text,
            "chineseText": combined_text,
            "confidence": round(avg_conf, 4),
            "isSharp": avg_conf >= 0.70,
            "position": "bottom_subtitle",
            "ocrStatus": "verified_text",
            "bboxes": bboxes
        }
    else:
        return {
            "hasText": False,
            "textZh": "",
            "chineseText": "",
            "confidence": 0.50,
            "isSharp": True,
            "position": "bottom_subtitle",
            "ocrStatus": "empty",
            "bboxes": []
        }


def process_frames_batch(frames, engine, args, roi_ymin, roi_ymax, roi_xmin, roi_xmax, batch_id=""):
    """
    Processes a slice of candidate frames using the already-initialized engine.
    Applies verified subtitle-region deduplication before calling RapidOCR.
    """
    import cv2
    import numpy as np

    decode_sec = 0.0
    inference_sec = 0.0
    results = []
    actual_ocr_count = 0
    deduped_count = 0
    total_frames = len(frames)

    prev_roi = None
    prev_res = None
    prev_cue_idx = None
    prev_ts = None

    for idx, item in enumerate(frames):
        file_path = item.get("filePath", "")
        timestamp_sec = float(item.get("timestampSec", 0.0))
        item_id = item.get("id", str(idx + 1))
        cue_idx = item.get("cueIndex")
        is_short = bool(item.get("isShortCue", False))
        is_scene_cut = bool(item.get("sceneCut", False))

        if is_short or is_scene_cut or cue_idx != prev_cue_idx:
            prev_roi = None

        if not file_path or not os.path.exists(file_path):
            prev_roi = None
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
            decode_start = time.perf_counter()
            img = cv2.imread(file_path)
            decode_sec += time.perf_counter() - decode_start
            if img is None:
                prev_roi = None
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
            y_min = int(h * max(0.0, min(1.0, roi_ymin)))
            y_max = int(h * max(0.0, min(1.0, roi_ymax)))
            x_min = int(w * max(0.0, min(1.0, roi_xmin)))
            x_max = int(w * max(0.0, min(1.0, roi_xmax)))

            if y_max <= y_min or x_max <= x_min:
                roi = img
            else:
                roi = img[y_min:y_max, x_min:x_max]

            # An edit outside the previous text box can add a second line.
            # Compare every pixel RapidOCR would see, including its original color.
            is_deduped = (
                type(cue_idx) is int and cue_idx > 0 and cue_idx == prev_cue_idx
                and prev_roi is not None and prev_res["hasText"]
                and np.array_equal(roi, prev_roi)
            )

            if is_deduped:
                deduped_count += 1
                results.append({
                    "id": item_id,
                    "timestampSec": timestamp_sec,
                    "hasText": prev_res["hasText"],
                    "textZh": prev_res["textZh"],
                    "chineseText": prev_res["chineseText"],
                    "confidence": prev_res["confidence"],
                    "isSharp": prev_res["isSharp"],
                    "position": "bottom_subtitle",
                    "ocrStatus": prev_res["ocrStatus"],
                    "bboxes": prev_res.get("bboxes", []),
                    "isDeduped": True,
                    "sourceTimestampSec": prev_ts,
                })
            else:
                actual_ocr_count += 1
                infer_start = time.perf_counter()
                try:
                    ocr_res, _ = engine(roi, use_det=True, use_cls=False, use_rec=True)
                finally:
                    inference_sec += time.perf_counter() - infer_start
                ocr_out = read_ocr_result(roi, ocr_res)
                if not ocr_out["hasText"] and roi_ymin >= 0.50:
                    top_hit = detect_top_center_subtitle(img, engine)
                    if top_hit:
                        ocr_out = top_hit
                ocr_out_clean = {
                    "id": item_id,
                    "timestampSec": timestamp_sec,
                    "hasText": ocr_out["hasText"],
                    "textZh": ocr_out["textZh"],
                    "chineseText": ocr_out["chineseText"],
                    "confidence": ocr_out["confidence"],
                    "isSharp": ocr_out["isSharp"],
                    "position": ocr_out.get("position", "bottom_subtitle"),
                    "ocrStatus": ocr_out["ocrStatus"],
                    "bboxes": ocr_out.get("bboxes", []),
                    "isDeduped": False,
                }
                results.append(ocr_out_clean)
                prev_roi = None if is_short or is_scene_cut else roi
                prev_res = ocr_out_clean
                prev_cue_idx = cue_idx
                prev_ts = timestamp_sec

        except Exception as err:
            prev_roi = None
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
        if (idx + 1) % 10 == 0 or (idx + 1) == total_frames:
            progress_msg = {
                "type": "progress",
                "batchId": batch_id,
                "completed": idx + 1,
                "total": total_frames,
                "percent": round(((idx + 1) / max(1, total_frames)) * 100, 1),
            }
            sys.stdout.write(json.dumps(progress_msg) + "\n")
            sys.stdout.flush()

    return results, {
        "actualOcrFrames": actual_ocr_count,
        "dedupedFrames": deduped_count,
        "inferenceMs": round(inference_sec * 1000, 3),
        "imageDecodeMs": round(decode_sec * 1000, 3),
        "workerPeakRssMb": peak_rss_mb(),
    }


def run_persistent_worker(args):
    """
    Persistent JSON-lines streaming mode.
    Initializes RapidOCR engine once during startup and processes requests via stdin.
    """
    from rapidocr_onnxruntime import RapidOCR

    t_init_start = time.perf_counter()
    engine = create_engine(RapidOCR, args.det_limit_side_len, threads=getattr(args, 'intra_op_num_threads', 2))
    init_ms = round((time.perf_counter() - t_init_start) * 1000)

    # Emit ready handshake
    ready_msg = {
        "type": "ready",
        "engine": "rapidocr-onnxruntime",
        "initMs": init_ms,
        "workerCpuMs": round(time.process_time() * 1000, 2),
        "pid": os.getpid()
    }
    sys.stdout.write(json.dumps(ready_msg) + "\n")
    sys.stdout.flush()

    for line in sys.stdin:
        line = line.strip().lstrip('\ufeff')
        if not line:
            continue

        try:
            req = json.loads(line)
        except Exception as e:
            sys.stderr.write(f"Failed to parse stdin JSON: {e}\n")
            continue

        cmd = req.get("cmd")
        if cmd == "ping":
            sys.stdout.write(json.dumps({"type": "pong"}) + "\n")
            sys.stdout.flush()

        elif cmd == "process_batch":
            batch_id = req.get("batchId", "")
            frames = req.get("frames", [])
            roi_ymin = float(req.get("roiYMin", args.roi_ymin))
            roi_ymax = float(req.get("roiYMax", args.roi_ymax))
            roi_xmin = float(req.get("roiXMin", args.roi_xmin))
            roi_xmax = float(req.get("roiXMax", args.roi_xmax))

            t_batch_start = time.perf_counter()
            cpu_start = time.process_time()
            batch_results, metrics = process_frames_batch(
                frames, engine, args, roi_ymin, roi_ymax, roi_xmin, roi_xmax, batch_id=batch_id
            )
            wall_ms = round((time.perf_counter() - t_batch_start) * 1000)

            res_msg = {
                "type": "batch_result",
                "batchId": batch_id,
                "success": True,
                "results": batch_results,
                "totalFrames": len(frames),
                **metrics,
                "workerCpuMs": round((time.process_time() - cpu_start) * 1000, 2),
                "wallTimeMs": wall_ms
            }
            sys.stdout.write(json.dumps(res_msg) + "\n")
            sys.stdout.flush()

        elif cmd in ("stop", "exit"):
            sys.stdout.write(json.dumps({"type": "stopped"}) + "\n")
            sys.stdout.flush()
            break


def run_legacy_ocr(args):
    """Legacy one-shot batch CLI mode for backward compatibility."""
    if not args.input_json or not os.path.exists(args.input_json):
        sys.stderr.write(f"Input JSON file not found: {args.input_json}\n")
        sys.exit(1)

    with open(args.input_json, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    frames = manifest.get("frames", [])
    if not isinstance(frames, list):
        sys.stderr.write("Invalid input JSON: frames must be an array\n")
        sys.exit(1)

    from rapidocr_onnxruntime import RapidOCR

    t_init_start = time.perf_counter()
    engine = create_engine(RapidOCR, args.det_limit_side_len, threads=getattr(args, 'intra_op_num_threads', 2))
    init_ms = round((time.perf_counter() - t_init_start) * 1000)

    start_time = time.time()
    results, metrics = process_frames_batch(
        frames, engine, args, args.roi_ymin, args.roi_ymax, args.roi_xmin, args.roi_xmax
    )
    total_wall_ms = round((time.time() - start_time) * 1000)

    output_data = {
        "success": True,
        "engine": "rapidocr-onnxruntime",
        "initMs": init_ms,
        "totalFrames": len(frames),
        **metrics,
        "workerCpuMs": round(time.process_time() * 1000, 2),
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
    sys.stdout.write(json.dumps({
        "type": "complete",
        "totalFrames": len(frames),
        "actualOcrFrames": metrics["actualOcrFrames"],
        "dedupedFrames": metrics["dedupedFrames"],
        "wallTimeMs": total_wall_ms
    }) + "\n")
    sys.stdout.flush()


def main():
    args = parse_args()
    if args.check:
        res = check_engine()
        sys.stdout.write(json.dumps(res) + "\n")
        sys.stdout.flush()
        sys.exit(0 if res.get("available") else 1)

    if args.persistent:
        run_persistent_worker(args)
    else:
        run_legacy_ocr(args)


if __name__ == "__main__":
    main()
