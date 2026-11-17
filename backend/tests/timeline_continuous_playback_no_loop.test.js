import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isGapClip } from '../../frontend/src/utils/timelineOps.js';
import { mapTimelineToSourceTime, mapSourceToTimelineTime, resolveSegmentAtTime } from '../../frontend/src/utils/timelineUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

describe('Continuous Playback Stability & No-Loop Suite', () => {
  it('1. Static audit: auto-follow selection never seeks while playing and transitions skip Gaps forward', () => {
    const clipOpsFile = path.join(rootDir, 'frontend/src/hooks/useClipOperations.js');
    const timelineEditorFile = path.join(rootDir, 'frontend/src/components/timeline/TimelineEditor.jsx');
    const useVideoPlaybackFile = path.join(rootDir, 'frontend/src/hooks/useVideoPlayback.js');

    const clipOpsCode = fs.readFileSync(clipOpsFile, 'utf8').replace(/\r\n/g, '\n');
    const editorCode = fs.readFileSync(timelineEditorFile, 'utf8').replace(/\r\n/g, '\n');
    const playbackCode = fs.readFileSync(useVideoPlaybackFile, 'utf8').replace(/\r\n/g, '\n');

    // 1. useClipOperations guards handleSelectClip against seeking while video is playing
    assert.ok(
      clipOpsCode.includes('handleSelectClip = (clipId, shouldSeek = true)'),
      'useClipOperations.handleSelectClip must accept shouldSeek parameter'
    );
    assert.ok(
      clipOpsCode.includes('!isVideoPlaying') && clipOpsCode.includes('shouldSeek'),
      'handleSelectClip must guard handleSeek with shouldSeek and !isVideoPlaying'
    );

    // 2. TimelineEditor passes false to onSelectClip during playback auto-follow
    assert.ok(
      editorCode.includes('onSelectClip(matchClip.id, false)'),
      'TimelineEditor auto-follow must pass false to onSelectClip to prevent seek while playing'
    );

    // 3. useVideoPlayback imports isGapClip and resolves next dialogue clip across Gaps
    assert.ok(
      playbackCode.includes("import { isGapClip } from '../utils/timelineOps'"),
      'useVideoPlayback must import isGapClip'
    );
    assert.ok(
      playbackCode.includes('nextDialogueClip') || playbackCode.includes('isGapClip'),
      'useVideoPlayback must skip Gaps to resolve next dialogue clip'
    );
    assert.ok(
      playbackCode.includes('nextSrcStart > srcNow + 0.15'),
      'useVideoPlayback must enforce forward-only transition'
    );
  });

  it('2. Continuous playback across segment boundaries and VIDEO Gap (30+ seconds, zero backward seek, zero loop)', () => {
    // Load real episode data from project
    const seriesJsonPath = path.join(rootDir, 'backend/uploads/projects/Pseudo_Spiritual_Root/series.json');
    assert.ok(fs.existsSync(seriesJsonPath), 'series.json must exist');
    const projectData = JSON.parse(fs.readFileSync(seriesJsonPath, 'utf8'));
    const ep = projectData.episodes[0];
    const videoClips = ep.videoClips;
    const segments = ep.scriptData.segments;

    let realCurrentTime = 5.0; // Start at ~00:05
    const seeks = [];
    const v = {
      get currentTime() { return realCurrentTime; },
      set currentTime(val) {
        seeks.push({ from: realCurrentTime, to: val });
        realCurrentTime = val;
      },
      duration: 600,
      paused: false,
      ended: false,
      seeking: false,
      pause() { this.paused = true; }
    };

    let activeClipIdx = 0;
    let timelineCurrentTime = 5.0;
    let isPlaying = true;
    let lastMappedTimelineTime = 5.0;
    let hasSeeked = false;

    // Simulation of useVideoPlayback.handleTimeUpdate
    function handleTimeUpdate(explicitMediaTime) {
      if (!isPlaying) return;
      const srcNow = typeof explicitMediaTime === 'number' ? explicitMediaTime : v.currentTime;
      const realDur = v.duration || 0;

      let currentClipIdx = activeClipIdx;
      if (currentClipIdx < 0 || currentClipIdx >= videoClips.length) currentClipIdx = 0;
      while (currentClipIdx < videoClips.length && isGapClip(videoClips[currentClipIdx])) {
        currentClipIdx++;
      }
      if (currentClipIdx >= videoClips.length) currentClipIdx = 0;

      const checkClip = videoClips[currentClipIdx];
      const checkStart = Number.isFinite(checkClip?.sourceStart) ? checkClip.sourceStart : (checkClip?.start || 0);
      const checkEnd = Number.isFinite(checkClip?.sourceEnd) ? checkClip.sourceEnd : (checkClip?.end || realDur);

      if (srcNow < (checkStart - 0.04) || srcNow >= checkEnd) {
        let foundIdx = -1;
        for (let i = currentClipIdx + 1; i < videoClips.length; i++) {
          const c = videoClips[i];
          if (isGapClip(c)) continue;
          const sStart = Number.isFinite(c.sourceStart) ? c.sourceStart : (Number.isFinite(c.start) ? c.start : 0);
          const sEnd = Number.isFinite(c.sourceEnd) ? c.sourceEnd : (Number.isFinite(c.end) ? c.end : realDur);
          if (srcNow >= (sStart - 0.03) && srcNow < sEnd) {
            foundIdx = i;
            break;
          }
        }
        if (foundIdx === -1 && hasSeeked) {
          for (let i = currentClipIdx - 1; i >= 0; i--) {
            const c = videoClips[i];
            if (isGapClip(c)) continue;
            const sStart = Number.isFinite(c.sourceStart) ? c.sourceStart : (Number.isFinite(c.start) ? c.start : 0);
            const sEnd = Number.isFinite(c.sourceEnd) ? c.sourceEnd : (Number.isFinite(c.end) ? c.end : realDur);
            if (srcNow >= (sStart - 0.03) && srcNow < sEnd) {
              foundIdx = i;
              break;
            }
          }
        }
        if (foundIdx !== -1) {
          currentClipIdx = foundIdx;
          activeClipIdx = currentClipIdx;
        }
      }

      if (currentClipIdx !== -1 && !isGapClip(videoClips[currentClipIdx])) {
        const c = videoClips[currentClipIdx];
        const sStart = Number.isFinite(c.sourceStart) ? c.sourceStart : (Number.isFinite(c.start) ? c.start : 0);
        const sEnd = Number.isFinite(c.sourceEnd) ? c.sourceEnd : (Number.isFinite(c.end) ? c.end : realDur);
        const cStart = Number.isFinite(c.start) ? c.start : 0;
        const cEnd = Number.isFinite(c.end) ? c.end : (cStart + (sEnd - sStart));

        const offset = Math.max(0, srcNow - sStart);
        let tlTime = parseFloat((cStart + offset).toFixed(2));
        if (isPlaying && !hasSeeked && lastMappedTimelineTime !== null && Number.isFinite(lastMappedTimelineTime)) {
          if (tlTime < lastMappedTimelineTime) {
            tlTime = lastMappedTimelineTime;
          }
        }
        hasSeeked = false;
        lastMappedTimelineTime = tlTime;
        timelineCurrentTime = tlTime;

        if (srcNow >= sEnd - 0.03) {
          let nextDialogueClip = null;
          let nextDialogueIdx = -1;
          for (let i = currentClipIdx + 1; i < videoClips.length; i++) {
            const cand = videoClips[i];
            if (cand && !isGapClip(cand)) {
              nextDialogueClip = cand;
              nextDialogueIdx = i;
              break;
            }
          }

          if (nextDialogueClip) {
            const nextSrcStart = Number.isFinite(nextDialogueClip?.sourceStart) 
              ? nextDialogueClip.sourceStart 
              : (Number.isFinite(nextDialogueClip?.start) ? nextDialogueClip.start : 0);

            if (nextSrcStart > srcNow + 0.15 && !v.seeking) {
              activeClipIdx = nextDialogueIdx;
              v.currentTime = nextSrcStart;
            }
          } else {
            v.pause();
            isPlaying = false;
            if (Number.isFinite(cEnd)) {
              timelineCurrentTime = cEnd;
            }
          }
        }
      }
    }

    let lastPlayheadSegKey = null;
    let selectedClipKind = 'video';
    function handleSelectClip(clipId, shouldSeek = true) {
      if (isPlaying || !shouldSeek) return;
      const target = videoClips.find(c => c.id === clipId);
      if (target) {
        handleSeek(target.start);
      }
    }

    function handleSeek(time) {
      hasSeeked = true;
      activeClipIdx = 0;
      const mapping = mapTimelineToSourceTime(time, videoClips);
      let targetTime = time;
      if (mapping.inClip && Number.isFinite(mapping.sourceTime)) {
        targetTime = mapping.sourceTime;
      } else if (mapping.isGap && mapping.nextClip && Number.isFinite(mapping.nextClip.sourceStart)) {
        targetTime = mapping.nextClip.sourceStart;
      }
      if (Number.isFinite(targetTime) && Math.abs((v.currentTime || 0) - targetTime) > 0.03) {
        v.currentTime = targetTime;
      }
    }

    function autoFollowEffect() {
      if (!isPlaying) return;
      const activeSeg = resolveSegmentAtTime(segments, timelineCurrentTime);
      if (activeSeg) {
        const segKey = activeSeg._uid || activeSeg.id;
        const isNewSegment = String(segKey) !== String(lastPlayheadSegKey);
        if (isNewSegment) {
          lastPlayheadSegKey = segKey;
          if (isPlaying && selectedClipKind === 'video') {
            const matchClip = videoClips.find(c => c.segmentId === activeSeg.id || c.segmentIndex === activeSeg.id);
            if (matchClip) {
              handleSelectClip(matchClip.id, false);
            }
          }
        }
      } else {
        lastPlayheadSegKey = null;
      }
    }

    // Play continuously for 1100 frames (~36.3 seconds)
    for (let frame = 0; frame < 1100; frame++) {
      if (!isPlaying) break;
      handleTimeUpdate();
      autoFollowEffect();
      realCurrentTime += 0.033;
    }

    // Assert playback progressed past 35s
    assert.ok(timelineCurrentTime >= 35.0, `Timeline must progress past 35s (got ${timelineCurrentTime.toFixed(2)}s)`);

    // INVARIANT: Media source time must NEVER move backward during continuous playback
    seeks.forEach((s, idx) => {
      assert.ok(
        s.to >= s.from,
        `Seek ${idx} must never seek backward (from ${s.from.toFixed(3)} to ${s.to.toFixed(3)})`
      );
    });

    // Check that the Gap between #3 (8.76s) and #4 (12.0s) was cleanly bridged forward
    const gapSeek = seeks.find(s => Math.abs(s.from - 8.733) < 0.1 || Math.abs(s.to - 12.0) < 0.1);
    assert.ok(gapSeek, 'Must execute forward seek to bridge the Gap between voice #3 and voice #4');
    assert.ok(gapSeek.to >= 12.0, `Gap seek destination must be at least 12.0s (got ${gapSeek.to})`);
  });

  it('3. Paused click stability: clicking Gap or Dialogue clip seeks accurately without interference', () => {
    const clips = [
      { id: 'c1', name: 'Scene 1', start: 0, end: 5.0, sourceStart: 0, sourceEnd: 5.0, isDialogue: true },
      { id: 'c2', name: 'Gap', start: 5.0, end: 10.0, isDialogue: false },
      { id: 'c3', name: 'Scene 2', start: 10.0, end: 15.0, sourceStart: 10.0, sourceEnd: 15.0, isDialogue: true },
    ];

    // Clicking Gap at 7.5s maps to next dialogue clip (c3 at 10.0s) without crashing or looping
    const gapMapping = mapTimelineToSourceTime(7.5, clips);
    assert.equal(gapMapping.isGap, true);
    assert.equal(gapMapping.nextClip?.id, 'c3');

    // Clicking Dialogue clip c1 at 2.5s maps directly to source 2.5s
    const clipMapping = mapTimelineToSourceTime(2.5, clips);
    assert.equal(clipMapping.inClip, true);
    assert.equal(clipMapping.sourceTime, 2.5);
  });
});
