#!/usr/bin/env python3
"""
Lightweight local visual context probe for Step 1 Multimodal Speaker Identification.
Reuses OpenCV + YuNet face detector (already bundled in backend/services/models/)
in a single sequential pass over cue midpoints, plus montage sheet generation for
selective Gemini verification batches.
"""

import argparse
import json
import math
import os
import sys
import cv2
import numpy as np


def resolve_yunet_model(explicit_path=None):
    if explicit_path and os.path.exists(explicit_path):
        return explicit_path
    workers_dir = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.abspath(os.path.join(workers_dir, "..", "services", "models", "face_detection_yunet_2023mar.onnx")),
        os.path.join(os.getcwd(), "backend", "services", "models", "face_detection_yunet_2023mar.onnx"),
        os.path.join(os.getcwd(), "face_detection_yunet_2023mar.onnx"),
    ]
    for p in candidates:
        if os.path.exists(p):
            return p
    return None


def compute_hsv_hist(bgr_img):
    hsv = cv2.cvtColor(bgr_img, cv2.COLOR_BGR2HSV)
    hist = cv2.calcHist([hsv], [0, 1], None, [16, 16], [0, 180, 0, 256])
    cv2.normalize(hist, hist, 0, 1, cv2.NORM_MINMAX)
    return hist


def run_probe(video_path, cues, out_dir, model_path=None, thumb_w=288, thumb_h=162):
    os.makedirs(out_dir, exist_ok=True)
    if not os.path.exists(video_path):
        raise FileNotFoundError(f"Video file not found: {video_path}")

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Failed to open video: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    src_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    src_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    dur_sec = (total_frames / fps) if (fps > 0 and total_frames > 0) else 0.0

    yunet_path = resolve_yunet_model(model_path)
    detector = None
    if yunet_path:
        try:
            detector = cv2.FaceDetectorYN.create(
                yunet_path, "", (thumb_w, thumb_h), score_threshold=0.52, nms_threshold=0.3
            )
        except Exception:
            detector = None

    indexed = []
    for idx, cue in enumerate(cues):
        start_sec = float(cue.get("startSec") or 0.0)
        end_sec = float(cue.get("endSec") or (start_sec + 1.5))
        mid_sec = max(0.0, (start_sec + end_sec) / 2.0)
        if dur_sec > 0.2:
            mid_sec = min(max(0.0, mid_sec), max(0.0, dur_sec - 0.1))
        indexed.append((idx, cue, mid_sec))

    indexed.sort(key=lambda item: item[2])
    results = [None] * len(cues)
    prev_hist = None
    cur_frame_idx = -1

    for orig_idx, cue, mid_sec in indexed:
        cue_id = str(cue.get("sourceCueId") or cue.get("id") or f"cue_{orig_idx + 1}")
        safe_id = "".join(ch if ch.isalnum() or ch in ("_", "-") else "_" for ch in cue_id)
        thumb_path = os.path.join(out_dir, f"cue_{orig_idx:04d}_{safe_id}.jpg")

        target_frame_idx = max(0, int(round(mid_sec * fps)))
        if total_frames > 0:
            target_frame_idx = min(target_frame_idx, total_frames - 1)

        if cur_frame_idx < 0 or (target_frame_idx - cur_frame_idx) > int(fps * 18):
            cap.set(cv2.CAP_PROP_POS_FRAMES, target_frame_idx)
            ret, frame = cap.read()
            cur_frame_idx = target_frame_idx if ret else -1
        else:
            while cur_frame_idx < target_frame_idx - 1:
                if not cap.grab():
                    break
                cur_frame_idx += 1
            if cur_frame_idx == target_frame_idx:
                ret, frame = True, last_frame
            else:
                ret, frame = cap.read()
                cur_frame_idx = target_frame_idx if ret else cur_frame_idx + 1
        if ret and frame is not None:
            last_frame = frame

        if not ret or frame is None:
            results[orig_idx] = {
                "sourceCueId": cue_id,
                "midSec": round(mid_sec, 2),
                "thumbPath": None,
                "faceCount": 0,
                "largestFaceAreaRatio": 0.0,
                "largestFaceCenterX": None,
                "sceneCutFromPrev": True,
                "histDiff": 1.0,
            }
            continue

        thumb = cv2.resize(frame, (thumb_w, thumb_h), interpolation=cv2.INTER_AREA)
        cv2.imwrite(thumb_path, thumb, [int(cv2.IMWRITE_JPEG_QUALITY), 78])

        face_count = 0
        largest_area_ratio = 0.0
        largest_cx = None
        if detector is not None:
            try:
                detector.setInputSize((thumb_w, thumb_h))
                faces = detector.detect(thumb)[1]
                if faces is not None and len(faces) > 0:
                    face_count = int(len(faces))
                    best_area = 0.0
                    for f in faces:
                        fx, fy, fw, fh = float(f[0]), float(f[1]), float(f[2]), float(f[3])
                        area = max(0.0, fw * fh)
                        if area > best_area:
                            best_area = area
                            largest_area_ratio = round(area / float(thumb_w * thumb_h), 4)
                            largest_cx = round((fx + fw / 2.0) / float(thumb_w), 3)
            except Exception:
                pass

        hist = compute_hsv_hist(thumb)
        hist_diff = 1.0 if prev_hist is None else float(cv2.compareHist(prev_hist, hist, cv2.HISTCMP_BHATTACHARYYA))
        prev_hist = hist

        results[orig_idx] = {
            "sourceCueId": cue_id,
            "midSec": round(mid_sec, 2),
            "thumbPath": thumb_path,
            "faceCount": face_count,
            "largestFaceAreaRatio": largest_area_ratio,
            "largestFaceCenterX": largest_cx,
            "sceneCutFromPrev": bool(hist_diff >= 0.34),
            "histDiff": round(hist_diff, 3),
        }

    cap.release()
    return {
        "videoWidth": src_w,
        "videoHeight": src_h,
        "durationSec": round(dur_sec, 2),
        "cues": results,
    }


