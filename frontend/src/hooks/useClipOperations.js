import { useCallback } from 'react';
import {
  splitClipAtTime,
  deleteClipById,
  deleteSegmentByIdOrIndex,
  isSegmentMatch,
  findSegmentIndex,
  findAssociatedSegmentIndices,
  autoSplitVideoBySegments,
  alignTimelineFromSegments,
  bridgeClipGaps,
  resetSegmentsToSourceTiming,
} from '../utils/timelineUtils';
import { parseTimeToSeconds, formatTimecode, formatMinSec, getSegmentAudioDuration } from '../utils/timestampUtils';
import { splitKhmerTextIntoHalves, splitSegmentIntoNaturalSentences } from '../utils/khmerTextSplitter';
import { buildSpeakerRegistry } from '../utils/speakerUtils';
import { syncTimelineAudioApi, autoFitSpeechSpeedApi, notifyBackendOffline, notifyBackendOnline } from '../services/api';

/**
 * Lightweight, non-intrusive floating in-app toast for timeline feedback (e.g. split guard)
 */
function showInAppToast(message, durationMs = 2800) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('timeline:toast', { detail: { message } }));
  }
  if (typeof document === 'undefined') return;
  let toast = document.getElementById('timeline-split-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'timeline-split-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.style.position = 'fixed';
    toast.style.bottom = '32px';
    toast.style.left = '50%';
    toast.style.transform = 'translateX(-50%) translateY(0)';
    toast.style.backgroundColor = 'rgba(24, 24, 27, 0.96)';
    toast.style.color = '#f4f4f5';
    toast.style.padding = '10px 20px';
    toast.style.borderRadius = '9999px';
    toast.style.fontSize = '13.5px';
    toast.style.fontWeight = '500';
    toast.style.fontFamily = "'Kantumruy Pro', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    toast.style.boxShadow = '0 12px 30px -4px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255, 255, 255, 0.15)';
    toast.style.backdropFilter = 'blur(12px)';
    toast.style.webkitBackdropFilter = 'blur(12px)';
    toast.style.zIndex = '99999';
    toast.style.display = 'flex';
    toast.style.alignItems = 'center';
    toast.style.gap = '8px';
    toast.style.pointerEvents = 'none';
    toast.style.transition = 'opacity 0.22s cubic-bezier(0.16, 1, 0.3, 1), transform 0.22s cubic-bezier(0.16, 1, 0.3, 1)';
    document.body.appendChild(toast);
  }
  toast.innerHTML = `<span style="font-size:15px;line-height:1;">✂️</span><span>${message}</span>`;
  toast.style.opacity = '1';
  toast.style.transform = 'translateX(-50%) translateY(0)';

  if (toast._timer) clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(8px)';
  }, durationMs);
}

/**
 * Custom hook to handle multi-clip timeline editing operations (split, cut, bridge, re-sync)
 */
