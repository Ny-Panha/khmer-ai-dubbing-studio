import React from 'react';
import { Upload, Volume2, VolumeX, Film } from 'lucide-react';
import { formatTimecode, parseTimeToSeconds, formatMinSec } from '../../utils/formatTime';
import { findAssociatedSegmentIndices, resolveSegmentIsFemale, doesClipMatchSegment } from '../../utils/timelineUtils';
import { isGapClip } from '../../utils/timelineOps';
import { uploadVideoFile } from '../../services/api';

// In-memory UI-only cache for audio file durations probed from segment audioUrl
// (used for legacy episodes whose segments lack stored duration metadata; never persisted).
const PROBED_AUDIO_DURATION_CACHE = new Map();
const PROBED_AUDIO_PENDING = new Set();

function resolvePeaksDuration(seg) {
  if (!seg) return null;
  if (typeof seg.waveformDuration === 'number' && seg.waveformDuration > 0 && !isNaN(seg.waveformDuration)) {
    return seg.waveformDuration;
  }
  if (typeof seg.peaksDuration === 'number' && seg.peaksDuration > 0 && !isNaN(seg.peaksDuration)) {
    return seg.peaksDuration;
  }
  if (seg.waveform && typeof seg.waveform.duration === 'number' && seg.waveform.duration > 0 && !isNaN(seg.waveform.duration)) {
    return seg.waveform.duration;
  }
  if (seg.peaks && typeof seg.peaks.duration === 'number' && seg.peaks.duration > 0 && !isNaN(seg.peaks.duration)) {
    return seg.peaks.duration;
  }
  if (Array.isArray(seg.peaks) && seg.peaks.length > 0 && typeof seg.peaksSampleRate === 'number' && seg.peaksSampleRate > 0) {
    return seg.peaks.length / seg.peaksSampleRate;
  }
  return null;
}

function hasStoredAudioDurationMeta(seg) {
  if (!seg) return false;
  if (resolvePeaksDuration(seg) !== null) return true;
  return Boolean(
    (typeof seg.finalAudioDuration === 'number' && seg.finalAudioDuration > 0) ||
    (typeof seg.audioDurationSec === 'number' && seg.audioDurationSec > 0 && !isNaN(seg.audioDurationSec)) ||
    (typeof seg.audioDuration === 'number' && seg.audioDuration > 0) ||
    (typeof seg.originalAudioDuration === 'number' && seg.originalAudioDuration > 0) ||
    (typeof seg.rawAudioDur === 'number' && seg.rawAudioDur > 0)
  );
}

// Fallback order:
// 1. Peaks / waveform-derived extent
// 2. finalAudioDuration
// 3. audioDurationSec / audioDuration / originalAudioDuration / rawAudioDur (scaled by appliedSpeed)
// 4. Browser-probed actual audio file duration (scaled by appliedSpeed) for legacy segments lacking metadata
// 5. null -> caller falls back to slotSpan (only when segment has no audio/peaks at all)
function resolveVoiceAudioExtent(seg, appliedSpeed, probedDuration) {
  const peaksDuration = resolvePeaksDuration(seg);
  let rawAudioExtent = null;
  if (peaksDuration !== null) {
    rawAudioExtent = peaksDuration;
  } else if (typeof seg.finalAudioDuration === 'number' && seg.finalAudioDuration > 0) {
    rawAudioExtent = seg.finalAudioDuration;
  } else if (typeof seg.audioDurationSec === 'number' && seg.audioDurationSec > 0 && !isNaN(seg.audioDurationSec)) {
    rawAudioExtent = (appliedSpeed > 0 && Math.abs(appliedSpeed - 1.0) > 0.001)
      ? seg.audioDurationSec / appliedSpeed
      : seg.audioDurationSec;
  } else if (typeof seg.audioDuration === 'number' && seg.audioDuration > 0) {
    rawAudioExtent = (appliedSpeed > 0 && Math.abs(appliedSpeed - 1.0) > 0.001)
      ? seg.audioDuration / appliedSpeed
      : seg.audioDuration;
  } else if (typeof seg.originalAudioDuration === 'number' && seg.originalAudioDuration > 0) {
    rawAudioExtent = (appliedSpeed > 0 && Math.abs(appliedSpeed - 1.0) > 0.001)
      ? seg.originalAudioDuration / appliedSpeed
      : seg.originalAudioDuration;
  } else if (typeof seg.rawAudioDur === 'number' && seg.rawAudioDur > 0) {
    rawAudioExtent = (appliedSpeed > 0 && Math.abs(appliedSpeed - 1.0) > 0.001)
      ? seg.rawAudioDur / appliedSpeed
      : seg.rawAudioDur;
  } else if (typeof probedDuration === 'number' && probedDuration > 0 && !isNaN(probedDuration)) {
    rawAudioExtent = (appliedSpeed > 0 && Math.abs(appliedSpeed - 1.0) > 0.001)
      ? probedDuration / appliedSpeed
      : probedDuration;
  }
  return rawAudioExtent;
}

const FALLBACK_WAVEFORM_PATTERN = [30, 65, 90, 45, 80, 100, 55, 35, 75, 85, 40, 70, 25, 60, 80, 95, 50, 65, 35, 85];

const MemoizedVoiceWaveformBars = React.memo(function MemoizedVoiceWaveformBars({
  waveformWidthPx,
  peaksArray,
}) {
  // Each .waveform-bar is 2px wide + 2px gap (4px pitch) inside 10px horizontal box inset (1px border + 4px padding per side)
  const waveformBarCount = Math.min(400, Math.max(4, Math.floor((waveformWidthPx - 8) / 4)));
  return (
    <div
      className="voice-waveform-bars"
      style={{
        width: `${waveformWidthPx}px`,
        maxWidth: '100%',
      }}
    >
      {Array.from({ length: waveformBarCount }).map((_, wIdx) => {
        let hPercent;
        if (peaksArray) {
          const sampleIdx = Math.min(peaksArray.length - 1, Math.floor((wIdx / waveformBarCount) * peaksArray.length));
          const rawPeak = Number(peaksArray[sampleIdx]);
          const normalized = Number.isFinite(rawPeak) ? (rawPeak <= 1 ? rawPeak * 100 : rawPeak) : 40;
          hPercent = Math.max(15, Math.min(100, Math.round(normalized)));
        } else {
          hPercent = FALLBACK_WAVEFORM_PATTERN[wIdx % FALLBACK_WAVEFORM_PATTERN.length];
        }
        return (
          <span
            key={wIdx}
            className="waveform-bar"
            style={{
              height: `${hPercent}%`,
            }}
          />
        );
      })}
    </div>
  );
});

