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

describe('Continuous Playback Stability & Play-Through Gaps Suite', () => {
  it('1. Static audit: auto-follow never seeks while playing, Gaps are playable spans, and transitions are forward-only', () => {
    const clipOpsFile = path.join(rootDir, 'frontend/src/hooks/useClipOperations.js');
    const timelineEditorFile = path.join(rootDir, 'frontend/src/components/timeline/TimelineEditor.jsx');
    const useVideoPlaybackFile = path.join(rootDir, 'frontend/src/hooks/useVideoPlayback.js');
    const timelineUtilsFile = path.join(rootDir, 'frontend/src/utils/timelineUtils.js');

    const clipOpsCode = fs.readFileSync(clipOpsFile, 'utf8').replace(/\r\n/g, '\n');
    const editorCode = fs.readFileSync(timelineEditorFile, 'utf8').replace(/\r\n/g, '\n');
    const playbackCode = fs.readFileSync(useVideoPlaybackFile, 'utf8').replace(/\r\n/g, '\n');
    const utilsCode = fs.readFileSync(timelineUtilsFile, 'utf8').replace(/\r\n/g, '\n');

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

    // 3. useVideoPlayback treats Gap clips as playable spans (does NOT skip Gaps) and enforces forward-only seeks
    assert.ok(
      !playbackCode.includes('if (isGapClip(c)) continue'),
      'useVideoPlayback must NOT skip Gap clips during active-clip tracking'
    );
    assert.ok(
      !playbackCode.includes('nextDialogueClip'),
      'useVideoPlayback must transition to nextClip (including Gaps), not skip past Gaps to nextDialogueClip'
    );
    assert.ok(
      playbackCode.includes('nextSrcStart > srcNow + 0.15'),
      'useVideoPlayback must enforce forward-only transition'
    );

    // 4. timelineUtils maps Gap clips to their real source ranges
    assert.ok(
      !utilsCode.includes('if (isGapClip(c)) continue'),
      'mapTimelineToSourceTime must include Gap clips'
    );
  });

  it('2. Continuous playback from 00:00 plays THROUGH Gaps (#3 -> Gap -> #4) with zero backward seeks and no loop', () => {
    const seriesJsonPath = path.join(rootDir, 'backend/uploads/projects/Pseudo_Spiritual_Root/series.json');
    assert.ok(fs.existsSync(seriesJsonPath), 'series.json must exist');
    const projectData = JSON.parse(fs.readFileSync(seriesJsonPath, 'utf8'));
    const ep = projectData.episodes[0];
    const videoClips = ep.videoClips;
    const segments = ep.scriptData.segments;

    // Identify the middle Gap between #3 and #4
    const middleGap = videoClips.find((c) => isGapClip(c) && c.start >= 7.0 && c.end <= 14.0);
    assert.ok(middleGap, 'Episode must contain a Gap clip between dialogue #3 and #4');
    const middleGapDur = middleGap.end - middleGap.start;

    let realCurrentTime = 0.0;
    const seeks = [];
    const visitedTimes = [];
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
    let timelineCurrentTime = 0.0;
    let isPlaying = true;
    let lastMappedTimelineTime = 0.0;
    let hasSeeked = false;

    // Mirror of useVideoPlayback.handleTimeUpdate (Gap-inclusive, forward-only)
    function handleTimeUpdate(explicitMediaTime) {
      if (!isPlaying) return;
      const srcNow = typeof explicitMediaTime === 'number' ? explicitMediaTime : v.currentTime;
      const realDur = v.duration || 0;

      let currentClipIdx = activeClipIdx;
      if (currentClipIdx < 0 || currentClipIdx >= videoClips.length) currentClipIdx = 0;

      const checkClip = videoClips[currentClipIdx];
      const checkStart = Number.isFinite(checkClip?.sourceStart) ? checkClip.sourceStart : (checkClip?.start || 0);
      const checkEnd = Number.isFinite(checkClip?.sourceEnd) ? checkClip.sourceEnd : (checkClip?.end || realDur);

      if (srcNow < (checkStart - 0.04) || srcNow >= checkEnd) {
        let foundIdx = -1;
        for (let i = currentClipIdx + 1; i < videoClips.length; i++) {
          const c = videoClips[i];
          if (!c) continue;
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
            if (!c) continue;
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

      if (currentClipIdx !== -1 && videoClips[currentClipIdx]) {
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
        visitedTimes.push(tlTime);

        if (srcNow >= sEnd - 0.03) {
          const nextClipIdx = currentClipIdx + 1;
          const nextClip = nextClipIdx < videoClips.length ? videoClips[nextClipIdx] : null;

          if (nextClip) {
            const nextSrcStart = Number.isFinite(nextClip.sourceStart)
              ? nextClip.sourceStart
              : (Number.isFinite(nextClip.start) ? nextClip.start : 0);

            if (nextSrcStart > srcNow + 0.15 && !v.seeking) {
              activeClipIdx = nextClipIdx;
              v.currentTime = nextSrcStart;
            } else if (nextSrcStart >= srcNow - 0.15) {
              activeClipIdx = nextClipIdx;
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

    // Play continuously from 00:00 for 1200 frames (~39.6 seconds)
    for (let frame = 0; frame < 1200; frame++) {
      if (!isPlaying) break;
      handleTimeUpdate();
      autoFollowEffect();
      realCurrentTime += 0.033;
    }

    // Assert playback progressed past 35s without looping
    assert.ok(timelineCurrentTime >= 35.0, `Timeline must progress past 35s (got ${timelineCurrentTime.toFixed(2)}s)`);

    // INVARIANT: Media source time must NEVER move backward during continuous playback
    seeks.forEach((s, idx) => {
      assert.ok(
        s.to >= s.from,
        `Seek ${idx} must never seek backward (from ${s.from.toFixed(3)} to ${s.to.toFixed(3)})`
      );
    });

    // Playback MUST spend time playing THROUGH the middle Gap (not bridge-skip over it)
    const framesInsideMiddleGap = visitedTimes.filter(
      (t) => t > middleGap.start + 0.05 && t < middleGap.end - 0.05
    );
    const expectedMinFrames = Math.floor((middleGapDur - 0.2) / 0.033);
    assert.ok(
      framesInsideMiddleGap.length >= expectedMinFrames,
      `Playback must spend the Gap's duration (${middleGapDur.toFixed(2)}s) playing through it, got ${framesInsideMiddleGap.length} frames (expected >= ${expectedMinFrames})`
    );

    // No seek should jump over the middle Gap straight to #4
    const skipOverGapSeek = seeks.find((s) => s.from <= middleGap.start + 0.1 && s.to >= middleGap.end - 0.05);
    assert.equal(skipOverGapSeek, undefined, 'Playback must NOT bridge-skip over the Gap straight to #4');
  });

  it('3. Forward seek into non-contiguous Gap plays through Gap then pauses cleanly at timeline end', () => {
    // Non-contiguous source ranges: #3 ends at source 8.76s, Gap carries source 9.6..12.0s, #4 is 12.0..14.0s
    const clips = [
      { id: 'c3', name: '#3', start: 0, end: 1.36, sourceStart: 7.4, sourceEnd: 8.76, isDialogue: true },
      { id: 'gap-mid', name: 'Gap', start: 1.36, end: 3.76, sourceStart: 9.6, sourceEnd: 12.0, isDialogue: false },
      { id: 'c4', name: '#4', start: 3.76, end: 5.76, sourceStart: 12.0, sourceEnd: 14.0, isDialogue: true },
    ];

    let realCurrentTime = 7.4;
    const seeks = [];
    const visitedTl = [];
    let isPlaying = true;
    let paused = false;
    let activeClipIdx = 0;
    let lastTl = 0;

    for (let frame = 0; frame < 300 && isPlaying; frame++) {
      const srcNow = realCurrentTime;
      const c = clips[activeClipIdx];
      const tlTime = parseFloat((c.start + Math.max(0, srcNow - c.sourceStart)).toFixed(2));
      assert.ok(tlTime >= lastTl, `Monotonic timeline time violated: ${tlTime} < ${lastTl}`);
      lastTl = tlTime;
      visitedTl.push(tlTime);

      if (srcNow >= c.sourceEnd - 0.03) {
        const nextIdx = activeClipIdx + 1;
        const nextClip = nextIdx < clips.length ? clips[nextIdx] : null;
        if (nextClip) {
          if (nextClip.sourceStart > srcNow + 0.15) {
            seeks.push({ from: srcNow, to: nextClip.sourceStart });
            activeClipIdx = nextIdx;
            realCurrentTime = nextClip.sourceStart;
            continue;
          } else if (nextClip.sourceStart >= srcNow - 0.15) {
            activeClipIdx = nextIdx;
          }
        } else {
          paused = true;
          isPlaying = false;
          lastTl = c.end;
          break;
        }
      }
      realCurrentTime += 0.033;
    }

    // Must seek forward to Gap's sourceStart (9.6s), play through Gap (1.36..3.76s), play #4 (3.76..5.76s), then pause cleanly
    assert.equal(seeks.length, 1, 'Exactly one forward seek needed (from #3 sourceEnd 8.76 to Gap sourceStart 9.6)');
    assert.equal(seeks[0].to, 9.6, 'Forward seek must land on Gap sourceStart (9.6s), not skip past Gap to 12.0s');
    const gapFrames = visitedTl.filter((t) => t > 1.4 && t < 3.7);
    assert.ok(gapFrames.length >= 65, `Must play through full 2.4s Gap (got ${gapFrames.length} frames)`);
    assert.equal(paused, true, 'Playback must pause cleanly at the end');
    assert.equal(lastTl, 5.76, 'Playhead must stop at end of final clip (5.76s)');
  });

  it('4. Paused click-seek into Gap maps to real Gap source footage (no skipping)', () => {
    const clips = [
      { id: 'c1', name: 'Scene 1', start: 0, end: 5.0, sourceStart: 0, sourceEnd: 5.0, isDialogue: true },
      { id: 'c2', name: 'Gap', start: 5.0, end: 10.0, sourceStart: 5.0, sourceEnd: 10.0, isDialogue: false },
      { id: 'c3', name: 'Scene 2', start: 10.0, end: 15.0, sourceStart: 10.0, sourceEnd: 15.0, isDialogue: true },
    ];

    // Clicking Gap at 7.5s maps directly to Gap's real source time (7.5s) so preview shows Gap footage
    const gapMapping = mapTimelineToSourceTime(7.5, clips);
    assert.equal(gapMapping.inClip, true);
    assert.equal(gapMapping.isGap, true);
    assert.equal(gapMapping.clip?.id, 'c2');
    assert.equal(gapMapping.sourceTime, 7.5);
    assert.equal(mapSourceToTimelineTime(7.5, clips, 1), 7.5);

    // Clicking Dialogue clip c1 at 2.5s maps directly to source 2.5s
    const clipMapping = mapTimelineToSourceTime(2.5, clips);
    assert.equal(clipMapping.inClip, true);
    assert.equal(clipMapping.isGap, false);
    assert.equal(clipMapping.sourceTime, 2.5);
  });
});