export function useClipOperations({
  videoClips,
  setVideoClips,
  activeClipId,
  setActiveClipId,
  duration,
  setDuration,
  selectedVideo,
  videoRef,
  scriptData,
  setScriptData,
  speakerRegistry,
  setSpeakerRegistry,
  audioGenerated,
  selectedSegmentId,
  setSelectedSegmentId,
  handleSeek,
  pushUndoSnapshot: pushUndoSnapshotParam,
  pushHistory,
  setFullAudioUrl,
  setFullAudioPath,
  syncAudioTimeoutRef,
  seriesId = null,
  episodeId = null,
  setAudioOutdated = null,
}) {
  const pushUndoSnapshot = useCallback((...args) => {
    try {
      if (typeof pushUndoSnapshotParam === 'function') {
        return pushUndoSnapshotParam(...args);
      }
      if (typeof pushHistory === 'function') {
        return pushHistory(...args);
      }
    } catch (err) {
      console.warn('[useClipOperations] pushUndoSnapshot helper failure:', err);
    }
  }, [pushUndoSnapshotParam, pushHistory]);

  const getProjectName = () => selectedVideo?.projectName || selectedVideo?.title || selectedVideo?.name || selectedVideo?.fileName || '';
  const getVideoId = () => selectedVideo?.id || selectedVideo?.videoId || '';

  // Split Clip & Segment Tool (Scissors at Playhead)
  const handleSplitClip = (splitTime, targetId = null) => {
    const totalDur = duration > 0 ? duration : (videoRef?.current?.duration || 0);
    const targetTime = typeof splitTime === 'number' && !isNaN(splitTime) ? splitTime : 0;
    const roundedSplit = parseFloat(targetTime.toFixed(3));

    const segments = scriptData?.segments || [];
    let currentClips = videoClips;
    if (!currentClips || currentClips.length === 0 || (currentClips.length === 1 && currentClips[0].end <= currentClips[0].start)) {
      currentClips = [
        { id: `clip-${Date.now()}`, start: 0, end: totalDur, name: selectedVideo?.fileName || 'Video 1', trackRow: 0, trackId: 'video-1' }
      ];
    }

    const getSegTiming = (s) => {
      if (!s) return { sStart: 0, sEnd: 0, effectiveStart: 0, effectiveEnd: 0 };
      const isTrimmed = Boolean(s.audioTrimmed || s.userTrimmed);
      const effectiveStart = typeof s.audioStartSec === 'number' && !isNaN(s.audioStartSec)
        ? s.audioStartSec
        : (typeof s.startSec === 'number' && !isNaN(s.startSec) ? s.startSec : parseTimeToSeconds(s.start, 0));
      const slotEnd = typeof s.endSec === 'number' && !isNaN(s.endSec)
        ? s.endSec
        : parseTimeToSeconds(s.end, effectiveStart + 3.0);
      const audioDur = getSegmentAudioDuration(s, 0);

      let effectiveEnd;
      if (isTrimmed && typeof s.audioEndSec === 'number' && !isNaN(s.audioEndSec)) {
        effectiveEnd = s.audioEndSec;
      } else {
        const candidates = [effectiveStart + audioDur];
        if (typeof s.audioEndSec === 'number' && !isNaN(s.audioEndSec)) {
          candidates.push(s.audioEndSec);
        }
        effectiveEnd = Math.max(...candidates);
      }

      return {
        sStart: effectiveStart,
        sEnd: effectiveEnd,
        effectiveStart,
        effectiveEnd,
      };
    };

    const isInsideSeg = (s, allowSeamEnd = false) => {
      if (!s) return false;
      const { effectiveStart, effectiveEnd } = getSegTiming(s);
      const endLimit = allowSeamEnd ? effectiveEnd : effectiveEnd - 0.05;
      return roundedSplit > effectiveStart + 0.05 && roundedSplit < endLimit;
    };

    // Helper: Execute segment split logic (reused for (a) and (c))
    const executeSplitSegment = (splitSegIdx) => {
      const targetSeg = segments[splitSegIdx];
      const { effectiveStart, effectiveEnd } = getSegTiming(targetSeg);
      const sStart = effectiveStart;
      const sEnd = effectiveEnd;
      const dur = Math.max(0.2, sEnd - sStart);

      // Intelligent text splitting for Khmer & English
      const fullKhmer = (targetSeg.khmerTranslatedText || targetSeg.khmerText || targetSeg.khmer || '').trim();
      let [part1, part2] = splitKhmerTextIntoHalves(fullKhmer);
      if (!part2) {
        const words = fullKhmer.split(/\s+/).filter(Boolean);
        if (words.length >= 2) {
          const ratio = (roundedSplit - sStart) / Math.max(0.1, dur);
          const midWord = Math.max(1, Math.min(words.length - 1, Math.round(words.length * ratio)));
          part1 = words.slice(0, midWord).join(' ');
          part2 = words.slice(midWord).join(' ');
        } else {
          part1 = fullKhmer;
          part2 = fullKhmer;
        }
      }

      // Proportional text splitting for Chinese
      const fullChinese = (targetSeg.chineseText || targetSeg.originalChineseText || targetSeg.originalText || targetSeg.original || targetSeg.chinese || '').trim();
      let cnPart1 = fullChinese;
      let cnPart2 = '';
      if (fullChinese.length > 4) {
        const ratio = (roundedSplit - sStart) / Math.max(0.1, dur);
        const splitIdx = Math.max(1, Math.min(fullChinese.length - 1, Math.round(fullChinese.length * ratio)));
        const puncts = ['。', '？', '！', '…', '，', '；', '\n'];
        let bestPunctIdx = -1;
        let minPunctDiff = Infinity;
        for (const p of puncts) {
          let pIdx = fullChinese.indexOf(p);
          while (pIdx !== -1) {
            const diff = Math.abs(pIdx + 1 - splitIdx);
            if (diff < minPunctDiff && diff < fullChinese.length * 0.35) {
              minPunctDiff = diff;
              bestPunctIdx = pIdx + 1;
            }
            pIdx = fullChinese.indexOf(p, pIdx + 1);
          }
        }
        const finalCnSplit = bestPunctIdx !== -1 ? bestPunctIdx : splitIdx;
        cnPart1 = fullChinese.slice(0, finalCnSplit).trim();
        cnPart2 = fullChinese.slice(finalCnSplit).trim();
      }

      let engPart1 = targetSeg.english || '';
      let engPart2 = targetSeg.english || '';
      if (targetSeg.english) {
        const engWords = targetSeg.english.trim().split(/\s+/).filter(Boolean);
        if (engWords.length >= 2) {
          const ratio = (roundedSplit - sStart) / Math.max(0.1, dur);
          const mid = Math.max(1, Math.min(engWords.length - 1, Math.round(engWords.length * ratio)));
          engPart1 = engWords.slice(0, mid).join(' ');
          engPart2 = engWords.slice(mid).join(' ');
        }
      }

      const dur1 = parseFloat((roundedSplit - sStart).toFixed(2));
      const dur2 = parseFloat((sEnd - roundedSplit).toFixed(2));

      const uid1 = targetSeg._uid ? `${targetSeg._uid}_a` : `seg_${Date.now()}_a_${Math.random().toString(36).substr(2, 4)}`;
      const uid2 = `seg_${Date.now()}_b_${Math.random().toString(36).substr(2, 4)}`;
      const hasAudio = Boolean(targetSeg.audioGenerated || targetSeg.audioFile || targetSeg.audioUrl);
      const origOffset = typeof targetSeg.audioOffset === 'number' && !isNaN(targetSeg.audioOffset) ? targetSeg.audioOffset : 0;

      const seg1 = {
        ...targetSeg,
        _uid: uid1,
        start: formatMinSec(sStart),
        end: formatMinSec(roundedSplit),
        startSec: sStart,
        endSec: roundedSplit,
        audioStart: formatMinSec(sStart),
        audioEnd: formatMinSec(roundedSplit),
        audioStartSec: sStart,
        audioEndSec: roundedSplit,
        audioOffset: origOffset,
        audioDurationSec: dur1,
        finalAudioDuration: dur1,
        audioDuration: dur1,
        originalAudioDuration: dur1,
        rawAudioDur: dur1,
        audioTrimmed: true,
        userTrimmed: true,
        khmer: part1,
        khmerText: part1,
        khmerTranslatedText: part1,
        chineseText: cnPart1,
        original: cnPart1,
        originalText: cnPart1,
        originalChineseText: cnPart1,
        english: engPart1,
        audioGenerated: hasAudio,
        audioFile: targetSeg.audioFile || null,
        audioPath: targetSeg.audioPath || null,
        audioUrl: targetSeg.audioUrl || null,
        audioFileName: targetSeg.audioFileName || null,
        rawAudioPath: targetSeg.rawAudioPath || null,
        rawAudioFile: targetSeg.rawAudioFile || null,
        audioOutdated: false,
        ttsStatus: targetSeg.ttsStatus || (hasAudio ? 'ready' : 'pending'),
        userShifted: true,
      };

      const seg2 = {
        ...targetSeg,
        _uid: uid2,
        id: `seg-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        start: formatMinSec(roundedSplit),
        end: formatMinSec(sEnd),
        startSec: roundedSplit,
        endSec: sEnd,
        audioStart: formatMinSec(roundedSplit),
        audioEnd: formatMinSec(sEnd),
        audioStartSec: roundedSplit,
        audioEndSec: sEnd,
        audioOffset: parseFloat((origOffset + dur1).toFixed(2)),
        audioDurationSec: dur2,
        finalAudioDuration: dur2,
        audioDuration: dur2,
        originalAudioDuration: dur2,
        rawAudioDur: dur2,
        audioTrimmed: true,
        userTrimmed: true,
        khmer: part2,
        khmerText: part2,
        khmerTranslatedText: part2,
        chineseText: cnPart2 || cnPart1,
        original: cnPart2 || cnPart1,
        originalText: cnPart2 || cnPart1,
        originalChineseText: cnPart2 || cnPart1,
        english: engPart2,
        audioGenerated: hasAudio,
        audioFile: targetSeg.audioFile || null,
        audioPath: targetSeg.audioPath || null,
        audioUrl: targetSeg.audioUrl || null,
        audioFileName: targetSeg.audioFileName || null,
        rawAudioPath: targetSeg.rawAudioPath || null,
        rawAudioFile: targetSeg.rawAudioFile || null,
        audioOutdated: false,
        ttsStatus: targetSeg.ttsStatus || (hasAudio ? 'ready' : 'pending'),
        userShifted: true,
      };

      const nextSegments = [...segments];
      nextSegments.splice(splitSegIdx, 1, seg1, seg2);
      const reindexed = nextSegments.map((item, idx) => ({
        ...item,
        id: idx + 1,
        segmentId: idx + 1,
      }));

      // Snapshot with current uncut videoClips to preserve unbroken video state
      pushUndoSnapshot(currentClips, segments);
      setScriptData((prev) => (prev ? { ...prev, segments: reindexed, updatedAt: Date.now() } : null));
      if (setSelectedSegmentId) setSelectedSegmentId(uid2);

      // Re-sync timeline narration audio
      if (audioGenerated && syncTimelineAudioApi) {
        if (syncAudioTimeoutRef?.current) clearTimeout(syncAudioTimeoutRef.current);
        syncTimelineAudioApi(reindexed, getProjectName(), getVideoId(), episodeId, seriesId).then((res) => {
          if (res?.fullAudioUrl && setFullAudioUrl) {
            setFullAudioUrl(`${res.fullAudioUrl.split('?')[0]}?t=${Date.now()}`);
            if (setFullAudioPath) setFullAudioPath(res.fullAudioPath);
          }
        }).catch((err) => console.warn('Audio sync after segment split error:', err.message));
      }

      return true;
    };

    const isTargetingVideoClip = Boolean(
      targetId && currentClips.some((c) => c.id === targetId)
    );

    // (a) if selectedSegmentId matches a segment and the playhead is strictly inside it -> split THAT segment, never the video
    let selectedSegIdx = -1;
    if (!isTargetingVideoClip) {
      const activeSegKey = targetId !== null && targetId !== undefined ? targetId : selectedSegmentId;
      if (activeSegKey !== null && activeSegKey !== undefined && segments.length > 0) {
        selectedSegIdx = segments.findIndex((s, idx) => isSegmentMatch(s, activeSegKey, idx) && isInsideSeg(s, true));
        if (selectedSegIdx === -1) {
          const fallbackIdx = findSegmentIndex(segments, activeSegKey);
          if (fallbackIdx !== -1 && isInsideSeg(segments[fallbackIdx], true)) {
            selectedSegIdx = fallbackIdx;
          }
        }
      }
    }

    if (selectedSegIdx !== -1) {
      return executeSplitSegment(selectedSegIdx);
    }

    // (b) else if a video clip is explicitly active and the playhead is inside it -> split the video (current behaviour preserved)
    const activeVideoId = isTargetingVideoClip ? targetId : activeClipId;
    let explicitVideoClip = null;
    if (activeVideoId) {
      explicitVideoClip = currentClips.find(
        (c) => c.id === activeVideoId && roundedSplit > (c.start + 0.05) && roundedSplit < (c.end - 0.05)
      );
    }

    if (explicitVideoClip) {
      const videoSplitResult = splitClipAtTime(currentClips, roundedSplit, totalDur, activeVideoId);
      if (videoSplitResult) {
        pushUndoSnapshot(currentClips, segments);
        setVideoClips(videoSplitResult.newClips);
        setActiveClipId(videoSplitResult.activeClipId);
        return true;
      }
    }

    // (c) else if any segment intersects the playhead -> split it
    let anyIntersectingSegIdx = -1;
    if (segments.length > 0) {
      anyIntersectingSegIdx = segments.findIndex((s) => isInsideSeg(s, false));
    }

    if (anyIntersectingSegIdx !== -1) {
      return executeSplitSegment(anyIntersectingSegIdx);
    }

    // (d) else split the video at the playhead
    const fallbackVideoSplit = splitClipAtTime(currentClips, roundedSplit, totalDur, null);
    if (fallbackVideoSplit) {
      pushUndoSnapshot(currentClips, segments);
      setVideoClips(fallbackVideoSplit.newClips);
      setActiveClipId(fallbackVideoSplit.activeClipId);
      return true;
    }

    // STEP 2: When no branch matches (no segment, no video clip at the playhead), show brief in-app toast in Khmer
    // and log the playhead time + nearest segment boundaries to the console.
    let nearestPrev = null;
    let nearestNext = null;
    let minPrevDist = Infinity;
    let minNextDist = Infinity;

    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      const timing = getSegTiming(s);
      if (timing.effectiveEnd <= roundedSplit) {
        const dist = roundedSplit - timing.effectiveEnd;
        if (dist < minPrevDist) {
          minPrevDist = dist;
          nearestPrev = { index: i, id: s.id, start: timing.effectiveStart, end: timing.effectiveEnd, distSec: parseFloat(dist.toFixed(3)) };
        }
      }
      if (timing.effectiveStart >= roundedSplit) {
        const dist = timing.effectiveStart - roundedSplit;
        if (dist < minNextDist) {
          minNextDist = dist;
          nearestNext = { index: i, id: s.id, start: timing.effectiveStart, end: timing.effectiveEnd, distSec: parseFloat(dist.toFixed(3)) };
        }
      }
    }

    console.warn(`[Split] ⚠️ គ្មាន clip នៅត្រង់ playhead ទេ (playhead=${roundedSplit.toFixed(3)}s). Nearest segment boundaries:`, {
      playhead: roundedSplit,
      nearestPrevSegment: nearestPrev,
      nearestNextSegment: nearestNext,
      totalSegments: segments.length,
      activeTargetId: targetId,
      selectedSegmentId,
      activeClipId,
    });

    showInAppToast('គ្មាន clip នៅត្រង់ playhead ទេ — ដាក់ playhead ឲ្យនៅកណ្ដាល clip');

    return false;
  };

  // CapCut-style Auto-Split Video by Subtitles/Dialogue
  const handleAutoSplitVideo = () => {
    if (!scriptData?.segments || scriptData.segments.length === 0) {
      alert('សូមបង្កើត Script ឬបកប្រែសន្ទនាជាមុនសិន!');
      return;
    }
    const totalDur = Number(
      duration ||
      videoRef?.current?.duration ||
      selectedVideo?.duration ||
      selectedVideo?.durationSec ||
      selectedVideo?.metadata?.duration ||
      (scriptData?.segments?.length ? scriptData.segments[scriptData.segments.length - 1].endSec : 0) ||
      0
    );
    if (totalDur <= 0) return;

    const splitClips = autoSplitVideoBySegments(
      scriptData.segments,
      totalDur,
      selectedVideo?.fileName || 'Video'
    );

    if (splitClips && splitClips.length > 0) {
      pushUndoSnapshot(videoClips);
      setVideoClips(splitClips);
      setActiveClipId(splitClips[0]?.id || null);
    }
  };

  // Reset video track back to 1 full continuous uncut video clip
  const handleResetFullVideo = () => {
    const realVideoDur = (videoRef?.current?.duration && !isNaN(videoRef.current.duration) && videoRef.current.duration > 0) ? videoRef.current.duration : 0;
    const scriptMaxEnd = (scriptData?.segments || []).reduce((max, s) => Math.max(max, Number(s.audioEndSec) || Number(s.endSec) || (Number(s.startSec) || 0) + 3.0), 0);
    const totalDur = Math.max(realVideoDur, scriptMaxEnd, duration || 0, selectedVideo?.durationSec || selectedVideo?.duration || 0);
    if (totalDur > 0) {
      const fullClip = [
        {
          id: `clip-${Date.now()}`,
          start: 0,
          end: totalDur,
          sourceStart: 0,
          sourceEnd: totalDur,
          duration: totalDur,
          name: selectedVideo?.originalFilename || selectedVideo?.fileName || 'Full Video',
          trackId: 'video-1',
          trackRow: 0,
          videoUrl: selectedVideo?.videoUrl,
          videoId: selectedVideo?.videoId,
        },
      ];
      pushUndoSnapshot(videoClips);
      setVideoClips(fullClip);
      setActiveClipId(fullClip[0]?.id || null);
    }
  };

  // Bridge Subtitle/Dialogue Gaps & Video Gaps
  const handleBridgeGaps = () => {
    pushUndoSnapshot(videoClips, scriptData?.segments || []);

    // 1. Bridge video gaps
    if (videoClips && videoClips.length > 1) {
      const bridged = bridgeClipGaps(videoClips, 10);
      setVideoClips(bridged);
    }

    // 2. Bridge script segments
    if (scriptData?.segments && scriptData.segments.length > 1) {
      const updated = scriptData.segments.map((seg, idx, arr) => {
        if (idx < arr.length - 1) {
          const next = arr[idx + 1];
          const currEndSec = typeof seg.endSec === 'number' ? seg.endSec : parseTimeToSeconds(seg.end, 0);
          const nextStartSec = typeof next.startSec === 'number' ? next.startSec : parseTimeToSeconds(next.start, 0);
          if (nextStartSec > currEndSec && (nextStartSec - currEndSec) <= 6) {
            return {
              ...seg,
              end: next.start,
              endSec: nextStartSec,
            };
          }
        }
        return seg;
      });
      setScriptData((prev) => prev ? ({ ...prev, segments: updated, updatedAt: Date.now() }) : null);
    }
  };

  // Shared cleanup pass: align the voice lane, rebuild dialogue/Gap clips,
  // update the same persisted React state, and sync generated narration once.
  const runTimelineAlignmentPass = useCallback(async ({
    segments = scriptData?.segments || [],
    clips = videoClips,
    recordUndo = false,
    clearAudioWhenEmpty = false,
  } = {}) => {
    const currentSegments = Array.isArray(segments) ? segments : [];
    const currentClips = Array.isArray(clips) ? clips : [];
    const inferredEnd = Math.max(
      0,
      ...currentClips.map((clip) => Number(clip?.end) || 0),
      ...currentSegments.map((seg) => Number(seg?.endSec) || parseTimeToSeconds(seg?.end, 0))
    );
    const totalDur = Number(
      duration ||
      videoRef?.current?.duration ||
      selectedVideo?.durationSec ||
      selectedVideo?.duration ||
      selectedVideo?.metadata?.duration ||
      inferredEnd ||
      0
    );

    if (recordUndo) {
      pushUndoSnapshot(videoClips, scriptData?.segments || [], activeClipId);
    }

    const result = alignTimelineFromSegments(
      currentSegments,
      currentClips,
      totalDur,
      selectedVideo?.fileName || 'Video',
      { minGapSec: 0.04, maxShiftSec: 0.35, maxPlaybackSpeed: 1.45 }
    );

    setVideoClips(result.videoClips);
    const priorActive = currentClips.find((clip) => clip?.id === activeClipId);
    const nextActive = priorActive?.isDialogue
      ? result.videoClips.find((clip) => clip.isDialogue && (
          (priorActive.segmentId != null && String(clip.segmentId) === String(priorActive.segmentId)) ||
          (priorActive.segmentIndex != null && clip.segmentIndex === priorActive.segmentIndex)
        ))
      : priorActive
        ? result.videoClips.find((clip) => priorActive.start >= clip.start && priorActive.start < clip.end)
        : null;
    setActiveClipId(nextActive?.id || result.videoClips[0]?.id || null);

    if (result.segments.length > 0 && setSpeakerRegistry) {
      setSpeakerRegistry(buildSpeakerRegistry(result.segments, speakerRegistry));
    }
    setScriptData((prev) => ({
      ...(prev || scriptData || { mode: 'dialogue', genre: 'auto' }),
      segments: result.segments,
      updatedAt: Date.now(),
    }));

    const hasGeneratedAudio = result.segments.some((seg) => seg.audioFile || seg.audioPath || seg.audioUrl);
    if (clearAudioWhenEmpty && !hasGeneratedAudio) {
      if (setFullAudioUrl) setFullAudioUrl(null);
      if (setFullAudioPath) setFullAudioPath(null);
      return result;
    }

    try {
      if (hasGeneratedAudio || audioGenerated) {
        const syncRes = await syncTimelineAudioApi(
          result.segments,
          getProjectName() || 'drama_project',
          getVideoId(),
          episodeId,
          seriesId
        );
        if (syncRes?.fullAudioUrl && typeof setFullAudioUrl === 'function') {
          setFullAudioUrl(`${syncRes.fullAudioUrl.split('?')[0]}?t=${Date.now()}`);
        }
        if (syncRes?.fullAudioPath && typeof setFullAudioPath === 'function') {
          setFullAudioPath(syncRes.fullAudioPath);
        }
        notifyBackendOnline();
      }
    } catch (err) {
      console.warn('[useClipOperations] Timeline alignment audio sync notice:', err.message);
      if (err.status === 502 || /ECONNREFUSED|unreachable|Failed to fetch|NetworkError/i.test(err?.message || '')) {
        notifyBackendOffline();
      }
    }
    return result;
  }, [
    scriptData,
    duration,
    videoRef,
    selectedVideo,
    videoClips,
    activeClipId,
    audioGenerated,
    seriesId,
    episodeId,
    speakerRegistry,
    pushUndoSnapshot,
    setScriptData,
    setVideoClips,
    setActiveClipId,
    setSpeakerRegistry,
    setFullAudioUrl,
    setFullAudioPath,
  ]);

  // Auto-Align Voice Segments and VIDEO 1 through the exact same pass used after delete.
  const handleAutoAlignNoOverlap = useCallback(async () => {
    const currentSegments = scriptData?.segments;
    if (!Array.isArray(currentSegments) || currentSegments.length === 0) return;
    try {
      await runTimelineAlignmentPass({ segments: currentSegments, clips: videoClips, recordUndo: true });
    } catch (err) {
      console.warn('[useClipOperations] Auto-align failed:', err);
    }
  }, [scriptData?.segments, videoClips, runTimelineAlignmentPass]);

  // Auto-fit speech speed (1.05x - 1.50x) for red/overflowing/trimmed clips
  const handleAutoFitSpeechSpeed = useCallback(async (customMaxSpeed = 1.50) => {
    const currentSegments = scriptData?.segments;
    if (!Array.isArray(currentSegments) || currentSegments.length === 0) {
      showInAppToast('⚠️ មិនមានឃ្លាណាមួយសម្រាប់ Auto-Fit ទេ');
      return;
    }

    try {
      pushUndoSnapshot(videoClips, currentSegments);
    } catch (_) {}

    showInAppToast('⚡ កំពុងពន្លឿនឃ្លាពណ៌ក្រហម (1.05x - 1.50x) ឱ្យនិយាយទាន់ និងចប់គ្រប់អក្សរ...');

    try {
      const res = await autoFitSpeechSpeedApi({
        seriesId,
        episodeId,
        maxSpeed: customMaxSpeed,
        segments: currentSegments,
      });

      if (res?.success && Array.isArray(res.segments)) {
        const nextScriptData = {
          ...scriptData,
          segments: res.segments,
          updatedAt: Date.now(),
        };
        setScriptData(nextScriptData);

        if (res.fittedCount > 0) {
          showInAppToast(`⚡ បានពន្លឿន ${res.fittedCount} ឃ្លាឱ្យនិយាយចប់គ្រប់អក្សរ និង Fit តាម Subtitle ជោគជ័យ!`);
        } else {
          showInAppToast('✅ គ្រប់ឃ្លាទាំងអស់គឺ Fit តាម Subtitle រួចរាល់ហើយ គ្មានឃ្លាលើសម៉ោងទេ!');
        }

        // Re-sync timeline audio preview
        try {
          const syncRes = await syncTimelineAudioApi(
            res.segments,
            getProjectName() || 'drama_project',
            getVideoId(),
            episodeId,
            seriesId
          );
          if (syncRes?.fullAudioUrl && typeof setFullAudioUrl === 'function') {
            setFullAudioUrl(`${syncRes.fullAudioUrl.split('?')[0]}?t=${Date.now()}`);
          }
          if (syncRes?.fullAudioPath && typeof setFullAudioPath === 'function') {
            setFullAudioPath(syncRes.fullAudioPath);
          }
          notifyBackendOnline();
        } catch (_) {}
      }
    } catch (err) {
      console.error('[useClipOperations] handleAutoFitSpeechSpeed failed:', err);
      showInAppToast(`❌ បរាជ័យក្នុងការពន្លឿនសំឡេង៖ ${err.message}`);
    }
  }, [
    scriptData,
    videoClips,
    seriesId,
    episodeId,
    pushUndoSnapshot,
    setScriptData,
    setFullAudioUrl,
    setFullAudioPath,
  ]);

  // Reset all segments to exact original Chinese video timestamps (0% drift)
  const handleResetToSourceTiming = useCallback(async () => {
    const currentSegments = scriptData?.segments;
    if (!Array.isArray(currentSegments) || currentSegments.length === 0) return;

    try {
      pushUndoSnapshot(videoClips, currentSegments);
    } catch (err) {
      console.warn('[useClipOperations] pushUndoSnapshot failed in handleResetToSourceTiming:', err);
    }
    const totalDur = Number(duration || videoRef?.current?.duration || selectedVideo?.duration || 0);
    const resetSegs = resetSegmentsToSourceTiming(currentSegments, totalDur);

    setScriptData({
      ...scriptData,
      segments: resetSegs,
      updatedAt: Date.now(),
    });

    try {
      const hasGeneratedAudio = resetSegs.some((s) => s.audioFile || s.audioPath || s.audioUrl);
      if (hasGeneratedAudio || audioGenerated) {
        const syncRes = await syncTimelineAudioApi(
          resetSegs,
          getProjectName() || 'drama_project',
          getVideoId(),
          episodeId,
          seriesId
        );
        if (syncRes?.fullAudioUrl && typeof setFullAudioUrl === 'function') {
          setFullAudioUrl(`${syncRes.fullAudioUrl.split('?')[0]}?t=${Date.now()}`);
        }
        if (syncRes?.fullAudioPath && typeof setFullAudioPath === 'function') {
          setFullAudioPath(syncRes.fullAudioPath);
        }
        notifyBackendOnline();
      }
    } catch (err) {
      console.warn('[useClipOperations] Reset timing audio sync notice:', err.message);
      if (err.status === 502 || /ECONNREFUSED|unreachable|Failed to fetch|NetworkError/i.test(err?.message || '')) {
        notifyBackendOffline();
      }
    }
  }, [
    scriptData,
    duration,
    videoRef,
    selectedVideo,
    videoClips,
    audioGenerated,
    seriesId,
    episodeId,
    pushUndoSnapshot,
    setScriptData,
    setFullAudioUrl,
    setFullAudioPath,
  ]);

  // Select clip and seek playhead to its start
  const handleSelectClip = (clipId) => {
    setActiveClipId(clipId);
    const target = videoClips.find((c) => c.id === clipId);
    if (target && handleSeek) {
      handleSeek(target.start);
    }
  };

  // Delete Clip Tool (with automatic Ripple Delete & Video+Voice Track Sync)
  const handleDeleteClip = (clipId = null) => {
    const targetClipId = clipId !== null && clipId !== undefined ? clipId : activeClipId;
    if (!targetClipId) return;

    const targetClip = videoClips.find((c) => c.id === targetClipId);
    if (!targetClip) return;
    pushUndoSnapshot(videoClips, scriptData?.segments || []);

    const targetStart = Number.isFinite(targetClip.start) ? targetClip.start : 0;
    const targetEnd = Number.isFinite(targetClip.end) ? targetClip.end : targetStart;
    const dur = Math.max(0, parseFloat((targetEnd - targetStart).toFixed(3)));

    const isGap = !targetClip.isDialogue && (
      targetClip.name === 'Gap' || 
      targetClip.id?.startsWith('clip-gap') || 
      (!targetClip.segmentId && !targetClip.segmentIndex)
    );

    const updated = deleteClipById(videoClips, targetClipId, { allowEmpty: true, ripple: true });
    let nextSegments = Array.isArray(scriptData?.segments) ? scriptData.segments : [];

    // Ripple voice segments as well if they match or start after the deleted clip!
    if (nextSegments.length > 0) {
      if (isGap) {
        // 1. User deleted a Gap clip: Shift all voice segments starting at or after targetEnd left by dur
        nextSegments = nextSegments.map((seg) => {
          const s = typeof seg.startSec === 'number' ? seg.startSec : parseTimeToSeconds(seg.start, 0);
          if (!seg.userShifted && s >= targetEnd - 0.02) {
            const segDur = typeof seg.duration === 'number' && seg.duration > 0
              ? seg.duration
              : ((typeof seg.endSec === 'number' ? seg.endSec : parseTimeToSeconds(seg.end, s + 2.5)) - s);
            const newStart = Math.max(0, parseFloat((s - dur).toFixed(3)));
            const newEnd = parseFloat((newStart + segDur).toFixed(3));
            return {
              ...seg,
              start: formatTimecode(newStart),
              end: formatTimecode(newEnd),
              startSec: newStart,
              endSec: newEnd,
              audioStartSec: newStart,
              audioEndSec: newEnd,
            };
          }
          return seg;
        });
      } else {
        // 2. User deleted a DIALOGUE clip: Remove matching voice segment(s) and ripple remaining
        const associatedIndices = findAssociatedSegmentIndices(targetClip, scriptData.segments);
        const associatedSet = new Set(associatedIndices);

        if (associatedSet.size > 0) {
          const selectedIndex = findSegmentIndex(scriptData.segments, selectedSegmentId);
          if (associatedSet.has(selectedIndex) && setSelectedSegmentId) setSelectedSegmentId(null);
          const remaining = scriptData.segments.filter((_, idx) => !associatedSet.has(idx));
          nextSegments = remaining.map((seg, newIdx) => {
            // Keep the owner's exact dragged voice interval and lane; only its
            // displayed dialogue index changes after a neighbouring delete.
            if (seg.userShifted) {
              return { ...seg, id: newIdx + 1, segmentId: newIdx + 1 };
            }
            const s = typeof seg.startSec === 'number' ? seg.startSec : parseTimeToSeconds(seg.start, 0);
            const segDur = typeof seg.duration === 'number' && seg.duration > 0
              ? seg.duration
              : ((typeof seg.endSec === 'number' ? seg.endSec : parseTimeToSeconds(seg.end, s + 2.5)) - s);
            let newStart = s;
            let newEnd = typeof seg.endSec === 'number' ? seg.endSec : s + segDur;
            if (!seg.userShifted && s >= targetStart - 0.02) {
              newStart = Math.max(0, parseFloat((s - dur).toFixed(3)));
              newEnd = parseFloat((newStart + segDur).toFixed(3));
            }
            return {
              ...seg,
              id: newIdx + 1,
              segmentId: newIdx + 1,
              start: formatTimecode(newStart),
              end: formatTimecode(newEnd),
              startSec: newStart,
              endSec: newEnd,
              audioStartSec: newStart,
              audioEndSec: newEnd,
            };
          });
        } else {
          // Fallback: If no direct match found, shift subsequent segments left by dur
          nextSegments = nextSegments.map((seg) => {
            const s = typeof seg.startSec === 'number' ? seg.startSec : parseTimeToSeconds(seg.start, 0);
            if (!seg.userShifted && s >= targetEnd - 0.02) {
              const segDur = typeof seg.duration === 'number' && seg.duration > 0
                ? seg.duration
                : ((typeof seg.endSec === 'number' ? seg.endSec : parseTimeToSeconds(seg.end, s + 2.5)) - s);
              const newStart = Math.max(0, parseFloat((s - dur).toFixed(3)));
              const newEnd = parseFloat((newStart + segDur).toFixed(3));
              return {
                ...seg,
                start: formatTimecode(newStart),
                end: formatTimecode(newEnd),
                startSec: newStart,
                endSec: newEnd,
                audioStartSec: newStart,
                audioEndSec: newEnd,
              };
            }
            return seg;
          });
        }
      }

      // 3. Snap to 00:00: If leading video clip was snapped to 00:00, ensure voice starts at 00:00 too!
      if (nextSegments.length > 0 && updated.length > 0 && updated[0].start === 0) {
        const firstSegStart = typeof nextSegments[0].startSec === 'number' ? nextSegments[0].startSec : parseTimeToSeconds(nextSegments[0].start, 0);
        if (firstSegStart > 0.04) {
          nextSegments = nextSegments.map((seg) => {
            if (seg.userShifted) return seg;
            const s = typeof seg.startSec === 'number' ? seg.startSec : parseTimeToSeconds(seg.start, 0);
            const segDur = typeof seg.duration === 'number' && seg.duration > 0
              ? seg.duration
              : ((typeof seg.endSec === 'number' ? seg.endSec : parseTimeToSeconds(seg.end, s + 2.5)) - s);
            const newStart = Math.max(0, parseFloat((s - firstSegStart).toFixed(3)));
            const newEnd = parseFloat((newStart + segDur).toFixed(3));
            return {
              ...seg,
              start: formatTimecode(newStart),
              end: formatTimecode(newEnd),
              startSec: newStart,
              endSec: newEnd,
              audioStartSec: newStart,
              audioEndSec: newEnd,
            };
          });
        }
      }

    }

    // Run once after the whole video/voice ripple has settled. The pre-delete
    // snapshot above is the only history entry for deletion plus cleanup.
    void runTimelineAlignmentPass({
      segments: nextSegments,
      clips: updated,
      clearAudioWhenEmpty: true,
    }).catch((err) => console.error('[useClipOperations] Auto-clean after clip delete failed:', err));
  };

  // Update Clips (Drag/Trim) with optional synchronized segments
  const handleUpdateClips = (newClips, updatedSegments = null) => {
    pushUndoSnapshot(videoClips, scriptData?.segments || []);
    setVideoClips(newClips);
    if (updatedSegments && updatedSegments.length) {
      handleUpdateTimelineSegments(updatedSegments, true, true);
    }
  };

  // Delete a Subtitle Segment (with automatic Ripple Delete & Video Sync)
  const handleDeleteSegment = async (segIdOrIdx = null) => {
    if (!scriptData?.segments) return;
    const targetKey = segIdOrIdx !== null && segIdOrIdx !== undefined ? segIdOrIdx : selectedSegmentId;
    if (targetKey === null || targetKey === undefined) return;

    pushUndoSnapshot(videoClips, scriptData.segments);
    const targetSegIdx = findSegmentIndex(scriptData.segments, targetKey);
    const targetSeg = targetSegIdx !== -1 ? scriptData.segments[targetSegIdx] : null;

    const updated = deleteSegmentByIdOrIndex(scriptData.segments, targetKey, { ripple: true });
    if (updated === scriptData.segments) return;

    if (syncAudioTimeoutRef?.current) clearTimeout(syncAudioTimeoutRef.current);

    if (setSelectedSegmentId) setSelectedSegmentId(null);

    // If video cuts exist, delete matching video clip and ripple remaining video cuts!
    let nextVideoClips = videoClips;
    if (targetSeg && Array.isArray(videoClips) && videoClips.length > 0) {
      const sStart = typeof targetSeg.startSec === 'number' ? targetSeg.startSec : parseTimeToSeconds(targetSeg.start, 0);
      const sEnd = typeof targetSeg.endSec === 'number' ? targetSeg.endSec : parseTimeToSeconds(targetSeg.end, sStart + 2.5);

      // Find matching video clip if video was cut into clips
      const matchingClip = videoClips.find((c) =>
        Boolean(
          c.isDialogue && (
            (targetSeg.id && (c.segmentId === targetSeg.id || String(c.segmentId) === String(targetSeg.id))) ||
            (targetSeg.segmentId && (c.segmentId === targetSeg.segmentId || String(c.segmentId) === String(targetSeg.segmentId))) ||
            (typeof targetSegIdx === 'number' && c.segmentIndex === targetSegIdx + 1) ||
            (Math.max(c.start, sStart) < Math.min(c.end, sEnd) - 0.05)
          )
        )
      );

      if (matchingClip) {
        // Delete matching clip via deleteClipById (which ripples subsequent clips and re-indexes #1, #2, #3...)
        nextVideoClips = deleteClipById(videoClips, matchingClip.id, { allowEmpty: true, ripple: true });
      } else {
        // Fallback: ripple video cuts starting after sEnd by dur
        const dur = Math.max(0, sEnd - sStart);
        if (dur > 0.04) {
          let shiftedClips = videoClips.map((c) => {
            if (c.start >= sEnd - 0.02) {
              const clipLen = c.end - c.start;
              const newStart = Math.max(0, parseFloat((c.start - dur).toFixed(3)));
              const newEnd = parseFloat((newStart + clipLen).toFixed(3));
              return { ...c, start: newStart, end: newEnd };
            }
            return c;
          });
          if (shiftedClips.length > 0 && shiftedClips[0].start > 0.04 && updated.length > 0 && updated[0].startSec === 0) {
            const leadGap = shiftedClips[0].start;
            shiftedClips = shiftedClips.map((c) => {
              const clipLen = c.end - c.start;
              const newStart = Math.max(0, parseFloat((c.start - leadGap).toFixed(3)));
              const newEnd = parseFloat((newStart + clipLen).toFixed(3));
              return { ...c, start: newStart, end: newEnd };
            });
          }
          nextVideoClips = shiftedClips;
        }
      }
    }

    // `updated` already contains the complete voice ripple; rebuild both lanes
    // once and clear the deleted selection through the shared state path.
    await runTimelineAlignmentPass({
      segments: updated,
      clips: nextVideoClips,
      clearAudioWhenEmpty: true,
    });
  };

  // Update Timeline Subtitles / Audio positions (Drag/Trim)
  const handleUpdateTimelineSegments = (newSegments, skipUndo = false, immediate = false) => {
    if (!skipUndo) {
      pushUndoSnapshot(videoClips, scriptData?.segments || []);
    }
    if (newSegments?.length) {
      const updatedReg = buildSpeakerRegistry(newSegments, speakerRegistry);
      if (setSpeakerRegistry) setSpeakerRegistry(updatedReg);
    }
    setScriptData(prev => (prev ? ({ ...prev, segments: newSegments, updatedAt: Date.now() }) : (newSegments?.length ? { mode: 'dialogue', genre: 'auto', segments: newSegments, updatedAt: Date.now() } : null)));

    const hasAudios = Boolean(newSegments?.some(s => s.audioFile || s.audioPath || s.audioUrl));
    if (!hasAudios && audioGenerated) {
      if (syncAudioTimeoutRef?.current) clearTimeout(syncAudioTimeoutRef.current);
      if (setFullAudioUrl) setFullAudioUrl(null);
      if (setFullAudioPath) setFullAudioPath(null);
      return;
    }

    // Auto re-sync master audio positions with updated timeline timestamps
    if (audioGenerated && hasAudios) {
      if (syncAudioTimeoutRef?.current) clearTimeout(syncAudioTimeoutRef.current);
      const executeSync = async () => {
        try {
          const res = await syncTimelineAudioApi(newSegments, getProjectName(), getVideoId(), episodeId, seriesId);
          if (res && res.fullAudioUrl && setFullAudioUrl) {
            const cacheBusted = `${res.fullAudioUrl.split('?')[0]}?t=${Date.now()}`;
            setFullAudioUrl(cacheBusted);
            if (setFullAudioPath) setFullAudioPath(res.fullAudioPath);
          }
        } catch (e) {
          console.warn('Auto re-sync timeline audio error:', e.message);
        }
      };

      if (immediate) {
        executeSync();
      } else if (syncAudioTimeoutRef) {
        syncAudioTimeoutRef.current = setTimeout(executeSync, 250);
      }
    }
  };

  // Add a new Subtitle/Dialogue Segment at Target Time (or Playhead)
  const handleAddSegmentAtTime = (targetTime = null) => {
    const rawTime = typeof targetTime === 'number' && !isNaN(targetTime)
      ? targetTime
      : (videoRef?.current?.currentTime || 0);
    // Floor to hundredths so safeTime <= currentTime and playhead auto-follow stays locked onto the new clip
    const safeTime = Math.max(0, Math.floor(rawTime * 100) / 100);

    pushUndoSnapshot(videoClips, scriptData?.segments || []);

    const existingSegs = scriptData?.segments || [];

    // Find slot where this timestamp falls (strictly after existing segments starting <= safeTime)
    let insertIdx = existingSegs.findIndex(s => {
      const sStart = typeof s.startSec === 'number' ? s.startSec : parseTimeToSeconds(s.start, 0);
      return sStart > safeTime;
    });
    if (insertIdx === -1) insertIdx = existingSegs.length;

    // Check next segment start to prevent collision when space is tight
    let nextStart = safeTime + 3.0;
    if (insertIdx < existingSegs.length) {
      const nextSeg = existingSegs[insertIdx];
      const nextSegStart = typeof nextSeg.startSec === 'number' ? nextSeg.startSec : parseTimeToSeconds(nextSeg.start, 0);
      if (nextSegStart > safeTime) {
        nextStart = Math.min(safeTime + 3.0, Math.max(safeTime + 1.0, parseFloat((nextSegStart - 0.1).toFixed(2))));
      }
    }
    const safeEnd = parseFloat(nextStart.toFixed(2));
    const draftDur = Math.max(0.5, parseFloat((safeEnd - safeTime).toFixed(2)));

    // Resolve existing voice lane occupancy so new segment lands on the lowest free VOICE lane at [safeTime, safeEnd]
    const rowEndTimes = [0, 0];
    const occupiedOnRow = new Map();
    existingSegs.forEach((seg, idx) => {
      const sRawStart = (typeof seg.audioStartSec === 'number' && !isNaN(seg.audioStartSec))
        ? seg.audioStartSec
        : (typeof seg.startSec === 'number' && !isNaN(seg.startSec) ? seg.startSec : parseTimeToSeconds(seg.start, idx * 4));
      const sSlotStart = (typeof seg.startSec === 'number' && !isNaN(seg.startSec)) ? seg.startSec : sRawStart;
      const sSlotEnd = (typeof seg.endSec === 'number' && !isNaN(seg.endSec)) ? seg.endSec : sSlotStart + 3.0;
      const sSlotSpan = (typeof seg.audioEndSec === 'number' && !isNaN(seg.audioEndSec) && seg.audioEndSec > sRawStart)
        ? (seg.audioEndSec - sRawStart)
        : (sSlotEnd > sSlotStart ? (sSlotEnd - sSlotStart) : 2.5);
      const sAudioDur = getSegmentAudioDuration(seg, (typeof seg.audioDurationSec === 'number' && seg.audioDurationSec > 0) ? seg.audioDurationSec : sSlotSpan);
      const sEnd = (Boolean(seg.audioTrimmed || seg.userTrimmed) && typeof seg.audioEndSec === 'number' && !isNaN(seg.audioEndSec))
        ? seg.audioEndSec
        : (sRawStart + sAudioDur);

      let assignedRow = 0;
      if (typeof seg.trackRow === 'number' && (seg.userShifted || seg.trackRow >= 2)) {
        assignedRow = Math.max(0, seg.trackRow);
        rowEndTimes[assignedRow] = Math.max(rowEndTimes[assignedRow] || 0, sEnd);
      } else if (sRawStart >= (rowEndTimes[0] || 0) - 0.05) {
        rowEndTimes[0] = sEnd;
        assignedRow = 0;
      } else if (sRawStart >= (rowEndTimes[1] || 0) - 0.05) {
        rowEndTimes[1] = sEnd;
        assignedRow = 1;
      } else {
        assignedRow = (rowEndTimes[0] || 0) <= (rowEndTimes[1] || 0) ? 0 : 1;
        rowEndTimes[assignedRow] = Math.max(rowEndTimes[assignedRow] || 0, sEnd);
      }

      if (!occupiedOnRow.has(assignedRow)) occupiedOnRow.set(assignedRow, []);
      occupiedOnRow.get(assignedRow).push([sRawStart, sEnd]);
    });

    let targetRow = 0;
    while (true) {
      const spans = occupiedOnRow.get(targetRow) || [];
      const overlaps = spans.some(([sStart, sEnd]) => safeTime < (sEnd - 0.02) && safeEnd > (sStart + 0.02));
      if (!overlaps) break;
      targetRow++;
    }

    const newSegId = `seg_${Date.now()}`;
    const newSeg = {
      id: newSegId,
      startSec: safeTime,
      endSec: safeEnd,
      start: formatTimecode(safeTime),
      end: formatTimecode(safeEnd),
      audioStartSec: safeTime,
      audioEndSec: safeEnd,
      audioStart: formatTimecode(safeTime),
      audioEnd: formatTimecode(safeEnd),
      audioDurationSec: draftDur,
      speaker: scriptData?.mode === 'recap' ? 'អ្នកសម្រាយរឿង' : 'តួអង្គ',
      speakerGender: 'FEMALE',
      voiceId: 'km-KH-SreymomNeural',
      original: '',
      khmer: '',
      status: 'pending',
      ttsStatus: 'pending',
      trackRow: targetRow,
      trackId: `voice-${targetRow + 1}`,
      userAdded: true,
      userShifted: true,
      userCustomSpeed: false,
    };

    const updated = [...existingSegs];
    updated.splice(insertIdx, 0, newSeg);

    handleUpdateTimelineSegments(updated);
    if (setSelectedSegmentId) {
      setSelectedSegmentId(newSegId);
    }
    return newSeg;
  };

  // 1-Click: Mute or Unmute ONLY video clips that actually have voice audio
  const handleToggleMuteAllCuts = (onlyDialogue = true) => {
    if (!videoClips || videoClips.length === 0) return;
    pushUndoSnapshot(videoClips, scriptData?.segments || []);

    // Set of segment IDs or indices that actually have voice audio
    const voiceSegIds = new Set();
    (scriptData?.segments || []).forEach((s, idx) => {
      const hasAudio = Boolean(
        s.audioFile || s.audioPath || s.audioUrl || (typeof s.audioDurationSec === 'number' && s.audioDurationSec > 0)
      );
      if (hasAudio && !s.muted && !s.isMuted) {
        if (s.id) voiceSegIds.add(String(s.id));
        voiceSegIds.add(String(idx + 1));
      }
    });

    const isClipWithVoice = (c) => {
      if (!c.isDialogue) return false;
      if (typeof c.hasVoice === 'boolean') return c.hasVoice;
      if (voiceSegIds.size === 0) return true;
      return voiceSegIds.has(String(c.segmentId)) || voiceSegIds.has(String(c.segmentIndex));
    };

    const targetClips = onlyDialogue
      ? videoClips.filter(isClipWithVoice)
      : videoClips;

    const clipsToEvaluate = targetClips.length > 0 ? targetClips : videoClips.filter((c) => c.isDialogue);
    const allAlreadyMuted = clipsToEvaluate.length > 0 && clipsToEvaluate.every((c) => Boolean(c.isMuted));
    const nextMuteState = !allAlreadyMuted;

    const updated = videoClips.map((c) => {
      if (onlyDialogue) {
        if (isClipWithVoice(c)) {
          return { ...c, isMuted: nextMuteState };
        }
        // Non-voice clips (Gap or dialogue without audio) are NEVER muted here
        return { ...c, isMuted: false };
      }
      return { ...c, isMuted: nextMuteState };
    });

    setVideoClips(updated);
  };

  // Toggle Mute / Unmute for a single video clip (Mute Original Audio)
  const handleToggleMuteVideoClip = (clipId = null) => {
    if (!videoClips || videoClips.length === 0) return;
    const targetClipId = clipId !== null && clipId !== undefined ? clipId : activeClipId;
    if (!targetClipId) return;
    pushUndoSnapshot(videoClips, scriptData?.segments || []);

    const updated = videoClips.map((c) => {
      if (c.id === targetClipId) {
        return {
          ...c,
          isMuted: !c.isMuted,
        };
      }
      return c;
    });

    setVideoClips(updated);
  };

  // Toggle Mute / Unmute for a single voice segment
  const handleToggleMuteSegment = (segIdOrIdx = null) => {
    if (!scriptData?.segments || scriptData.segments.length === 0) return;
    const targetKey = segIdOrIdx !== null && segIdOrIdx !== undefined ? segIdOrIdx : selectedSegmentId;
    if (targetKey === null || targetKey === undefined) return;

    pushUndoSnapshot(videoClips, scriptData.segments);

    const updated = scriptData.segments.map((seg, idx) => {
      const isTarget = isSegmentMatch(seg, targetKey, idx);
      if (isTarget) {
        return {
          ...seg,
          muted: !seg.muted,
        };
      }
      return seg;
    });

    setScriptData((prev) => prev ? ({ ...prev, segments: updated, updatedAt: Date.now() }) : null);

    if (audioGenerated) {
      syncTimelineAudioApi(updated, getProjectName(), getVideoId(), episodeId, seriesId)
        .then((res) => {
          if (res && res.fullAudioUrl && setFullAudioUrl) {
            const cacheBusted = `${res.fullAudioUrl.split('?')[0]}?t=${Date.now()}`;
            setFullAudioUrl(cacheBusted);
          }
          if (res && res.fullAudioPath && setFullAudioPath) {
            setFullAudioPath(res.fullAudioPath);
          }
        })
        .catch((err) => console.warn('Failed to sync narration after mute toggle:', err));
    }
  };

  // Automatically split a long segment into natural bite-sized sentences
  const handleAutoSplitSegment = (targetId = null) => {
    const segments = scriptData?.segments || [];
    const activeSegKey = targetId !== null && targetId !== undefined ? targetId : selectedSegmentId;
    if (activeSegKey === null || activeSegKey === undefined || segments.length === 0) return;

    let targetIdx = segments.findIndex((s, idx) => isSegmentMatch(s, activeSegKey, idx));
    if (targetIdx === -1) {
      targetIdx = findSegmentIndex(segments, activeSegKey);
    }
    if (targetIdx === -1) return;

    const targetSeg = segments[targetIdx];
    const splitPieces = splitSegmentIntoNaturalSentences(targetSeg);
    if (!splitPieces || splitPieces.length <= 1) return;

    pushUndoSnapshot(videoClips, segments);

    const nextSegments = [...segments];
    nextSegments.splice(targetIdx, 1, ...splitPieces);
    const reindexed = nextSegments.map((item, idx) => ({
      ...item,
      id: idx + 1,
      segmentId: idx + 1,
    }));

    setScriptData((prev) => prev ? ({ ...prev, segments: reindexed, updatedAt: Date.now() }) : null);

    if (audioGenerated) {
      syncTimelineAudioApi(reindexed, getProjectName(), getVideoId(), episodeId, seriesId)
        .then((res) => {
          if (res && res.fullAudioUrl && setFullAudioUrl) {
            setFullAudioUrl(`${res.fullAudioUrl.split('?')[0]}?t=${Date.now()}`);
          }
          if (res && res.fullAudioPath && setFullAudioPath) {
            setFullAudioPath(res.fullAudioPath);
          }
        })
        .catch((err) => console.warn('Failed to sync narration after auto-split:', err));
    }
  };

  return {
    handleSplitClip,
    handleAutoSplitSegment,
    handleAutoSplitVideo,
    handleResetFullVideo,
    handleBridgeGaps,
    handleAutoAlignNoOverlap,
    handleAutoFitSpeechSpeed,
    handleResetToSourceTiming,
    handleSelectClip,
    handleDeleteClip,
    handleUpdateClips,
    handleDeleteSegment,
    handleUpdateTimelineSegments,
    handleAddSegmentAtTime,
    handleToggleMuteSegment,
    handleToggleMuteVideoClip,
    handleToggleMuteAllCuts,
  };
}
