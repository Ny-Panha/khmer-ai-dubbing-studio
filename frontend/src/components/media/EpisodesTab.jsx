import React, { useState } from 'react';
import { 
  Film, Sparkles, Mic, Download, Plus, Trash2, Edit2, CheckCircle2, 
  Clock, BookOpen, Layers, ArrowRight, Check, AlertCircle, Play, Scissors, Loader2
} from 'lucide-react';
import { splitVideoEpisodesApi } from '../../services/api';
import { formatTimecode } from '../../utils/formatTime';
import { isCorruptedOrMojibakeTitle } from '../../utils/projectStorage';

export default function EpisodesTab({
  seriesList = [],
  activeSeries = null,
  activeEpisode = null,
  selectedVideo = null,
  videoMetadata = null,
  seriesId = null,
  episodeId = null,
  seriesGlossary = null,
  onSwitchEpisode,
  onCreateEpisode,
  onDeleteEpisode,
  onRenameEpisode,
  onRenameSeries,
  onFileUpload,
  isUploading = false,
  onTabChange,
}) {
  const [editingTitleId, setEditingTitleId] = useState(null);
  const [tempTitle, setTempTitle] = useState('');
  const [isEditingSeriesTitle, setIsEditingSeriesTitle] = useState(false);
  const [tempSeriesTitle, setTempSeriesTitle] = useState('');
  const [uploadTargetEpisodeId, setUploadTargetEpisodeId] = useState(null);
  const [showSplitModal, setShowSplitModal] = useState(false);
  const [splitMinutes, setSplitMinutes] = useState(20);
  const [isSplitting, setIsSplitting] = useState(false);

  const handleAutoSplit = async () => {
    const rawRef = selectedVideo?.videoId || selectedVideo?.videoPath || activeEpisode?.video?.videoId || activeEpisode?.videoFile || activeEpisode?.sourceVideoPath;
    if (!rawRef) {
      alert('សូម Import ឬ ជ្រើសរើសវីដេអូវែងជាមុនសិន!');
      return;
    }

    try {
      setIsSplitting(true);
      const res = await splitVideoEpisodesApi({
        videoId: rawRef,
        seriesId: activeSeries?.id || seriesId || 'drama_project',
        durationMinutes: Number(splitMinutes) || 8,
      });

      alert(`🎉 ${res.message || 'បានកាត់បំបែកវីដេអូជាភាគៗជោគជ័យ!'}`);
      setShowSplitModal(false);
      window.location.reload();
    } catch (err) {
      console.error(err);
      alert('កាត់បំបែកវីដេអូបរាជ័យ: ' + err.message);
    } finally {
      setIsSplitting(false);
    }
  };

  const episodes = activeSeries?.episodes || [];
  const glossaryChars = seriesGlossary?.characters || activeSeries?.glossary?.characters || [];

  const handleStartRenameEpisode = (ep) => {
    setEditingTitleId(ep.id);
    setTempTitle(ep.title || `Episode ${ep.episodeNumber}`);
  };

  const handleSaveRenameEpisode = (epId) => {
    if (tempTitle.trim() && onRenameEpisode) {
      onRenameEpisode(epId, tempTitle.trim());
    }
    setEditingTitleId(null);
  };

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

  const handleEpisodeFileInput = (e, epId) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (onFileUpload) {
      onFileUpload(file, epId);
    }
  };

  return (
    <div 
      className="episodes-tab-container media-tab-content" 
      style={{ 
        flex: 1, 
        overflowY: 'auto', 
        overflowX: 'hidden', 
        minHeight: 0, 
        padding: '12px 14px', 
        display: 'flex', 
        flexDirection: 'column', 
        gap: 14 
      }}
    >
      {/* 1. Series Header Card */}
      <div 
        style={{
          background: 'var(--bg-secondary-panel)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-sm)',
          padding: '12px 14px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--accent-cyan)' }}>
            <Layers size={15} />
            <span style={{ fontSize: '0.74rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Series / Drama
            </span>
          </div>

          <span 
            style={{ 
              fontSize: '0.70rem', 
              color: 'var(--text-dim)', 
              background: 'rgba(255,255,255,0.06)', 
              padding: '2px 8px', 
              borderRadius: 10 
            }}
          >
            {episodes.length} Episodes
          </span>
        </div>

        {isEditingSeriesTitle ? (
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <input
              type="text"
              value={tempSeriesTitle}
              onChange={(e) => setTempSeriesTitle(e.target.value)}
              className="capcut-input"
              style={{ flex: 1, fontSize: '0.85rem', padding: '4px 8px' }}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveRenameSeries();
                if (e.key === 'Escape') setIsEditingSeriesTitle(false);
              }}
            />
            <button 
              type="button" 
              onClick={handleSaveRenameSeries} 
              className="btn-primary" 
              style={{ padding: '4px 10px', fontSize: '0.76rem' }}
            >
              Save
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 700, color: '#f1f5f9' }}>
              {(!isCorruptedOrMojibakeTitle(activeSeries?.title) && activeSeries?.title) || 'រឿងភាគ (Series 1)'}
            </h3>
            <button
              type="button"
              onClick={handleStartRenameSeries}
              className="btn-ghost"
              style={{ padding: '2px 6px', fontSize: '0.72rem', color: 'var(--text-muted)' }}
              title="ប្តូរចំណងជើងរឿងភាគ (Rename Series)"
            >
              <Edit2 size={12} />
            </button>
          </div>
        )}
      </div>

      {/* 2. Series Glossary & Character Consistency (Requirement 5) */}
      {glossaryChars.length > 0 && (
        <div
          style={{
            background: 'rgba(56, 189, 248, 0.05)',
            border: '1px solid rgba(56, 189, 248, 0.2)',
            borderRadius: 'var(--radius-sm)',
            padding: '10px 12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <BookOpen size={13} color="var(--accent-cyan)" />
            <span style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--accent-cyan)', textTransform: 'uppercase' }}>
              Series Character Glossary (រក្សាឈ្មោះតួអង្គឆ្លងភាគ)
            </span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {glossaryChars.map((ch, idx) => (
              <span
                key={ch.name || idx}
                style={{
                  fontSize: '0.70rem',
                  padding: '3px 8px',
                  borderRadius: 4,
                  background: 'rgba(30, 41, 59, 0.8)',
                  border: '1px solid rgba(56, 189, 248, 0.3)',
                  color: '#e2e8f0',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <strong>{ch.name}</strong>
                {ch.khmerName && ch.khmerName !== ch.name && (
                  <span style={{ color: 'var(--accent-cyan)' }}>→ {ch.khmerName}</span>
                )}
                <span style={{ fontSize: '0.62rem', color: ch.gender === 'female' ? '#f472b6' : '#60a5fa' }}>
                  ({ch.gender === 'female' ? 'ស្រី' : 'ប្រុស'})
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 3. Episodes List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '0.74rem', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Episodes List ({episodes.length})
          </span>

          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => setShowSplitModal(true)}
              className="btn-ghost"
              style={{
                padding: '4px 8px',
                fontSize: '0.72rem',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                color: '#38bdf8',
                border: '1px dashed rgba(56, 189, 248, 0.4)',
                background: 'rgba(56, 189, 248, 0.08)',
                borderRadius: 'var(--radius-sm)',
              }}
              title="កាត់បំបែកវីដេអូវែង 1-2 ម៉ោងជាភាគៗ (Lossless Fast Stream Copy)"
            >
              <Scissors size={12} />
              <span>⚡ Auto-Split 1-2h</span>
            </button>

            <button
              type="button"
              onClick={() => onCreateEpisode && onCreateEpisode()}
              className="btn-primary"
              style={{
                padding: '4px 10px',
                fontSize: '0.74rem',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                background: 'linear-gradient(135deg, #0284c7, #0369a1)',
                borderColor: '#38bdf8',
              }}
              title="Create next episode (EP2, EP3...)"
            >
              <Plus size={13} />
              <span>+ Add Episode</span>
            </button>
          </div>
        </div>

        {episodes.map((ep, idx) => {
          const isActive = ep.id === episodeId;
          const currentVideo = ep.video || (isActive ? selectedVideo : null);
          const hasVideo = Boolean(currentVideo?.videoId || currentVideo?.videoUrl);
          const epDuration = ep.duration || (isActive ? (selectedVideo?.duration || videoMetadata?.durationSec || 0) : 0);
          const hasScript = Boolean(
            (ep.scriptData?.segments && ep.scriptData.segments.length > 0) ||
            ep.scriptData?.hasScript ||
            (typeof ep.scriptData?.totalSegments === 'number' && ep.scriptData.totalSegments > 0) ||
            ep.status === 'translated' ||
            ep.status === 'voicing' ||
            ep.status === 'completed'
          );
          const hasAudio = Boolean(ep.audioGenerated && !ep.audioOutdated);
          const isExported = Boolean(ep.renderedVideo);

          return (
            <div
              key={ep.id || idx}
              style={{
                background: isActive ? 'rgba(255, 133, 119, 0.08)' : 'var(--bg-secondary-panel)',
                border: isActive ? '1px solid #FF8577' : '1px solid var(--border-subtle)',
                boxShadow: isActive ? '0 0 14px rgba(203, 245, 63, 0.15)' : 'none',
                borderRadius: 'var(--radius-sm)',
                padding: '12px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                transition: 'all 0.15s ease-out',
                position: 'relative',
              }}
            >
              {/* Top Row: Title & Badges */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                  <span
                    style={{
                      fontSize: '0.74rem',
                      fontWeight: 800,
                      padding: '2px 7px',
                      borderRadius: 4,
                      background: isActive ? '#FF8577' : 'rgba(255, 255, 255, 0.1)',
                      color: isActive ? '#0B132B' : '#ffffff',
                    }}
                  >
                    EP{ep.episodeNumber || idx + 1}
                  </span>

                  {editingTitleId === ep.id ? (
                    <div style={{ display: 'flex', gap: 4, flex: 1 }}>
                      <input
                        type="text"
                        value={tempTitle}
                        onChange={(e) => setTempTitle(e.target.value)}
                        className="capcut-input"
                        style={{ padding: '2px 6px', fontSize: '0.80rem', flex: 1 }}
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveRenameEpisode(ep.id);
                          if (e.key === 'Escape') setEditingTitleId(null);
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => handleSaveRenameEpisode(ep.id)}
                        className="btn-primary"
                        style={{ padding: '2px 8px', fontSize: '0.72rem' }}
                      >
                        ✓
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
                      <span
                        style={{
                          fontSize: '0.84rem',
                          fontWeight: 700,
                          color: isActive ? '#38bdf8' : '#f1f5f9',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={ep.title}
                      >
                        {ep.title}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleStartRenameEpisode(ep)}
                        className="btn-ghost"
                        style={{ padding: 2, color: 'var(--text-muted)' }}
                        title="Rename episode"
                      >
                        <Edit2 size={11} />
                      </button>
                    </div>
                  )}
                </div>

                {/* Active Indicator & Delete */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {isActive ? (
                    <span
                      style={{
                        fontSize: '0.68rem',
                        fontWeight: 700,
                        color: '#38bdf8',
                        background: 'rgba(56, 189, 248, 0.15)',
                        border: '1px solid rgba(56, 189, 248, 0.4)',
                        padding: '2px 6px',
                        borderRadius: 4,
                      }}
                    >
                      Active Episode
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onSwitchEpisode && onSwitchEpisode(ep.id)}
                      className="btn-secondary"
                      style={{ padding: '3px 8px', fontSize: '0.72rem', gap: 4 }}
                      title="Switch workspace to this episode"
                    >
                      <span>Open</span>
                      <ArrowRight size={11} />
                    </button>
                  )}

                  {episodes.length > 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`តើអ្នកប្រាកដជាចង់លុប ${ep.title} នេះមែនទេ?`)) {
                          onDeleteEpisode && onDeleteEpisode(ep.id);
                        }
                      }}
                      className="btn-danger-ghost"
                      style={{ padding: 4 }}
                      title="Delete this episode"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>

              {/* Middle Row: Video Info */}
              {hasVideo && currentVideo ? (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    background: 'rgba(0,0,0,0.2)',
                    padding: '6px 10px',
                    borderRadius: 4,
                    fontSize: '0.75rem',
                  }}
                >
                  <Film size={14} color="var(--primary-accent)" />
                  <span
                    style={{
                      color: 'var(--text-primary)',
                      fontWeight: 600,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      flex: 1,
                    }}
                    title={currentVideo.originalFilename || currentVideo.displayTitle || currentVideo.fileName}
                  >
                    {currentVideo.displayTitle || currentVideo.originalFilename || currentVideo.fileName}
                  </span>
                  {epDuration > 0 && (
                    <span style={{ color: 'var(--accent-cyan)', display: 'flex', alignItems: 'center', gap: 3 }}>
                      <Clock size={11} />
                      {formatTimecode(epDuration)}
                    </span>
                  )}
                </div>
              ) : (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    background: 'rgba(255,255,255,0.02)',
                    border: '1px dashed var(--border-subtle)',
                    padding: '8px 10px',
                    borderRadius: 4,
                  }}
                >
                  <span style={{ fontSize: '0.74rem', color: 'var(--text-dim)' }}>
                    មិនទាន់មានវីដេអូសម្រាប់ភាគនេះទេ (No video imported)
                  </span>

                  <label
                    style={{
                      cursor: isUploading ? 'not-allowed' : 'pointer',
                      fontSize: '0.72rem',
                      color: 'var(--primary-accent)',
                      fontWeight: 700,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      background: 'rgba(76, 141, 255, 0.1)',
                      border: '1px solid rgba(76, 141, 255, 0.3)',
                      padding: '3px 8px',
                      borderRadius: 4,
                    }}
                  >
                    <input
                      type="file"
                      accept="video/*"
                      onChange={(e) => handleEpisodeFileInput(e, ep.id)}
                      disabled={isUploading}
                      style={{ display: 'none' }}
                    />
                    <Plus size={11} />
                    <span>Import Video</span>
                  </label>
                </div>
              )}

              {/* Bottom Row: Status Badges */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                <span
                  style={{
                    fontSize: '0.68rem',
                    padding: '2px 6px',
                    borderRadius: 3,
                    background: hasVideo ? 'rgba(52, 211, 153, 0.1)' : 'rgba(255, 255, 255, 0.04)',
                    color: hasVideo ? '#34d399' : 'var(--text-dim)',
                    border: `1px solid ${hasVideo ? 'rgba(52, 211, 153, 0.3)' : 'transparent'}`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 3,
                  }}
                >
                  <Film size={10} />
                  <span>{hasVideo ? 'Video Ready' : 'No Video'}</span>
                </span>

                {/* Generation Mode Badge */}
                {ep.generationMode === 'fast_ocr' || ep.scriptData?.generationMode === 'fast_ocr' ? (
                  <span
                    style={{
                      fontSize: '0.68rem',
                      fontWeight: 700,
                      padding: '2px 6px',
                      borderRadius: 3,
                      background: 'rgba(234, 179, 8, 0.15)',
                      color: '#eab308',
                      border: '1px solid rgba(234, 179, 8, 0.35)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 3,
                    }}
                    title="Fast OCR Mode (Stage 3 ➡️ Translation)"
                  >
                    ⚡ Fast OCR
                  </span>
                ) : (
                  (hasScript || ep.generationMode === 'standard' || ep.scriptData?.generationMode === 'standard') && (
                    <span
                      style={{
                        fontSize: '0.68rem',
                        fontWeight: 600,
                        padding: '2px 6px',
                        borderRadius: 3,
                        background: 'rgba(147, 51, 234, 0.12)',
                        color: '#c084fc',
                        border: '1px solid rgba(147, 51, 234, 0.3)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 3,
                      }}
                      title="Standard Mode (Full 10-Stage Pipeline)"
                    >
                      🎯 Standard
                    </span>
                  )
                )}

                <span
                  style={{
                    fontSize: '0.68rem',
                    padding: '2px 6px',
                    borderRadius: 3,
                    background: hasScript ? 'rgba(56, 189, 248, 0.1)' : 'rgba(255, 255, 255, 0.04)',
                    color: hasScript ? '#38bdf8' : 'var(--text-dim)',
                    border: `1px solid ${hasScript ? 'rgba(56, 189, 248, 0.3)' : 'transparent'}`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 3,
                  }}
                >
                  <Sparkles size={10} />
                  <span>{hasScript ? `Script (${ep.scriptData?.segments?.length || ep.scriptData?.totalSegments || 'រួចរាល់'} ឃ្លា)` : 'No Script'}</span>
                </span>

                <span
                  style={{
                    fontSize: '0.68rem',
                    padding: '2px 6px',
                    borderRadius: 3,
                    background: hasAudio ? 'rgba(168, 85, 247, 0.1)' : 'rgba(255, 255, 255, 0.04)',
                    color: hasAudio ? '#c084fc' : 'var(--text-dim)',
                    border: `1px solid ${hasAudio ? 'rgba(168, 85, 247, 0.3)' : 'transparent'}`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 3,
                  }}
                >
                  <Mic size={10} />
                  <span>{hasAudio ? 'Voice Track A1' : 'No Voice'}</span>
                </span>

                {isExported && (
                  <span
                    style={{
                      fontSize: '0.68rem',
                      padding: '2px 6px',
                      borderRadius: 3,
                      background: 'rgba(34, 197, 94, 0.15)',
                      color: '#4ade80',
                      border: '1px solid rgba(34, 197, 94, 0.4)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 3,
                    }}
                  >
                    <Download size={10} />
                    <span>Rendered MP4</span>
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Auto-Split Modal */}
      {showSplitModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(4px)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            style={{
              background: '#0f172a',
              border: '1px solid #38bdf8',
              borderRadius: 12,
              padding: '20px 24px',
              maxWidth: 420,
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              boxShadow: '0 20px 40px rgba(0, 0, 0, 0.6)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#38bdf8' }}>
              <Scissors size={20} />
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: '#f8fafc' }}>
                Auto-Split វីដេអូវែង (1-2 ម៉ោង) ជាភាគៗ
              </h3>
            </div>

            <p style={{ margin: 0, fontSize: '0.80rem', color: '#94a3b8', lineHeight: 1.5 }}>
              បច្ចេកវិទ្យា <strong>Fast Lossless Stream Copy</strong> ជួយកាត់ចែកវីដេអូវែងជា Episode (EP1, EP2, EP3...) ក្នុងពេលត្រឹមតែ <strong>5-10 វិនាទីប៉ុណ្ណោះ</strong> ដោយមិនខូចគុណភាពរូបភាព!
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#cbd5e1' }}>
                កំណត់ប្រវែងក្នុង 1 ភាគ (នាទី / Episode):
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                {[5, 10, 15, 20, 30].map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setSplitMinutes(m)}
                    className={splitMinutes === m ? 'btn-primary' : 'btn-ghost'}
                    style={{
                      flex: 1,
                      padding: '6px 0',
                      fontSize: '0.78rem',
                      fontWeight: 600,
                      borderRadius: 6,
                      border: splitMinutes === m ? '1.5px solid #38bdf8' : '1px solid #334155',
                      background: splitMinutes === m ? '#0284c7' : '#1e293b',
                      color: splitMinutes === m ? '#ffffff' : '#94a3b8',
                    }}
                  >
                    {m} នាទី
                  </button>
                ))}
              </div>
            </div>

            <div
              style={{
                background: 'rgba(56, 189, 248, 0.08)',
                border: '1px solid rgba(56, 189, 248, 0.2)',
                borderRadius: 8,
                padding: '8px 12px',
                fontSize: '0.76rem',
                color: '#38bdf8',
              }}
            >
              💡 <strong>ការណែនាំ៖</strong> សម្រាប់ TikTok/Reels កំណត់ត្រឹម <strong>5 ឬ 8 នាទី</strong> ជួយឱ្យទទួលបាន Views និង Engagement ខ្ពស់បំផុត។
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
              <button
                type="button"
                onClick={() => setShowSplitModal(false)}
                disabled={isSplitting}
                className="btn-ghost"
                style={{ padding: '6px 14px', fontSize: '0.80rem' }}
              >
                បោះបង់ (Cancel)
              </button>
              <button
                type="button"
                onClick={handleAutoSplit}
                disabled={isSplitting}
                className="btn-primary"
                style={{
                  padding: '6px 16px',
                  fontSize: '0.80rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  background: 'linear-gradient(135deg, #0284c7, #0369a1)',
                  borderColor: '#38bdf8',
                }}
              >
                {isSplitting ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>កំពុងកាត់ចែកភាគ...</span>
                  </>
                ) : (
                  <>
                    <Scissors size={14} />
                    <span>កាត់បំបែកឥឡូវនេះ (Split Now)</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
