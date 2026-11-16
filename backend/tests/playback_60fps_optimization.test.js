const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

describe('60FPS Smooth Video Playback & Zero-Stutter Optimization Suite', () => {
  test('1. Backend Media Streamer caps open-ended video range to 3MB chunks', () => {
    const mediaStreamFile = path.resolve(__dirname, '../middleware/mediaStream.js');
    const content = fs.readFileSync(mediaStreamFile, 'utf8');

    assert.ok(content.includes('CHUNK_SIZE'), 'mediaStream.js must define CHUNK_SIZE for video streaming');
    assert.ok(content.includes('Math.min(start + CHUNK_SIZE - 1, fileSize - 1)'), 'mediaStream.js must cap open-ended video range to chunk size');
    assert.ok(content.includes('isVideo'), 'mediaStream.js must check isVideo file extension');
  });

  test('2. VideoPlayerPreview disables CPU-heavy decodeAudioData during active video playback', () => {
    const playerFile = path.resolve(__dirname, '../../frontend/src/components/player/VideoPlayerPreview.jsx');
    const content = fs.readFileSync(playerFile, 'utf8');

    assert.ok(content.includes('isPlayingRef.current'), 'VideoPlayerPreview must track isPlayingRef');
    assert.ok(content.includes('if (isPlayingRef.current) return;'), 'probeUrlLeadingSilence must return early during active playback');
    assert.ok(content.includes('if (s > (now + 5)) break;'), 'syncSegmentAudiosAtTime must break early on sorted segments');
  });

  test('3. TimelineEditor auto-follows active dialogue segment and syncs Inspector during playback', () => {
    const timelineFile = path.resolve(__dirname, '../../frontend/src/components/timeline/TimelineEditor.jsx');
    const content = fs.readFileSync(timelineFile, 'utf8');

    assert.ok(content.includes('resolveSegmentAtTime(scriptSegments, currentTime)'), 'TimelineEditor must resolve active segment at currentTime');
    assert.ok(content.includes('setSelectedAudioId(segKey)'), 'TimelineEditor must update selectedAudioId to highlight active clip');
    assert.ok(content.includes('onSelectSegment(segKey)'), 'TimelineEditor must call onSelectSegment to sync Inspector in real time');
  });

  test('4. TimelineTracksCanvas implements 8s buffer and 2s hysteresis for zero pop-in during scrolling', () => {
    const canvasFile = path.resolve(__dirname, '../../frontend/src/components/timeline/TimelineTracksCanvas.jsx');
    const content = fs.readFileSync(canvasFile, 'utf8');

    assert.ok(content.includes('Math.max(8.0,'), 'TimelineTracksCanvas must provide at least 8.0s viewport buffer');
    assert.ok(content.includes('Math.abs(prev.start - start) < 2.0'), 'TimelineTracksCanvas must provide 2.0s hysteresis');
  });
});
