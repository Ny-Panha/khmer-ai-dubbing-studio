import React from 'react';
import { Upload, Volume2, VolumeX } from 'lucide-react';
import { formatTimecode, parseTimeToSeconds, formatMinSec } from '../../utils/formatTime';
import { findAssociatedSegmentIndices } from '../../utils/timelineUtils';

function TimelineTracksCanvas({
  scrollContainerRef = null,
  totalWidth,
  pps,
  markers,
  snapLineTime,
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
  dragState,
  activeClipId,
  handleVideoMouseDown,
  onSelectClip,
  videoThumbnails,
  audioGenerated,
  scriptSegments,
  selectedSegmentId,
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
}) {
  const rootRef = React.useRef(null);
  const [internalDragOverTrack, setInternalDragOverTrack] = React.useState(null);
  const dragOverTrack = externalDragOverTrack !== null ? externalDragOverTrack : internalDragOverTrack;
  const setDragOverTrack = externalSetDragOverTrack || setInternalDragOverTrack;

  // Timeline Windowing: compute visible time range based on scrollLeft + container width
  const [visibleRange, setVisibleRange] = React.useState(() => ({
    start: 0,
    end: 180,
  }));

  React.useEffect(() => {
    const container = scrollContainerRef?.current || rootRef.current?.parentElement;
    if (!container) return;

    let rafId = null;
    const computeVisibleRange = () => {
      const scrollLeft = container.scrollLeft || 0;
      const clientWidth = container.clientWidth || 1200;
      const safePps = pps > 0 ? pps : 45;

      // Buffer ~3 seconds or 15% of viewport width
      const bufferSec = Math.max(3.0, (clientWidth * 0.15) / safePps);
      const start = Math.max(0, (scrollLeft / safePps) - bufferSec);
      const end = ((scrollLeft + clientWidth) / safePps) + bufferSec;

      setVisibleRange((prev) => {
        if (Math.abs(prev.start - start) < 0.5 && Math.abs(prev.end - end) < 0.5) {
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

  // Smart Multi-Track Layer Allocation (Clean Dual-Track Layout)
  // Non-overlapping segments sit on Row 0 (Single straight line), overlapping dialogue flows cleanly into Row 1
  const internalSegmentRows = React.useMemo(() => {
    if (!scriptSegments || scriptSegments.length === 0) return [];
    const endTimes = [0, 0];

    return scriptSegments.map((seg, idx) => {
      const rawStart = (typeof seg.audioStartSec === 'number' && !isNaN(seg.audioStartSec))
        ? seg.audioStartSec 
        : parseTimeToSeconds(seg.start, idx * 4);
      const rawAudioDur = (typeof seg.finalAudioDuration === 'number' && seg.finalAudioDuration > 0)
        ? seg.finalAudioDuration
        : ((typeof seg.audioDuration === 'number' && seg.audioDuration > 0)
          ? seg.audioDuration
          : ((typeof seg.audioDurationSec === 'number' && !isNaN(seg.audioDurationSec))
            ? seg.audioDurationSec
            : 2.5));
      const rawEnd = (seg.userTrimmed && typeof seg.audioEndSec === 'number')
        ? seg.audioEndSec
        : Math.max((typeof seg.audioEndSec === 'number' && !isNaN(seg.audioEndSec) ? seg.audioEndSec : 0), rawStart + rawAudioDur);

      if (typeof seg.trackRow === 'number' && seg.userShifted) {
        const r = Math.min(1, Math.max(0, seg.trackRow));
        endTimes[r] = Math.max(endTimes[r] || 0, rawEnd);
        return r;
      }

      if (rawStart >= (endTimes[0] || 0) - 0.05) {
        endTimes[0] = rawEnd;
        return 0;
      }
      if (rawStart >= (endTimes[1] || 0) - 0.05) {
        endTimes[1] = rawEnd;
        return 1;
      }
      const r = (endTimes[0] || 0) <= (endTimes[1] || 0) ? 0 : 1;
      endTimes[r] = Math.max(endTimes[r] || 0, rawEnd);
      return r;
    });
  }, [scriptSegments]);

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

  const renderVoiceSegment = (seg, idx) => {
    // Only render voice clip block if this segment actually has generated audio
    const hasAudio = Boolean(seg.audioUrl || seg.audioPath || seg.audioFile);
    if (!hasAudio) return null;

    const isDragging = (dragState?.itemType === 'audio' || dragState?.itemType === 'subtitle') && dragState?.index === idx;
    const rawStart = (typeof seg.audioStartSec === 'number' && !isNaN(seg.audioStartSec))
      ? seg.audioStartSec 
      : parseTimeToSeconds(seg.start, idx * 4);
    const rawAudioDur = (typeof seg.finalAudioDuration === 'number' && seg.finalAudioDuration > 0)
      ? seg.finalAudioDuration
      : ((typeof seg.audioDuration === 'number' && seg.audioDuration > 0)
        ? seg.audioDuration
        : ((typeof seg.audioDurationSec === 'number' && !isNaN(seg.audioDurationSec))
          ? seg.audioDurationSec
          : 2.5));
    const rawEnd = (seg.userTrimmed && typeof seg.audioEndSec === 'number')
      ? seg.audioEndSec
      : Math.max((typeof seg.audioEndSec === 'number' && !isNaN(seg.audioEndSec) ? seg.audioEndSec : 0), rawStart + rawAudioDur);

    const isClipMovingAssociated = dragState?.itemType === 'video' && dragState?.mode === 'move' && associatedClipSegIndices.has(idx);
    const clipMoveDelta = isClipMovingAssociated ? (dragState.currentStart - dragState.origStart) : 0;

    const startSec = isDragging 
      ? dragState.currentStart 
      : (isClipMovingAssociated ? Math.max(0, rawStart + clipMoveDelta) : rawStart);
    const endSec = isDragging 
      ? dragState.currentEnd 
      : (isClipMovingAssociated ? Math.max(0.3, rawEnd + clipMoveDelta) : rawEnd);

    const audioLeft = startSec * pps;
    const audioWidth = Math.max(50, (endSec - startSec) * pps);
    const segKey = seg._uid || (seg.id !== undefined && seg.id !== null ? seg.id : idx);
    const isAssociatedWithClip = Boolean(
      activeClipId && videoClips?.some((c) => c.id === activeClipId && (c.segmentId === seg.id || c.segmentIndex === (idx + 1)))
    );
    const isSelected = Boolean(
      isAssociatedWithClip ||
      (selectedSegmentId !== null && selectedSegmentId !== undefined && (
        (seg._uid && String(selectedSegmentId) === String(seg._uid)) || (seg.id !== undefined && seg.id !== null ? String(selectedSegmentId) === String(seg.id) : Number(selectedSegmentId) === idx)
      )) ||
      (selectedAudioId !== null && selectedAudioId !== undefined && (
        (seg._uid && String(selectedAudioId) === String(seg._uid)) || (seg.id !== undefined && seg.id !== null ? String(selectedAudioId) === String(seg.id) : Number(selectedAudioId) === idx)
      ))
    );

    const speakerName = (seg.speaker || seg.speakerName || '').trim();
    const explicitGender = String(seg.speakerGender || seg.gender || '').toUpperCase().trim();
    const isExplicitFemale = explicitGender === 'FEMALE' || explicitGender === 'GIRL' || explicitGender === 'WOMAN';
    const isExplicitMale = explicitGender === 'MALE' || explicitGender === 'BOY' || explicitGender === 'MAN';

    const activeVoiceId = seg.voiceId || 
      (speakerRegistry && (speakerRegistry[seg.speakerId]?.voiceId || speakerRegistry[speakerName]?.voiceId)) || 
      (isExplicitFemale ? 'km-KH-SreymomNeural' : (isExplicitMale ? 'km-KH-PisethNeural' : (voiceSettings?.voiceId || 'km-KH-PisethNeural')));

    const isPiseth = activeVoiceId.includes('Piseth');
    const isSreymom = activeVoiceId.includes('Sreymom') || activeVoiceId === 'km';
    const isFemale = isExplicitFemale || (isSreymom && !isExplicitMale);
    const isMale = !isFemale;
    const avatar = isFemale ? '👩' : '👨';
    const isMuted = Boolean(seg.muted || seg.isMuted);
    const isThought = seg.deliveryType === 'inner_thought';

    return (
      <React.Fragment key={`voice-wrap-${seg._uid || `${seg.id ?? idx}-${idx}`}`}>
        {isDragging && (
          <div 
            className="video-clip-ghost"
            style={{
              left: dragState.origStart * pps,
              width: Math.max(50, (dragState.origEnd - dragState.origStart) * pps),
              borderColor: isFemale ? '#f472b6' : '#0284c7',
              background: isFemale ? 'rgba(244, 114, 182, 0.12)' : 'rgba(2, 132, 199, 0.12)',
            }}
          />
        )}

        <div
          draggable={false}
          onMouseDown={(e) => handleAudioMouseDown(e, seg, idx, 'move')}
          onClick={(e) => {
            e.stopPropagation();
            setSelectedAudioId(segKey);
            setSelectedSubId(segKey);
            if (onSelectSegment) onSelectSegment(segKey);
            if (onSelectClip) {
              const matchClip = videoClips?.find(c => c.segmentId === seg.id || c.segmentIndex === (idx + 1));
              onSelectClip(matchClip ? matchClip.id : null);
            }
            onSeek(startSec);
          }}
          className={`voice-segment-block ${isFemale ? 'female-voice' : 'male-voice'} ${isSelected ? 'selected' : ''} ${isMuted ? 'is-muted-clip' : ''}`}
          style={{
            cursor: isDragging ? 'grabbing' : 'grab',
            left: audioLeft,
            width: audioWidth,
            zIndex: isDragging ? 100 : (isSelected ? 20 : 5),
            top: '3px',
            height: '38px',
            transform: isDragging && dragState?.mode === 'move' && typeof dragState?.currentY === 'number' ? `translateY(${dragState.currentY}px)` : undefined,
            transition: isDragging ? 'none' : undefined,
            pointerEvents: isDragging && dragState?.mode === 'move' ? 'none' : 'auto',
            ...(isMuted ? {
              opacity: 0.55,
              filter: 'grayscale(0.65)',
              borderStyle: 'dashed',
              borderColor: '#f87171',
              background: 'linear-gradient(180deg, #241419 0%, #170d10 100%)',
            } : (isThought ? {
              borderStyle: 'dashed',
              borderWidth: '1.5px',
              borderColor: isSelected ? '#ffffff' : (isFemale ? '#e879f9' : '#c084fc'),
              background: isSelected 
                ? (isFemale ? 'linear-gradient(180deg, #581c87 0%, #3b0764 100%)' : 'linear-gradient(180deg, #4c1d95 0%, #2e1065 100%)')
                : (isFemale ? 'linear-gradient(180deg, #3b0764 0%, #1e0b2b 100%)' : 'linear-gradient(180deg, #2e1065 0%, #1e1b4b 100%)'),
              boxShadow: isSelected ? '0 0 10px rgba(168, 85, 247, 0.45)' : 'none',
            } : (isFemale ? {
              background: isSelected 
                ? 'linear-gradient(180deg, #4c1834 0%, #290d1d 100%)' 
                : 'linear-gradient(180deg, #381427 0%, #1f0b17 100%)',
              borderColor: isSelected ? '#ffffff' : '#f472b6',
            } : {}))),
          }}
          title={`[${formatMinSec(startSec)} - ${formatMinSec(endSec)}] #${idx + 1} ${speakerName || 'អ្នកនិយាយ'} • ${isFemale ? 'ស្រី (Sreymom)' : 'ប្រុស (Piseth)'} (${(endSec - startSec).toFixed(1)}s)${isMuted ? ' [🔇 MUTED]' : ''}\n"${seg.khmer || ''}"\nDrag to move, click 🔇 to mute/unmute`}
        >
          {/* Left Trim Handle */}
          {isSelected && (
            <div 
              className="clip-trim-handle left"
              draggable={false}
              onMouseDown={(e) => {
                e.stopPropagation();
                handleAudioMouseDown(e, seg, idx, 'trim-left');
              }}
              onDragStart={(e) => {
                e.stopPropagation();
                e.preventDefault();
              }}
              title="Drag to trim start"
            >
              <div className="trim-handle-grip" />
            </div>
          )}

          <div className="voice-seg-content">
            <span 
              className="voice-seg-avatar" 
              style={{ 
                background: isFemale ? 'rgba(244, 114, 182, 0.2)' : 'rgba(56, 189, 248, 0.18)', 
                padding: '1px 3px', 
                borderRadius: 3 
              }} 
              title={isFemale ? 'តួស្រី (Sreymom)' : 'តួប្រុស (Piseth)'}
            >
              {avatar}
            </span>

            {isThought && (
              <span 
                style={{ 
                  fontSize: '0.72rem', 
                  marginRight: 2,
                  display: 'inline-flex',
                  alignItems: 'center',
                }} 
                title="💭 និយាយក្នុងចិត្ត (Inner Thought Reverb)"
              >
                💭
              </span>
            )}

            {/* Mini Segment Mute Button */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (onToggleMuteSegment) onToggleMuteSegment(segKey);
              }}
              title={isMuted ? "បានបិទសំឡេង (Muted) - ចុចដើម្បីបើកសំឡេងវិញ" : "ចុចដើម្បីបិទសំឡេងឃ្លានេះ (Mute Clip)"}
              style={{
                background: isMuted ? 'rgba(239, 68, 68, 0.35)' : 'rgba(255, 255, 255, 0.08)',
                border: `1px solid ${isMuted ? 'rgba(239, 68, 68, 0.7)' : 'rgba(255, 255, 255, 0.15)'}`,
                borderRadius: 3,
                padding: '1px 3px',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginLeft: 1,
                marginRight: 2,
                flexShrink: 0,
                transition: 'all 0.15s ease',
              }}
            >
              {isMuted ? <VolumeX size={10} color="#f87171" /> : <Volume2 size={10} color={isFemale ? '#f472b6' : '#38bdf8'} />}
            </button>

            <span className="voice-seg-title" style={{ 
              color: isMuted ? '#94a3b8' : (isFemale ? '#fbcfe8' : '#bae6fd'),
              textDecoration: isMuted ? 'line-through' : 'none',
            }}>
              #{idx + 1} {speakerName || 'អ្នកនិយាយ'}
            </span>
            {isMuted ? (
              <span style={{
                fontSize: '0.58rem',
                fontWeight: 800,
                padding: '1px 4px',
                borderRadius: 3,
                background: 'rgba(239, 68, 68, 0.25)',
                color: '#f87171',
                border: '1px solid rgba(239, 68, 68, 0.5)',
                lineHeight: '13px',
                flexShrink: 0,
              }}>
                MUTED
              </span>
            ) : (
              <span 
                style={{
                  fontSize: '0.62rem',
                  fontWeight: 700,
                  padding: '1px 4px',
                  borderRadius: 3,
                  background: isFemale ? 'rgba(244, 114, 182, 0.25)' : 'rgba(56, 189, 248, 0.22)',
                  color: isFemale ? '#f472b6' : '#38bdf8',
                  border: `1px solid ${isFemale ? 'rgba(244, 114, 182, 0.45)' : 'rgba(56, 189, 248, 0.4)'}`,
                  lineHeight: '13px',
                  flexShrink: 0,
                }}
              >
                {isFemale ? 'ស្រី' : 'ប្រុស'}
              </span>
            )}
            <span style={{ fontSize: '0.6rem', color: '#94a3b8', fontFamily: 'monospace', flexShrink: 0 }}>
              ({(endSec - startSec).toFixed(1)}s)
            </span>

            {audioWidth > 70 && (
              <div className="voice-waveform-mini">
                {Array.from({ length: Math.min(22, Math.max(5, Math.floor((audioWidth - 60) / 10))) }).map((_, wIdx) => {
                  const pattern = [35, 75, 95, 45, 80, 100, 60, 40, 85, 90, 50, 75, 30, 65, 85, 100, 55, 70, 40, 90];
                  const hPercent = pattern[wIdx % pattern.length];
                  return (
                    <span
                      key={wIdx}
                      style={{
                        display: 'inline-block',
                        width: 2,
                        height: `${hPercent}%`,
                        background: isFemale ? 'rgba(244, 114, 182, 0.7)' : 'rgba(56, 189, 248, 0.7)',
                        borderRadius: 1,
                        margin: '0 1px',
                        flexShrink: 0,
                      }}
                    />
                  );
                })}
              </div>
            )}
          </div>

          {/* Right Trim Handle */}
          {isSelected && (
            <div 
              className="clip-trim-handle right"
              draggable={false}
              onMouseDown={(e) => {
                e.stopPropagation();
                handleAudioMouseDown(e, seg, idx, 'trim-right');
              }}
              onDragStart={(e) => {
                e.stopPropagation();
                e.preventDefault();
              }}
              title="Drag to trim end"
            >
              <div className="trim-handle-grip" />
            </div>
          )}

          {/* Live Drag Tooltip */}
          {isDragging && (
            <div className="timeline-drag-tooltip">
              {avatar} {speakerName || 'Voice'}: {formatTimecode(startSec)} - {formatTimecode(endSec)} ({(endSec - startSec).toFixed(1)}s)
            </div>
          )}
        </div>
      </React.Fragment>
    );
  };

  const renderSubSegment = (seg, idx) => {
    const isDragging = (dragState?.itemType === 'audio' || dragState?.itemType === 'subtitle') && dragState?.index === idx;
    const rawStart = (typeof seg.startSec === 'number' && !isNaN(seg.startSec))
      ? seg.startSec
      : ((typeof seg.audioStartSec === 'number' && !isNaN(seg.audioStartSec))
        ? seg.audioStartSec
        : parseTimeToSeconds(seg.start, idx * 4));
    const rawEnd = (typeof seg.endSec === 'number' && !isNaN(seg.endSec))
      ? seg.endSec
      : ((typeof seg.audioEndSec === 'number' && !isNaN(seg.audioEndSec))
        ? seg.audioEndSec
        : parseTimeToSeconds(seg.end, rawStart + (seg.audioDurationSec || 3.0)));

    const isClipMovingAssociated = dragState?.itemType === 'video' && dragState?.mode === 'move' && associatedClipSegIndices.has(idx);
    const clipMoveDelta = isClipMovingAssociated ? (dragState.currentStart - dragState.origStart) : 0;

    const startSec = isDragging 
      ? dragState.currentStart 
      : (isClipMovingAssociated ? Math.max(0, rawStart + clipMoveDelta) : rawStart);
    const endSec = isDragging 
      ? dragState.currentEnd 
      : (isClipMovingAssociated ? Math.max(0.3, rawEnd + clipMoveDelta) : rawEnd);

    const subLeft = startSec * pps;
    const subWidth = Math.max(35, (endSec - startSec) * pps);
    const subKey = seg._uid || (seg.id !== undefined && seg.id !== null ? seg.id : idx);
    const isAssociatedWithClip = Boolean(
      activeClipId && videoClips?.some((c) => c.id === activeClipId && (c.segmentId === seg.id || c.segmentIndex === (idx + 1)))
    );
    const isSelected = Boolean(
      isAssociatedWithClip ||
      (selectedSegmentId !== null && selectedSegmentId !== undefined && (
        (seg._uid && String(selectedSegmentId) === String(seg._uid)) || (seg.id !== undefined && seg.id !== null ? String(selectedSegmentId) === String(seg.id) : Number(selectedSegmentId) === idx)
      )) ||
      (selectedSubId !== null && selectedSubId !== undefined && (
        (seg._uid && String(selectedSubId) === String(seg._uid)) || (seg.id !== undefined && seg.id !== null ? String(selectedSubId) === String(seg.id) : Number(selectedSubId) === idx)
      ))
    );

    return (
      <React.Fragment key={`sub-wrap-${seg._uid || `${seg.id ?? idx}-${idx}`}`}>
        {isDragging && (
          <div 
            className="video-clip-ghost"
            style={{
              left: dragState.origStart * pps,
              width: Math.max(35, (dragState.origEnd - dragState.origStart) * pps),
              borderColor: '#9333ea',
              background: 'rgba(147, 51, 234, 0.12)',
            }}
          />
        )}

        <div
          draggable={false}
          onMouseDown={(e) => handleSubMouseDown(e, seg, idx, 'move')}
          onClick={(e) => {
            e.stopPropagation();
            setSelectedSubId(subKey);
            setSelectedAudioId(subKey);
            if (onSelectSegment) onSelectSegment(subKey);
            if (onSelectClip) {
              const matchClip = videoClips?.find(c => c.segmentId === seg.id || c.segmentIndex === (idx + 1));
              onSelectClip(matchClip ? matchClip.id : null);
            }
            onSeek(startSec);
          }}
          className={`subtitle-segment-block ${isSelected ? 'selected' : ''}`}
          style={{
            cursor: isDragging ? 'grabbing' : 'grab',
            left: subLeft,
            width: subWidth,
            zIndex: isDragging ? 100 : (isSelected ? 20 : 5),
            top: '3px',
            height: '36px',
            transform: isDragging && dragState?.mode === 'move' && typeof dragState?.currentY === 'number' ? `translateY(${dragState.currentY}px)` : undefined,
            transition: isDragging ? 'none' : undefined,
            pointerEvents: isDragging && dragState?.mode === 'move' ? 'none' : 'auto',
          }}
          title={`[${formatMinSec(startSec)} - ${formatMinSec(endSec)}] #${idx + 1} ${seg.khmer}\nClick to inspect & change voice, handles to trim`}
        >
          {/* Left Trim Handle */}
          {isSelected && (
            <div 
              className="clip-trim-handle left"
              draggable={false}
              onMouseDown={(e) => {
                e.stopPropagation();
                handleSubMouseDown(e, seg, idx, 'trim-left');
              }}
              onDragStart={(e) => {
                e.stopPropagation();
                e.preventDefault();
              }}
              title="Drag to trim start time"
            >
              <div className="trim-handle-grip" />
            </div>
          )}

          <span className="sub-seg-text" style={{ padding: isSelected ? '0 8px' : '0' }}>
            #{idx + 1} {seg.khmer}
          </span>

          {/* Right Trim Handle */}
          {isSelected && (
            <div 
              className="clip-trim-handle right"
              draggable={false}
              onMouseDown={(e) => {
                e.stopPropagation();
                handleSubMouseDown(e, seg, idx, 'trim-right');
              }}
              onDragStart={(e) => {
                e.stopPropagation();
                e.preventDefault();
              }}
              title="Drag to trim end time"
            >
              <div className="trim-handle-grip" />
            </div>
          )}

          {/* Live Drag Tooltip */}
          {isDragging && (
            <div className="timeline-drag-tooltip">
              #{idx + 1}: {formatTimecode(startSec)} - {formatTimecode(endSec)} ({(endSec - startSec).toFixed(1)}s)
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

    const clipWidth = Math.max(30, (endSec - startSec) * pps);
    const clipLeft = startSec * pps;
    const isAssociatedWithSeg = selectedSegmentId !== null && (clip.segmentId === selectedSegmentId || clip.segmentIndex === selectedSegmentId);
    const isSelected = activeClipId === clip.id || isAssociatedWithSeg;
    const isSubOrVoice = trackKey.startsWith('subs') || trackKey.startsWith('voice');

    return (
      <React.Fragment key={clip.id}>
        {isDragging && dragState?.mode === 'move' && (
          <div 
            className="video-clip-ghost"
            style={{
              left: dragState.origStart * pps,
              width: Math.max(30, (dragState.origEnd - dragState.origStart) * pps),
            }}
          />
        )}

        <div
          draggable={false}
          onMouseDown={(e) => handleVideoMouseDown(e, clip, idx, 'move')}
          onClick={(e) => {
            e.stopPropagation();
            if (onSelectClip) onSelectClip(clip.id);
            const targetSeg = scriptSegments?.find(s => s.id === clip.segmentId || s.id === clip.segmentIndex || (clip.segmentIndex && s.id === clip.segmentIndex));
            if (targetSeg) {
              if (setSelectedAudioId) setSelectedAudioId(targetSeg.id);
              if (setSelectedSubId) setSelectedSubId(targetSeg.id);
              if (onSelectSegment) onSelectSegment(targetSeg.id);
            } else {
              if (setSelectedAudioId) setSelectedAudioId(null);
              if (setSelectedSubId) setSelectedSubId(null);
              if (onSelectSegment) onSelectSegment(null);
            }
          }}
          className={`video-clip-block ${clip.isDialogue ? 'dialogue-slice' : (clip.isDialogue === false ? 'gap-slice' : '')} ${clip.isMuted ? 'is-muted-clip' : ''} ${isSelected ? 'selected' : ''} ${isDragging ? 'is-dragging' : ''} ${isSubOrVoice ? 'is-cross-track' : ''}`}
          style={{
            cursor: isDragging ? 'grabbing' : 'grab',
            left: clipLeft,
            width: clipWidth,
            zIndex: isDragging ? 100 : (isSelected ? 10 : 2),
            transform: isDragging && dragState?.currentY ? `translateY(${dragState.currentY}px)` : undefined,
            transition: isDragging ? 'none' : undefined,
            pointerEvents: isDragging ? 'none' : 'auto',
            ...(isSubOrVoice ? {
              height: '36px',
              top: '3px',
              background: 'linear-gradient(180deg, #1e1b4b 0%, #0f172a 100%)',
              borderColor: isSelected ? '#ffffff' : '#818cf8',
            } : {})
          }}
          title={`${clip.name} [${startSec.toFixed(1)}s - ${endSec.toFixed(1)}s] • Drag to move (horizontally & vertically) or handles to trim`}
        >
          {/* Left Trim Handle */}
          {isSelected && (
            <div 
              className="clip-trim-handle left"
              draggable={false}
              onMouseDown={(e) => {
                e.stopPropagation();
                handleVideoMouseDown(e, clip, idx, 'trim-left');
              }}
              onDragStart={(e) => {
                e.stopPropagation();
                e.preventDefault();
              }}
              title="Drag to trim start"
            >
              <div className="trim-handle-grip" />
            </div>
          )}

          {(() => {
            const cleanName = (clip.name || 'Video Clip')
              .replace(/\s*\(\d+(\.\d+)?s\)/g, '')
              .trim();
            const durText = `${(endSec - startSec).toFixed(1)}s`;
            const isShort = clipWidth < 75;
            const frameCount = Math.max(1, Math.min(80, Math.ceil(clipWidth / 56)));

            return (
              <>
                <div className="clip-header" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <button
                    type="button"
                    className="video-clip-mute-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onToggleMuteVideoClip) onToggleMuteVideoClip(clip.id);
                    }}
                    title={clip.isMuted ? "បានបិទសំឡេងដើម (Muted) - ចុចដើម្បីបើកវិញ" : "ចុចដើម្បីបិទសំឡេងដើមនៃ Clip នេះ (Mute Video Audio)"}
                    style={{
                      background: clip.isMuted ? 'rgba(239, 68, 68, 0.35)' : 'rgba(0, 0, 0, 0.45)',
                      border: clip.isMuted ? '1px solid #ef4444' : '1px solid rgba(255, 255, 255, 0.25)',
                      borderRadius: '3px',
                      padding: '1px 3px',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      lineHeight: 1,
                      flexShrink: 0,
                      transition: 'all 0.15s ease',
                      zIndex: 5,
                    }}
                  >
                    {clip.isMuted ? <VolumeX size={10} color="#f87171" /> : <Volume2 size={10} color="#a5f3fc" />}
                  </button>

                  <span className="clip-name" title={`${cleanName} (${durText})`} style={{ textDecoration: clip.isMuted ? 'line-through' : 'none', opacity: clip.isMuted ? 0.75 : 1 }}>
                    {cleanName}
                  </span>
                  {!isShort && (
                    <span className="clip-timecode" style={{ opacity: clip.isMuted ? 0.6 : 1 }}>
                      {formatTimecode(endSec - startSec)}
                    </span>
                  )}
                </div>

                {!isSubOrVoice ? (
                  <div className="clip-filmstrip-row" style={{ opacity: clip.isMuted ? 0.5 : 1 }}>
                    {videoThumbnails && videoThumbnails.length > 0 ? (
                      (() => {
                        const getThumbUrl = (item) => (item ? (typeof item === 'string' ? item : item.url) : null);
                        const clipSrcStart = typeof clip.sourceStart === 'number' ? clip.sourceStart : startSec;
                        const clipSrcEnd = typeof clip.sourceEnd === 'number' ? clip.sourceEnd : endSec;
                        const clipDur = Math.max(0.2, clipSrcEnd - clipSrcStart);
                        const safeTotalDur = Math.max(1, totalDuration || 30);
                        const numCells = frameCount;
                        return Array.from({ length: numCells }).map((_, fIdx) => {
                          const cellTime = clipSrcStart + (numCells > 1 ? (fIdx / (numCells - 1)) * clipDur : 0);
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
                ) : (
                  <div className="clip-filmstrip-row" style={{ height: 16 }}>
                    {videoThumbnails && videoThumbnails.length > 0 && (
                      (() => {
                        const getThumbUrl = (item) => (item ? (typeof item === 'string' ? item : item.url) : null);
                        const clipSrcStart = typeof clip.sourceStart === 'number' ? clip.sourceStart : startSec;
                        const clipSrcEnd = typeof clip.sourceEnd === 'number' ? clip.sourceEnd : endSec;
                        const clipDur = Math.max(0.2, clipSrcEnd - clipSrcStart);
                        const safeTotalDur = Math.max(1, totalDuration || 30);
                        const numCells = Math.min(40, frameCount);
                        return Array.from({ length: numCells }).map((_, fIdx) => {
                          const cellTime = clipSrcStart + (numCells > 1 ? (fIdx / (numCells - 1)) * clipDur : 0);
                          const timeRatio = Math.max(0, Math.min(0.999, cellTime / safeTotalDur));
                          const thumbIdx = Math.min(videoThumbnails.length - 1, Math.floor(timeRatio * videoThumbnails.length));
                          const thumbSrc = getThumbUrl(videoThumbnails[thumbIdx]);
                          return (
                            <div key={fIdx} className="filmstrip-thumb-cell" style={{ height: 16 }}>
                              {thumbSrc && <img src={thumbSrc} alt="frame" className="filmstrip-img" style={{ height: 16 }} />}
                            </div>
                          );
                        });
                      })()
                    )}
                  </div>
                )}

                <div className="clip-audio-wave-bottom" style={{ opacity: clip.isMuted ? 0.15 : 0.7 }}>
                  <div className="clip-wave-dots" />
                </div>

                {isSelected && clipWidth > 130 && !isSubOrVoice && (
                  <div className="clip-footer">
                    <span>{startSec.toFixed(1)}s - {endSec.toFixed(1)}s</span>
                    {typeof clip.sourceStart === 'number' && Math.abs(clip.sourceStart - startSec) > 0.05 && (
                      <span className="clip-src-badge">[Src: {clip.sourceStart.toFixed(1)}s]</span>
                    )}
                  </div>
                )}
              </>
            );
          })()}

          {/* Right Trim Handle */}
          {isSelected && (
            <div 
              className="clip-trim-handle right"
              draggable={false}
              onMouseDown={(e) => {
                e.stopPropagation();
                handleVideoMouseDown(e, clip, idx, 'trim-right');
              }}
              onDragStart={(e) => {
                e.stopPropagation();
                e.preventDefault();
              }}
              title="Drag to trim end"
            >
              <div className="trim-handle-grip" />
            </div>
          )}

          {/* Live Drag Tooltip */}
          {isDragging && (
            <div className="timeline-drag-tooltip">
              {formatTimecode(startSec)} - {formatTimecode(endSec)} ({(endSec - startSec).toFixed(1)}s)
            </div>
          )}
        </div>
      </React.Fragment>
    );
  };

  return (
    <div ref={rootRef} className="tracks-content" style={{ width: totalWidth, minWidth: totalWidth, position: 'relative' }}>
      {/* Ruler Line */}
      <div className="timeline-ruler">
        {(markers || [])
          .filter((sec) => sec >= (visibleRange.start - 5) && sec <= (visibleRange.end + 5))
          .map((sec) => (
            <div
              key={sec}
              className="ruler-marker"
              style={{ left: sec * pps }}
            >
              <div className="ruler-tick" />
              <span className="ruler-time">{formatMinSec(sec)}</span>
            </div>
          ))}
      </div>

      {/* CapCut Magnetic Snapping Guide Indicator Line */}
      {snapLineTime !== null && (
        <div 
          className="timeline-snap-line"
          style={{ left: snapLineTime * pps }}
        />
      )}

      {/* Red Playhead Line with timecode badge */}
      {selectedVideo && totalDuration > 0 && (
        <div 
          ref={playheadRef}
          className="timeline-playhead"
          style={{ 
            left: 0,
            willChange: 'transform'
          }}
        >
          <div 
            className="playhead-handle" 
            title="Drag to scrub playhead"
            onMouseDown={(e) => {
              e.stopPropagation();
              setIsScrubbing(true);
              handleScrub(e);
            }}
          >
            <span ref={playheadTimeTextRef}>{formatMinSec(currentTime)}</span>
          </div>
          <div className="playhead-line" />
        </div>
      )}

      {/* Empty State when no video is uploaded */}
      {!selectedVideo ? (
        <div className="timeline-empty-state">
          <Upload size={16} color="var(--accent-cyan)" />
          <span>Import a video file to activate multi-track timeline and clip editing</span>
        </div>
      ) : (
        <>
          {/* Multi-Track Video Lanes (CapCut Desktop Video Rows) */}
          {Array.from({ length: Math.max(1, videoRowCount) }).map((_, rIdx) => {
            const trackKey = `video_${rIdx}`;
            const isHidden = Boolean(hiddenTracks[trackKey] || (rIdx === 0 && hiddenTracks.video));
            const isDragOver = dragOverTrack === trackKey || (rIdx === 0 && dragOverTrack === 'video');

            return (
              <div 
                key={`video-lane-${rIdx}`}
                className={`track-lane video-lane ${rIdx > 0 ? 'video-lane-sub' : ''} ${isDragOver ? 'is-drag-over' : ''}`}
                data-track-type="video"
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
                  width: totalWidth,
                  minWidth: totalWidth,
                  opacity: isHidden ? 0.2 : 1, 
                  pointerEvents: isHidden ? 'none' : 'auto',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                }}
              >
                {/* Drop Visual Helper Badge */}
                {isDragOver && (
                  <div className="track-drop-indicator-badge">
                    <span>Drop to place on VIDEO {rIdx + 1}</span>
                  </div>
                )}

                {videoClips && videoClips
                  .filter((clip) => (clip.trackRow || 0) === rIdx)
                  .filter((clip, idx) => {
                    const isDragging = dragState?.itemType === 'video' && (dragState?.id === clip.id || dragState?.index === idx);
                    const isSelected = activeClipId === clip.id || (selectedSegmentId !== null && (clip.segmentId === selectedSegmentId || clip.segmentIndex === selectedSegmentId));
                    if (isDragging || isSelected) return true;
                    const cStart = clip.start || 0;
                    const cEnd = clip.end || (cStart + 1);
                    return cEnd >= visibleRange.start && cStart <= visibleRange.end;
                  })
                  .map((clip, idx) => {
                    const realIdx = videoClips.findIndex(c => c.id === clip.id);
                    return renderVideoClip(clip, realIdx >= 0 ? realIdx : idx, trackKey, rIdx);
                  })}
              </div>
            );
          })}

          {/* Khmer AI Voice Tracks (Dynamic Unlimited Rows / No Limit) */}
          {audioGenerated && Array.from({ length: voiceRowCount }).map((_, rIdx) => {
            const trackKey = `voice_${rIdx}`;
            const isHidden = Boolean(hiddenTracks[trackKey] || (rIdx === 0 && hiddenTracks.voice));
            const isDragOver = dragOverTrack === trackKey;

            return (
              <div 
                key={`voice-lane-${rIdx}`}
                className={`track-lane voice-lane ${rIdx > 0 ? 'voice-lane-sub' : ''} ${isDragOver ? 'is-drag-over' : ''}`}
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
                  width: totalWidth,
                  minWidth: totalWidth,
                  opacity: isHidden ? 0.2 : 1, 
                  pointerEvents: isHidden ? 'none' : 'auto',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                }}
              >
                {isDragOver && (
                  <div className="track-drop-indicator-badge voice">
                    <span>Drop to place on VOICE {rIdx + 1} (A{rIdx + 1})</span>
                  </div>
                )}
                {scriptSegments && scriptSegments.length > 0 && scriptSegments.map((seg, idx) => {
                  if (activeSegmentRows[idx] !== rIdx) return null;
                  const hasAudio = Boolean(seg.audioUrl || seg.audioPath || seg.audioFile);
                  if (!hasAudio) return null;

                  const isDragging = (dragState?.itemType === 'audio' || dragState?.itemType === 'subtitle') && dragState?.index === idx;
                  const isSelected = Boolean(
                    (activeClipId && videoClips?.some((c) => c.id === activeClipId && (c.segmentId === seg.id || c.segmentIndex === (idx + 1)))) ||
                    (selectedSegmentId !== null && selectedSegmentId !== undefined && (
                      (seg._uid && String(selectedSegmentId) === String(seg._uid)) || (seg.id !== undefined && seg.id !== null ? String(selectedSegmentId) === String(seg.id) : Number(selectedSegmentId) === idx)
                    )) ||
                    (selectedAudioId !== null && selectedAudioId !== undefined && (
                      (seg._uid && String(selectedAudioId) === String(seg._uid)) || (seg.id !== undefined && seg.id !== null ? String(selectedAudioId) === String(seg.id) : Number(selectedAudioId) === idx)
                    ))
                  );

                  if (!isDragging && !isSelected) {
                    const vStart = (typeof seg.audioStartSec === 'number' && !isNaN(seg.audioStartSec)) ? seg.audioStartSec : parseTimeToSeconds(seg.start, idx * 4);
                    const vEnd = (seg.userTrimmed && typeof seg.audioEndSec === 'number') ? seg.audioEndSec : (typeof seg.audioEndSec === 'number' && !isNaN(seg.audioEndSec) ? seg.audioEndSec : vStart + 3.0);
                    if (vEnd < visibleRange.start || vStart > visibleRange.end) {
                      return null;
                    }
                  }

                  return renderVoiceSegment(seg, idx);
                })}
              </div>
            );
          })}

          {/* Subtitles Tracks: shown when in Step 2 (Dubbing Mode & Script) or when subtitles exist */}
          {showSubtitles && Array.from({ length: subRowCount }).map((_, rIdx) => {
            const trackKey = `subs_${rIdx}`;
            const isHidden = Boolean(hiddenTracks[trackKey] || (rIdx === 0 && hiddenTracks.subs));
            const isDragOver = dragOverTrack === trackKey;

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
                  width: totalWidth,
                  minWidth: totalWidth,
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
                {scriptSegments && scriptSegments.length > 0 && scriptSegments.map((seg, idx) => {
                  const subRow = (typeof seg.subTrackRow === 'number' && seg.subTrackRow >= 0) ? seg.subTrackRow : 0;
                  if (subRow !== rIdx) return null;

                  const isDragging = (dragState?.itemType === 'audio' || dragState?.itemType === 'subtitle') && dragState?.index === idx;
                  const isSelected = Boolean(
                    (activeClipId && videoClips?.some((c) => c.id === activeClipId && (c.segmentId === seg.id || c.segmentIndex === (idx + 1)))) ||
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
                })}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

function areTimelineTracksCanvasPropsEqual(prev, next) {
  // If actively dragging or scrubbing, re-render immediately
  if (next.dragState || prev.dragState) return false;

  // Re-render when play/pause toggles, or when clips, segments, or settings actually change
  if (prev.isPlaying !== next.isPlaying) return false;

  // NOTE: currentTime, playheadX, and callback handlers are deliberately excluded here because
  // playhead position and timecode text are updated smoothly on hardware GPU via direct requestAnimationFrame
  // translate3d transforms. Bypassing React re-renders of 1,000+ timeline DOM elements keeps playback and scrubbing at pure 60fps!
  if (prev.videoClips !== next.videoClips) return false;
  if (prev.scriptSegments !== next.scriptSegments) return false;
  if (prev.activeClipId !== next.activeClipId) return false;
  if (prev.selectedSegmentId !== next.selectedSegmentId) return false;
  if (prev.selectedAudioId !== next.selectedAudioId) return false;
  if (prev.selectedSubId !== next.selectedSubId) return false;
  if (prev.pps !== next.pps) return false;
  if (prev.totalDuration !== next.totalDuration) return false;
  if (prev.totalWidth !== next.totalWidth) return false;
  if (prev.hiddenTracks !== next.hiddenTracks) return false;
  if (prev.voiceRowCount !== next.voiceRowCount) return false;
  if (prev.subRowCount !== next.subRowCount) return false;
  if (prev.videoRowCount !== next.videoRowCount) return false;
  if (prev.audioGenerated !== next.audioGenerated) return false;
  if (prev.voiceSettings !== next.voiceSettings) return false;
  if (prev.showSubtitles !== next.showSubtitles) return false;
  if (prev.snapLineTime !== next.snapLineTime) return false;
  if (prev.selectedVideo !== next.selectedVideo) return false;

  return true;
}

export default React.memo(TimelineTracksCanvas, areTimelineTracksCanvasPropsEqual);
