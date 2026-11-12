import os
import sys
import json
import argparse
import numpy as np
import cv2

def scan_episode_segments(video_path, segments_data, model_path=None):
    if not os.path.exists(video_path):
        raise FileNotFoundError(f"Video file not found: {video_path}")
        
    if not model_path:
        base_dir = os.path.dirname(os.path.abspath(__file__))
        model_path = os.path.join(base_dir, "models", "face_detection_yunet_2023mar.onnx")
        if not os.path.exists(model_path):
            model_path = os.path.join(os.getcwd(), "face_detection_yunet_2023mar.onnx")
            
    if not os.path.exists(model_path):
        raise FileNotFoundError(f"YuNet model not found: {model_path}")
        
    cap = cv2.VideoCapture(video_path)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    src_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    src_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    
    if src_w == 0 or src_h == 0 or total_frames == 0:
        cap.release()
        return segments_data
        
    # Sample at ~3 fps for ultra-fast scanning (<2-3s for 3min video)
    stride = max(1, int(round(fps / 3.0)))
    detector = cv2.FaceDetectorYN.create(model_path, '', (src_w, src_h), score_threshold=0.55, nms_threshold=0.3)
    
    samples = []
    frame_idx = 0
    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break
        if frame_idx % stride == 0:
            detector.setInputSize((src_w, src_h))
            faces = detector.detect(frame)[1]
            best_face_x = None
            if faces is not None and len(faces) > 0:
                best_area = -1
                for f in faces:
                    fx, fy, fw, fh = f[0:4]
                    area = fw * fh
                    if area > best_area:
                        best_area = area
                        best_face_x = fx + (fw / 2.0)
            samples.append((frame_idx / fps, best_face_x))
        frame_idx += 1
    cap.release()
    
    # Map face positions to each segment
    updated_segments = []
    for s in segments_data:
        # Don't overwrite if user manually adjusted it!
        if s.get('manualCrop') is True and s.get('cropX') is not None:
            updated_segments.append(s)
            continue
            
        start_sec = float(s.get('startSec') or s.get('startTime') or 0.0)
        end_sec = float(s.get('endSec') or s.get('endTime') or (start_sec + 2.0))
        
        # Collect face positions within this segment time window
        faces_in_seg = [fx for (t, fx) in samples if start_sec <= t <= end_sec and fx is not None]
        
        if faces_in_seg:
            median_x = float(np.median(faces_in_seg))
            # Convert to percentage 0-100%
            pct = round((median_x / src_w) * 100.0, 1)
            pct = max(10.0, min(90.0, pct))
            s['cropX'] = pct
            s['cropPosition'] = 'left' if pct < 35 else ('right' if pct > 65 else 'center')
            s['aiFramingDetected'] = True
        else:
            # If no face detected in this segment, default to center
            if s.get('cropX') is None:
                s['cropX'] = 50.0
                s['cropPosition'] = 'center'
                s['aiFramingDetected'] = False
                
        updated_segments.append(s)
        
    return updated_segments

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--video', required=True, help="Input video path")
    parser.add_argument('--segments', required=True, help="Path to input segments JSON")
    parser.add_argument('--output', required=True, help="Path to write output segments JSON")
    parser.add_argument('--model', default=None, help="Path to YuNet onnx model")
    args = parser.parse_args()
    
    with open(args.segments, 'r', encoding='utf-8') as f:
        segs = json.load(f)
        
    results = scan_episode_segments(args.video, segs, args.model)
    
    with open(args.output, 'w', encoding='utf-8') as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
        
    print(f"[SmartReframeService] Successfully analyzed {len(results)} segments.")

