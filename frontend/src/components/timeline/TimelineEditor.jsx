import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { formatMinSec, getSegmentAudioDuration, parseTimeToSeconds } from '../../utils/timestampUtils';
import {
  getPixelsPerSecond,
  syncSegmentsWithMovedClip,
  findSegmentIndex,
  resolveSegmentAtTime,
  computeTimelineScrollForTime,
  isSegmentMatch,
  isVoiceDropTargetAllowed,
  clampVoiceDragY,
  resolveVoiceDropRow,
  computeVoiceDragPosition,
  resolveVoiceDragScrubTime,
  doesClipMatchSegment,
} from '../../utils/timelineUtils';
import {
  buildEpisodeViewKey,
  loadEpisodeTimelineViewState,
  saveEpisodeTimelineViewState,
  computeAnchoredZoomScrollLeft,
  computeScrollToRevealPlayhead,
} from '../../utils/timelineViewState';
import {
  deleteSegment as deleteSegmentOp,
  deleteVideoClip as deleteVideoClipOp,
  deleteGap as deleteGapOp,
  trimClip as trimClipOp,
  moveClip as moveClipOp,
  isGapClip,
} from '../../utils/timelineOps';

import TimelineToolbar from './TimelineToolbar';
import TimelineTrackHeaders from './TimelineTrackHeaders';
import TimelineTracksCanvas from './TimelineTracksCanvas';
import './TimelineEditor.css';

const TRACK_HEADER_WIDTH = 148;

