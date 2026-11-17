import React from 'react';
import {
  Plus, Undo2, Redo2, Scissors, Trash2, Film, Sparkles, RotateCcw,
  ZoomOut, ZoomIn, Maximize2, LocateFixed, Magnet, MessageSquare
} from 'lucide-react';
import { formatMinSec } from '../../utils/timestampUtils';

export default function TimelineToolbar({
  selectedVideo,
  onResetFullVideo,
  canUndo,
  onUndo,
  canRedo,
  onRedo,
  onSplitClip,
  canSplit = true,
  currentTime = 0,
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
  const isAutoCutMode = Array.isArray(videoClips) && videoClips.length > 1;

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
            onClick={() => onSplitClip && onSplitClip(currentTime)}
            disabled={!canSplit}
            className={`timeline-icon-tool tool-split ${!canSplit ? 'disabled' : ''}`}
            title="Split Clip or Segment at Playhead (Ctrl+B / [|])"
          >
            <Scissors size={13} />
          </button>
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
              onClick={() => onAddSegment(currentTime)}
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
                title="🎞️ Full Video: រក្សាវីដេអូពេញដើម (Restore Full Uncut Video)"
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
                title="✂️ Auto-Cut by Subs: កាត់ Video ជាកំណាត់ៗតាម Subtitle"
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
              title="✨ Auto-Align Voice: តម្រៀបសំឡេងតាម Track រៀងៗខ្លួនមិនឱ្យជាន់គ្នា"
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
              className="timeline-pill-tool tool-neutral"
              title="កំណត់ម៉ោងសំឡេងតាមវីដេអូដើមវិញ (Reset to original timestamps)"
              disabled={!scriptSegments || scriptSegments.length === 0}
            >
              <RotateCcw size={12} />
              <span>Reset Timing</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. Center Section — Live Studio Timecode Display */}
      <div className="toolbar-center-timecode" data-testid="timeline-center-timecode">
        <span className="timeline-timecode-current">{formatMinSec(currentTime)}</span>
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
              title={snappingEnabled ? '🧲 ដែកឆក់ (Magnet Snap): ON' : '🧲 ដែកឆក់ (Magnet Snap): OFF'}
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
    </div>
  );
}
