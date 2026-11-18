import { useCallback } from 'react';
import {
  isSegmentMatch,
  findSegmentIndex,
  autoSplitVideoBySegments,
  bridgeClipGaps,
} from '../utils/timelineUtils';
import {
  deleteSegment as deleteSegmentOp,
  deleteVideoClip as deleteVideoClipOp,
  deleteGap as deleteGapOp,
  splitClip as splitClipOp,
  splitSegment as splitSegmentOp,
  autoAlign as autoAlignOp,
  isGapClip,
} from '../utils/timelineOps';
import { parseTimeToSeconds, formatTimecode, formatMinSec, getSegmentAudioDuration } from '../utils/timestampUtils';
import { splitSegmentIntoNaturalSentences } from '../utils/khmerTextSplitter';
import { buildSpeakerRegistry } from '../utils/speakerUtils';
import { syncTimelineAudioApi, persistTimelineOperationApi, notifyBackendOffline, notifyBackendOnline } from '../services/api';
import { saveTimelineOperationToLocalStorage } from '../utils/projectStorage';

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
    toast.style.padding = '10px 18px';
    toast.style.borderRadius = '14px';
    toast.style.maxWidth = 'min(92vw, 760px)';
    toast.style.lineHeight = '1.45';
    toast.style.fontSize = '13px';
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
  const leadingEmoji = message.match(/^([\uD800-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27BF]|\uFE0F|⚠️|⚡|✅|❌|✂️|ℹ️|✨|📌)/);
  const iconSpan = leadingEmoji ? leadingEmoji[0] : '✂️';
  const displayMsg = leadingEmoji ? message.slice(leadingEmoji[0].length).trim() : message;
  toast.innerHTML = '';
  const iconEl = document.createElement('span');
  iconEl.style.fontSize = '15px';
  iconEl.style.lineHeight = '1';
  iconEl.style.flexShrink = '0';
  iconEl.textContent = iconSpan;
  const textEl = document.createElement('span');
  textEl.textContent = displayMsg;
  toast.appendChild(iconEl);
  toast.appendChild(textEl);
  toast.style.opacity = '1';
  toast.style.transform = 'translateX(-50%) translateY(0)';

  if (toast._timer) clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(8px)';
  }, durationMs);
}

function formatClipNumberSummary(clipNumbers = [], maxShown = 8) {
  const unique = [...new Set((clipNumbers || []).filter((n) => n !== null && n !== undefined))];
  if (unique.length === 0) return '';
  const shown = unique.slice(0, maxShown).map((n) => `#${n}`).join(', ');
  const remaining = unique.length - maxShown;
  return remaining > 0 ? `${shown} (+${remaining} ទៀត)` : shown;
}

function buildAutoAlignToastMessage(report = {}, segmentsChanged = false) {
  const movedCount = Number(report?.movedCount) || 0;
  const relanedNums = (report?.relanedClips || []).map((c) => c.clipNumber);
  const overrunNums = (report?.overrunClips || []).map((c) => c.clipNumber);
  const clampedNums = (report?.clampedClips || []).map((c) => c.clipNumber);

  const parts = [];
  if (segmentsChanged && movedCount > 0) {
    parts.push(`តម្រៀប ${movedCount} ឃ្លាត្រង់តាម slot`);
  } else if (segmentsChanged) {
    parts.push('បានអាប់ដេតការតម្រៀប timeline');
  } else {
    parts.push('គ្រប់ឃ្លានៅត្រង់ slot រួចហើយ');
  }

  if (relanedNums.length > 0) {
    parts.push(`ប្តូរជួរ VOICE ដើម្បីកុំជាន់គ្នា (${formatClipNumberSummary(relanedNums, 6)})`);
  }
  if (overrunNums.length > 0) {
    parts.push(`⚠️ សំឡេងវែងជាង slot មិនអាចបង្រួមដោយ Auto-Align: ${formatClipNumberSummary(overrunNums, 8)}`);
  }
  if (clampedNums.length > 0) {
    parts.push(`⚠️ ហួសចុងវីដេអូ: ${formatClipNumberSummary(clampedNums, 5)}`);
  }

  const prefix = overrunNums.length > 0 || clampedNums.length > 0 ? '⚠️ Auto-Align:' : '✅ Auto-Align:';
  return `${prefix} ${parts.join(' · ')}`;
}

/**
 * Custom hook to handle multi-clip timeline editing operations (split, cut, bridge, re-sync)
 */
