import React, { useState, useRef, useEffect, useCallback } from 'react';
import { formatMinSec } from '../utils/timestampUtils';
import { getPixelsPerSecond, trimClip, moveClip, syncSegmentsWithMovedClip, deleteSegmentByIdOrIndex, resolveSegmentAtTime } from '../utils/timelineUtils';

import TimelineToolbar from './timeline/TimelineToolbar';
import TimelineTrackHeaders from './timeline/TimelineTrackHeaders';
import TimelineTracksCanvas from './timeline/TimelineTracksCanvas';
import './TimelineEditor.css';

const TRACK_HEADER_WIDTH = 112;

function TimelineEditor({
  videoRef = null,
  currentTime = 0,
  duration = 0,
  isPlaying = false,
  onSeek,
  onPlayPause,
  videoClips = [],
  activeClipId = null,
  onSelectClip,
  onUpdateClips,
  onSplitClip,
  onDeleteClip,
  onDeleteSegment = null,
  scriptSegments = [],
  onUpdateSegments,
  voiceSettings = {},
  onUpdateVoiceSettings,
  audioGenerated = false,
  selectedVideo = null,
  videoThumbnails = [],
  selectedSegmentId = null,
  onSelectSegment = null,
  onAutoSplitVideo = null,
  onResetFullVideo = null,
  onBridgeGaps = null,
  onAutoAlignNoOverlap = null,
  onResetToSourceTiming = null,
  onAddSegment = null,
  onToggleMuteSegment = null,
  onToggleMuteVideoClip = null,
  onToggleMuteAllCuts = null,
  canUndo = false,
  canRedo = false,
  onUndo = null,
  onRedo = null,
  onGenerateAudio = null,
  isGeneratingAudio = false,
  speakerRegistry = {},
  onAddClipToTimeline = null,
  mediaAssets = [],
  activeTab = 'media',
  onImportClick = null,
  onVideoSelected = null,
  seriesId = null,
  episodeId = null,
}) {
  const [zoom, setZoom] = useState(1);
  const [selectedSubId, setSelectedSubId] = useState(null);
  const [selectedAudioId, setSelectedAudioId] = useState(null);
  const [lastSelectedType, setLastSelectedType] = useState('none'); // 'video' | 'audio' | 'subtitle' | 'none'
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [dragState, setDragState] = useState(null);
  const [snappingEnabled, setSnappingEnabled] = useState(true);
  const [snapLineTime, setSnapLineTime] = useState(null);
  const [lockedTracks, setLockedTracks] = useState({ video: false, voice: false, subs: false, cleanBgm: false });
  const [hiddenTracks, setHiddenTracks] = useState({ video: false, voice: false, subs: false, cleanBgm: false });
  const [mutedTracks, setMutedTracks] = useState({ video: false, voice: false, subs: false, cleanBgm: false });
  const [autoCenter, setAutoCenter] = useState(true);
  const isNativeDraggingRef = useRef(false);

  // Persistent toggle for Subtitles Track visibility on timeline (Default on first run: OFF)
  const [showSubtitlesTrack, setShowSubtitlesTrack] = useState(() => {
    try {
      const saved = localStorage.getItem('TIMELINE_SHOW_SUBTITLES');
      if (saved !== null) {
        return saved === 'true';
      }
    } catch (_) {}
    return false; // Default state on first run: OFF
  });

  useEffect(() => {
    try {
      localStorage.setItem('TIMELINE_SHOW_SUBTITLES', String(showSubtitlesTrack));
    } catch (_) {}
  }, [showSubtitlesTrack]);

  // Subtitles Track display: strictly controlled by user's show/hide toggle (VIEW ONLY)
  const showSubtitles = Boolean(showSubtitlesTrack);

  const [dragOverTrack, setDragOverTrack] = useState(null);
  const [userVideoTrackCount, setUserVideoTrackCount] = useState(1);

  // Dynamic Multi-Track Layer Allocation (Clean Pro CapCut Dual-Track Layout)
  // Consolidates dialogue onto Row 0 (single clean straight line); overlaps drop cleanly into Row 1
  const { segmentRows, calculatedVoiceRows, calculatedSubRows } = React.useMemo(() => {
    if (!scriptSegments || scriptSegments.length === 0) {
      return { segmentRows: [], calculatedVoiceRows: 1, calculatedSubRows: 1 };
    }

    const rowEndTimes = [0, 0];

    const rows = scriptSegments.map((seg, idx) => {
      const rawStart = (typeof seg.audioStartSec === 'number' && !isNaN(seg.audioStartSec))
        ? seg.audioStartSec 
        : (typeof seg.startSec === 'number' && !isNaN(seg.startSec) ? seg.startSec : idx * 4);
      const rawEnd = (typeof seg.audioEndSec === 'number' && !isNaN(seg.audioEndSec))
        ? seg.audioEndSec 
        : (typeof seg.endSec === 'number' && !isNaN(seg.endSec) ? seg.endSec : rawStart + (seg.audioDurationSec || 2.5));

      // If user explicitly shifted and set trackRow to 0 or 1, respect it
      if (typeof seg.trackRow === 'number' && seg.userShifted) {
        const userR = Math.min(1, Math.max(0, seg.trackRow));
        rowEndTimes[userR] = Math.max(rowEndTimes[userR] || 0, rawEnd);
        return userR;
      }

      // Default: Place on Row 0 (Main Voice Line)
      if (rawStart >= (rowEndTimes[0] || 0) - 0.05) {
        rowEndTimes[0] = rawEnd;
        return 0;
      }
      // If collision on Row 0, use Row 1 (Secondary Voice Line)
      if (rawStart >= (rowEndTimes[1] || 0) - 0.05) {
        rowEndTimes[1] = rawEnd;
        return 1;
      }
      // If both collide, pick the row that ends earlier
      const pickRow = (rowEndTimes[0] || 0) <= (rowEndTimes[1] || 0) ? 0 : 1;
      rowEndTimes[pickRow] = Math.max(rowEndTimes[pickRow] || 0, rawEnd);
      return pickRow;
    });

    const hasRow1 = rows.some(r => r === 1);
    const voiceCount = hasRow1 ? 2 : 1;

    return {
      segmentRows: rows,
      calculatedVoiceRows: voiceCount,
      calculatedSubRows: 1, // Subtitles always sit on 1 unified continuous track
    };
  }, [scriptSegments]);

  // Multi-Track Track Counts (Capped to max 2 voice tracks for clean layout)
  const [userVoiceTrackCount, setUserVoiceTrackCount] = useState(1);
  const [userSubTrackCount, setUserSubTrackCount] = useState(1);

  const maxVideoRow = (videoClips || []).reduce((max, c) => Math.max(max, c.trackRow || 0), 0);
  const isDraggingVideoDown = dragState?.itemType === 'video' && dragState?.mode === 'move' && (dragState?.currentY > 20);
  const draggingTargetRow = isDraggingVideoDown 
    ? ((videoClips?.find(c => c.id === dragState.id)?.trackRow || 0) + Math.max(1, Math.round((dragState.currentY || 0) / 52)))
    : 0;
  const videoRowCount = Math.max(userVideoTrackCount, maxVideoRow + 1, draggingTargetRow + 1, 1);
  const voiceRowCount = Math.min(2, Math.max(userVoiceTrackCount, calculatedVoiceRows, 1));
  const maxSubRow = (scriptSegments || []).reduce((max, s) => Math.max(max, (typeof s.subTrackRow === 'number' && s.subTrackRow >= 0) ? s.subTrackRow : 0), 0);
  const isDraggingSubDown = dragState?.itemType === 'subtitle' && dragState?.mode === 'move' && (dragState?.currentY > 20);
  const draggingSubTargetRow = isDraggingSubDown 
    ? (((typeof scriptSegments?.[dragState.index]?.subTrackRow === 'number' ? scriptSegments[dragState.index].subTrackRow : 0)) + Math.max(1, Math.round((dragState.currentY || 0) / 42)))
    : 0;
  const subRowCount = Math.max(1, userSubTrackCount || 1, maxSubRow + 1, draggingSubTargetRow + 1);

  // CapCut Cross-Track Drag & Drop Handler (Drop across Video, Voice, Subtitle tracks)
  const handleMoveVideoToTrack = useCallback((clipIdOrAssetId, targetTrackId, dropTime = null, dragData = null) => {
    isNativeDraggingRef.current = false;
    const fallbackDragged = window.__activeDraggedTimelineItem;
    window.__activeDraggedTimelineItem = null;
    setDragState(null);

    const effectiveData = dragData || fallbackDragged;
    const effectiveId = clipIdOrAssetId || effectiveData?.clipId || effectiveData?.asset?.videoId || (videoClips?.length === 1 ? videoClips[0]?.id : null);

    if (!effectiveId && !effectiveData) return;

    const safeTime = (typeof dropTime === 'number' && !isNaN(dropTime) && dropTime >= 0)
      ? parseFloat(dropTime.toFixed(2))
      : currentTime;

    // Parse targetTrackId into type ('video' | 'voice' | 'subs') and row (0, 1, 2...)
    let trackType = 'video';
    let trackRow = 0;
    const cleanTrack = String(targetTrackId || 'video_0').toLowerCase();
    
    if (cleanTrack.includes('sub') || cleanTrack.startsWith('t')) {
      trackType = 'subs';
      const numMatch = cleanTrack.match(/\d+/);
      if (numMatch) {
        const n = parseInt(numMatch[0], 10);
        trackRow = cleanTrack.includes('_') ? n : Math.max(0, n - 1);
      }
    } else if (cleanTrack.includes('voice') || cleanTrack.startsWith('a')) {
      trackType = 'voice';
      const numMatch = cleanTrack.match(/\d+/);
      if (numMatch) {
        const n = parseInt(numMatch[0], 10);
        trackRow = cleanTrack.includes('_') ? n : Math.max(0, n - 1);
      }
    } else if (cleanTrack.includes('video') || cleanTrack.startsWith('v')) {
      trackType = 'video';
      const numMatch = cleanTrack.match(/\d+/);
      if (numMatch) {
        const n = parseInt(numMatch[0], 10);
        trackRow = cleanTrack.includes('_') ? n : Math.max(0, n - 1);
      }
    }

    // Auto expand track counts if dropped onto a new track lane index
    if (trackType === 'voice' && trackRow >= userVoiceTrackCount) {
      setUserVoiceTrackCount(trackRow + 1);
    } else if (trackType === 'subs' && trackRow >= userSubTrackCount) {
      setUserSubTrackCount(trackRow + 1);
    }

    // 1. Dragged Media Asset from Media Bin (MediaUploadTab)
    if (effectiveData?.type === 'media-asset' || (!videoClips?.some(c => String(c.id) === String(effectiveId)) && !scriptSegments?.some(s => String(s.id) === String(effectiveId)))) {
      const asset = effectiveData?.asset || (mediaAssets || []).find(a => String(a.videoId) === String(effectiveId) || String(a.id) === String(effectiveId)) || selectedVideo;
      if (asset) {
        if (onAddClipToTimeline) {
          // CapCut Magnet: if dropped near start (< 1.5s or empty track), snap cleanly to 00:00!
          let dropInsertTime = safeTime;
          if (dropInsertTime < 1.5 || (!videoClips || videoClips.length === 0)) {
            dropInsertTime = 0;
          }
          onAddClipToTimeline(dropInsertTime, {
            ...asset,
            targetTrackId: 'video-1',
            targetTrackRow: 0,
          });
        }
        return;
      }
    }

    // 2. Existing Video Clip on Timeline (Moves horizontally on single main VIDEO 1 track)
    const existingVideoClip = videoClips?.find(c => 
      String(c.id) === String(effectiveId) || 
      String(c.id) === String(effectiveData?.clipId) ||
      (effectiveData?.type === 'video-clip' && videoClips.length === 1)
    );

    if (existingVideoClip) {
      const clipDur = Math.max(0.4, existingVideoClip.end - existingVideoClip.start);
      const targetVideoRow = (trackType === 'video' && typeof trackRow === 'number') ? trackRow : 0;
      const targetVideoTrackId = `video-${targetVideoRow + 1}`;
      if (targetVideoRow >= userVideoTrackCount) {
        setUserVideoTrackCount(targetVideoRow + 1);
      }

      // CapCut Magnetic Snap: snap to 00:00 only if dropped near start (< 0.6s)
      let snapStart = safeTime;
      if (snapStart < 0.6) {
        snapStart = 0;
      } else {
        for (const other of videoClips) {
          if (other.id !== existingVideoClip.id) {
            if (Math.abs(snapStart - other.end) < 0.6) {
              snapStart = other.end;
              break;
            } else if (Math.abs((snapStart + clipDur) - other.start) < 0.6) {
              snapStart = Math.max(0, other.start - clipDur);
              break;
            }
          }
        }
      }

      // Move clip to target track and drop time
      const updatedClips = videoClips.map((c) => {
        if (c.id === existingVideoClip.id) {
          return {
            ...c,
            trackId: targetVideoTrackId,
            trackRow: targetVideoRow,
            start: snapStart,
            end: parseFloat((snapStart + clipDur).toFixed(2)),
          };
        }
        return c;
      });

      // Synchronize associated dialogue segments (voice & subtitles) with the moved video clip
      let updatedSegs = null;
      if (scriptSegments && scriptSegments.length > 0) {
        const synced = syncSegmentsWithMovedClip(existingVideoClip, snapStart, scriptSegments);
        if (synced !== scriptSegments) {
          updatedSegs = synced;
        }
      }

      if (onUpdateClips) {
        onUpdateClips(updatedClips, updatedSegs);
      }
      return;
    }

    // 3. Dialogue / Audio / Subtitle Segment moved across tracks or rows (T1 -> T2, A1 -> A2, etc.)
    if (scriptSegments && onUpdateSegments) {
      const segIdx = scriptSegments.findIndex(s => 
        String(s.id) === String(clipIdOrAssetId) || 
        String(s.id) === String(dragData?.segId) ||
        (dragData?.index !== undefined && dragData?.index === scriptSegments.indexOf(s))
      );
      if (segIdx >= 0) {
        const seg = scriptSegments[segIdx];
        const origStart = typeof seg.startSec === 'number' ? seg.startSec : 0;
        const origEnd = typeof seg.endSec === 'number' ? seg.endSec : origStart + 3.0;
        const dur = Math.max(0.4, origEnd - origStart);

        const updated = [...scriptSegments];
        updated[segIdx] = {
          ...seg,
          ...(trackType === 'subs' ? { subTrackRow: trackRow } : { trackRow: trackRow }),
          startSec: safeTime,
          endSec: parseFloat((safeTime + dur).toFixed(2)),
          start: formatMinSec(safeTime),
          end: formatMinSec(safeTime + dur),
          audioStartSec: safeTime,
          audioEndSec: parseFloat((safeTime + dur).toFixed(2)),
          audioStart: formatMinSec(safeTime),
          audioEnd: formatMinSec(safeTime + dur),
          userShifted: true,
        };
        onUpdateSegments(updated);
      }
    }
  }, [
    currentTime, 
    userVoiceTrackCount, 
    userSubTrackCount, 
    videoClips, 
    scriptSegments, 
    mediaAssets, 
    selectedVideo, 
    onAddClipToTimeline, 
    onAddSegment, 
    onUpdateClips, 
    onUpdateSegments
  ]);

  const timelineBodyRef = useRef(null);
  const currentTimeRef = useRef(currentTime);
  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  const isScrubbingRef = useRef(isScrubbing);
  useEffect(() => {
    isScrubbingRef.current = isScrubbing;
  }, [isScrubbing]);

  const dragStateRef = useRef(dragState);
  useEffect(() => {
    dragStateRef.current = dragState;
  }, [dragState]);

  const selectedSegmentIdRef = useRef(selectedSegmentId);
  const lastSyncedInspectorIdRef = useRef(selectedSegmentId);
  const lastPlayheadSegKeyRef = useRef(null);
  const followSyncSkippedDueToEditingRef = useRef(false);
  const scriptSegmentsRef = useRef(scriptSegments);
  scriptSegmentsRef.current = scriptSegments;
  const onSelectSegmentRef = useRef(onSelectSegment);
  onSelectSegmentRef.current = onSelectSegment;
  const lastUserSelectTimeRef = useRef(0);
  const scrubRafRef = useRef(null);
  const pendingScrubTimeRef = useRef(null);
  const handleScrubRef = useRef(null);
  const playheadRef = useRef(null);
  const playheadTimeTextRef = useRef(null);
  const videoClipsRef = useRef(videoClips);
  videoClipsRef.current = videoClips;
  const ppsRef = useRef(getPixelsPerSecond(zoom));
  ppsRef.current = getPixelsPerSecond(zoom);

  useEffect(() => {
    selectedSegmentIdRef.current = selectedSegmentId;
    lastSyncedInspectorIdRef.current = selectedSegmentId;
    setSelectedSubId(selectedSegmentId);
    setSelectedAudioId(selectedSegmentId);
  }, [selectedSegmentId]);

  // Safe blur helper: Blurs active Inspector textarea/input so editing commits safely before timeline actions
  const safeBlurInspectorInput = useCallback(() => {
    if (typeof document === 'undefined') return;
    const active = document.activeElement;
    if (!active) return;
    const isEditable = active.tagName === 'TEXTAREA' || active.tagName === 'INPUT';
    if (isEditable && (active.closest?.('.top-suite-col-right') || active.closest?.('.inspector-card-group') || active.closest?.('.clip-inspector-panel'))) {
      active.blur();
    }
  }, []);

  // Helper to check if user is actively typing in a text field or textarea in the Inspector
  const isEditingInspectorText = useCallback(() => {
    if (typeof document === 'undefined') return false;
    const active = document.activeElement;
    if (!active) return false;
    const isText = active.tagName === 'TEXTAREA' || active.tagName === 'INPUT';
    return Boolean(
      isText && (active.closest?.('.top-suite-col-right') || active.closest?.('.inspector-card-group') || active.closest?.('.clip-inspector-panel'))
    );
  }, []);

  // Auto-follow playhead line |: Update selected segment and Inspector when playhead moves across speaking segments
  // Runs both during playback and when seeking/paused; preserves manual click selection until playhead crosses into next segment
  useEffect(() => {
    if (!scriptSegments || scriptSegments.length === 0 || !Number.isFinite(currentTime) || dragState || isScrubbing || isScrubbingRef.current) return;

    const isEditingText = isEditingInspectorText();

    // Resolve segment at currentTime using deterministic boundary logic
    const activeSeg = resolveSegmentAtTime(scriptSegments, currentTime);

    if (activeSeg) {
      const segKey = activeSeg._uid || (activeSeg.id !== undefined && activeSeg.id !== null ? activeSeg.id : scriptSegments.indexOf(activeSeg));
      const isNewSegment = String(segKey) !== String(lastPlayheadSegKeyRef.current);

      if (isNewSegment) {
        // Guard: Do not change selection if user is actively typing in a text field or textarea in the Inspector
        if (isEditingText) {
          followSyncSkippedDueToEditingRef.current = true;
          return;
        }

        lastPlayheadSegKeyRef.current = segKey;

        // Update local timeline highlights so user sees what is playing/active
        if (String(selectedSegmentIdRef.current) !== String(segKey)) {
          selectedSegmentIdRef.current = segKey;
          setSelectedAudioId(segKey);
          setSelectedSubId(segKey);
        }

        // Sync Inspector to current playhead segment (both during playback and when paused)
        if (String(lastSyncedInspectorIdRef.current) !== String(segKey)) {
          lastSyncedInspectorIdRef.current = segKey;
          if (onSelectSegment) {
            onSelectSegment(segKey);
          }
        }
      }
    } else {
      // In gaps, clear playhead anchor so when next segment begins it is recognized as a new segment
      lastPlayheadSegKeyRef.current = null;
    }
    // In gaps, preserve current selection so Inspector never disappears unexpectedly
  }, [currentTime, scriptSegments, dragState, isScrubbing, isPlaying, onSelectSegment, isEditingInspectorText]);

  // Catch-up after editing: If follow-sync was skipped because user was typing in the Inspector,
  // catch up to the current playhead segment on blur/focusout even while paused
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const handleFocusOut = (e) => {
      const target = e.target;
      if (!target || (target.tagName !== 'TEXTAREA' && target.tagName !== 'INPUT')) return;
      if (!(target.closest?.('.top-suite-col-right') || target.closest?.('.inspector-card-group') || target.closest?.('.clip-inspector-panel'))) {
        return;
      }

      // Small delay (50ms) to allow activeElement to settle in case focus moved to another Inspector input
      setTimeout(() => {
        if (isEditingInspectorText()) return;

        if (followSyncSkippedDueToEditingRef.current) {
          followSyncSkippedDueToEditingRef.current = false;

          const currentT = Number.isFinite(currentTimeRef.current) ? currentTimeRef.current : 0;
          const currentSegs = scriptSegmentsRef.current || [];
          const activeSeg = resolveSegmentAtTime(currentSegs, currentT);

          if (activeSeg) {
            const segKey = activeSeg._uid || (activeSeg.id !== undefined && activeSeg.id !== null ? activeSeg.id : currentSegs.indexOf(activeSeg));
            lastPlayheadSegKeyRef.current = segKey;

            if (String(selectedSegmentIdRef.current) !== String(segKey)) {
              selectedSegmentIdRef.current = segKey;
              setSelectedAudioId(segKey);
              setSelectedSubId(segKey);
            }

            if (String(lastSyncedInspectorIdRef.current) !== String(segKey)) {
              lastSyncedInspectorIdRef.current = segKey;
              if (onSelectSegmentRef.current) {
                onSelectSegmentRef.current(segKey);
              }
            }
          }
        }
      }, 50);
    };

    document.addEventListener('focusout', handleFocusOut);
    return () => {
      document.removeEventListener('focusout', handleFocusOut);
    };
  }, [isEditingInspectorText]);

  const totalDuration = React.useMemo(() => {
    const clipsMax = (videoClips || []).reduce((max, c) => Math.max(max, Number(c.end) || 0), 0);
    const subsMax = (scriptSegments || []).reduce((max, s) => {
      const end = Number(s.audioEndSec) || Number(s.endSec) || (Number(s.startSec) || 0) + (Number(s.audioDurationSec) || 3.0);
      return Math.max(max, end);
    }, 0);
    return Math.max(duration > 0 ? duration : 0, clipsMax, subsMax);
  }, [duration, videoClips, scriptSegments]);

  const pps = getPixelsPerSecond(zoom);
  // Provide extra tail padding (1000px) so playhead stays centered all the way to the end of the video
  const totalWidth = React.useMemo(() => {
    return Math.max(1200, totalDuration * pps + TRACK_HEADER_WIDTH + 1000);
  }, [totalDuration, pps]);

  const handleCenterPlayhead = useCallback(() => {
    if (!timelineBodyRef.current) return;
    const container = timelineBodyRef.current;
    const clientWidth = container.clientWidth;
    if (clientWidth <= 0) return;
    const targetScroll = Math.max(0, (currentTime * pps + TRACK_HEADER_WIDTH) - (clientWidth / 2));
    container.scrollTo({ left: targetScroll, behavior: 'smooth' });
    setAutoCenter(true);
  }, [currentTime, pps]);

  const performScrub = useCallback((newTime) => {
    onSeek(newTime);
  }, [onSeek]);

  // Playhead scrubber calculation with requestAnimationFrame batching for ultra-smooth 60fps scrubbing
  const handleScrub = useCallback((e) => {
    if (!timelineBodyRef.current || totalDuration === 0) return;
    const rect = timelineBodyRef.current.getBoundingClientRect();
    const scrollLeft = timelineBodyRef.current.scrollLeft || 0;
    const clickX = e.clientX - rect.left + scrollLeft - TRACK_HEADER_WIDTH;
    if (clickX < 0) {
      pendingScrubTimeRef.current = 0;
      if (playheadRef.current) {
        playheadRef.current.style.transform = 'translate3d(0px, 0, 0)';
      }
      if (playheadTimeTextRef.current) {
        playheadTimeTextRef.current.textContent = formatMinSec(0);
      }
      performScrub(0);
      return;
    }
    const newTime = Math.min(totalDuration, Math.max(0, clickX / pps));
    if (playheadRef.current) {
      playheadRef.current.style.transform = `translate3d(${newTime * pps}px, 0, 0)`;
    }
    if (playheadTimeTextRef.current) {
      playheadTimeTextRef.current.textContent = formatMinSec(newTime);
    }
    pendingScrubTimeRef.current = newTime;

    if (!scrubRafRef.current) {
      scrubRafRef.current = requestAnimationFrame(() => {
        scrubRafRef.current = null;
        if (pendingScrubTimeRef.current !== null) {
          performScrub(pendingScrubTimeRef.current);
        }
      });
    }
  }, [totalDuration, pps, performScrub]);

  useEffect(() => {
    handleScrubRef.current = handleScrub;
  }, [handleScrub]);

  const handleBackgroundMouseDown = (e) => {
    if (totalDuration === 0) return;
    safeBlurInspectorInput();
    isScrubbingRef.current = true;
    setIsScrubbing(true);
    handleScrub(e);
  };

  const handleAudioMouseDown = (e, seg, idx, mode = 'move') => {
    e.stopPropagation();
    if (e.button !== 0) return;
    safeBlurInspectorInput();
    const segRow = segmentRows[idx] ?? 0;
    const isLocked = Boolean(lockedTracks[`voice_${segRow}`] || (segRow === 0 && lockedTracks.voice));
    if (isLocked) return;

    const segKey = seg._uid || (seg.id !== undefined && seg.id !== null ? seg.id : idx);
    followSyncSkippedDueToEditingRef.current = false;
    selectedSegmentIdRef.current = segKey;
    lastSyncedInspectorIdRef.current = segKey;
    lastUserSelectTimeRef.current = Date.now();
    setLastSelectedType('audio');
    setSelectedAudioId(segKey);
    setSelectedSubId(segKey);
    if (onSelectSegment) onSelectSegment(segKey);
    if (onSelectClip) onSelectClip(null);

    const rawStart = (typeof seg.audioStartSec === 'number' && !isNaN(seg.audioStartSec))
      ? seg.audioStartSec 
      : (typeof seg.startSec === 'number' && !isNaN(seg.startSec) ? seg.startSec : 0);
    const rawEnd = (typeof seg.audioEndSec === 'number' && !isNaN(seg.audioEndSec))
      ? seg.audioEndSec 
      : (typeof seg.endSec === 'number' && !isNaN(seg.endSec) ? seg.endSec : rawStart + (seg.audioDurationSec || 2.5));

    if (mode === 'move' && onSeek) {
      onSeek(rawStart);
    }

    setDragState({
      mode,
      itemType: 'audio',
      index: idx,
      id: segKey,
      startX: e.clientX,
      startY: e.clientY,
      currentY: 0,
      origStart: rawStart,
      origEnd: rawEnd,
      currentStart: rawStart,
      currentEnd: rawEnd,
      hasMoved: false,
    });
  };

  const handleSubMouseDown = (e, seg, idx, mode = 'move') => {
    e.stopPropagation();
    if (e.button !== 0) return;
    safeBlurInspectorInput();
    const segRow = (typeof seg.subTrackRow === 'number' && seg.subTrackRow >= 0) ? seg.subTrackRow : 0;
    const isLocked = Boolean(lockedTracks[`subs_${segRow}`] || (segRow === 0 && lockedTracks.subs));
    if (isLocked) return;

    const subKey = seg._uid || (seg.id !== undefined && seg.id !== null ? seg.id : idx);
    followSyncSkippedDueToEditingRef.current = false;
    selectedSegmentIdRef.current = subKey;
    lastSyncedInspectorIdRef.current = subKey;
    lastUserSelectTimeRef.current = Date.now();
    setLastSelectedType('subtitle');
    const startSec = (typeof seg.startSec === 'number' && !isNaN(seg.startSec))
      ? seg.startSec
      : ((typeof seg.audioStartSec === 'number' && !isNaN(seg.audioStartSec))
        ? seg.audioStartSec
        : 0);
    const endSec = (typeof seg.endSec === 'number' && !isNaN(seg.endSec))
      ? seg.endSec
      : ((typeof seg.audioEndSec === 'number' && !isNaN(seg.audioEndSec))
        ? seg.audioEndSec
        : startSec + (seg.audioDurationSec || 3.0));

    setSelectedSubId(subKey);
    setSelectedAudioId(subKey);
    if (onSelectSegment) onSelectSegment(subKey);
    if (onSelectClip) onSelectClip(null);

    if (mode === 'move' && onSeek) {
      onSeek(startSec);
    }

    setDragState({
      mode,
      itemType: 'subtitle',
      index: idx,
      id: subKey,
      startX: e.clientX,
      startY: e.clientY,
      currentY: 0,
      origStart: startSec,
      origEnd: endSec,
      currentStart: startSec,
      currentEnd: endSec,
      hasMoved: false,
    });
  };

  const handleVideoMouseDown = (e, clip, idx, mode = 'move') => {
    e.stopPropagation();
    if (e.button !== 0) return;
    safeBlurInspectorInput();
    const clipRow = clip.trackRow ?? 0;
    const isLocked = Boolean(lockedTracks[`video_${clipRow}`] || (clipRow === 0 && lockedTracks.video));
    if (isLocked) return;

    followSyncSkippedDueToEditingRef.current = false;
    lastUserSelectTimeRef.current = Date.now();
    setLastSelectedType('video');
    if (onSelectClip) onSelectClip(clip.id);

    const targetSeg = scriptSegments?.find(s => s.id === clip.segmentId || s.id === clip.segmentIndex || (clip.segmentIndex && s.id === clip.segmentIndex));
    if (targetSeg) {
      const segKey = targetSeg._uid || targetSeg.id;
      selectedSegmentIdRef.current = segKey;
      lastSyncedInspectorIdRef.current = segKey;
      setSelectedAudioId(segKey);
      setSelectedSubId(segKey);
      if (onSelectSegment) onSelectSegment(segKey);
    } else {
      selectedSegmentIdRef.current = null;
      lastSyncedInspectorIdRef.current = null;
      setSelectedSubId(null);
      setSelectedAudioId(null);
      if (onSelectSegment) onSelectSegment(null);
    }

    if (mode === 'move' && onSeek && typeof clip.start === 'number') {
      onSeek(clip.start);
    }

    setDragState({
      mode,
      itemType: 'video',
      index: idx,
      id: clip.id,
      startX: e.clientX,
      startY: e.clientY,
      currentY: 0,
      origStart: clip.start,
      origEnd: clip.end,
      currentStart: clip.start,
      currentEnd: clip.end,
      hasMoved: false,
    });
  };

  useEffect(() => {
    let mouseRafId = null;
    let pendingMouseE = null;

    const processMouseMove = (e) => {
      if (!dragState) return;
        const moveDistX = Math.abs(e.clientX - dragState.startX);
        const moveDistY = Math.abs(e.clientY - (dragState.startY !== undefined ? dragState.startY : e.clientY));
        if (!dragState.hasMoved && moveDistX < 4 && moveDistY < 4) return;

        const deltaSec = (e.clientX - dragState.startX) / pps;
        const deltaY = e.clientY - (dragState.startY !== undefined ? dragState.startY : e.clientY);

        if (dragState.mode === 'move') {
          let newStart = Math.max(0, dragState.origStart + deltaSec);
          const clipDur = dragState.origEnd - dragState.origStart;
          let newEnd = newStart + clipDur;
          let currentSnapTime = null;

          if (snappingEnabled && !e.shiftKey) {
            // CapCut Precision Snapping: subtle 8px window (~0.1s), NOT a violent 0.6s jump!
            const snapThreshold = Math.min(0.2, Math.max(0.06, 8 / pps));
            const currentLiveTime = currentTimeRef.current || 0;
            if (newStart < snapThreshold || Math.abs(newStart) < snapThreshold) {
              newStart = 0;
              newEnd = clipDur;
              currentSnapTime = 0;
            } else if (Math.abs(newStart - currentLiveTime) < snapThreshold) {
              newStart = currentLiveTime;
              newEnd = newStart + clipDur;
              currentSnapTime = currentLiveTime;
            } else if (Math.abs(newEnd - currentLiveTime) < snapThreshold) {
              newEnd = currentLiveTime;
              newStart = Math.max(0, newEnd - clipDur);
              currentSnapTime = currentLiveTime;
            }
            if (dragState.itemType === 'video' && videoClips) {
              for (const other of videoClips) {
                if (other.id !== dragState.id) {
                  if (Math.abs(newStart - other.end) < snapThreshold) {
                    newStart = other.end;
                    newEnd = newStart + clipDur;
                    currentSnapTime = other.end;
                    break;
                  } else if (Math.abs(newEnd - other.start) < snapThreshold) {
                    newEnd = other.start;
                    newStart = Math.max(0, newEnd - clipDur);
                    currentSnapTime = other.start;
                    break;
                  }
                }
              }
            }
          }

          setSnapLineTime(currentSnapTime);
          setDragState(prev => prev ? ({ 
            ...prev, 
            hasMoved: true, 
            currentStart: newStart, 
            currentEnd: newEnd,
            currentY: deltaY,
          }) : null);

          // Highlight target lane while dragging vertically (Strict lane type isolation)
          const elements = typeof document.elementsFromPoint === 'function'
            ? document.elementsFromPoint(e.clientX, e.clientY)
            : [document.elementFromPoint(e.clientX, e.clientY)].filter(Boolean);

          let targetLane = null;
          for (const el of elements) {
            const lane = el?.closest?.('.track-lane');
            if (lane) {
              const laneType = lane.dataset?.trackType; // 'video' | 'voice' | 'subs'
              if (dragState.itemType === 'subtitle' && laneType === 'subs') {
                targetLane = lane;
                break;
              } else if (dragState.itemType === 'audio' && laneType === 'voice') {
                targetLane = lane;
                break;
              } else if (dragState.itemType === 'video' && laneType === 'video') {
                targetLane = lane;
                break;
              }
            }
          }

          if (targetLane && targetLane.dataset?.trackKey) {
            setDragOverTrack(targetLane.dataset.trackKey);
          } else if (deltaY > 20 && dragState.itemType === 'video') {
            const cur = videoClips?.find(c => c.id === dragState.id);
            const curRow = cur?.trackRow || 0;
            const rowShift = Math.max(1, Math.round(deltaY / 52));
            setDragOverTrack(`video_${curRow + rowShift}`);
          } else if (deltaY > 20 && dragState.itemType === 'audio') {
            const curSeg = scriptSegments?.[dragState.index];
            const curRow = segmentRows[dragState.index] ?? (curSeg?.trackRow || 0);
            const rowShift = Math.max(1, Math.round(deltaY / 44));
            setDragOverTrack(`voice_${curRow + rowShift}`);
          } else if (deltaY > 20 && dragState.itemType === 'subtitle') {
            const curSeg = scriptSegments?.[dragState.index];
            const curRow = (typeof curSeg?.subTrackRow === 'number' && curSeg.subTrackRow >= 0) ? curSeg.subTrackRow : 0;
            const rowShift = Math.max(1, Math.round(deltaY / 42));
            setDragOverTrack(`subs_${curRow + rowShift}`);
          } else {
            setDragOverTrack(null);
          }
        } else if (dragState.mode === 'trim-left') {
          const newStart = Math.min(dragState.origEnd - 0.4, Math.max(0, dragState.origStart + deltaSec));
          setDragState(prev => prev ? ({ ...prev, hasMoved: true, currentStart: newStart }) : null);
        } else if (dragState.mode === 'trim-right') {
          const newEnd = Math.max(dragState.origStart + 0.4, dragState.origEnd + deltaSec);
          setDragState(prev => prev ? ({ ...prev, hasMoved: true, currentEnd: newEnd }) : null);
        }
    };

    const handleMouseMove = (e) => {
      if (dragState) {
        pendingMouseE = e;
        if (!mouseRafId) {
          mouseRafId = requestAnimationFrame(() => {
            mouseRafId = null;
            if (pendingMouseE) {
              processMouseMove(pendingMouseE);
            }
          });
        }
      } else if (isScrubbing) {
        if (handleScrubRef.current) {
          handleScrubRef.current(e);
        } else {
          handleScrub(e);
        }
      }
    };

    const handleMouseUp = (e) => {
      setSnapLineTime(null);
      setDragOverTrack(null);
      if (isNativeDraggingRef.current) {
        isNativeDraggingRef.current = false;
        setDragState(null);
        return;
      }

      if (dragState) {
        if (!dragState.hasMoved) {
          // If simple click on an audio or subtitle segment, jump the playhead line | to the start of this segment
          if ((dragState.itemType === 'audio' || dragState.itemType === 'subtitle') && onSeek && typeof dragState.origStart === 'number') {
            onSeek(dragState.origStart);
          }
          setDragState(null);
          return;
        }

        // Support vertical track row drop for audio/subtitles/video via pointer coordinates
        let targetRow = null;
        let targetType = null;
        if (e && typeof e.clientX === 'number') {
          const elements = typeof document.elementsFromPoint === 'function'
            ? document.elementsFromPoint(e.clientX, e.clientY)
            : [document.elementFromPoint(e.clientX, e.clientY)].filter(Boolean);

          let targetLane = null;
          for (const el of elements) {
            const lane = el?.closest?.('.track-lane');
            if (lane) {
              const laneType = lane.dataset?.trackType;
              if (dragState.itemType === 'subtitle' && laneType === 'subs') {
                targetLane = lane;
                break;
              } else if (dragState.itemType === 'audio' && laneType === 'voice') {
                targetLane = lane;
                break;
              } else if (dragState.itemType === 'video' && laneType === 'video') {
                targetLane = lane;
                break;
              }
            }
          }

          if (targetLane && targetLane.dataset) {
            targetType = targetLane.dataset.trackType;
            const parsedRow = parseInt(targetLane.dataset.trackRow, 10);
            if (!isNaN(parsedRow) && parsedRow >= 0) {
              targetRow = parsedRow;
            }
          }
        }

        const liveDeltaY = (typeof e?.clientY === 'number' && typeof dragState.startY === 'number')
          ? (e.clientY - dragState.startY)
          : (dragState.currentY || 0);

        if ((dragState.itemType === 'audio' || dragState.itemType === 'subtitle') && onUpdateSegments && scriptSegments) {
          const updated = [...scriptSegments];
          const segIdx = updated.findIndex((s, i) => 
            (s._uid && dragState.id && String(s._uid) === String(dragState.id)) ||
            (s.id !== undefined && s.id !== null && dragState.id !== undefined && dragState.id !== null && String(s.id) === String(dragState.id)) ||
            i === dragState.index
          );
          const seg = segIdx >= 0 ? updated[segIdx] : null;
          if (seg) {
            let newStart = Math.max(0, parseFloat(dragState.currentStart.toFixed(2)));
            let newEnd = Math.max(newStart + 0.3, parseFloat(dragState.currentEnd.toFixed(2)));
            
            if (dragState.mode === 'move') {
              const dur = Math.max(0.4, dragState.origEnd - dragState.origStart);
              newStart = Math.max(0, parseFloat(dragState.currentStart.toFixed(2)));
              newEnd = parseFloat((newStart + dur).toFixed(2));
            }

            const isSubDrag = dragState.itemType === 'subtitle';
            const updatedSeg = {
              ...seg,
              start: formatMinSec(newStart),
              end: formatMinSec(newEnd),
              startSec: newStart,
              endSec: newEnd,
              audioStart: formatMinSec(newStart),
              audioEnd: formatMinSec(newEnd),
              audioStartSec: newStart,
              audioEndSec: newEnd,
              userShifted: true,
            };

            const curSegRow = segmentRows[segIdx] ?? (seg.trackRow || 0);
            let finalTargetRow = curSegRow;

            if (dragState.itemType === 'audio') {
              if (targetType === 'voice' && targetRow !== null) {
                finalTargetRow = targetRow;
              } else if (liveDeltaY < -20 && curSegRow > 0) {
                // Dragged up
                const rowShift = Math.min(-1, Math.round(liveDeltaY / 44));
                finalTargetRow = Math.max(0, curSegRow + rowShift);
              } else if (liveDeltaY > 20) {
                // Dragged down
                const rowShift = Math.max(1, Math.round(liveDeltaY / 44));
                finalTargetRow = curSegRow + rowShift;
              }

              updatedSeg.trackRow = finalTargetRow;
              if (finalTargetRow >= userVoiceTrackCount) {
                setUserVoiceTrackCount(finalTargetRow + 1);
              }
            } else if (dragState.itemType === 'subtitle') {
              const curSubRow = (typeof seg.subTrackRow === 'number' && seg.subTrackRow >= 0) ? seg.subTrackRow : 0;
              let finalSubTargetRow = curSubRow;
              if (targetType === 'subs' && targetRow !== null) {
                finalSubTargetRow = targetRow;
              } else if (liveDeltaY < -20 && curSubRow > 0) {
                // Dragged up
                const rowShift = Math.min(-1, Math.round(liveDeltaY / 42));
                finalSubTargetRow = Math.max(0, curSubRow + rowShift);
              } else if (liveDeltaY > 20) {
                // Dragged down
                const rowShift = Math.max(1, Math.round(liveDeltaY / 42));
                finalSubTargetRow = curSubRow + rowShift;
              }

              updatedSeg.subTrackRow = finalSubTargetRow;
              updatedSeg.userSubShifted = true;
              if (finalSubTargetRow >= userSubTrackCount) {
                setUserSubTrackCount(finalSubTargetRow + 1);
              }
            }

            updated[segIdx] = updatedSeg;
            onUpdateSegments(updated, false, true);
            if (onSeek && typeof newStart === 'number') {
              onSeek(newStart);
            }
          }
        } else if (dragState.itemType === 'video' && onUpdateClips && videoClips) {
          const clip = videoClips.find(c => c.id === dragState.id) || videoClips[dragState.index];
          if (clip) {
            let nextClips = null;
            if (dragState.mode === 'trim-left') {
              nextClips = trimClip(videoClips, clip.id, 'left', dragState.currentStart, totalDuration);
            } else if (dragState.mode === 'trim-right') {
              nextClips = trimClip(videoClips, clip.id, 'right', dragState.currentEnd, totalDuration);
            } else if (dragState.mode === 'move') {
              const dur = Math.max(0.4, (clip.end || 0) - (clip.start || 0));
              let newStart = Math.max(0, parseFloat(dragState.currentStart.toFixed(2)));
              // CapCut magnetic snap: if moved within subtle threshold of start, snap to 00:00!
              if (snappingEnabled && newStart < 0.1) {
                newStart = 0;
              }
              const newEnd = parseFloat((newStart + dur).toFixed(2));

              // Determine vertical track row (CapCut multi-row video support)
              const liveDeltaY = (typeof e?.clientY === 'number' && typeof dragState.startY === 'number')
                ? (e.clientY - dragState.startY)
                : (dragState.currentY || 0);

              const currentClipRow = typeof clip.trackRow === 'number' ? clip.trackRow : 0;
              let targetVideoRow = currentClipRow;

              if (targetType === 'video' && targetRow !== null && targetRow !== currentClipRow) {
                targetVideoRow = targetRow;
              } else if (liveDeltaY > 20) {
                // Dragged down past row -> move to row below
                const rowShift = Math.max(1, Math.round(liveDeltaY / 52));
                targetVideoRow = currentClipRow + rowShift;
              } else if (liveDeltaY < -20 && currentClipRow > 0) {
                // Dragged up past row -> move to row above
                const rowShift = Math.min(-1, Math.round(liveDeltaY / 52));
                targetVideoRow = Math.max(0, currentClipRow + rowShift);
              } else if (targetType === 'video' && targetRow !== null) {
                targetVideoRow = targetRow;
              }

              if (targetVideoRow >= userVideoTrackCount) {
                setUserVideoTrackCount(targetVideoRow + 1);
              }

              nextClips = videoClips.map((c) => c.id === clip.id ? {
                ...c,
                start: newStart,
                end: newEnd,
                trackId: `video-${targetVideoRow + 1}`,
                trackRow: targetVideoRow,
              } : c);

              // Synchronize associated dialogue segments (voice & subtitles) with the moved video clip
              let updatedSegs = null;
              if (scriptSegments && scriptSegments.length > 0) {
                const synced = syncSegmentsWithMovedClip(clip, newStart, scriptSegments);
                if (synced !== scriptSegments) {
                  updatedSegs = synced;
                }
              }

              onUpdateClips(nextClips, updatedSegs);
              nextClips = null; // already dispatched
            }
            if (nextClips) {
              onUpdateClips(nextClips);
            }
          }
        }
        setDragState(null);
      }

      if (isScrubbing) {
        isScrubbingRef.current = false;
        setIsScrubbing(false);
        if (scrubRafRef.current) {
          cancelAnimationFrame(scrubRafRef.current);
          scrubRafRef.current = null;
        }

        // Hybrid Scrub-End Auto-select:
        // When user stops scrubbing, commit final seek to Player and resolve matching segment
        const finalTime = pendingScrubTimeRef.current !== null && Number.isFinite(pendingScrubTimeRef.current)
          ? pendingScrubTimeRef.current
          : currentTime;

        // Ensure final pointer seek is committed synchronously to Player
        performScrub(finalTime);

        const isEditingText = isEditingInspectorText();

        if (!isEditingText) {
          const matchedSeg = resolveSegmentAtTime(scriptSegments, finalTime);
          if (matchedSeg) {
            const segKey = matchedSeg._uid || (matchedSeg.id !== undefined && matchedSeg.id !== null ? matchedSeg.id : scriptSegments.indexOf(matchedSeg));
            selectedSegmentIdRef.current = segKey;
            lastPlayheadSegKeyRef.current = segKey;
            setSelectedAudioId(segKey);
            setSelectedSubId(segKey);
            if (String(lastSyncedInspectorIdRef.current) !== String(segKey)) {
              lastSyncedInspectorIdRef.current = segKey;
              if (onSelectSegment) onSelectSegment(segKey);
            }
          } else {
            // Gap: No dialogue segment at final playhead time
            selectedSegmentIdRef.current = null;
            lastPlayheadSegKeyRef.current = null;
            setSelectedAudioId(null);
            setSelectedSubId(null);
            if (lastSyncedInspectorIdRef.current !== null) {
              lastSyncedInspectorIdRef.current = null;
              if (onSelectSegment) onSelectSegment(null);
            }
          }
        }

        // Reset pending scrub time to null after completion
        pendingScrubTimeRef.current = null;
      }
    };

    if (dragState || isScrubbing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      if (mouseRafId) cancelAnimationFrame(mouseRafId);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      if (scrubRafRef.current) {
        cancelAnimationFrame(scrubRafRef.current);
        scrubRafRef.current = null;
      }
    };
  }, [dragState, isScrubbing, pps, scriptSegments, videoClips, onUpdateSegments, onUpdateClips, totalDuration, snappingEnabled, onSelectSegment, currentTime]);

  const selectedSegKey = selectedSubId !== null && selectedSubId !== undefined
    ? selectedSubId
    : (selectedAudioId !== null && selectedAudioId !== undefined
      ? selectedAudioId
      : (selectedSegmentId !== null && selectedSegmentId !== undefined ? selectedSegmentId : null));

  const canDeleteSubtitle = selectedSegKey !== null && selectedSegKey !== undefined && scriptSegments && scriptSegments.length > 0;
  const canDeleteVideo = Boolean(activeClipId && videoClips && videoClips.length > 0);
  const canDelete = Boolean(canDeleteSubtitle || canDeleteVideo);

  const handleDeleteSelected = useCallback(() => {
    // 1. If user clicked/selected a Video Clip, delete the Video Clip!
    if (lastSelectedType === 'video' && canDeleteVideo && onDeleteClip) {
      onDeleteClip(activeClipId);
      if (onSelectClip) onSelectClip(null);
      setLastSelectedType('none');
      return;
    }

    // 2. If user clicked an audio/subtitle segment (or video cannot be deleted), delete the segment!
    if (canDeleteSubtitle) {
      if (onDeleteSegment) {
        onDeleteSegment(selectedSegKey);
      } else {
        const updated = deleteSegmentByIdOrIndex(scriptSegments, selectedSegKey);
        if (onUpdateSegments) {
          onUpdateSegments(updated, false, true);
        }
      }
      setSelectedSubId(null);
      setSelectedAudioId(null);
      selectedSegmentIdRef.current = null;
      lastSyncedInspectorIdRef.current = null;
      if (onSelectSegment) {
        onSelectSegment(null);
      }
      setLastSelectedType('none');
      return;
    }

    // 3. Fallback: If only video clip was active
    if (canDeleteVideo && onDeleteClip) {
      onDeleteClip(activeClipId);
      if (onSelectClip) onSelectClip(null);
      setLastSelectedType('none');
    }
  }, [lastSelectedType, canDeleteSubtitle, canDeleteVideo, selectedSegKey, scriptSegments, onDeleteSegment, onUpdateSegments, onSelectSegment, onDeleteClip, onSelectClip, activeClipId]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;

      if (e.code === 'Space') {
        e.preventDefault();
        onPlayPause();
      } else if (e.code === 'KeyB' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        const activeSplitTarget = lastSelectedType === 'video'
          ? (activeClipId || selectedSegKey)
          : (selectedSegKey || activeClipId);
        if (onSplitClip) onSplitClip(currentTime, activeSplitTarget);
      } else if ((e.code === 'KeyZ' && (e.ctrlKey || e.metaKey)) && !e.shiftKey) {
        e.preventDefault();
        if (onUndo && canUndo) onUndo();
      } else if (((e.code === 'KeyZ' && (e.ctrlKey || e.metaKey) && e.shiftKey) || (e.code === 'KeyY' && (e.ctrlKey || e.metaKey)))) {
        e.preventDefault();
        if (onRedo && canRedo) onRedo();
      } else if (e.code === 'Delete' || e.code === 'Backspace') {
        if (canDelete) {
          e.preventDefault();
          handleDeleteSelected();
        }
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        onSeek(Math.max(0, currentTime - 1));
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        onSeek(Math.min(totalDuration, currentTime + 1));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onPlayPause, onSplitClip, onSeek, onUndo, onRedo, canUndo, canRedo, currentTime, totalDuration, canDelete, handleDeleteSelected]);

  // 1. Pure 60FPS Hardware GPU Playhead Animation & 1:1 In-Sync Smooth Center Scroll
  useEffect(() => {
    if (!isPlaying) return;

    let animId;
    let lastVideoTime = videoRef?.current?.currentTime || 0;
    let lastPerfTime = performance.now();

    const updatePlayheadAndScroll = () => {
      const v = videoRef?.current;
      if (v && playheadRef.current) {
        const nowPerf = performance.now();
        const srcNow = v.currentTime;

        // Re-anchor interpolation whenever video decoder advances to new frame
        if (Math.abs(srcNow - lastVideoTime) > 0.001) {
          lastVideoTime = srcNow;
          lastPerfTime = nowPerf;
        }

        // Sub-frame interpolation between 24/30fps decoder ticks for buttery-smooth 60fps playhead motion
        const elapsedSinceAnchor = ((nowPerf - lastPerfTime) / 1000) * (v.playbackRate || 1);
        const smoothSrcTime = v.paused ? srcNow : Math.min(srcNow + 0.08, lastVideoTime + Math.max(0, elapsedSinceAnchor));

        const currentPps = ppsRef.current || pps || 45;
        const currentClips = videoClipsRef.current || videoClips || [];
        let tlTime = smoothSrcTime;
        if (currentClips && currentClips.length > 0) {
          const c = currentClips.find((clip) => {
            const sStart = Number.isFinite(clip.sourceStart) ? clip.sourceStart : (clip.start || 0);
            const sEnd = Number.isFinite(clip.sourceEnd) ? clip.sourceEnd : (clip.end || (v.duration || 0));
            return smoothSrcTime >= (sStart - 0.05) && smoothSrcTime <= (sEnd + 0.05);
          });
          if (c) {
            const sStart = Number.isFinite(c.sourceStart) ? c.sourceStart : (c.start || 0);
            const cStart = Number.isFinite(c.start) ? c.start : 0;
            tlTime = cStart + Math.max(0, smoothSrcTime - sStart);
          }
        }

        const currentX = tlTime * currentPps;

        // Direct hardware GPU transform: silky-smooth 60 FPS without React re-render lag!
        playheadRef.current.style.transform = `translate3d(${currentX}px, 0, 0)`;

        if (playheadTimeTextRef.current) {
          playheadTimeTextRef.current.textContent = formatMinSec(tlTime);
        }

        // Smart Professional Auto-Follow Viewport Bounds (CapCut/Premiere Style)
        // Eliminates 60fps forced layout thrashing: only scrolls when playhead nears viewport edge!
        if (autoCenter && timelineBodyRef.current && !isScrubbing && !dragState) {
          const container = timelineBodyRef.current;
          const clientWidth = container.clientWidth;
          if (clientWidth > 0) {
            const screenX = (currentX + TRACK_HEADER_WIDTH) - container.scrollLeft;
            // Only scroll when playhead reaches near the right edge (85% width) or jumps off left edge
            const rightThreshold = clientWidth - 120;
            const leftThreshold = TRACK_HEADER_WIDTH + 20;

            if (screenX > rightThreshold) {
              // Smooth page-forward: brings playhead back to comfortable left 30% position
              const targetScroll = Math.round(Math.max(0, (currentX + TRACK_HEADER_WIDTH) - (clientWidth * 0.30)));
              container.scrollTo({ left: targetScroll, behavior: 'smooth' });
            } else if (screenX < leftThreshold) {
              const targetScroll = Math.round(Math.max(0, (currentX + TRACK_HEADER_WIDTH) - (clientWidth * 0.30)));
              container.scrollLeft = targetScroll;
            }
          }
        }
      }
      animId = requestAnimationFrame(updatePlayheadAndScroll);
    };

    animId = requestAnimationFrame(updatePlayheadAndScroll);
    return () => cancelAnimationFrame(animId);
  }, [isPlaying, autoCenter, pps, isScrubbing, dragState]);

  // Synchronize playhead position via GPU transform when paused or seeking (zero React style conflict)
  useEffect(() => {
    if (isPlaying) return;
    if (playheadRef.current) {
      const currentX = currentTime * pps;
      playheadRef.current.style.transform = `translate3d(${currentX}px, 0, 0)`;
    }
    if (playheadTimeTextRef.current) {
      playheadTimeTextRef.current.textContent = formatMinSec(currentTime);
    }
  }, [currentTime, pps, isPlaying]);

  // 2. When seeking while paused: if the playhead jumps off-screen, smoothly center it
  useEffect(() => {
    if (isPlaying || !autoCenter || !timelineBodyRef.current || isScrubbing || dragState) return;

    const container = timelineBodyRef.current;
    const clientWidth = container.clientWidth;
    if (clientWidth <= 0) return;

    const currentScreenX = TRACK_HEADER_WIDTH + (currentTime * pps) - container.scrollLeft;
    const isOutOfView = currentScreenX < TRACK_HEADER_WIDTH + 30 || currentScreenX > clientWidth - 40;

    if (isOutOfView) {
      const targetScroll = Math.max(0, (currentTime * pps + TRACK_HEADER_WIDTH) - (clientWidth / 2));
      container.scrollLeft = targetScroll;
    }
  }, [currentTime, isPlaying, autoCenter, pps, isScrubbing, dragState]);

  // Ruler tick step calculation to guarantee labels spaced at least ~100px apart
  const { majorStepSec, minorStepSec } = React.useMemo(() => {
    const minSecFor100px = 100 / Math.max(1, pps);
    if (minSecFor100px <= 1) {
      return { majorStepSec: 1, minorStepSec: 0.5 };
    }
    if (minSecFor100px <= 2) {
      return { majorStepSec: 2, minorStepSec: 1 };
    }
    if (minSecFor100px <= 5) {
      return { majorStepSec: 5, minorStepSec: 1 };
    }
    if (minSecFor100px <= 10) {
      return { majorStepSec: 10, minorStepSec: 2 };
    }
    return { majorStepSec: 30, minorStepSec: 5 };
  }, [pps]);

  const markers = React.useMemo(() => {
    // Standard CapCut timeline: if empty, display clean 60s default ruler timeline
    const effectiveDur = totalDuration > 0 ? totalDuration : 60;
    const maxMarkerSec = Math.ceil(effectiveDur) + Math.ceil(1000 / pps);
    const arr = [];
    const step = minorStepSec;
    for (let s = 0; s <= maxMarkerSec; s += step) {
      const rounded = parseFloat(s.toFixed(2));
      const isMajor = Math.abs(rounded % majorStepSec) < 0.001;
      arr.push({ time: rounded, isMajor });
    }
    return arr;
  }, [totalDuration, pps, majorStepSec, minorStepSec]);

  const playheadX = currentTime * pps;

  return (
    <div className="capcut-timeline-container">
      {/* 1. Divider Toolbar */}
      <TimelineToolbar
        selectedVideo={selectedVideo}
        onResetFullVideo={onResetFullVideo}
        canUndo={canUndo}
        onUndo={onUndo}
        canRedo={canRedo}
        onRedo={onRedo}
        onSplitClip={(time) => {
          const activeSplitTarget = lastSelectedType === 'video'
            ? (activeClipId || selectedSegKey)
            : (selectedSegKey || activeClipId);
          if (onSplitClip) onSplitClip(time, activeSplitTarget);
        }}
        currentTime={currentTime}
        handleDeleteSelected={handleDeleteSelected}
        canDelete={canDelete}
        canDeleteSubtitle={canDeleteSubtitle}
        canDeleteVideo={canDeleteVideo}
        onAutoSplitVideo={onAutoSplitVideo}
        videoClips={videoClips}
        onToggleMuteAllCuts={onToggleMuteAllCuts}
        scriptSegments={scriptSegments}
        onBridgeGaps={onBridgeGaps}
        onAutoAlignNoOverlap={onAutoAlignNoOverlap}
        onResetToSourceTiming={onResetToSourceTiming}
        onAddSegment={onAddSegment}
        snappingEnabled={snappingEnabled}
        setSnappingEnabled={setSnappingEnabled}
        showSubtitlesTrack={showSubtitlesTrack}
        setShowSubtitlesTrack={setShowSubtitlesTrack}
        voiceSettings={voiceSettings}
        onUpdateVoiceSettings={onUpdateVoiceSettings}
        zoom={zoom}
        setZoom={setZoom}
        autoCenter={autoCenter}
        setAutoCenter={setAutoCenter}
        handleCenterPlayhead={handleCenterPlayhead}
        voiceRowCount={voiceRowCount}
        subRowCount={subRowCount}
      />

      {/* 2. Scrollable Multi-Track Area */}
      <div 
        className="timeline-scroll-area" 
        ref={timelineBodyRef}
        onMouseDown={handleBackgroundMouseDown}
      >
        <TimelineTrackHeaders
          lockedTracks={lockedTracks}
          setLockedTracks={setLockedTracks}
          hiddenTracks={hiddenTracks}
          setHiddenTracks={setHiddenTracks}
          mutedTracks={mutedTracks}
          setMutedTracks={setMutedTracks}
          audioGenerated={audioGenerated}
          videoRowCount={videoRowCount}
          voiceRowCount={voiceRowCount}
          subRowCount={subRowCount}
          showSubtitles={showSubtitles}
          selectedVideo={selectedVideo}
          scriptSegments={scriptSegments}
        />

        <TimelineTracksCanvas
          scrollContainerRef={timelineBodyRef}
          totalWidth={totalWidth}
          pps={pps}
          markers={markers}
          snapLineTime={snapLineTime}
          selectedVideo={selectedVideo}
          totalDuration={totalDuration}
          playheadX={playheadX}
          currentTime={currentTime}
          isPlaying={isPlaying}
          playheadRef={playheadRef}
          playheadTimeTextRef={playheadTimeTextRef}
          setIsScrubbing={setIsScrubbing}
          handleScrub={handleScrub}
          videoClips={videoClips}
          hiddenTracks={hiddenTracks}
          dragState={dragState}
          activeClipId={activeClipId}
          handleVideoMouseDown={handleVideoMouseDown}
          onSelectClip={onSelectClip}
          videoThumbnails={videoThumbnails}
          audioGenerated={audioGenerated}
          showSubtitles={showSubtitles}
          scriptSegments={scriptSegments}
          selectedSegmentId={selectedSegmentId}
          selectedAudioId={selectedAudioId}
          setSelectedAudioId={setSelectedAudioId}
          onSelectSegment={onSelectSegment}
          onSeek={onSeek}
          speakerRegistry={speakerRegistry}
          voiceSettings={voiceSettings}
          onToggleMuteSegment={onToggleMuteSegment}
          onToggleMuteVideoClip={onToggleMuteVideoClip}
          handleAudioMouseDown={handleAudioMouseDown}
          selectedSubId={selectedSubId}
          setSelectedSubId={setSelectedSubId}
          handleSubMouseDown={handleSubMouseDown}
          videoRowCount={videoRowCount}
          voiceRowCount={voiceRowCount}
          subRowCount={subRowCount}
          segmentRows={segmentRows}
          handleMoveVideoToTrack={handleMoveVideoToTrack}
          dragOverTrack={dragOverTrack}
          setDragOverTrack={setDragOverTrack}
          onNativeDragStart={() => {
            isNativeDraggingRef.current = true;
            setDragState(null);
          }}
          onNativeDragEnd={() => {
            isNativeDraggingRef.current = false;
            window.__activeDraggedTimelineItem = null;
            setDragState(null);
          }}
          onImportClick={onImportClick}
          onVideoSelected={onVideoSelected}
          seriesId={seriesId}
          episodeId={episodeId}
        />
      </div>
    </div>
  );
}

export default React.memo(TimelineEditor);
