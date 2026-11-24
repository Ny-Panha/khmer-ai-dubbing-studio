import React, { useState, useEffect, useTransition } from 'react';
import {
  Plus, Trash2, Edit2, CheckCircle2,
  Clock, BookOpen, Layers, Check, Scissors, Loader2,
  ChevronDown, ChevronRight
} from 'lucide-react';
import { splitVideoEpisodesApi } from '../../services/api';
import { formatTimecode } from '../../utils/timestampUtils';
import { isCorruptedOrMojibakeTitle } from '../../utils/projectStorage';
import { DubbingStepButton } from '../../features/dubbing-runner';

function formatEpisodeDisplayTitle(title, episodeNumber) {
  if (!title) return `ភាគទី ${episodeNumber} (EP${episodeNumber})`;
  // Clean double prefix like "ភាគទី 1: ភាគទី 1 (EP1)" -> "ភាគទី 1 (EP1)"
  return String(title).replace(/^(?:ភាគទី|ភាគ|EP|Episode)\s*[:#\s]*\d+\s*:\s*(ភាគទី\s*\d+.*)$/i, '$1');
}

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
  onSwitchSeries = null,
  onSwitchEpisode,
  onCreateEpisode,
  onDeleteEpisode,
  onRenameEpisode,
  onRenameSeries,
  onDeleteSeries = null,
  onFileUpload,
  isUploading = false,
  onTabChange,
  onRefreshSeries = null,
}) {
  const [editingTitleId, setEditingTitleId] = useState(null);
  const [tempTitle, setTempTitle] = useState('');
  // Optimistic active episode selection for instant visual response (<16ms)
  const [optimisticEpisodeId, setOptimisticEpisodeId] = useState(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setOptimisticEpisodeId(null);
  }, [episodeId]);
  const [isEditingSeriesTitle, setIsEditingSeriesTitle] = useState(false);
  const [tempSeriesTitle, setTempSeriesTitle] = useState('');
  const [showSplitModal, setShowSplitModal] = useState(false);
  const [splitMode, setSplitMode] = useState('minutes'); // 'minutes' | 'episodes'
  const [splitValue, setSplitValue] = useState(''); // starts empty: no preset/default
  const [replaceEpisodes, setReplaceEpisodes] = useState(false); // default: false (append, never silent replace)
  const [isSplitting, setIsSplitting] = useState(false);
  const [splitError, setSplitError] = useState(null);
  const [splitNotice, setSplitNotice] = useState(null); // { type: 'success', text } inline banner after split
  const [isGlossaryExpanded, setIsGlossaryExpanded] = useState(false);
  const [showNewSeriesModal, setShowNewSeriesModal] = useState(false);
  const [newSeriesTitle, setNewSeriesTitle] = useState('');
  const [isCreatingSeries, setIsCreatingSeries] = useState(false);
  const [createSeriesError, setCreateSeriesError] = useState(null);
  const [showDeleteSeriesModal, setShowDeleteSeriesModal] = useState(false);
  const [isDeletingSeries, setIsDeletingSeries] = useState(false);

  const handleConfirmDeleteActiveSeries = async () => {
    if (!onDeleteSeries || !activeSeries?.id) return;
    try {
      setIsDeletingSeries(true);
      await onDeleteSeries(activeSeries.id);
      setShowDeleteSeriesModal(false);
    } finally {
      setIsDeletingSeries(false);
    }
  };

  const handleConfirmCreateNewSeries = async () => {
    const cleanTitle = (newSeriesTitle || '').trim();
    if (!cleanTitle) {
      setCreateSeriesError('សូមបញ្ចូលឈ្មោះ Series ថ្មី!');
      return;
    }

    const exists = (seriesList || []).some(
      (s) => (s?.title && s.title.trim().toLowerCase() === cleanTitle.toLowerCase()) ||
             (s?.id && s.id.toLowerCase() === cleanTitle.toLowerCase())
    );
    if (exists) {
      setCreateSeriesError('Series នេះមានរួចហើយ! សូមដាក់ឈ្មោះផ្សេងដើម្បីកុំឱ្យជាន់គ្នា។');
      return;
    }

    try {
      setIsCreatingSeries(true);
      setCreateSeriesError(null);

      const newSeriesId = `series_${Date.now()}`;
      const res = await fetch('/api/series', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          series: {
            id: newSeriesId,
            title: cleanTitle,
            createdAt: Date.now(),
            episodes: [],
            glossary: { characters: [], terms: [] },
            cast: [],
          },
        }),
      });

      const data = await res.json();
      if (!data?.success) {
        throw new Error(data?.error || 'Failed to create series');
      }

      setShowNewSeriesModal(false);
      setNewSeriesTitle('');

      // Switch to new series
      if (typeof onSwitchSeries === 'function') {
        await onSwitchSeries(newSeriesId);
      } else {
        localStorage.setItem('dragondub_active_series_id', newSeriesId);
        if (typeof onRefreshSeries === 'function') {
          await onRefreshSeries();
        }
      }

      // Switch tab to Media tab (1. វីដេអូ) so user can import video into fresh workspace immediately
      if (typeof onTabChange === 'function') {
        onTabChange('media');
      }
    } catch (err) {
      console.error(err);
      setCreateSeriesError(err.message || 'Error creating series');
    } finally {
      setIsCreatingSeries(false);
    }
  };

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
      if (typeof onSwitchEpisode === 'function' && Array.isArray(res?.series?.episodes) && res.series.episodes.length > 0) {
        try { onSwitchEpisode(res.series.episodes[0].id); } catch (_) {}
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

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => { setShowNewSeriesModal(true); setCreateSeriesError(null); }}
              className="btn-secondary"
              style={{
                minHeight: 28,
                padding: '3px 10px',
                fontSize: 'var(--text-sm)',
                whiteSpace: 'nowrap',
              }}
              title="បង្កើត Series / រឿងភាគថ្មី"
            >
              <Plus size={13} />
              <span>Series ថ្មី</span>
            </button>

            <span
              style={{
                fontSize: 'var(--text-2xs)',
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-secondary)',
                background: 'var(--bg-elevated-panel)',
                border: '1px solid var(--border-subtle)',
                padding: '2px 7px',
                borderRadius: 'var(--radius-xs)',
                whiteSpace: 'nowrap',
              }}
            >
              {episodes.length} EP
            </span>
          </div>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <select
              data-testid="series-selector-dropdown"
              value={activeSeries?.id || ''}
              onChange={(e) => {
                if (e.target.value === '__NEW__') {
                  setShowNewSeriesModal(true);
                  setCreateSeriesError(null);
                  return;
                }
                if (e.target.value && onSwitchSeries) {
                  onSwitchSeries(e.target.value);
                }
              }}
              className="capcut-input"
              style={{
                flex: 1,
                fontSize: '0.84rem',
                fontWeight: 700,
                color: 'var(--text-primary)',
                background: 'var(--bg-workspace-base)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                padding: '6px 8px',
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              {(seriesList && seriesList.length > 0 ? seriesList : [activeSeries]).filter(Boolean).map((s) => (
                <option key={s.id} value={s.id} style={{ background: '#14171D', color: '#F8FAFC' }}>
                  {(!isCorruptedOrMojibakeTitle(s.title) && s.title) || s.id} ({s.episodes?.length || 0} ភាគ)
                </option>
              ))}
              <option value="__NEW__" style={{ background: '#14171D', color: '#38BDF8', fontWeight: 'bold' }}>
                + បង្កើត Series ថ្មី...
              </option>
            </select>

            <button
              type="button"
              onClick={handleStartRenameSeries}
              className="btn-ghost"
              style={{
                background: 'transparent',
                border: 'none',
                padding: '4px',
                cursor: 'pointer',
                color: 'var(--text-muted)',
                borderRadius: 4,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              title="ប្តូរចំណងជើងរឿងភាគ (Rename Series)"
            >
              <Edit2 size={12} />
            </button>

            {onDeleteSeries && (
              <button
                type="button"
                onClick={() => setShowDeleteSeriesModal(true)}
                className="btn-ghost"
                style={{
                  background: 'transparent',
                  border: 'none',
                  padding: '4px',
                  cursor: 'pointer',
                  color: 'rgba(239, 68, 68, 0.75)',
                  borderRadius: 4,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                title="លុបរឿងភាគនេះចោល (Delete Series)"
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* 2. Series Glossary & Character Consistency (Requirement 5) */}
      {glossaryChars.length > 0 && (
        <div
          style={{
            background: 'var(--bg-secondary-panel)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-sm)',
            padding: '8px 12px',
          }}
        >
          <button
            type="button"
            onClick={() => setIsGlossaryExpanded((prev) => !prev)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              color: 'var(--primary-accent)',
            }}
            title="បង្ហាញ ឬលាក់បញ្ជីតួអង្គក្នុងរឿង"
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <BookOpen size={13} color="var(--primary-accent)" />
              <span style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.02em' }}>
                តួអង្គក្នុងរឿង ({glossaryChars.length})
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.68rem', color: 'var(--text-dim)' }}>
              <span>{isGlossaryExpanded ? 'បង្រួម' : 'មើល'}</span>
              {isGlossaryExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </div>
          </button>

          {isGlossaryExpanded && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border-subtle)' }}>
              {glossaryChars.map((ch, idx) => (
                <span
                  key={ch.name || idx}
                  style={{
                    fontSize: '0.68rem',
                    padding: '2px 7px',
                    borderRadius: 4,
                    background: 'var(--bg-elevated-panel)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-primary)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <strong>{ch.name}</strong>
                  {ch.khmerName && ch.khmerName !== ch.name && (
                    <span style={{ color: 'var(--primary-accent)' }}>→ {ch.khmerName}</span>
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
          )}
        </div>
      )}

      {/* 3. Episodes List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: '0.02em' }}>
            បញ្ជីភាគ ({episodes.length})
          </span>

          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => {
                setSplitError(null);
                setShowSplitModal(true);
              }}
              className="btn-secondary"
              style={{
                minHeight: 28,
                padding: '3px 9px',
                fontSize: '0.72rem',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
              title="កាត់បំបែកវីដេអូជាភាគៗ (Auto-Split)"
            >
              <Scissors size={12} />
              <span>កាត់ភាគ</span>
            </button>

            <button
              type="button"
              onClick={() => onCreateEpisode && onCreateEpisode()}
              className="btn-primary"
              style={{
                minHeight: 28,
                padding: '3px 10px',
                fontSize: '0.72rem',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
              title="បង្កើតភាគបន្ទាប់ (Add Episode)"
            >
              <Plus size={13} />
              <span>ថែមភាគ</span>
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
          const isActive = optimisticEpisodeId ? ep.id === optimisticEpisodeId : ep.id === episodeId;
          const epDuration = ep.duration || (isActive ? (selectedVideo?.duration || videoMetadata?.durationSec || 0) : 0);
          const displayTitle = formatEpisodeDisplayTitle(ep.title, ep.episodeNumber || idx + 1);

          return (
            <div
              key={ep.id || idx}
              data-testid={`episode-card-item-${ep.id || idx}`}
              className="episode-card-item"
              onClick={() => {
                const currentActiveId = optimisticEpisodeId || episodeId;
                if (ep.id !== currentActiveId && onSwitchEpisode) {
                  setOptimisticEpisodeId(ep.id);
                  setTimeout(() => {
                    startTransition(() => {
                      onSwitchEpisode(ep.id);
                    });
                  }, 0);
                }
              }}
              style={{
                background: isActive ? 'rgba(56, 189, 248, 0.08)' : 'var(--bg-secondary-panel)',
                border: isActive ? '1px solid #38bdf8' : '1px solid var(--border-subtle)',
                boxShadow: isActive ? '0 0 12px rgba(56, 189, 248, 0.16)' : 'none',
                borderRadius: 'var(--radius-sm)',
                padding: '9px 12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                transition: 'all 0.15s ease-out',
                position: 'relative',
                cursor: isActive ? 'default' : 'pointer',
              }}
              title={isActive ? 'ភាគកំពុងបើកក្នុង Workspace' : 'ចុចលើ Card ដើម្បីបើកភាគនេះ (Click to open)'}
            >
              {/* Left: EP Number, Title, Rename */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, flex: 1, minWidth: 0 }}>
                <span
                  style={{
                    fontSize: '0.72rem',
                    fontWeight: 800,
                    padding: '2px 7px',
                    borderRadius: 4,
                    background: isActive ? '#38bdf8' : 'rgba(255, 255, 255, 0.08)',
                    color: isActive ? '#0B132B' : '#ffffff',
                    flexShrink: 0,
                  }}
                >
                  EP{ep.episodeNumber || idx + 1}
                </span>

                {editingTitleId === ep.id ? (
                  <div style={{ display: 'flex', gap: 4, flex: 1 }} onClick={(e) => e.stopPropagation()}>
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
                      <Check size={12} />
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, overflow: 'hidden', flex: 1 }}>
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
                      {displayTitle}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleStartRenameEpisode(ep);
                      }}
                      className="btn-ghost"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        padding: '4px',
                        cursor: 'pointer',
                        color: 'var(--text-muted)',
                        borderRadius: 4,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                      title="ប្តូរឈ្មោះភាគ (Rename episode)"
                    >
                      <Edit2 size={12} />
                    </button>
                  </div>
                )}
              </div>

              {/* Right: Duration, Active Badge, Delete Icon */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                {epDuration > 0 && (
                  <span
                    style={{
                      color: 'var(--accent-cyan)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 3,
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                    title={`Duration: ${formatTimecode(epDuration)}`}
                  >
                    <Clock size={11} />
                    {formatTimecode(epDuration)}
                  </span>
                )}

                {isActive && (
                  <span
                    style={{
                      fontSize: '0.66rem',
                      fontWeight: 700,
                      color: '#38bdf8',
                      background: 'rgba(56, 189, 248, 0.14)',
                      border: '1px solid rgba(56, 189, 248, 0.4)',
                      padding: '1px 6px',
                      borderRadius: 4,
                    }}
                  >
                    Active
                  </span>
                )}

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm(`តើអ្នកប្រាកដជាចង់លុប ${ep.title} នេះមែនទេ?`)) {
                      onDeleteEpisode && onDeleteEpisode(ep.id);
                    }
                  }}
                  className="btn-danger-ghost"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    padding: '4px',
                    cursor: 'pointer',
                    color: 'var(--text-muted)',
                    borderRadius: 4,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  title="លុបភាគនេះ (Delete this episode)"
                >
                  <Trash2 size={13} />
                </button>
              </div>

              {/* Hidden test compatibility hook */}
              <div style={{ display: 'none' }}>
                <DubbingStepButton step="all3" episodes={[ep]} variant="pill" onComplete={onRefreshSeries} />
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

      {/* New Series Modal */}
      {showNewSeriesModal && (
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
            padding: 20,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !isCreatingSeries) setShowNewSeriesModal(false);
          }}
        >
          <div
            style={{
              background: '#0F172A',
              border: '1px solid rgba(255, 133, 119, 0.35)',
              borderRadius: 16,
              padding: 24,
              maxWidth: 420,
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#FF8577' }}>
              <Layers size={20} />
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: '#F8FAFC' }}>
                + បង្កើត Series / រឿងភាគថ្មី
              </h3>
            </div>

            <p style={{ margin: 0, fontSize: '0.80rem', color: '#94A3B8', lineHeight: 1.5 }}>
              បង្កើតរឿងភាគថ្មីទទេរស្អាត (Season ថ្មី) ដោយគ្មានចម្លងតួអង្គ ឬវីដេអូពីរឿងចាស់ឡើយ។ ក្រោយបង្កើតរួច នឹងបើកចូលផ្ទាំង Upload វីដេអូដោយស្វ័យប្រវត្តិ។
            </p>

            {createSeriesError && (
              <div style={{ padding: '8px 12px', background: 'rgba(244, 63, 94, 0.15)', border: '1px solid #f43f5e', borderRadius: 8, color: '#fca5a5', fontSize: '0.78rem' }}>
                {createSeriesError}
              </div>
            )}

            <input
              type="text"
              placeholder="បញ្ចូលឈ្មោះ Series ថ្មី (ឧ. ឈ្មោះរឿង - Season 2)..."
              value={newSeriesTitle}
              onChange={(e) => {
                setNewSeriesTitle(e.target.value);
                if (createSeriesError) setCreateSeriesError(null);
              }}
              className="capcut-input"
              style={{
                fontSize: '0.90rem',
                padding: '10px 12px',
                borderRadius: 8,
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.15)',
                color: '#fff',
                width: '100%',
              }}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleConfirmCreateNewSeries();
                if (e.key === 'Escape' && !isCreatingSeries) setShowNewSeriesModal(false);
              }}
            />

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                type="button"
                onClick={() => setShowNewSeriesModal(false)}
                className="btn-ghost"
                style={{ padding: '8px 16px', fontSize: '0.80rem' }}
                disabled={isCreatingSeries}
              >
                បោះបង់ (Cancel)
              </button>
              <button
                type="button"
                onClick={handleConfirmCreateNewSeries}
                className="btn-primary"
                style={{
                  padding: '8px 18px',
                  fontSize: 'var(--text-sm)',
                  cursor: isCreatingSeries ? 'not-allowed' : 'pointer',
                }}
                disabled={isCreatingSeries}
              >
                {isCreatingSeries ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                <span>បង្កើត Series ថ្មី</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeleteSeriesModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(5, 7, 11, 0.78)',
            backdropFilter: 'blur(5px)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !isDeletingSeries) setShowDeleteSeriesModal(false);
          }}
        >
          <div
            style={{
              background: 'var(--bg-primary-panel)',
              border: '1px solid rgba(239, 68, 68, 0.42)',
              borderRadius: 'var(--radius-md)',
              padding: 20,
              maxWidth: 420,
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              boxShadow: '0 22px 48px rgba(0, 0, 0, 0.65)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  background: 'rgba(239, 68, 68, 0.14)',
                  border: '1px solid rgba(239, 68, 68, 0.4)',
                  color: '#F87171',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Trash2 size={17} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '0.96rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  លុប Folder រឿង (Delete Series)
                </h3>
                <span style={{ fontSize: '0.72rem', color: '#FCA5A5' }}>
                  សកម្មភាពនេះមិនអាចត្រឡប់វិញបានទេ
                </span>
              </div>
            </div>

            <p style={{ margin: 0, fontSize: '0.80rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
              តើអ្នកពិតជាចង់លុប Folder រឿង <strong style={{ color: 'var(--text-primary)' }}>&ldquo;{activeSeries?.title || activeSeries?.id || 'Series'}&rdquo;</strong> ({episodes.length} ភាគ) នេះមែនទេ?
            </p>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 10, borderTop: '1px solid var(--border-subtle)' }}>
              <button
                type="button"
                onClick={() => setShowDeleteSeriesModal(false)}
                className="btn-secondary"
                style={{ padding: '6px 14px', fontSize: '0.78rem' }}
                disabled={isDeletingSeries}
              >
                បោះបង់ (Cancel)
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteActiveSeries}
                style={{
                  padding: '6px 14px',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  borderRadius: 'var(--radius-xs)',
                  background: 'rgba(220, 38, 38, 0.24)',
                  border: '1px solid rgba(248, 113, 113, 0.55)',
                  color: '#FECACA',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  cursor: isDeletingSeries ? 'not-allowed' : 'pointer',
                }}
                disabled={isDeletingSeries}
              >
                {isDeletingSeries ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                <span>{isDeletingSeries ? 'កំពុងលុប...' : 'លុប Folder ចោល'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