export function useClipOperations({
  videoClips,
  setVideoClips,
  setVideoClipsUpdatedAt = null,
  activeClipId,
  setActiveClipId,
  duration,
  setDuration,
  selectedVideo,
  videoMetadata = null,
  videoRef,
  scriptData,
  setScriptData,
  speakerRegistry,
  setSpeakerRegistry,
  audioGenerated,
  setSelectedSegmentId,
  selectedClipKind = null,
  setSelectedClipKind = null,
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
    const totalDur = Number(
      duration ||
      videoRef?.current?.duration ||
      selectedVideo?.durationSec ||
      selectedVideo?.duration ||
      videoMetadata?.durationSec ||
      videoMetadata?.duration ||
      0
    );
    const targetTime = typeof splitTime === 'number' && !isNaN(splitTime) ? splitTime : 0;
    const roundedSplit = parseFloat(targetTime.toFixed(3));

    const segments = scriptData?.segments || [];
    const currentClips = videoClips || [];

    const isTargetingVideoClip = selectedClipKind === 'video' || Boolean(
      targetId && currentClips.some((c) => c.id === targetId)
    );

    // (a) split the selected segment only when the video track is not explicitly targeted
    let selectedSegKey = null;
    if (!isTargetingVideoClip) {
      const isSegmentExplicitlySelected = (selectedClipKind === 'voice' || selectedClipKind === 'subtitle') || (
        selectedClipKind !== 'video' && Boolean(targetId && segments.some((s, idx) => isSegmentMatch(s, targetId, idx)))
      );
      if (isSegmentExplicitlySelected) {
        const activeSegKey = targetId !== null && targetId !== undefined ? targetId : selectedSegmentId;
        if (activeSegKey !== null && activeSegKey !== undefined && segments.length > 0) {
          selectedSegKey = activeSegKey;
        }
      }
    }

    const currentState = {
      videoClips: currentClips,
      segments,
    };

    if (selectedSegKey !== null) {
      const segOpResult = splitSegmentOp(currentState, {
        segKey: selectedSegKey,
        splitTime: roundedSplit,
      });

      if (segOpResult.applied) {
        pushUndoSnapshot(currentClips, segments);
        setScriptData((prev) => (prev ? { ...prev, segments: segOpResult.state.segments, updatedAt: Date.now() } : null));
        if (setSelectedSegmentId && segOpResult.newSegmentId) {
          setSelectedSegmentId(segOpResult.newSegmentId);
        }

        // Re-sync timeline narration audio
        if (audioGenerated && syncTimelineAudioApi) {
          if (syncAudioTimeoutRef?.current) clearTimeout(syncAudioTimeoutRef.current);
          syncTimelineAudioApi(segOpResult.state.segments, getProjectName(), getVideoId(), episodeId, seriesId).then((res) => {
            if (res?.fullAudioUrl && setFullAudioUrl) {
              setFullAudioUrl(`${res.fullAudioUrl.split('?')[0]}?t=${Date.now()}`);
              if (setFullAudioPath) setFullAudioPath(res.fullAudioPath);
            }
          }).catch((err) => console.warn('Audio sync after segment split error:', err.message));
        }

        return true;
      }
      // If playhead was outside the selected segment, fall through to split the video clip under playhead per spec R4!
    }

    // (b) split the video clip under the playhead, including Gaps
    const activeVideoId = isTargetingVideoClip ? targetId : activeClipId;
    const clipDefaults = {
      name: selectedVideo?.originalFilename || selectedVideo?.fileName || 'Video 1',
      videoUrl: selectedVideo?.videoUrl || null,
      videoId: selectedVideo?.videoId || null,
    };

    const clipOpResult = splitClipOp(currentState, {
      splitTime: roundedSplit,
      activeClipId: activeVideoId,
      totalDuration: totalDur,
      clipDefaults,
    });

    if (clipOpResult.applied) {
      pushUndoSnapshot(currentClips, segments);
      setVideoClips(clipOpResult.state.videoClips);
      if (typeof setVideoClipsUpdatedAt === 'function') {
        setVideoClipsUpdatedAt(Date.now());
      }
      if (clipOpResult.activeClipId) {
        setActiveClipId(clipOpResult.activeClipId);
      }
      if (typeof setSelectedClipKind === 'function') {
        setSelectedClipKind('video');
      }
      return true;
    }

    // (c) Neither branch applied -> show toast with reason
    showInAppToast(clipOpResult.reason || 'គ្មាន clip នៅត្រង់ playhead ទេ — ដាក់ playhead ឲ្យនៅកណ្ដាល clip');
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

  // Auto-Align Voice Segments anchored to canonical source timing (Zero Cumulative Drift)
  const handleAutoAlignNoOverlap = useCallback(async () => {
    const currentSegments = scriptData?.segments;
    if (!Array.isArray(currentSegments) || currentSegments.length === 0) {
      return;
    }

    const totalDur = Number(
      duration ||
      videoRef?.current?.duration ||
      selectedVideo?.duration ||
      0
    );

    const currentState = {
      videoClips: videoClips || [],
      segments: currentSegments,
    };

    const opResult = autoAlignOp(currentState, {
      totalDuration: totalDur,
      originalTimingSnapshot: scriptData?.originalTimingSnapshot || null,
      options: {
        minGapSec: 0.04,
        maxShiftSec: 0.35,
        maxPlaybackSpeed: 1.45,
      },
    });

    if (!opResult.applied) {
      showInAppToast(opResult.reason || '⚠️ Auto-Align មិនអាចអនុវត្តបានទេ', 4500);
      return;
    }

    const alignedSegments = opResult.state.segments;

    // Hard guard: Auto-Align is a MOVE-ONLY transform. Segment count in == segment count out, always.
    if (!Array.isArray(alignedSegments) || alignedSegments.length !== currentSegments.length) {
      console.warn(
        `[useClipOperations] Auto-Align aborted: segment count mismatch (in: ${currentSegments.length}, out: ${alignedSegments?.length ?? 0}). Auto-Align is move-only and must never add or remove segments.`
      );
      showInAppToast('⚠️ Auto-Align រក្សាទុកឃ្លាដើម៖ ចំនួន segments មិនត្រូវផ្លាស់ប្ដូរឡើយ', 4500);
      return;
    }

    const segmentTimelineSignature = (segments = []) => segments.map((seg) => ([
      seg?._uid ?? null,
      seg?.id ?? null,
      seg?.segmentId ?? null,
      seg?.startSec ?? null,
      seg?.endSec ?? null,
      seg?.audioStartSec ?? null,
      seg?.audioEndSec ?? null,
      seg?.sourceStartSec ?? null,
      seg?.sourceEndSec ?? null,
      seg?.duration ?? null,
      seg?.audioDurationSec ?? null,
      seg?.finalAudioDuration ?? null,
      seg?.trackRow ?? null,
      seg?.trackId ?? null,
      seg?.subTrackRow ?? null,
      seg?.subTrackId ?? null,
      Boolean(seg?.audioTrimmed || seg?.userTrimmed),
      Boolean(seg?.audioOverrun),
      seg?.overrunRatio ?? null,
      seg?.playbackRate ?? null,
      Boolean(seg?.needsTimeStretch),
      Boolean(seg?.userShifted),
    ]));

    const segmentsChanged = JSON.stringify(segmentTimelineSignature(currentSegments)) !== JSON.stringify(segmentTimelineSignature(alignedSegments));

    const toastMessage = buildAutoAlignToastMessage(opResult.report, segmentsChanged);
    showInAppToast(toastMessage, (opResult.report?.overrunClips?.length || 0) > 0 ? 6000 : 4000);

    // Auto-Align can normalize optional metadata even when the timeline already
    // matches. Avoid autosaving that normalization as if the user had edited it.
    if (!segmentsChanged) return;

    try {
      pushUndoSnapshot(videoClips, currentSegments);
    } catch (err) {
      console.warn('[useClipOperations] pushUndoSnapshot failed in handleAutoAlignNoOverlap:', err);
    }

    const nextScriptData = {
      ...scriptData,
      segments: alignedSegments,
      updatedAt: Date.now(),
    };
    setScriptData(nextScriptData);

    // Update master narration track on Backend
    try {
      const hasGeneratedAudio = alignedSegments.some((s) => s.audioFile || s.audioPath || s.audioUrl);
      if (segmentsChanged && (hasGeneratedAudio || audioGenerated)) {
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
    syncTimelineAudioApi,
    getProjectName,
    getVideoId,
    setFullAudioUrl,
    setFullAudioPath,
  ]);

  // Select clip and seek playhead to its start (only seek when paused / explicit user gesture, never during continuous playback)
  const handleSelectClip = (clipId, shouldSeek = true) => {
    setActiveClipId(clipId);
    const isVideoPlaying = Boolean(videoRef?.current && !videoRef.current.paused);
    const target = videoClips.find((c) => c.id === clipId);
    if (shouldSeek && !isVideoPlaying && target && handleSeek) {
      handleSeek(target.start);
    }
  };

  // Delete only the selected video clip.
  const handleDeleteClip = async (clipId = null) => {
    const targetClipId = clipId !== null && clipId !== undefined ? clipId : activeClipId;
    if (!targetClipId) return;

    const targetClip = (videoClips || []).find((c) => c.id === targetClipId);
    if (!targetClip) return;

    const currentState = {
      videoClips: videoClips || [],
      segments: scriptData?.segments || [],
    };

    const isTargetGap = isGapClip(targetClip);
    const opResult = isTargetGap
      ? deleteGapOp(currentState, { clipId: targetClipId })
      : deleteVideoClipOp(currentState, { clipId: targetClipId, totalDuration: duration });

    if (!opResult.applied) {
      if (opResult.reason) showInAppToast(opResult.reason);
      return;
    }

    pushUndoSnapshot(videoClips, scriptData?.segments || []);
    const updated = opResult.state.videoClips;
    const updatedSegments = opResult.state.segments;

    const localSave = saveTimelineOperationToLocalStorage({
      seriesId,
      episodeId,
      operation: 'delete',
      track: 'videoClips',
      items: updated,
      deletedItem: targetClip,
      segments: updatedSegments,
    });
    setVideoClips(updated);
    if (isTargetGap && updatedSegments && setScriptData) {
      setScriptData(prev => prev ? ({ ...prev, segments: updatedSegments, updatedAt: Date.now() }) : null);
    }
    if (localSave?.videoClipsUpdatedAt && setVideoClipsUpdatedAt) {
      setVideoClipsUpdatedAt(localSave.videoClipsUpdatedAt);
    }
    setActiveClipId(updated[0]?.id || null);
    try {
      await persistTimelineOperationApi({
        seriesId,
        episodeId,
        operation: 'delete',
        track: 'videoClips',
        items: updated,
        deletedItem: targetClip,
        segments: updatedSegments,
      });
    } catch (err) {
      console.warn('[useClipOperations] Could not immediately persist deleted video clip:', err.message);
    }
  };

  // Update Clips (Drag/Trim) with optional synchronized segments
  const handleUpdateClips = (newClips, updatedSegments = null) => {
    pushUndoSnapshot(videoClips, scriptData?.segments || []);
    setVideoClips(newClips);
    if (updatedSegments && updatedSegments.length) {
      handleUpdateTimelineSegments(updatedSegments, true, true);
    }
  };

  // Delete only the selected subtitle/voice segment.
  const handleDeleteSegment = async (segIdOrIdx = null) => {
    if (!scriptData?.segments) return;
    const targetKey = segIdOrIdx !== null && segIdOrIdx !== undefined ? segIdOrIdx : selectedSegmentId;
    if (targetKey === null || targetKey === undefined) return;

    const targetSegIdx = findSegmentIndex(scriptData.segments, targetKey);
    const targetSeg = targetSegIdx !== -1 ? scriptData.segments[targetSegIdx] : null;

    const segmentKey = targetSeg
      ? (targetSeg._uid || targetSeg.id || targetSeg.segmentId || targetSegIdx)
      : targetKey;

    const currentState = {
      videoClips: videoClips || [],
      segments: scriptData.segments,
    };

    const opResult = deleteSegmentOp(currentState, { segKey: segmentKey });
    if (!opResult.applied) {
      if (opResult.reason) showInAppToast(opResult.reason);
      return;
    }

    pushUndoSnapshot(videoClips, scriptData.segments);
    const updated = opResult.state.segments;

    const localSave = saveTimelineOperationToLocalStorage({
      seriesId,
      episodeId,
      operation: 'delete',
      track: 'segments',
      items: updated,
      deletedItem: targetSeg,
    });
    const deleteUpdatedAt = localSave?.updatedAt || Date.now();

    if (syncAudioTimeoutRef?.current) clearTimeout(syncAudioTimeoutRef.current);

    if (updated.length) {
      const updatedReg = buildSpeakerRegistry(updated, speakerRegistry);
      if (setSpeakerRegistry) setSpeakerRegistry(updatedReg);
    }
    setScriptData(prev => prev ? ({
      ...prev,
      segments: updated,
      hasScript: updated.length > 0,
      totalSegments: updated.length,
      explicitClear: updated.length === 0,
      updatedAt: deleteUpdatedAt,
    }) : null);
    if (setSelectedSegmentId) setSelectedSegmentId(null);

    try {
      const persisted = await persistTimelineOperationApi({
        seriesId,
        episodeId,
        operation: 'delete',
        track: 'segments',
        items: updated,
        deletedItem: targetSeg,
        deletedIndex: targetSegIdx,
      });
      if (persisted?.updatedAt) {
        setScriptData((prev) => prev ? { ...prev, updatedAt: Math.max(Number(prev.updatedAt || 0), persisted.updatedAt) } : prev);
      }
    } catch (err) {
      console.warn('[useClipOperations] Could not immediately persist deleted voice segment:', err.message);
    }

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
    handleSelectClip,
    handleDeleteClip,
    handleUpdateClips,
    handleDeleteSegment,
    handleUpdateTimelineSegments,
    handleAddSegmentAtTime,
    handleToggleMuteSegment,
    handleToggleMuteVideoClip,
  };
}
