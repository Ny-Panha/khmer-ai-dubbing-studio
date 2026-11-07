import React, { useState } from 'react';
import { 
  Key, HelpCircle, Download, Loader2, RotateCcw, X, Trash2, Film, Plus, Cpu
} from 'lucide-react';
import { isCorruptedOrMojibakeTitle } from '../utils/projectStorage';
import ShortcutsModal from './ShortcutsModal';
import './Navbar.css';

export default function Navbar({
  apiKey,
  onSaveApiKey,
  isBackendOnline,
  selectedVideo,
  onRenderVideo,
  isRendering,
  renderProgress = 0,
  renderedVideo,
  activeSeries = null,
  activeEpisode = null,
  seriesId = null,
  episodeId = null,
  generatingEpisodeId = null,
  generatingAudioEpisodeId = null,
  onSwitchEpisode = null,
  onCreateEpisode = null,
  onDeleteEpisode = null,
  onResetAllEpisodes = null,
  activeTab = 'media',
  onTabChange = null,
  onOpenJobDashboard = null,
  onOpenGeminiRoute = null,
  activeJobCount = 0,
}) {
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [tempKey, setTempKey] = useState(apiKey || '');

  const handleSave = (e) => {
    e.preventDefault();
    onSaveApiKey(tempKey);
    setShowKeyModal(false);
  };

  return (
    <>
      <header className="capcut-navbar">
        {/* Left: Brand Mark & Gemini Multi-Key Route Launcher */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="concat-app-mark" title="DragonDub AI Studio">
            <span>D</span>
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (onOpenGeminiRoute) onOpenGeminiRoute();
              if (onTabChange) onTabChange('gemini-route');
            }}
            className={`navbar-gemini-route-btn ${activeTab === 'gemini-route' ? 'active' : ''}`}
            title="Gemini Multi-Key Router (Translate 2 ឬ 4 ភាគព្រមគ្នា)"
          >
            <Cpu size={13} color="#38bdf8" />
            <span>Gemini Route</span>
            <span className="gemini-badge-chip">4 Keys</span>
          </button>
        </div>

        {/* Center: Responsive Series & Episode Switcher (GetLayers.ai Layer 2 Capsule) */}
        <div className="navbar-center-container">
          <div className="navbar-episode-track-capsule">
            {/* Series Title Badge */}
            <div
              className="navbar-series-tag"
              title={`${activeSeries?.title || 'រឿងភាគ'} (ចុចដើម្បីបើក Episodes Manager)`}
              onClick={() => onTabChange && onTabChange('episodes')}
            >
              <Film size={12} color="#38bdf8" style={{ flexShrink: 0 }} />
              <span className="navbar-series-title-text">
                {(() => {
                  const rawTitle = activeSeries?.title;
                  return (rawTitle && !isCorruptedOrMojibakeTitle(rawTitle)) ? rawTitle : 'រឿងភាគ';
                })()}
              </span>
            </div>

            {/* Scrollable Episode Tabs Track */}
            <div
              className="navbar-episodes-scroll-strip"
              onWheel={(e) => {
                if (e.currentTarget) {
                  e.currentTarget.scrollLeft += e.deltaY;
                }
              }}
            >
              {(activeSeries?.episodes || []).map((ep, idx) => {
                const isSelected = ep.id === episodeId;
                const isEpGeneratingScript = ep.id === generatingEpisodeId;
                const isEpGeneratingAudio = ep.id === generatingAudioEpisodeId;
                const isEpGenerating = isEpGeneratingScript || isEpGeneratingAudio;
                const hasAudio = Boolean(ep.audioGenerated && !ep.audioOutdated);
                const hasScript = Boolean(
                  (ep.scriptData?.segments && ep.scriptData.segments.length > 0) ||
                  ep.scriptData?.hasScript ||
                  (typeof ep.scriptData?.totalSegments === 'number' && ep.scriptData.totalSegments > 0) ||
                  ep.status === 'translated' ||
                  ep.status === 'voicing' ||
                  ep.status === 'completed'
                );
                
                const epNum = ep.episodeNumber || (idx + 1);
                const rawTitle = ep.displayTitle || ep.title || '';
                const rawVideoName = ep.video?.originalFilename || ep.video?.fileName;

                // Detect if title is default generic
                const isGenericTitle = !rawTitle || 
                  /^ភាគទី\s*[\d០-៩]+\s*(?:\(EP[\d០-៩]+\))?$/i.test(rawTitle.trim()) ||
                  /^\(EP[\d០-៩]+\)$/i.test(rawTitle.trim()) ||
                  /^Episode\s*[\d]+$/i.test(rawTitle.trim());

                const cleanCustomTitle = isGenericTitle
                  ? null
                  : rawTitle
                      .replace(/^(?:ភាគទី|ភាគ|EP|Episode)\s*[:#\s]*\d+\s*[:\-\s]*/i, '')
                      .replace(/\s*\(EP\d+\)$/i, '')
                      .trim();

                return (
                  <div
                    key={ep.id}
                    className={`navbar-ep-pill ${isSelected ? 'active' : ''}`}
                  >
                    {/* Clickable Episode Button */}
                    <div
                      onClick={() => onSwitchEpisode?.(ep.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                      title={`ភាគទី ${epNum}${cleanCustomTitle ? `: ${cleanCustomTitle}` : ''} (${rawVideoName || 'No video loaded'}) - Click to switch`}
                    >
                      <span className="navbar-ep-badge-num">
                        EP {epNum}
                      </span>

                      {cleanCustomTitle && (
                        <span style={{ maxWidth: 85, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {cleanCustomTitle}
                        </span>
                      )}

                      {isEpGenerating ? (
                        <Loader2 size={11} className="animate-spin" style={{ color: isSelected ? '#0B132B' : '#38bdf8' }} />
                      ) : hasAudio ? (
                        <span style={{ fontSize: '0.62rem' }} title="Has Khmer Audio">🎙️</span>
                      ) : hasScript ? (
                        <span style={{ fontSize: '0.62rem' }} title="Has Subtitle Script">📝</span>
                      ) : null}
                    </div>

                    {/* Delete Episode (X) Button */}
                    {onDeleteEpisode && (activeSeries?.episodes?.length || 0) > 1 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          onDeleteEpisode(ep.id);
                        }}
                        className="navbar-ep-delete-btn"
                        title={`Delete EP${epNum} (លុបភាគនេះចោល)`}
                      >
                        <X size={11} strokeWidth={2.5} />
                      </button>
                    )}
                  </div>
                );
              })}

              {/* Create New Episode (+ EP) */}
              <button
                type="button"
                onClick={() => onCreateEpisode?.()}
                className="navbar-ep-add-btn"
                title="Create New Episode (+ EP)"
              >
                <Plus size={11} />
                <span>EP</span>
              </button>

              {/* Safe Compact Reset All Episodes Button */}
              {onResetAllEpisodes && (activeSeries?.episodes?.length || 0) > 1 && (
                <button
                  type="button"
                  onClick={() => onResetAllEpisodes?.()}
                  className="navbar-ep-reset-btn"
                  title="Clear / Reset All Episodes (សម្អាតភាគទាំងអស់ដើម្បីចាប់ផ្ដើមថ្មី)"
                >
                  <Trash2 size={11} />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Right: Actions, Shortcuts, Key & Export CTA */}
        <div className="navbar-right-actions">
          {/* Backend Online status chip */}
          <div className={`status-chip ${isBackendOnline ? 'online' : 'offline'}`} title={isBackendOnline ? 'FFmpeg backend is running' : 'Backend server offline'}>
            <span className="status-dot" />
            <span>{isBackendOnline ? 'FFmpeg Online' : 'Backend Offline'}</span>
          </div>

          {/* Gemini API Key Configuration */}
          <button
            type="button"
            onClick={() => setShowKeyModal(true)}
            className={`api-key-btn ${apiKey ? 'configured' : 'missing'}`}
            title="Configure Gemini AI API Key"
          >
            <Key size={13} />
            <span>{apiKey ? 'API Key Configured' : 'Set Gemini Key'}</span>
          </button>

          {/* Keyboard Shortcuts */}
          <button
            type="button"
            onClick={() => setShowShortcutsModal(true)}
            className="navbar-icon-btn"
            title="Keyboard Shortcuts (Ctrl+/)"
          >
            <HelpCircle size={14} />
          </button>

          {/* Header Export / Download Action */}
          {isRendering ? (
            <button
              disabled
              className="navbar-export-btn"
              style={{
                opacity: 0.95,
                cursor: 'wait',
                position: 'relative',
                overflow: 'hidden',
                background: 'rgba(30, 41, 59, 0.9)',
                border: '1px solid rgba(56, 189, 248, 0.4)',
              }}
              title="Rendering Final Video with FFmpeg..."
            >
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  bottom: 0,
                  width: `${renderProgress || 5}%`,
                  background: 'linear-gradient(90deg, rgba(59, 130, 246, 0.35), rgba(6, 182, 212, 0.45))',
                  transition: 'width 0.25s ease-out',
                }}
              />
              <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Loader2 size={13} className="animate-spin" style={{ color: '#38bdf8' }} />
                <span>Rendering {renderProgress ? `${renderProgress}%` : '...'}</span>
              </div>
            </button>
          ) : renderedVideo ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <a
                href={typeof renderedVideo === 'string' ? renderedVideo : (renderedVideo.downloadUrl || renderedVideo.outputVideoUrl)}
                download={
                  renderedVideo?.outputFilename ||
                  (selectedVideo?.displayTitle || selectedVideo?.originalFilename || selectedVideo?.fileName
                    ? `${(selectedVideo.displayTitle || selectedVideo.originalFilename || selectedVideo.fileName).replace(/\.[^/.]+$/, '').trim()}_Khmer_Dubbed.mp4`
                    : 'Dubbed_Video_Khmer.mp4')
                }
                className="navbar-export-btn download-ready"
                title={`Download Rendered Video: ${selectedVideo?.displayTitle || selectedVideo?.originalFilename || selectedVideo?.fileName ? (selectedVideo.displayTitle || selectedVideo.originalFilename || selectedVideo.fileName).replace(/\.[^/.]+$/, '').trim() + '_Khmer_Dubbed.mp4' : 'Dubbed Video'}`}
              >
                <Download size={14} />
                <span>Download MP4</span>
              </a>
              <button
                type="button"
                onClick={onRenderVideo}
                disabled={!selectedVideo}
                className="navbar-icon-btn"
                title="Re-Export Video"
                style={{ height: 28, padding: '0 8px', borderRadius: 'var(--radius-xs)', border: '1px solid #334155' }}
              >
                <RotateCcw size={13} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={onRenderVideo}
              disabled={!selectedVideo}
              className="navbar-export-btn"
              title="Render and Export Video with Audio Ducking & Subtitles"
            >
              <Download size={14} />
              <span>Export</span>
            </button>
          )}
        </div>
      </header>

      {/* Shortcuts Modal */}
      <ShortcutsModal
        isOpen={showShortcutsModal}
        onClose={() => setShowShortcutsModal(false)}
      />

      {/* API Key Modal */}
      {showKeyModal && (
        <div className="modal-backdrop" onClick={() => setShowKeyModal(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Key size={18} color="var(--accent-cyan)" />
              <h3 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 700, color: '#fff' }}>
                Gemini AI API Key
              </h3>
            </div>
            <p style={{ margin: '0 0 14px', fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
              ប្រើប្រាស់ Google Gemini 3.8 Flash សម្រាប់វិភាគសំឡេងវីដេអូដើម និងសរសេរអត្ថបទសម្រាយរឿងខ្មែរ។
            </p>
            <input
              type="password"
              value={tempKey}
              onChange={(e) => setTempKey(e.target.value)}
              placeholder="AIzaSy..."
              className="capcut-input"
              style={{ marginBottom: 16 }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setShowKeyModal(false)}
                className="btn-secondary"
                style={{ fontSize: '0.78rem' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="btn-primary"
                style={{ fontSize: '0.78rem' }}
              >
                Save Key
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
