import { 
  splitClipAtTime, 
  deleteClipById, 
  deleteSegmentByIdOrIndex,
  autoSplitVideoBySegments, 
  bridgeClipGaps 
} from '../utils/timelineUtils';
import { parseTimeToSeconds, formatTimecode, formatMinSec } from '../utils/formatTime';
import { splitKhmerTextIntoHalves, splitSegmentIntoNaturalSentences } from '../utils/khmerTextSplitter';
import { buildSpeakerRegistry } from '../utils/speakerUtils';
import { syncTimelineAudioApi } from '../services/api';

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
  pushUndoSnapshot,
  setFullAudioUrl,
  setFullAudioPath,
  syncAudioTimeoutRef,
  seriesId = null,
  episodeId = null,
  setAudioOutdated = null,
}) {
  const getProjectName = () => selectedVideo?.projectName || selectedVideo?.title || selectedVideo?.name || selectedVideo?.fileName || '';
  const getVideoId = () => selectedVideo?.id || selectedVideo?.videoId || '';

  // Split Clip & Segment Tool (Scissors at Playhead)
  const handleSplitClip = (splitTime, targetId = null) => {
    const totalDur = duration > 0 ? duration : (videoRef?.current?.duration || 0);
    const targetTime = typeof splitTime === 'number' && !isNaN(splitTime) ? splitTime : 0;
    const roundedSplit = parseFloat(targetTime.toFixed(3));

    // 1. Check if a dialogue / voice / subtitle segment is targeted or selected
    const segments = scriptData?.segments || [];
    let targetSegIdx = -1;

    // Check by targetId or selectedSegmentId first
    const activeSegKey = targetId !== null && targetId !== undefined ? targetId : selectedSegmentId;
    if (activeSegKey !== null && activeSegKey !== undefined) {
      targetSegIdx = segments.findIndex((s, idx) => {
        const matchesKey = String(s.id) === String(activeSegKey) || idx === Number(activeSegKey);
        if (!matchesKey) return false;
        const sStart = typeof s.audioStartSec === 'number' && !isNaN(s.audioStartSec) 
          ? s.audioStartSec 
          : (typeof s.startSec === 'number' ? s.startSec : parseTimeToSeconds(s.start, 0));
        const sEnd = typeof s.audioEndSec === 'number' && !isNaN(s.audioEndSec) 
          ? s.audioEndSec 
          : (typeof s.endSec === 'number' ? s.endSec : parseTimeToSeconds(s.end, sStart + 3.0));
        return roundedSplit > sStart + 0.05 && roundedSplit < sEnd - 0.05;
      });
    }

    // If not found by active key, check if any segment intersects splitTime
    let anyIntersectingSegIdx = -1;
    if (targetSegIdx === -1 && segments.length > 0) {
      anyIntersectingSegIdx = segments.findIndex((s) => {
        const sStart = typeof s.audioStartSec === 'number' && !isNaN(s.audioStartSec) 
          ? s.audioStartSec 
          : (typeof s.startSec === 'number' ? s.startSec : parseTimeToSeconds(s.start, 0));
        const sEnd = typeof s.audioEndSec === 'number' && !isNaN(s.audioEndSec) 
          ? s.audioEndSec 
          : (typeof s.endSec === 'number' ? s.endSec : parseTimeToSeconds(s.end, sStart + 3.0));
        return roundedSplit > sStart + 0.05 && roundedSplit < sEnd - 0.05;
      });
    }

    // 2. Check if a video clip is targeted or selected or intersects splitTime
    let currentClips = videoClips;
    if (!currentClips || currentClips.length === 0 || (currentClips.length === 1 && currentClips[0].end <= currentClips[0].start)) {
      currentClips = [
        { id: `clip-${Date.now()}`, start: 0, end: totalDur, name: selectedVideo?.fileName || 'Video 1', trackRow: 0, trackId: 'video-1' }
      ];
    }

    const videoSplitResult = splitClipAtTime(currentClips, roundedSplit, totalDur, activeClipId);

    // If an explicit segment was targeted/selected, prioritize splitting the segment
    const shouldSplitSegment = targetSegIdx !== -1 || (anyIntersectingSegIdx !== -1 && !videoSplitResult);
    const finalSegIdx = targetSegIdx !== -1 ? targetSegIdx : anyIntersectingSegIdx;

    let hasSplitAnything = false;

    // Split Segment
    if (finalSegIdx >= 0 && (shouldSplitSegment || !activeClipId)) {
      const targetSeg = segments[finalSegIdx];
      const sStart = typeof targetSeg.audioStartSec === 'number' && !isNaN(targetSeg.audioStartSec) 
        ? targetSeg.audioStartSec 
        : (typeof targetSeg.startSec === 'number' ? targetSeg.startSec : parseTimeToSeconds(targetSeg.start, 0));
      const sEnd = typeof targetSeg.audioEndSec === 'number' && !isNaN(targetSeg.audioEndSec) 
        ? targetSeg.audioEndSec 
        : (typeof targetSeg.endSec === 'number' ? targetSeg.endSec : parseTimeToSeconds(targetSeg.end, sStart + 3.0));
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
      const fullChinese = (targetSeg.originalChineseText || targetSeg.originalText || targetSeg.original || '').trim();
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

      const seg1 = {
        ...targetSeg,
        start: formatMinSec(sStart),
        end: formatMinSec(roundedSplit),
        startSec: sStart,
        endSec: roundedSplit,
        audioStart: formatMinSec(sStart),
        audioEnd: formatMinSec(roundedSplit),
        audioStartSec: sStart,
        audioEndSec: roundedSplit,
        audioDurationSec: dur1,
        khmer: part1,
        khmerText: part1,
        khmerTranslatedText: part1,
        original: cnPart1,
        originalText: cnPart1,
        originalChineseText: cnPart1,
        english: engPart1,
        audioGenerated: false,
        audioFile: null,
        audioPath: null,
        audioUrl: null,
        audioOutdated: true,
        ttsStatus: 'pending',
        userShifted: true,
      };

      const seg2 = {
        ...targetSeg,
        id: `seg-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        start: formatMinSec(roundedSplit),
        end: formatMinSec(sEnd),
        startSec: roundedSplit,
        endSec: sEnd,
        audioStart: formatMinSec(roundedSplit),
        audioEnd: formatMinSec(sEnd),
        audioStartSec: roundedSplit,
        audioEndSec: sEnd,
        audioDurationSec: dur2,
        khmer: part2,
        khmerText: part2,
        khmerTranslatedText: part2,
        original: cnPart2 || cnPart1,
        originalText: cnPart2 || cnPart1,
        originalChineseText: cnPart2 || cnPart1,
        english: engPart2,
        audioGenerated: false,
        audioFile: null,
        audioPath: null,
        audioUrl: null,
        audioOutdated: true,
        ttsStatus: 'pending',
        userShifted: true,
      };

      const nextSegments = [...segments];
      nextSegments.splice(finalSegIdx, 1, seg1, seg2);
      const reindexed = nextSegments.map((item, idx) => ({
        ...item,
        id: idx + 1,
      }));

      pushUndoSnapshot(videoSplitResult ? videoSplitResult.newClips : currentClips, segments);
      setScriptData(prev => prev ? ({ ...prev, segments: reindexed }) : null);
      if (typeof setAudioOutdated === "function") setAudioOutdated(true);
      if (setSelectedSegmentId) setSelectedSegmentId(finalSegIdx + 2);

      // Re-sync timeline narration audio
      if (audioGenerated && syncTimelineAudioApi) {
        if (syncAudioTimeoutRef?.current) clearTimeout(syncAudioTimeoutRef.current);
        syncTimelineAudioApi(reindexed, getProjectName(), getVideoId(), episodeId, seriesId).then(res => {
          if (res?.fullAudioUrl && setFullAudioUrl) {
            setFullAudioUrl(`${res.fullAudioUrl.split('?')[0]}?t=${Date.now()}`);
            if (setFullAudioPath) setFullAudioPath(res.fullAudioPath);
          }
        }).catch(err => console.warn('Audio sync after segment split error:', err.message));
      }

      hasSplitAnything = true;
    }

    // Split Video Clip if video clip was targeted/intersected
    if (videoSplitResult && (!shouldSplitSegment || activeClipId)) {
      if (!hasSplitAnything) {
        pushUndoSnapshot(currentClips, segments);
      }
      setVideoClips(videoSplitResult.newClips);
      setActiveClipId(videoSplitResult.activeClipId);
      hasSplitAnything = true;
    } else if (videoSplitResult && hasSplitAnything && !targetId && !selectedSegmentId) {
      // If neither was explicitly selected, razor both video & segment under playhead
      setVideoClips(videoSplitResult.newClips);
    }

    return hasSplitAnything;
  };

  // CapCut-style Auto-Split Video by Subtitles/Dialogue
  const handleAutoSplitVideo = () => {
    if (!scriptData?.segments || scriptData.segments.length === 0) {
      alert('សូមបង្កើត Script ឬបកប្រែសន្ទនាជាមុនសិន!');
      return;
    }
    const totalDur = duration > 0 ? duration : (videoRef?.current?.duration || 0);
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
    const totalDur = duration > 0 ? duration : (videoRef?.current?.duration || selectedVideo?.duration || 0);
    if (totalDur > 0) {
      const fullClip = [
        { 
          id: `clip-${Date.now()}`, 
          start: 0, 
          end: totalDur, 
          sourceStart: 0, 
          sourceEnd: totalDur, 
          duration: totalDur,
          name: selectedVideo?.fileName || 'Full Video',
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

  // Auto-Align & Cascade Segments & Video Clips (CapCut Multi-Track Ripple)
  const handleAutoAlignNoOverlap = () => {
    pushUndoSnapshot(videoClips, scriptData?.segments || []);

    // 1. Auto-ripple video clips to start cleanly at 00:00 without gaps, preserving video tracks
    if (videoClips && videoClips.length > 0) {
      const videoTrackEnds = {};
      const sorted = [...videoClips].sort((a, b) => (a.start || 0) - (b.start || 0));
      const alignedVideos = sorted.map((c) => {
        const row = typeof c.trackRow === 'number' ? c.trackRow : 0;
        const dur = Math.max(0.4, (c.end || 0) - (c.start || 0));
        const prevEnd = videoTrackEnds[row] !== undefined ? videoTrackEnds[row] : 0;
        const newStart = prevEnd;
        const newEnd = parseFloat((newStart + dur).toFixed(2));
        videoTrackEnds[row] = newEnd;
        return {
          ...c,
          start: newStart,
          end: newEnd,
          trackId: c.trackId || `video-${row + 1}`,
          trackRow: row,
        };
      });
      setVideoClips(alignedVideos);
    }

    if (!scriptData?.segments || scriptData.segments.length <= 1) return;

    // 2. Track-aware Voice Ripple Alignment:
    // Aligns clips independently per track row so they NEVER crush into a single line!
    const trackLastEnd = {};

    const aligned = scriptData.segments.map((seg, idx) => {
      // Determine segment trackRow:
      // 1. Preserve explicit trackRow if set by user or system
      // 2. Otherwise determine by speaker gender or alternation (e.g. Female -> Track 1, Male -> Track 2)
      let targetRow = 0;
      if (typeof seg.trackRow === 'number' && seg.trackRow >= 0) {
        targetRow = seg.trackRow;
      } else {
        const rawGender = String(seg.speakerGender || seg.gender || '').toUpperCase().trim();
        const speakerName = String(seg.speaker || seg.speakerName || '').trim();
        const reg = speakerRegistry?.[seg.speakerId] || speakerRegistry?.[speakerName];
        const regGender = String(reg?.gender || '').toUpperCase().trim();
        const effGender = rawGender || regGender;

        if (effGender === 'MALE' || effGender === 'BOY' || effGender === 'MAN') {
          targetRow = 1;
        } else if (effGender === 'FEMALE' || effGender === 'GIRL' || effGender === 'WOMAN') {
          targetRow = 0;
        } else {
          targetRow = (idx % 2 === 1) ? 1 : 0;
        }
      }

      const audioDur = typeof seg.audioDurationSec === 'number' && seg.audioDurationSec > 0
        ? seg.audioDurationSec
        : (typeof seg.endSec === 'number' && typeof seg.startSec === 'number' && seg.endSec > seg.startSec
          ? parseFloat((seg.endSec - seg.startSec).toFixed(2))
          : 2.5);

      const rawStart = (typeof seg.audioStartSec === 'number' && !isNaN(seg.audioStartSec))
        ? seg.audioStartSec
        : (typeof seg.startSec === 'number' && !isNaN(seg.startSec)
          ? seg.startSec
          : parseTimeToSeconds(seg.start, idx * 4));

      const rowLastEnd = trackLastEnd[targetRow] !== undefined ? trackLastEnd[targetRow] : 0;
      // In the same track lane, avoid overlapping with previous segment on THIS lane (with natural 0.15s pause)
      const safeStart = Math.max(rawStart, parseFloat((rowLastEnd + 0.15).toFixed(2)));
      const safeEnd = parseFloat((safeStart + audioDur).toFixed(2));
      trackLastEnd[targetRow] = safeEnd;

      return {
        ...seg,
        audioStartSec: safeStart,
        audioEndSec: safeEnd,
        startSec: safeStart,
        endSec: safeEnd,
        start: formatTimecode(safeStart),
        end: formatTimecode(safeEnd),
        audioStart: formatTimecode(safeStart),
        audioEnd: formatTimecode(safeEnd),
        userShifted: true,
        trackRow: targetRow,
      };
    });

    setScriptData((prev) => prev ? ({ ...prev, segments: aligned }) : null);

    if (audioGenerated) {
      syncTimelineAudioApi(aligned, getProjectName(), getVideoId(), episodeId, seriesId)
        .then((res) => {
          if (res && res.fullAudioUrl && setFullAudioUrl) {
            const cacheBusted = `${res.fullAudioUrl.split('?')[0]}?t=${Date.now()}`;
            setFullAudioUrl(cacheBusted);
          }
          if (res && res.fullAudioPath && setFullAudioPath) {
            setFullAudioPath(res.fullAudioPath);
          }
        })
        .catch((err) => console.warn('Failed to sync narration after auto-align:', err));
    }
  };

  // Select clip and seek playhead to its start
  const handleSelectClip = (clipId) => {
    setActiveClipId(clipId);
    const target = videoClips.find((c) => c.id === clipId);
    if (target && handleSeek) {
      handleSeek(target.start);
    }
  };

  // Delete Clip Tool
  const handleDeleteClip = (clipId) => {
    pushUndoSnapshot(videoClips);
    const updated = deleteClipById(videoClips, clipId, { allowEmpty: true });
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
  const handleDeleteSegment = async (segIdOrIdx) => {
    if (!scriptData?.segments) return;
    pushUndoSnapshot(videoClips, scriptData.segments);
    const updated = deleteSegmentByIdOrIndex(scriptData.segments, segIdOrIdx);

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
  const handleToggleMuteVideoClip = (clipId) => {
    if (!videoClips || videoClips.length === 0) return;
    pushUndoSnapshot(videoClips, scriptData?.segments || []);

    const updated = videoClips.map((c) => {
      if (c.id === clipId) {
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
  const handleToggleMuteSegment = (segIdOrIdx) => {
    if (!scriptData?.segments || scriptData.segments.length === 0) return;
    pushUndoSnapshot(videoClips, scriptData.segments);

    const updated = scriptData.segments.map((seg, idx) => {
      const isTarget = (seg.id !== undefined && seg.id !== null)
        ? String(seg.id) === String(segIdOrIdx)
        : idx === Number(segIdOrIdx);
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

    const targetIdx = segments.findIndex((s, idx) => 
      String(s.id) === String(activeSegKey) || idx === Number(activeSegKey)
    );
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
