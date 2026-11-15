#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DragonDub AI - PP-OCRv5 Mobile Local OCR Worker
Features:
- PaddleOCR PP-OCRv5 Mobile (det + rec, Chinese 'ch', CPU-only)
- Watermark, disclaimer, and handle noise filtering
- Spatial bounding box classification (bottom_subtitle vs title_card)
- Batch/streaming candidate frame evaluation
- CLI compatibility: --prepare, --threads, --input_json, --output_json
"""

import sys
import os
import argparse
import json
import re
import time
import traceback
import contextlib

# Windows DLL compatibility: initialize torch before paddle to prevent shm.dll [WinError 127]
try:
    import torch  # type: ignore
except Exception:
    pass

# Force UTF-8 encoding on Windows to prevent console charset corruption
if sys.platform.startswith("win"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass


# Noise patterns: watermarks, platform logos, disclaimers, creator handles
WATERMARK_REGEX = re.compile(
    r"(剧情为虚构演绎|A[I1]?生成|切勿当真|请勿模仿|仅供参考|免责声明|"
    r"普法科普|普法宣传|法治|抖音|快手|小红书|哔哩哔哩|bilibili|西瓜视频|"
    r"腾讯视频|爱奇艺|优酷|视频号|公众号|关注|点赞|投币|转发|收藏|"
    r"偷了.*?的视频|侵权必究|搬运必究|原创作品|禁止转载|纯属虚构|"
    r"^@.+|^ID[:：]|^抖音号[:：]|^快手号[:：]|^微信号[:：])",
    re.IGNORECASE
)


def is_watermark_or_noise(text, y_rel, box_w_rel, box_h_rel):
    """
    Determines if detected text is watermark / disclaimer / channel logo noise.
    """
    clean = text.strip()
    if not clean:
        return True

    # Check if text contains at least one Chinese character
    if not re.search(r"[\u4e00-\u9fa5]", clean):
        # Allow numbers/letters only if inside bottom subtitle band with reasonable length
        if y_rel < 0.65 or len(clean) < 3:
            return True

    # Pattern match for disclaimers / platforms / watermarks
    if WATERMARK_REGEX.search(clean):
        return True

    # Corner logos (top 20% of frame, in left or right 25% corner, short text)
    if y_rel < 0.22 and len(clean) <= 6:
        return True

    # Extreme edge text (top 10% of frame)
    if y_rel < 0.10:
        return True

    return False


def classify_text_position(y_rel, height_rel, text):
    """
    Classifies text position into 'bottom_subtitle' or 'title_card'.
    - bottom_subtitle: center-bottom safe band (y_rel >= 0.65)
    - title_card: prominent on-screen text in top/middle band (y_rel < 0.65)
    """
    if y_rel >= 0.65:
        return "bottom_subtitle"
    if height_rel >= 0.05 or len(text) <= 12:
        return "title_card"
    return "unknown"


def clean_subtitle_text(text):
    """
    Strips decorative brackets, musical notes, and surrounding noise.
    """
    if not text:
        return ""
    cleaned = re.sub(r"[♪♫♬♩]+", "", str(text)).strip()
    cleaned = re.sub(r"^《第[0-9一二三四五六七八九十百千万]+[集话章]》$", "", cleaned)
    cleaned = re.sub(r"^[【〖『\[]([^】〗』\]]+)[】〗』\]]$", r"\1", cleaned)
    return cleaned.strip()


def parse_args():
    parser = argparse.ArgumentParser(description="DragonDub PP-OCRv5 Mobile Local OCR Worker")
    parser.add_argument("--input_json", default="", help="Path to JSON file containing candidate frames list")
    parser.add_argument("--image", default="", help="Single image path for direct testing")
    parser.add_argument("--output_json", default="", help="Optional path to write output JSON")
    parser.add_argument("--threads", type=int, default=8, help="CPU thread count (default 8)")
    parser.add_argument("--limit_side_len", type=int, default=960, help="Image detection limit side length")
    parser.add_argument("--prepare", action="store_true", help="Download and cache models then exit")
    return parser.parse_args()


def handle_prepare(args):
    """
    --prepare mode: downloads and initializes the models, then exits 0.
    Logs '[PP-OCR Worker] models ready' on stderr.
    """
    sys.stderr.write(f"[PP-OCR Worker] Preparing PP-OCRv5 mobile models (det + rec, threads={args.threads})...\n")
    sys.stderr.flush()

    t0 = time.time()
    from paddleocr import PaddleOCR  # type: ignore

    ocr = PaddleOCR(
        text_detection_model_name="PP-OCRv5_mobile_det",
        text_recognition_model_name="PP-OCRv5_mobile_rec",
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
        text_det_limit_side_len=args.limit_side_len,
        device="cpu",
        cpu_threads=args.threads,
        enable_mkldnn=False,
    )
    t1 = time.time()
    sys.stderr.write(f"[PP-OCR Worker] Model load done in {t1 - t0:.2f}s\n")
    sys.stderr.write("[PP-OCR Worker] models ready\n")
    sys.stderr.flush()
    sys.exit(0)


def process_single_frame(ocr, item):
    """
    Executes PP-OCR on a single candidate frame and maps output into frame observations.
    """
    img_path = item.get("filePath") or item.get("path")
    t_sec = float(item.get("timestampSec", 0.0))

    if not img_path or not os.path.isfile(img_path):
        return {
            "timestampSec": t_sec,
            "hasText": False,
            "textZh": "",
            "chineseText": "",
            "position": "bottom_subtitle",
            "isSharp": True,
            "rawLines": [],
        }

    try:
        # Predict single frame
        pred_list = list(ocr.predict(img_path))
        if not pred_list:
            return {
                "timestampSec": t_sec,
                "hasText": False,
                "textZh": "",
                "chineseText": "",
                "position": "bottom_subtitle",
                "isSharp": True,
                "rawLines": [],
            }

        pred = pred_list[0]
        rec_texts = pred.get("rec_texts", [])
        rec_scores = pred.get("rec_scores", [])
        rec_boxes = pred.get("rec_boxes", [])

        # Get image dimensions from output_img if available
        doc_res = pred.get("doc_preprocessor_res", {})
        output_img = doc_res.get("output_img")
        if output_img is not None and hasattr(output_img, "shape"):
            img_h, img_w = output_img.shape[:2]
        else:
            img_w, img_h = 1920, 1080

        subtitle_lines = []
        title_card_lines = []
        all_lines = []

        for line_idx, raw_txt in enumerate(rec_texts):
            score = float(rec_scores[line_idx]) if line_idx < len(rec_scores) else 0.5
            box = rec_boxes[line_idx] if line_idx < len(rec_boxes) else None

            if box is not None and len(box) == 4:
                xmin, ymin, xmax, ymax = [float(v) for v in box]
                y_center = (ymin + ymax) / 2.0
                y_rel = y_center / float(img_h) if img_h > 0 else 0.85
                box_w_rel = (xmax - xmin) / float(img_w) if img_w > 0 else 0.5
                box_h_rel = (ymax - ymin) / float(img_h) if img_h > 0 else 0.05
                box_coords = [xmin, ymin, xmax, ymax]
            else:
                y_rel = 0.85
                box_w_rel = 0.5
                box_h_rel = 0.05
                box_coords = []

            # Watermark / Noise Filter
            is_noise = is_watermark_or_noise(raw_txt, y_rel, box_w_rel, box_h_rel)
            cleaned_txt = clean_subtitle_text(raw_txt)

            pos = classify_text_position(y_rel, box_h_rel, cleaned_txt)

            line_obj = {
                "text": cleaned_txt,
                "rawText": raw_txt,
                "confidence": round(score, 3),
                "box": box_coords,
                "yRel": round(y_rel, 3),
                "position": pos,
                "isNoise": is_noise,
            }
            all_lines.append(line_obj)

            if not is_noise and cleaned_txt:
                if pos == "bottom_subtitle":
                    subtitle_lines.append((y_rel, cleaned_txt, score))
                elif pos == "title_card":
                    title_card_lines.append((y_rel, cleaned_txt, score))

        # Select dominant dialogue subtitle text
        if subtitle_lines:
            # Sort vertically (top to bottom if multiline subtitle)
            subtitle_lines.sort(key=lambda x: x[0])
            final_text = "".join([x[1] for x in subtitle_lines]).strip()
            final_pos = "bottom_subtitle"
            has_text = bool(final_text)
        elif title_card_lines:
            title_card_lines.sort(key=lambda x: x[0])
            final_text = "".join([x[1] for x in title_card_lines]).strip()
            final_pos = "title_card"
            has_text = bool(final_text)
        else:
            final_text = ""
            final_pos = "bottom_subtitle"
            has_text = False

        return {
            "timestampSec": t_sec,
            "hasText": has_text,
            "textZh": final_text,
            "chineseText": final_text,
            "position": final_pos,
            "isSharp": True,
            "rawLines": all_lines,
        }

    except Exception as e:
        sys.stderr.write(f"[PP-OCR Worker] Warning: Frame at {t_sec}s failed: {e}\n")
        return {
            "timestampSec": t_sec,
            "hasText": False,
            "textZh": "",
            "chineseText": "",
            "position": "bottom_subtitle",
            "isSharp": False,
            "rawLines": [],
        }


def process_frames(ocr, candidate_frames, threads=8):
    """
    Executes PP-OCR on candidate frames and maps output into frame observations.
    """
    results = []
    total = len(candidate_frames)
    t_start = time.time()

    sys.stderr.write(f"[PP-OCR Worker] Processing {total} candidate frames...\n")
    sys.stderr.flush()

    for idx, item in enumerate(candidate_frames):
        res = process_single_frame(ocr, item)
        results.append(res)

        if (idx + 1) % 25 == 0 or (idx + 1) == total:
            elapsed = time.time() - t_start
            sys.stderr.write(f"[PP-OCR Worker] Progress: {idx + 1}/{total} frames ({elapsed:.1f}s elapsed)\n")
            sys.stderr.flush()

    t_total = time.time() - t_start
    per_frame_ms = (t_total / max(1, total)) * 1000.0
    sys.stderr.write(f"[PP-OCR Worker] Finished {total} frames in {t_total:.2f}s ({per_frame_ms:.1f} ms/frame)\n")
    sys.stderr.flush()

    return results


def main():
    args = parse_args()

    if args.prepare:
        handle_prepare(args)
        return

    t0 = time.time()
    try:
        candidate_frames = []
        if args.input_json and os.path.isfile(args.input_json):
            with open(args.input_json, "r", encoding="utf-8") as f:
                candidate_frames = json.load(f)
        elif args.image and os.path.isfile(args.image):
            candidate_frames = [{"timestampSec": 0.0, "filePath": args.image}]
        else:
            raise ValueError(f"Input frames file or image required: --input_json or --image")

        if not isinstance(candidate_frames, list):
            raise ValueError("Input JSON must contain an array of frame objects")

        from paddleocr import PaddleOCR  # type: ignore

        t_load_start = time.time()
        sys.stderr.write(f"[PP-OCR Worker] Model load start (threads={args.threads})...\n")
        sys.stderr.flush()

        ocr = PaddleOCR(
            text_detection_model_name="PP-OCRv5_mobile_det",
            text_recognition_model_name="PP-OCRv5_mobile_rec",
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
            text_det_limit_side_len=args.limit_side_len,
            device="cpu",
            cpu_threads=args.threads,
            enable_mkldnn=False,
        )
        t_load_done = time.time()
        sys.stderr.write(f"[PP-OCR Worker] Model load done ({t_load_done - t_load_start:.2f}s)\n")
        sys.stderr.flush()

        frames_result = process_frames(ocr, candidate_frames, threads=args.threads)

        out_obj = {
            "status": "success",
            "engine": "ppocr-local",
            "model": "PP-OCRv5_mobile",
            "totalFrames": len(frames_result),
            "frames": frames_result,
        }

        out_json_str = json.dumps(out_obj, ensure_ascii=False)

        if args.output_json:
            with open(args.output_json, "w", encoding="utf-8") as f:
                f.write(out_json_str)

        print(out_json_str)
        sys.exit(0)

    except Exception as e:
        sys.stderr.write(f"[PP-OCR Worker Error] {traceback.format_exc()}\n")
        sys.stderr.flush()
        err_res = {
            "status": "error",
            "message": str(e),
            "engine": "ppocr-local",
            "frames": [],
        }
        print(json.dumps(err_res, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
