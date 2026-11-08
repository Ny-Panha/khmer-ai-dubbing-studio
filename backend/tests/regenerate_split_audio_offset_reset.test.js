const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { generateSingleSegmentAudio } = require('../services/ttsService');

test('Regenerate Split Segment: audioOffset and trim flags reset to 0/false', async () => {
  // Mock segment that was created from a timeline split operation
  const splitSegment = {
    id: 9999,
    khmer: 'តេស្តសំឡេងកាត់',
    startSec: 1.52,
    endSec: 5.19,
    audioStartSec: 1.52,
    audioEndSec: 5.19,
    audioOffset: 3.83, // inherited from parent split
    audioTrimmed: true,
    userTrimmed: true,
  };

  const tempOutputDir = path.resolve(__dirname, '../uploads/temp_test_audio');
  if (!fs.existsSync(tempOutputDir)) {
    fs.mkdirSync(tempOutputDir, { recursive: true });
  }

  const result = await generateSingleSegmentAudio(splitSegment, tempOutputDir, {
    forceRegen: true,
    voiceId: 'km-KH-PisethNeural',
  });

  // Verify that fresh TTS audio generation unconditionally resets offset and trim
  assert.equal(result.audioOffset, 0, 'audioOffset must reset to 0 for fresh audio');
  assert.equal(result.audioTrimmed, false, 'audioTrimmed must reset to false');
  assert.equal(result.userTrimmed, false, 'userTrimmed must reset to false');
  assert.ok(result.audioDurationSec > 0, 'audioDurationSec must be > 0');

  // Clean up generated test file
  if (result.audioPath && fs.existsSync(result.audioPath)) {
    try { fs.unlinkSync(result.audioPath); } catch (_) {}
  }
});

test('VideoPlayerPreview defensive clamp against stale audioOffset >= duration', () => {
  const computeSafeAudioOffset = (seg) => {
    const segDur = typeof seg.audioDurationSec === 'number' && seg.audioDurationSec > 0
      ? seg.audioDurationSec
      : (typeof seg.finalAudioDuration === 'number' && seg.finalAudioDuration > 0 ? seg.finalAudioDuration : 0);
    const rawOffset = (typeof seg.audioOffset === 'number' && !isNaN(seg.audioOffset)) ? seg.audioOffset : 0;
    return (segDur > 0 && rawOffset >= segDur) ? 0 : Math.max(0, rawOffset);
  };

  // Case 1: Stale offset exceeding duration (e.g. 3.83s offset in 3.67s audio)
  const staleSeg = { audioOffset: 3.83, audioDurationSec: 3.672 };
  assert.equal(computeSafeAudioOffset(staleSeg), 0, 'Stale offset >= duration must fall back to 0');

  // Case 2: Valid partial slice offset (e.g. 1.5s offset in 4.0s audio)
  const validSliceSeg = { audioOffset: 1.5, audioDurationSec: 4.0 };
  assert.equal(computeSafeAudioOffset(validSliceSeg), 1.5, 'Valid slice offset < duration must be preserved');

  // Case 3: Zero offset
  const zeroSeg = { audioOffset: 0, audioDurationSec: 3.0 };
  assert.equal(computeSafeAudioOffset(zeroSeg), 0);
});

test('series.json EP2 Segment #2 has audioOffset reset to 0', () => {
  const seriesFile = path.resolve(__dirname, '../uploads/projects/series_1793898268958/series.json');
  if (fs.existsSync(seriesFile)) {
    const meta = JSON.parse(fs.readFileSync(seriesFile, 'utf8'));
    const ep2 = meta.episodes.find(e => e.id === 'ep_2');
    if (ep2 && ep2.scriptData?.segments) {
      const seg2 = ep2.scriptData.segments.find(s => s.id === 2);
      if (seg2) {
        assert.equal(seg2.audioOffset, 0, 'EP2 Segment #2 audioOffset must be 0 in series.json');
        assert.equal(seg2.audioTrimmed, false, 'EP2 Segment #2 audioTrimmed must be false in series.json');
      }
    }
  }
});