def build_montage(items, montage_out, cols=4, cell_w=288, cell_h=162):
    if not items:
        return None
    rows = math.ceil(len(items) / float(cols))
    canvas = np.zeros((rows * cell_h, cols * cell_w, 3), dtype=np.uint8)
    for i, item in enumerate(items):
        r = i // cols
        c = i % cols
        y0, x0 = r * cell_h, c * cell_w
        tpath = item.get("thumbPath")
        if tpath and os.path.exists(tpath):
            img = cv2.imread(tpath)
            if img is not None:
                cell = cv2.resize(img, (cell_w, cell_h))
            else:
                cell = np.full((cell_h, cell_w, 3), 24, dtype=np.uint8)
        else:
            cell = np.full((cell_h, cell_w, 3), 24, dtype=np.uint8)

        label = str(item.get("label") or f"#{i + 1}")
        cv2.rectangle(cell, (0, 0), (min(cell_w, 12 * len(label) + 14), 22), (0, 0, 0), -1)
        cv2.putText(cell, label, (5, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.48, (0, 255, 255), 1, cv2.LINE_AA)
        canvas[y0:y0 + cell_h, x0:x0 + cell_w] = cell

    os.makedirs(os.path.dirname(os.path.abspath(montage_out)), exist_ok=True)
    cv2.imwrite(montage_out, canvas, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
    return montage_out


def run_probe_on_images(cues, model_path=None, thumb_w=288, thumb_h=162):
    yunet_path = resolve_yunet_model(model_path)
    detector = None
    if yunet_path:
        try:
            detector = cv2.FaceDetectorYN.create(
                yunet_path, "", (thumb_w, thumb_h), score_threshold=0.52, nms_threshold=0.3
            )
        except Exception:
            detector = None

    results = []
    prev_hist = None
    for idx, cue in enumerate(cues):
        cue_id = str(cue.get("sourceCueId") or cue.get("id") or f"cue_{idx + 1}")
        mid_sec = float(cue.get("midSec") or 0.0)
        tpath = cue.get("thumbPath")
        if not tpath or not os.path.exists(tpath):
            results.append({
                "sourceCueId": cue_id,
                "midSec": round(mid_sec, 2),
                "thumbPath": None,
                "faceCount": 0,
                "largestFaceAreaRatio": 0.0,
                "largestFaceCenterX": None,
                "sceneCutFromPrev": True,
                "histDiff": 1.0,
            })
            continue

        img = cv2.imread(tpath)
        if img is None:
            results.append({
                "sourceCueId": cue_id,
                "midSec": round(mid_sec, 2),
                "thumbPath": None,
                "faceCount": 0,
                "largestFaceAreaRatio": 0.0,
                "largestFaceCenterX": None,
                "sceneCutFromPrev": True,
                "histDiff": 1.0,
            })
            continue

        thumb = cv2.resize(img, (thumb_w, thumb_h), interpolation=cv2.INTER_AREA)
        face_count = 0
        largest_area_ratio = 0.0
        largest_cx = None
        if detector is not None:
            try:
                detector.setInputSize((thumb_w, thumb_h))
                faces = detector.detect(thumb)[1]
                if faces is not None and len(faces) > 0:
                    face_count = int(len(faces))
                    best_area = 0.0
                    for f in faces:
                        fx, fy, fw, fh = float(f[0]), float(f[1]), float(f[2]), float(f[3])
                        area = max(0.0, fw * fh)
                        if area > best_area:
                            best_area = area
                            largest_area_ratio = round(area / float(thumb_w * thumb_h), 4)
                            largest_cx = round((fx + fw / 2.0) / float(thumb_w), 3)
            except Exception:
                pass

        hist = compute_hsv_hist(thumb)
        hist_diff = 1.0 if prev_hist is None else float(cv2.compareHist(prev_hist, hist, cv2.HISTCMP_BHATTACHARYYA))
        prev_hist = hist

        results.append({
            "sourceCueId": cue_id,
            "midSec": round(mid_sec, 2),
            "thumbPath": tpath,
            "faceCount": face_count,
            "largestFaceAreaRatio": largest_area_ratio,
            "largestFaceCenterX": largest_cx,
            "sceneCutFromPrev": bool(hist_diff >= 0.34),
            "histDiff": round(hist_diff, 3),
        })

    return {"cues": results}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", default="probe", choices=["probe", "images", "montage"])
    parser.add_argument("--video", default=None)
    parser.add_argument("--cues", required=True)
    parser.add_argument("--out_dir", default=None)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model", default=None)
    parser.add_argument("--cols", type=int, default=4)
    args = parser.parse_args()

    with open(args.cues, "r", encoding="utf-8") as f:
        payload = json.load(f)

    if args.mode == "montage":
        out = build_montage(payload, args.output, cols=args.cols)
        print(json.dumps({"success": True, "montagePath": out}))
    elif args.mode == "images":
        res = run_probe_on_images(payload, model_path=args.model)
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(res, f, ensure_ascii=False)
        print(json.dumps({"success": True, "count": len(res.get("cues", []))}))
    else:
        res = run_probe(args.video, payload, args.out_dir, model_path=args.model)
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(res, f, ensure_ascii=False)
        print(json.dumps({"success": True, "count": len(res.get("cues", []))}))
