"""Exercise the production decoder and dedup decision with tiny Chinese glyphs."""
import sys
import tempfile
from pathlib import Path

try:
    import cv2
    import numpy as np
except ImportError:
    sys.exit(77)

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "workers"))
from local_chinese_ocr_worker import process_frames_batch


def recognize(roi, **kwargs):
    # Stand in for the model at the inference boundary only.
    if not roi[16, 20, 0]:
        return None, []
    line = "\u4e00" if not roi[34, 20, 0] else "\u4e00\u4e8c"
    return [([[16, 15], [34, 15], [34, 18], [16, 18]], line, 0.99)], []


with tempfile.TemporaryDirectory() as temp:
    empty = np.zeros((128, 512, 3), dtype=np.uint8)
    one = empty.copy()
    one[15:18, 16:35] = 255
    one_two = one.copy()
    one_two[33:35, 19:32] = 255
    one_two[39:41, 16:35] = 255
    for name, image in (("empty", empty), ("one", one), ("two", one_two)):
        assert cv2.imwrite(str(Path(temp, name + ".png")), image)

    frames = []

    def add(image, cue, **flags):
        frames.append(dict(filePath=str(Path(temp, image + ".png")), cueIndex=cue,
                           timestampSec=len(frames) / 10, **flags))

    add("empty", 1)
    add("one", 1)                  # Late subtitle onset
    add("two", 1)                  # New strokes outside previous bounding box
    add("two", 1)                  # Pixel-identical positive control
    add("two", 2)                  # Cue boundary
    add("two", 2, isShortCue=True)
    add("two", 2, sceneCut=True)
    add("two", 2)                  # Previous frame marked as a cut
    add("two", -1)
    add("two", -1)
    add("two", None)
    add("two", None)
    results, metrics = process_frames_batch(frames, recognize, None, 0, 1, 0, 1)
    assert [r["textZh"] for r in results[:4]] == ["", "\u4e00", "\u4e00\u4e8c", "\u4e00\u4e8c"]
    assert [i for i, r in enumerate(results) if r["isDeduped"]] == [3]
    assert [r["timestampSec"] for r in results] == [f["timestampSec"] for f in frames]
    assert metrics["actualOcrFrames"] == len(frames) - 1
    assert metrics["dedupedFrames"] == 1
    assert metrics["imageDecodeMs"] > 0 and metrics["inferenceMs"] > 0
