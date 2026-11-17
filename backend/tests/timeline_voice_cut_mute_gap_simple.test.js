const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

test('Timeline Feature: Auto-Cut by Subs cuts only (never mutes) and Mute Voice Cuts feature is completely removed', async () => {
  const timelineUtilsPath = path.resolve(__dirname, '../../frontend/src/utils/timelineUtils.js');
  const utilsContent = fs.readFileSync(timelineUtilsPath, 'utf8');

  // 1. Verify autoSplitVideoBySegments sets isMuted: false on gap clips, dialogue cuts, and outro
  assert.match(
    utilsContent,
    /name:\s*['"]Gap['"][\s\S]*?isDialogue:\s*false[\s\S]*?isMuted:\s*false/,
    'Gap clips must remain isMuted: false'
  );
  assert.doesNotMatch(
    utilsContent,
    /isMuted:\s*Boolean\(it\.hasVoice\)/,
    'autoSplitVideoBySegments must NOT auto-mute dialogue cuts'
  );

  // 2. Runtime check: Auto-Cut by Subs on a multi-segment episode with real voice audio mutes ZERO clips
  const { autoSplitVideoBySegments } = await import(pathToFileURL(timelineUtilsPath).href);
  const sampleSegments = [
    {
      id: 1,
      startSec: 2.0,
      endSec: 5.0,
      audioStartSec: 2.0,
      audioEndSec: 5.0,
      audioUrl: '/uploads/tts/seg_1.mp3',
      audioDurationSec: 2.8,
      speaker: 'តួប្រុស',
      khmer: 'សួស្តី!',
    },
    {
      id: 2,
      startSec: 8.0,
      endSec: 11.5,
      audioStartSec: 8.0,
      audioEndSec: 11.5,
      audioPath: '/uploads/tts/seg_2.mp3',
      audioDurationSec: 3.1,
      speaker: 'តួស្រី',
      khmer: 'ចាស សួស្តី!',
    },
    {
      id: 3,
      startSec: 11.5,
      endSec: 14.0,
      speaker: 'តួប្រុស',
      khmer: 'គ្មានសំឡេងនៅឡើយ',
    },
  ];
  const cutClips = autoSplitVideoBySegments(sampleSegments, 18.0, 'ep_test.mp4');
  assert.equal(cutClips.length, 6, 'Expected Opening Gap + 3 dialogue cuts + middle Gap + Outro');
  assert.equal(cutClips.filter((c) => c.isDialogue).length, 3, 'Must produce 3 dialogue cuts');
  assert.equal(cutClips.filter((c) => c.isMuted).length, 0, 'Auto-Cut must NOT mute any clip');
  assert.ok(cutClips.every((c) => c.isMuted === false), 'Every generated clip must have isMuted === false');

  // 3. Verify Mute Voice Cuts button, props, and handlers are completely removed
  const filesWithoutMuteAllCuts = [
    'frontend/src/components/timeline/TimelineToolbar.jsx',
    'frontend/src/components/timeline/TimelineTrackHeaders.jsx',
    'frontend/src/components/timeline/TimelineEditor.jsx',
    'frontend/src/components/voice/ClipInspectorPanel.jsx',
    'frontend/src/components/voice/VoiceSettings.jsx',
    'frontend/src/hooks/useClipOperations.js',
    'frontend/src/App.jsx',
  ];
  for (const rel of filesWithoutMuteAllCuts) {
    const content = fs.readFileSync(path.resolve(__dirname, '../..', rel), 'utf8');
    assert.doesNotMatch(content, /Mute Voice Cuts/, `${rel} must not contain Mute Voice Cuts`);
    assert.doesNotMatch(content, /onToggleMuteAllCuts|handleToggleMuteAllCuts/, `${rel} must not contain MuteAllCuts wiring`);
  }

  // 4. Verify per-clip mute (clip.isMuted) and track mute remain intact
  const previewPath = path.resolve(__dirname, '../../frontend/src/components/player/VideoPlayerPreview.jsx');
  const previewContent = fs.readFileSync(previewPath, 'utf8');
  assert.match(previewContent, /isCurrentVideoClipMuted/, 'VideoPlayerPreview must preserve per-clip mute');
  assert.match(previewContent, /!seg\.muted && !seg\.isMuted && hasAudio/, 'speakingIntervals must check segment audio');
  assert.match(previewContent, /duckVal === 0/, 'VideoPlayerPreview must preserve 0% ducking');

  const canvasPath = path.resolve(__dirname, '../../frontend/src/components/timeline/TimelineTracksCanvas.jsx');
  const canvasContent = fs.readFileSync(canvasPath, 'utf8');
  assert.match(canvasContent, /clip-mini-muted-badge/, 'TimelineTracksCanvas must preserve per-clip mute indicator');
  assert.match(canvasContent, /is-clip-muted/, 'TimelineTracksCanvas must preserve per-clip is-clip-muted class');

  const hooksContent = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/hooks/useClipOperations.js'), 'utf8');
  assert.match(hooksContent, /handleToggleMuteVideoClip/, 'Per-clip mute handler must remain intact');

  const headerPath = path.resolve(__dirname, '../../frontend/src/components/timeline/TimelineTrackHeaders.jsx');
  const headerContent = fs.readFileSync(headerPath, 'utf8');
  assert.doesNotMatch(headerContent, /areAllCutsMuted/, 'Track Header must not carry dormant areAllCutsMuted logic');
  assert.match(headerContent, /setMutedTracks/, 'Track Header must preserve track-level mute/unmute');
});
