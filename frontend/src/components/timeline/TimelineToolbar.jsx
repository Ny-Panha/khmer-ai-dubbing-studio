import React from 'react';
import {
  Plus, Undo2, Redo2, Scissors, Trash2, Film, Sparkles, RotateCcw,
  VolumeX, Volume2, ZoomOut, ZoomIn, Maximize2, LocateFixed, Magnet
} from 'lucide-react';

export default function TimelineToolbar({
  selectedVideo,
  onResetFullVideo,
  canUndo,
  onUndo,
  canRedo,
  onRedo,
  onSplitClip,
  currentTime,
  handleDeleteSelected,
  canDelete,
  canDeleteSubtitle,
  canDeleteVideo,
  onAutoSplitVideo,
  videoClips = [],
  onToggleMuteAllCuts = null,
  scriptSegments,
  onBridgeGaps,
  onAutoAlignNoOverlap = null,
  onResetToSourceTiming = null,
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
  return (
    <div className="capcut-timeline-toolbar">
      {/* Left: Action Tools */}
      <div className="toolbar-left-actions">
        {/* History Group: Undo / Redo */}
        <div className="timeline-tool-group">
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
        </div>

        {/* Clip Tools: Split, Delete, Add Subtitle */}
        <div className="timeline-tool-group">
          <button
            type="button"
            onClick={() => onSplitClip && onSplitClip(currentTime)}
            disabled={!selectedVideo && (!scriptSegments || scriptSegments.length === 0)}
            className="timeline-icon-tool tool-split"
            title="Split Clip or Segment at Playhead (Ctrl+B / [|])"
          >
            <Scissors size={13} />
          </button>
          <button
            type="button"
            onClick={handleDeleteSelected}
            disabled={!canDelete}
            className={`timeline-icon-tool tool-delete ${canDelete ? 'active-delete' : 'disabled'}`}
            title={canDeleteSubtitle ? "Delete Selected Subtitle (Del / Backspace)" : (canDeleteVideo ? "Delete Selected Video Clip (Del / Backspace)" : "Delete (Del)")}
          >
            <Trash2 size={13} />
          </button>
          {onAddSegment && (
            <button
              type="button"
              onClick={() => onAddSegment(currentTime)}
              className="timeline-pill-tool tool-add-segment"
              title="បន្ថែមឃ្លា Subtitle ថ្មីនៅត្រង់ Playhead (+ Add Subtitle at Playhead)"
            >
              <Plus size={12} />
              <span>+ ឃ្លា</span>
            </button>
          )}
        </div>

        {/* Video Actions Group: Full Video, Auto-Cut, Mute Cuts */}
        <div className="timeline-tool-group">
          {onResetFullVideo && (
            <button
              type="button"
              onClick={onResetFullVideo}
              className="timeline-pill-tool tool-cyan"
              title="Restore Full Uncut Video"
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
              className="timeline-pill-tool tool-slate"
              title="✂️ Auto-Cut Video: កាត់ Video ជាកំណាត់ៗតាម Subtitle"
              disabled={!scriptSegments || scriptSegments.length === 0}
            >
              <Scissors size={12} />
              <span>Auto-Cut</span>
            </button>
          )}

          {onToggleMuteAllCuts && videoClips && videoClips.length > 0 && (() => {
            const dialogueClips = videoClips.filter((c) => c.isDialogue);
            const targetClips = dialogueClips.length > 0 ? dialogueClips : videoClips;
            const areAllCutsMuted = targetClips.length > 0 && targetClips.every((c) => Boolean(c.isMuted));
            const isMultiple = videoClips.length > 1;

            return (
              <button
                type="button"
                onClick={() => onToggleMuteAllCuts(true)}
                className={`timeline-pill-tool ${areAllCutsMuted ? 'tool-danger active' : 'tool-slate'}`}
                title={
                  isMultiple
                    ? (areAllCutsMuted ? "ចុចដើម្បីបើកសំឡេងដើម Clip កាត់ទាំងអស់ឡើងវិញ" : "ចុចដើម្បីបិទសំឡេងដើមនៃ Clip កាត់ទាំងអស់")
                    : (areAllCutsMuted ? "ចុចដើម្បីបើកសំឡេងវីដេអូដើមឡើងវិញ" : "ចុចដើម្បីបិទសំឡេងវីដេអូដើម")
                }
              >
                {areAllCutsMuted ? <VolumeX size={12} /> : <Volume2 size={12} />}
                <span>{areAllCutsMuted ? (isMultiple ? 'Unmute Cuts' : 'Unmute') : (isMultiple ? 'Mute Cuts' : 'Mute')}</span>
              </button>
            );
          })()}
        </div>

        {/* Smart AI Alignment & Timing Tools */}
        <div className="timeline-tool-group">
          {onAutoAlignNoOverlap && (
            <button
              type="button"
              onClick={() => onAutoAlignNoOverlap && onAutoAlignNoOverlap()}
              className="timeline-pill-tool tool-purple"
              title="🪄 Auto-Align Voice: តម្រៀបសំឡេងតាម Track រៀងៗខ្លួនមិនឱ្យជាន់គ្នា"
              disabled={!scriptSegments || scriptSegments.length <= 1}
            >
              <Sparkles size={12} />
              <span>Auto-Align</span>
            </button>
          )}

          {onResetToSourceTiming && (
            <button
              type="button"
              onClick={() => onResetToSourceTiming && onResetToSourceTiming()}
              className="timeline-pill-tool tool-amber"
              title="⏮️ Reset to Original Video Timing: កំណត់គ្រប់ឃ្លាឱ្យត្រឡប់ទៅម៉ោងដើម (0% Drift)"
              disabled={!scriptSegments || scriptSegments.length === 0}
            >
              <RotateCcw size={12} />
              <span>Reset Timing</span>
            </button>
          )}

          {setSnappingEnabled && (
            <button
              type="button"
              onClick={() => setSnappingEnabled(prev => !prev)}
              className={`timeline-pill-tool ${snappingEnabled ? 'tool-magnet active' : 'tool-magnet'}`}
              title={snappingEnabled ? "🧲 ដែកឆក់ (Magnet Snap): ON" : "🧲 ដែកឆក់ (Magnet Snap): OFF"}
            >
              <Magnet size={12} />
              <span>{snappingEnabled ? 'Snap ON' : 'Snap OFF'}</span>
            </button>
          )}

          {setShowSubtitlesTrack && (
            <button
              type="button"
              onClick={() => setShowSubtitlesTrack(prev => !prev)}
              className={`timeline-pill-tool ${showSubtitlesTrack ? 'tool-magnet active' : 'tool-magnet'}`}
              title={showSubtitlesTrack ? "Subtitles Track: ON (ចុចដើម្បីលាក់បន្ទាត់ Subtitles)" : "Subtitles Track: OFF (ចុចដើម្បីបង្ហាញបន្ទាត់ Subtitles)"}
            >
              <span>{showSubtitlesTrack ? 'Subs ON' : 'Subs OFF'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Right: Audio Ducking & Zoom Controls */}
      <div className="toolbar-right-actions">
        {/* Ducking Toggle */}
        {voiceSettings && onUpdateVoiceSettings && (
          <button
            type="button"
            onClick={() => onUpdateVoiceSettings({
              ...voiceSettings,
              duckingVolume: voiceSettings.duckingVolume === 0 ? 0.15 : 0
            })}
            className={`timeline-pill-tool ${voiceSettings.duckingVolume === 0 ? 'tool-danger active' : 'tool-mint active'}`}
            title="Toggle Audio Ducking (15% background music reduction)"
          >
            {voiceSettings.duckingVolume === 0 ? <VolumeX size={12} /> : <Volume2 size={12} />}
            <span>{voiceSettings.duckingVolume === 0 ? 'BGM Muted' : 'Ducking 15%'}</span>
          </button>
        )}

        <div className="toolbar-v-separator" />

        {/* Zoom Controls Pill Group */}
        <div className="timeline-tool-group zoom-group">
          <button
            type="button"
            onClick={() => setZoom(prev => Math.max(0.5, parseFloat((prev - 0.2).toFixed(1))))}
            className="timeline-icon-tool"
            title="Zoom Out (-)"
          >
            <ZoomOut size={12} />
          </button>
          <input
            type="range"
            min="0.5"
            max="2.5"
            step="0.1"
            value={zoom}
            onChange={(e) => setZoom(parseFloat(e.target.value))}
            className="timeline-zoom-slider"
            title="Scale timeline width (PPS)"
          />
          <button
            type="button"
            onClick={() => setZoom(prev => Math.min(2.5, parseFloat((prev + 0.2).toFixed(1))))}
            className="timeline-icon-tool"
            title="Zoom In (+)"
          >
            <ZoomIn size={12} />
          </button>
          <button
            type="button"
            onClick={() => setZoom(1)}
            className="timeline-icon-tool"
            title="Zoom to Fit (100%)"
          >
            <Maximize2 size={12} />
          </button>
          {handleCenterPlayhead && (
            <button
              type="button"
              onClick={handleCenterPlayhead}
              className={`timeline-icon-tool ${autoCenter ? 'tool-locate active' : ''}`}
              title={autoCenter ? "Center Playhead (Tracking ON - click to center now)" : "Center Playhead (Focus current time)"}
            >
              <LocateFixed size={12} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
