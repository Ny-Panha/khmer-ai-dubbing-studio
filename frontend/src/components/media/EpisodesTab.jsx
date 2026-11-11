import React, { useState } from 'react';
import { 
  Film, Sparkles, Mic, Download, Plus, Trash2, Edit2, CheckCircle2, 
  Clock, BookOpen, Layers, ArrowRight, Check, AlertCircle, Play, Scissors, Loader2
} from 'lucide-react';
import { splitVideoEpisodesApi } from '../../services/api';
import { formatTimecode } from '../../utils/formatTime';
import { isCorruptedOrMojibakeTitle } from '../../utils/projectStorage';
import { checkEpisodeHasScript, getEpisodeSegmentCount } from '../dashboard/geminiRouteHelpers';
import { DubbingStepButton, useDubbingFeature } from '../../features/dubbing-runner';

export default function EpisodesTab({
  seriesList = [],
  activeSeries = null,
  activeEpisode = null,
  selectedVideo = null,
  videoMetadata = null,
  duration = 0,
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
  onRefreshSeries = null,
}) {
  const [editingTitleId, setEditingTitleId] = useState(null);
  const [tempTitle, setTempTitle] = useState('');
  const [isEditingSeriesTitle, setIsEditingSeriesTitle] = useState(false);
  const [tempSeriesTitle, setTempSeriesTitle] = useState('');
  const [uploadTargetEpisodeId, setUploadTargetEpisodeId] = useState(null);
  const [showSplitModal, setShowSplitModal] = useState(false);
  const [splitMode, setSplitMode] = useState('minutes'); // 'minutes' | 'episodes'
  const [splitValue, setSplitValue] = useState(''); // starts empty: no preset/default
  const [replaceEpisodes, setReplaceEpisodes] = useState(false); // default: false (append, never silent replace)
  const [isSplitting, setIsSplitting] = useState(false);
  const [splitError, setSplitError] = useState(null);
  const [splitNotice, setSplitNotice] = useState(null); // { type: 'success', text } inline banner after split

  const activeDuration = videoMetadata?.durationSec || videoMetadata?.duration || duration || selectedVideo?.durationSec || selectedVideo?.duration || activeEpisode?.video?.durationSec || activeEpisode?.duration || 0;

  const parsedVal = parseFloat(splitValue);
  const isValidSplit = !isNaN(parsedVal) && (
    splitMode === 'minutes' ? parsedVal > 0 : (parsedVal >= 2 && Number.isInteger(parsedVal))
  );

  const estimatedEpisodes = isValidSplit && activeDuration > 0
    ? (splitMode === 'minutes' ? Math.ceil(activeDuration / (parsedVal * 60)) : parsedVal)
    : null;

  const estimatedDurPerEp = isValidSplit && activeDuration > 0
    ? (splitMode === 'minutes' ? Math.round(parsedVal * 60) : Math.round(activeDuration / parsedVal))
    : null;

  const handleAutoSplit = async () => {
    const rawRef = selectedVideo?.videoId || selectedVideo?.videoPath || activeEpisode?.video?.videoId || activeEpisode?.videoFile || activeEpisode?.sourceVideoPath;
    if (!rawRef) {
      setSplitError('សូម Import ឬ ជ្រើសរើសវីដេអូវែងជាមុនសិន!');
      return;
    }

    if (!isValidSplit) {
      const msg = splitMode === 'minutes'
        ? 'សូមបញ្ចូលចំនួននាទីដែលត្រឹមត្រូវ (> 0)!'
        : 'សូមបញ្ចូលចំនួនភាគដែលត្រឹមត្រូវ (យ៉ាងតិច ២ ភាគ)!';
      setSplitError(msg);
      return;
    }

    try {
      setIsSplitting(true);
      setSplitError(null);
      setSplitNotice(null);
      const res = await splitVideoEpisodesApi({
        videoId: rawRef,
        seriesId: activeSeries?.id || seriesId || 'drama_project',
        episodeId: activeEpisode?.id || selectedVideo?.episodeId,
        durationMinutes: splitMode === 'minutes' ? parsedVal : undefined,
        episodeCount: splitMode === 'episodes' ? parsedVal : undefined,
        replaceEpisodes: Boolean(replaceEpisodes),
      });

      setShowSplitModal(false);
      // SPA refresh: pull fresh series from server instead of a full page reload
      if (typeof onRefreshSeries === 'function') {
        try { await onRefreshSeries(); } catch (refreshErr) { console.warn('[EpisodesTab] refresh after split failed:', refreshErr); }
      }
      setSplitNotice({ type: 'success', text: `✅ ${res?.message || 'បានកាត់បំបែកវីដេអូជាភាគៗជោគជ័យ!'}` });
    } catch (err) {
      console.error(err);
      setSplitError(err.message || 'កាត់បំបែកវីដេអូបរាជ័យ');
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
                {(() => {
                  const g = String(ch.gender || '').toLowerCase();
                  const isFemale = g === 'female' || (ch.voiceId && ch.voiceId.includes('Sreymom')) || (ch.name && /ស្រី|នាង|យាយ|ម៉ែ|កញ្ញា|ជំទាវ/i.test(ch.name));
                  return (
                    <span style={{ fontSize: '0.62rem', color: isFemale ? '#f472b6' : '#60a5fa' }}>
                      ({isFemale ? 'ស្រី' : 'ប្រុស'})
                    </span>
                  );
                })()}
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
              onClick={() => {
                setSplitError(null);
                setShowSplitModal(true);
              }}
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
              title="កាត់បំបែកវីដេអូជាភាគៗ (Split into Episodes)"
            >
              <Scissors size={12} />
              <span>⚡ Auto-Split</span>
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

        {splitNotice && (
          <div
            role="status"
            data-testid="episode-split-status-banner"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              padding: '6px 10px',
              borderRadius: 6,
              fontSize: '0.74rem',
              fontWeight: 600,
              color: '#6EE7B7',
              background: 'rgba(16, 185, 129, 0.12)',
              border: '1px solid rgba(52, 211, 153, 0.35)',
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <CheckCircle2 size={13} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{splitNotice.text}</span>
            </span>
            <button
              type="button"
              onClick={() => setSplitNotice(null)}
              aria-label="បិទសារ (Dismiss)"
              style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: '0.9rem', lineHeight: 1, padding: 2 }}
            >
              ×
            </button>
          </div>
        )}

        {episodes.map((ep, idx) => {
          const isActive = ep.id === episodeId;
          const currentVideo = ep.video || (isActive ? selectedVideo : null);
          const hasVideo = Boolean(currentVideo?.videoId || currentVideo?.videoUrl);
          const epDuration = ep.duration || (isActive ? (selectedVideo?.duration || videoMetadata?.durationSec || 0) : 0);
          const hasScript = checkEpisodeHasScript(ep);
          const segmentCount = getEpisodeSegmentCount(ep);
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
                  <span>{hasScript ? `Script (${segmentCount} ឃ្លា)` : 'No Script'}</span>
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

              {/* Episode Quick 1-by-1 Dubbing Action */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, paddingTop: 6, borderTop: '1px solid rgba(255, 255, 255, 0.05)' }}>
                <DubbingStepButton
                  step="all3"
                  episodes={[ep]}
                  variant="pill"
                  onComplete={onRefreshSeries}
                />
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
          onClick={() => !isSplitting && setShowSplitModal(false)}
        >
          <div
            style={{
              background: '#0f172a',
              border: '1px solid rgba(56, 189, 248, 0.4)',
              borderRadius: 12,
              padding: '20px 24px',
              maxWidth: 460,
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              boxShadow: '0 20px 40px rgba(0, 0, 0, 0.6)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#38bdf8' }}>
              <Scissors size={20} />
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: '#f8fafc' }}>
                Auto-Split វីដេអូជាភាគៗ (Split into Episodes)
              </h3>
            </div>

            <p style={{ margin: 0, fontSize: '0.80rem', color: '#94a3b8', lineHeight: 1.5 }}>
              បច្ចេកវិទ្យា <strong>Fast Lossless Stream Copy</strong> ជួយកាត់ចែកវីដេអូវែងជា Episode (EP1, EP2, EP3...) ក្នុងពេលត្រឹមតែ <strong>5-10 វិនាទីប៉ុណ្ណោះ</strong> ដោយមិនខូចគុណភាពរូបភាព!
            </p>

            {/* Split Mode Selector (Minutes vs Episode Count) */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <button
                type="button"
                onClick={() => {
                  setSplitMode('minutes');
                  setSplitError(null);
                }}
                style={{
                  padding: '7px 10px',
                  borderRadius: 6,
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  border: splitMode === 'minutes' ? '1.5px solid #38bdf8' : '1px solid rgba(255,255,255,0.1)',
                  background: splitMode === 'minutes' ? 'rgba(56, 189, 248, 0.15)' : 'rgba(255,255,255,0.03)',
                  color: splitMode === 'minutes' ? '#38bdf8' : '#94a3b8',
                  transition: 'all 0.15s ease',
                }}
              >
                ⏱️ តាមនាទី (Minutes)
              </button>
              <button
                type="button"
                onClick={() => {
                  setSplitMode('episodes');
                  setSplitError(null);
                }}
                style={{
                  padding: '7px 10px',
                  borderRadius: 6,
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  border: splitMode === 'episodes' ? '1.5px solid #38bdf8' : '1px solid rgba(255,255,255,0.1)',
                  background: splitMode === 'episodes' ? 'rgba(56, 189, 248, 0.15)' : 'rgba(255,255,255,0.03)',
                  color: splitMode === 'episodes' ? '#38bdf8' : '#94a3b8',
                  transition: 'all 0.15s ease',
                }}
              >
                🎬 តាមចំនួនភាគ (Episodes)
              </button>
            </div>

            {/* Value Input (Starts Empty — Never Defaults Silently) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#cbd5e1' }}>
                {splitMode === 'minutes'
                  ? 'កំណត់ប្រវែងក្នុង 1 ភាគ (នាទី / Episode):'
                  : 'កំណត់ចំនួនភាគដែលត្រូវកាត់បំបែក (Episode Count):'}
              </label>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="number"
                  min={splitMode === 'minutes' ? '0.5' : '2'}
                  step={splitMode === 'minutes' ? '0.5' : '1'}
                  value={splitValue}
                  onChange={(e) => {
                    setSplitValue(e.target.value);
                    setSplitError(null);
                  }}
                  placeholder={splitMode === 'minutes' ? 'ឧ. 15 (វាយបញ្ចូលចំនួននាទី...)' : 'ឧ. 3 (វាយបញ្ចូលចំនួនភាគ...)'}
                  style={{
                    flex: 1,
                    background: '#1e293b',
                    border: '1px solid rgba(56, 189, 248, 0.3)',
                    borderRadius: 6,
                    padding: '8px 12px',
                    fontSize: '0.84rem',
                    color: '#f8fafc',
                    outline: 'none',
                  }}
                  autoFocus
                />
                <span style={{ fontSize: '0.78rem', color: '#94a3b8', whiteSpace: 'nowrap' }}>
                  {splitMode === 'minutes' ? 'នាទី / ភាគ' : 'ភាគសរុប'}
                </span>
              </div>

              {/* Optional Preset Chips (Only fill field on active user click, no auto-apply) */}
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                {(splitMode === 'minutes' ? [5, 10, 15, 20, 30] : [2, 3, 5, 10]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      setSplitValue(String(m));
                      setSplitError(null);
                    }}
                    style={{
                      flex: 1,
                      padding: '5px 0',
                      fontSize: '0.74rem',
                      fontWeight: 700,
                      borderRadius: 5,
                      border: splitValue === String(m) ? '1.5px solid #38bdf8' : '1px solid #334155',
                      background: splitValue === String(m) ? '#0284c7' : '#1e293b',
                      color: splitValue === String(m) ? '#ffffff' : '#94a3b8',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {m} {splitMode === 'minutes' ? 'នាទី' : 'ភាគ'}
                  </button>
                ))}
              </div>
            </div>

            {/* Estimated Episodes Calculation Box (ONLY appears when a valid value > 0 is typed) */}
            {isValidSplit && activeDuration > 0 && (
              <div
                style={{
                  background: 'rgba(56, 189, 248, 0.08)',
                  border: '1px solid rgba(56, 189, 248, 0.25)',
                  borderRadius: 8,
                  padding: '10px 12px',
                  fontSize: '0.76rem',
                  color: '#e2e8f0',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#38bdf8', fontWeight: 700 }}>
                  <span>ប្រវែងវីដេអូសរុប៖ {formatTimecode(activeDuration)}</span>
                  <span>{splitMode === 'minutes' ? `កាត់ម្ដង៖ ${parsedVal} នាទី` : `ចំនួនភាគ៖ ${parsedVal} ភាគ`}</span>
                </div>
                <div style={{ color: '#cbd5e1', fontSize: '0.72rem' }}>
                  {splitMode === 'minutes'
                    ? `👉 នឹងបង្កើតបានចំនួន ~${estimatedEpisodes} ភាគ (${formatTimecode(activeDuration / (estimatedEpisodes || 1))} / ភាគ) ស្វ័យប្រវត្ត។`
                    : `👉 នឹងបង្កើតបានចំនួន ${parsedVal} ភាគ (~${formatTimecode(estimatedDurPerEp || 0)} / ភាគ) ស្វ័យប្រវត្ត។`}
                </div>
              </div>
            )}

            {/* Replace Episodes Checkbox (Default: FALSE) */}
            <label
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                cursor: 'pointer',
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: 6,
                padding: '8px 10px',
              }}
            >
              <input
                type="checkbox"
                checked={replaceEpisodes}
                onChange={(e) => setReplaceEpisodes(e.target.checked)}
                style={{ marginTop: 2, cursor: 'pointer' }}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: '0.76rem', fontWeight: 700, color: '#f1f5f9' }}>
                  ជំនួសភាគចាស់ៗទាំងអស់ (Replace existing episodes)
                </span>
                <span style={{ fontSize: '0.68rem', color: '#94a3b8' }}>
                  ប្រសិនបើមិនធីកទេ ភាគថ្មីៗដែលកាត់បាន នឹងត្រូវបន្ថែមបន្តបន្ទាប់ពីភាគចាស់ (Append to existing episodes)
                </span>
              </div>
            </label>

            {splitError && (
              <div style={{ fontSize: '0.74rem', color: '#f87171', background: 'rgba(248, 113, 113, 0.12)', border: '1px solid rgba(248, 113, 113, 0.3)', padding: '6px 10px', borderRadius: 6 }}>
                ⚠️ {splitError}
              </div>
            )}

            {/* Modal Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
              <button
                type="button"
                onClick={() => {
                  setShowSplitModal(false);
                  setSplitError(null);
                }}
                disabled={isSplitting}
                style={{
                  padding: '7px 14px',
                  background: 'transparent',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  borderRadius: 6,
                  color: '#94a3b8',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  cursor: isSplitting ? 'not-allowed' : 'pointer',
                }}
              >
                បោះបង់ (Cancel)
              </button>
              <button
                type="button"
                onClick={handleAutoSplit}
                disabled={!isValidSplit || isSplitting}
                style={{
                  padding: '7px 16px',
                  background: isValidSplit
                    ? 'linear-gradient(135deg, #0284c7, #0369a1)'
                    : 'rgba(255, 255, 255, 0.08)',
                  border: isValidSplit ? '1px solid #38bdf8' : '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: 6,
                  color: isValidSplit ? '#ffffff' : '#64748b',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  cursor: (isValidSplit && !isSplitting) ? 'pointer' : 'not-allowed',
                  boxShadow: isValidSplit ? '0 2px 8px rgba(2, 132, 199, 0.3)' : 'none',
                  opacity: isValidSplit ? 1 : 0.6,
                }}
              >
                {isSplitting ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>កំពុងកាត់ចែកភាគ...</span>
                  </>
                ) : !isValidSplit ? (
                  <span>បញ្ចូលតម្លៃដើម្បីកាត់បំបែក (Enter value)</span>
                ) : (
                  <>
                    <Scissors size={14} />
                    <span>
                      {splitMode === 'minutes'
                        ? `កាត់បំបែកជាភាគ (${parsedVal} នាទី/ភាគ)`
                        : `កាត់បំបែកជា ${parsedVal} ភាគ`}
                    </span>
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
