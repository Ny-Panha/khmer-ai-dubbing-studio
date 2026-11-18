import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveVoiceDragScrubTime } from '../../frontend/src/utils/timelineUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

describe('Voice Clip Move Drag Live Playhead & Preview Scrubbing Suite', () => {
  it('1. resolveVoiceDragScrubTime enables live scrub ONLY for paused voice-clip MOVE drags', () => {
    // Allowed: paused voice-clip move drag
    assert.equal(
      resolveVoiceDragScrubTime({ itemType: 'audio', mode: 'move', isPlaying: false, dragStartSec: 3.4567, totalDuration: 600 }),
      3.457
    );
    assert.equal(
      resolveVoiceDragScrubTime({ itemType: 'audio', mode: 'move', isPlaying: false, dragStartSec: -1.5, totalDuration: 600 }),
      0
    );
    assert.equal(
      resolveVoiceDragScrubTime({ itemType: 'audio', mode: 'move', isPlaying: false, dragStartSec: 650, totalDuration: 600 }),
      600
    );

    // Suppressed: active playback (must never fight playback or auto-follow)
    assert.equal(
      resolveVoiceDragScrubTime({ itemType: 'audio', mode: 'move', isPlaying: true, dragStartSec: 3.45, totalDuration: 600 }),
      null
    );

    // Suppressed: trim drags
    assert.equal(
      resolveVoiceDragScrubTime({ itemType: 'audio', mode: 'trim-left', isPlaying: false, dragStartSec: 3.45, totalDuration: 600 }),
      null
    );
    assert.equal(
      resolveVoiceDragScrubTime({ itemType: 'audio', mode: 'trim-right', isPlaying: false, dragStartSec: 3.45, totalDuration: 600 }),
      null
    );

    // Suppressed: video-clip and subtitle-clip drags
    assert.equal(
      resolveVoiceDragScrubTime({ itemType: 'video', mode: 'move', isPlaying: false, dragStartSec: 3.45, totalDuration: 600 }),
      null
    );
    assert.equal(
      resolveVoiceDragScrubTime({ itemType: 'subtitle', mode: 'move', isPlaying: false, dragStartSec: 3.45, totalDuration: 600 }),
      null
    );
  });

  it('2. Static audit: TimelineEditor throttles voice drag scrub via RAF, leaves playhead at dropped start, and preserves frozen playback guards', () => {
    const editorCode = fs.readFileSync(path.join(rootDir, 'frontend/src/components/timeline/TimelineEditor.jsx'), 'utf8').replace(/\r\n/g, '\n');
    const playbackCode = fs.readFileSync(path.join(rootDir, 'frontend/src/hooks/useVideoPlayback.js'), 'utf8').replace(/\r\n/g, '\n');

    assert.ok(editorCode.includes('resolveVoiceDragScrubTime'), 'TimelineEditor must use resolveVoiceDragScrubTime');
    assert.ok(editorCode.includes('scheduleVoiceDragScrub(voiceScrubTime, dragState.id)'), 'Voice move drag must invoke RAF-throttled scheduleVoiceDragScrub');
    assert.ok(editorCode.includes('voiceDragSeekRafRef.current = requestAnimationFrame('), 'Voice drag seeks must be throttled to animation frames');
    assert.ok(editorCode.includes('if (isPlayingRef.current) {\n          pendingVoiceDragSeekRef.current = null;\n          return;\n        }'), 'RAF seek callback must abort if playback started');
    assert.ok(editorCode.includes('cancelVoiceDragScrub();'), 'mouseup must cancel any pending drag-scrub RAF');
    assert.ok(editorCode.includes('onSeek(droppedStart)'), 'mouseup must leave playhead at the dropped clip start');

    // Frozen playback invariants preserved
    assert.ok(editorCode.includes('if (!isPlaying) return;'), 'Auto-follow guard while paused must remain intact');
    assert.ok(playbackCode.includes('if (!isPlaying) {\n      return;\n    }'), 'Paused snap-back guard in useVideoPlayback must remain intact');
  });
});