function TimelineTracksCanvas({
  scrollContainerRef = null,
  totalWidth,
  pps,
  markers,
  snapLineTime,
  snapLineRef = null,
  selectedVideo,
  totalDuration,
  playheadX,
  currentTime,
  isPlaying = false,
  playheadRef = null,
  playheadTimeTextRef = null,
  setIsScrubbing,
  handleScrub,
  videoClips,
  hiddenTracks,
  mutedTracks = {},
  dragState,
  activeClipId,
  handleVideoMouseDown,
  onSelectClip,
  videoThumbnails,
  audioGenerated,
  scriptSegments,
  selectedSegmentId,
  selectedClipKind = null,
  onSelectClipKind = null,
  selectedAudioId,
  setSelectedAudioId,
  onSelectSegment,
  onSeek,
  speakerRegistry,
  voiceSettings,
  handleAudioMouseDown,
  selectedSubId,
  setSelectedSubId,
  handleSubMouseDown,
  voiceRowCount = 1,
  subRowCount = 1,
  showSubtitles = true,
  videoRowCount = 1,
  segmentRows: externalSegmentRows = null,
  handleMoveVideoToTrack = null,
  onNativeDragStart = null,
  onNativeDragEnd = null,
  dragOverTrack: externalDragOverTrack = null,
  setDragOverTrack: externalSetDragOverTrack = null,
  onToggleMuteSegment = null,
  onToggleMuteVideoClip = null,
  onImportClick = null,
  onVideoSelected = null,
  framingKeyframes = [],
  seriesId = null,
  episodeId = null,
}) {
  const rootRef = React.useRef(null);
  const videoFileInputRef = React.useRef(null);
  const [internalDragOverTrack, setInternalDragOverTrack] = React.useState(null);
  const dragOverTrack = externalDragOverTrack !== null ? externalDragOverTrack : internalDragOverTrack;
  const setDragOverTrack = externalSetDragOverTrack || setInternalDragOverTrack;

  const handleTriggerImport = () => {
    if (videoFileInputRef.current) {
      videoFileInputRef.current.click();
    } else if (onImportClick) {
      onImportClick();
    }
  };

  const handleDirectVideoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const vidObj = await uploadVideoFile(file, { seriesId, episodeId });
      if (onVideoSelected) {
        onVideoSelected(vidObj);
      }
    } catch (err) {
      console.error('Timeline video upload failed:', err);
    } finally {
      if (videoFileInputRef.current) {
        videoFileInputRef.current.value = '';
      }
    }
  };

  // Timeline Windowing: compute visible time range based on scrollLeft + container width
  const [visibleRange, setVisibleRange] = React.useState(() => ({
    start: 0,
    end: 180,
  }));

  // UI-only trigger when browser metadata probes resolve true audio durations for legacy segments
  const [probedDurationTick, setProbedDurationTick] = React.useState(0);
  const isMountedRef = React.useRef(true);
  const probeFlushTimerRef = React.useRef(null);

  React.useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (probeFlushTimerRef.current !== null) {
        window.clearTimeout(probeFlushTimerRef.current);
        probeFlushTimerRef.current = null;
      }
    };
  }, []);

  React.useEffect(() => {
    if (!scriptSegments || scriptSegments.length === 0 || typeof Audio === 'undefined') return;
    let cancelled = false;

    const scheduleFlush = () => {
      if (!isMountedRef.current || probeFlushTimerRef.current !== null) return;
      probeFlushTimerRef.current = window.setTimeout(() => {
        probeFlushTimerRef.current = null;
        if (isMountedRef.current) setProbedDurationTick((t) => t + 1);
      }, 40);
    };

    const urlsToProbe = [];
    for (let idx = 0; idx < scriptSegments.length; idx++) {
      const seg = scriptSegments[idx];
      if (!seg || typeof seg.audioUrl !== 'string' || !seg.audioUrl) continue;
      if (hasStoredAudioDurationMeta(seg)) continue;
      if (PROBED_AUDIO_DURATION_CACHE.has(seg.audioUrl) || PROBED_AUDIO_PENDING.has(seg.audioUrl)) continue;

      const vStart = (typeof seg.audioStartSec === 'number' && !isNaN(seg.audioStartSec))
        ? seg.audioStartSec
        : ((typeof seg.startSec === 'number' && !isNaN(seg.startSec))
          ? seg.startSec
          : parseTimeToSeconds(seg.start, idx * 4));
      const vEnd = (typeof seg.endSec === 'number' && !isNaN(seg.endSec)) ? seg.endSec : (vStart + 3.0);
      if (vEnd < visibleRange.start || vStart > visibleRange.end) continue;

      urlsToProbe.push(seg.audioUrl);
    }

    if (urlsToProbe.length === 0) return;

    const MAX_CONCURRENT = 3;
    let cursor = 0;
    let activeCount = 0;

    const pump = () => {
      while (!cancelled && activeCount < MAX_CONCURRENT && cursor < urlsToProbe.length) {
        const url = urlsToProbe[cursor++];
        if (PROBED_AUDIO_DURATION_CACHE.has(url) || PROBED_AUDIO_PENDING.has(url)) continue;
        PROBED_AUDIO_PENDING.add(url);
        activeCount++;

        const audio = new Audio();
        audio.preload = 'metadata';

        const finalize = (dur) => {
          audio.onloadedmetadata = null;
          audio.onerror = null;
          try {
            audio.src = '';
            audio.removeAttribute('src');
          } catch {}
          PROBED_AUDIO_PENDING.delete(url);
          PROBED_AUDIO_DURATION_CACHE.set(url, (typeof dur === 'number' && Number.isFinite(dur) && dur > 0) ? dur : null);
          activeCount--;
          if (dur > 0) scheduleFlush();
          pump();
        };

        audio.onloadedmetadata = () => finalize(audio.duration);
        audio.onerror = () => finalize(null);
        audio.src = url;
      }
    };

    pump();

    return () => {
      cancelled = true;
    };
  }, [scriptSegments, visibleRange.start, visibleRange.end]);

  React.useEffect(() => {
    const container = scrollContainerRef?.current || rootRef.current?.parentElement;
    if (!container) return;

    let rafId = null;
    const computeVisibleRange = () => {
      const scrollLeft = container.scrollLeft || 0;
      const clientWidth = container.clientWidth || 1200;
      const safePps = pps > 0 ? pps : 45;

      // Buffer ~8 seconds or 35% of viewport width for zero pop-in during 60fps playback
      const bufferSec = Math.max(8.0, (clientWidth * 0.35) / safePps);
      const start = Math.max(0, (scrollLeft / safePps) - bufferSec);
      const end = ((scrollLeft + clientWidth) / safePps) + bufferSec;

      setVisibleRange((prev) => {
        // 2.0s hysteresis prevents continuous canvas DOM re-renders while playhead scrolls during playback
        if (Math.abs(prev.start - start) < 2.0 && Math.abs(prev.end - end) < 2.0) {
          return prev;
        }
        return { start, end };
      });
    };

    computeVisibleRange();

    const onScrollOrResize = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(computeVisibleRange);
    };

    container.addEventListener('scroll', onScrollOrResize, { passive: true });
    window.addEventListener('resize', onScrollOrResize, { passive: true });

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      container.removeEventListener('scroll', onScrollOrResize);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [scrollContainerRef, pps]);

  // Smart Multi-Track Layer Allocation (VOICE 1 Male / VOICE 2 Female & Stagger Routing)
  const internalSegmentRows = React.useMemo(() => {
    if (!scriptSegments || scriptSegments.length === 0) return [];
    const endTimes = [0, 0];

    const resolveIsFemale = (seg) => resolveSegmentIsFemale(seg, speakerRegistry, voiceSettings?.voiceId);

    return scriptSegments.map((seg, idx) => {
      const rawStart = (typeof seg.audioStartSec === 'number' && !isNaN(seg.audioStartSec))
        ? seg.audioStartSec 
        : ((typeof seg.startSec === 'number' && !isNaN(seg.startSec))
          ? seg.startSec
          : parseTimeToSeconds(seg.start, idx * 4));
      const slotStart = (typeof seg.startSec === 'number' && !isNaN(seg.startSec)) ? seg.startSec : parseTimeToSeconds(seg.start, idx * 4);
      const slotEnd = (typeof seg.endSec === 'number' && !isNaN(seg.endSec)) ? seg.endSec : parseTimeToSeconds(seg.end, slotStart + 3.0);
      const slotSpan = (typeof seg.audioEndSec === 'number' && !isNaN(seg.audioEndSec) && seg.audioEndSec > rawStart)
        ? (seg.audioEndSec - rawStart)
        : (slotEnd > slotStart ? (slotEnd - slotStart) : 2.5);
      const slotDur = Math.max(0.1, slotEnd - slotStart);
      const hasAudio = Boolean(seg.audioUrl || seg.audioPath || seg.audioFile);
      const appliedSpeed = (typeof seg.appliedSpeed === 'number' && seg.appliedSpeed > 0)
        ? seg.appliedSpeed
        : ((typeof seg.speed === 'number' && seg.speed > 0) ? seg.speed : 1.0);

      const probedDuration = (typeof seg.audioUrl === 'string' && seg.audioUrl)
        ? PROBED_AUDIO_DURATION_CACHE.get(seg.audioUrl)
        : null;
      const rawAudioExtent = resolveVoiceAudioExtent(seg, appliedSpeed, probedDuration);

      let renderedDuration = slotSpan;
      if (hasAudio && rawAudioExtent !== null) {
        if (rawAudioExtent >= slotDur) {
          renderedDuration = slotSpan;
        } else {
          renderedDuration = rawAudioExtent;
          if (seg.userTrimmed && typeof seg.audioEndSec === 'number' && seg.audioEndSec > rawStart) {
            const userTrimSpan = seg.audioEndSec - rawStart;
            if (userTrimSpan < renderedDuration) {
              renderedDuration = userTrimSpan;
            }
          }
        }
      }

      const rawEnd = rawStart + renderedDuration;

      // CapCut single-lane style: all auto-placed voice clips live sequentially on VOICE 1 (Lane 0).
      // Only userShifted clips (and clips re-laned around fixed anchors) keep their explicitly assigned trackRow.
      if (typeof seg.trackRow === 'number' && (seg.userShifted || seg.trackRow > 0)) {
        const r = Math.max(0, seg.trackRow);
        endTimes[r] = Math.max(endTimes[r] || 0, rawEnd);
        return r;
      }

      endTimes[0] = Math.max(endTimes[0] || 0, rawEnd);
      return 0;
    });
  }, [scriptSegments, probedDurationTick]);

  const activeSegmentRows = externalSegmentRows || internalSegmentRows;

  // Live sync: Detect which segments belong to a video clip currently being dragged horizontally
  const associatedClipSegIndices = React.useMemo(() => {
    if (dragState?.itemType === 'video' && dragState?.mode === 'move' && videoClips && scriptSegments) {
      const clip = videoClips.find(c => c.id === dragState.id) || videoClips[dragState.index];
      if (clip) {
        return new Set(findAssociatedSegmentIndices(clip, scriptSegments));
      }
    }
    return new Set();
  }, [dragState, videoClips, scriptSegments]);

  const hasAnyVoiceAudio = React.useMemo(
    () => Boolean(audioGenerated || (scriptSegments || []).some((s) => Boolean(s?.audioUrl || s?.audioPath || s?.audioFile))),
    [audioGenerated, scriptSegments]
  );

  const shouldRenderOnVoiceTrack = React.useCallback((seg) => {
    if (!seg) return false;
    if (seg.audioUrl || seg.audioPath || seg.audioFile) return true;
    return Boolean(
      hasAnyVoiceAudio ||
      seg.userAdded ||
      seg.isDraftVoice ||
      (typeof seg.id === 'string' && seg.id.startsWith('seg_'))
    );
  }, [hasAnyVoiceAudio]);

  const renderVoiceSegment = (seg, idx) => {
    const hasAudio = Boolean(seg.audioUrl || seg.audioPath || seg.audioFile);
    if (!hasAudio && !shouldRenderOnVoiceTrack(seg)) return null;

    const isAudioDragging = dragState?.itemType === 'audio' && dragState?.index === idx;
    const isSubDragging = dragState?.itemType === 'subtitle' && dragState?.index === idx;
    const isDragging = isAudioDragging || isSubDragging;
    const segRow = activeSegmentRows[idx] ?? (typeof seg.trackRow === 'number' ? Math.max(0, seg.trackRow) : 0);
    const voiceMinY = typeof dragState?.minVoiceY === 'number' ? dragState.minVoiceY : -(segRow * 48);
    const voiceMaxY = typeof dragState?.maxVoiceY === 'number'
      ? dragState.maxVoiceY
      : Math.max(0, (Math.max(2, voiceRowCount || 2) - 1 - segRow) * 48);
    const safeVoiceTranslateY = (isAudioDragging && dragState?.mode === 'move' && typeof dragState?.currentY === 'number')
      ? Math.max(voiceMinY, Math.min(voiceMaxY, dragState.currentY))
      : null;
    const rawStart = (typeof seg.audioStartSec === 'number' && !isNaN(seg.audioStartSec))
      ? seg.audioStartSec 
      : ((typeof seg.startSec === 'number' && !isNaN(seg.startSec))
        ? seg.startSec
        : parseTimeToSeconds(seg.start, idx * 4));
    const slotStart = (typeof seg.startSec === 'number' && !isNaN(seg.startSec)) ? seg.startSec : parseTimeToSeconds(seg.start, idx * 4);
    const slotEnd = (typeof seg.endSec === 'number' && !isNaN(seg.endSec)) ? seg.endSec : parseTimeToSeconds(seg.end, slotStart + 3.0);
    const slotSpan = (typeof seg.audioEndSec === 'number' && !isNaN(seg.audioEndSec) && seg.audioEndSec > rawStart)
      ? (seg.audioEndSec - rawStart)
      : (slotEnd > slotStart ? (slotEnd - slotStart) : 2.5);
    const slotDur = Math.max(0.1, slotEnd - slotStart);
    const appliedSpeed = (typeof seg.appliedSpeed === 'number' && seg.appliedSpeed > 0)
      ? seg.appliedSpeed
      : ((typeof seg.speed === 'number' && seg.speed > 0) ? seg.speed : 1.0);

    const probedDuration = (typeof seg.audioUrl === 'string' && seg.audioUrl)
      ? PROBED_AUDIO_DURATION_CACHE.get(seg.audioUrl)
      : null;
    const rawAudioExtent = resolveVoiceAudioExtent(seg, appliedSpeed, probedDuration);

    const realAudioDuration = (rawAudioExtent !== null && rawAudioExtent > 0) ? rawAudioExtent : slotSpan;

    // Owner's rules:
    // 1. If the segment has NO audio yet (no waveform): keep today's slot-width box so it stays visible and selectable.
    // 2. If audio extent >= slot duration (overrun segments): keep today's rendering exactly (slot-width box, existing red-border / scissors overrun indication unchanged).
    // 3. Otherwise: compute clip rendered width from audio's TRUE extent -> Box = from segment's start to start + effective audio extent.
    // 4. If user manually trimmed with userTrimmed, respect manual trim bound if tighter.
    let renderedDuration = slotSpan;
    if (hasAudio && rawAudioExtent !== null) {
      if (rawAudioExtent >= slotDur) {
        renderedDuration = slotSpan;
      } else {
        renderedDuration = rawAudioExtent;
        if (seg.userTrimmed && typeof seg.audioEndSec === 'number' && seg.audioEndSec > rawStart) {
          const userTrimSpan = seg.audioEndSec - rawStart;
          if (userTrimSpan < renderedDuration) {
            renderedDuration = userTrimSpan;
          }
        }
      }
    }

    const rawEnd = rawStart + renderedDuration;

    const isClipMovingAssociated = dragState?.itemType === 'video' && dragState?.mode === 'move' && associatedClipSegIndices.has(idx);
    const clipMoveDelta = isClipMovingAssociated ? (dragState.currentStart - dragState.origStart) : 0;

    const startSec = isDragging 
      ? dragState.currentStart 
      : (isClipMovingAssociated ? Math.max(0, rawStart + clipMoveDelta) : rawStart);
    const endSec = isDragging 
      ? (dragState?.mode === 'move' ? (startSec + renderedDuration) : dragState.currentEnd)
      : (isClipMovingAssociated ? Math.max(0.3, rawEnd + clipMoveDelta) : rawEnd);

    // 2px gap between adjacent clips
    const audioLeft = startSec * pps;
    const audioWidth = Math.max(2, (endSec - startSec) * pps - 2);
    const segKey = seg._uid || (seg.id !== undefined && seg.id !== null ? seg.id : idx);
    const segmentNumber = seg.segmentId ?? seg.id ?? idx + 1;
    const isDirectSegMatch = Boolean(
      (selectedSegmentId !== null && selectedSegmentId !== undefined && (
        (seg._uid && String(selectedSegmentId) === String(seg._uid)) || (seg.id !== undefined && seg.id !== null ? String(selectedSegmentId) === String(seg.id) : Number(selectedSegmentId) === idx)
      )) ||
      (selectedAudioId !== null && selectedAudioId !== undefined && (
        (seg._uid && String(selectedAudioId) === String(seg._uid)) || (seg.id !== undefined && seg.id !== null ? String(selectedAudioId) === String(seg.id) : Number(selectedAudioId) === idx)
      ))
    );
    const isAssociatedWithClip = Boolean(
      activeClipId && videoClips?.some((c) => c.id === activeClipId && !isGapClip(c) && doesClipMatchSegment(c, seg, segmentNumber))
    );
    const isSelected = Boolean(
      (selectedClipKind === 'voice' || !selectedClipKind) && isDirectSegMatch
    );
    const isLinked = Boolean(
      !isSelected && (
        (selectedClipKind === 'video' && (isAssociatedWithClip || isDirectSegMatch)) ||
        (selectedClipKind === 'subtitle' && isDirectSegMatch)
      )
    );

    const speakerName = (seg.speaker || seg.speakerName || '').trim();
    const isFemale = resolveSegmentIsFemale(seg, speakerRegistry, voiceSettings?.voiceId);
    const isGeneratingVoice = seg.textStatus === 'generating';

    // STEP 3: OVER truthfulness. overSec = realAudioDuration - (slotEnd - slotStart)
    const overSec = hasAudio ? parseFloat((realAudioDuration - slotDur).toFixed(2)) : 0;
    const isOverrun = Boolean(seg.audioOverrun);
    const isOver = isOverrun || (hasAudio && (overSec >= 0.15 || Boolean(seg.audioTrimmed && overSec > 0.05)));
    const overrunMarker = isOverrun ? ' ⚠️' : '';
    const overMarker = isOver ? (isOverrun ? overrunMarker : ` +${overSec.toFixed(1)}s`) : '';
    const trimMarker = (seg.audioTrimmed || seg.userTrimmed) ? ' ✂' : '';
    const pendingMarker = isGeneratingVoice ? ' • ⏳ កំពុងបង្កើត...' : (!hasAudio ? ' • គ្មានសំឡេង' : '');
    const khmerPreview = (seg.khmer || seg.khmerText || seg.khmerTranslatedText || seg.text || '').trim();
    const speakerGenderLabel = isFemale ? 'ស្រី' : 'ប្រុស';
    const speakerTooltipLabel = speakerName || speakerGenderLabel;

    // Responsive Clip Label Rendering based on calculated clip pixel width (clipWidthPx = audioWidth):
    // - clipWidthPx < 48px: compact badge "#6" centered, hiding "ប្រុស/ស្រី" so it never cuts off as "#..."
    // - 48px <= clipWidthPx < 95px: "#6 ប្រុស" cleanly
    // - clipWidthPx >= 95px: "#6 ប្រុស" on top + 1-line preview of Khmer dialogue text in Kantumruy Pro (11px)
    const clipWidthPx = audioWidth;
    const isCompactClip = clipWidthPx < 48;
    const isWideClip = clipWidthPx >= 95;
    const compactIdLabel = `#${segmentNumber}${isOverrun ? '⚠️' : ''}`;
    const mediumVoiceLabel = `#${segmentNumber} ${speakerGenderLabel}${overMarker}${trimMarker}`;
    const fullVoiceLabel = `#${segmentNumber} ${speakerGenderLabel}${overMarker}${trimMarker}${pendingMarker}`;
    const voiceLabel = isCompactClip ? compactIdLabel : (isWideClip ? fullVoiceLabel : mediumVoiceLabel);

    const isSliver = clipWidthPx < 5;
    const canRenderLabel = clipWidthPx >= 18;

    return (
      <React.Fragment key={`voice-wrap-${seg._uid || `${seg.id ?? idx}-${idx}`}`}>
        {isDragging && (
          <div 
            className="video-clip-ghost"
            style={{
              left: dragState.origStart * pps,
              width: Math.max(2, (renderedDuration * pps) - 2),
              height: 'calc(100% - 6px)',
            }}
          />
        )}

        <div
          draggable={false}
          onMouseDown={(e) => handleAudioMouseDown(e, { ...seg, renderedEnd: rawEnd, renderedDuration }, idx, 'move')}
          onClick={(e) => {
            e.stopPropagation();
            if (onSelectClipKind) onSelectClipKind('voice');
            setSelectedAudioId(segKey);
            setSelectedSubId(segKey);
            if (onSelectSegment) onSelectSegment(segKey);
            if (onSelectClip) {
              const matchClip = videoClips?.find(c => !isGapClip(c) && doesClipMatchSegment(c, seg, segmentNumber));
              onSelectClip(matchClip ? matchClip.id : null);
            }
            onSeek(startSec);
          }}
          data-segment-id={seg.id ?? idx}
          data-voice-gender={isFemale ? 'female' : 'male'}
          data-voice-generating={isGeneratingVoice ? 'true' : 'false'}
          className={`voice-segment-block ${isFemale ? 'voice-female' : 'voice-male'} ${!hasAudio ? 'is-pending-audio' : ''} ${isGeneratingVoice ? 'is-generating-voice' : ''} ${isSelected ? 'selected' : ''} ${isLinked ? 'is-linked-clip' : ''} ${isDragging ? 'is-dragging' : ''} ${isSliver ? 'clip-sliver' : ''} ${isCompactClip ? 'is-compact-clip' : ''} ${isOverrun ? 'has-audio-overrun' : ''}`}
          style={{
            cursor: isDragging ? 'grabbing' : 'grab',
            left: audioLeft,
            width: audioWidth,
            zIndex: isDragging ? 100 : (isSelected ? 20 : (isLinked ? 8 : 5)),
            transform: safeVoiceTranslateY !== null ? `translateY(${safeVoiceTranslateY}px)` : undefined,
            transition: isDragging ? 'none !important' : undefined,
            willChange: isDragging ? 'transform' : undefined,
            pointerEvents: isDragging && dragState?.mode === 'move' ? 'none' : 'auto',
          }}
          title={`#${segmentNumber} [${speakerTooltipLabel}] (${startSec.toFixed(1)}s - ${endSec.toFixed(1)}s)${isOverrun ? ` ⚠️ Audio Overrun (${Math.round((seg.overrunRatio || 0.4) * 100)}% cut)` : ''}\n"${khmerPreview || '(មិនទាន់មានអត្ថបទ / រង់ចាំសំឡេង)'}"`}
        >
          {/* Left Trim Handle - visible only on selected clip */}
          {isSelected && !isSliver && (
            <div 
              className="clip-trim-handle left"
              draggable={false}
              onMouseDown={(e) => {
                e.stopPropagation();
                handleAudioMouseDown(e, { ...seg, renderedEnd: rawEnd, renderedDuration }, idx, 'trim-left');
              }}
              title="Drag to trim start"
            >
              <div className="trim-handle-grip" />
            </div>
          )}

          {!isSliver && (
            <>
              {/* Row 1: Responsive Label Line */}
              <div className={`clip-label-line ${isCompactClip ? 'compact-centered' : ''}`}>
                {canRenderLabel && (
                  <span className={`clip-label-text ${isOver ? 'is-over' : ''} ${isCompactClip ? 'clip-compact-id' : ''}`}>
                    {voiceLabel}
                  </span>
                )}
              </div>

              {/* Row 2: Content Row (1-line Khmer preview on wide clips >= 95px + waveform peaks, or draft hint) */}
              {!isCompactClip && (
                <div className="clip-content-row voice-content-row">
                  {isWideClip && khmerPreview && (
                    <span className="voice-khmer-dialogue-preview">{khmerPreview}</span>
                  )}
                  {hasAudio ? (
                    audioWidth >= 20 && (() => {
                      const waveformWidthPx = Math.min(audioWidth, Math.max(16, (renderedDuration * pps) - 2));
                      const peaksArray = Array.isArray(seg.peaks) && seg.peaks.length > 0
                        ? seg.peaks
                        : (Array.isArray(seg.waveform) && seg.waveform.length > 0
                          ? seg.waveform
                          : (Array.isArray(seg.waveform?.peaks) && seg.waveform.peaks.length > 0 ? seg.waveform.peaks : null));
                      return (
                        <MemoizedVoiceWaveformBars
                          waveformWidthPx={waveformWidthPx}
                          peaksArray={peaksArray}
                        />
                      );
                    })()
                  ) : (
                    !isWideClip && audioWidth >= 24 && (
                      <span className="voice-draft-hint">
                        {khmerPreview || '+ សរសេរអក្សរ & Generate'}
                      </span>
                    )
                  )}
                </div>
              )}
            </>
          )}

          {/* Right Trim Handle - visible only on selected clip */}
          {isSelected && !isSliver && (
            <div 
              className="clip-trim-handle right"
              draggable={false}
              onMouseDown={(e) => {
                e.stopPropagation();
                handleAudioMouseDown(e, { ...seg, renderedEnd: rawEnd, renderedDuration }, idx, 'trim-right');
              }}
              title="Drag to trim end"
            >
              <div className="trim-handle-grip" />
            </div>
          )}
        </div>
      </React.Fragment>
    );
  };

  const renderSubSegment = (seg, idx) => {
    const isDragging = (dragState?.itemType === 'audio' || dragState?.itemType === 'subtitle') && dragState?.index === idx;
    const hasVoice = Boolean(
      seg.audioUrl ||
      seg.audioPath ||
      seg.rawAudioPath ||
      seg.audioFile ||
      seg.rawAudioFile ||
      seg.ttsStatus === 'ready' ||
      seg.status === 'audio_ready' ||
      (typeof seg.finalAudioDuration === 'number' && seg.finalAudioDuration > 0) ||
      (typeof seg.audioDuration === 'number' && seg.audioDuration > 0) ||
      (typeof seg.audioDurationSec === 'number' && seg.audioDurationSec > 0)
    );

    const rawStart = (hasVoice && typeof seg.audioStartSec === 'number' && !isNaN(seg.audioStartSec))
      ? seg.audioStartSec
      : ((typeof seg.startSec === 'number' && !isNaN(seg.startSec))
        ? seg.startSec
        : parseTimeToSeconds(seg.start, idx * 4));

    const realAudioDur = hasVoice
      ? ((typeof seg.finalAudioDuration === 'number' && seg.finalAudioDuration > 0)
        ? seg.finalAudioDuration
        : ((typeof seg.audioDurationSec === 'number' && seg.audioDurationSec > 0 && !isNaN(seg.audioDurationSec))
          ? seg.audioDurationSec
          : ((typeof seg.audioDuration === 'number' && seg.audioDuration > 0)
            ? seg.audioDuration
            : ((typeof seg.originalAudioDuration === 'number' && seg.originalAudioDuration > 0)
              ? seg.originalAudioDuration
              : ((typeof seg.rawAudioDur === 'number' && seg.rawAudioDur > 0)
                ? seg.rawAudioDur
                : null)))))
      : null;

    const isTrimmed = Boolean(seg.audioTrimmed || seg.userTrimmed);
    const rawEnd = (isTrimmed && typeof seg.audioEndSec === 'number' && !isNaN(seg.audioEndSec))
      ? seg.audioEndSec
      : (realAudioDur && realAudioDur > 0
        ? (rawStart + realAudioDur)
        : ((typeof seg.endSec === 'number' && !isNaN(seg.endSec))
          ? seg.endSec
          : parseTimeToSeconds(seg.end, rawStart + 2.5)));

    const isClipMovingAssociated = dragState?.itemType === 'video' && dragState?.mode === 'move' && associatedClipSegIndices.has(idx);
    const clipMoveDelta = isClipMovingAssociated ? (dragState.currentStart - dragState.origStart) : 0;

    const startSec = isDragging 
      ? dragState.currentStart 
      : (isClipMovingAssociated ? Math.max(0, rawStart + clipMoveDelta) : rawStart);
    const endSec = isDragging 
      ? dragState.currentEnd 
      : (isClipMovingAssociated ? Math.max(0.3, rawEnd + clipMoveDelta) : rawEnd);

    // 2px gap between adjacent clips
    const subLeft = startSec * pps;
    const subWidth = Math.max(2, (endSec - startSec) * pps - 2);
    const subKey = seg._uid || (seg.id !== undefined && seg.id !== null ? seg.id : idx);
    const segmentNumber = seg.segmentId ?? seg.id ?? idx + 1;
    const isDirectSubMatch = Boolean(
      (selectedSubId !== null && selectedSubId !== undefined && (
        (seg._uid && String(selectedSubId) === String(seg._uid)) ||
        (seg.id !== undefined && seg.id !== null ? String(selectedSubId) === String(seg.id) : Number(selectedSubId) === idx)
      )) ||
      (selectedSegmentId !== null && selectedSegmentId !== undefined && (
        (seg._uid && String(selectedSegmentId) === String(seg._uid)) ||
        (seg.id !== undefined && seg.id !== null ? String(selectedSegmentId) === String(seg.id) : Number(selectedSegmentId) === idx)
      ))
    );
    const isAssociatedWithClip = Boolean(
      activeClipId && videoClips?.some((c) => c.id === activeClipId && !isGapClip(c) && doesClipMatchSegment(c, seg, segmentNumber))
    );
    const isSelected = Boolean(
      (selectedClipKind === 'subtitle' || !selectedClipKind) && isDirectSubMatch
    );
    const isLinked = Boolean(
      !isSelected && (
        (selectedClipKind === 'video' && (isAssociatedWithClip || isDirectSubMatch)) ||
        (selectedClipKind === 'voice' && isDirectSubMatch)
      )
    );

    const isSliver = subWidth < 5;
    const canRenderLabel = subWidth >= 32;

    return (
      <React.Fragment key={`sub-wrap-${seg._uid || `${seg.id ?? idx}-${idx}`}`}>
        {isDragging && (
          <div 
            className="video-clip-ghost"
            style={{
              left: dragState.origStart * pps,
              width: Math.max(2, (dragState.origEnd - dragState.origStart) * pps - 2),
            }}
          />
        )}

        <div
          draggable={false}
          onMouseDown={(e) => handleSubMouseDown(e, seg, idx, 'move')}
          onClick={(e) => {
            e.stopPropagation();
            if (onSelectClipKind) onSelectClipKind('subtitle');
            setSelectedSubId(subKey);
            setSelectedAudioId(subKey);
            if (onSelectSegment) onSelectSegment(subKey);
            if (onSelectClip) {
              const matchClip = videoClips?.find(c => !isGapClip(c) && doesClipMatchSegment(c, seg, segmentNumber));
              onSelectClip(matchClip ? matchClip.id : null);
            }
            onSeek(startSec);
          }}
          className={`subtitle-segment-block ${isSelected ? 'selected' : ''} ${isLinked ? 'is-linked-clip' : ''} ${isDragging ? 'is-dragging' : ''} ${isSliver ? 'clip-sliver' : ''}`}
          style={{
            cursor: isDragging ? 'grabbing' : 'grab',
            left: subLeft,
            width: subWidth,
            zIndex: isDragging ? 100 : (isSelected ? 20 : (isLinked ? 8 : 5)),
            transform: isDragging && dragState?.mode === 'move' && typeof dragState?.currentY === 'number' ? `translateY(${dragState.currentY}px)` : undefined,
            transition: isDragging ? 'none !important' : undefined,
            willChange: isDragging ? 'transform' : undefined,
            pointerEvents: isDragging && dragState?.mode === 'move' ? 'none' : 'auto',
          }}
          title={`[${formatMinSec(startSec)} - ${formatMinSec(endSec)}] ${seg.khmer || seg.text || ''}`}
        >
          {/* Left Trim Handle - only when selected */}
          {isSelected && !isSliver && (
            <div 
              className="clip-trim-handle left"
              draggable={false}
              onMouseDown={(e) => {
                e.stopPropagation();
                handleSubMouseDown(e, seg, idx, 'trim-left');
              }}
              title="Drag to trim start time"
            >
              <div className="trim-handle-grip" />
            </div>
          )}

          {!isSliver && (
            <>
              {/* Row 1: Label line (segment text as label line, no separate # badge) */}
              <div className="clip-label-line">
                {canRenderLabel && (
                  <span className="clip-label-text">
                    {seg.khmer || seg.text || ''}
                  </span>
                )}
              </div>

              {/* Row 2: Content row (flat content row) */}
              <div className="clip-content-row sub-content-row" />
            </>
          )}

          {/* Right Trim Handle - only when selected */}
          {isSelected && !isSliver && (
            <div 
              className="clip-trim-handle right"
              draggable={false}
              onMouseDown={(e) => {
                e.stopPropagation();
                handleSubMouseDown(e, seg, idx, 'trim-right');
              }}
              title="Drag to trim end time"
            >
              <div className="trim-handle-grip" />
            </div>
          )}
        </div>
      </React.Fragment>
    );
  };

  const renderVideoClip = (clip, idx, trackKey, rIdx) => {
    const isDragging = dragState?.itemType === 'video' && (dragState?.id === clip.id || dragState?.index === idx);
    const startSec = isDragging ? dragState.currentStart : clip.start;
    const endSec = isDragging ? dragState.currentEnd : clip.end;

    // 2px gap between adjacent clips
    const clipWidth = Math.max(2, (endSec - startSec) * pps - 2);
    const clipLeft = startSec * pps;
    const isDirectClipMatch = Boolean(activeClipId && activeClipId === clip.id);
    const isAssociatedWithSeg = Boolean(
      !isGapClip(clip) &&
      selectedSegmentId !== null && selectedSegmentId !== undefined &&
      doesClipMatchSegment(clip, selectedSegmentId)
    );
    const isSelected = Boolean(
      (selectedClipKind === 'video' || !selectedClipKind) && isDirectClipMatch
    );
    const isLinked = Boolean(
      !isSelected && (selectedClipKind === 'voice' || selectedClipKind === 'subtitle') && isAssociatedWithSeg
    );

    const isSliver = clipWidth < 5;
    const canRenderLabel = clipWidth >= 22;
    const isCompactClip = clipWidth < 52;
    const rawCleanName = (clip.name || 'Video Clip')
      .replace(/\s*\(\d+(\.\d+)?s\)/g, '')
      .trim();

    // Responsive, clean label for video clips:
    // Narrow clips (< 52px): `#10` (clean centered badge, no truncated overflow text)
    // Medium clips (52px - 90px): Clean gender `#10 ស្រី` or `#10 ប្រុស`
    // Wide clips (>= 90px): Full clean name (normalized to canonical segmentId when present)
    let videoClipLabel = rawCleanName;
    const clipDisplayNumber = clip.segmentId ?? clip.segmentIndex;
    if (clip.isDialogue && clipDisplayNumber) {
      const normalizedCleanName = rawCleanName.replace(/^#\d+\b/, `#${clipDisplayNumber}`);
      if (isCompactClip) {
        videoClipLabel = `#${clipDisplayNumber}`;
      } else if (clipWidth < 90) {
        const hasFemale = normalizedCleanName.includes('ស្រី');
        const hasMale = normalizedCleanName.includes('ប្រុស');
        if (hasFemale) {
          videoClipLabel = `#${clipDisplayNumber} ស្រី`;
        } else if (hasMale) {
          videoClipLabel = `#${clipDisplayNumber} ប្រុស`;
        } else {
          videoClipLabel = normalizedCleanName;
        }
      } else {
        videoClipLabel = normalizedCleanName;
      }
    }

    return (
      <React.Fragment key={clip.id}>
        {isDragging && dragState?.mode === 'move' && (
          <div 
            className="video-clip-ghost"
            style={{
              left: dragState.origStart * pps,
              width: Math.max(2, (dragState.origEnd - dragState.origStart) * pps - 2),
            }}
          />
        )}

        <div
          draggable={false}
          onMouseDown={(e) => handleVideoMouseDown(e, clip, idx, 'move')}
          onClick={(e) => {
            e.stopPropagation();
            if (onSelectClipKind) onSelectClipKind('video');
            if (onSelectClip) onSelectClip(clip.id);
            if (isGapClip(clip)) {
              if (setSelectedAudioId) setSelectedAudioId(null);
              if (setSelectedSubId) setSelectedSubId(null);
              if (onSelectSegment) onSelectSegment(null);
              return;
            }
            const targetSeg = scriptSegments?.find(s => doesClipMatchSegment(clip, s));
            if (targetSeg) {
              const segKey = targetSeg._uid || targetSeg.id;
              if (setSelectedAudioId) setSelectedAudioId(segKey);
              if (setSelectedSubId) setSelectedSubId(segKey);
              if (onSelectSegment) onSelectSegment(segKey);
            } else {
              if (setSelectedAudioId) setSelectedAudioId(null);
              if (setSelectedSubId) setSelectedSubId(null);
              if (onSelectSegment) onSelectSegment(null);
            }
          }}
          className={`video-clip-block ${isSelected ? 'selected' : ''} ${isLinked ? 'is-linked-clip' : ''} ${isDragging ? 'is-dragging' : ''} ${isSliver ? 'clip-sliver' : ''} ${clip.isMuted ? 'is-clip-muted' : ''}`}
          style={{
            cursor: isDragging ? 'grabbing' : 'grab',
            left: clipLeft,
            width: clipWidth,
            zIndex: isDragging ? 100 : (isSelected ? 10 : (isLinked ? 6 : 2)),
            transform: isDragging && dragState?.currentY ? `translateY(${dragState.currentY}px)` : undefined,
            transition: isDragging ? 'none' : undefined,
            pointerEvents: isDragging ? 'none' : 'auto',
          }}
          title={`${clip.name} [${startSec.toFixed(1)}s - ${endSec.toFixed(1)}s]${clip.isMuted ? ' (Muted 🔇)' : ''}`}
        >
          {/* Left Trim Handle - only when selected */}
          {isSelected && !isSliver && (
            <div 
              className="clip-trim-handle left"
              draggable={false}
              onMouseDown={(e) => {
                e.stopPropagation();
                handleVideoMouseDown(e, clip, idx, 'trim-left');
              }}
              title="Drag to trim start"
            >
              <div className="trim-handle-grip" />
            </div>
          )}

          {!isSliver && (
            <>
              {/* Row 1: Label line (12px, 500, single line truncate) */}
              <div className={`clip-label-line ${isCompactClip ? 'compact-centered' : ''}`}>
                {canRenderLabel && (
                  <span className={`clip-label-text ${isCompactClip ? 'clip-compact-id' : ''}`} title={`${rawCleanName} (${(endSec - startSec).toFixed(1)}s)`}>
                    {videoClipLabel}
                  </span>
                )}
                {clip.isMuted && (
                  <span className="clip-mini-muted-badge" title="សំឡេងវីដេអូដើមត្រូវបានបិទ (Muted 🔇)">
                    <VolumeX size={10} color="#f87171" />
                  </span>
                )}
              </div>

              {/* Row 2: Content row (filmstrip tiles: tile, never stretch) */}
              <div className="clip-content-row filmstrip-content-row">
                {videoThumbnails && videoThumbnails.length > 0 ? (
                  (() => {
                    const getThumbUrl = (item) => (item ? (typeof item === 'string' ? item : item.url) : null);
                    const clipSrcStart = typeof clip.sourceStart === 'number' ? clip.sourceStart : startSec;
                    const clipSrcEnd = typeof clip.sourceEnd === 'number' ? clip.sourceEnd : endSec;
                    const clipDur = Math.max(0.2, clipSrcEnd - clipSrcStart);
                    const safeTotalDur = Math.max(1, totalDuration || 30);
                    const frameCount = Math.max(1, Math.min(80, Math.ceil(clipWidth / 56)));
                    return Array.from({ length: frameCount }).map((_, fIdx) => {
                      const cellTime = clipSrcStart + (frameCount > 1 ? (fIdx / (frameCount - 1)) * clipDur : 0);
                      const timeRatio = Math.max(0, Math.min(0.999, cellTime / safeTotalDur));
                      const thumbIdx = Math.min(videoThumbnails.length - 1, Math.floor(timeRatio * videoThumbnails.length));
                      const thumbSrc = getThumbUrl(videoThumbnails[thumbIdx]);
                      return (
                        <div key={fIdx} className="filmstrip-thumb-cell">
                          {thumbSrc ? (
                            <img src={thumbSrc} alt="frame" className="filmstrip-img" loading="lazy" decoding="async" />
                          ) : (
                            <div className="filmstrip-placeholder-pattern" />
                          )}
                        </div>
                      );
                    });
                  })()
                ) : (
                  <div className="filmstrip-placeholder-pattern" />
                )}
              </div>
            </>
          )}

          {/* Right Trim Handle - only when selected */}
          {isSelected && !isSliver && (
            <div 
              className="clip-trim-handle right"
              draggable={false}
              onMouseDown={(e) => {
                e.stopPropagation();
                handleVideoMouseDown(e, clip, idx, 'trim-right');
              }}
              title="Drag to trim end"
            >
              <div className="trim-handle-grip" />
            </div>
          )}
        </div>
      </React.Fragment>
    );
  };

  return (
    <div 
      ref={rootRef} 
      className="tracks-content" 
      style={{ 
        width: Math.max(totalWidth || 1200, 1200), 
        minWidth: Math.max(totalWidth || 1200, 1200), 
        minHeight: '100%',
        flex: '0 0 auto', 
        position: 'relative' 
      }}
    >
      {/* Ruler Line (12px mono time labels spaced >= 100px, minor ticks quieter than major) */}
      <div className="timeline-ruler">
        {(markers || [])
          .filter((m) => {
            const sec = typeof m === 'number' ? m : m.time;
            return sec >= (visibleRange.start - 5) && sec <= (visibleRange.end + 5);
          })
          .map((m) => {
            const sec = typeof m === 'number' ? m : m.time;
            const isMajor = typeof m === 'object' ? m.isMajor : (sec % 2 === 0);
            return (
              <div
                key={sec}
                className={`ruler-marker ${isMajor ? 'major' : 'minor'}`}
                style={{ left: sec * pps }}
              >
                <div className={`ruler-tick ${isMajor ? 'major' : 'minor'}`} />
                {isMajor && <span className="ruler-time">{formatMinSec(sec)}</span>}
              </div>
            );
          })}
      </div>

      {/* Magnetic Snapping Guide Indicator Line (1px accent blue, no neon glow) */}
      <div 
        ref={snapLineRef}
        className="timeline-snap-line"
        style={{
          left: 0,
          display: snapLineTime !== null ? 'block' : 'none',
          transform: snapLineTime !== null ? `translate3d(${snapLineTime * pps}px, 0, 0)` : 'translate3d(0, 0, 0)',
          willChange: 'transform',
        }}
      />

      {/* CapCut-style 9:16 Framing Keyframe Diamonds (💎) */}
      {Array.isArray(framingKeyframes) && framingKeyframes.length > 0 && (
        <div 
          className="timeline-keyframes-overlay"
          style={{
            position: 'absolute',
            top: 24,
            left: 0,
            right: 0,
            height: 14,
            pointerEvents: 'none',
            zIndex: 22,
          }}
        >
          {framingKeyframes.map((kf) => {
            const isNearPlayhead = Math.abs(kf.time - currentTime) <= 0.25;
            return (
              <div
                key={kf.id}
                data-testid={`timeline-keyframe-${kf.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (onSeek) onSeek(kf.time);
                }}
                title={`Keyframe (💎) ត្រង់ ${kf.time.toFixed(2)}s (${Math.round(kf.cropX)}%)`}
                style={{
                  position: 'absolute',
                  left: `${kf.time * pps}px`,
                  top: '50%',
                  transform: 'translate(-50%, -50%) rotate(45deg)',
                  width: isNearPlayhead ? 12 : 9,
                  height: isNearPlayhead ? 12 : 9,
                  backgroundColor: isNearPlayhead ? '#38BDF8' : '#F59E0B',
                  border: isNearPlayhead ? '2px solid #FFFFFF' : '1.5px solid #FFFFFF',
                  boxShadow: isNearPlayhead ? '0 0 6px rgba(56, 189, 248, 0.95)' : '0 0 4px rgba(245, 158, 11, 0.85)',
                  cursor: 'pointer',
                  pointerEvents: 'auto',
                  transition: 'all 0.15s ease',
                }}
              />
            );
          })}
        </div>
      )}

      {/* Hardware-Accelerated Playhead Line (transform: translate3d(x, 0, 0) for 60fps scrubbing) */}
      {selectedVideo && totalDuration > 0 && (
        <div 
          ref={playheadRef}
          className="timeline-playhead capcut-playhead-line"
          style={isPlaying ? { left: 0, willChange: 'transform' } : {
            left: 0,
            transform: `translate3d(${playheadX}px, 0, 0)`,
            willChange: 'transform'
          }}
        >
          <span ref={playheadTimeTextRef} className="playhead-time-pill">
            {formatMinSec(currentTime)}
          </span>
          <div 
            className="playhead-handle" 
            title="Drag to scrub playhead"
            onMouseDown={(e) => {
              e.stopPropagation();
              setIsScrubbing(true);
              handleScrub(e);
            }}
          />
          <div className="playhead-line capcut-playhead-stem" />
        </div>
      )}

      {/* Multi-Track Video Lanes (CapCut Desktop Video Rows) */}
      {Array.from({ length: Math.max(1, videoRowCount) }).map((_, rIdx) => {
        const trackKey = `video_${rIdx}`;
        const isHidden = Boolean(hiddenTracks[trackKey] || (rIdx === 0 && hiddenTracks.video));
        const isMuted = Boolean(
          mutedTracks?.[trackKey] ||
          (rIdx === 0 && mutedTracks?.video)
        );
        const isVoiceDragActive = dragState?.itemType === 'audio';
        const isDragOver = !isVoiceDragActive && (dragOverTrack === trackKey || (rIdx === 0 && dragOverTrack === 'video'));

        const isDraggedVoicePayload = (e, parsedData = null, parsedId = null) => {
          if (dragState?.itemType === 'audio') return true;
          const active = window.__activeDraggedTimelineItem;
          const checkObj = (obj) => Boolean(
            obj && (
              obj.itemType === 'audio' ||
              obj.type === 'voice-segment' ||
              obj.type === 'audio-segment' ||
              obj.segId !== undefined
            )
          );
          if (checkObj(active) || checkObj(parsedData)) return true;
          if (!parsedData && e?.dataTransfer) {
            try {
              const raw = e.dataTransfer.getData('application/json');
              if (raw && checkObj(JSON.parse(raw))) return true;
            } catch {}
          }
          if (parsedId !== null && parsedId !== undefined && parsedId !== '') {
            const matchesVideo = Boolean(videoClips?.some((c) => String(c.id) === String(parsedId)));
            const matchesSegment = Boolean(scriptSegments?.some((s) => String(s._uid ?? s.id) === String(parsedId) || String(s.id) === String(parsedId)));
            if (matchesSegment && !matchesVideo) return true;
          }
          return false;
        };

        return (
          <div 
            key={`video-lane-${rIdx}`}
            className={`track-lane video-lane ${rIdx > 0 ? 'video-lane-sub' : ''} ${isDragOver ? 'is-drag-over' : ''} ${isMuted ? 'is-track-muted' : ''}`}
            data-track-type="video"
            data-track-row={rIdx}
            data-track-key={trackKey}
            onDragOver={(e) => {
              // Video track is NEVER a valid drop target for a voice clip
              if (isDraggedVoicePayload(e)) {
                try {
                  if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
                } catch {}
                if (dragOverTrack === trackKey || dragOverTrack === 'video') {
                  setDragOverTrack(null);
                }
                return;
              }
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
              if (dragOverTrack !== trackKey) {
                setDragOverTrack(trackKey);
              }
            }}
            onDragLeave={(e) => {
              if (e.currentTarget.contains(e.relatedTarget)) return;
              setDragOverTrack(null);
            }}
            onDrop={async (e) => {
              e.preventDefault();
              setDragOverTrack(null);

              // Reject any voice clip dropped onto the video track before video-edge snapping or commit
              if (isDraggedVoicePayload(e)) {
                return;
              }

              // Allow direct file drop if dropped from OS
              const files = e.dataTransfer?.files;
              if (files && files.length > 0 && files[0].type.startsWith('video/')) {
                try {
                  const vidObj = await uploadVideoFile(files[0], { seriesId, episodeId });
                  if (onVideoSelected) {
                    onVideoSelected(vidObj);
                  }
                } catch (err) {
                  console.error('Timeline video drop failed:', err);
                }
                return;
              }

              const textData = e.dataTransfer ? e.dataTransfer.getData("text/plain") : null;
              let dragData = null;
              try {
                const raw = e.dataTransfer ? e.dataTransfer.getData("application/json") : null;
                if (raw) dragData = JSON.parse(raw);
              } catch (err) {}

              const fallback = window.__activeDraggedTimelineItem;
              const finalData = dragData || fallback;
              const finalId = textData || finalData?.clipId || finalData?.segId || finalData?.id;

              if (isDraggedVoicePayload(e, finalData, finalId)) {
                return;
              }

              const rect = e.currentTarget.getBoundingClientRect();
              const dropPixelX = Math.max(0, e.clientX - rect.left);
              let dropTime = Math.max(0, dropPixelX / pps);

              if (dropTime < 0.6 || (!videoClips || videoClips.length === 0)) {
                dropTime = 0;
              } else if (videoClips && videoClips.length > 0) {
                for (const c of videoClips) {
                  if (Math.abs(dropTime - c.end) < 0.6) {
                    dropTime = c.end;
                    break;
                  }
                }
              }

              if (handleMoveVideoToTrack) {
                handleMoveVideoToTrack(finalId, trackKey, dropTime, finalData);
              }
            }}
            style={{ 
              width: totalWidth || '100%',
              minWidth: totalWidth || '100%',
              opacity: isHidden ? 0.2 : (isMuted ? 0.45 : 1), 
              pointerEvents: isHidden ? 'none' : 'auto',
              borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
            }}
          >
            {isMuted && (
              <span className="track-muted-badge">MUTED</span>
            )}
            {/* Drop Visual Helper Badge */}
            {isDragOver && (
              <div className="track-drop-indicator-badge">
                <span>Drop to place on VIDEO {rIdx + 1}</span>
              </div>
            )}

            {!selectedVideo && rIdx === 0 ? (
              <div 
                className="empty-timeline-video-dropzone"
                onClick={handleTriggerImport}
                title="ចុចដើម្បីបញ្ចូលវីដេអូ ឬទម្លាក់ File វីដេអូមកទីនេះ (+ Import Video)"
              >
                <input
                  ref={videoFileInputRef}
                  type="file"
                  accept="video/*"
                  onChange={handleDirectVideoUpload}
                  style={{ display: 'none' }}
                />
                <Film size={14} color="#38BDF8" />
                <span>+ បញ្ចូលវីដេអូ ឬទម្លាក់ Video មកទីនេះ (+ Import Video)</span>
              </div>
            ) : (
              videoClips && videoClips
                .filter((clip) => (clip.trackRow || 0) === rIdx)
                .filter((clip, idx) => {
                  const isDragging = dragState?.itemType === 'video' && (dragState?.id === clip.id || dragState?.index === idx);
                  const isSelected = activeClipId === clip.id || (!isGapClip(clip) && selectedSegmentId !== null && doesClipMatchSegment(clip, selectedSegmentId));
                  if (isDragging || isSelected) return true;
                  const cStart = clip.start || 0;
                  const cEnd = clip.end || (cStart + 1);
                  return cEnd >= visibleRange.start && cStart <= visibleRange.end;
                })
                .map((clip, idx) => {
                  const realIdx = videoClips.findIndex(c => c.id === clip.id);
                  return renderVideoClip(clip, realIdx >= 0 ? realIdx : idx, trackKey, rIdx);
                })
            )}
          </div>
        );
      })}

      {/* Khmer AI Voice Tracks (Unlimited Voice Lanes) */}
      {Array.from({ length: Math.max(2, voiceRowCount || 2) }).map((_, rIdx) => {
        const trackKey = `voice_${rIdx}`;
        const isHidden = Boolean(hiddenTracks[trackKey] || (rIdx === 0 && hiddenTracks.voice));
        const isMuted = Boolean(mutedTracks?.[trackKey] || (rIdx === 0 && mutedTracks?.voice));
        const isDragOver = dragOverTrack === trackKey;
        const highestUsedVoiceRow = (scriptSegments || []).reduce((max, s) => {
          const r = (typeof s.trackRow === 'number' && s.trackRow >= 0) ? s.trackRow : 0;
          return Math.max(max, r);
        }, 0);
        const isNewLane = rIdx > highestUsedVoiceRow;
        const laneVoiceSegments = (scriptSegments || []).filter((seg, idx) => {
          if (activeSegmentRows[idx] !== rIdx) return false;
          return shouldRenderOnVoiceTrack(seg);
        });

        return (
          <div 
            key={`voice-lane-${rIdx}`}
            className={`track-lane voice-lane ${rIdx > 0 ? 'voice-lane-sub' : ''} ${isDragOver ? 'is-drag-over' : ''} ${isMuted ? 'is-track-muted' : ''}`}
            data-track-type="voice"
            data-track-row={rIdx}
            data-track-key={trackKey}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
              if (dragOverTrack !== trackKey) {
                setDragOverTrack(trackKey);
              }
            }}
            onDragLeave={(e) => {
              if (e.currentTarget.contains(e.relatedTarget)) return;
              setDragOverTrack(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragOverTrack(null);
              const rect = e.currentTarget.getBoundingClientRect();
              const dropPixelX = Math.max(0, e.clientX - rect.left);
              const dropTime = Math.max(0, dropPixelX / pps);

              const textData = e.dataTransfer ? e.dataTransfer.getData("text/plain") : null;
              let dragData = null;
              try {
                const raw = e.dataTransfer ? e.dataTransfer.getData("application/json") : null;
                if (raw) dragData = JSON.parse(raw);
              } catch (err) {}

              const fallback = window.__activeDraggedTimelineItem;
              const finalData = dragData || fallback;
              const finalId = textData || finalData?.clipId || finalData?.segId || finalData?.id;

              if (handleMoveVideoToTrack) {
                handleMoveVideoToTrack(finalId, trackKey, dropTime, finalData);
              }
            }}
            style={{ 
              width: totalWidth || '100%',
              minWidth: totalWidth || '100%',
              opacity: isHidden ? 0.2 : (isMuted ? 0.45 : 1), 
              pointerEvents: isHidden ? 'none' : 'auto',
              borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
            }}
          >
            {isMuted && (
              <span className="track-muted-badge">MUTED</span>
            )}
            {isDragOver && (
              <div className="track-drop-indicator-badge voice">
                <span>{isNewLane ? `Drop to create VOICE ${rIdx + 1}` : `Drop to place on VOICE ${rIdx + 1} (A${rIdx + 1})`}</span>
              </div>
            )}
            {(laneVoiceSegments.length === 0) ? (
              <span className="empty-lane-placeholder-text">VOICE {rIdx + 1} (Khmer AI Voice Track)</span>
            ) : (
              scriptSegments.map((seg, idx) => {
                if (activeSegmentRows[idx] !== rIdx) return null;
                if (!shouldRenderOnVoiceTrack(seg)) return null;

                const isDragging = (dragState?.itemType === 'audio' || dragState?.itemType === 'subtitle') && dragState?.index === idx;
                const isSelected = Boolean(
                  (activeClipId && videoClips?.some((c) => c.id === activeClipId && doesClipMatchSegment(c, seg, seg.segmentId ?? seg.id ?? idx + 1))) ||
                  (selectedSegmentId !== null && selectedSegmentId !== undefined && (
                    (seg._uid && String(selectedSegmentId) === String(seg._uid)) || (seg.id !== undefined && seg.id !== null ? String(selectedSegmentId) === String(seg.id) : Number(selectedSegmentId) === idx)
                  )) ||
                  (selectedAudioId !== null && selectedAudioId !== undefined && (
                    (seg._uid && String(selectedAudioId) === String(seg._uid)) || (seg.id !== undefined && seg.id !== null ? String(selectedAudioId) === String(seg.id) : Number(selectedAudioId) === idx)
                  ))
                );

                if (!isDragging && !isSelected) {
                  const vStart = (typeof seg.audioStartSec === 'number' && !isNaN(seg.audioStartSec))
                    ? seg.audioStartSec
                    : ((typeof seg.startSec === 'number' && !isNaN(seg.startSec))
                      ? seg.startSec
                      : parseTimeToSeconds(seg.start, idx * 4));
                  const vEnd = ((seg.audioTrimmed || seg.userTrimmed) && typeof seg.audioEndSec === 'number') ? seg.audioEndSec : (typeof seg.audioEndSec === 'number' && !isNaN(seg.audioEndSec) ? seg.audioEndSec : vStart + 3.0);
                  if (vEnd < visibleRange.start || vStart > visibleRange.end) {
                    return null;
                  }
                }

                return renderVoiceSegment(seg, idx);
              })
            )}
          </div>
        );
      })}

      {/* Subtitles Tracks: shown when in Step 2 (Dubbing Mode & Script) or when subtitles exist */}
      {showSubtitles && Array.from({ length: subRowCount }).map((_, rIdx) => {
        const trackKey = `subs_${rIdx}`;
        const isHidden = Boolean(hiddenTracks[trackKey] || (rIdx === 0 && hiddenTracks.subs));
        const isDragOver = dragOverTrack === trackKey;
        const hasSubSegments = Boolean(scriptSegments && scriptSegments.length > 0);

        return (
          <div 
            key={`sub-lane-${rIdx}`}
            className={`track-lane subtitle-lane ${rIdx > 0 ? 'subtitle-lane-sub' : ''} ${isDragOver ? 'is-drag-over' : ''}`}
            data-track-type="subs"
            data-track-row={rIdx}
            data-track-key={trackKey}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
              if (dragOverTrack !== trackKey) {
                setDragOverTrack(trackKey);
              }
            }}
            onDragLeave={(e) => {
              if (e.currentTarget.contains(e.relatedTarget)) return;
              setDragOverTrack(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragOverTrack(null);
              const rect = e.currentTarget.getBoundingClientRect();
              const dropPixelX = Math.max(0, e.clientX - rect.left);
              const dropTime = Math.max(0, dropPixelX / pps);

              const textData = e.dataTransfer ? e.dataTransfer.getData("text/plain") : null;
              let dragData = null;
              try {
                const raw = e.dataTransfer ? e.dataTransfer.getData("application/json") : null;
                if (raw) dragData = JSON.parse(raw);
              } catch (err) {}

              const fallback = window.__activeDraggedTimelineItem;
              const finalData = dragData || fallback;
              const finalId = textData || finalData?.clipId || finalData?.segId || finalData?.id;

              if (handleMoveVideoToTrack) {
                handleMoveVideoToTrack(finalId, trackKey, dropTime, finalData);
              }
            }}
            style={{ 
              width: totalWidth || '100%',
              minWidth: totalWidth || '100%',
              opacity: isHidden ? 0.2 : 1, 
              pointerEvents: isHidden ? 'none' : 'auto',
              borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
            }}
          >
            {isDragOver && (
              <div className="track-drop-indicator-badge sub">
                <span>Drop to place on SUBTITLES {rIdx + 1} (T{rIdx + 1})</span>
              </div>
            )}
            {!hasSubSegments ? (
              <span className="empty-lane-placeholder-text">SUBTITLES {rIdx + 1}</span>
            ) : (
              scriptSegments.map((seg, idx) => {
                const subRow = (typeof seg.subTrackRow === 'number' && seg.subTrackRow >= 0) ? seg.subTrackRow : 0;
                if (subRow !== rIdx) return null;

                const isDragging = (dragState?.itemType === 'audio' || dragState?.itemType === 'subtitle') && dragState?.index === idx;
                const isSelected = Boolean(
                  (activeClipId && videoClips?.some((c) => c.id === activeClipId && doesClipMatchSegment(c, seg, seg.segmentId ?? seg.id ?? idx + 1))) ||
                  (selectedSegmentId !== null && selectedSegmentId !== undefined && (
                    (seg._uid && String(selectedSegmentId) === String(seg._uid)) || (seg.id !== undefined && seg.id !== null ? String(selectedSegmentId) === String(seg.id) : Number(selectedSegmentId) === idx)
                  )) ||
                  (selectedSubId !== null && selectedSubId !== undefined && (
                    (seg._uid && String(selectedSubId) === String(seg._uid)) || (seg.id !== undefined && seg.id !== null ? String(selectedSubId) === String(seg.id) : Number(selectedSubId) === idx)
                  ))
                );

                if (!isDragging && !isSelected) {
                  const sStart = (typeof seg.startSec === 'number' && !isNaN(seg.startSec)) ? seg.startSec : parseTimeToSeconds(seg.start, idx * 4);
                  const sEnd = (typeof seg.endSec === 'number' && !isNaN(seg.endSec)) ? seg.endSec : parseTimeToSeconds(seg.end, sStart + 3.0);
                  if (sEnd < visibleRange.start || sStart > visibleRange.end) {
                    return null;
                  }
                }

                return renderSubSegment(seg, idx);
              })
            )}
          </div>
        );
      })}

      {/* Clean BGM Track Lane (Height: 40px) */}
      {(() => {
        const isBgmMuted = Boolean(
          mutedTracks?.cleanBgm || (voiceSettings && typeof voiceSettings.duckingVolume === 'number' && voiceSettings.duckingVolume === 0)
        );
        return (
          <div 
            className={`track-lane clean-bgm-lane ${isBgmMuted ? 'is-track-muted' : ''}`}
            data-track-type="clean-bgm"
            style={{ 
              width: totalWidth || '100%',
              minWidth: totalWidth || '100%',
              height: 40,
              opacity: hiddenTracks?.cleanBgm ? 0.2 : (isBgmMuted ? 0.45 : 1), 
              pointerEvents: hiddenTracks?.cleanBgm ? 'none' : 'auto',
              borderBottom: '1px solid oklch(0.25 0.01 250)',
            }}
          >
            {isBgmMuted && (
              <span className="track-muted-badge">MUTED</span>
            )}
            {selectedVideo && totalDuration > 0 ? (
              <div
                className="clean-bgm-block"
                style={{
                  left: 0,
                  width: Math.max(2, totalDuration * pps - 2),
                  top: 4,
                  height: 32,
                }}
                title={`CLEAN BGM [0.0s - ${totalDuration.toFixed(1)}s]`}
              >
                {totalDuration * pps >= 32 && (
                  <div className="clip-label-line">
                    <span className="clip-label-text">CLEAN BGM</span>
                  </div>
                )}
                <div className="clip-content-row clean-bgm-content-row" />
              </div>
            ) : (
              <span className="empty-lane-placeholder-text">CLEAN BGM (Background Music & SFX Track)</span>
            )}
          </div>
        );
      })()}
    </div>
  );
}

function areTimelineTracksCanvasPropsEqual(prev, next) {
  // Re-render only when drag session starts or ends, or if dragged item changes
  if (Boolean(prev.dragState) !== Boolean(next.dragState)) return false;
  if (prev.dragState && next.dragState && prev.dragState.id !== next.dragState.id) return false;

  // Re-render when play/pause toggles, or when clips, segments, or settings actually change
  if (prev.isPlaying !== next.isPlaying) return false;

  // NOTE: currentTime, playheadX, and callback handlers are deliberately excluded here because
  // playhead position and timecode text are updated smoothly on hardware GPU via direct requestAnimationFrame
  // translate3d transforms. Bypassing React re-renders of 1,000+ timeline DOM elements keeps playback and scrubbing at pure 60fps!
  if (prev.videoClips !== next.videoClips) return false;
  if (prev.scriptSegments !== next.scriptSegments) return false;
  if (prev.segmentRows !== next.segmentRows) return false;
  if (prev.activeClipId !== next.activeClipId) return false;
  if (prev.selectedSegmentId !== next.selectedSegmentId) return false;
  if (prev.selectedAudioId !== next.selectedAudioId) return false;
  if (prev.selectedSubId !== next.selectedSubId) return false;
  if (prev.pps !== next.pps) return false;
  if (prev.markers !== next.markers) return false;
  if (prev.totalDuration !== next.totalDuration) return false;
  if (prev.totalWidth !== next.totalWidth) return false;
  if (prev.hiddenTracks !== next.hiddenTracks) return false;
  if (prev.mutedTracks !== next.mutedTracks) return false;
  if (prev.voiceRowCount !== next.voiceRowCount) return false;
  if (prev.subRowCount !== next.subRowCount) return false;
  if (prev.videoRowCount !== next.videoRowCount) return false;
  if (prev.audioGenerated !== next.audioGenerated) return false;
  if (prev.voiceSettings !== next.voiceSettings) return false;
  if (prev.showSubtitles !== next.showSubtitles) return false;
  if (prev.framingKeyframes !== next.framingKeyframes) return false;
  if (prev.selectedVideo !== next.selectedVideo) return false;
  if (prev.seriesId !== next.seriesId || prev.episodeId !== next.episodeId) return false;

  return true;
}

export default React.memo(TimelineTracksCanvas, areTimelineTracksCanvasPropsEqual);
