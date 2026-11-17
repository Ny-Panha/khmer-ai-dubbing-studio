import React, { useState } from 'react';
import { 
  FolderPlus, Loader2, AlertCircle, Sparkles, ArrowRight, Film, 
  Check, Trash2, Clock, Monitor, HardDrive, RefreshCw, Scissors
} from 'lucide-react';
import { splitVideoEpisodesApi, uploadVideoFile } from '../../services/api';
import { formatTimecode } from '../../utils/formatTime';

export default function MediaUploadTab({
  isUploading,
  handleFileUpload,
  uploadError,
  selectedVideo,
  videoMetadata = null,
  videoClips = [],
  currentTime = 0,
  duration = 0,
  onRemoveVideo = null,
  onTabChange,
  seriesList = [],
  activeSeries = null,
  activeEpisode = null,
  seriesId = null,
  episodeId = null,
  onSwitchSeries = null,
}) {
  const [showSplitModal, setShowSplitModal] = useState(false);
  const [splitMode, setSplitMode] = useState('minutes'); // 'minutes' | 'episodes'
  const [splitValue, setSplitValue] = useState(''); // starts empty: no preset/default
  const [replaceEpisodes, setReplaceEpisodes] = useState(false); // default: false (append, never silent replace)
  const [isSplitting, setIsSplitting] = useState(false);
  const [splitError, setSplitError] = useState(null);

  // Target Series Choice state: (a) 'current' | (b) 'new'
  const [uploadTarget, setUploadTarget] = useState('current');
  const [newSeriesName, setNewSeriesName] = useState('');
  const [targetError, setTargetError] = useState(null);
  const [isCustomUploading, setIsCustomUploading] = useState(false);

  const activeDuration = videoMetadata?.durationSec || duration || selectedVideo?.durationSec || 0;
  const hasVideo = Boolean(selectedVideo?.videoId || selectedVideo?.videoUrl);
  const displayTitle = selectedVideo?.displayTitle || selectedVideo?.originalFilename || selectedVideo?.fileName || 'វីដេអូភាគ (Episode Video)';

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
    const rawRef = selectedVideo?.videoPath || selectedVideo?.videoId || selectedVideo?.videoUrl || activeEpisode?.video?.videoPath || activeEpisode?.video?.videoId || activeEpisode?.videoFile || activeEpisode?.sourceVideoPath;
    if (!rawRef) {
      alert('សូម Import ឬ ជ្រើសរើសវីដេអូជាមុនសិន!');
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

      let targetSeriesId = activeSeries?.id || seriesId || selectedVideo?.seriesId || 'drama_project';
      if (uploadTarget === 'new') {
        const cleanName = (newSeriesName || '').trim();
        if (!cleanName) {
          const msg = 'សូមបញ្ចូលឈ្មោះ Series ថ្មី!';
          setSplitError(msg);
          alert(msg);
          return;
        }
        const exists = (seriesList || []).some(
          (s) => (s?.title && s.title.trim().toLowerCase() === cleanName.toLowerCase()) ||
                 (s?.id && s.id.toLowerCase() === cleanName.toLowerCase())
        );
        if (exists) {
          const msg = 'Series នេះមានរួចហើយ! សូមដាក់ឈ្មោះផ្សេងដើម្បីកុំឱ្យជាន់គ្នា។';
          setSplitError(msg);
          alert(msg);
          return;
        }
        targetSeriesId = `series_${Date.now()}`;
        await fetch('/api/series', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            series: {
              id: targetSeriesId,
              title: cleanName,
              createdAt: Date.now(),
              episodes: [],
              glossary: { characters: [], terms: [] },
              cast: [],
            },
          }),
        });
      }

      const res = await splitVideoEpisodesApi({
        videoId: rawRef,
        videoPath: selectedVideo?.videoPath,
        seriesId: targetSeriesId,
        episodeId: activeEpisode?.id || selectedVideo?.episodeId,
        durationMinutes: splitMode === 'minutes' ? parsedVal : undefined,
        episodeCount: splitMode === 'episodes' ? parsedVal : undefined,
        replaceEpisodes: Boolean(replaceEpisodes),
      });

      alert(`🎉 ${res.message || 'បានកាត់បំបែកវីដេអូជាភាគៗជោគជ័យ!'}`);
      setShowSplitModal(false);
      if (uploadTarget === 'new') {
        if (typeof onSwitchSeries === 'function') {
          await onSwitchSeries(targetSeriesId);
        } else {
          localStorage.setItem('dragondub_active_series_id', targetSeriesId);
          window.location.reload();
        }
      } else {
        window.location.reload();
      }
    } catch (err) {
      console.error(err);
      setSplitError(err.message || 'កាត់បំបែកវីដេអូបរាជ័យ');
      alert('កាត់បំបែកវីដេអូបរាជ័យ: ' + (err.message || err));
    } finally {
      setIsSplitting(false);
    }
  };

  const handleFileUploadWithTarget = async (e) => {
    const file = e?.target?.files?.[0] || (e instanceof File ? e : null);
    if (!file) return;

    if (uploadTarget === 'current') {
      await handleFileUpload(e);
      return;
    }

    const cleanName = (newSeriesName || '').trim();
    if (!cleanName) {
      const msg = 'សូមបញ្ចូលឈ្មោះ Series ថ្មី!';
      setTargetError(msg);
      alert(msg);
      if (e?.target) e.target.value = '';
      return;
    }

    const exists = (seriesList || []).some(
      (s) => (s?.title && s.title.trim().toLowerCase() === cleanName.toLowerCase()) ||
             (s?.id && s.id.toLowerCase() === cleanName.toLowerCase())
    );
    if (exists) {
      const msg = 'Series នេះមានរួចហើយ! សូមដាក់ឈ្មោះផ្សេងដើម្បីកុំឱ្យជាន់គ្នា។';
      setTargetError(msg);
      alert(msg);
      if (e?.target) e.target.value = '';
      return;
    }

    try {
      setIsCustomUploading(true);
      setTargetError(null);

      // 1. Create the series FIRST using existing POST /series
      // Starts EMPTY: no episodes, EMPTY glossary, EMPTY cast — copy NOTHING from SS1
      const newSeriesId = `series_${Date.now()}`;
      const createRes = await fetch('/api/series', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          series: {
            id: newSeriesId,
            title: cleanName,
            createdAt: Date.now(),
            episodes: [],
            glossary: { characters: [], terms: [] },
            cast: [],
          },
        }),
      });
      const createData = await createRes.json();
      if (!createData?.success) {
        throw new Error(createData?.error || 'Failed to create new series');
      }

      // 2. Upload video file into NEW seriesId
      const vidObj = await uploadVideoFile(file, {
        seriesId: newSeriesId,
        episodeId: 'ep_1',
        projectName: newSeriesId,
      });

      // 3. Create Episode 1 in backend series.json
      const epRes = await fetch(`/api/series/${newSeriesId}/episodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customTitle: 'ភាគទី 1 (EP1)',
          requestedNumber: 1,
        }),
      });
      const epData = await epRes.json();
      const createdEp = epData?.episode || { id: 'ep_1', episodeNumber: 1, title: 'ភាគទី 1 (EP1)' };

      // 4. Attach uploaded video to Episode 1 in series.json
      await fetch(`/api/series/${newSeriesId}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          series: {
            id: newSeriesId,
            title: cleanName,
            createdAt: Date.now(),
            glossary: { characters: [], terms: [] },
            cast: [],
            episodes: [
              {
                ...createdEp,
                video: vidObj,
                videoFile: vidObj.videoId || vidObj.videoPath,
                duration: vidObj.durationSec || 0,
                status: 'uploaded',
              },
            ],
          },
        }),
      });

      // 5. Switch activeSeries to the new series
      if (typeof onSwitchSeries === 'function') {
        await onSwitchSeries(newSeriesId);
      } else {
        localStorage.setItem('dragondub_active_series_id', newSeriesId);
        localStorage.setItem('dragondub_active_episode_id', createdEp.id);
        window.location.reload();
      }

      setUploadTarget('current');
      setNewSeriesName('');
      if (onTabChange) onTabChange('script');
    } catch (err) {
      console.error(err);
      setTargetError(err.message || 'Upload failed');
      alert('Upload failed: ' + (err.message || err));
    } finally {
      setIsCustomUploading(false);
      if (e?.target) e.target.value = '';
    }
  };

  return (
    <div className="media-tab-content" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {(uploadError || splitError || targetError) && (
        <div className="error-banner">
          <AlertCircle size={15} />
          <span>{uploadError || splitError || targetError}</span>
        </div>
      )}

      {/* Target Series Choice: (a) Current Series vs (b) + Series ថ្មី */}
      <div
        style={{
          background: 'rgba(15, 23, 42, 0.65)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: 12,
          padding: '10px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.74rem', fontWeight: 700, color: '#94A3B8' }}>
            គោលដៅ Upload:
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              onClick={() => { setUploadTarget('current'); setTargetError(null); }}
              style={{
                padding: '4px 10px',
                borderRadius: 9999,
                fontSize: '0.72rem',
                fontWeight: 600,
                border: uploadTarget === 'current' ? '1px solid #38BDF8' : '1px solid rgba(255, 255, 255, 0.1)',
                background: uploadTarget === 'current' ? 'rgba(56, 189, 248, 0.15)' : 'rgba(255, 255, 255, 0.04)',
                color: uploadTarget === 'current' ? '#38BDF8' : '#94A3B8',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              Series បច្ចុប្បន្ន — {activeSeries?.title || 'Series 1'}
            </button>
            <button
              type="button"
              onClick={() => { setUploadTarget('new'); setTargetError(null); }}
              style={{
                padding: '4px 10px',
                borderRadius: 9999,
                fontSize: '0.72rem',
                fontWeight: 600,
                border: uploadTarget === 'new' ? '1px solid #FF8577' : '1px solid rgba(255, 255, 255, 0.1)',
                background: uploadTarget === 'new' ? 'rgba(255, 133, 119, 0.15)' : 'rgba(255, 255, 255, 0.04)',
                color: uploadTarget === 'new' ? '#FF8577' : '#94A3B8',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              ＋ Series ថ្មី
            </button>
          </div>
        </div>

        {uploadTarget === 'new' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 2 }}>
            <input
              type="text"
              placeholder="បញ្ចូលឈ្មោះ Series ថ្មី (ឧ. រឿងភាគថ្មី - Season 2)..."
              value={newSeriesName}
              onChange={(e) => {
                setNewSeriesName(e.target.value);
                if (targetError) setTargetError(null);
              }}
              className="capcut-input"
              style={{
                fontSize: '0.80rem',
                padding: '6px 10px',
                borderRadius: 8,
                background: 'rgba(0, 0, 0, 0.35)',
                border: targetError ? '1px solid #F43F5E' : '1px solid rgba(255, 133, 119, 0.4)',
                color: '#F8FAFC',
                width: '100%',
              }}
              autoFocus
            />
          </div>
        )}
      </div>

      {hasVideo ? (
        /* 1. Active Video Card (Clean, Single Card, Zero-Duplicate) */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Card Container */}
          <div 
            className="motion-lift"
            style={{
              background: 'rgba(25, 39, 68, 0.7)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: 14,
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              boxShadow: '0 6px 20px rgba(0, 0, 0, 0.25)',
              transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            {/* Top row: Status Badge & Delete */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div 
                style={{ 
                  display: 'inline-flex', 
                  alignItems: 'center', 
                  gap: 5, 
                  background: 'rgba(52, 211, 153, 0.12)', 
                  border: '1px solid rgba(52, 211, 153, 0.3)',
                  padding: '3px 10px',
                  borderRadius: 9999,
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  color: '#34D399',
                }}
              >
                <Check size={12} strokeWidth={3} />
                <span>វីដេអូសកម្មលើ VIDEO 1</span>
              </div>

              {onRemoveVideo && (
                <button
                  type="button"
                  onClick={onRemoveVideo}
                  className="btn-tactile"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#94A3B8',
                    cursor: 'pointer',
                    padding: '3px 8px',
                    borderRadius: 9999,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: '0.72rem',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = '#F87171';
                    e.currentTarget.style.background = 'rgba(248, 113, 113, 0.1)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = '#94A3B8';
                    e.currentTarget.style.background = 'transparent';
                  }}
                  title="ដកវីដេអូចេញពីគម្រោង (Remove video)"
                >
                  <Trash2 size={13} />
                  <span>ដកចេញ</span>
                </button>
              )}
            </div>

            {/* Video Title */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <div 
                style={{ 
                  width: 40, 
                  height: 40, 
                  borderRadius: 8, 
                  background: 'rgba(56, 189, 248, 0.12)', 
                  border: '1px solid rgba(56, 189, 248, 0.25)',
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  flexShrink: 0
                }}
              >
                <Film size={20} color="#38bdf8" />
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div 
                  style={{ 
                    fontSize: '0.86rem', 
                    fontWeight: 700, 
                    color: '#f8fafc', 
                    lineHeight: 1.35,
                    wordBreak: 'break-word',
                  }}
                  title={displayTitle}
                >
                  {displayTitle}
                </div>
              </div>
            </div>

            {/* Video Specs Grid (Duration, Resolution, File Size) */}
            <div 
              style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(3, 1fr)', 
                gap: 6,
                background: 'rgba(0, 0, 0, 0.25)',
                padding: '8px 10px',
                borderRadius: 6,
                border: '1px solid rgba(255, 255, 255, 0.05)',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: '0.64rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Duration
                </span>
                <span style={{ fontSize: '0.76rem', fontWeight: 700, color: '#38bdf8', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Clock size={11} />
                  {activeDuration > 0 ? formatTimecode(activeDuration) : '--:--'}
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: '0.64rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Resolution
                </span>
                <span style={{ fontSize: '0.76rem', fontWeight: 600, color: '#cbd5e1', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Monitor size={11} />
                  {videoMetadata?.resolution || '1080p'}
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: '0.64rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Size
                </span>
                <span style={{ fontSize: '0.76rem', fontWeight: 600, color: '#cbd5e1', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <HardDrive size={11} />
                  {selectedVideo?.size || videoMetadata?.size || '44 MB'}
                </span>
              </div>
            </div>

            {/* Action Row: Replace Video + Auto-Split 20 Min */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {/* Replace Video Button */}
              <label 
                className="btn-tactile"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  padding: '9px 12px',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: 9999,
                  fontSize: '0.74rem',
                  fontWeight: 600,
                  color: '#CBD5E1',
                  cursor: isUploading ? 'not-allowed' : 'pointer',
                  transition: 'all 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
                  textAlign: 'center',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(56, 189, 248, 0.4)';
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                }}
              >
                <input
                  type="file"
                  accept="video/*"
                  onChange={handleFileUploadWithTarget}
                  disabled={isUploading || isCustomUploading}
                  style={{ display: 'none' }}
                />
                {(isUploading || isCustomUploading) ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    <span>កំពុង{uploadTarget === 'new' ? 'បង្កើត & Upload' : 'ប្តូរវីដេអូ'}...</span>
                  </>
                ) : (
                  <>
                    <RefreshCw size={13} />
                    <span>{uploadTarget === 'new' ? '+ Upload ចូល Series ថ្មី' : 'ប្តូរវីដេអូ (Replace)'}</span>
                  </>
                )}
              </label>

              {/* Auto-Split Button */}
              <button
                type="button"
                onClick={() => {
                  setSplitError(null);
                  setShowSplitModal(true);
                }}
                disabled={isSplitting || isUploading}
                className="btn-tactile"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  padding: '9px 12px',
                  background: 'rgba(56, 189, 248, 0.12)',
                  border: '1px solid rgba(56, 189, 248, 0.4)',
                  borderRadius: 9999,
                  fontSize: '0.74rem',
                  fontWeight: 700,
                  color: '#38BDF8',
                  cursor: (isSplitting || isUploading) ? 'not-allowed' : 'pointer',
                  transition: 'all 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = '#38BDF8';
                  e.currentTarget.style.background = 'rgba(56, 189, 248, 0.22)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(56, 189, 248, 0.4)';
                  e.currentTarget.style.background = 'rgba(56, 189, 248, 0.12)';
                }}
                title="កាត់បំបែកវីដេអូជាភាគៗ (Split into Episodes)"
              >
                {isSplitting ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    <span>កំពុងកាត់ចែក...</span>
                  </>
                ) : (
                  <>
                    <Scissors size={13} />
                    <span>កាត់បំបែកភាគ (Split Video)</span>
                  </>
                )}
              </button>
            </div>

            {/* Smart Long-Video Banner if Video > 15 Minutes */}
            {activeDuration >= 900 && (
              <div 
                style={{
                  background: 'linear-gradient(135deg, rgba(2, 132, 199, 0.12), rgba(15, 23, 42, 0.7))',
                  border: '1px solid rgba(56, 189, 248, 0.35)',
                  borderRadius: 6,
                  padding: '10px 12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#38bdf8' }}>
                    <Scissors size={14} />
                    <span style={{ fontSize: '0.74rem', fontWeight: 800 }}>
                      ⚡ វីដេអូវែង ({formatTimecode(activeDuration)})
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                    វីដេអូនេះមានប្រវែងវែង។ អ្នកអាចកាត់បំបែកជាភាគៗតាមចំនួនភាគ ឬនាទីដែលអ្នកចង់បាន។
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setSplitError(null);
                      setShowSplitModal(true);
                    }}
                    disabled={isSplitting}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      padding: '7px 12px',
                      background: 'linear-gradient(135deg, #0284c7, #0369a1)',
                      border: '1px solid #38bdf8',
                      borderRadius: 5,
                      color: '#ffffff',
                      fontSize: '0.74rem',
                      fontWeight: 700,
                      cursor: isSplitting ? 'not-allowed' : 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <Scissors size={13} />
                    <span>✂️ កាត់បំបែកជាភាគ (Split)</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Step 2 CTA Card */}
          <button
            type="button"
            onClick={() => onTabChange && onTabChange('script')}
            className="btn-tactile"
            style={{ 
              width: '100%', 
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between', 
              fontSize: '0.82rem',
              fontWeight: 700,
              padding: '13px 16px',
              background: 'linear-gradient(135deg, rgba(255, 133, 119, 0.16) 0%, rgba(56, 189, 248, 0.16) 100%)',
              border: '1px solid rgba(255, 133, 119, 0.35)',
              borderRadius: 14,
              color: '#F8FAFC',
              cursor: 'pointer',
              boxShadow: '0 4px 14px rgba(0, 0, 0, 0.25)',
              transition: 'all 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'linear-gradient(135deg, rgba(255, 133, 119, 0.25) 0%, rgba(56, 189, 248, 0.25) 100%)';
              e.currentTarget.style.borderColor = '#FF8577';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'linear-gradient(135deg, rgba(255, 133, 119, 0.16) 0%, rgba(56, 189, 248, 0.16) 100%)';
              e.currentTarget.style.borderColor = 'rgba(255, 133, 119, 0.35)';
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Sparkles size={16} color="#FF8577" />
              <span>ជំហានបន្ទាប់៖ AI Dubbing & Script</span>
            </div>
            <ArrowRight size={15} color="#FF8577" />
          </button>
        </div>
      ) : (
        /* 2. Upload Zone when NO video is loaded (GetLayers Layer 2 Glass) */
        <div 
          className="motion-lift"
          style={{ 
            display: 'flex', 
            flexDirection: 'column', 
            alignItems: 'center', 
            textAlign: 'center', 
            padding: '40px 20px', 
            border: '2px dashed rgba(255, 133, 119, 0.35)', 
            borderRadius: 16, 
            background: 'rgba(25, 39, 68, 0.45)',
            gap: 14,
            transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          <div 
            style={{ 
              width: 58, 
              height: 58, 
              borderRadius: 14, 
              background: 'rgba(255, 133, 119, 0.12)', 
              border: '1px solid rgba(255, 133, 119, 0.25)',
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
            }}
          >
            <FolderPlus size={28} color="#FF8577" />
          </div>

          <div>
            <div style={{ fontSize: '0.94rem', fontWeight: 800, color: '#F8FAFC', marginBottom: 4 }}>
              បញ្ចូលវីដេអូសម្រាប់ភាគនេះ
            </div>
            <div style={{ fontSize: '0.76rem', color: '#94A3B8', lineHeight: 1.5 }}>
              គាំទ្រ MP4, MKV, MOV, WebM (Full HD, 4K)
            </div>
          </div>

          <label 
            className="btn-tactile"
            style={{ 
              marginTop: 6,
              cursor: isUploading ? 'not-allowed' : 'pointer', 
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 22px',
              borderRadius: 9999,
              background: 'linear-gradient(135deg, #FF8577 0%, #f43f5e 100%)',
              border: '1px solid #FF8577',
              color: '#0B132B',
              fontSize: '0.80rem',
              fontWeight: 800,
              boxShadow: '0 4px 16px rgba(255, 133, 119, 0.35)',
              transition: 'all 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            <input
              type="file"
              accept="video/*"
              onChange={handleFileUploadWithTarget}
              disabled={isUploading || isCustomUploading}
              style={{ display: 'none' }}
            />
            {(isUploading || isCustomUploading) ? (
              <>
                <Loader2 size={15} className="animate-spin" color="#0B132B" />
                <span>កំពុង{uploadTarget === 'new' ? 'បង្កើត Series & Upload' : 'Upload & រៀបចំវីដេអូ'}...</span>
              </>
            ) : (
              <>
                <FolderPlus size={15} color="#0B132B" />
                <span>{uploadTarget === 'new' ? '+ បង្កើត & Upload ចូល Series ថ្មី' : '+ ជ្រើសរើសវីដេអូ (Import Video)'}</span>
              </>
            )}
          </label>
        </div>
      )}

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
              padding: 20,
              maxWidth: 460,
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              boxShadow: '0 20px 40px rgba(0,0,0,0.6)',
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
                onClick={() => handleAutoSplit()}
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