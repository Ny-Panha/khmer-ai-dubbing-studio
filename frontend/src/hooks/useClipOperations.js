import { useCallback } from 'react';
import {
  splitClipAtTime,
  deleteClipById,
  deleteSegmentByIdOrIndex,
  isSegmentMatch,
  findSegmentIndex,
  autoSplitVideoBySegments,
  bridgeClipGaps,
  autoAlignVoiceSegments,
  resetSegmentsToSourceTiming,
} from '../utils/timelineUtils';
import { parseTimeToSeconds, formatTimecode, formatMinSec, getSegmentAudioDuration } from '../utils/timestampUtils';
import { splitKhmerTextIntoHalves, splitSegmentIntoNaturalSentences } from '../utils/khmerTextSplitter';
import { buildSpeakerRegistry } from '../utils/speakerUtils';
import { syncTimelineAudioApi, notifyBackendOffline, notifyBackendOnline } from '../services/api';

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
        const candidates = [slotEnd, effectiveStart + audioDur];
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
      setScriptData((prev) => (prev ? { ...prev, segments: reindexed } : null));
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
    const totalDur = duration > 0 ? duration : (videoRef?.current?.duration || selectedVideo?.durationSec || selectedVideo?.duration || 0);
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
      setScriptData((prev) => prev ? ({ ...prev, segments: updated }) : null);
    }
  };

  // Auto-Align Voice Segments anchored to canonical source timing (Zero Cumulative Drift)
  const handleAutoAlignNoOverlap = useCallback(async () => {
    const currentSegments = scriptData?.segments;
    if (!Array.isArray(currentSegments) || currentSegments.length === 0) {
      return;
    }

    try {
      pushUndoSnapshot(videoClips, currentSegments);
    } catch (err) {
      console.warn('[useClipOperations] pushUndoSnapshot failed in handleAutoAlignNoOverlap:', err);
    }

    // 1. Calculate canonical video duration
    const totalDur = Number(
      duration ||
      videoRef?.current?.duration ||
      selectedVideo?.duration ||
      0
    );

    // 2. Align voice segments strictly anchored to sourceStartSec (Max Shift <= 0.35s, 0% video overflow)
    const alignedSegments = autoAlignVoiceSegments(currentSegments, totalDur, {
      minGapSec: 0.04,
      maxShiftSec: 0.35,
      maxPlaybackSpeed: 1.45,
    });

    const nextScriptData = {
      ...scriptData,
      segments: alignedSegments,
    };

    setScriptData(nextScriptData);

    // 3. Keep user's existing video cuts intact (do not wipe out or reset cut clips)

    // 4. Update master narration track on Backend
    try {
      const hasGeneratedAudio = alignedSegments.some((s) => s.audioFile || s.audioPath || s.audioUrl);
      if (hasGeneratedAudio || audioGenerated) {
        const syncRes = await syncTimelineAudioApi(
          alignedSegments,
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
      console.warn('[useClipOperations] Auto-align audio sync notice:', err.message);
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
    setVideoClips,
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

  // Delete Clip Tool
  const handleDeleteClip = (clipId = null) => {
    const targetClipId = clipId !== null && clipId !== undefined ? clipId : activeClipId;
    if (!targetClipId) return;
    pushUndoSnapshot(videoClips);
    const updated = deleteClipById(videoClips, targetClipId, { allowEmpty: true });
    setVideoClips(updated);
    setActiveClipId(updated[0]?.id || null);
  };

  // Update Clips (Drag/Trim) with optional synchronized segments
  const handleUpdateClips = (newClips, updatedSegments = null) => {
    pushUndoSnapshot(videoClips, scriptData?.segments || []);
    setVideoClips(newClips);
    if (updatedSegments && updatedSegments.length) {
      handleUpdateTimelineSegments(updatedSegments, true, true);
    }
  };

  // Delete a Subtitle Segment
  const handleDeleteSegment = async (segIdOrIdx = null) => {
    if (!scriptData?.segments) return;
    const targetKey = segIdOrIdx !== null && segIdOrIdx !== undefined ? segIdOrIdx : selectedSegmentId;
    if (targetKey === null || targetKey === undefined) return;

    pushUndoSnapshot(videoClips, scriptData.segments);
    const updated = deleteSegmentByIdOrIndex(scriptData.segments, targetKey);
    if (updated === scriptData.segments) return;

    if (syncAudioTimeoutRef?.current) clearTimeout(syncAudioTimeoutRef.current);

    if (updated.length) {
      const updatedReg = buildSpeakerRegistry(updated, speakerRegistry);
      if (setSpeakerRegistry) setSpeakerRegistry(updatedReg);
    }
    setScriptData(prev => prev ? ({ ...prev, segments: updated }) : null);
    if (setSelectedSegmentId) setSelectedSegmentId(null);

    const hasAudios = Boolean(updated.some(s => s.audioFile || s.audioPath || s.audioUrl));
    if (!hasAudios) {
      if (setFullAudioUrl) setFullAudioUrl(null);
      if (setFullAudioPath) setFullAudioPath(null);
      return;
    }

    // Trigger immediate audio re-sync on delete to eliminate stale audio
    if (audioGenerated && hasAudios) {
      try {
        const res = await syncTimelineAudioApi(updated, getProjectName(), getVideoId(), episodeId, seriesId);
        if (res && res.fullAudioUrl && setFullAudioUrl) {
          const cacheBusted = `${res.fullAudioUrl.split('?')[0]}?t=${Date.now()}`;
          setFullAudioUrl(cacheBusted);
          if (setFullAudioPath) setFullAudioPath(res.fullAudioPath);
        }
      } catch (e) {
        console.warn('Immediate audio re-sync on delete error:', e.message);
      }
    }
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
    setScriptData(prev => (prev ? ({ ...prev, segments: newSegments }) : null));

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
    const safeTime = Math.max(0, parseFloat(rawTime.toFixed(2)));

    pushUndoSnapshot(videoClips, scriptData?.segments || []);

    const existingSegs = scriptData?.segments || [];

    // Find slot where this timestamp falls
    let insertIdx = existingSegs.findIndex(s => {
      const sStart = typeof s.startSec === 'number' ? s.startSec : parseTimeToSeconds(s.start, 0);
      return sStart > safeTime;
    });
    if (insertIdx === -1) insertIdx = existingSegs.length;

    // Check next segment start to prevent collision
    let nextStart = safeTime + 3.0;
    if (insertIdx < existingSegs.length) {
      const nextSeg = existingSegs[insertIdx];
      const nextSegStart = typeof nextSeg.startSec === 'number' ? nextSeg.startSec : parseTimeToSeconds(nextSeg.start, 0);
      if (nextSegStart > safeTime) {
        nextStart = Math.min(safeTime + 3.0, Math.max(safeTime + 1.0, parseFloat((nextSegStart - 0.1).toFixed(2))));
      }
    }
    const safeEnd = parseFloat(nextStart.toFixed(2));

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
      speaker: scriptData?.mode === 'recap' ? 'អ្នកសម្រាយរឿង' : 'តួអង្គ',
      speakerGender: 'FEMALE',
      voiceId: 'km-KH-SreymomNeural',
      original: '',
      khmer: '',
      status: 'pending',
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

  // 1-Click: Mute or Unmute ALL cut video clips at once (eliminates tedious one-by-one muting)
  const handleToggleMuteAllCuts = (onlyDialogue = true) => {
    if (!videoClips || videoClips.length === 0) return;
    pushUndoSnapshot(videoClips, scriptData?.segments || []);

    const targetClips = onlyDialogue
      ? videoClips.filter((c) => c.isDialogue)
      : videoClips;

    const clipsToEvaluate = targetClips.length > 0 ? targetClips : videoClips;
    const allAlreadyMuted = clipsToEvaluate.every((c) => Boolean(c.isMuted));
    const nextMuteState = !allAlreadyMuted;

    const updated = videoClips.map((c) => {
      if (onlyDialogue && targetClips.length > 0) {
        if (c.isDialogue) {
          return { ...c, isMuted: nextMuteState };
        }
        return c;
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

    setScriptData((prev) => prev ? ({ ...prev, segments: updated }) : null);

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

    setScriptData((prev) => prev ? ({ ...prev, segments: reindexed }) : null);

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
