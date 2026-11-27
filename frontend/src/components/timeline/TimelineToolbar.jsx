import React, { useRef, useEffect, useState } from 'react';
import {
  Plus, Undo2, Redo2, Scissors, Trash2, Film, Sparkles,
  ZoomOut, ZoomIn, Maximize2, LocateFixed, Magnet, MessageSquare,
  Clapperboard, Upload, Loader2, X, Volume2, VolumeX
} from 'lucide-react';
import { formatMinSec } from '../../utils/timestampUtils';

function TimelineToolbar({
  selectedVideo,
  onResetFullVideo,
  canUndo,
  onUndo,
  canRedo,
  onRedo,
  onSplitClip,
  onInsertVideoAd = null,
  canSplit = true,
  currentTime = 0,
  isPlaying = false,
  playheadTimeRef = null,
  subscribePlayhead = null,
  duration = 0,
  handleDeleteSelected,
  canDelete,
  canDeleteSubtitle,
  canDeleteVideo,
  onAutoSplitVideo,
  videoClips = [],
  scriptSegments,
  onBridgeGaps = null,
  onAutoAlignNoOverlap = null,
  snappingEnabled = true,
  setSnappingEnabled = null,
  showSubtitlesTrack = false,
  setShowSubtitlesTrack = null,
  onAddSegment = null,
  voiceSettings,
  onUpdateVoiceSettings,
  zoom,
  setZoom,
  autoCenter = true,
  setAutoCenter = null,
  handleCenterPlayhead = null,
  voiceRowCount = 1,
  subRowCount = 1,
  onAddTrack = null,
}) {
  const isAutoCutMode = Array.isArray(videoClips) && videoClips.length > 1;
  const [showAdPicker, setShowAdPicker] = useState(false);
  const [adLibrary, setAdLibrary] = useState([]);
  const [isLoadingAds, setIsLoadingAds] = useState(false);
  const [isUploadingAd, setIsUploadingAd] = useState(false);
  const [adError, setAdError] = useState(null);
  const [adPlacement, setAdPlacement] = useState('manual'); // 'manual' | 'preroll' | 'postroll'

  const loadSponsorLibrary = async () => {
    setIsLoadingAds(true);
    setAdError(null);
    try {
      const res = await fetch('/api/sponsor-videos');
      const data = await res.json();
      if (data?.success && Array.isArray(data.videos)) {
        setAdLibrary(data.videos);
      }
    } catch (err) {
      setAdError(err.message || 'មិនអាចទាញបញ្ជីវីដេអូពាណិជ្ជកម្មបានទេ');
    } finally {
      setIsLoadingAds(false);
    }
  };

  const handleOpenAdPicker = () => {
    setShowAdPicker(true);
    loadSponsorLibrary();
  };

  const probeBrowserVideoDuration = (url) => new Promise((resolve) => {
    try {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.onloadedmetadata = () => resolve(Number.isFinite(v.duration) ? v.duration : 0);
      v.onerror = () => resolve(0);
      v.src = url;
    } catch (_) {
      resolve(0);
    }
  });

  const handleUploadAndInsertAd = async (file) => {
    if (!file) return;
    setIsUploadingAd(true);
    setAdError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/upload-sponsor-video', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok || !data?.success || !data.videoUrl) {
        throw new Error(data?.error || 'Upload failed');
      }
      let dur = Number(data.durationSec) || 0;
      if (dur <= 0.05) {
        dur = await probeBrowserVideoDuration(data.videoUrl);
      }
      const adItem = {
        videoUrl: data.videoUrl,
        videoPath: data.videoPath,
        name: data.originalName || data.filename,
        originalName: data.originalName || data.filename,
        duration: dur,
        hasAudio: data.hasAudio !== undefined ? Boolean(data.hasAudio) : true,
        adVolume: Number.isFinite(Number(voiceSettings?.videoAdVolume)) ? Number(voiceSettings.videoAdVolume) : 1.0,
      };
      if (onInsertVideoAd && adItem.duration > 0.05) {
        await onInsertVideoAd(adItem, { insertTime: getActiveTime(), placement: adPlacement });
        setShowAdPicker(false);
      } else {
        await loadSponsorLibrary();
      }
    } catch (err) {
      setAdError(err.message || 'Upload failed');
    } finally {
      setIsUploadingAd(false);
    }
  };

  const handlePickExistingAd = async (item) => {
    if (!onInsertVideoAd || !item?.videoUrl) return;
    const dur = Number(item.durationSec) || 0;
    if (dur <= 0.05) {
      setAdError('វីដេអូពាណិជ្ជកម្មនេះមិនមាន duration ត្រឹមត្រូវទេ');
      return;
    }
    await onInsertVideoAd({
      videoUrl: item.videoUrl,
      videoPath: item.videoPath,
      name: item.originalName || item.filename,
      duration: dur,
      hasAudio: Boolean(item.hasAudio),
      adVolume: Number.isFinite(Number(voiceSettings?.videoAdVolume)) ? Number(voiceSettings.videoAdVolume) : 1.0,
    }, { insertTime: getActiveTime(), placement: adPlacement });
    setShowAdPicker(false);
  };

  const timecodeSpanRef = useRef(null);

  useEffect(() => {
    if (typeof subscribePlayhead !== 'function') return undefined;
    let lastText = '';
    return subscribePlayhead((liveTime) => {
      if (timecodeSpanRef.current) {
        const nextText = formatMinSec(liveTime);
        if (nextText !== lastText) {
          lastText = nextText;
          timecodeSpanRef.current.textContent = nextText;
        }
      }
    });
  }, [subscribePlayhead]);

  const getActiveTime = () => (
    playheadTimeRef && Number.isFinite(playheadTimeRef.current)
      ? playheadTimeRef.current
      : currentTime
  );

  return (
    <div className="capcut-timeline-toolbar">
      {/* 1. Left Section — Logical 3-Stage Dubbing Flow */}
      <div className="toolbar-left-actions">
        {/* Group A — History & Clip Actions */}
        <div className="timeline-tool-group" data-workflow-group="history-clip">
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            className={`timeline-icon-tool ${canUndo ? '' : 'disabled'}`}
            title="Undo (Ctrl+Z)"
          >
            <Undo2 size={13} />
          </button>
          <button
            type="button"
            onClick={onRedo}
            disabled={!canRedo}
            className={`timeline-icon-tool ${canRedo ? '' : 'disabled'}`}
            title="Redo (Ctrl+Y)"
          >
            <Redo2 size={13} />
          </button>

          <div className="toolbar-v-separator" />

          <button
            type="button"
            onClick={() => onSplitClip && onSplitClip(getActiveTime())}
            disabled={!canSplit}
            className={`timeline-icon-tool tool-split ${!canSplit ? 'disabled' : ''}`}
            title="Split Clip or Segment at Playhead (Ctrl+B / [|])"
          >
            <Scissors size={13} />
          </button>
          {onInsertVideoAd && (
            <button
              type="button"
              data-testid="btn-insert-video-ad"
              onClick={handleOpenAdPicker}
              disabled={!selectedVideo}
              className={`timeline-pill-tool tool-video-ads ${!selectedVideo ? 'disabled' : ''}`}
              title="បញ្ចូលវីដេអូពាណិជ្ជកម្មពេញអេក្រង់ (+ Video Ads) នៅត្រង់ Playhead"
            >
              <Clapperboard size={12} />
              <span>+ Video Ads</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleDeleteSelected}
            disabled={!canDelete}
            className={`timeline-icon-tool tool-delete ${canDelete ? 'active-delete' : 'disabled'}`}
            title={
              canDeleteSubtitle
                ? 'Delete Selected Subtitle (Del / Backspace)'
                : canDeleteVideo
                  ? 'Delete Selected Video Clip (Del / Backspace)'
                  : 'Delete (Del)'
            }
          >
            <Trash2 size={13} />
          </button>
          {onAddSegment && (
            <button
              type="button"
              onClick={() => onAddSegment(getActiveTime())}
              className="timeline-pill-tool tool-add-segment"
              title="បន្ថែមឃ្លា Subtitle ថ្មីនៅត្រង់ Playhead (+ Add Subtitle at Playhead)"
            >
              <Plus size={13} />
              <span>ថែមឃ្លា</span>
            </button>
          )}
        </div>

        {/* Group B — Video Slicing Mode (Segmented Pill Toggle) */}
        {(onResetFullVideo || onAutoSplitVideo) && (
          <div className="timeline-tool-group timeline-segmented-group" data-workflow-group="video-slicing">
            {onResetFullVideo && (
              <button
                type="button"
                onClick={onResetFullVideo}
                className={`timeline-pill-tool timeline-segment-option ${!isAutoCutMode && selectedVideo ? 'is-active-mode' : ''}`}
                title="Full Video: រក្សាវីដេអូពេញដើម (Restore Full Uncut Video)"
                disabled={!selectedVideo}
              >
                <Film size={12} />
                <span>Full Video</span>
              </button>
            )}
            {onAutoSplitVideo && (
              <button
                type="button"
                onClick={onAutoSplitVideo}
                className={`timeline-pill-tool timeline-segment-option ${isAutoCutMode ? 'is-active-mode' : ''}`}
                title="Auto-Cut by Subs: កាត់ Video ជាកំណាត់ៗតាម Subtitle"
                disabled={!scriptSegments || scriptSegments.length === 0}
              >
                <Scissors size={12} />
                <span>Auto-Cut by Subs</span>
              </button>
            )}
          </div>
        )}

        {/* Group C — Voice Timing & Alignment Actions */}
        <div className="timeline-tool-group" data-workflow-group="voice-timing">
          {onAutoAlignNoOverlap && (
            <button
              type="button"
              onClick={() => onAutoAlignNoOverlap && onAutoAlignNoOverlap()}
              className="timeline-pill-tool tool-purple"
              title="Auto-Align Voice: តម្រៀបសំឡេងតាម Track រៀងៗខ្លួនមិនឱ្យជាន់គ្នា"
              disabled={!scriptSegments || scriptSegments.length <= 1}
            >
              <Sparkles size={12} />
              <span>Auto-Align</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. Center Section — Live Studio Timecode Display */}
      <div className="toolbar-center-timecode" data-testid="timeline-center-timecode">
        <span ref={timecodeSpanRef} className="timeline-timecode-current">{formatMinSec(currentTime)}</span>
        <span className="timeline-timecode-sep">/</span>
        <span className="timeline-timecode-total">{formatMinSec(duration)}</span>
      </div>

      {/* 3. Right Section — Toggles & Zoom Navigation */}
      <div className="toolbar-right-actions">
        {/* Toggle Pills: Snap & Subs */}
        <div className="timeline-tool-group" data-workflow-group="view-toggles">
          {setSnappingEnabled && (
            <button
              type="button"
              onClick={() => setSnappingEnabled((prev) => !prev)}
              className={`timeline-pill-tool ${snappingEnabled ? 'tool-magnet active' : 'tool-magnet'}`}
              title={snappingEnabled ? 'ដែកឆក់ (Magnet Snap): ON' : 'ដែកឆក់ (Magnet Snap): OFF'}
            >
              <Magnet size={12} />
              <span>{snappingEnabled ? 'Snap ON' : 'Snap OFF'}</span>
            </button>
          )}

          {setShowSubtitlesTrack && (
            <button
              type="button"
              data-pill-type="subs"
              onClick={() => setShowSubtitlesTrack((prev) => !prev)}
              className={`timeline-pill-tool ${showSubtitlesTrack ? 'tool-magnet active' : 'tool-magnet'}`}
              title={
                showSubtitlesTrack
                  ? 'Subtitles Track: ON (ចុចដើម្បីលាក់បន្ទាត់ Subtitles)'
                  : 'Subtitles Track: OFF (ចុចដើម្បីបង្ហាញបន្ទាត់ Subtitles)'
              }
            >
              <MessageSquare size={11} />
              <span>{showSubtitlesTrack ? 'Subs ON' : 'Subs OFF'}</span>
            </button>
          )}
        </div>

        <div className="toolbar-v-separator" />

        {/* Zoom & Playhead Controls */}
        <div className="timeline-tool-group zoom-group" data-workflow-group="zoom-navigation">
          <button
            type="button"
            onClick={() => setZoom((prev) => Math.max(0.5, parseFloat((prev - 0.2).toFixed(1))))}
            className="timeline-icon-tool"
            title="Zoom Out (-)"
          >
            <ZoomOut size={12} />
          </button>
          <input
            type="range"
            min="0.5"
            max="3.0"
            step="0.1"
            value={zoom}
            onChange={(e) => setZoom(parseFloat(e.target.value))}
            className="timeline-zoom-slider"
            title={`Scale timeline width (${zoom.toFixed(1)}x)`}
          />
          <button
            type="button"
            onClick={() => setZoom((prev) => Math.min(3.0, parseFloat((prev + 0.2).toFixed(1))))}
            className="timeline-icon-tool"
            title="Zoom In (+)"
          >
            <ZoomIn size={12} />
          </button>
          <button
            type="button"
            onClick={() => setZoom(1)}
            className="timeline-icon-tool"
            title="Fit Timeline (1.0x)"
          >
            <Maximize2 size={12} />
          </button>
          {handleCenterPlayhead && (
            <button
              type="button"
              onClick={() => {
                if (setAutoCenter) setAutoCenter((prev) => !prev);
                handleCenterPlayhead();
              }}
              className={`timeline-icon-tool ${autoCenter ? 'tool-locate active' : ''}`}
              title={
                autoCenter
                  ? 'Auto-Center ON (Playhead នៅចំកណ្ដាលជានិច្ច - ចុចដើម្បីបិទ ឬតម្រឹម)'
                  : 'Auto-Center OFF (ចុចដើម្បីដាក់ Playhead ចំកណ្ដាល & Auto Follow)'
              }
            >
              <LocateFixed size={12} />
            </button>
          )}
        </div>
      </div>

      {showAdPicker && (
        <div
          className="video-ads-picker-backdrop"
          data-testid="video-ads-picker-modal"
          onClick={() => setShowAdPicker(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.6)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(460px, 92vw)',
              background: '#111827',
              border: '1px solid rgba(245, 158, 11, 0.5)',
              borderRadius: 12,
              padding: 16,
              color: '#F9FAFB',
              boxShadow: '0 20px 50px rgba(0,0,0,0.65)',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Clapperboard size={16} color="#FBBF24" />
                <span style={{ fontWeight: 700, fontSize: '0.92rem', color: '#FDE68A' }}>
                  បញ្ចូលវីដេអូពាណិជ្ជកម្ម (+ Video Ads)
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowAdPicker(false)}
                style={{ background: 'transparent', border: 'none', color: '#9CA3AF', cursor: 'pointer' }}
              >
                <X size={16} />
              </button>
            </div>

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[
                { id: 'manual', label: `ត្រង់ Playhead (${formatMinSec(getActiveTime())})` },
                { id: 'preroll', label: 'Pre-roll (00:00)' },
                { id: 'postroll', label: 'Post-roll (ចុងភាគ)' },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setAdPlacement(opt.id)}
                  style={{
                    flex: 1,
                    padding: '6px 8px',
                    fontSize: '0.72rem',
                    fontWeight: 600,
                    borderRadius: 6,
                    cursor: 'pointer',
                    border: adPlacement === opt.id ? '1px solid #F59E0B' : '1px solid rgba(255,255,255,0.12)',
                    background: adPlacement === opt.id ? 'rgba(245, 158, 11, 0.2)' : 'rgba(255,255,255,0.04)',
                    color: adPlacement === opt.id ? '#FDE68A' : '#D1D5DB',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                padding: '9px 12px',
                borderRadius: 8,
                background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.22), rgba(217, 119, 6, 0.14))',
                border: '1px dashed rgba(251, 191, 36, 0.55)',
                color: '#FDE68A',
                fontSize: '0.78rem',
                fontWeight: 700,
                cursor: isUploadingAd ? 'not-allowed' : 'pointer',
              }}
            >
              {isUploadingAd ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              <span>{isUploadingAd ? 'កំពុងបង្ហោះ និងបញ្ចូល...' : 'បង្ហោះវីដេអូ Ads ថ្មី (MP4 / MOV / WebM)'}</span>
              <input
                type="file"
                accept="video/mp4,video/quicktime,video/webm"
                style={{ display: 'none' }}
                disabled={isUploadingAd}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) handleUploadAndInsertAd(file);
                }}
              />
            </label>

            {adError && (
              <div style={{ fontSize: '0.73rem', color: '#FCA5A5', background: 'rgba(239,68,68,0.14)', padding: '6px 8px', borderRadius: 6 }}>
                {adError}
              </div>
            )}

            <div style={{ fontSize: '0.72rem', color: '#9CA3AF', fontWeight: 600 }}>
              បណ្ណាល័យ Sponsor Ads ({adLibrary.length})
            </div>

            <div style={{ maxHeight: 210, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {isLoadingAds ? (
                <div style={{ padding: 16, textAlign: 'center', color: '#9CA3AF', fontSize: '0.75rem' }}>
                  កំពុងទាញបញ្ជី...
                </div>
              ) : adLibrary.length === 0 ? (
                <div style={{ padding: 16, textAlign: 'center', color: '#6B7280', fontSize: '0.75rem' }}>
                  មិនទាន់មានវីដេអូ Sponsor Ads ទេ — សូមបង្ហោះខាងលើ
                </div>
              ) : (
                adLibrary.map((item) => (
                  <button
                    key={item.filename}
                    type="button"
                    onClick={() => handlePickExistingAd(item)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                      padding: '8px 10px',
                      borderRadius: 8,
                      background: 'rgba(255,255,255,0.04)',
                      border: '1px solid rgba(255,255,255,0.09)',
                      color: '#F3F4F6',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: '0.76rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.originalName || item.filename}
                      </div>
                      <div style={{ fontSize: '0.68rem', color: '#9CA3AF', display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                        <span>{Number(item.durationSec || 0).toFixed(1)}s</span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                          {item.hasAudio ? <Volume2 size={11} color="#FBBF24" /> : <VolumeX size={11} color="#9CA3AF" />}
                          {item.hasAudio ? 'មានសំឡេង' : 'គ្មានសំឡេង'}
                        </span>
                      </div>
                    </div>
                    <span style={{
                      fontSize: '0.70rem',
                      fontWeight: 700,
                      padding: '4px 8px',
                      borderRadius: 5,
                      background: 'rgba(245, 158, 11, 0.2)',
                      color: '#FDE68A',
                      border: '1px solid rgba(245, 158, 11, 0.45)',
                    }}>
                      + Insert
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default React.memo(TimelineToolbar, (prev, next) => {
  if (prev.isPlaying !== next.isPlaying) return false;
  if (!next.isPlaying && prev.currentTime !== next.currentTime) return false;
  if (prev.duration !== next.duration) return false;
  if (prev.canUndo !== next.canUndo || prev.canRedo !== next.canRedo) return false;
  if (prev.canSplit !== next.canSplit) return false;
  if (prev.canDelete !== next.canDelete || prev.canDeleteSubtitle !== next.canDeleteSubtitle || prev.canDeleteVideo !== next.canDeleteVideo) return false;
  if (prev.snappingEnabled !== next.snappingEnabled || prev.showSubtitlesTrack !== next.showSubtitlesTrack) return false;
  if (prev.zoom !== next.zoom || prev.autoCenter !== next.autoCenter) return false;
  if (prev.videoClips !== next.videoClips || prev.scriptSegments !== next.scriptSegments) return false;
  if (prev.selectedVideo !== next.selectedVideo || prev.voiceSettings !== next.voiceSettings) return false;
  return true;
});
