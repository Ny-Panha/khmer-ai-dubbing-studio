import React, { useState, useRef } from 'react';
import {
  Film, FolderPlus, Loader2, AlertCircle, Trash2, Clock,
  HardDrive, Plus, Edit2, Check, Scissors, Layers, CheckCircle2,
  FileVideo, RefreshCw, PanelLeftClose, ChevronDown, ChevronRight
} from 'lucide-react';
import { uploadVideoFile, splitVideoEpisodesApi } from '../../services/api';
import { formatTimecode } from '../../utils/formatTime';
import { isCorruptedOrMojibakeTitle } from '../../utils/projectStorage';
import './MediaPanel.css';

/**
 * MediaPanel (CapCut-style Left Panel ~300px, collapsible)
 * Re-homes the ImportPage content into a fluid dockable workspace panel:
 * - Series box & rename
 * - Source Video Dropzone (collapses to a slim bar once a video is loaded)
 * - Episode list with status pills (Vid, Scr, Voice, BGM, Exp)
 * - Add Episode & Auto-Split modal
 */
export default function MediaPanel({
  selectedVideo = null,
  videoMetadata = null,
  onVideoSelected = null,
  onRemoveVideo = null,
  seriesList = [],
  activeSeries = null,
  activeEpisode = null,
  seriesId = null,
  episodeId = null,
  onSwitchEpisode = null,
  onCreateEpisode = null,
  onDeleteEpisode = null,
  onRenameEpisode = null,
  onRenameSeries = null,
  onClosePanel = null,
  onRefreshSeries = null,
}) {
  const fileInputRef = useRef(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);

  // Series rename state
  const [isEditingSeriesTitle, setIsEditingSeriesTitle] = useState(false);
  const [tempSeriesTitle, setTempSeriesTitle] = useState('');

  // Episode rename state
  const [editingEpisodeId, setEditingEpisodeId] = useState(null);
  const [tempEpisodeTitle, setTempEpisodeTitle] = useState('');

  // Auto-split modal state
  const [showSplitModal, setShowSplitModal] = useState(false);
  const [splitMinutes, setSplitMinutes] = useState(1);
  const [isSplitting, setIsSplitting] = useState(false);
  const [splitError, setSplitError] = useState(null);

  const episodes = activeSeries?.episodes || [];
  const hasVideo = Boolean(selectedVideo?.videoId || selectedVideo?.videoUrl || activeEpisode?.video?.videoId);
  const videoDurationSec = videoMetadata?.durationSec || selectedVideo?.durationSec || 0;
  const displayTitle = selectedVideo?.displayTitle || selectedVideo?.originalFilename || selectedVideo?.fileName || activeEpisode?.title || 'Episode Video';

  // File Upload Handlers
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) executeUpload(file);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) executeUpload(file);
  };

  const executeUpload = async (file) => {
    if (!file) return;
    try {
      setIsUploading(true);
      setUploadError(null);
      const vidObj = await uploadVideoFile(file, { seriesId, episodeId });
      if (onVideoSelected) {
        onVideoSelected(vidObj);
      }
    } catch (err) {
      console.error(err);
      setUploadError(err.message || 'Upload failed');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Series Rename Handlers
  const handleStartRenameSeries = () => {
    setTempSeriesTitle(activeSeries?.title || '');
    setIsEditingSeriesTitle(true);
  };

  const handleSaveSeriesTitle = () => {
    if (onRenameSeries && tempSeriesTitle.trim()) {
      onRenameSeries(tempSeriesTitle.trim());
    }
    setIsEditingSeriesTitle(false);
  };

  // Episode Rename Handlers
  const handleStartRenameEpisode = (e, ep) => {
    e.stopPropagation();
    setEditingEpisodeId(ep.id);
    setTempEpisodeTitle(ep.displayTitle || ep.title || '');
  };

  const handleSaveEpisodeTitle = (e, epId) => {
    e.stopPropagation();
    if (onRenameEpisode && tempEpisodeTitle.trim()) {
      onRenameEpisode(epId, tempEpisodeTitle.trim());
    }
    setEditingEpisodeId(null);
  };

  // Auto Split Handler
  const handleExecuteSplit = async () => {
    const rawRef = selectedVideo?.videoId || selectedVideo?.filePath || selectedVideo?.videoPath || activeEpisode?.video?.videoId || activeEpisode?.video?.filePath;
    if (!rawRef) {
      setSplitError('សូមជ្រើសរើស ឬផ្ទុកវីដេអូជាមុនសិន!');
      return;
    }
    try {
      setIsSplitting(true);
      setSplitError(null);
      const res = await splitVideoEpisodesApi({
        videoId: rawRef,
        videoPath: selectedVideo?.videoPath || selectedVideo?.filePath,
        seriesId: activeSeries?.id || seriesId || 'drama_project',
        durationMinutes: Number(splitMinutes) || 1,
      });

      if (res?.series) {
        // Update localStorage immediately so state survives
        try {
          const currentList = JSON.parse(localStorage.getItem('KHMER_AI_SERIES_LIST_V2') || '[]');
          const updated = (currentList || []).map((s) => (s.id === res.series.id ? res.series : s));
          localStorage.setItem('KHMER_AI_SERIES_LIST_V2', JSON.stringify(updated));
          if (res.series.episodes?.[0]?.id) {
            localStorage.setItem('KHMER_AI_ACTIVE_EPISODE_ID', res.series.episodes[0].id);
          }
          if (res.series.episodes?.[0]) {
            localStorage.setItem('KHMER_AI_ACTIVE_PROJECT_V3', JSON.stringify({
              video: res.series.episodes[0].video,
              seriesId: res.series.id,
              episodeId: res.series.episodes[0].id,
              scriptData: null,
            }));
          }
        } catch (_) {}
      }

      setShowSplitModal(false);
      if (onRefreshSeries) {
        await onRefreshSeries();
      }
      window.location.reload();
    } catch (err) {
      console.error(err);
      setSplitError(err.message || 'Auto-split failed');
    } finally {
      setIsSplitting(false);
    }
  };

  return (
    <aside className="media-panel" aria-label="Media Library & Episodes">
      {/* 1. Panel Header: Quiet label, no ALL-CAPS bar */}
      <div className="media-panel-header">
        <span className="media-panel-quiet-label">មេឌៀ និងភាគរឿង (Media & Episodes)</span>
        {onClosePanel && (
          <button
            type="button"
            className="media-panel-close-btn"
            onClick={onClosePanel}
            title="បង្រួម Media Panel (Collapse)"
          >
            <PanelLeftClose size={14} />
          </button>
        )}
      </div>

      <div className="media-panel-content">
        {/* 2. Series Header Box */}
        <div className="media-series-box">
          <div className="media-series-eyebrow">
            <span>រឿងភាគ (Series)</span>
            <span className="media-series-count">{episodes.length} ភាគ</span>
          </div>

          {isEditingSeriesTitle ? (
            <div className="media-series-edit-row">
              <input
                type="text"
                value={tempSeriesTitle}
                onChange={(e) => setTempSeriesTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveSeriesTitle()}
                className="media-series-input"
                autoFocus
              />
              <button
                type="button"
                onClick={handleSaveSeriesTitle}
                className="media-icon-btn check"
                title="Save title"
              >
                <Check size={12} />
              </button>
            </div>
          ) : (
            <div className="media-series-display-row">
              <h2 className="media-series-name" title={activeSeries?.title}>
                {(() => {
                  const rawTitle = activeSeries?.title;
                  return (rawTitle && !isCorruptedOrMojibakeTitle(rawTitle)) ? rawTitle : 'រឿងភាគ (Series 1)';
                })()}
              </h2>
              <button
                type="button"
                onClick={handleStartRenameSeries}
                className="media-icon-btn"
                title="Rename series"
              >
                <Edit2 size={12} />
              </button>
            </div>
          )}
        </div>

        {uploadError && (
          <div className="media-error-banner">
            <AlertCircle size={13} style={{ flexShrink: 0 }} />
            <span>{uploadError}</span>
          </div>
        )}

        {/* 3. Source Video Dropzone (Collapses to slim bar once loaded) */}
        <div className="media-section-wrap">
          <div className="media-section-title">
            <HardDrive size={13} color="#38bdf8" />
            <span>វីដេអូប្រភព — ភាគ #{activeEpisode?.episodeNumber || 1}</span>
          </div>

          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => !isUploading && fileInputRef.current?.click()}
            className={`media-dropzone-box ${isDragOver ? 'is-drag-over' : ''} ${hasVideo ? 'is-loaded' : ''}`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              onChange={handleFileChange}
              style={{ display: 'none' }}
              disabled={isUploading}
            />

            {isUploading ? (
              <div className="media-dropzone-loading">
                <Loader2 size={20} className="animate-spin" color="#38bdf8" />
                <span>កំពុង Upload វីដេអូ...</span>
              </div>
            ) : hasVideo ? (
              /* Slim Loaded Card */
              <div className="media-loaded-slim-bar" onClick={(e) => e.stopPropagation()}>
                <div className="media-loaded-left">
                  <FileVideo size={20} color="#38bdf8" style={{ flexShrink: 0 }} />
                  <div className="media-loaded-text-col">
                    <span className="media-loaded-name" title={displayTitle}>
                      {displayTitle}
                    </span>
                    <div className="media-loaded-meta">
                      {videoDurationSec > 0 && (
                        <span>{formatTimecode(videoDurationSec)}</span>
                      )}
                      <span>•</span>
                      <span>{videoMetadata?.width && videoMetadata?.height ? `${videoMetadata.width}x${videoMetadata.height}` : 'HD'}</span>
                    </div>
                  </div>
                </div>

                <div className="media-loaded-actions">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="media-slim-btn"
                    title="ផ្លាស់ប្តូរវីដេអូ (Replace Video)"
                  >
                    <RefreshCw size={11} />
                  </button>
                  {onRemoveVideo && (
                    <button
                      type="button"
                      onClick={onRemoveVideo}
                      className="media-slim-btn danger"
                      title="លុបវីដេអូចេញ (Remove)"
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
              </div>
            ) : (
              /* Compact Dropzone Empty Prompt */
              <div className="media-dropzone-prompt">
                <FolderPlus size={22} color="#38bdf8" />
                <span className="media-prompt-primary">អូសទម្លាក់ ឬចុច Upload វីដេអូ</span>
                <span className="media-prompt-secondary">MP4, MKV, MOV, WebM</span>
              </div>
            )}
          </div>
        </div>

        {/* 4. Episodes List Section */}
        <div className="media-section-wrap episodes-section">
          <div className="media-episodes-header">
            <div className="media-section-title">
              <Layers size={13} color="#38bdf8" />
              <span>បញ្ជីភាគ ({episodes.length})</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {onCreateEpisode && (
                <button
                  type="button"
                  onClick={onCreateEpisode}
                  className="media-mini-action-btn primary"
                  title="បន្ថែមភាគថ្មី (Add Episode)"
                >
                  <Plus size={12} />
                  <span>+ ភាគ</span>
                </button>
              )}

              {hasVideo && (
                <button
                  type="button"
                  onClick={() => setShowSplitModal(true)}
                  className="media-mini-action-btn"
                  title="កាត់បំបែកភាគស្វ័យប្រវត្តិ"
                >
                  <Scissors size={11} color="#38bdf8" />
                  <span>Split</span>
                </button>
              )}
            </div>
          </div>

          <div className="media-episodes-scroll-list">
            {episodes.map((ep, idx) => {
              const isSelected = ep.id === episodeId;
              const hasEpVideo = Boolean(ep.video?.videoId || ep.video?.videoUrl);
              const hasEpScript = Boolean(ep.scriptData?.segments && ep.scriptData.segments.length > 0);
              const hasEpVoice = Boolean(ep.audioGenerated && !ep.audioOutdated);
              const hasEpDemucs = Boolean(ep.hasDemucs || ep.cleanBgmPath);
              const hasEpExport = Boolean(ep.renderedVideo);
              const isEditingThis = editingEpisodeId === ep.id;

              return (
                <div
                  key={ep.id}
                  onClick={() => onSwitchEpisode && onSwitchEpisode(ep.id)}
                  className={`media-episode-item ${isSelected ? 'is-selected' : ''}`}
                >
                  <div className="media-ep-item-top">
                    <span className="media-ep-num-pill">#{ep.episodeNumber || (idx + 1)}</span>

                    {isEditingThis ? (
                      <div className="media-ep-rename-box" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="text"
                          value={tempEpisodeTitle}
                          onChange={(e) => setTempEpisodeTitle(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleSaveEpisodeTitle(e, ep.id)}
                          className="media-ep-rename-input"
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={(e) => handleSaveEpisodeTitle(e, ep.id)}
                          className="media-icon-btn check"
                        >
                          <Check size={11} />
                        </button>
                      </div>
                    ) : (
                      <span className="media-ep-title-text" title={ep.displayTitle || ep.title}>
                        {ep.displayTitle || ep.title || `ភាគទី ${ep.episodeNumber || (idx + 1)}`}
                      </span>
                    )}

                    <div className="media-ep-actions" onClick={(e) => e.stopPropagation()}>
                      {!isEditingThis && onRenameEpisode && (
                        <button
                          type="button"
                          onClick={(e) => handleStartRenameEpisode(e, ep)}
                          className="media-icon-btn"
                          title="Rename episode"
                        >
                          <Edit2 size={11} />
                        </button>
                      )}
                      {onDeleteEpisode && episodes.length > 1 && (
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm(`តើអ្នកពិតជាចង់លុបភាគទី ${ep.episodeNumber || (idx + 1)} មែនទេ?`)) {
                              onDeleteEpisode(ep.id);
                            }
                          }}
                          className="media-icon-btn danger"
                          title="Delete episode"
                        >
                          <Trash2 size={11} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Optional Video Metadata Subline on Selected Row (Point 7) */}
                  {isSelected && hasEpVideo && (
                    <div style={{ fontSize: 11, color: '#64748b', padding: '0 2px' }}>
                      {ep.video?.resolution ? `${ep.video.resolution} • ` : ''}
                      {formatTimecode(ep.video?.duration || (selectedVideo?.duration) || 0)}
                      {ep.video?.fps ? ` • ${ep.video.fps}fps` : ''}
                    </div>
                  )}

                  {/* Status Pills Strip */}
                  <div className="media-ep-status-pills">
                    <span className={`media-ep-pill ${hasEpVideo ? 'done' : 'idle'}`} title="Source Video">
                      Vid {hasEpVideo ? '✓' : '—'}
                    </span>
                    <span className={`media-ep-pill ${hasEpScript ? 'done' : 'idle'}`} title="Khmer Script">
                      Scr {hasEpScript ? '✓' : '—'}
                    </span>
                    <span className={`media-ep-pill ${hasEpVoice ? 'done' : 'idle'}`} title="Khmer Voice TTS">
                      Voice {hasEpVoice ? '✓' : '—'}
                    </span>
                    <span className={`media-ep-pill ${hasEpDemucs ? 'done' : 'idle'}`} title="Demucs AI Clean BGM">
                      BGM {hasEpDemucs ? '✓' : '—'}
                    </span>
                    <span className={`media-ep-pill ${hasEpExport ? 'done' : 'idle'}`} title="Rendered Export">
                      Exp {hasEpExport ? '✓' : '—'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Auto Split Modal */}
      {showSplitModal && (
        <div className="media-modal-backdrop" onClick={() => !isSplitting && setShowSplitModal(false)}>
          <div className="media-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="media-modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Scissors size={16} color="#38bdf8" />
                <span style={{ fontSize: '0.88rem', fontWeight: 800, color: '#f8fafc' }}>
                  Auto-Split Video ទៅជាច្រើនភាគ
                </span>
              </div>
            </div>

            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p style={{ margin: 0, fontSize: '0.78rem', color: '#94a3b8', lineHeight: 1.5 }}>
                ប្រព័ន្ធនឹងកាត់វីដេអូជាបំណែកៗដោយស្វ័យប្រវត្តិ តាមរយៈពេលដែលអ្នកកំណត់ និងបង្កើតភាគថ្មីៗក្នុង Series នេះ។
              </p>

              {videoDurationSec > 0 && (
                <div style={{ padding: '8px 12px', background: 'rgba(56, 189, 248, 0.08)', borderRadius: 6, border: '1px solid rgba(56, 189, 248, 0.2)', fontSize: '0.78rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ color: '#94a3b8' }}>ប្រវែងវីដេអូសរុប:</span>
                    <span style={{ color: '#38bdf8', fontWeight: 700 }}>{formatTimecode(videoDurationSec)} ({Math.round(videoDurationSec)}s)</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#94a3b8' }}>នឹងកាត់បំបែកបាន:</span>
                    <span style={{ color: '#4ade80', fontWeight: 800 }}>{Math.max(1, Math.ceil(videoDurationSec / (splitMinutes * 60)))} ភាគ</span>
                  </div>
                </div>
              )}

              <div>
                <label style={{ display: 'block', fontSize: '0.74rem', color: '#cbd5e1', fontWeight: 700, marginBottom: 6 }}>
                  រយៈពេលក្នុងមួយភាគ (នាទី):
                </label>
                <select
                  value={splitMinutes}
                  onChange={(e) => setSplitMinutes(Number(e.target.value))}
                  className="media-series-input"
                  style={{ width: '100%' }}
                >
                  <option value={1}>1 នាទី (Short Clips / Test — 1 min)</option>
                  <option value={2}>2 នាទី (Short Form — 2 min)</option>
                  <option value={3}>3 នាទី (Micro Drama — 3 min)</option>
                  <option value={5}>5 នាទី (Short Form / TikTok Clips)</option>
                  <option value={10}>10 នាទី (Standard Short Drama)</option>
                  <option value={15}>15 នាទី (Standard Episode)</option>
                  <option value={20}>20 នាទី (Long Episode)</option>
                </select>
              </div>

              {videoDurationSec > 0 && videoDurationSec <= (splitMinutes * 60) && (
                <div style={{ padding: '6px 10px', background: 'rgba(234, 179, 8, 0.1)', borderRadius: 6, color: '#facc15', fontSize: '0.74rem', lineHeight: 1.4 }}>
                  ⚠️ ប្រវែងវីដេអូខ្លីជាង {splitMinutes} នាទី (នឹងចេញតែ ១ ភាគ)។ សូមជ្រើសរើសរយៈពេលខ្លីជាង (ឧ. ១ ឬ ២ នាទី) ដើម្បីកាត់ចេញច្រើនភាគ!
                </div>
              )}

              {splitError && (
                <div style={{ padding: '8px 12px', background: 'rgba(239, 68, 68, 0.15)', borderRadius: 6, color: '#f87171', fontSize: '0.76rem' }}>
                  {splitError}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => setShowSplitModal(false)}
                  disabled={isSplitting}
                  className="media-mini-action-btn"
                  style={{ padding: '6px 14px' }}
                >
                  បោះបង់
                </button>
                <button
                  type="button"
                  onClick={handleExecuteSplit}
                  disabled={isSplitting}
                  className="media-mini-action-btn primary"
                  style={{ padding: '6px 16px' }}
                >
                  {isSplitting ? <Loader2 size={13} className="animate-spin" /> : 'ចាប់ផ្តើមកាត់ភាគ'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