function TimelineEditor({
  playingProxy = false,
  videoRef = null,
  currentTime = 0,
  playheadTimeRef = null,
  subscribePlayhead = null,
  duration = 0,
  isPlaying = false,
  onSeek,
  onPlayPause,
  videoClips = [],
  activeClipId = null,
  onSelectClip,
  onUpdateClips,
  onSplitClip,
  onInsertVideoAd = null,
  onDeleteClip,
  onDeleteSegment = null,
  scriptSegments = [],
  framingKeyframes = [],
  onUpdateSegments,
  voiceSettings = {},
  onUpdateVoiceSettings,
  audioGenerated = false,
  selectedVideo = null,
  videoThumbnails = [],
  selectedSegmentId = null,
  onSelectSegment = null,
  selectedClipKind = null,
  onSelectClipKind = null,
  timelineFocusRequest = null,
  onAutoSplitVideo = null,
  onResetFullVideo = null,
  onBridgeGaps = null,
  onAutoAlignNoOverlap = null,
  onAddSegment = null,
  onToggleMuteSegment = null,
  onToggleMuteVideoClip = null,
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
  bgmAudioUrl = null,
  isDemucsDone = false,
}) {
  const [zoom, setZoom] = useState(() => {
    const saved = loadEpisodeTimelineViewState(seriesId, episodeId);
    return saved ? saved.zoom : 1;
  });
  const [selectedSubId, setSelectedSubId] = useState(null);
  const [selectedAudioId, setSelectedAudioId] = useState(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [dragState, setDragState] = useState(null);
  const [snappingEnabled, setSnappingEnabled] = useState(true);
  const [snapLineTime, setSnapLineTime] = useState(null);
  const [lockedTracks, setLockedTracks] = useState({ video: false, voice: false, subs: false, cleanBgm: false });
  const [hiddenTracks, setHiddenTracks] = useState({ video: false, voice: false, subs: false, cleanBgm: false });
  const [mutedTracks, setMutedTracks] = useState({ video: false, voice: false, subs: false, cleanBgm: false });
  const [soloTracks, setSoloTracks] = useState({ video: false, voice: false, subs: false, cleanBgm: false });
  // Persistent toggle for Auto-Center playhead (Default: ON / true - remembered in localStorage)
  const [autoCenter, setAutoCenter] = useState(() => {
    try {
      const saved = localStorage.getItem('TIMELINE_AUTO_CENTER');
      if (saved !== null) {
        return saved === 'true';
      }
    } catch (_) {}
    return true; // Default state: ON
  });

  useEffect(() => {
    try {
      localStorage.setItem('TIMELINE_AUTO_CENTER', String(autoCenter));
    } catch (_) {}
  }, [autoCenter]);

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

  // Dynamic Multi-Track Layer Allocation (Smart VOICE 1 Male / VOICE 2 Female & Stagger Routing)
  const { segmentRows, calculatedVoiceRows, highestUsedVoiceRow = 0, calculatedSubRows } = React.useMemo(() => {
    if (!scriptSegments || scriptSegments.length === 0) {
      return { segmentRows: [], calculatedVoiceRows: 1, highestUsedVoiceRow: 0, calculatedSubRows: 1 };
    }

    const rowEndTimes = {};

    const rows = scriptSegments.map((seg, idx) => {
      const rawStart = (typeof seg.audioStartSec === 'number' && !isNaN(seg.audioStartSec))
        ? seg.audioStartSec 
        : (typeof seg.startSec === 'number' && !isNaN(seg.startSec) ? seg.startSec : idx * 4);
      const isTrimmed = Boolean(seg.audioTrimmed || seg.userTrimmed);
      const slotStart = (typeof seg.startSec === 'number' && !isNaN(seg.startSec)) ? seg.startSec : rawStart;
      const slotEnd = (typeof seg.endSec === 'number' && !isNaN(seg.endSec)) ? seg.endSec : slotStart + 3.0;
      const slotSpan = (typeof seg.audioEndSec === 'number' && !isNaN(seg.audioEndSec) && seg.audioEndSec > rawStart)
        ? (seg.audioEndSec - rawStart)
        : (slotEnd > slotStart ? (slotEnd - slotStart) : 2.5);
      const audioDur = getSegmentAudioDuration(
        seg,
        (typeof seg.audioDurationSec === 'number' && seg.audioDurationSec > 0) ? seg.audioDurationSec : slotSpan
      );
      const rawEnd = (isTrimmed && typeof seg.audioEndSec === 'number' && !isNaN(seg.audioEndSec))
        ? seg.audioEndSec 
        : (rawStart + audioDur);

      // CapCut single-lane style: all auto-placed voice clips live sequentially on VOICE 1 (Lane 0).
      // Only userShifted clips keep their stored trackRow, and genuinely colliding overflow clips
      // automatically stagger onto the first free sub-lane so no clip is ever buried/hidden behind another.
      if (typeof seg.trackRow === 'number' && (seg.userShifted || seg.trackRow > 0)) {
        const userR = Math.max(0, seg.trackRow);
        rowEndTimes[userR] = Math.max(rowEndTimes[userR] || 0, rawEnd);
        return userR;
      }

      let targetLane = 0;
      while (rowEndTimes[targetLane] !== undefined && rawStart < rowEndTimes[targetLane] - 0.08 && targetLane < 3) {
        targetLane++;
      }
      rowEndTimes[targetLane] = Math.max(rowEndTimes[targetLane] || 0, rawEnd);
      return targetLane;
    });

    const maxSegmentTrackRow = (scriptSegments || []).reduce((max, s) => {
      const r = (typeof s.trackRow === 'number' && s.trackRow >= 0) ? s.trackRow : 0;
      return Math.max(max, r);
    }, 0);
    const maxCalculatedRow = rows.reduce((max, r) => Math.max(max, r), 0);
    const highestUsedVoiceRow = Math.max(maxSegmentTrackRow, maxCalculatedRow);

    return {
      segmentRows: rows,
      calculatedVoiceRows: highestUsedVoiceRow + 1,
      highestUsedVoiceRow,
      calculatedSubRows: 1, // Subtitles always sit on 1 unified continuous track
    };
  }, [scriptSegments, speakerRegistry, voiceSettings]);

  // Canonical timing helper for adjacent clip collision prevention and magnetic edge snapping
  const getSegEffectiveRange = useCallback((seg, idx) => {
    if (!seg) return { start: 0, end: 0 };
    const rawStart = (typeof seg.audioStartSec === 'number' && !isNaN(seg.audioStartSec))
      ? seg.audioStartSec 
      : (typeof seg.startSec === 'number' && !isNaN(seg.startSec) ? seg.startSec : (idx * 4));
    const slotStart = (typeof seg.startSec === 'number' && !isNaN(seg.startSec)) ? seg.startSec : rawStart;
    const slotEnd = (typeof seg.endSec === 'number' && !isNaN(seg.endSec)) ? seg.endSec : slotStart + 3.0;
    const isTrimmed = Boolean(seg.audioTrimmed || seg.userTrimmed);
    const slotSpan = (typeof seg.audioEndSec === 'number' && !isNaN(seg.audioEndSec) && seg.audioEndSec > rawStart)
      ? (seg.audioEndSec - rawStart)
      : (slotEnd > slotStart ? (slotEnd - slotStart) : 2.5);
    const audioDur = getSegmentAudioDuration(
      seg,
      (typeof seg.audioDurationSec === 'number' && seg.audioDurationSec > 0) ? seg.audioDurationSec : slotSpan
    );
    const rawEnd = (typeof seg.renderedEnd === 'number' && !isNaN(seg.renderedEnd) && seg.renderedEnd > rawStart)
      ? seg.renderedEnd
      : ((isTrimmed && typeof seg.audioEndSec === 'number' && !isNaN(seg.audioEndSec))
        ? seg.audioEndSec
        : (rawStart + audioDur));
    return { start: rawStart, end: rawEnd };
  }, []);

  // Multi-Track Track Counts (Dynamic Unlimited Voice Lanes)
  const [userVoiceTrackCount, setUserVoiceTrackCount] = useState(1);
  const [userSubTrackCount, setUserSubTrackCount] = useState(1);

  const maxVideoRow = (videoClips || []).reduce((max, c) => Math.max(max, c.trackRow || 0), 0);
  const isDraggingVideoDown = dragState?.itemType === 'video' && dragState?.mode === 'move' && (dragState?.currentY > 20);
  const draggingTargetRow = isDraggingVideoDown 
    ? ((videoClips?.find(c => c.id === dragState.id)?.trackRow || 0) + Math.max(1, Math.round((dragState.currentY || 0) / 52)))
    : 0;
  const videoRowCount = Math.max(userVideoTrackCount, maxVideoRow + 1, draggingTargetRow + 1, 1);

  // Dynamic Unlimited Voice Lanes: voiceLaneCount = max(2, highest trackRow among episode's segments + 2)
  // (all used lanes plus ONE always-empty drop lane at the bottom)
  const isDraggingVoiceDown = dragState?.itemType === 'audio' && dragState?.mode === 'move' && (dragState?.currentY > 20);
  const draggingVoiceTargetRow = isDraggingVoiceDown
    ? ((segmentRows[dragState.index] ?? (scriptSegments?.[dragState.index]?.trackRow || 0)) + Math.max(1, Math.round((dragState.currentY || 0) / 48)))
    : 0;
  const voiceRowCount = Math.max(
    2,
    highestUsedVoiceRow + 2,
    userVoiceTrackCount || 1,
    draggingVoiceTargetRow + 1
  );
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

    const isExplicitVoiceDrag = Boolean(
      effectiveData?.itemType === 'audio' ||
      effectiveData?.type === 'voice-segment' ||
      effectiveData?.type === 'audio-segment' ||
      effectiveData?.segId !== undefined
    );
    const isExplicitSubtitleDrag = Boolean(
      effectiveData?.itemType === 'subtitle' ||
      effectiveData?.type === 'subtitle-segment'
    );
    const isExplicitSegmentDrag = isExplicitVoiceDrag || isExplicitSubtitleDrag;

    // Voice clips can NEVER be dropped onto the video track (or any non-voice track)
    if (isExplicitVoiceDrag && !isVoiceDropTargetAllowed(trackType)) {
      return;
    }

    // 1. Dragged Media Asset from Media Bin (MediaUploadTab)
    if (!isExplicitSegmentDrag && (effectiveData?.type === 'media-asset' || (!videoClips?.some(c => String(c.id) === String(effectiveId)) && !scriptSegments?.some(s => String(s.id) === String(effectiveId))))) {
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
    const existingVideoClip = !isExplicitSegmentDrag
      ? videoClips?.find(c => 
          String(c.id) === String(effectiveId) || 
          String(c.id) === String(effectiveData?.clipId) ||
          (effectiveData?.type === 'video-clip' && videoClips.length === 1)
        )
      : null;

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
    // Video track is NEVER a valid drop target for a voice/subtitle segment
    if (trackType === 'video' || (!isVoiceDropTargetAllowed(trackType) && trackType !== 'subs')) {
      return;
    }
    if (scriptSegments && onUpdateSegments) {
      const segIdx = scriptSegments.findIndex(s => 
        String(s.id) === String(clipIdOrAssetId) || 
        String(s.id) === String(dragData?.segId) ||
        (dragData?.index !== undefined && dragData?.index === scriptSegments.indexOf(s))
      );
      if (segIdx >= 0) {
        const seg = scriptSegments[segIdx];
        const origStart = typeof seg.sourceStartSec === 'number' ? seg.sourceStartSec : (typeof seg.startSec === 'number' ? seg.startSec : 0);
        const origEnd = typeof seg.sourceEndSec === 'number' ? seg.sourceEndSec : (typeof seg.endSec === 'number' ? seg.endSec : origStart + 3.0);
        const curStart = typeof seg.startSec === 'number' ? seg.startSec : 0;
        const curEnd = typeof seg.endSec === 'number' ? seg.endSec : curStart + 3.0;
        const dur = Math.max(0.4, (typeof seg.audioDurationSec === 'number' && seg.audioDurationSec > 0) ? seg.audioDurationSec : (curEnd - curStart));

        const updated = [...scriptSegments];
        updated[segIdx] = {
          ...seg,
          sourceStartSec: parseFloat(origStart.toFixed(2)),
          sourceEndSec: parseFloat(origEnd.toFixed(2)),
          ...(trackType === 'subs' ? { subTrackRow: trackRow, subTrackId: `subs-${trackRow + 1}`, userSubShifted: true } : { trackRow: trackRow, trackId: `voice-${trackRow + 1}` }),
          startSec: safeTime,
          endSec: parseFloat((safeTime + dur).toFixed(2)),
          duration: parseFloat(dur.toFixed(2)),
          start: formatMinSec(safeTime),
          end: formatMinSec(safeTime + dur),
          audioStartSec: safeTime,
          audioEndSec: parseFloat((safeTime + dur).toFixed(2)),
          audioDurationSec: parseFloat(dur.toFixed(2)),
          audioStart: formatMinSec(safeTime),
          audioEnd: formatMinSec(safeTime + dur),
          userShifted: true,
        };
        onUpdateSegments(updated, false, true);
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
    if (typeof window !== 'undefined') window.__timelineIsActiveScrubbing = isScrubbing;
    return () => {
      if (typeof window !== 'undefined') window.__timelineIsActiveScrubbing = false;
    };
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
  const manualFocusLockRef = useRef(null);
  const handledFocusNonceRef = useRef(0);
  const lastFocusScrollRef = useRef(null);
  const scrubRafRef = useRef(null);
  const pendingScrubTimeRef = useRef(null);
  const handleScrubRef = useRef(null);
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  useEffect(() => {
    if (typeof window !== 'undefined') window.__timelineIsPlaying = isPlaying;
    return () => {
      if (typeof window !== 'undefined') window.__timelineIsPlaying = false;
    };
  }, [isPlaying]);
  const onSeekRef = useRef(onSeek);
  onSeekRef.current = onSeek;
  const voiceDragSeekRafRef = useRef(null);
  const pendingVoiceDragSeekRef = useRef(null);
  const lastVoiceDragSeekRef = useRef(null);
  const playheadRef = useRef(null);
  const playheadTimeTextRef = useRef(null);
  const videoClipsRef = useRef(videoClips);
  videoClipsRef.current = videoClips;
  const ppsRef = useRef(getPixelsPerSecond(zoom));
  ppsRef.current = getPixelsPerSecond(zoom);

  // High-performance direct GPU drag interaction refs (bypasses 1,000 DOM element React re-render per mousemove)
  const mouseRafRef = useRef(null);
  const pendingMouseERef = useRef(null);
  const draggedElementRef = useRef(null);
  const cachedVoiceLaneBoundsRef = useRef(null);
  const snapLineRef = useRef(null);
  const lastTargetVoiceRowRef = useRef(null);
  const snappingEnabledRef = useRef(snappingEnabled);
  useEffect(() => { snappingEnabledRef.current = snappingEnabled; }, [snappingEnabled]);
  const totalDurationRef = useRef(duration || 0);
  const onUpdateSegmentsRef = useRef(onUpdateSegments);
  useEffect(() => { onUpdateSegmentsRef.current = onUpdateSegments; }, [onUpdateSegments]);
  const onUpdateClipsRef = useRef(onUpdateClips);
  useEffect(() => { onUpdateClipsRef.current = onUpdateClips; }, [onUpdateClips]);

  const measureVoiceLaneBounds = useCallback((curRow) => {
    const container = timelineBodyRef.current;
    const lanes = container ? Array.from(container.querySelectorAll('.track-lane.voice-lane')) : [];
    if (lanes.length > 0) {
      const firstRect = lanes[0].getBoundingClientRect();
      const lastRect = lanes[lanes.length - 1].getBoundingClientRect();
      const originLane = lanes.find((el) => Number(el.dataset?.trackRow) === curRow) || lanes[Math.min(curRow, lanes.length - 1)];
      const originRect = originLane.getBoundingClientRect();
      return {
        firstLaneTop: firstRect.top,
        lastLaneTop: lastRect.top,
        lastLaneBottom: lastRect.bottom,
        originLaneTop: originRect.top,
        laneHeight: originRect.height > 0 ? originRect.height : 48,
        laneCount: Math.max(lanes.length, voiceRowCount || 2),
      };
    }
    return {
      firstLaneTop: null,
      lastLaneTop: null,
      lastLaneBottom: null,
      originLaneTop: null,
      laneHeight: 48,
      laneCount: Math.max(2, voiceRowCount || 2),
    };
  }, [voiceRowCount]);

  const cancelVoiceDragScrub = useCallback(() => {
    if (voiceDragSeekRafRef.current !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(voiceDragSeekRafRef.current);
      voiceDragSeekRafRef.current = null;
    }
    pendingVoiceDragSeekRef.current = null;
  }, []);

  // RAF-throttled real-time scrub-seek during PAUSED voice-clip MOVE drags only
  const scheduleVoiceDragScrub = useCallback((targetSec, segKey = null) => {
    if (isPlayingRef.current || typeof targetSec !== 'number' || !Number.isFinite(targetSec)) return;
    const safePps = ppsRef.current || 45;
    if (playheadRef.current) {
      playheadRef.current.style.transform = `translate3d(${Math.max(0, targetSec * safePps)}px, 0, 0)`;
    }
    if (playheadTimeTextRef.current) {
      playheadTimeTextRef.current.textContent = formatMinSec(targetSec);
    }
    pendingVoiceDragSeekRef.current = { time: targetSec, segKey };

    if (voiceDragSeekRafRef.current === null && typeof requestAnimationFrame === 'function') {
      voiceDragSeekRafRef.current = requestAnimationFrame(() => {
        voiceDragSeekRafRef.current = null;
        if (isPlayingRef.current) {
          pendingVoiceDragSeekRef.current = null;
          return;
        }
        const pending = pendingVoiceDragSeekRef.current;
        if (!pending || typeof pending.time !== 'number' || !Number.isFinite(pending.time)) {
          pendingVoiceDragSeekRef.current = null;
          return;
        }
        if (lastVoiceDragSeekRef.current !== null && Math.abs(pending.time - lastVoiceDragSeekRef.current) < 0.01) {
          pendingVoiceDragSeekRef.current = null;
          return;
        }
        if (pending.segKey !== null && pending.segKey !== undefined) {
          manualFocusLockRef.current = {
            segKey: pending.segKey,
            targetTime: pending.time,
            expiresAt: Date.now() + 900,
          };
        }
        if (videoRef?.current?.seeking) {
          // If video decoder is already busy, forward latest target with skipStateCommit so
          // nextSeekTargetRef in useVideoPlayback stores it and drains on native 'seeked' without an RAF polling loop.
          pendingVoiceDragSeekRef.current = null;
          lastVoiceDragSeekRef.current = pending.time;
          onSeekRef.current?.(pending.time, { skipStateCommit: true });
          return;
        }
        pendingVoiceDragSeekRef.current = null;
        lastVoiceDragSeekRef.current = pending.time;
        onSeekRef.current?.(pending.time, { skipStateCommit: true });
      });
    }
  }, []);

  useEffect(() => () => cancelVoiceDragScrub(), [cancelVoiceDragScrub]);

  // Subscribe playhead DOM element directly to 60fps RAF playback engine (paused/scrub sync only;
  // during active playback updatePlayheadAndScroll owns the GPU transform to avoid 2x/frame writes).
  useEffect(() => {
    if (typeof subscribePlayhead !== 'function') return undefined;
    return subscribePlayhead((liveTime) => {
      if (isScrubbingRef.current || isPlayingRef.current) return;
      if (playheadRef.current && Number.isFinite(liveTime)) {
        const nextX = Math.max(0, liveTime * (ppsRef.current || 45));
        playheadRef.current.style.transform = `translate3d(${nextX}px, 0, 0)`;
      }
    });
  }, [subscribePlayhead]);

  useEffect(() => {
    selectedSegmentIdRef.current = selectedSegmentId;
    lastSyncedInspectorIdRef.current = selectedSegmentId;
    setSelectedSubId(selectedSegmentId);
    setSelectedAudioId(selectedSegmentId);
  }, [selectedSegmentId]);

  // Focus timeline viewport + protect selection lock when user clicks a segment in "3. Subs"
  useEffect(() => {
    if (!timelineFocusRequest || !timelineFocusRequest.nonce) return;
    if (handledFocusNonceRef.current === timelineFocusRequest.nonce) return;
    handledFocusNonceRef.current = timelineFocusRequest.nonce;

    const { segKey, timeSec } = timelineFocusRequest;
    const safeTime = Number.isFinite(timeSec) ? Math.max(0, timeSec) : 0;

    followSyncSkippedDueToEditingRef.current = false;
    lastUserSelectTimeRef.current = Date.now();
    lastPlayheadSegKeyRef.current = segKey;
    selectedSegmentIdRef.current = segKey;
    lastSyncedInspectorIdRef.current = segKey;
    setSelectedAudioId(segKey);
    setSelectedSubId(segKey);

    manualFocusLockRef.current = {
      segKey,
      targetTime: safeTime,
      expiresAt: Date.now() + 900,
    };

    const container = timelineBodyRef.current;
    if (container && container.clientWidth > 0) {
      const currentPps = ppsRef.current || 45;
      const targetScroll = computeTimelineScrollForTime(
        safeTime,
        currentPps,
        container.clientWidth,
        TRACK_HEADER_WIDTH
      );
      lastFocusScrollRef.current = { targetScroll, ts: Date.now() };
      if (Math.abs(container.scrollLeft - targetScroll) > 1) {
        container.scrollLeft = targetScroll;
      }
    }
  }, [timelineFocusRequest]);

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
  // Normal playback following while playing tracks segments; while PAUSED, manual click selection is authoritative
  useEffect(() => {
    // While PAUSED, playback sync must never change selection or override user click
    if (!isPlaying) return;

    if (!scriptSegments || scriptSegments.length === 0 || !Number.isFinite(currentTime) || dragState || isScrubbing || isScrubbingRef.current) return;

    // Preserve explicit segment selection (from "3. Subs" click or timeline clip click) across
    // 0.01s codec seek rounding or adjacent-segment overlaps while paused at that target time.
    const lock = manualFocusLockRef.current;
    if (lock) {
      const delta = Math.abs(currentTime - lock.targetTime);
      const withinSeekSettle = !isPlaying && Date.now() < lock.expiresAt && delta <= 0.35;
      const parkedOnTarget = !isPlaying && delta <= 0.12;
      if (withinSeekSettle || parkedOnTarget) {
        lastPlayheadSegKeyRef.current = lock.segKey;
        return;
      }
      manualFocusLockRef.current = null;
    }

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

        // Auto-follow playhead: Update selected segment and Inspector as dialogue plays.
        // During active playback, track local selection so timeline tracks highlight without triggering
        // expensive top-level React re-renders of VoiceSettings and MediaLibrary on every segment boundary.
        // On pause, the current playhead segment is synced to onSelectSegment.
        if (String(selectedSegmentIdRef.current) !== String(segKey)) {
          selectedSegmentIdRef.current = segKey;
          setSelectedAudioId(segKey);
          setSelectedSubId(segKey);
        }

        if (!isPlaying) {
          if (String(lastSyncedInspectorIdRef.current) !== String(segKey)) {
            lastSyncedInspectorIdRef.current = segKey;
            if (onSelectSegment) {
              onSelectSegment(segKey);
            }
          }
        }

        // When following video cuts during playback, track active video clip (without triggering playback seek)
        if (isPlaying && selectedClipKind === 'video' && onSelectClip && videoClips && videoClips.length > 0) {
          const matchClip = videoClips.find(c => doesClipMatchSegment(c, activeSeg));
          if (matchClip) {
            onSelectClip(matchClip.id, false);
          }
        }
      }
    } else {
      // In gaps, clear playhead anchor so when next segment begins it is recognized as a new segment
      lastPlayheadSegKeyRef.current = null;
    }
    // In gaps, preserve current selection so Inspector never disappears unexpectedly
  }, [currentTime, scriptSegments, dragState, isScrubbing, isPlaying, onSelectSegment, isEditingInspectorText]);

  const selectedClipKindRef = useRef(selectedClipKind);
  selectedClipKindRef.current = selectedClipKind;
  const onSelectClipRef = useRef(onSelectClip);
  onSelectClipRef.current = onSelectClip;
  const liveFollowBoundsRef = useRef(null);

  // Live 60fps playhead auto-follow: React.memo skips 5Hz currentTime prop ticks during playback
  // for 60fps smoothness, so subscribePlayhead drives edge-triggered clip highlights at segment boundaries.
  useEffect(() => {
    liveFollowBoundsRef.current = null;
    if (!isPlaying || typeof subscribePlayhead !== 'function') return undefined;

    return subscribePlayhead((liveTime) => {
      if (!isPlayingRef.current || !Number.isFinite(liveTime)) return;
      currentTimeRef.current = liveTime;
      if (isScrubbingRef.current || dragStateRef.current) return;

      const segs = scriptSegmentsRef.current;
      if (!segs || segs.length === 0) return;

      const cached = liveFollowBoundsRef.current;
      if (cached && liveTime >= cached.start && liveTime < cached.end) {
        return;
      }

      const activeSeg = resolveSegmentAtTime(segs, liveTime);
      if (activeSeg) {
        const sStart = (typeof activeSeg.startSec === 'number' && !isNaN(activeSeg.startSec))
          ? activeSeg.startSec
          : (typeof activeSeg.audioStartSec === 'number' && !isNaN(activeSeg.audioStartSec) ? activeSeg.audioStartSec : 0);
        const sEnd = (typeof activeSeg.endSec === 'number' && !isNaN(activeSeg.endSec))
          ? activeSeg.endSec
          : (typeof activeSeg.audioEndSec === 'number' && !isNaN(activeSeg.audioEndSec) ? activeSeg.audioEndSec : sStart + 1.0);
        const segKey = activeSeg._uid || (activeSeg.id !== undefined && activeSeg.id !== null ? activeSeg.id : segs.indexOf(activeSeg));
        liveFollowBoundsRef.current = { start: sStart, end: sEnd, segKey };

        if (String(segKey) !== String(lastPlayheadSegKeyRef.current)) {
          if (isEditingInspectorText()) {
            followSyncSkippedDueToEditingRef.current = true;
            return;
          }
          lastPlayheadSegKeyRef.current = segKey;
          if (String(selectedSegmentIdRef.current) !== String(segKey)) {
            selectedSegmentIdRef.current = segKey;
            setSelectedAudioId(segKey);
            setSelectedSubId(segKey);
          }
          if (selectedClipKindRef.current === 'video' && onSelectClipRef.current && videoClipsRef.current?.length > 0) {
            const matchClip = videoClipsRef.current.find((c) => doesClipMatchSegment(c, activeSeg));
            if (matchClip) {
              onSelectClipRef.current(matchClip.id, false);
            }
          }
        }
      } else {
        liveFollowBoundsRef.current = null;
        lastPlayheadSegKeyRef.current = null;
      }
    });
  }, [isPlaying, subscribePlayhead, isEditingInspectorText]);

  // Synchronize paused playhead segment to onSelectSegment when transitioning from playing to paused
  const wasPlayingSyncRef = useRef(false);
  useEffect(() => {
    if (wasPlayingSyncRef.current && !isPlaying && !dragState && !isScrubbing) {
      const curT = Number.isFinite(currentTimeRef.current) ? currentTimeRef.current : 0;
      const activeSeg = resolveSegmentAtTime(scriptSegments, curT);
      const resolvedKey = activeSeg
        ? (activeSeg._uid || (activeSeg.id !== undefined && activeSeg.id !== null ? activeSeg.id : scriptSegments.indexOf(activeSeg)))
        : selectedSegmentIdRef.current;
      if (resolvedKey !== null && resolvedKey !== undefined) {
        if (String(lastSyncedInspectorIdRef.current) !== String(resolvedKey)) {
          lastSyncedInspectorIdRef.current = resolvedKey;
          onSelectSegment?.(resolvedKey);
        }
      }
    }
    wasPlayingSyncRef.current = isPlaying;
  }, [isPlaying, scriptSegments, onSelectSegment, dragState, isScrubbing]);

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

  const rafActiveClipIdxRef = useRef(0);
  const rafLastMappedTimeRef = useRef(0);

  // Duration follows the timeline (R7): ruler length, header duration, and player total equal the end of the last video clip after edits
  const totalDuration = React.useMemo(() => {
    const clipsMax = (videoClips || []).reduce((max, c) => Math.max(max, Number(c.end) || 0), 0);
    const subsMax = (scriptSegments || []).reduce((max, s) => {
      const end = Number(s.audioEndSec) || Number(s.endSec) || (Number(s.startSec) || 0) + (Number(s.audioDurationSec) || 3.0);
      return Math.max(max, end);
    }, 0);
    if (clipsMax > 0) {
      return Math.max(clipsMax, subsMax);
    }
    return Math.max(duration > 0 ? duration : 0, subsMax);
  }, [duration, videoClips, scriptSegments]);
  totalDurationRef.current = totalDuration;

  const pps = getPixelsPerSecond(zoom);
  // Provide extra tail padding (1000px) so playhead stays centered all the way to the end of the video
  const totalWidth = React.useMemo(() => {
    return Math.max(1200, totalDuration * pps + TRACK_HEADER_WIDTH + 1000);
  }, [totalDuration, pps]);

  // Auto-heal single truncated video clip: only heal if uncut raw clip had premature end before metadata finished loading
  useEffect(() => {
    if (!videoClips || videoClips.length !== 1 || !onUpdateClips) return;
    const singleClip = videoClips[0];
    if (singleClip.name === 'Gap' || singleClip.id?.startsWith('clip-gap')) return;
    if (singleClip.userTrimmed || singleClip.audioTrimmed) return;
    if ((singleClip.start || 0) === 0 && duration > 15 && (singleClip.end || 0) < duration - 2 && (singleClip.sourceEnd - singleClip.sourceStart === singleClip.end - singleClip.start)) {
      const healedClips = [{
        ...singleClip,
        end: duration,
        sourceEnd: Math.max(Number(singleClip.sourceEnd) || 0, duration),
        duration: duration,
      }];
      onUpdateClips(healedClips);
    }
  }, [videoClips, duration, onUpdateClips]);

  const handleCenterPlayhead = useCallback(() => {
    if (!timelineBodyRef.current) return;
    const container = timelineBodyRef.current;
    const clientWidth = container.clientWidth;
    if (clientWidth <= 0) return;
    const activeTime = Number.isFinite(playheadTimeRef?.current)
      ? playheadTimeRef.current
      : ((videoRef?.current && !isNaN(videoRef.current.currentTime)) ? videoRef.current.currentTime : currentTime);
    const playheadAbsoluteX = activeTime * pps + TRACK_HEADER_WIDTH;
    const centerThreshold = clientWidth / 2;
    const targetScroll = playheadAbsoluteX > centerThreshold ? Math.max(0, Math.round(playheadAbsoluteX - centerThreshold)) : 0;

    container.scrollTo({ left: targetScroll, behavior: 'smooth' });
  }, [currentTime, pps, videoRef, playheadTimeRef]);

  const performScrub = useCallback((newTime) => {
    onSeek(newTime);
  }, [onSeek]);

  // Playhead scrubber calculation with requestAnimationFrame batching for ultra-smooth 60fps scrubbing
  const handleScrub = useCallback((e) => {
    manualFocusLockRef.current = null;
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
    const isClipClick = Boolean(e.target?.closest?.('.video-clip-block, .voice-segment-block, .subtitle-segment-block, .clean-bgm-block, .timeline-keyframe'));
    if (!isClipClick) {
      if (onSelectClipKind) onSelectClipKind(null);
      if (onSelectClip) onSelectClip(null);
      if (onSelectSegment) onSelectSegment(null);
      selectedSegmentIdRef.current = null;
      lastSyncedInspectorIdRef.current = null;
      setSelectedAudioId(null);
      setSelectedSubId(null);
    }
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
    if (onSelectClipKind) onSelectClipKind('voice');
    setSelectedAudioId(segKey);
    setSelectedSubId(segKey);
    if (onSelectSegment) onSelectSegment(segKey);
    if (onSelectClip) onSelectClip(null);

    const rawStart = (typeof seg.audioStartSec === 'number' && !isNaN(seg.audioStartSec))
      ? seg.audioStartSec 
      : (typeof seg.startSec === 'number' && !isNaN(seg.startSec) ? seg.startSec : 0);
    const slotStart = (typeof seg.startSec === 'number' && !isNaN(seg.startSec)) ? seg.startSec : rawStart;
    const slotEnd = (typeof seg.endSec === 'number' && !isNaN(seg.endSec)) ? seg.endSec : slotStart + 3.0;
    const slotSpan = (typeof seg.audioEndSec === 'number' && !isNaN(seg.audioEndSec) && seg.audioEndSec > rawStart)
      ? (seg.audioEndSec - rawStart)
      : (slotEnd > slotStart ? (slotEnd - slotStart) : 2.5);
    const audioDur = getSegmentAudioDuration(
      seg,
      (typeof seg.audioDurationSec === 'number' && seg.audioDurationSec > 0) ? seg.audioDurationSec : slotSpan
    );
    const isTrimmed = Boolean(seg.audioTrimmed || seg.userTrimmed);
    const rawEnd = (typeof seg.renderedEnd === 'number' && !isNaN(seg.renderedEnd) && seg.renderedEnd > rawStart)
      ? seg.renderedEnd
      : ((isTrimmed && typeof seg.audioEndSec === 'number' && !isNaN(seg.audioEndSec))
        ? seg.audioEndSec 
        : (rawStart + audioDur));

    if (mode === 'move' && onSeek && !isPlaying) {
      manualFocusLockRef.current = {
        segKey,
        targetTime: rawStart,
        expiresAt: Date.now() + 900,
      };
      lastPlayheadSegKeyRef.current = segKey;
      lastVoiceDragSeekRef.current = rawStart;
      onSeek(rawStart);
    }

    const initialDrag = {
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
    };
    dragStateRef.current = initialDrag;
    draggedElementRef.current = e.currentTarget;
    cachedVoiceLaneBoundsRef.current = measureVoiceLaneBounds(segRow);
    lastTargetVoiceRowRef.current = `voice_${segRow}`;
    if (typeof window !== 'undefined') window.__timelineIsDragging = true;
    setDragState(initialDrag);
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
    if (onSelectClipKind) onSelectClipKind('subtitle');
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
      manualFocusLockRef.current = {
        segKey: subKey,
        targetTime: startSec,
        expiresAt: Date.now() + 900,
      };
      lastPlayheadSegKeyRef.current = subKey;
      onSeek(startSec);
    }

    const initialDrag = {
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
    };
    dragStateRef.current = initialDrag;
    draggedElementRef.current = e.currentTarget;
    lastTargetVoiceRowRef.current = `subs_${segRow}`;
    if (typeof window !== 'undefined') window.__timelineIsDragging = true;
    setDragState(initialDrag);
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
    if (onSelectClipKind) onSelectClipKind('video');
    if (onSelectClip) onSelectClip(clip.id);

    if (isGapClip(clip)) {
      selectedSegmentIdRef.current = null;
      lastSyncedInspectorIdRef.current = null;
      lastPlayheadSegKeyRef.current = null;
      setSelectedSubId(null);
      setSelectedAudioId(null);
      if (onSelectSegment) onSelectSegment(null);
    } else {
      const targetSeg = scriptSegments?.find(s => doesClipMatchSegment(clip, s));
      if (targetSeg) {
        const segKey = targetSeg._uid || targetSeg.id;
        selectedSegmentIdRef.current = segKey;
        lastSyncedInspectorIdRef.current = segKey;
        lastPlayheadSegKeyRef.current = segKey;
        setSelectedAudioId(segKey);
        setSelectedSubId(segKey);
        if (onSelectSegment) onSelectSegment(segKey);
      } else {
        selectedSegmentIdRef.current = null;
        lastSyncedInspectorIdRef.current = null;
        lastPlayheadSegKeyRef.current = null;
        setSelectedSubId(null);
        setSelectedAudioId(null);
        if (onSelectSegment) onSelectSegment(null);
      }
    }

    if (mode === 'move' && onSeek && typeof clip.start === 'number') {
      onSeek(clip.start);
    }

    const initialDrag = {
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
    };
    dragStateRef.current = initialDrag;
    draggedElementRef.current = e.currentTarget;
    lastTargetVoiceRowRef.current = `video_${clipRow}`;
    if (typeof window !== 'undefined') window.__timelineIsDragging = true;
    setDragState(initialDrag);
  };

  useEffect(() => {
    const processMouseMove = (e) => {
      const dragState = dragStateRef.current;
      if (!dragState) return;

      const moveDistX = Math.abs(e.clientX - dragState.startX);
      const moveDistY = Math.abs(e.clientY - (dragState.startY !== undefined ? dragState.startY : e.clientY));
      if (!dragState.hasMoved && moveDistX < 4 && moveDistY < 4) return;

      const currentPps = ppsRef.current || 45;
      const deltaSec = (e.clientX - dragState.startX) / currentPps;
      const deltaY = e.clientY - (dragState.startY !== undefined ? dragState.startY : e.clientY);

      if (dragState.mode === 'move') {
        let newStart = Math.max(0, dragState.origStart + deltaSec);
        const clipDur = dragState.origEnd - dragState.origStart;
        let newEnd = newStart + clipDur;
        let currentSnapTime = null;
        let effectiveCurrentY = deltaY;
        let voiceMinY = undefined;
        let voiceMaxY = undefined;
        let resolvedVoiceTargetRow = null;

        // Highlight / hit-test target lane while dragging vertically (Strict lane type isolation)
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
            } else if (dragState.itemType === 'audio' && isVoiceDropTargetAllowed(laneType)) {
              targetLane = lane;
              break;
            } else if (dragState.itemType === 'video' && laneType === 'video') {
              targetLane = lane;
              break;
            }
          }
        }

        if (dragState.itemType === 'audio') {
          const curRow = segmentRows[dragState.index] ?? (scriptSegments?.[dragState.index]?.trackRow || 0);
          const bounds = cachedVoiceLaneBoundsRef.current || measureVoiceLaneBounds(curRow);

          // Clamp drag ghost / preview strictly inside the voice lanes area (NEVER enters VIDEO track)
          const clamped = clampVoiceDragY({
            deltaY,
            curRow,
            voiceRowCount: bounds.laneCount,
            laneHeight: bounds.laneHeight,
            firstLaneTop: bounds.firstLaneTop,
            lastLaneTop: bounds.lastLaneTop,
            originLaneTop: bounds.originLaneTop,
          });
          effectiveCurrentY = clamped.clampedY;
          voiceMinY = clamped.minDeltaY;
          voiceMaxY = clamped.maxDeltaY;

          const pointerVoiceRow = targetLane?.dataset?.trackType === 'voice'
            ? parseInt(targetLane.dataset.trackRow, 10)
            : null;

          resolvedVoiceTargetRow = resolveVoiceDropRow({
            pointerLaneType: targetLane?.dataset?.trackType || null,
            pointerLaneRow: Number.isFinite(pointerVoiceRow) ? pointerVoiceRow : null,
            pointerClientY: e.clientY,
            firstLaneTop: bounds.firstLaneTop,
            lastLaneBottom: bounds.lastLaneBottom,
            deltaY: effectiveCurrentY,
            curRow,
            voiceRowCount: bounds.laneCount,
            laneHeight: bounds.laneHeight,
          });

          // Snap targets for VOICE clips are VOICE clips ONLY — NEVER video clip boundaries
          const voicePos = computeVoiceDragPosition({
            origStart: dragState.origStart,
            origEnd: dragState.origEnd,
            proposedStart: newStart,
            draggedIndex: dragState.index,
            curRow,
            targetRow: resolvedVoiceTargetRow,
            scriptSegments: scriptSegments || [],
            segmentRows,
            getSegEffectiveRange,
            snappingEnabled: snappingEnabledRef.current,
            shiftKey: Boolean(e.shiftKey),
            pps: currentPps,
            currentLiveTime: currentTimeRef.current || 0,
          });
          newStart = voicePos.newStart;
          newEnd = voicePos.newEnd;
          currentSnapTime = voicePos.snapTime;

          if (resolvedVoiceTargetRow === curRow) {
            const { prevBound, nextBound } = voicePos;
            // Strict No-Overlap Clamp on the same track (Edge-to-edge ||)
            if (newStart < prevBound) {
              newStart = prevBound;
              newEnd = newStart + clipDur;
            }
            if (nextBound !== Infinity && newEnd > nextBound) {
              newEnd = nextBound;
              newStart = Math.max(prevBound, newEnd - clipDur);
            }
          }

          // Live scrub-seek: move playhead + seek preview video frame in real time while paused & dragging a voice clip
          const voiceScrubTime = resolveVoiceDragScrubTime({
            itemType: dragState.itemType,
            mode: dragState.mode,
            isPlaying: isPlayingRef.current,
            dragStartSec: newStart,
            totalDuration: totalDurationRef.current,
          });
          if (voiceScrubTime !== null) {
            scheduleVoiceDragScrub(voiceScrubTime, dragState.id);
          }
        } else if (snappingEnabledRef.current && !e.shiftKey) {
          const snapThreshold = Math.min(0.2, Math.max(0.06, 8 / currentPps));
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

        // Apply direct GPU translation to dragged DOM element (instant 60 FPS, no React reconciliation!)
        const dx = (newStart - dragState.origStart) * currentPps;
        const dy = effectiveCurrentY;
        if (draggedElementRef.current) {
          draggedElementRef.current.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
        }

        // Direct snap line indicator transform
        if (snapLineRef.current) {
          if (currentSnapTime !== null) {
            snapLineRef.current.style.display = 'block';
            snapLineRef.current.style.transform = `translate3d(${currentSnapTime * currentPps}px, 0, 0)`;
          } else {
            snapLineRef.current.style.display = 'none';
          }
        }

        // Direct track lane hover highlight via DOM class
        let targetTrackKey = null;
        if (dragState.itemType === 'audio') {
          targetTrackKey = `voice_${Math.max(0, resolvedVoiceTargetRow ?? 0)}`;
        } else if (targetLane && targetLane.dataset?.trackKey) {
          targetTrackKey = targetLane.dataset.trackKey;
        } else if (deltaY > 20 && dragState.itemType === 'video') {
          const cur = videoClips?.find(c => c.id === dragState.id);
          const curRow = cur?.trackRow || 0;
          const rowShift = Math.max(1, Math.round(deltaY / 52));
          targetTrackKey = `video_${curRow + rowShift}`;
        } else if (deltaY > 20 && dragState.itemType === 'subtitle') {
          const curSeg = scriptSegments?.[dragState.index];
          const curRow = (typeof curSeg?.subTrackRow === 'number' && curSeg.subTrackRow >= 0) ? curSeg.subTrackRow : 0;
          const rowShift = Math.max(1, Math.round(deltaY / 42));
          targetTrackKey = `subs_${curRow + rowShift}`;
        }

        if (targetTrackKey !== lastTargetVoiceRowRef.current) {
          const container = timelineBodyRef.current;
          if (container) {
            if (lastTargetVoiceRowRef.current) {
              const prevLane = container.querySelector(`.track-lane[data-track-key="${lastTargetVoiceRowRef.current}"]`);
              if (prevLane) prevLane.classList.remove('is-drag-over');
            }
            if (targetTrackKey) {
              const nextLane = container.querySelector(`.track-lane[data-track-key="${targetTrackKey}"]`);
              if (nextLane) nextLane.classList.add('is-drag-over');
            }
          }
          lastTargetVoiceRowRef.current = targetTrackKey;
        }

        // Keep dragStateRef in sync with latest pointer calculations for drop commit
        dragStateRef.current = {
          ...dragState,
          hasMoved: true,
          currentStart: newStart,
          currentEnd: newEnd,
          currentY: effectiveCurrentY,
          ...(dragState.itemType === 'audio' ? {
            minVoiceY: voiceMinY,
            maxVoiceY: voiceMaxY,
            targetVoiceRow: resolvedVoiceTargetRow,
          } : {}),
        };
      } else if (dragState.mode === 'trim-left') {
        let minAllowedStart = 0;
        if (dragState.itemType === 'audio' && scriptSegments && scriptSegments.length > 0) {
          const curRow = segmentRows[dragState.index] ?? (scriptSegments[dragState.index]?.trackRow || 0);
          for (let i = 0; i < scriptSegments.length; i++) {
            if (i === dragState.index) continue;
            const other = scriptSegments[i];
            const otherRow = segmentRows[i] ?? (other.trackRow || 0);
            if (otherRow !== curRow) continue;
            const range = getSegEffectiveRange(other, i);
            if (range.end <= dragState.origStart + 0.05 && range.end > minAllowedStart) {
              minAllowedStart = range.end;
            }
          }
        }
        const newStart = Math.min(dragState.origEnd - 0.4, Math.max(minAllowedStart, dragState.origStart + deltaSec));
        dragStateRef.current = { ...dragState, hasMoved: true, currentStart: newStart };
        setDragState(dragStateRef.current);
      } else if (dragState.mode === 'trim-right') {
        let maxAllowedEnd = Infinity;
        if (dragState.itemType === 'audio' && scriptSegments && scriptSegments.length > 0) {
          const curRow = segmentRows[dragState.index] ?? (scriptSegments[dragState.index]?.trackRow || 0);
          for (let i = 0; i < scriptSegments.length; i++) {
            if (i === dragState.index) continue;
            const other = scriptSegments[i];
            const otherRow = segmentRows[i] ?? (other.trackRow || 0);
            if (otherRow !== curRow) continue;
            const range = getSegEffectiveRange(other, i);
            if (range.start >= dragState.origEnd - 0.05 && range.start < maxAllowedEnd) {
              maxAllowedEnd = range.start;
            }
          }
        }
        let newEnd = Math.max(dragState.origStart + 0.4, dragState.origEnd + deltaSec);
        if (maxAllowedEnd !== Infinity && newEnd > maxAllowedEnd) {
          newEnd = maxAllowedEnd;
        }
        dragStateRef.current = { ...dragState, hasMoved: true, currentEnd: newEnd };
        setDragState(dragStateRef.current);
      }
    };

    const handleMouseMove = (e) => {
      if (dragStateRef.current) {
        pendingMouseERef.current = e;
        if (!mouseRafRef.current) {
          mouseRafRef.current = requestAnimationFrame(() => {
            mouseRafRef.current = null;
            if (pendingMouseERef.current) {
              processMouseMove(pendingMouseERef.current);
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
      cancelVoiceDragScrub();
      lastVoiceDragSeekRef.current = null;

      if (mouseRafRef.current) {
        cancelAnimationFrame(mouseRafRef.current);
        mouseRafRef.current = null;
      }
      if (pendingMouseERef.current) {
        processMouseMove(pendingMouseERef.current);
        pendingMouseERef.current = null;
      }

      // Reset direct styles
      if (draggedElementRef.current) {
        draggedElementRef.current.style.transform = '';
        draggedElementRef.current = null;
      }
      if (snapLineRef.current) {
        snapLineRef.current.style.display = 'none';
      }
      if (lastTargetVoiceRowRef.current) {
        const container = timelineBodyRef.current;
        if (container) {
          const lane = container.querySelector(`.track-lane[data-track-key="${lastTargetVoiceRowRef.current}"]`);
          if (lane) lane.classList.remove('is-drag-over');
        }
        lastTargetVoiceRowRef.current = null;
      }
      cachedVoiceLaneBoundsRef.current = null;
      setSnapLineTime(null);
      setDragOverTrack(null);
      if (typeof window !== 'undefined') window.__timelineIsDragging = false;

      const activeDrag = dragStateRef.current;
      dragStateRef.current = null;

      if (isNativeDraggingRef.current) {
        isNativeDraggingRef.current = false;
        setDragState(null);
        return;
      }

      if (activeDrag) {
        if (!activeDrag.hasMoved) {
          // If simple click on an audio or subtitle segment while paused, jump the playhead line | to the start of this segment
          if (!isPlayingRef.current && (activeDrag.itemType === 'audio' || activeDrag.itemType === 'subtitle') && onSeek && typeof activeDrag.origStart === 'number') {
            onSeek(activeDrag.origStart);
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
              if (activeDrag.itemType === 'subtitle' && laneType === 'subs') {
                targetLane = lane;
                break;
              } else if (activeDrag.itemType === 'audio' && laneType === 'voice') {
                targetLane = lane;
                break;
              } else if (activeDrag.itemType === 'video' && laneType === 'video') {
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

        const liveDeltaY = (typeof e?.clientY === 'number' && typeof activeDrag.startY === 'number')
          ? (e.clientY - activeDrag.startY)
          : (activeDrag.currentY || 0);

        if ((activeDrag.itemType === 'audio' || activeDrag.itemType === 'subtitle') && onUpdateSegments && scriptSegments) {
          const segIdx = scriptSegments.findIndex((s, i) => 
            (s._uid && activeDrag.id && String(s._uid) === String(activeDrag.id)) ||
            (s.id !== undefined && s.id !== null && activeDrag.id !== undefined && activeDrag.id !== null && String(s.id) === String(activeDrag.id)) ||
            i === activeDrag.index
          );
          const seg = segIdx >= 0 ? scriptSegments[segIdx] : null;
          if (seg) {
            const curSegRow = segmentRows[segIdx] ?? (seg.trackRow || 0);
            let finalTargetRow = curSegRow;

            if (activeDrag.itemType === 'audio') {
              const bounds = measureVoiceLaneBounds(curSegRow);
              finalTargetRow = resolveVoiceDropRow({
                pointerLaneType: isVoiceDropTargetAllowed(targetType) ? targetType : null,
                pointerLaneRow: isVoiceDropTargetAllowed(targetType) ? targetRow : null,
                pointerClientY: typeof e?.clientY === 'number' ? e.clientY : null,
                firstLaneTop: bounds.firstLaneTop,
                lastLaneBottom: bounds.lastLaneBottom,
                deltaY: liveDeltaY,
                curRow: curSegRow,
                voiceRowCount: bounds.laneCount,
                laneHeight: bounds.laneHeight,
              });
            }

            const curSubRow = (typeof seg.subTrackRow === 'number' && seg.subTrackRow >= 0) ? seg.subTrackRow : 0;
            let finalSubTargetRow = curSubRow;
            if (activeDrag.itemType === 'subtitle') {
              if (targetType === 'subs' && targetRow !== null) {
                finalSubTargetRow = targetRow;
              } else if (liveDeltaY < -20 && curSubRow > 0) {
                const rowShift = Math.min(-1, Math.round(liveDeltaY / 42));
                finalSubTargetRow = Math.max(0, curSubRow + rowShift);
              } else if (liveDeltaY > 20) {
                const rowShift = Math.max(1, Math.round(liveDeltaY / 42));
                finalSubTargetRow = curSubRow + rowShift;
              }
            }

            const currentState = { videoClips: videoClips || [], segments: scriptSegments };
            const segKey = seg._uid || seg.id || activeDrag.id;

            if (activeDrag.mode === 'move') {
              const newStart = Math.max(0, parseFloat(activeDrag.currentStart.toFixed(2)));
              // Enforce strict no-overlap clamp on final target row via moveClipOp
              const opResult = moveClipOp(currentState, {
                clipId: segKey,
                newStart,
                trackRow: finalTargetRow,
                subTrackRow: activeDrag.itemType === 'subtitle' ? finalSubTargetRow : undefined,
              });

              if (opResult.applied) {
                if (activeDrag.itemType === 'audio' && finalTargetRow >= userVoiceTrackCount) {
                  setUserVoiceTrackCount(finalTargetRow + 1);
                }
                if (activeDrag.itemType === 'subtitle' && finalSubTargetRow >= userSubTrackCount) {
                  setUserSubTrackCount(finalSubTargetRow + 1);
                }
                const droppedSeg = opResult.state.segments[segIdx];
                const droppedStart = (activeDrag.itemType === 'audio' && droppedSeg && typeof droppedSeg.audioStartSec === 'number' && Number.isFinite(droppedSeg.audioStartSec))
                  ? droppedSeg.audioStartSec
                  : newStart;
                const wasPlayingOnDrop = Boolean(isPlayingRef.current || (videoRef?.current && !videoRef.current.paused));
                onUpdateSegments(opResult.state.segments, false, false);
                if (!wasPlayingOnDrop && onSeek && typeof droppedStart === 'number') {
                  manualFocusLockRef.current = {
                    segKey,
                    targetTime: droppedStart,
                    expiresAt: Date.now() + 900,
                  };
                  if (playheadRef.current) {
                    playheadRef.current.style.transform = `translate3d(${Math.max(0, droppedStart * (ppsRef.current || 45))}px, 0, 0)`;
                  }
                  if (playheadTimeTextRef.current) {
                    playheadTimeTextRef.current.textContent = formatMinSec(droppedStart);
                  }
                  onSeek(droppedStart);
                }
              } else if (opResult.reason) {
                console.warn('[moveClip]', opResult.reason);
                const wasPlayingOnDrop = Boolean(isPlayingRef.current || (videoRef?.current && !videoRef.current.paused));
                if (!wasPlayingOnDrop && activeDrag.itemType === 'audio' && onSeek && typeof activeDrag.origStart === 'number') {
                  onSeek(activeDrag.origStart);
                }
                if (typeof window !== 'undefined') {
                  window.dispatchEvent(new CustomEvent('timeline:toast', { detail: { message: opResult.reason } }));
                }
              }
            } else if (activeDrag.mode === 'trim-left' || activeDrag.mode === 'trim-right') {
              const isLeft = activeDrag.mode === 'trim-left';
              const opResult = trimClipOp(currentState, {
                clipId: segKey,
                edge: isLeft ? 'left' : 'right',
                newTime: isLeft ? activeDrag.currentStart : activeDrag.currentEnd,
              });

              if (opResult.applied) {
                onUpdateSegments(opResult.state.segments, false, true);
              } else if (opResult.reason) {
                console.warn('[trimClip]', opResult.reason);
                if (typeof window !== 'undefined') {
                  window.dispatchEvent(new CustomEvent('timeline:toast', { detail: { message: opResult.reason } }));
                }
              }
            }
          }
        } else if (activeDrag.itemType === 'video' && onUpdateClips && videoClips) {
          const clip = videoClips.find(c => c.id === activeDrag.id) || videoClips[activeDrag.index];
          if (clip) {
            const currentState = { videoClips: videoClips || [], segments: scriptSegments || [] };

            if (activeDrag.mode === 'trim-left' || activeDrag.mode === 'trim-right') {
              const isLeft = activeDrag.mode === 'trim-left';
              const opResult = trimClipOp(currentState, {
                clipId: clip.id,
                edge: isLeft ? 'left' : 'right',
                newTime: isLeft ? activeDrag.currentStart : activeDrag.currentEnd,
                maxSourceDuration: totalDuration,
              });

              if (opResult.applied) {
                onUpdateClips(opResult.state.videoClips);
              } else if (opResult.reason) {
                console.warn('[trimClip]', opResult.reason);
                if (typeof window !== 'undefined') {
                  window.dispatchEvent(new CustomEvent('timeline:toast', { detail: { message: opResult.reason } }));
                }
              }
            } else if (activeDrag.mode === 'move') {
              let newStart = Math.max(0, parseFloat(activeDrag.currentStart.toFixed(2)));
              if (snappingEnabled && newStart < 0.1) {
                newStart = 0;
              }

              const currentClipRow = typeof clip.trackRow === 'number' ? clip.trackRow : 0;
              let targetVideoRow = currentClipRow;

              if (targetType === 'video' && targetRow !== null && targetRow !== currentClipRow) {
                targetVideoRow = targetRow;
              } else if (liveDeltaY > 20) {
                const rowShift = Math.max(1, Math.round(liveDeltaY / 52));
                targetVideoRow = currentClipRow + rowShift;
              } else if (liveDeltaY < -20 && currentClipRow > 0) {
                const rowShift = Math.min(-1, Math.round(liveDeltaY / 52));
                targetVideoRow = Math.max(0, currentClipRow + rowShift);
              } else if (targetType === 'video' && targetRow !== null) {
                targetVideoRow = targetRow;
              }

              const opResult = moveClipOp(currentState, {
                clipId: clip.id,
                newStart,
                trackRow: targetVideoRow,
              });

              if (opResult.applied) {
                if (targetVideoRow >= userVideoTrackCount) {
                  setUserVideoTrackCount(targetVideoRow + 1);
                }

                let updatedSegs = null;
                if (scriptSegments && scriptSegments.length > 0) {
                  const synced = syncSegmentsWithMovedClip(clip, newStart, scriptSegments);
                  if (synced !== scriptSegments) {
                    updatedSegs = synced;
                  }
                }

                onUpdateClips(opResult.state.videoClips, updatedSegs);
              } else if (opResult.reason) {
                console.warn('[moveClip]', opResult.reason);
                if (typeof window !== 'undefined') {
                  window.dispatchEvent(new CustomEvent('timeline:toast', { detail: { message: opResult.reason } }));
                }
              }
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
      if (mouseRafRef.current) {
        cancelAnimationFrame(mouseRafRef.current);
        mouseRafRef.current = null;
      }
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      if (scrubRafRef.current) {
        cancelAnimationFrame(scrubRafRef.current);
        scrubRafRef.current = null;
      }
    };
  }, [Boolean(dragState), isScrubbing, pps, onSelectSegment]);

  const selectedSegKey = selectedSubId !== null && selectedSubId !== undefined
    ? selectedSubId
    : (selectedAudioId !== null && selectedAudioId !== undefined
      ? selectedAudioId
      : (selectedSegmentId !== null && selectedSegmentId !== undefined ? selectedSegmentId : null));

  const canDeleteSubtitle = selectedSegKey !== null && selectedSegKey !== undefined && scriptSegments && scriptSegments.length > 0;
  const canDeleteVideo = Boolean(activeClipId && videoClips && videoClips.length > 0);
  const canDelete = Boolean(canDeleteSubtitle || canDeleteVideo);

  const canSplit = React.useMemo(() => {
    const playhead = typeof currentTime === 'number' && !isNaN(currentTime) ? currentTime : 0;

    // (a) If an explicitly selected segment contains the playhead
    const isSegmentSelected = (selectedClipKind === 'voice' || selectedClipKind === 'subtitle' || selectedClipKind === null) && selectedSegmentId !== null;
    if (isSegmentSelected && Array.isArray(scriptSegments) && scriptSegments.length > 0) {
      const activeSeg = scriptSegments.find((s, idx) => isSegmentMatch(s, selectedSegmentId, idx));
      if (activeSeg) {
        const sStart = typeof activeSeg.audioStartSec === 'number' && !isNaN(activeSeg.audioStartSec)
          ? activeSeg.audioStartSec
          : (typeof activeSeg.startSec === 'number' && !isNaN(activeSeg.startSec) ? activeSeg.startSec : parseTimeToSeconds(activeSeg.start, 0));
        const sEnd = typeof activeSeg.audioEndSec === 'number' && !isNaN(activeSeg.audioEndSec)
          ? activeSeg.audioEndSec
          : (typeof activeSeg.endSec === 'number' && !isNaN(activeSeg.endSec) ? activeSeg.endSec : sStart + 3.0);
        if (playhead > sStart + 0.05 && playhead < sEnd - 0.05) {
          return true;
        }
      }
    }

    // (b) Check if any video clip strictly contains the playhead
    if (Array.isArray(videoClips) && videoClips.length > 0) {
      const hasStrictVideoClip = videoClips.some((c) => playhead > (c.start || 0) + 0.05 && playhead < (c.end || 0) - 0.05);
      if (hasStrictVideoClip) return true;
    }

    // (c) Virtual / full-length single video clip
    const resolvedDur = Math.max(totalDuration, Number(selectedVideo?.durationSec || selectedVideo?.duration || 0));
    if (selectedVideo && resolvedDur > 0) {
      return playhead > 0.05 && playhead < resolvedDur - 0.05;
    }

    return false;
  }, [currentTime, selectedClipKind, selectedSegmentId, scriptSegments, videoClips, totalDuration, selectedVideo]);

  const handleDeleteSelected = useCallback(() => {
    if (selectedClipKind === 'video') {
      if (canDeleteVideo) {
        if (onDeleteClip) {
          onDeleteClip(activeClipId);
        } else if (onUpdateClips) {
          const targetClip = (videoClips || []).find((c) => c.id === activeClipId);
          if (targetClip) {
            const currentState = { videoClips: videoClips || [], segments: scriptSegments || [] };
            const opResult = isGapClip(targetClip)
              ? deleteGapOp(currentState, { clipId: activeClipId })
              : deleteVideoClipOp(currentState, { clipId: activeClipId, totalDuration: duration });
            if (opResult.applied) {
              onUpdateClips(opResult.state.videoClips, opResult.state.segments);
            }
          }
        }
        if (onSelectClip) onSelectClip(null);
        if (onSelectSegment) onSelectSegment(null);
        if (onSelectClipKind) onSelectClipKind(null);
      }
      return;
    }
    if ((selectedClipKind === 'voice' || selectedClipKind === 'subtitle') && !canDeleteSubtitle) return;

    if (canDeleteSubtitle) {
      if (onSelectClipKind) onSelectClipKind(null);
      if (onDeleteSegment) {
        onDeleteSegment(selectedSegKey);
      } else {
        const currentState = { videoClips: videoClips || [], segments: scriptSegments || [] };
        const opResult = deleteSegmentOp(currentState, { segKey: selectedSegKey });
        if (opResult.applied && onUpdateSegments) {
          onUpdateSegments(opResult.state.segments, false, true);
        }
      }
      setSelectedSubId(null);
      setSelectedAudioId(null);
      selectedSegmentIdRef.current = null;
      lastSyncedInspectorIdRef.current = null;
      if (onSelectSegment) {
        onSelectSegment(null);
      }
      return;
    }

    if (selectedClipKind) return;

    if (canDeleteVideo) {
      if (onDeleteClip) {
        onDeleteClip(activeClipId);
      } else if (onUpdateClips) {
        const targetClip = (videoClips || []).find((c) => c.id === activeClipId);
        if (targetClip) {
          const currentState = { videoClips: videoClips || [], segments: scriptSegments || [] };
          const opResult = isGapClip(targetClip)
            ? deleteGapOp(currentState, { clipId: activeClipId })
            : deleteVideoClipOp(currentState, { clipId: activeClipId, totalDuration: duration });
          if (opResult.applied) {
            onUpdateClips(opResult.state.videoClips, opResult.state.segments);
          }
        }
      }
      if (onSelectClip) onSelectClip(null);
    }
  }, [selectedClipKind, canDeleteSubtitle, canDeleteVideo, selectedSegKey, scriptSegments, videoClips, duration, onDeleteSegment, onUpdateSegments, onSelectSegment, onDeleteClip, onUpdateClips, onSelectClip, onSelectClipKind, activeClipId]);


  // 1. Pure 60FPS Hardware GPU Playhead Animation & 1:1 In-Sync Smooth Center Scroll
  useEffect(() => {
    if (!isPlaying) return;

    let animId;
    let lastVideoTime = videoRef?.current?.currentTime || 0;
    let lastPerfTime = performance.now();

    const updatePlayheadAndScroll = () => {
      try {
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
          if (!playingProxy && currentClips && currentClips.length > 0) {
            let currentClipIdx = rafActiveClipIdxRef.current;
            if (currentClipIdx < 0 || currentClipIdx >= currentClips.length) {
              currentClipIdx = 0;
            }
            const checkClip = currentClips[currentClipIdx];
            const checkStart = Number.isFinite(checkClip?.sourceStart) ? checkClip.sourceStart : (checkClip?.start || 0);
            const checkEnd = Number.isFinite(checkClip?.sourceEnd) ? checkClip.sourceEnd : (checkClip?.end || (v.duration || 0));

            let foundIdx = -1;
            if (smoothSrcTime >= (checkStart - 0.04) && smoothSrcTime < checkEnd) {
              foundIdx = currentClipIdx;
            } else if (currentClipIdx + 1 < currentClips.length) {
              const nextC = currentClips[currentClipIdx + 1];
              const nStart = Number.isFinite(nextC?.sourceStart) ? nextC.sourceStart : (nextC?.start || 0);
              const nEnd = Number.isFinite(nextC?.sourceEnd) ? nextC.sourceEnd : (nextC?.end || (v.duration || 0));
              if (smoothSrcTime >= (nStart - 0.04) && smoothSrcTime < nEnd) {
                foundIdx = currentClipIdx + 1;
              }
            }

            if (foundIdx === -1) {
              for (let i = currentClipIdx + 2; i < currentClips.length; i++) {
                const c = currentClips[i];
                const sStart = Number.isFinite(c.sourceStart) ? c.sourceStart : (c.start || 0);
                const sEnd = Number.isFinite(c.sourceEnd) ? c.sourceEnd : (c.end || (v.duration || 0));
                if (smoothSrcTime >= (sStart - 0.03) && smoothSrcTime < sEnd) {
                  foundIdx = i;
                  break;
                }
              }
            }

            if (foundIdx === -1) {
              for (let i = currentClipIdx - 1; i >= 0; i--) {
                const c = currentClips[i];
                const sStart = Number.isFinite(c.sourceStart) ? c.sourceStart : (c.start || 0);
                const sEnd = Number.isFinite(c.sourceEnd) ? c.sourceEnd : (c.end || (v.duration || 0));
                if (smoothSrcTime >= (sStart - 0.03) && smoothSrcTime < sEnd) {
                  foundIdx = i;
                  break;
                }
              }
            }

            if (foundIdx !== -1) {
              rafActiveClipIdxRef.current = foundIdx;
              const c = currentClips[foundIdx];
              const sStart = Number.isFinite(c.sourceStart) ? c.sourceStart : (c.start || 0);
              const cStart = Number.isFinite(c.start) ? c.start : 0;
              const computedTlTime = cStart + Math.max(0, smoothSrcTime - sStart);
              tlTime = Math.max(rafLastMappedTimeRef.current || 0, computedTlTime);
              rafLastMappedTimeRef.current = tlTime;
            }
          }

          const currentX = tlTime * currentPps;

          // Direct hardware GPU transform: silky-smooth 60 FPS without React re-render lag!
          playheadRef.current.style.transform = `translate3d(${currentX}px, 0, 0)`;

          if (playheadTimeTextRef.current) {
            const nextPlayheadText = formatMinSec(tlTime);
            if (playheadTimeTextRef.current.textContent !== nextPlayheadText) {
              playheadTimeTextRef.current.textContent = nextPlayheadText;
            }
          }

          // Smart Professional Auto-Follow Viewport Bounds (Center-Lock Style)
          // Keeps playhead locked at 50% viewport center once it advances past the center line
          if (autoCenter && timelineBodyRef.current && !isScrubbing && !dragState) {
            const container = timelineBodyRef.current;
            const clientWidth = container.clientWidth;
            if (clientWidth > 0) {
              const playheadAbsoluteX = currentX + TRACK_HEADER_WIDTH;
              const rightThreshold = clientWidth / 2;
              const screenX = playheadAbsoluteX - container.scrollLeft;

              if (screenX > rightThreshold || playheadAbsoluteX > rightThreshold) {
                const targetScroll = Math.round(playheadAbsoluteX - rightThreshold);
                if (Math.abs(container.scrollLeft - targetScroll) >= 1) {
                  container.scrollLeft = targetScroll;
                }
              } else if (container.scrollLeft > 0) {
                container.scrollLeft = 0;
              }
            }
          }
        }
      } catch (err) {
        console.warn('[Timeline RAF] Safe playhead error suppression:', err);
      }
      animId = requestAnimationFrame(updatePlayheadAndScroll);
    };

    animId = requestAnimationFrame(updatePlayheadAndScroll);
    return () => cancelAnimationFrame(animId);
  }, [isPlaying, playingProxy, autoCenter, pps, isScrubbing, dragState]);

  // --- Unified Per-Episode Timeline View State (Playhead, Scroll, Zoom) ---
  const episodeViewKey = buildEpisodeViewKey(seriesId, episodeId);
  const restoredEpisodeKeyRef = useRef('');
  const pendingRestoreViewRef = useRef(null);
  const prevPpsRef = useRef(pps);
  const prevRevealedTimeRef = useRef(currentTime);
  const prevIsScrubbingRef = useRef(isScrubbing);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const viewSaveTimerRef = useRef(null);

  // A1. Load per-episode view state (zoom + pending scroll/playhead restore) when episode opens/switches
  useLayoutEffect(() => {
    if (!episodeViewKey) return;
    if (restoredEpisodeKeyRef.current === episodeViewKey) return;

    const saved = loadEpisodeTimelineViewState(seriesId, episodeId);
    if (saved) {
      pendingRestoreViewRef.current = {
        key: episodeViewKey,
        playheadSec: saved.playheadSec,
        scrollLeft: saved.scrollLeft,
        zoom: saved.zoom,
      };
      if (Math.abs(zoomRef.current - saved.zoom) > 0.005) {
        setZoom(saved.zoom);
      }
    } else {
      pendingRestoreViewRef.current = null;
      restoredEpisodeKeyRef.current = episodeViewKey;
      prevPpsRef.current = ppsRef.current;
      prevRevealedTimeRef.current = currentTimeRef.current;
    }
  }, [episodeViewKey, seriesId, episodeId]);

  // A2. Apply restored horizontal scroll once timeline width & restored zoom have laid out
  useLayoutEffect(() => {
    const pending = pendingRestoreViewRef.current;
    if (!pending || pending.key !== episodeViewKey) return;
    const container = timelineBodyRef.current;
    if (!container || container.clientWidth <= 0) return;

    const expectedPps = getPixelsPerSecond(pending.zoom);
    if (Math.abs(pps - expectedPps) > 0.05) return;
    // Wait for episode duration to hydrate before restoring non-zero scroll so scrollLeft isn't clamped to 0
    if (totalDuration <= 0 && (pending.scrollLeft > 0 || pending.playheadSec > 0)) return;

    const clientWidth = container.clientWidth;
    const trackViewportW = Math.max(0, clientWidth - TRACK_HEADER_WIDTH);
    const desiredPlayhead = currentTimeRef.current > 0 ? currentTimeRef.current : pending.playheadSec;
    const playheadOffsetAtSavedScroll = desiredPlayhead * pps - pending.scrollLeft;
    const isPlayheadVisibleAtSaved =
      trackViewportW > 32 &&
      playheadOffsetAtSavedScroll >= 0 &&
      playheadOffsetAtSavedScroll <= (trackViewportW - 12);

    const targetScroll = isPlayheadVisibleAtSaved
      ? Math.max(0, Math.round(pending.scrollLeft))
      : computeTimelineScrollForTime(desiredPlayhead, pps, clientWidth, TRACK_HEADER_WIDTH);

    container.scrollLeft = targetScroll;
    if (playheadRef.current) {
      playheadRef.current.style.transform = `translate3d(${desiredPlayhead * pps}px, 0, 0)`;
    }
    if (playheadTimeTextRef.current) {
      playheadTimeTextRef.current.textContent = formatMinSec(desiredPlayhead);
    }

    pendingRestoreViewRef.current = null;
    restoredEpisodeKeyRef.current = episodeViewKey;
    prevPpsRef.current = pps;
    prevRevealedTimeRef.current = desiredPlayhead;
  }, [episodeViewKey, totalDuration, totalWidth, pps]);

  // Helper to persist current timeline view state for active episode (localStorage only, never series.json)
  const flushEpisodeViewState = useCallback((override = null) => {
    if (!episodeViewKey || restoredEpisodeKeyRef.current !== episodeViewKey) return;
    const container = timelineBodyRef.current;
    const liveTime = (playheadTimeRef && Number.isFinite(playheadTimeRef.current))
      ? playheadTimeRef.current
      : currentTimeRef.current;
    const playheadSec = override && Number.isFinite(override.playheadSec) ? override.playheadSec : liveTime;
    const scrollLeft = override && Number.isFinite(override.scrollLeft)
      ? override.scrollLeft
      : (container ? container.scrollLeft : 0);
    const activeZoom = override && Number.isFinite(override.zoom) ? override.zoom : zoomRef.current;

    saveEpisodeTimelineViewState(seriesId, episodeId, {
      playheadSec,
      scrollLeft,
      zoom: activeZoom,
    });
  }, [episodeViewKey, seriesId, episodeId, playheadTimeRef]);

  const schedulePersistViewState = useCallback(() => {
    if (!episodeViewKey || restoredEpisodeKeyRef.current !== episodeViewKey) return;
    if (viewSaveTimerRef.current !== null) {
      window.clearTimeout(viewSaveTimerRef.current);
    }
    viewSaveTimerRef.current = window.setTimeout(() => {
      viewSaveTimerRef.current = null;
      flushEpisodeViewState();
    }, 120);
  }, [episodeViewKey, flushEpisodeViewState]);

  // A3. Persist on horizontal scroll & flush synchronously before page reload/unload
  useEffect(() => {
    const container = timelineBodyRef.current;
    if (!container || !episodeViewKey) return undefined;

    const onScroll = () => schedulePersistViewState();
    const onBeforeUnload = () => flushEpisodeViewState();

    container.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('pagehide', onBeforeUnload);

    return () => {
      container.removeEventListener('scroll', onScroll);
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('pagehide', onBeforeUnload);
      if (viewSaveTimerRef.current !== null) {
        window.clearTimeout(viewSaveTimerRef.current);
        viewSaveTimerRef.current = null;
      }
      flushEpisodeViewState();
    };
  }, [episodeViewKey, schedulePersistViewState, flushEpisodeViewState]);

  // A4. Persist whenever playhead time or zoom changes (once episode restore is complete)
  useEffect(() => {
    if (!episodeViewKey || restoredEpisodeKeyRef.current !== episodeViewKey) return;
    schedulePersistViewState();
  }, [episodeViewKey, currentTime, zoom, schedulePersistViewState]);

  // C. Zoom anchors synchronously on the playhead BEFORE paint — playhead NEVER leaves the screen on zoom
  useLayoutEffect(() => {
    const oldPps = prevPpsRef.current;
    prevPpsRef.current = pps;
    if (oldPps === pps) return;
    if (pendingRestoreViewRef.current && pendingRestoreViewRef.current.key === episodeViewKey) return;

    const container = timelineBodyRef.current;
    if (!container || container.clientWidth <= 0) return;

    const anchorTime = (playheadTimeRef && Number.isFinite(playheadTimeRef.current))
      ? playheadTimeRef.current
      : currentTimeRef.current;

    const anchoredScroll = computeAnchoredZoomScrollLeft({
      playheadSec: anchorTime,
      oldPps,
      newPps: pps,
      currentScrollLeft: container.scrollLeft,
      clientWidth: container.clientWidth,
      trackHeaderWidth: TRACK_HEADER_WIDTH,
    });

    container.scrollLeft = anchoredScroll;
    if (playheadRef.current) {
      playheadRef.current.style.transform = `translate3d(${anchorTime * pps}px, 0, 0)`;
    }
    if (playheadTimeTextRef.current) {
      const txt = formatMinSec(anchorTime);
      if (playheadTimeTextRef.current.textContent !== txt) {
        playheadTimeTextRef.current.textContent = txt;
      }
    }
    flushEpisodeViewState({ playheadSec: anchorTime, scrollLeft: anchoredScroll, zoom: zoomRef.current });
  }, [pps, episodeViewKey, playheadTimeRef, flushEpisodeViewState]);

  // Synchronize playhead position via GPU transform when paused or seeking (zero React style conflict)
  useEffect(() => {
    if (isPlaying) return;
    rafLastMappedTimeRef.current = currentTime;
    rafActiveClipIdxRef.current = 0;
    if (playheadRef.current) {
      const currentX = currentTime * pps;
      playheadRef.current.style.transform = `translate3d(${currentX}px, 0, 0)`;
    }
    if (playheadTimeTextRef.current) {
      playheadTimeTextRef.current.textContent = formatMinSec(currentTime);
    }
  }, [currentTime, pps, isPlaying]);

  // B. Seek = visible immediately: any action that moves the playhead (ruler click, clip select,
  // scrub drop, search jump, player scrub) reveals the playhead instantly without smooth-scroll lag.
  useLayoutEffect(() => {
    const justFinishedScrub = prevIsScrubbingRef.current && !isScrubbing;
    prevIsScrubbingRef.current = isScrubbing;

    if (isPlaying || !timelineBodyRef.current || isScrubbing || dragState) return;
    if (pendingRestoreViewRef.current && pendingRestoreViewRef.current.key === episodeViewKey) return;

    const timeMoved = Math.abs(currentTime - prevRevealedTimeRef.current) > 0.005;
    if (!timeMoved && !justFinishedScrub) return;
    prevRevealedTimeRef.current = currentTime;

    const container = timelineBodyRef.current;
    const clientWidth = container.clientWidth;
    if (clientWidth <= 0) return;

    const targetScroll = computeScrollToRevealPlayhead({
      playheadSec: currentTime,
      pps,
      currentScrollLeft: container.scrollLeft,
      clientWidth,
      trackHeaderWidth: TRACK_HEADER_WIDTH,
      autoCenter,
      forceCenter: false,
    });

    if (Math.abs(container.scrollLeft - targetScroll) > 1) {
      container.scrollLeft = targetScroll;
      flushEpisodeViewState({ playheadSec: currentTime, scrollLeft: targetScroll, zoom: zoomRef.current });
    }
  }, [currentTime, isPlaying, autoCenter, pps, isScrubbing, dragState, episodeViewKey, flushEpisodeViewState]);

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
        canSplit={canSplit}
        onSplitClip={(time) => {
          const activeSplitTarget = selectedClipKind === 'video'
            ? activeClipId
            : (selectedClipKind === 'voice' || selectedClipKind === 'subtitle' ? selectedSegKey : null);
          if (onSplitClip) onSplitClip(time, activeSplitTarget);
        }}
        onInsertVideoAd={onInsertVideoAd}
        currentTime={currentTime}
        isPlaying={isPlaying}
        playheadTimeRef={playheadTimeRef}
        subscribePlayhead={subscribePlayhead}
        duration={totalDuration}
        handleDeleteSelected={handleDeleteSelected}
        canDelete={canDelete}
        canDeleteSubtitle={canDeleteSubtitle}
        canDeleteVideo={canDeleteVideo}
        onAutoSplitVideo={onAutoSplitVideo}
        videoClips={videoClips}
        scriptSegments={scriptSegments}
        onBridgeGaps={onBridgeGaps}
        onAutoAlignNoOverlap={onAutoAlignNoOverlap}
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
          soloTracks={soloTracks}
          setSoloTracks={setSoloTracks}
          audioGenerated={audioGenerated}
          videoRowCount={videoRowCount}
          voiceRowCount={voiceRowCount}
          subRowCount={subRowCount}
          showSubtitles={showSubtitles}
          selectedVideo={selectedVideo}
          scriptSegments={scriptSegments}
          videoClips={videoClips}
          voiceSettings={voiceSettings}
          onUpdateVoiceSettings={onUpdateVoiceSettings}
        />

        <TimelineTracksCanvas
          scrollContainerRef={timelineBodyRef}
          totalWidth={totalWidth}
          pps={pps}
          markers={markers}
          snapLineTime={snapLineTime}
          snapLineRef={snapLineRef}
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
          mutedTracks={mutedTracks}
          dragState={dragState}
          activeClipId={activeClipId}
          handleVideoMouseDown={handleVideoMouseDown}
          onSelectClip={onSelectClip}
          videoThumbnails={videoThumbnails}
          audioGenerated={audioGenerated}
          showSubtitles={showSubtitles}
          scriptSegments={scriptSegments}
          framingKeyframes={framingKeyframes}
          selectedSegmentId={selectedSegmentId}
          selectedClipKind={selectedClipKind}
          onSelectClipKind={onSelectClipKind}
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
          bgmAudioUrl={bgmAudioUrl}
          isDemucsDone={isDemucsDone}
        />
      </div>
    </div>
  );
}

export default React.memo(TimelineEditor, (prev, next) => {
  // During active playback, skip heavy React tree re-renders caused solely by 5Hz currentTime ticks,
  // since subscribePlayhead already drives playhead position at silky-smooth 60fps via GPU transforms.
  if (next.isPlaying && prev.isPlaying && prev.currentTime !== next.currentTime) {
    return (
      prev.videoClips === next.videoClips &&
      prev.scriptSegments === next.scriptSegments &&
      prev.activeClipId === next.activeClipId &&
      prev.selectedSegmentId === next.selectedSegmentId &&
      prev.selectedClipKind === next.selectedClipKind &&
      prev.activeTab === next.activeTab &&
      prev.duration === next.duration &&
      prev.canUndo === next.canUndo &&
      prev.canRedo === next.canRedo &&
      prev.isGeneratingAudio === next.isGeneratingAudio &&
      prev.voiceSettings === next.voiceSettings &&
      prev.speakerRegistry === next.speakerRegistry &&
      prev.timelineFocusRequest === next.timelineFocusRequest &&
      prev.framingKeyframes === next.framingKeyframes &&
      prev.bgmAudioUrl === next.bgmAudioUrl &&
      prev.isDemucsDone === next.isDemucsDone
    );
  }
  return false;
});
