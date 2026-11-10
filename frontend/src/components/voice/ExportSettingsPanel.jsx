import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Clapperboard, Subtitles, Loader2, Download, Copy, Check, ChevronUp, ChevronDown,
  CheckCircle2, ShieldCheck, Image, Upload, Layers, AlertTriangle, Square, X, Film
} from 'lucide-react';
import { resolveDefaultAspectRatio } from '../../utils/projectStorage';

export default function ExportSettingsPanel({
  isOpen,
  onToggle,
  settings,
  onSettingChange,
  onRenderVideo,
  isRendering,
  renderProgress = 0,
  renderStage = '',
  selectedVideo,
  videoMetadata = null,
  activeEpisode = null,
  activeSeries = null,
  seriesId = null,
  episodeId = null,
  batchRender = null,
  audioGenerated,
  previewAudioUrl,
  renderedVideo,
  onCopyCaption,
  copiedCaption,
}) {
  const [internalProgress, setInternalProgress] = useState(0);
  const [internalStage, setInternalStage] = useState('');
  const [isBatchExpanded, setIsBatchExpanded] = useState(true);
  const [selectedBatchEpIds, setSelectedBatchEpIds] = useState([]);
  const [allowOriginalAudio, setAllowOriginalAudio] = useState(false);
  const lastInitSeriesRef = useRef(null);

  const seriesEpisodes = useMemo(() => {
    const list = Array.isArray(activeSeries?.episodes) ? [...activeSeries.episodes] : [];
    return list.sort((a, b) => (Number(a.episodeNumber) || 0) - (Number(b.episodeNumber) || 0));
  }, [activeSeries]);

  const checkEpHasVideo = (ep) =>
    Boolean(ep?.sourceVideoPath || ep?.video?.videoPath || ep?.video?.videoId || ep?.videoFile || ep?.video?.videoUrl);

  const checkEpHasVoice = (ep) => {
    if (!ep) return false;
    if (episodeId && String(ep.id) === String(episodeId) && !ep.audioOutdated && !activeEpisode?.audioOutdated && (audioGenerated || previewAudioUrl)) return true;
    if (ep.audioOutdated) return false;
    if (ep.audioGenerated || ep.fullAudioUrl || ep.hasAudio) return true;
    return false;
  };

  const episodesWithVideo = useMemo(
    () => seriesEpisodes.filter((ep) => checkEpHasVideo(ep)),
    [seriesEpisodes]
  );

  useEffect(() => {
    const validIds = new Set(episodesWithVideo.map((e) => String(e.id)));
    if (validIds.size === 0) {
      setSelectedBatchEpIds((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    const currentSeriesKey = String(seriesId || activeSeries?.id || 'default');
    if (lastInitSeriesRef.current !== currentSeriesKey) {
      lastInitSeriesRef.current = currentSeriesKey;
      setSelectedBatchEpIds(episodesWithVideo.map((e) => e.id));
      return;
    }
    setSelectedBatchEpIds((prev) => {
      const filtered = prev.filter((id) => validIds.has(String(id)));
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [seriesId, activeSeries?.id, episodesWithVideo]);

  const selectedBatchSet = useMemo(
    () => new Set(selectedBatchEpIds.map((id) => String(id))),
    [selectedBatchEpIds]
  );

  const selectedBatchEpisodes = seriesEpisodes.filter(
    (ep) => selectedBatchSet.has(String(ep.id)) && checkEpHasVideo(ep)
  );
  const selectedVoicedEpisodes = selectedBatchEpisodes.filter((ep) => checkEpHasVoice(ep));
  const selectedMissingVoiceEpisodes = selectedBatchEpisodes.filter((ep) => !checkEpHasVoice(ep));
  const eligibleBatchEpisodes = allowOriginalAudio ? selectedBatchEpisodes : selectedVoicedEpisodes;

  const batchJob = batchRender?.job || null;
  const isBatchRunning = Boolean(batchRender?.isRunning || batchJob?.status === 'running');
  const isBatchStarting = Boolean(batchRender?.isStarting);
  const batchError = batchRender?.error || null;

  const toggleBatchEpisode = (id) => {
    if (isBatchRunning) return;
    const strId = String(id);
    setSelectedBatchEpIds((prev) =>
      prev.some((item) => String(item) === strId)
        ? prev.filter((item) => String(item) !== strId)
        : [...prev, id]
    );
  };

  const handleStartBatchAction = (mode) => {
    if (!batchRender?.start || eligibleBatchEpisodes.length === 0 || isBatchRunning || isBatchStarting) return;
    batchRender.start({
      episodeIds: selectedBatchEpisodes.map((ep) => ep.id),
      mode,
      allowOriginalAudio,
    });
  };

  const srcW = Number(videoMetadata?.width || selectedVideo?.width || activeEpisode?.metadata?.width || activeEpisode?.video?.width) || 0;
  const srcH = Number(videoMetadata?.height || selectedVideo?.height || activeEpisode?.metadata?.height || activeEpisode?.video?.height) || 0;
  const defaultAspectRatio = resolveDefaultAspectRatio(srcW, srcH) || '16:9';
  const rawAspectRatio = settings?.aspectRatio || defaultAspectRatio;
  const effectiveAspectRatio = rawAspectRatio === '9:16' ? '9:16' : '16:9';
  const effectiveVerticalStyle = settings?.verticalStyle || 'pad';
  const sourceHint = (srcW > 0 && srcH > 0)
    ? `Source: ${srcW}×${srcH} — ${srcH > srcW ? 'vertical' : (srcW > srcH ? 'horizontal' : 'square')}`
    : 'Source: 16:9 (fallback)';

  // Fallback animation timer to guarantee smooth 0 -> 100% progress during video export
  useEffect(() => {
    let timer = null;
    if (isRendering) {
      if (renderProgress > 0) {
        setInternalProgress(renderProgress);
        setInternalStage(renderStage);
      } else {
        setInternalProgress(1);
        setInternalStage('1/4 បង្កើត Khmer .ASS Subtitles & ផ្ទុក Fonts');
        timer = setInterval(() => {
          setInternalProgress((prev) => {
            let next = prev;
            if (prev < 25) {
              next = prev + 2;
              if (next >= 25) setInternalStage('2/4 រៀបចំ Smart Ducking 85% & សំឡេង');
            } else if (prev < 55) {
              next = prev + 1;
              if (next >= 55) setInternalStage('3/4 FFmpeg កំពុង Encode វីដេអូ & ដុត Subtitles');
            } else if (prev < 85) {
              next = prev + 1;
              if (next >= 85) setInternalStage('4/4 Export ចូល Downloads Folder លើ PC');
            } else if (prev < 97) {
              if (Math.random() > 0.4) next = prev + 1;
            }
            return Math.min(next, 97);
          });
        }, 280);
      }
    } else {
      if (internalProgress > 0) {
        setInternalProgress(100);
        setInternalStage('🎉 Render ជោគជ័យ 100%!');
        const resetTimer = setTimeout(() => {
          setInternalProgress(0);
          setInternalStage('');
        }, 1500);
        return () => clearTimeout(resetTimer);
      }
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isRendering, renderProgress, renderStage]);

  const displayProgress = renderProgress > 0 ? renderProgress : internalProgress;
  const currentStageText = renderStage || internalStage || (
    displayProgress < 25 
      ? '1/4 បង្កើត Khmer .ASS Subtitles & ផ្ទុក Fonts'
      : displayProgress < 55 
        ? '2/4 រៀបចំ Smart Ducking 85% & សំឡេង'
        : displayProgress < 85 
          ? '3/4 FFmpeg កំពុង Encode វីដេអូ & ដុត Subtitles'
          : displayProgress < 100 
            ? '4/4 កំពុង Export ចូល Downloads Folder លើ PC...'
            : '🎉 រួចរាល់ 100%!'
  );
  return (
    <div className="inspector-card-group">
      {/* Header */}
      <div 
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', marginBottom: isOpen ? 10 : 0 }}
        onClick={onToggle}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Clapperboard size={14} color="var(--primary-accent)" />
          <label className="section-label" style={{ margin: 0, cursor: 'pointer' }}>
            2. Subtitle & Export Settings
          </label>
        </div>
        {isOpen ? <ChevronUp size={14} color="var(--text-dim)" /> : <ChevronDown size={14} color="var(--text-dim)" />}
      </div>

      {isOpen && (
        <>
          {/* Video Aspect Ratio Selector */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)', fontWeight: 600 }}>
                ទម្រង់វីដេអូ Export (Aspect Ratio)
              </span>
              <span style={{ fontSize: '0.68rem', color: 'var(--primary-accent)', fontWeight: 500 }} title="ទំហំវីដេអូដើម">
                {sourceHint}
              </span>
            </div>
            <select
              value={effectiveAspectRatio}
              onChange={(e) => onSettingChange('aspectRatio', e.target.value)}
              className="inspector-select"
              style={{ width: '100%', padding: '6px 8px', fontSize: '0.78rem' }}
            >
              <option value="16:9">16:9 (Landscape / YouTube)</option>
              <option value="9:16">9:16 (Portrait / TikTok / Reels / Shorts)</option>
            </select>
          </div>

          {/* 9:16 Vertical Style Choice */}
          {effectiveAspectRatio === '9:16' && (
            <div style={{ marginBottom: 12, padding: '8px 10px', background: 'var(--card-bg-subtle, rgba(255,255,255,0.03))', borderRadius: 6, border: '1px solid var(--border-color, rgba(255,255,255,0.08))' }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)', display: 'block', marginBottom: 4, fontWeight: 600 }}>
                ម៉ូដ 9:16 (Vertical Framing Style)
              </span>
              <select
                value={effectiveVerticalStyle}
                onChange={(e) => onSettingChange('verticalStyle', e.target.value)}
                className="inspector-select"
                style={{ width: '100%', padding: '6px 8px', fontSize: '0.78rem' }}
              >
                <option value="pad">Pad — black bars, full frame visible</option>
                <option value="crop">Crop — full-bleed center crop</option>
              </select>
              <span style={{ fontSize: '0.66rem', color: 'var(--text-dim)', display: 'block', marginTop: 4 }}>
                {effectiveVerticalStyle === 'crop'
                  ? 'ពង្រីកពេញអេក្រង់ទូរស័ព្ទ (1080×1920) គ្មានគែមខ្មៅ (Center-crop)'
                  : 'រក្សាទម្រង់ដើមទាំងមូល ដោយដាក់គែមខ្មៅលើក្រោម (Cinema black bars)'}
              </span>
            </div>
          )}

          {/* Subtitle Burn Switch */}
          <label className="checkbox-container" style={{ marginBottom: settings?.burnSubtitles ? 10 : 12 }}>
            <input
              type="checkbox"
              checked={settings?.burnSubtitles}
              onChange={(e) => onSettingChange('burnSubtitles', e.target.checked)}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Subtitles size={14} color="var(--track-subtitle)" />
              <span style={{ fontSize: '0.8rem', color: 'var(--text-primary)', fontWeight: 600 }}>
                Burn Subtitles to Video (អក្សររត់ CapCut Style)
              </span>
            </div>
          </label>

          {/* Subtitle Style Controls (Style, Color & Size) */}
          {settings?.burnSubtitles && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12, paddingLeft: 6 }}>
              <div style={{ gridColumn: 'span 2' }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>
                  ម៉ូដ Subtitle (Caption Style for TikTok/Reels/FB)
                </span>
                <select
                  value={settings?.subtitleStyle || 'banner'}
                  onChange={(e) => onSettingChange('subtitleStyle', e.target.value)}
                  className="inspector-select"
                  style={{ width: '100%', padding: '5px 8px', fontSize: '0.78rem' }}
                >
                  <option value="banner">⬛ Title Banner (ប្រអប់ខ្មៅស្អាត CapCut Pro - បាំង Sub ដើមបានល្អ)</option>
                  <option value="pill">🏷️ CapCut Pill (ប្រអប់មូលថ្លា Modern)</option>
                  <option value="cinema">🎬 Cinema Soft (ស្រមោលអក្សរទន់)</option>
                </select>
              </div>

              <div>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>
                  ពណ៌អក្សរ Subtitle
                </span>
                <select
                  value={settings?.subtitleColor || 'white'}
                  onChange={(e) => onSettingChange('subtitleColor', e.target.value)}
                  className="inspector-select"
                  style={{ width: '100%', padding: '5px 8px', fontSize: '0.78rem' }}
                >
                  <option value="white">⚪ ពណ៌ស (White CapCut)</option>
                  <option value="yellow">🟡 ពណ៌លឿង (Yellow Soft)</option>
                </select>
              </div>

              <div>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>
                  ទំហំអក្សរ Subtitle
                </span>
                <select
                  value={settings?.subtitleSize || 'medium'}
                  onChange={(e) => onSettingChange('subtitleSize', e.target.value)}
                  className="inspector-select"
                  style={{ width: '100%', padding: '5px 8px', fontSize: '0.78rem' }}
                >
                  <option value="small">តូច (14px)</option>
                  <option value="medium">ស្តង់ដារ (16px)</option>
                  <option value="large">ធំ (18px)</option>
                </select>
              </div>
            </div>
          )}

          {/* Logo Watermark (សងខាង / ជ្រុងលើ) Switch */}
          <div style={{ marginTop: 10, marginBottom: 12, borderTop: '1px solid rgba(255, 255, 255, 0.08)', paddingTop: 10 }}>
            <label className="checkbox-container" style={{ marginBottom: settings?.enableLogo ? 10 : 6 }}>
              <input
                type="checkbox"
                checked={Boolean(settings?.enableLogo)}
                onChange={(e) => onSettingChange('enableLogo', e.target.checked)}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Image size={15} color="#eab308" />
                <span style={{ fontSize: '0.8rem', color: '#eab308', fontWeight: 700 }}>
                  Logo Watermark (សងខាង / ជ្រុងលើ)
                </span>
                {settings?.enableLogo && (
                  <span style={{ fontSize: '0.65rem', background: 'rgba(234, 179, 8, 0.2)', color: '#fde047', padding: '1px 6px', borderRadius: 10 }}>
                    {settings?.logoPosition === 'both' ? 'សងខាង (Both)' : (settings?.logoPosition === 'top-left' ? 'ឆ្វេង (Left)' : 'ស្តាំ (Right)')}
                  </span>
                )}
              </div>
            </label>

            {settings?.enableLogo && (
              <div style={{
                background: 'rgba(15, 23, 42, 0.6)',
                border: '1px solid rgba(234, 179, 8, 0.25)',
                borderRadius: 8,
                padding: '10px 10px',
                marginBottom: 12,
                display: 'flex',
                flexDirection: 'column',
                gap: 10
              }}>
                {/* 1. Preview current logo & Upload button */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 48,
                    height: 48,
                    borderRadius: settings?.logoShape === 'square' ? 6 : '50%',
                    overflow: 'hidden',
                    border: '2px solid rgba(234, 179, 8, 0.6)',
                    background: '#000',
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.5)'
                  }}>
                    {settings?.logoImage ? (
                      <img src={settings.logoImage} alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <Image size={24} color="#64748b" />
                    )}
                  </div>

                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      background: 'rgba(234, 179, 8, 0.15)',
                      border: '1px solid rgba(234, 179, 8, 0.35)',
                      color: '#fde047',
                      padding: '5px 10px',
                      borderRadius: 5,
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      textAlign: 'center'
                    }}>
                      <Upload size={13} />
                      <span>📁 Upload រូប Logo ផ្ទាល់ខ្លួន</span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        style={{ display: 'none' }}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const reader = new FileReader();
                          reader.onload = (loadEvt) => {
                            onSettingChange('logoImage', loadEvt.target?.result);
                          };
                          reader.readAsDataURL(file);
                        }}
                      />
                    </label>

                    <button
                      type="button"
                      onClick={() => onSettingChange('logoImage', '/assets/dragon_town_logo.jpg')}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        background: 'transparent',
                        border: 'none',
                        color: '#94a3b8',
                        fontSize: '0.68rem',
                        cursor: 'pointer',
                        padding: '2px 0'
                      }}
                    >
                      🐉 ប្រើរូបគំរូ Dragon Town
                    </button>
                  </div>
                </div>

                {/* 2. Position & Shape Row */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <div>
                    <span style={{ fontSize: '0.68rem', color: '#94a3b8', display: 'block', marginBottom: 2 }}>
                      📍 ទីតាំង Logo
                    </span>
                    <select
                      value={settings?.logoPosition || 'both'}
                      onChange={(e) => onSettingChange('logoPosition', e.target.value)}
                      className="inspector-select"
                      style={{ width: '100%', padding: '4px 6px', fontSize: '0.72rem' }}
                    >
                      <option value="both">✨ «សងខាង» ឆ្វេង & ស្តាំ (Both Sides)</option>
                      <option value="top-left">ជ្រុងលើឆ្វេង (Top Left)</option>
                      <option value="top-right">ជ្រុងលើស្តាំ (Top Right)</option>
                      <option value="bottom-left">ជ្រុងក្រោមឆ្វេង (Bottom Left)</option>
                      <option value="bottom-right">ជ្រុងក្រោមស្តាំ (Bottom Right)</option>
                    </select>
                  </div>

                  <div>
                    <span style={{ fontSize: '0.68rem', color: '#94a3b8', display: 'block', marginBottom: 2 }}>
                      ⭕ ទម្រង់ Logo (Shape)
                    </span>
                    <select
                      value={settings?.logoShape || 'circle'}
                      onChange={(e) => onSettingChange('logoShape', e.target.value)}
                      className="inspector-select"
                      style={{ width: '100%', padding: '4px 6px', fontSize: '0.72rem' }}
                    >
                      <option value="circle">⭕ រង្វង់មូល (Circle - ដូចគេ)</option>
                      <option value="square">⬛ រាងដើម (Original Rect)</option>
                    </select>
                  </div>
                </div>

                {/* 3. Sliders: Size & Opacity */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                      <span style={{ fontSize: '0.68rem', color: '#94a3b8' }}>ទំហំ Size</span>
                      <span style={{ fontSize: '0.68rem', color: '#fde047', fontFamily: 'monospace' }}>
                        {settings?.logoSize || 72}px
                      </span>
                    </div>
                    <input
                      type="range"
                      min="40"
                      max="140"
                      step="4"
                      value={settings?.logoSize || 72}
                      onChange={(e) => onSettingChange('logoSize', Number(e.target.value))}
                      style={{ width: '100%', accentColor: '#eab308' }}
                    />
                  </div>

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                      <span style={{ fontSize: '0.68rem', color: '#94a3b8' }}>ភាពច្បាស់ (Opacity)</span>
                      <span style={{ fontSize: '0.68rem', color: '#fde047', fontFamily: 'monospace' }}>
                        {Math.round((settings?.logoOpacity ?? 0.9) * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0.2"
                      max="1.0"
                      step="0.05"
                      value={settings?.logoOpacity ?? 0.9}
                      onChange={(e) => onSettingChange('logoOpacity', Number(e.target.value))}
                      style={{ width: '100%', accentColor: '#eab308' }}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Anti-Theft Running Marquee & Watermark Switch */}
          <div style={{ marginTop: 10, marginBottom: 12, borderTop: '1px solid rgba(255, 255, 255, 0.08)', paddingTop: 10 }}>
            <label className="checkbox-container" style={{ marginBottom: settings?.enableAntiTheft ? 10 : 6 }}>
              <input
                type="checkbox"
                checked={Boolean(settings?.enableAntiTheft)}
                onChange={(e) => onSettingChange('enableAntiTheft', e.target.checked)}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <ShieldCheck size={15} color="#38bdf8" />
                <span style={{ fontSize: '0.8rem', color: '#38bdf8', fontWeight: 700 }}>
                  Title រត់ & Watermark ការពារគេ Copy (Anti-Theft)
                </span>
              </div>
            </label>

            {settings?.enableAntiTheft && (
              <div style={{
                background: 'rgba(15, 23, 42, 0.6)',
                border: '1px solid rgba(56, 189, 248, 0.25)',
                borderRadius: 8,
                padding: '10px 10px',
                marginBottom: 12,
                display: 'flex',
                flexDirection: 'column',
                gap: 10
              }}>
                {/* 1. Watermark Name */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600 }}>
                      🏷️ ឈ្មោះ Watermark / Page Name
                    </span>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: '0.7rem', color: '#94a3b8' }}>
                      <input
                        type="checkbox"
                        checked={settings?.enableWatermark !== false}
                        onChange={(e) => onSettingChange('enableWatermark', e.target.checked)}
                        style={{ margin: 0 }}
                      />
                      បង្ហាញ
                    </label>
                  </div>
                  {settings?.enableWatermark !== false && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                      <input
                        type="text"
                        value={settings?.watermarkText ?? 'រក្សាសិទ្ធិដោយ ៖ Holiday Kh Drama'}
                        onChange={(e) => onSettingChange('watermarkText', e.target.value)}
                        placeholder="ឧ. រក្សាសិទ្ធិដោយ ៖ Holiday Kh Drama"
                        className="inspector-input"
                        style={{
                          gridColumn: 'span 2',
                          fontSize: '0.76rem',
                          padding: '5px 8px',
                          background: 'rgba(0,0,0,0.4)',
                          border: '1px solid rgba(255,255,255,0.15)',
                          borderRadius: 4,
                          color: '#fff',
                        }}
                      />
                      <div>
                        <span style={{ fontSize: '0.68rem', color: '#64748b', display: 'block', marginBottom: 2 }}>
                          ទីតាំង Watermark
                        </span>
                        <select
                          value={settings?.watermarkPosition || 'above-ticker'}
                          onChange={(e) => onSettingChange('watermarkPosition', e.target.value)}
                          className="inspector-select"
                          style={{ width: '100%', padding: '4px 6px', fontSize: '0.72rem' }}
                        >
                          <option value="above-ticker">លើរបាររត់ (កណ្តាល)</option>
                          <option value="top-right">ជ្រុងលើស្តាំ (Top Right)</option>
                          <option value="top-left">ជ្រុងលើឆ្វេង (Top Left)</option>
                        </select>
                      </div>
                      <div>
                        <span style={{ fontSize: '0.68rem', color: '#64748b', display: 'block', marginBottom: 2 }}>
                          ពណ៌ Watermark
                        </span>
                        <select
                          value={settings?.watermarkColor || '#38BDF8'}
                          onChange={(e) => onSettingChange('watermarkColor', e.target.value)}
                          className="inspector-select"
                          style={{ width: '100%', padding: '4px 6px', fontSize: '0.72rem' }}
                        >
                          <option value="#38BDF8">🔵 ផ្ទៃមេឃ (Cyan Glow)</option>
                          <option value="#FFE600">🟡 លឿងមាស (Gold)</option>
                          <option value="#FFFFFF">⚪ ពណ៌ស (Clean White)</option>
                        </select>
                      </div>
                    </div>
                  )}
                </div>

                {/* 2. Marquee Ticker Text */}
                <div>
                  <span style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: 4, fontWeight: 600 }}>
                    📢 អត្ថបទរត់កាត់អេក្រង់ (Marquee Running Title)
                  </span>
                  <textarea
                    rows={2}
                    value={settings?.marqueeText ?? '«ហាមផុសបន្ត • សូមឱ្យតម្លៃលើការខិតខំរបស់ម្ចាស់ដើម»'}
                    onChange={(e) => onSettingChange('marqueeText', e.target.value)}
                    placeholder="វាយអត្ថបទរត់ការពារគេលួច Copy..."
                    className="inspector-input"
                    style={{
                      width: '100%',
                      fontSize: '0.76rem',
                      padding: '5px 8px',
                      background: 'rgba(0,0,0,0.4)',
                      border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: 4,
                      color: '#fff',
                      resize: 'vertical',
                      fontFamily: 'inherit',
                    }}
                  />

                  {/* 3 One-click Khmer Preset Chips */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                    <button
                      type="button"
                      onClick={() => onSettingChange('marqueeText', '«ហាមផុសបន្ត • សូមឱ្យតម្លៃលើការខិតខំរបស់ម្ចាស់ដើម»')}
                      className="preset-tag-btn"
                      style={{
                        fontSize: '0.66rem',
                        padding: '2px 6px',
                        borderRadius: 3,
                        background: 'rgba(56, 189, 248, 0.15)',
                        border: '1px solid rgba(56, 189, 248, 0.3)',
                        color: '#38bdf8',
                        cursor: 'pointer',
                      }}
                    >
                      ⚡ ហាមផុសបន្ត
                    </button>
                    <button
                      type="button"
                      onClick={() => onSettingChange('marqueeText', '«រក្សាសិទ្ធិគ្រប់យ៉ាង • ហាមយកទៅផុសបន្តគ្រប់ទម្រង់»')}
                      className="preset-tag-btn"
                      style={{
                        fontSize: '0.66rem',
                        padding: '2px 6px',
                        borderRadius: 3,
                        background: 'rgba(234, 179, 8, 0.15)',
                        border: '1px solid rgba(234, 179, 8, 0.3)',
                        color: '#eab308',
                        cursor: 'pointer',
                      }}
                    >
                      ⚡ រក្សាសិទ្ធិគ្រប់យ៉ាង
                    </button>
                    <button
                      type="button"
                      onClick={() => onSettingChange('marqueeText', '«សូមចុច Like & Follow ដើម្បីទស្សនាភាគបន្ត»')}
                      className="preset-tag-btn"
                      style={{
                        fontSize: '0.66rem',
                        padding: '2px 6px',
                        borderRadius: 3,
                        background: 'rgba(168, 85, 247, 0.15)',
                        border: '1px solid rgba(168, 85, 247, 0.3)',
                        color: '#c084fc',
                        cursor: 'pointer',
                      }}
                    >
                      ⚡ Like & Follow
                    </button>
                  </div>
                </div>

                {/* 3. Speed, Position & Text Color */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                      <span style={{ fontSize: '0.68rem', color: '#64748b' }}>
                        ល្បឿនរត់ (Speed)
                      </span>
                    </div>
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                      <input
                        type="number"
                        min="1"
                        max="300"
                        step="1"
                        value={
                          typeof settings?.marqueeSpeed === 'number'
                            ? settings.marqueeSpeed
                            : (!isNaN(parseFloat(settings?.marqueeSpeed))
                              ? parseFloat(settings?.marqueeSpeed)
                              : (settings?.marqueeSpeed === 'fast' ? 9 : (settings?.marqueeSpeed === 'slow' ? 20 : 13)))
                        }
                        onChange={(e) => {
                          const val = e.target.value === '' ? '' : Math.max(1, Number(e.target.value));
                          onSettingChange('marqueeSpeed', val);
                        }}
                        placeholder="13"
                        className="inspector-select"
                        style={{
                          width: '100%',
                          padding: '4px 22px 4px 6px',
                          fontSize: '0.74rem',
                          fontWeight: 700,
                          color: '#38bdf8',
                        }}
                        title="វាយបញ្ចូលចំនួនវិនាទី (វិនាទីកាន់តែច្រើន រត់កាន់តែយឺត)"
                      />
                      <span
                        style={{
                          position: 'absolute',
                          right: 6,
                          fontSize: '0.66rem',
                          color: '#94a3b8',
                          pointerEvents: 'none',
                          fontWeight: 600,
                        }}
                      >
                        s
                      </span>
                    </div>

                    {/* Quick 1-click Preset Buttons (20s, 13s, 9s) */}
                    <div style={{ display: 'flex', gap: 2, marginTop: 4 }}>
                      {[
                        { label: '20s', val: 20, title: 'យឺត (Slow 20s)' },
                        { label: '13s', val: 13, title: 'មធ្យម (Normal 13s)' },
                        { label: '9s', val: 9, title: 'លឿន (Fast 9s)' },
                      ].map((preset) => {
                        const curVal = typeof settings?.marqueeSpeed === 'number'
                          ? settings.marqueeSpeed
                          : (!isNaN(parseFloat(settings?.marqueeSpeed))
                            ? parseFloat(settings?.marqueeSpeed)
                            : (settings?.marqueeSpeed === 'fast' ? 9 : (settings?.marqueeSpeed === 'slow' ? 20 : 13)));
                        const isSelected = curVal === preset.val;
                        return (
                          <button
                            key={preset.label}
                            type="button"
                            onClick={() => onSettingChange('marqueeSpeed', preset.val)}
                            style={{
                              flex: 1,
                              fontSize: '0.6rem',
                              padding: '2px 0',
                              borderRadius: 3,
                              background: isSelected ? 'rgba(56, 189, 248, 0.25)' : 'rgba(255, 255, 255, 0.05)',
                              border: isSelected ? '1px solid #38bdf8' : '1px solid rgba(255, 255, 255, 0.1)',
                              color: isSelected ? '#38bdf8' : '#94a3b8',
                              cursor: 'pointer',
                              fontWeight: isSelected ? 700 : 400,
                            }}
                            title={preset.title}
                          >
                            {preset.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                                    <div>
                    <span style={{ fontSize: '0.68rem', color: '#64748b', display: 'block', marginBottom: 2 }}>
                      ទំហំអក្សរ & របារ (Size)
                    </span>
                    <select
                      value={settings?.antiTheftSize || 'small'}
                      onChange={(e) => onSettingChange('antiTheftSize', e.target.value)}
                      className="inspector-select"
                      style={{ width: '100%', padding: '4px 6px', fontSize: '0.72rem' }}
                    >
                      <option value="small">តូចស្អាត (Compact - Recommended)</option>
                      <option value="medium">មធ្យម (Normal)</option>
                      <option value="large">ធំ (Large)</option>
                    </select>
                  </div>

                  <div>
                    <span style={{ fontSize: '0.68rem', color: '#64748b', display: 'block', marginBottom: 2 }}>
                      ទីតាំងរបារ (Position)
                    </span>
                    <select
                      value={settings?.marqueePosition || 'bottom'}
                      onChange={(e) => onSettingChange('marqueePosition', e.target.value)}
                      className="inspector-select"
                      style={{ width: '100%', padding: '4px 6px', fontSize: '0.72rem' }}
                    >
                      <option value="bottom">បាតក្រោម (Bottom)</option>
                      <option value="top">ផ្នែកលើ (Top)</option>
                    </select>
                  </div>

                  <div>
                    <span style={{ fontSize: '0.68rem', color: '#64748b', display: 'block', marginBottom: 2 }}>
                      ពណ៌អក្សរ (Color)
                    </span>
                    <select
                      value={settings?.marqueeTextColor || '#FFE600'}
                      onChange={(e) => onSettingChange('marqueeTextColor', e.target.value)}
                      className="inspector-select"
                      style={{ width: '100%', padding: '4px 6px', fontSize: '0.72rem' }}
                    >
                      <option value="#FFE600">🟡 លឿងមាស</option>
                      <option value="#FFFFFF">⚪ ពណ៌ស</option>
                      <option value="#38BDF8">🔵 ផ្ទៃមេឃ</option>
                      <option value="#4ADE80">🟢 បៃតងខ្ចី</option>
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Dynamic 0% - 100% Export Progress Monitor Card */}
          {(isRendering || displayProgress > 0) && (
            <div
              style={{
                background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.95) 0%, rgba(30, 41, 59, 0.9) 100%)',
                border: `1px solid ${displayProgress >= 100 ? 'rgba(16, 185, 129, 0.5)' : 'rgba(56, 189, 248, 0.4)'}`,
                boxShadow: displayProgress >= 100 
                  ? '0 6px 20px rgba(16, 185, 129, 0.15)' 
                  : '0 6px 20px rgba(56, 189, 248, 0.15)',
                borderRadius: 8,
                padding: '12px 14px',
                marginBottom: 10,
                transition: 'all 0.3s ease',
              }}
            >
              {/* Header: Title and Large Monospace Percentage */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  {displayProgress >= 100 ? (
                    <div style={{
                      width: 24,
                      height: 24,
                      borderRadius: '50%',
                      background: 'rgba(16, 185, 129, 0.2)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#10b981',
                      flexShrink: 0,
                    }}>
                      <CheckCircle2 size={16} />
                    </div>
                  ) : (
                    <div style={{
                      width: 24,
                      height: 24,
                      borderRadius: '50%',
                      background: 'rgba(56, 189, 248, 0.2)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#38bdf8',
                      flexShrink: 0,
                    }}>
                      <Loader2 size={15} className="animate-spin" />
                    </div>
                  )}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#f8fafc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {displayProgress >= 100 ? '🎉 Export វីដេអូជោគជ័យ 100%' : 'កំពុង Render & Export វីដេអូ...'}
                    </div>
                    <div style={{ fontSize: '0.71rem', color: displayProgress >= 100 ? '#34d399' : '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {currentStageText}
                    </div>
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 8 }}>
                  <span style={{
                    fontSize: '1.35rem',
                    fontWeight: 800,
                    fontFamily: 'monospace',
                    color: displayProgress >= 100 ? '#10b981' : '#38bdf8',
                    textShadow: displayProgress >= 100 ? '0 0 12px rgba(16, 185, 129, 0.4)' : '0 0 12px rgba(56, 189, 248, 0.4)',
                    letterSpacing: '-0.02em',
                  }}>
                    {displayProgress}%
                  </span>
                </div>
              </div>

              {/* Glowing Progress Bar Track */}
              <div style={{
                width: '100%',
                height: 8,
                background: 'rgba(255, 255, 255, 0.08)',
                borderRadius: 9999,
                overflow: 'hidden',
                position: 'relative',
                marginBottom: 8,
              }}>
                <div
                  style={{
                    height: '100%',
                    width: `${displayProgress}%`,
                    background: displayProgress >= 100 
                      ? 'linear-gradient(90deg, #10b981, #34d399)'
                      : 'linear-gradient(90deg, #3b82f6 0%, #06b6d4 50%, #10b981 100%)',
                    borderRadius: 9999,
                    transition: 'width 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                    boxShadow: displayProgress >= 100 
                      ? '0 0 14px rgba(16, 185, 129, 0.7)'
                      : '0 0 14px rgba(6, 182, 212, 0.7)',
                  }}
                />
              </div>

              {/* 4-Step Visual Milestones */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
                <div style={{
                  padding: '3px 4px',
                  borderRadius: 4,
                  fontSize: '0.62rem',
                  textAlign: 'center',
                  background: displayProgress >= 1 ? 'rgba(56, 189, 248, 0.15)' : 'rgba(255, 255, 255, 0.04)',
                  color: displayProgress >= 1 ? '#38bdf8' : '#64748b',
                  fontWeight: displayProgress >= 1 && displayProgress < 25 ? 700 : 500,
                  border: displayProgress >= 1 && displayProgress < 25 ? '1px solid rgba(56, 189, 248, 0.4)' : '1px solid transparent',
                }}>
                  1. Subtitles
                </div>
                <div style={{
                  padding: '3px 4px',
                  borderRadius: 4,
                  fontSize: '0.62rem',
                  textAlign: 'center',
                  background: displayProgress >= 25 ? 'rgba(56, 189, 248, 0.15)' : 'rgba(255, 255, 255, 0.04)',
                  color: displayProgress >= 25 ? '#38bdf8' : '#64748b',
                  fontWeight: displayProgress >= 25 && displayProgress < 55 ? 700 : 500,
                  border: displayProgress >= 25 && displayProgress < 55 ? '1px solid rgba(56, 189, 248, 0.4)' : '1px solid transparent',
                }}>
                  2. Ducking
                </div>
                <div style={{
                  padding: '3px 4px',
                  borderRadius: 4,
                  fontSize: '0.62rem',
                  textAlign: 'center',
                  background: displayProgress >= 55 ? 'rgba(56, 189, 248, 0.15)' : 'rgba(255, 255, 255, 0.04)',
                  color: displayProgress >= 55 ? '#38bdf8' : '#64748b',
                  fontWeight: displayProgress >= 55 && displayProgress < 85 ? 700 : 500,
                  border: displayProgress >= 55 && displayProgress < 85 ? '1px solid rgba(56, 189, 248, 0.4)' : '1px solid transparent',
                }}>
                  3. FFmpeg
                </div>
                <div style={{
                  padding: '3px 4px',
                  borderRadius: 4,
                  fontSize: '0.62rem',
                  textAlign: 'center',
                  background: displayProgress >= 85 ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255, 255, 255, 0.04)',
                  color: displayProgress >= 85 ? '#10b981' : '#64748b',
                  fontWeight: displayProgress >= 85 ? 700 : 500,
                  border: displayProgress >= 85 ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid transparent',
                }}>
                  4. Downloads
                </div>
              </div>
            </div>
          )}

          {/* Export / Render Action Button */}
          <button
            type="button"
            onClick={onRenderVideo}
            disabled={isRendering || isBatchRunning || isBatchStarting || !selectedVideo || (!audioGenerated && !previewAudioUrl)}
            className="capcut-export-btn btn-tactile"
            style={{
              fontSize: '0.88rem',
              padding: '10px 14px',
              position: 'relative',
              overflow: 'hidden',
              background: isRendering ? 'rgba(30, 41, 59, 0.85)' : undefined,
              border: isRendering ? '1px solid rgba(56, 189, 248, 0.5)' : undefined,
            }}
          >
            {isRendering ? (
              <>
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    bottom: 0,
                    width: `${displayProgress}%`,
                    background: 'linear-gradient(90deg, rgba(59, 130, 246, 0.3), rgba(6, 182, 212, 0.4))',
                    transition: 'width 0.25s ease-out',
                    zIndex: 0,
                  }}
                />
                <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, width: '100%' }}>
                  <Loader2 size={15} className="animate-spin" style={{ color: '#38bdf8' }} />
                  <span style={{ color: '#f8fafc', fontWeight: 600 }}>
                    កំពុង Render... {displayProgress}%
                  </span>
                </div>
              </>
            ) : (
              <>
                <Clapperboard size={15} />
                <span>{renderedVideo ? 'Re-Export Dubbed Video' : 'Export Dubbed Video (.mp4)'}</span>
              </>
            )}
          </button>

          {/* If rendered, quick download and caption copy */}
          {renderedVideo && (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ 
                fontSize: '0.76rem', 
                color: 'var(--color-success)', 
                background: 'rgba(34, 197, 94, 0.1)', 
                padding: '8px 10px', 
                borderRadius: 'var(--radius-sm)', 
                border: '1px solid rgba(34, 197, 94, 0.25)', 
                display: 'flex', 
                alignItems: 'center', 
                gap: 6 
              }}>
                <Check size={14} color="var(--color-success)" />
                <span>បាន Export ចូល Folder <strong>Downloads</strong> លើកុំព្យូទ័ររួចរាល់!</span>
              </div>
              <a
                href={typeof renderedVideo === 'string' ? renderedVideo : (renderedVideo.downloadUrl || renderedVideo.outputVideoUrl)}
                download={
                  renderedVideo?.outputFilename ||
                  (selectedVideo?.fileName
                    ? `${selectedVideo.fileName.replace(/\.[^/.]+$/, '').trim()}_Khmer_Dubbed.mp4`
                    : 'Dubbed_Video_Khmer.mp4')
                }
                className="btn-emerald"
                style={{ width: '100%', justifyContent: 'center', fontSize: '0.82rem', padding: '8px', textDecoration: 'none' }}
              >
                <Download size={14} />
                <span>
                  Download {renderedVideo?.outputFilename || (selectedVideo?.fileName ? `${selectedVideo.fileName.replace(/\.[^/.]+$/, '').trim()}_Khmer_Dubbed.mp4` : 'Dubbed Video.mp4')}
                </span>
              </a>

              <button
                onClick={onCopyCaption}
                className="btn-secondary"
                style={{ width: '100%', justifyContent: 'center', fontSize: '0.76rem', padding: '6px' }}
                title="Copy full story text for TikTok or Facebook post caption"
              >
                {copiedCaption ? <Check size={12} color="var(--color-success)" /> : <Copy size={12} />}
                <span>{copiedCaption ? 'Copied Post Caption!' : 'Copy TikTok / Facebook Caption'}</span>
              </button>
            </div>
          )}

          {/* ── Batch Export & Full Video Merge Section ── */}
          {seriesEpisodes.length > 0 && batchRender && (
            <div
              style={{
                marginTop: 14,
                paddingTop: 12,
                borderTop: '1px solid rgba(255, 255, 255, 0.1)',
              }}
            >
              {/* Collapsible Header */}
              <div
                onClick={() => setIsBatchExpanded((prev) => !prev)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  marginBottom: isBatchExpanded ? 8 : 0,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <Layers size={14} color="#38bdf8" />
                  <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#f8fafc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    Batch Export & Merge ({seriesEpisodes.length} ភាគ)
                  </span>
                  {isBatchRunning && (
                    <span style={{ fontSize: '0.64rem', fontWeight: 800, color: '#38bdf8', background: 'rgba(56,189,248,0.16)', padding: '1px 6px', borderRadius: 9999 }}>
                      {batchJob?.progress || 0}%
                    </span>
                  )}
                </div>
                {isBatchExpanded ? <ChevronUp size={14} color="var(--text-dim)" /> : <ChevronDown size={14} color="var(--text-dim)" />}
              </div>

              {isBatchExpanded && (
                <div
                  style={{
                    background: 'rgba(15, 23, 42, 0.55)',
                    border: '1px solid rgba(56, 189, 248, 0.22)',
                    borderRadius: 8,
                    padding: '10px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  {/* Quick Select Bar */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 }}>
                    <span style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 600 }}>
                      បានជ្រើស {selectedBatchEpisodes.length}/{episodesWithVideo.length} ភាគ (មានសំឡេង {selectedVoicedEpisodes.length})
                    </span>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        disabled={isBatchRunning || episodesWithVideo.length === 0}
                        onClick={() => setSelectedBatchEpIds(episodesWithVideo.map((e) => e.id))}
                        style={{
                          fontSize: '0.64rem',
                          padding: '2px 7px',
                          borderRadius: 4,
                          background: 'rgba(56, 189, 248, 0.16)',
                          border: '1px solid rgba(56, 189, 248, 0.35)',
                          color: '#38bdf8',
                          fontWeight: 700,
                          cursor: isBatchRunning ? 'not-allowed' : 'pointer',
                        }}
                      >
                        ទាំងអស់ ({episodesWithVideo.length})
                      </button>
                      <button
                        type="button"
                        disabled={isBatchRunning}
                        onClick={() => setSelectedBatchEpIds(episodesWithVideo.filter((e) => checkEpHasVoice(e)).map((e) => e.id))}
                        style={{
                          fontSize: '0.64rem',
                          padding: '2px 7px',
                          borderRadius: 4,
                          background: 'rgba(16, 185, 129, 0.14)',
                          border: '1px solid rgba(16, 185, 129, 0.35)',
                          color: '#34d399',
                          fontWeight: 700,
                          cursor: isBatchRunning ? 'not-allowed' : 'pointer',
                        }}
                      >
                        មាន Voice ({episodesWithVideo.filter((e) => checkEpHasVoice(e)).length})
                      </button>
                      <button
                        type="button"
                        disabled={isBatchRunning || selectedBatchEpIds.length === 0}
                        onClick={() => setSelectedBatchEpIds([])}
                        style={{
                          fontSize: '0.64rem',
                          padding: '2px 7px',
                          borderRadius: 4,
                          background: 'rgba(255, 255, 255, 0.06)',
                          border: '1px solid rgba(255, 255, 255, 0.12)',
                          color: '#cbd5e1',
                          cursor: isBatchRunning ? 'not-allowed' : 'pointer',
                        }}
                      >
                        លុបជម្រើស
                      </button>
                    </div>
                  </div>

                  {/* Episode Checkboxes Grid */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(70px, 1fr))',
                      gap: 5,
                      maxHeight: 132,
                      overflowY: 'auto',
                      paddingRight: 2,
                    }}
                  >
                    {seriesEpisodes.map((ep, idx) => {
                      const hasVid = checkEpHasVideo(ep);
                      const hasVoi = checkEpHasVoice(ep);
                      const isChecked = selectedBatchSet.has(String(ep.id));
                      const epNum = ep.episodeNumber || idx + 1;
                      return (
                        <label
                          key={ep.id}
                          title={`${ep.title || `EP${epNum}`} • ${!hasVid ? 'គ្មានវីដេអូ' : hasVoi ? 'មានសំឡេងខ្មែររួច' : 'មិនទាន់មានសំឡេងខ្មែរ'}`}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '4px 6px',
                            borderRadius: 5,
                            fontSize: '0.69rem',
                            fontWeight: 700,
                            cursor: !hasVid || isBatchRunning ? 'not-allowed' : 'pointer',
                            opacity: hasVid ? 1 : 0.45,
                            background: isChecked
                              ? (hasVoi ? 'rgba(16, 185, 129, 0.18)' : 'rgba(245, 158, 11, 0.16)')
                              : 'rgba(255, 255, 255, 0.04)',
                            border: isChecked
                              ? (hasVoi ? '1px solid rgba(52, 211, 153, 0.45)' : '1px solid rgba(251, 191, 36, 0.45)')
                              : '1px solid rgba(255, 255, 255, 0.08)',
                            color: isChecked ? '#f8fafc' : '#94a3b8',
                            userSelect: 'none',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            disabled={!hasVid || isBatchRunning}
                            onChange={() => toggleBatchEpisode(ep.id)}
                            style={{ margin: 0, accentColor: hasVoi ? '#10b981' : '#f59e0b', cursor: 'inherit' }}
                          />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>EP{epNum}</span>
                          <span
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: '50%',
                              marginLeft: 'auto',
                              flexShrink: 0,
                              background: !hasVid ? '#475569' : hasVoi ? '#10b981' : '#f59e0b',
                            }}
                          />
                        </label>
                      );
                    })}
                  </div>

                  {/* Missing Voice Warning & Allow Original Audio Checkbox */}
                  {selectedMissingVoiceEpisodes.length > 0 && (
                    <div
                      style={{
                        background: allowOriginalAudio ? 'rgba(56, 189, 248, 0.1)' : 'rgba(245, 158, 11, 0.12)',
                        border: allowOriginalAudio ? '1px solid rgba(56, 189, 248, 0.35)' : '1px solid rgba(245, 158, 11, 0.4)',
                        borderRadius: 6,
                        padding: '7px 8px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: '0.69rem', color: allowOriginalAudio ? '#bae6fd' : '#fde68a', lineHeight: 1.35 }}>
                        <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1, color: allowOriginalAudio ? '#38bdf8' : '#fbbf24' }} />
                        <span>
                          {allowOriginalAudio
                            ? `ភាគអត់ Voice (${selectedMissingVoiceEpisodes.map((e, i) => `EP${e.episodeNumber || i + 1}`).join(', ')}) នឹង Export ដោយប្រើសំឡេងដើម។`
                            : `ភាគ ${selectedMissingVoiceEpisodes.map((e, i) => `EP${e.episodeNumber || i + 1}`).join(', ')} មិនទាន់មានសំឡេងខ្មែរ — នឹងត្រូវរំលងពេល Export!`}
                        </span>
                      </div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: isBatchRunning ? 'not-allowed' : 'pointer', fontSize: '0.7rem', fontWeight: 600, color: '#e2e8f0' }}>
                        <input
                          type="checkbox"
                          checked={allowOriginalAudio}
                          disabled={isBatchRunning}
                          onChange={(e) => setAllowOriginalAudio(e.target.checked)}
                          style={{ margin: 0, accentColor: '#38bdf8' }}
                        />
                        <span>Allow Original Audio (រួមបញ្ចូលភាគអត់ Voice ដោយប្រើសំឡេងដើម)</span>
                      </label>
                    </div>
                  )}

                  {/* Batch Error Alert */}
                  {batchError && (
                    <div
                      style={{
                        background: 'rgba(239, 68, 68, 0.14)',
                        border: '1px solid rgba(239, 68, 68, 0.4)',
                        borderRadius: 6,
                        padding: '6px 8px',
                        fontSize: '0.7rem',
                        color: '#fca5a5',
                        display: 'flex',
                        alignItems: 'flex-start',
                        justifyContent: 'space-between',
                        gap: 6,
                      }}
                    >
                      <span>{batchError}</span>
                      <button
                        type="button"
                        onClick={() => batchRender.clear?.()}
                        style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer', padding: 0, flexShrink: 0 }}
                        title="បិទ"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  )}

                  {/* Two Primary Action Buttons: Merge Full Video & Batch Separate */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <button
                      type="button"
                      disabled={isBatchRunning || isBatchStarting || isRendering || eligibleBatchEpisodes.length === 0}
                      onClick={() => handleStartBatchAction('merge')}
                      className="btn-tactile"
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        borderRadius: 6,
                        background: (isBatchRunning || eligibleBatchEpisodes.length === 0)
                          ? 'rgba(255, 255, 255, 0.06)'
                          : 'linear-gradient(135deg, #0284c7 0%, #2563eb 100%)',
                        border: (isBatchRunning || eligibleBatchEpisodes.length === 0)
                          ? '1px solid rgba(255, 255, 255, 0.12)'
                          : '1px solid rgba(56, 189, 248, 0.55)',
                        color: (isBatchRunning || eligibleBatchEpisodes.length === 0) ? '#64748b' : '#ffffff',
                        fontSize: '0.76rem',
                        fontWeight: 800,
                        cursor: (isBatchRunning || isBatchStarting || isRendering || eligibleBatchEpisodes.length === 0) ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 6,
                      }}
                    >
                      {isBatchRunning && batchJob?.mode === 'merge' ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Film size={14} />
                      )}
                      <span>
                        Export 1 Full Video (Merge {eligibleBatchEpisodes.length} ភាគ)
                      </span>
                    </button>

                    <button
                      type="button"
                      disabled={isBatchRunning || isBatchStarting || isRendering || eligibleBatchEpisodes.length === 0}
                      onClick={() => handleStartBatchAction('separate')}
                      className="btn-tactile"
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        borderRadius: 6,
                        background: (isBatchRunning || eligibleBatchEpisodes.length === 0)
                          ? 'rgba(255, 255, 255, 0.06)'
                          : 'linear-gradient(135deg, rgba(16, 185, 129, 0.22) 0%, rgba(5, 150, 105, 0.3) 100%)',
                        border: (isBatchRunning || eligibleBatchEpisodes.length === 0)
                          ? '1px solid rgba(255, 255, 255, 0.12)'
                          : '1px solid rgba(52, 211, 153, 0.45)',
                        color: (isBatchRunning || eligibleBatchEpisodes.length === 0) ? '#64748b' : '#6ee7b7',
                        fontSize: '0.74rem',
                        fontWeight: 700,
                        cursor: (isBatchRunning || isBatchStarting || isRendering || eligibleBatchEpisodes.length === 0) ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 6,
                      }}
                    >
                      {isBatchRunning && batchJob?.mode === 'separate' ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Layers size={14} />
                      )}
                      <span>
                        Batch Export All ({eligibleBatchEpisodes.length} ភាគដាច់ដោយឡែក)
                      </span>
                    </button>
                  </div>

                  {/* Live Progress Monitor & Downloads Card */}
                  {batchJob && (
                    <div
                      style={{
                        marginTop: 2,
                        background: 'rgba(2, 6, 23, 0.65)',
                        border: batchJob.status === 'completed'
                          ? '1px solid rgba(16, 185, 129, 0.45)'
                          : batchJob.status === 'failed'
                          ? '1px solid rgba(239, 68, 68, 0.45)'
                          : '1px solid rgba(56, 189, 248, 0.4)',
                        borderRadius: 6,
                        padding: '8px 10px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                        <span style={{ fontSize: '0.71rem', fontWeight: 700, color: '#f8fafc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {batchJob.stage || 'កំពុងដំណើរការ Batch Export...'}
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                          <span style={{ fontSize: '0.82rem', fontWeight: 800, fontFamily: 'monospace', color: batchJob.status === 'completed' ? '#34d399' : '#38bdf8' }}>
                            {batchJob.progress || 0}%
                          </span>
                          {batchJob.status !== 'running' && (
                            <button
                              type="button"
                              onClick={() => batchRender.clear?.()}
                              style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 0 }}
                              title="បិទផ្ទាំងលទ្ធផល"
                            >
                              <X size={13} />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Progress Bar */}
                      <div style={{ width: '100%', height: 6, borderRadius: 9999, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                        <div
                          style={{
                            width: `${Math.max(2, batchJob.progress || 0)}%`,
                            height: '100%',
                            borderRadius: 9999,
                            background: batchJob.status === 'completed'
                              ? 'linear-gradient(90deg, #10b981, #34d399)'
                              : batchJob.status === 'failed'
                              ? '#ef4444'
                              : 'linear-gradient(90deg, #3b82f6, #06b6d4)',
                            transition: 'width 0.25s ease',
                          }}
                        />
                      </div>

                      {batchJob.status === 'running' && (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                          <span style={{ fontSize: '0.67rem', color: '#94a3b8' }}>
                            {batchJob.currentEpisodeTitle
                              ? `${batchJob.currentIndex}/${batchJob.totalCount}: ${batchJob.currentEpisodeTitle}`
                              : `កំពុងដំណើរការ ${batchJob.currentIndex || 0}/${batchJob.totalCount || 0}`}
                          </span>
                          <button
                            type="button"
                            onClick={() => batchRender.kill?.(batchJob.jobId)}
                            style={{
                              fontSize: '0.67rem',
                              fontWeight: 700,
                              padding: '3px 8px',
                              borderRadius: 4,
                              background: 'rgba(239, 68, 68, 0.22)',
                              border: '1px solid rgba(239, 68, 68, 0.55)',
                              color: '#fecaca',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                            }}
                          >
                            <Square size={10} />
                            <span>Stop (Kill)</span>
                          </button>
                        </div>
                      )}

                      {Array.isArray(batchJob.skippedEpisodes) && batchJob.skippedEpisodes.length > 0 && batchJob.status !== 'running' && (
                        <div style={{ fontSize: '0.66rem', color: '#fbbf24' }}>
                          ⚠️ បានរំលង {batchJob.skippedEpisodes.length} ភាគអត់ Voice: {batchJob.skippedEpisodes.map((s) => `EP${s.episodeNumber}`).join(', ')}
                        </div>
                      )}

                      {/* Merged Full Video Download */}
                      {batchJob.mergedResult?.downloadUrl && (
                        <a
                          href={batchJob.mergedResult.downloadUrl || batchJob.mergedResult.videoUrl}
                          download={batchJob.mergedResult.outputFilename || 'Full_Merged_Khmer_Dubbed.mp4'}
                          className="btn-emerald"
                          style={{ width: '100%', justifyContent: 'center', fontSize: '0.74rem', padding: '7px 8px', textDecoration: 'none' }}
                        >
                          <Download size={13} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            Download Full Video ({batchJob.mergedResult.outputFilename})
                          </span>
                        </a>
                      )}

                      {/* Separate Outputs Downloads List */}
                      {Array.isArray(batchJob.outputs) && batchJob.outputs.length > 0 && batchJob.status === 'completed' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 115, overflowY: 'auto' }}>
                          {batchJob.mode === 'separate' && (
                            <div style={{ fontSize: '0.67rem', color: '#34d399', fontWeight: 600 }}>
                              ✅ បាន Save {batchJob.outputs.length} ភាគ ចូល Folder Downloads រួចរាល់:
                            </div>
                          )}
                          {batchJob.outputs.map((out) => (
                            <a
                              key={out.episodeId || out.outputFilename}
                              href={out.downloadUrl || out.videoUrl}
                              download={out.outputFilename}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: 6,
                                padding: '4px 7px',
                                borderRadius: 4,
                                background: 'rgba(16, 185, 129, 0.1)',
                                border: '1px solid rgba(16, 185, 129, 0.28)',
                                color: '#a7f3d0',
                                fontSize: '0.68rem',
                                textDecoration: 'none',
                              }}
                            >
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                EP{out.episodeNumber}: {out.outputFilename}
                              </span>
                              <Download size={12} style={{ flexShrink: 0 }} />
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
