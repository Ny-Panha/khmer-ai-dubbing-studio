import React, { useState } from 'react';
import {
  Sparkles, RefreshCw, Undo, Redo, Plus, AlignLeft,
  RotateCcw, Search, Mic, Music, Clapperboard, CheckCircle2,
  AlertTriangle, Key, Volume2
} from 'lucide-react';
import './WorkspaceToolbar.css';

export default function WorkspaceToolbar({
  workspaceMode = 'script',
  segmentsCount = 0,
  overCount = 0,
  searchQuery = '',
  onSearchChange = null,
  // Script operations
  onReTranslateClick = null,
  onAutoAlign = null,
  onResetTiming = null,
  onAddSegment = null,
  canUndo = false,
  canRedo = false,
  onUndo = null,
  onRedo = null,
  onOpenKeyModal = null,
  // Voice operations
  onGenerateAllVoice = null,
  isGeneratingAudio = false,
  audioProgress = 0,
  // Demucs operations
  isCleanBgReady = false,
  // Mix Export operations
  onRenderVideo = null,
  isRendering = false,
  renderProgress = 0,
}) {
  return (
    <div className="workspace-toolbar">
      {/* Left side actions based on mode */}
      <div className="workspace-toolbar-left">
        {/* Mode: SCRIPT */}
        {workspaceMode === 'script' && (
          <>
            {onReTranslateClick && (
              <button
                type="button"
                className="workspace-toolbar-btn primary"
                onClick={onReTranslateClick}
                title="បកប្រែឡើងវិញ ឬបកប្រែបន្ថែមជាមួយ Gemini AI"
              >
                <Sparkles size={13} />
                <span>Re-Translate</span>
              </button>
            )}

            {onAutoAlign && (
              <button
                type="button"
                className="workspace-toolbar-btn"
                onClick={onAutoAlign}
                title="តម្រឹមពេលវេលាស្វ័យប្រវត្តិកុំឱ្យជាន់គ្នា (No-Overlap Auto Align)"
              >
                <AlignLeft size={13} color="#38bdf8" />
                <span>Auto-Align</span>
              </button>
            )}

            {onResetTiming && (
              <button
                type="button"
                className="workspace-toolbar-btn"
                onClick={onResetTiming}
                title="កំណត់ម៉ោងត្រឡប់ទៅតាម Subtitle ដើម (Reset to Source Timing)"
              >
                <RotateCcw size={12} color="#94a3b8" />
                <span>Reset Timing</span>
              </button>
            )}

            {onAddSegment && (
              <button
                type="button"
                className="workspace-toolbar-btn"
                onClick={() => onAddSegment(0)}
                title="បន្ថែមឃ្លាសន្ទនាថ្មីនៅចុងបញ្ជី"
              >
                <Plus size={13} color="#22c55e" />
                <span>Add Line</span>
              </button>
            )}

            {/* Undo / Redo */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginLeft: 4 }}>
              <button
                type="button"
                className="workspace-toolbar-btn icon-only"
                onClick={onUndo}
                disabled={!canUndo}
                title="មិនធ្វើវិញ (Undo Ctrl+Z)"
              >
                <Undo size={13} />
              </button>
              <button
                type="button"
                className="workspace-toolbar-btn icon-only"
                onClick={onRedo}
                disabled={!canRedo}
                title="ធ្វើឡើងវិញ (Redo Ctrl+Y)"
              >
                <Redo size={13} />
              </button>
            </div>
          </>
        )}

        {/* Mode: VOICE */}
        {workspaceMode === 'voice' && (
          <>
            {onGenerateAllVoice && (
              <button
                type="button"
                className="workspace-toolbar-btn primary"
                onClick={onGenerateAllVoice}
                disabled={isGeneratingAudio || segmentsCount === 0}
                title="បញ្ចេញបញ្ចូលសំឡេងខ្មែរ AI ទាំងអស់ក្នុងភាគនេះ (Edge TTS Batch)"
              >
                {isGeneratingAudio ? (
                  <>
                    <RefreshCw size={13} className="spin-icon" />
                    <span>កំពុងបង្កើតសំឡេង {audioProgress}%...</span>
                  </>
                ) : (
                  <>
                    <Mic size={13} />
                    <span>✦ Generate All Voice ({segmentsCount} ឃ្លា)</span>
                  </>
                )}
              </button>
            )}

            {onAutoAlign && (
              <button
                type="button"
                className="workspace-toolbar-btn"
                onClick={onAutoAlign}
                title="តម្រឹមរយៈពេលសំឡេងតាមកម្រិតល្បឿន"
              >
                <AlignLeft size={13} color="#38bdf8" />
                <span>Auto-Align Speed</span>
              </button>
            )}
          </>
        )}

        {/* Mode: DEMUCS */}
        {workspaceMode === 'demucs' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {isCleanBgReady ? (
              <span className="workspace-pill success">
                <CheckCircle2 size={12} color="#22c55e" />
                <span>Clean BGM Ready</span>
              </span>
            ) : (
              <span className="workspace-pill warning">
                <Music size={12} color="#f59e0b" />
                <span>Original Audio (Raw)</span>
              </span>
            )}
          </div>
        )}

        {/* Mode: MIX-EXPORT */}
        {workspaceMode === 'mix-export' && (
          <>
            {onRenderVideo && (
              <button
                type="button"
                className="workspace-toolbar-btn success"
                onClick={onRenderVideo}
                disabled={isRendering || segmentsCount === 0}
                title="Render វីដេអូចុងក្រោយ (FFmpeg CapCut Export)"
              >
                {isRendering ? (
                  <>
                    <RefreshCw size={13} className="spin-icon" />
                    <span>Rendering {renderProgress}%...</span>
                  </>
                ) : (
                  <>
                    <Clapperboard size={13} />
                    <span>✦ Render & Export Video</span>
                  </>
                )}
              </button>
            )}
          </>
        )}
      </div>

      {/* Right side stats & live search */}
      <div className="workspace-toolbar-right">
        {/* Search Input */}
        <div className="workspace-search-box">
          <Search size={12} color="#64748b" />
          <input
            type="text"
            className="workspace-search-input"
            placeholder="ស្វែងរកឃ្លាសន្ទនា / speaker..."
            value={searchQuery}
            onChange={(e) => onSearchChange && onSearchChange(e.target.value)}
          />
        </div>

        {/* Segments count pill */}
        <span className="workspace-pill" title="ចំនួនឃ្លាសន្ទនាសរុប">
          💬 {segmentsCount}
        </span>

        {/* OVER warning pill */}
        {overCount > 0 && (
          <span
            className="workspace-pill warning"
            title={`មាន ${overCount} ឃ្លាដែលសំឡេងខ្មែរវែងជាងរយៈពេលដើម (លើសពី 0.3s) សូមពិនិត្យ ឬពន្លឿន Speed`}
          >
            <AlertTriangle size={11} color="#f59e0b" />
            <span>{overCount} OVER</span>
          </span>
        )}

        {/* Gemini Key Pool pill */}
        {workspaceMode === 'script' && onOpenKeyModal && (
          <span
            className="workspace-pill keys-clickable"
            onClick={onOpenKeyModal}
            title="ចុចដើម្បីបើក Gemini Route Studio និងគ្រប់គ្រង API Keys"
          >
            <Key size={11} />
            <span>Key Pool</span>
          </span>
        )}
      </div>
    </div>
  );
}
