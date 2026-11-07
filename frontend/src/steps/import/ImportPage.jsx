import React, { useState, useRef } from 'react';
import { 
  FolderPlus, Loader2, AlertCircle, Film, Check, Trash2, Clock, 
  HardDrive, Plus, Edit2, Play, Scissors, Layers, CheckCircle2,
  Sparkles, Mic, Volume2, Download, ArrowRight, RefreshCw, FileVideo
} from 'lucide-react';
import { splitVideoEpisodesApi, uploadVideoFile } from '../../services/api';
import { formatTimecode } from '../../utils/formatTime';
import { isCorruptedOrMojibakeTitle } from '../../utils/projectStorage';
import './ImportPage.css';

export default function ImportPage({
  selectedVideo = null,
  videoMetadata = null,
  isUploading: externalIsUploading = false,
  uploadError: externalUploadError = null,
  onFileUpload = null,
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
  onResetAllEpisodes = null,
  onNavigateToStep = null,
}) {
  const fileInputRef = useRef(null);
  const [internalIsUploading, setInternalIsUploading] = useState(false);
  const [internalUploadError, setInternalUploadError] = useState(null);
  const isUploading = externalIsUploading || internalIsUploading;
  const uploadError = externalUploadError || internalUploadError;

  const [isDragOver, setIsDragOver] = useState(false);
  const [isEditingSeriesTitle, setIsEditingSeriesTitle] = useState(false);
  const [tempSeriesTitle, setTempSeriesTitle] = useState('');
  const [editingEpisodeId, setEditingEpisodeId] = useState(null);
  const [tempEpisodeTitle, setTempEpisodeTitle] = useState('');
  const [showSplitModal, setShowSplitModal] = useState(false);
  const [splitMinutes, setSplitMinutes] = useState(15);
  const [isSplitting, setIsSplitting] = useState(false);
  const [splitError, setSplitError] = useState(null);

  const episodes = activeSeries?.episodes || [];
  const hasVideo = Boolean(selectedVideo?.videoId || selectedVideo?.videoUrl || activeEpisode?.video?.videoId);
  const videoDurationSec = videoMetadata?.durationSec || selectedVideo?.durationSec || 0;
  const displayTitle = selectedVideo?.displayTitle || selectedVideo?.originalFilename || selectedVideo?.fileName || activeEpisode?.title || 'វីដេអូភាគ (Episode Video)';

  const executeUpload = async (file) => {
    if (!file) return;
    if (onFileUpload) {
      onFileUpload(file);
      return;
    }
    try {
      setInternalIsUploading(true);
      setInternalUploadError(null);
      const vidObj = await uploadVideoFile(file, { seriesId, episodeId });
      if (onVideoSelected) {
        onVideoSelected(vidObj);
      }
    } catch (err) {
      console.error(err);
      setInternalUploadError(err.message || 'Upload failed');
    } finally {
      setInternalIsUploading(false);
    }
  };

  // Drag and drop handlers
  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      executeUpload(files[0]);
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      executeUpload(file);
    }
  };

  // Series rename
  const handleStartRenameSeries = () => {
    setIsEditingSeriesTitle(true);
    setTempSeriesTitle(activeSeries?.title || 'រឿងភាគ');
  };

  const handleSaveRenameSeries = () => {
    if (tempSeriesTitle.trim() && onRenameSeries) {
      onRenameSeries(tempSeriesTitle.trim());
    }
    setIsEditingSeriesTitle(false);
  };

  // Episode rename
  const handleStartRenameEpisode = (ep) => {
    setEditingEpisodeId(ep.id);
    setTempEpisodeTitle(ep.title || `Episode ${ep.episodeNumber}`);
  };

  const handleSaveRenameEpisode = (epId) => {
    if (tempEpisodeTitle.trim() && onRenameEpisode) {
      onRenameEpisode(epId, tempEpisodeTitle.trim());
    }
    setEditingEpisodeId(null);
  };

  // Auto split
  const handleAutoSplit = async () => {
    const rawRef = selectedVideo?.videoId || selectedVideo?.videoPath || activeEpisode?.video?.videoId;
    if (!rawRef) {
      alert('សូមជ្រើសរើសវីដេអូជាមុនសិន!');
      return;
    }
    try {
      setIsSplitting(true);
      setSplitError(null);
      const res = await splitVideoEpisodesApi({
        videoId: rawRef,
        seriesId: activeSeries?.id || seriesId || 'drama_project',
        durationMinutes: Number(splitMinutes) || 15,
      });
      alert(`🎉 ${res.message || 'បានកាត់បំបែកវីដេអូជាភាគៗជោគជ័យ!'}`);
      setShowSplitModal(false);
      window.location.reload();
    } catch (err) {
      setSplitError(err.message || 'កាត់បំបែកវីដេអូបរាជ័យ');
    } finally {
      setIsSplitting(false);
    }
  };

  return (
    <div className="import-page-container">
      {/* Top Section: Series Management Header */}
      <div className="import-page-header">
        <div className="import-series-box">
          <div className="import-series-icon">
            <Film size={20} color="#38bdf8" />
          </div>
          <div className="import-series-info">
            <span className="import-series-eyebrow">គម្រោងរឿងភាគ (DRAMA SERIES)</span>
            {isEditingSeriesTitle ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                <input
                  type="text"
                  value={tempSeriesTitle}
                  onChange={(e) => setTempSeriesTitle(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveRenameSeries()}
                  autoFocus
                  className="import-input"
                  style={{ fontSize: '1rem', fontWeight: 700, padding: '3px 8px' }}
                />
                <button type="button" onClick={handleSaveRenameSeries} className="import-btn-primary small">Save</button>
                <button type="button" onClick={() => setIsEditingSeriesTitle(false)} className="import-btn-ghost small">Cancel</button>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h1 className="import-series-title">
                  {(() => {
                    const rawTitle = activeSeries?.title;
                    return (rawTitle && !isCorruptedOrMojibakeTitle(rawTitle)) ? rawTitle : 'រឿងភាគចិន (Drama Project)';
                  })()}
                </h1>
                <button 
                  type="button" 
                  onClick={handleStartRenameSeries} 
                  className="import-icon-btn" 
                  title="Rename series"
                >
                  <Edit2 size={13} />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {onCreateEpisode && (
            <button
              type="button"
              onClick={onCreateEpisode}
              className="import-btn-primary"
            >
              <Plus size={15} />
              <span>+ បង្កើតភាគថ្មី (Add Episode)</span>
            </button>
          )}

          {hasVideo && (
            <button
              type="button"
              onClick={() => setShowSplitModal(true)}
              className="import-btn-secondary"
              title="កាត់បំបែកវីដេអូវែងជាច្រើនភាគដោយស្វ័យប្រវត្តិ"
            >
              <Scissors size={14} color="#38bdf8" />
              <span>Auto-Split Episodes</span>
            </button>
          )}
        </div>
      </div>

      {uploadError && (
        <div className="import-error-banner">
          <AlertCircle size={16} />
          <span>{uploadError}</span>
        </div>
      )}

      {/* Main Grid: Left Dropzone & Right Episode List */}
      <div className="import-page-grid">
        {/* Left Column: Big Hero Dropzone */}
        <div className="import-dropzone-col">
          <div className="import-card-title">
            <HardDrive size={16} color="#38bdf8" />
            <span>វីដេអូប្រភពដើម (Source Video) — ភាគទី {activeEpisode?.episodeNumber || 1}</span>
          </div>

          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => !isUploading && fileInputRef.current?.click()}
            className={`import-hero-dropzone ${isDragOver ? 'drag-over' : ''} ${hasVideo ? 'has-video' : ''}`}
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
              <div className="import-dropzone-center">
                <Loader2 size={36} className="animate-spin" color="#38bdf8" />
                <span className="import-dropzone-primary-text">កំពុង Upload និងរៀបចំវីដេអូ...</span>
                <span className="import-dropzone-sub-text">សូមរង់ចាំបន្តិច ប្រព័ន្ធកំពុងដំណើរការ</span>
              </div>
            ) : hasVideo ? (
              <div className="import-video-loaded-card" onClick={(e) => e.stopPropagation()}>
                <div className="import-video-loaded-icon">
                  <FileVideo size={36} color="#38bdf8" />
                </div>
                <div className="import-video-loaded-details">
                  <div className="import-video-name">{displayTitle}</div>
                  <div className="import-video-meta-chips">
                    {videoDurationSec > 0 && (
                      <span className="import-chip">
                        <Clock size={11} />
                        <span>{formatTimecode(videoDurationSec)}</span>
                      </span>
                    )}
                    {videoMetadata?.resolution && (
                      <span className="import-chip">{videoMetadata.resolution}</span>
                    )}
                    <span className="import-chip success">
                      <Check size={11} strokeWidth={3} />
                      <span>Ready to Dub</span>
                    </span>
                  </div>
                </div>

                <div className="import-video-actions">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="import-btn-secondary small"
                  >
                    <RefreshCw size={13} />
                    <span>ផ្លាស់ប្តូរវីដេអូ</span>
                  </button>
                  {onRemoveVideo && (
                    <button
                      type="button"
                      onClick={onRemoveVideo}
                      className="import-btn-ghost danger small"
                    >
                      <Trash2 size={13} />
                      <span>លុប</span>
                    </button>
                  )}
                </div>

                {onNavigateToStep && (
                  <button
                    type="button"
                    onClick={() => onNavigateToStep('script')}
                    className="import-proceed-btn"
                  >
                    <span>បន្តទៅ Step 2: Translate & Script</span>
                    <ArrowRight size={16} />
                  </button>
                )}
              </div>
            ) : (
              <div className="import-dropzone-center">
                <div className="import-dropzone-icon-bubble">
                  <FolderPlus size={36} color="#38bdf8" />
                </div>
                <span className="import-dropzone-primary-text">
                  អូសទម្លាក់វីដេអូ ឬចុចដើម្បីជ្រើសរើស (Drag & Drop Video)
                </span>
                <span className="import-dropzone-sub-text">
                  គាំទ្រ MP4, MKV, MOV, WEBM (ទំហំធំ ឬវែង ដំណើរការបានរលូន)
                </span>
                <button
                  type="button"
                  className="import-btn-primary"
                  style={{ marginTop: 14 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                >
                  <FolderPlus size={15} />
                  <span>ជ្រើសរើសវីដេអូ (Select Video File)</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Episode List with Per-Episode Status */}
        <div className="import-episodes-col">
          <div className="import-episodes-header">
            <div className="import-card-title">
              <Layers size={16} color="#38bdf8" />
              <span>បញ្ជីភាគទាំងអស់ (Episodes List — {episodes.length} ភាគ)</span>
            </div>
            {episodes.length > 1 && onResetAllEpisodes && (
              <button
                type="button"
                onClick={() => {
                  if (confirm('តើអ្នកពិតជាចង់កំណត់ភាគទាំងអស់ឡើងវិញ (Reset All Episodes) មែនទេ?')) {
                    onResetAllEpisodes();
                  }
                }}
                className="import-btn-ghost danger small"
                title="Reset all episodes"
              >
                <Trash2 size={12} />
                <span>Reset All</span>
              </button>
            )}
          </div>

          <div className="import-episodes-scroll-list">
            {episodes.length === 0 ? (
              <div className="import-empty-state">
                <Film size={28} color="#64748b" />
                <span>មិនទាន់មានភាគនៅឡើយទេ។ ចុចប៊ូតុង "+ បង្កើតភាគថ្មី" ដើម្បីចាប់ផ្តើម។</span>
              </div>
            ) : (
              episodes.map((ep, idx) => {
                const isSelected = ep.id === episodeId;
                const hasEpVideo = Boolean(ep.video?.videoId || ep.video?.videoUrl || ep.videoFile);
                const hasEpScript = Boolean(ep.scriptData?.segments?.length);
                const hasEpAudio = Boolean(ep.audioGenerated || ep.hasAudio);
                const hasEpDemucs = Boolean(ep.hasDemucs || ep.isDemucsDone);
                const isExported = Boolean(ep.renderedVideo);

                return (
                  <div
                    key={ep.id || idx}
                    onClick={() => onSwitchEpisode && onSwitchEpisode(ep.id)}
                    className={`import-episode-card ${isSelected ? 'selected' : ''}`}
                  >
                    <div className="import-episode-card-top">
                      <div className="import-episode-num-badge">
                        #{ep.episodeNumber || (idx + 1)}
                      </div>

                      <div className="import-episode-title-area">
                        {editingEpisodeId === ep.id ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }} onClick={(e) => e.stopPropagation()}>
                            <input
                              type="text"
                              value={tempEpisodeTitle}
                              onChange={(e) => setTempEpisodeTitle(e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && handleSaveRenameEpisode(ep.id)}
                              autoFocus
                              className="import-input"
                              style={{ fontSize: '0.84rem', padding: '2px 6px' }}
                            />
                            <button type="button" onClick={() => handleSaveRenameEpisode(ep.id)} className="import-btn-primary small">OK</button>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span className="import-episode-title">
                              {ep.title || `ភាគ ${ep.episodeNumber || (idx + 1)}`}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleStartRenameEpisode(ep);
                              }}
                              className="import-icon-btn"
                              title="Rename episode"
                            >
                              <Edit2 size={11} />
                            </button>
                          </div>
                        )}
                      </div>

                      {episodes.length > 1 && onDeleteEpisode && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm(`តើអ្នកចង់លុបភាគ "${ep.title || (idx + 1)}" មែនទេ?`)) {
                              onDeleteEpisode(ep.id);
                            }
                          }}
                          className="import-icon-btn danger"
                          title="Delete episode"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>

                    {/* Step Status Badges */}
                    <div className="import-episode-status-row">
                      <span className={`import-status-pill ${hasEpVideo ? 'done' : 'pending'}`}>
                        <FileVideo size={11} />
                        <span>Video: {hasEpVideo ? '✓' : '—'}</span>
                      </span>

                      <span className={`import-status-pill ${hasEpScript ? 'done' : 'pending'}`}>
                        <Sparkles size={11} />
                        <span>Script: {hasEpScript ? `${ep.scriptData.segments.length}` : '—'}</span>
                      </span>

                      <span className={`import-status-pill ${hasEpAudio ? 'done' : 'pending'}`}>
                        <Mic size={11} />
                        <span>Voice: {hasEpAudio ? '✓' : '—'}</span>
                      </span>

                      <span className={`import-status-pill ${hasEpDemucs ? 'done' : 'pending'}`}>
                        <Volume2 size={11} />
                        <span>BGM: {hasEpDemucs ? '✓' : '—'}</span>
                      </span>

                      <span className={`import-status-pill ${isExported ? 'done' : 'pending'}`}>
                        <Download size={11} />
                        <span>Export: {isExported ? '✓' : '—'}</span>
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Auto Split Modal */}
      {showSplitModal && (
        <div className="import-modal-overlay" onClick={() => setShowSplitModal(false)}>
          <div className="import-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="import-modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Scissors size={18} color="#38bdf8" />
                <h3 style={{ margin: 0, fontSize: '1rem', color: '#f1f5f9' }}>Auto-Split Episodes (កាត់បំបែកជាភាគៗ)</h3>
              </div>
              <button type="button" onClick={() => setShowSplitModal(false)} className="import-icon-btn">✕</button>
            </div>

            {splitError && (
              <div className="import-error-banner" style={{ margin: '12px 0' }}>
                <AlertCircle size={15} />
                <span>{splitError}</span>
              </div>
            )}

            <p style={{ fontSize: '0.84rem', color: '#94a3b8', lineHeight: 1.5, marginTop: 12 }}>
              ប្រព័ន្ធនឹងកាត់វីដេអូវែងនេះជាភាគៗស្វ័យប្រវត្តិតាមនាទីដែលអ្នកកំណត់ ហើយបញ្ចូលទៅក្នុងបញ្ជី Episode ដោយស្វ័យប្រវត្តិ។
            </p>

            <div style={{ margin: '16px 0' }}>
              <label style={{ fontSize: '0.80rem', color: '#cbd5e1', fontWeight: 600, display: 'block', marginBottom: 6 }}>
                ប្រវែងក្នុងមួយភាគ (Duration per episode, minutes):
              </label>
              <input
                type="number"
                min="1"
                max="60"
                value={splitMinutes}
                onChange={(e) => setSplitMinutes(e.target.value)}
                className="import-input"
                style={{ width: '100%' }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <button type="button" onClick={() => setShowSplitModal(false)} className="import-btn-ghost">Cancel</button>
              <button
                type="button"
                disabled={isSplitting}
                onClick={handleAutoSplit}
                className="import-btn-primary"
              >
                {isSplitting ? <Loader2 size={14} className="animate-spin" /> : <Scissors size={14} />}
                <span>{isSplitting ? 'កំពុងកាត់វីដេអូ...' : 'ចាប់ផ្តើមកាត់ (Start Split)'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
