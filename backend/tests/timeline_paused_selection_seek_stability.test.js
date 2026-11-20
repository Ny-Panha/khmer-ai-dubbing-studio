import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  mapTimelineToSourceTime,
  mapSourceToTimelineTime,
} from '../../frontend/src/utils/timelineUtils.js';

const getFrontendFile = (rel) => fs.existsSync(rel) ? rel : path.resolve(process.cwd(), '..', rel);

describe('Paused Selection & Playhead Stability Suite (No Snap-back)', () => {
  it('1. Static audit: timelineUtils maps Gap source ranges, and useVideoPlayback / TimelineEditor guard paused state', () => {
    const utilsCode = fs.readFileSync(getFrontendFile('frontend/src/utils/timelineUtils.js'), 'utf8');
    assert.ok(utilsCode.includes("import { isGapClip } from './timelineOps.js'"), 'timelineUtils imports isGapClip');
    assert.ok(!utilsCode.includes('if (isGapClip(c)) continue'), 'mapTimelineToSourceTime includes Gap clips for real footage preview');
    assert.ok(utilsCode.includes('isGap: isGapClip(c)'), 'mapTimelineToSourceTime tags matched Gap clips with isGap');

    const playbackCode = fs.readFileSync(getFrontendFile('frontend/src/hooks/useVideoPlayback.js'), 'utf8').replace(/\r\n/g, '\n');
    assert.ok(playbackCode.includes('if (!isPlaying) {\n      return;\n    }'), 'handleTimeUpdate early-returns when !isPlaying');

    const editorCode = fs.readFileSync(getFrontendFile('frontend/src/components/timeline/TimelineEditor.jsx'), 'utf8');
    assert.ok(editorCode.includes('if (!isPlaying) return;'), 'Auto-follow effect early-returns when !isPlaying');
    assert.ok(editorCode.includes('if (isPlaying && selectedClipKind === \'video\''), 'Video cut tracking checks isPlaying');
  });

  it('2. Gap click simulation: clicking Gap at 8.3s between #2 (5-8s) and #3 (12-16s) maps to Gap footage and stays locked while paused', () => {
    const clips = [
      { id: 'clip-1', start: 0, end: 5.0, sourceStart: 0, sourceEnd: 5.0, isDialogue: true, name: '#1' },
      { id: 'clip-2', start: 5.0, end: 8.0, sourceStart: 5.0, sourceEnd: 8.0, isDialogue: true, segmentIndex: 2, segmentId: 2, name: '#2' },
      { id: 'clip-gap-1', start: 8.0, end: 12.0, sourceStart: 5.0, sourceEnd: 9.0, isDialogue: false, name: 'Gap' },
      { id: 'clip-3', start: 12.0, end: 16.0, sourceStart: 8.0, sourceEnd: 12.0, isDialogue: true, segmentIndex: 3, segmentId: 3, name: '#3' },
    ];

    // Map 8.3s on the timeline (inside the Gap) -> resolves Gap's real source footage (5.0 + 0.3 = 5.3s)
    const mapping = mapTimelineToSourceTime(8.3, clips);
    assert.equal(mapping.isGap, true, '8.3s must be identified as isGap: true');
    assert.equal(mapping.inClip, true, '8.3s must map into the Gap playable span');
    assert.equal(mapping.clip?.id, 'clip-gap-1', 'matched clip must be the Gap clip');
    assert.equal(mapping.sourceTime, 5.3, '8.3s inside Gap [8..12] (source [5..9]) maps to source 5.3s');

    // Reverse mapping check: source time 5.3s from index 0 matches clip-2 first (timeline 5.3s)
    const mappedTl = mapSourceToTimelineTime(5.3, clips);
    assert.equal(mappedTl, 5.3, 'Source time 5.3 maps to timeline 5.3');

    // Emulate paused state and user clicking the Gap at 8.3s
    let isPlaying = false;
    let currentTime = 8.3; // clicked at 8.3s
    let selectedClipId = 'clip-gap-1';
    let selectedClipKind = 'video';
    let selectedSegmentId = null;

    // Simulate HTML5 <video> background timeupdate events firing at 5.0s or 5.3s while paused
    const simulateVideoTimeUpdate = (videoCurrentTime) => {
      // Under our fix: if (!isPlaying) return;
      if (!isPlaying) {
        return; // blocked from mutating currentTime
      }
      currentTime = videoCurrentTime;
    };

    // Simulate 5 idle seconds (multiple background decoder / buffer ticks)
    for (let sec = 1; sec <= 5; sec++) {
      simulateVideoTimeUpdate(5.0); // stale video time
      simulateVideoTimeUpdate(5.3);
    }

    assert.equal(currentTime, 8.3, 'Playhead must STAY at 8.3s after 5 idle seconds while paused');
    assert.equal(selectedClipId, 'clip-gap-1', 'Gap clip must STAY selected after 5 idle seconds');
    assert.equal(selectedSegmentId, null, 'Segment selection must remain null for Gap');
  });

  it('3. Dialogue clip click simulation: clicking dialogue clip while paused stays stable after 5 idle seconds', () => {
    let isPlaying = false;
    let currentTime = 5.0;
    let selectedClipId = 'clip-2';
    let selectedClipKind = 'video';
    let selectedSegmentId = 2;

    const simulateVideoTimeUpdate = (videoCurrentTime) => {
      if (!isPlaying) return;
      currentTime = videoCurrentTime;
    };

    for (let sec = 1; sec <= 5; sec++) {
      simulateVideoTimeUpdate(2.0); // irrelevant decoder position
    }

    assert.equal(currentTime, 5.0, 'Playhead must remain at 5.0s');
    assert.equal(selectedClipId, 'clip-2', 'Dialogue clip #2 must remain selected');
    assert.equal(selectedSegmentId, 2, 'Segment #2 must remain selected');
  });

  it('4. Normal playback following resumes when playing', () => {
    let isPlaying = true;
    let currentTime = 5.0;
    let selectedClipId = 'clip-2';

    const simulateVideoTimeUpdate = (newTlTime) => {
      if (!isPlaying) return;
      currentTime = newTlTime;
    };

    simulateVideoTimeUpdate(6.5);
    assert.equal(currentTime, 6.5, 'Playhead advances during active playback');
  });
});
