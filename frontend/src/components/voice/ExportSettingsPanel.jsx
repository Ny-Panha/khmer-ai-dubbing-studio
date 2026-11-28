import React, { useState, useEffect } from 'react';
import {
  Clapperboard, Subtitles, Loader2, ChevronUp, ChevronDown,
  CheckCircle2, ShieldCheck, Image, Upload, Tv, Trash2, VolumeX
} from 'lucide-react';
import { resolveDefaultAspectRatio, sanitizeAspectRatio } from '../../utils/projectStorage';
import SmoothRangeSlider from '../common/SmoothRangeSlider';

function ExportSettingsPanel({
  isOpen,
  onToggle,
  settings,
  onSettingChange,
  isRendering,
  renderProgress = 0,
  renderStage = '',
  selectedVideo,
  videoMetadata = null,
  activeEpisode = null,
  activeSeries = null,
  videoEditScope = 'folder',
  onChangeVideoEditScope = null,
  onApplyVideoEditSettings = null,
  onInsertVideoAd = null,
  currentTime = 0,
}) {
  const [internalProgress, setInternalProgress] = useState(0);
  const [internalStage, setInternalStage] = useState('');
  const [isUploadingSponsor, setIsUploadingSponsor] = useState(false);
  const [sponsorUploadError, setSponsorUploadError] = useState(null);
  const [videoAdLibrary, setVideoAdLibrary] = useState([]);
  const [isUploadingVideoAd, setIsUploadingVideoAd] = useState(false);
  const [videoAdError, setVideoAdError] = useState(null);
  const [videoAdAppliedMsg, setVideoAdAppliedMsg] = useState(null);
  const [draftSliders, setDraftSliders] = useState({});
  const [isYoutubeSafeOpen, setIsYoutubeSafeOpen] = useState(false);
  const [applyStatus, setApplyStatus] = useState(null); // 'applying' | 'done' | null

  const fetchVideoAdLibrary = async () => {
    try {
      const res = await fetch('/api/sponsor-videos');
      const data = await res.json();
      if (data?.success && Array.isArray(data.videos)) {
        setVideoAdLibrary(data.videos);
      }
    } catch (_) {}
  };

  useEffect(() => {
    if (isOpen && settings?.enableVideoAds) {
      fetchVideoAdLibrary();
    }
  }, [isOpen, settings?.enableVideoAds]);

  const handleVideoAdUpload = async (file) => {
    if (!file) return;
    setIsUploadingVideoAd(true);
    setVideoAdError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/upload-sponsor-video', { method: 'POST', body: formData });
      const data = await res.json();
      if (res.ok && data?.success && data.videoUrl) {
        onSettingChange({
          enableVideoAds: true,
          videoAdUrl: data.videoUrl,
          videoAdPath: data.videoPath,
          videoAdName: data.originalName || data.filename,
          videoAdDuration: Number(data.durationSec) || 0,
          videoAdHasAudio: Boolean(data.hasAudio),
        });
        await fetchVideoAdLibrary();
      } else {
        setVideoAdError(data?.error || 'Upload failed');
      }
    } catch (err) {
      setVideoAdError(err.message || 'Network error');
    } finally {
      setIsUploadingVideoAd(false);
    }
  };

  const setSliderDraft = (key, val) => {
    setDraftSliders((prev) => {
      if (val === null || val === undefined) {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      }
      if (prev[key] === val) return prev;
      return { ...prev, [key]: val };
    });
  };

  const getSliderDisplay = (key, committedVal) =>
    Object.prototype.hasOwnProperty.call(draftSliders, key) ? draftSliders[key] : committedVal;

  const handleSponsorUpload = async (file) => {
    if (!file) return;
    setIsUploadingSponsor(true);
    setSponsorUploadError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/upload-sponsor-video', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (data.success && data.videoUrl) {
        onSettingChange({
          sponsorVideoUrl: data.videoUrl,
          sponsorVideoPath: data.videoPath,
        });
      } else {
        setSponsorUploadError(data.error || 'Upload failed');
      }
    } catch (err) {
      setSponsorUploadError(err.message || 'Network error');
    } finally {
      setIsUploadingSponsor(false);
    }
  };

  const srcW = Number(videoMetadata?.width || selectedVideo?.width || activeEpisode?.metadata?.width || activeEpisode?.video?.width) || 0;
  const srcH = Number(videoMetadata?.height || selectedVideo?.height || activeEpisode?.metadata?.height || activeEpisode?.video?.height) || 0;
  const defaultAspectRatio = resolveDefaultAspectRatio(srcW, srcH) || '16:9';
  const rawAspectRatio = sanitizeAspectRatio(settings?.aspectRatio) || defaultAspectRatio;
  const effectiveAspectRatio = sanitizeAspectRatio(rawAspectRatio) || '16:9';
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
        setInternalStage('1/4 បង្កើតអក្សរខ្មែរ .ASS');
        timer = setInterval(() => {
          setInternalProgress((prev) => {
            let next = prev;
            if (prev < 25) {
              next = prev + 2;
              if (next >= 25) setInternalStage('2/4 បន្ថយសំឡេងដើម Smart Ducking');
            } else if (prev < 55) {
              next = prev + 1;
              if (next >= 55) setInternalStage('3/4 បញ្ចូលសំឡេងខ្មែរ AI & Clean BGM');
            } else if (prev < 85) {
              next = prev + 1;
              if (next >= 85) setInternalStage('4/4 Render វីដេអូ MP4');
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
        setInternalStage('Render ជោគជ័យ 100%');
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

  const ytMirrorOn = Boolean(settings?.enableMirrorFlip);
  const ytZoomRaw = Number(settings?.zoomScale);
  const ytZoomVal = Number.isFinite(ytZoomRaw) ? Math.max(1.0, Math.min(1.15, ytZoomRaw)) : 1.0;
  const ytZoomDisplay = getSliderDisplay('zoomScale', ytZoomVal);
  const ytColorOn = Boolean(settings?.enableColorGrade);
  const ytSafeAudioOn = Boolean(settings?.youtubeSafeAudio);
  const ytActiveCount =
    (ytMirrorOn ? 1 : 0) +
    (ytZoomVal > 1.005 ? 1 : 0) +
    (ytColorOn ? 1 : 0) +
    (ytSafeAudioOn ? 1 : 0);
  const isYoutubePresetActive = ytZoomVal >= 1.055 && ytColorOn && ytSafeAudioOn;

  const displayProgress = renderProgress > 0 ? renderProgress : internalProgress;
  const currentStageText = renderStage || internalStage || (
    displayProgress < 25 
      ? '1/4 បង្កើតអក្សរខ្មែរ .ASS'
      : displayProgress < 55 
        ? '2/4 បន្ថយសំឡេងដើម Smart Ducking'
        : displayProgress < 85 
          ? '3/4 បញ្ចូលសំឡេងខ្មែរ AI & Clean BGM'
          : displayProgress < 100 
            ? '4/4 Render វីដេអូ MP4'
            : 'រួចរាល់ 100%'
  );
  return (
    <div className="inspector-card-group">
      {/* Header */}
      <button
        type="button"
        className="inspector-accordion-trigger"
        style={{ marginBottom: isOpen ? 10 : 0 }}
        onClick={onToggle}
        aria-expanded={isOpen}
      >
        <span className="inspector-accordion-title">
          <Clapperboard size={14} color="var(--primary-accent)" />
          <span>ទម្រង់ &amp; អក្សររត់ (Export)</span>
        </span>
        {isOpen ? <ChevronUp size={14} color="var(--text-dim)" /> : <ChevronDown size={14} color="var(--text-dim)" />}
      </button>

      {isOpen && (
        <>
          {/* Video Aspect Ratio Selector */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)', fontWeight: 600 }}>
                ទម្រង់វីដេអូ (Aspect Ratio)
              </span>
              <span style={{ fontSize: '0.68rem', color: 'var(--primary-accent)', fontWeight: 500, fontFamily: 'var(--font-mono)' }} title="ទំហំវីដេអូដើម">
                {sourceHint}
              </span>
            </div>
            <select
              value={effectiveAspectRatio}
              onChange={(e) => onSettingChange('aspectRatio', e.target.value)}
              className="inspector-select"
              style={{ width: '100%', padding: '6px 8px', fontSize: '0.78rem' }}
            >
              <option value="16:9">16:9 · Landscape (YouTube)</option>
              <option value="9:16">9:16 · Portrait (TikTok / Reels)</option>
              {effectiveAspectRatio === '1:1' && (
                <option value="1:1">1:1 · Square</option>
              )}
            </select>
          </div>

          {/* 9:16 Vertical Style Choice */}
          {effectiveAspectRatio === '9:16' && (
            <div style={{ marginBottom: 12, padding: '8px 10px', background: 'var(--bg-secondary-panel)', borderRadius: 6, border: '1px solid var(--border-subtle)' }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)', display: 'block', marginBottom: 4, fontWeight: 600 }}>
                ម៉ូដ 9:16 (Vertical Framing)
              </span>
              <select
                value={effectiveVerticalStyle}
                onChange={(e) => onSettingChange('verticalStyle', e.target.value)}
                className="inspector-select"
                style={{ width: '100%', padding: '6px 8px', fontSize: '0.78rem' }}
              >
                <option value="pad">Pad — គែមខ្មៅ ឃើញពេញរូបដើម</option>
                <option value="crop">Crop — ពង្រីកពេញអេក្រង់កណ្តាល</option>
              </select>
              <span style={{ fontSize: '0.66rem', color: 'var(--text-dim)', display: 'block', marginTop: 4 }}>
                {effectiveVerticalStyle === 'crop'
                  ? 'ពង្រីកពេញអេក្រង់ទូរស័ព្ទ (1080×1920) គ្មានគែមខ្មៅ'
                  : 'រក្សារូបដើមទាំងមូល ដោយដាក់គែមខ្មៅលើក្រោម'}
              </span>
            </div>
          )}

          {/* Subtitle Burn Switch */}
          <label className="checkbox-container" style={{ marginBottom: settings?.burnSubtitles !== false ? 10 : 12 }}>
            <input
              type="checkbox"
              data-testid="export-burn-subtitles-checkbox"
              checked={settings?.burnSubtitles !== false}
              onChange={(e) => onSettingChange('burnSubtitles', e.target.checked)}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Subtitles size={14} color="var(--track-subtitle)" />
              <span style={{ fontSize: '0.8rem', color: 'var(--text-primary)', fontWeight: 600 }}>
                អក្សររត់លើវីដេអូ (Burn Subtitles)
              </span>
            </div>
          </label>

          {/* Subtitle Style Controls (Style, Color & Size) */}
          {settings?.burnSubtitles !== false && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12, paddingLeft: 6 }}>
              <div style={{ gridColumn: 'span 2' }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>
                  ម៉ូដអក្សររត់ (Subtitle Style)
                </span>
                <select
                  data-testid="export-subtitle-style-select"
                  value={settings?.subtitleStyle || 'banner'}
                  onChange={(e) => onSettingChange('subtitleStyle', e.target.value)}
                  className="inspector-select"
                  style={{ width: '100%', padding: '5px 8px', fontSize: '0.78rem' }}
                >
                  <option value="banner">Title Banner · ប្រអប់ខ្មៅបាំង Sub ដើម</option>
                  <option value="pill">CapCut Pill · ប្រអប់មូលថ្លា</option>
                  <option value="cinema">Cinema Soft · ស្រមោលអក្សរទន់</option>
                </select>
              </div>

              <div>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>
                  ពណ៌អក្សរ
                </span>
                <select
                  data-testid="export-subtitle-color-select"
                  value={settings?.subtitleColor || 'white'}
                  onChange={(e) => onSettingChange('subtitleColor', e.target.value)}
                  className="inspector-select"
                  style={{ width: '100%', padding: '5px 8px', fontSize: '0.78rem' }}
                >
                  <option value="white">ស (White)</option>
                  <option value="yellow">លឿង (Yellow)</option>
                </select>
              </div>

              <div>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>
                  ទំហំអក្សរ
                </span>
                <select
                  data-testid="export-subtitle-size-select"
                  value={settings?.subtitleSize || 'medium'}
                  onChange={(e) => onSettingChange('subtitleSize', e.target.value)}
                  className="inspector-select"
                  style={{ width: '100%', padding: '5px 8px', fontSize: '0.78rem' }}
                >
                  <option value="small">តូច</option>
                  <option value="medium">ស្តង់ដារ</option>
                  <option value="large">ធំ</option>
                </select>
              </div>
            </div>
          )}

          {/* Logo Watermark Switch */}
          <div style={{ marginTop: 10, marginBottom: 12, borderTop: '1px solid var(--border-subtle)', paddingTop: 10 }}>
            <label className="checkbox-container" style={{ marginBottom: settings?.enableLogo ? 10 : 6 }}>
              <input
                type="checkbox"
                checked={Boolean(settings?.enableLogo)}
                onChange={(e) => onSettingChange('enableLogo', e.target.checked)}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Image size={14} color="#eab308" />
                <span style={{ fontSize: '0.8rem', color: 'var(--text-primary)', fontWeight: 600 }}>
                  Logo ឆានែល (Watermark)
                </span>
                {settings?.enableLogo && (
                  <span style={{ fontSize: '0.65rem', background: 'rgba(234, 179, 8, 0.16)', color: '#fde047', padding: '1px 6px', borderRadius: 4, fontWeight: 600 }}>
                    {settings?.logoPosition === 'both' ? 'សងខាង' : (settings?.logoPosition === 'top-left' ? 'ឆ្វេង' : 'ស្តាំ')}
                  </span>
                )}
              </div>
            </label>

            {settings?.enableLogo && (
              <div style={{
                background: 'var(--bg-secondary-panel)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                padding: '10px',
                marginBottom: 12,
                display: 'flex',
                flexDirection: 'column',
                gap: 10
              }}>
                {/* 1. Preview current logo & Upload button */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 44,
                    height: 44,
                    borderRadius: settings?.logoShape === 'square' ? 6 : '50%',
                    overflow: 'hidden',
                    border: '1.5px solid rgba(234, 179, 8, 0.5)',
                    background: '#000',
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    {settings?.logoImage ? (
                      <img src={settings.logoImage} alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <Image size={20} color="#64748b" />
                    )}
                  </div>

                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      background: 'rgba(234, 179, 8, 0.12)',
                      border: '1px solid rgba(234, 179, 8, 0.35)',
                      color: '#fde047',
                      padding: '5px 10px',
                      borderRadius: 6,
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      textAlign: 'center'
                    }}>
                      <Upload size={13} />
                      <span>បង្ហោះរូប Logo</span>
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
                        color: 'var(--text-dim)',
                        fontSize: '0.68rem',
                        cursor: 'pointer',
                        padding: '2px 0'
                      }}
                    >
                      ប្រើរូបគំរូ Dragon Town
                    </button>
                  </div>
                </div>

                {/* 2. Position & Shape Row */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <div>
                    <span style={{ fontSize: '0.68rem', color: 'var(--text-dim)', display: 'block', marginBottom: 2 }}>
                      ទីតាំង Logo
                    </span>
                    <select
                      value={settings?.logoPosition || 'both'}
                      onChange={(e) => onSettingChange('logoPosition', e.target.value)}
                      className="inspector-select"
                      style={{ width: '100%', padding: '4px 6px', fontSize: '0.72rem' }}
                    >
                      <option value="both">សងខាង (Both Sides)</option>
                      <option value="top-left">ជ្រុងលើឆ្វេង (Top Left)</option>
                      <option value="top-right">ជ្រុងលើស្តាំ (Top Right)</option>
                      <option value="center">ចំកណ្តាល (Center)</option>
                      <option value="custom">ទីតាំងសេរី (Custom Drag)</option>
                      <option value="bottom-left">ជ្រុងក្រោមឆ្វេង (Bottom Left)</option>
                      <option value="bottom-right">ជ្រុងក្រោមស្តាំ (Bottom Right)</option>
                    </select>
                  </div>

                  <div>
                    <span style={{ fontSize: '0.68rem', color: 'var(--text-dim)', display: 'block', marginBottom: 2 }}>
                      ទម្រង់ (Shape)
                    </span>
                    <select
                      value={settings?.logoShape || 'circle'}
                      onChange={(e) => onSettingChange('logoShape', e.target.value)}
                      className="inspector-select"
                      style={{ width: '100%', padding: '4px 6px', fontSize: '0.72rem' }}
                    >
                      <option value="circle">រង្វង់មូល (Circle)</option>
                      <option value="square">រាងដើម (Original)</option>
                    </select>
                  </div>
                </div>

                {/* 3. Sliders: Size & Opacity */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                      <span style={{ fontSize: '0.68rem', color: 'var(--text-dim)' }}>ទំហំ (Size)</span>
                      <span style={{ fontSize: '0.68rem', color: '#fde047', fontFamily: 'var(--font-mono)' }}>
                        {getSliderDisplay('logoSize', settings?.logoSize || 72)}px
                      </span>
                    </div>
                    <SmoothRangeSlider
                      min={40}
                      max={140}
                      step={4}
                      value={settings?.logoSize || 72}
                      previewKey="logoSize"
                      onDraftChange={(v) => setSliderDraft('logoSize', v)}
                      onCommit={(v) => onSettingChange('logoSize', v)}
                      data-testid="slider-logo-size"
                      style={{ width: '100%', accentColor: '#eab308' }}
                    />
                  </div>

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                      <span style={{ fontSize: '0.68rem', color: 'var(--text-dim)' }}>ភាពច្បាស់ (Opacity)</span>
                      <span style={{ fontSize: '0.68rem', color: '#fde047', fontFamily: 'var(--font-mono)' }}>
                        {Math.round(getSliderDisplay('logoOpacity', settings?.logoOpacity ?? 0.9) * 100)}%
                      </span>
                    </div>
                    <SmoothRangeSlider
                      min={0.2}
                      max={1.0}
                      step={0.05}
                      value={settings?.logoOpacity ?? 0.9}
                      previewKey="logoOpacity"
                      onDraftChange={(v) => setSliderDraft('logoOpacity', v)}
                      onCommit={(v) => onSettingChange('logoOpacity', v)}
                      data-testid="slider-logo-opacity"
                      style={{ width: '100%', accentColor: '#eab308' }}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Corner Blocker / Disclaimer Mask */}
          <div style={{ marginTop: 10, marginBottom: 12, borderTop: '1px solid var(--border-subtle)', paddingTop: 10 }}>
            <label className="checkbox-container" style={{ marginBottom: settings?.enableCornerMask ? 10 : 6 }}>
              <input
                type="checkbox"
                checked={Boolean(settings?.enableCornerMask)}
                onChange={(e) => onSettingChange('enableCornerMask', e.target.checked)}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <ShieldCheck size={14} color="var(--primary-accent)" />
                <span style={{ fontSize: '0.8rem', color: 'var(--text-primary)', fontWeight: 600 }}>
                  បាំងជ្រុងលើ (Corner Mask)
                </span>
                {settings?.enableCornerMask && (
                  <span style={{ fontSize: '0.65rem', background: 'rgba(56, 189, 248, 0.14)', color: 'var(--primary-accent)', padding: '1px 6px', borderRadius: 4, fontWeight: 600 }}>
                    {settings?.cornerMaskPosition === 'custom'
                      ? `អូសផ្ទាល់ (${Math.round(settings?.cornerMaskXPercent ?? 50)}% · ${Math.round(settings?.cornerMaskYPercent ?? 50)}%)`
                      : settings?.cornerMaskPosition === 'top-left'
                        ? 'ឆ្វេងលើ'
                        : settings?.cornerMaskPosition === 'bottom-left'
                          ? 'ឆ្វេងក្រោម'
                          : settings?.cornerMaskPosition === 'bottom-right'
                            ? 'ស្តាំក្រោម'
                            : 'ស្តាំលើ'}
                  </span>
                )}
              </div>
            </label>

            {settings?.enableCornerMask && (
              <div style={{
                background: 'var(--bg-secondary-panel)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                padding: '10px',
                marginBottom: 12,
                display: 'flex',
                flexDirection: 'column',
                gap: 10
              }}>
                {/* 1. Custom Disclaimer / Watermark Text Input */}
                <div>
                  <span style={{ fontSize: '0.68rem', color: 'var(--text-dim)', display: 'block', marginBottom: 3 }}>
                    អក្សរបិទបាំង (Mask Text)
                  </span>
                  <input
                    type="text"
                    value={settings?.cornerMaskText ?? '«រឿងប្រឌិតសុទ្ធសាធ • ហាមចម្លង»'}
                    onChange={(e) => onSettingChange('cornerMaskText', e.target.value)}
                    placeholder="បញ្ចូលអក្សរដើម្បីបាំងពីលើ (ឬទុកទំនេរ)..."
                    style={{
                      width: '100%',
                      background: 'var(--bg-workspace-base)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-primary)',
                      borderRadius: 5,
                      padding: '5px 8px',
                      fontSize: '0.72rem',
                      fontFamily: 'inherit',
                      outline: 'none',
                    }}
                  />
                </div>

                {/* 2. Position & Style Row */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <div>
                    <span style={{ fontSize: '0.68rem', color: 'var(--text-dim)', display: 'block', marginBottom: 2 }}>
                      ទីតាំង (Position)
                    </span>
                    <select
                      value={settings?.cornerMaskPosition || 'top-right'}
                      onChange={(e) => {
                        const pos = e.target.value;
                        if (pos === 'custom') {
                          onSettingChange('cornerMaskPosition', 'custom');
                        } else {
                          onSettingChange({
                            cornerMaskPosition: pos,
                            cornerMaskXPercent: null,
                            cornerMaskYPercent: null,
                          });
                        }
                      }}
                      className="inspector-select"
                      style={{ width: '100%', padding: '4px 6px', fontSize: '0.72rem' }}
                    >
                      <option value="top-right">ជ្រុងលើស្តាំ (Top Right)</option>
                      <option value="top-left">ជ្រុងលើឆ្វេង (Top Left)</option>
                      <option value="bottom-right">ជ្រុងក្រោមស្តាំ (Bottom Right)</option>
                      <option value="bottom-left">ជ្រុងក្រោមឆ្វេង (Bottom Left)</option>
                      <option value="custom">អូសដាក់ផ្ទាល់ (Free Move)</option>
                    </select>
                  </div>

                  <div>
                    <span style={{ fontSize: '0.68rem', color: 'var(--text-dim)', display: 'block', marginBottom: 2 }}>
                      ម៉ូដប្រអប់ (Style)
                    </span>
                    <select
                      value={settings?.cornerMaskStyle || 'badge'}
                      onChange={(e) => onSettingChange('cornerMaskStyle', e.target.value)}
                      className="inspector-select"
                      style={{ width: '100%', padding: '4px 6px', fontSize: '0.72rem' }}
                    >
                      <option value="badge">ប្រអប់អក្សរ (Badge)</option>
                      <option value="blur">ព្រិលពិត (Real Blur)</option>
                      <option value="solid">ខ្មៅសុទ្ធ (Solid Black)</option>
                    </select>
                  </div>
                </div>

                {/* 3. Sliders: Width & Height */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                      <span style={{ fontSize: '0.68rem', color: 'var(--text-dim)' }}>បណ្តោយ (Width)</span>
                      <span style={{ fontSize: '0.68rem', color: 'var(--primary-accent)', fontFamily: 'var(--font-mono)' }}>
                        {getSliderDisplay('cornerMaskWidth', settings?.cornerMaskWidth || 220)}px
                      </span>
                    </div>
                    <SmoothRangeSlider
                      min={100}
                      max={380}
                      step={5}
                      value={settings?.cornerMaskWidth || 220}
                      previewKey="cornerMaskWidth"
                      onDraftChange={(v) => setSliderDraft('cornerMaskWidth', v)}
                      onCommit={(v) => onSettingChange('cornerMaskWidth', v)}
                      data-testid="slider-mask-width"
                      style={{ width: '100%', accentColor: '#38bdf8' }}
                    />
                  </div>

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                      <span style={{ fontSize: '0.68rem', color: 'var(--text-dim)' }}>កម្ពស់ (Height)</span>
                      <span style={{ fontSize: '0.68rem', color: 'var(--primary-accent)', fontFamily: 'var(--font-mono)' }}>
                        {getSliderDisplay('cornerMaskHeight', settings?.cornerMaskHeight || 54)}px
                      </span>
                    </div>
                    <SmoothRangeSlider
                      min={24}
                      max={120}
                      step={2}
                      value={settings?.cornerMaskHeight || 54}
                      previewKey="cornerMaskHeight"
                      onDraftChange={(v) => setSliderDraft('cornerMaskHeight', v)}
                      onCommit={(v) => onSettingChange('cornerMaskHeight', v)}
                      data-testid="slider-mask-height"
                      style={{ width: '100%', accentColor: '#38bdf8' }}
                    />
                  </div>
                </div>

                {/* 4. Sliders: Offset X & Offset Y */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                      <span style={{ fontSize: '0.68rem', color: 'var(--text-dim)' }}>គែមឆ្វេង/ស្តាំ (X)</span>
                      <span style={{ fontSize: '0.68rem', color: 'var(--primary-accent)', fontFamily: 'var(--font-mono)' }}>
                        {getSliderDisplay('cornerMaskOffsetX', Number.isFinite(Number(settings?.cornerMaskOffsetX)) ? Number(settings.cornerMaskOffsetX) : 14)}px
                      </span>
                    </div>
                    <SmoothRangeSlider
                      min={0}
                      max={120}
                      step={2}
                      value={Number.isFinite(Number(settings?.cornerMaskOffsetX)) ? Number(settings.cornerMaskOffsetX) : 14}
                      previewKey="cornerMaskOffsetX"
                      onDraftChange={(v) => setSliderDraft('cornerMaskOffsetX', v)}
                      onCommit={(v) => onSettingChange('cornerMaskOffsetX', v)}
                      data-testid="slider-mask-offset-x"
                      style={{ width: '100%', accentColor: '#38bdf8' }}
                    />
                  </div>

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                      <span style={{ fontSize: '0.68rem', color: 'var(--text-dim)' }}>គែមលើ/ក្រោម (Y)</span>
                      <span style={{ fontSize: '0.68rem', color: 'var(--primary-accent)', fontFamily: 'var(--font-mono)' }}>
                        {getSliderDisplay('cornerMaskOffsetY', Number.isFinite(Number(settings?.cornerMaskOffsetY)) ? Number(settings.cornerMaskOffsetY) : 14)}px
                      </span>
                    </div>
                    <SmoothRangeSlider
                      min={0}
                      max={120}
                      step={2}
                      value={Number.isFinite(Number(settings?.cornerMaskOffsetY)) ? Number(settings.cornerMaskOffsetY) : 14}
                      previewKey="cornerMaskOffsetY"
                      onDraftChange={(v) => setSliderDraft('cornerMaskOffsetY', v)}
                      onCommit={(v) => onSettingChange('cornerMaskOffsetY', v)}
                      data-testid="slider-mask-offset-y"
                      style={{ width: '100%', accentColor: '#38bdf8' }}
                    />
                  </div>
                </div>

                {/* 5. Blur Strength slider (shown when Real Blur style is active) */}
                {(settings?.cornerMaskStyle || 'badge') === 'blur' && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                      <span style={{ fontSize: '0.68rem', color: 'var(--text-dim)' }}>កម្រិតព្រិល (Blur)</span>
                      <span style={{ fontSize: '0.68rem', color: 'var(--primary-accent)', fontFamily: 'var(--font-mono)' }}>
                        {getSliderDisplay('cornerMaskBlur', Number.isFinite(Number(settings?.cornerMaskBlur)) ? Number(settings.cornerMaskBlur) : 18)}px
                      </span>
                    </div>
                    <SmoothRangeSlider
                      min={6}
                      max={36}
                      step={2}
                      value={Number.isFinite(Number(settings?.cornerMaskBlur)) ? Number(settings.cornerMaskBlur) : 18}
                      previewKey="cornerMaskBlur"
                      onDraftChange={(v) => setSliderDraft('cornerMaskBlur', v)}
                      onCommit={(v) => onSettingChange('cornerMaskBlur', v)}
                      data-testid="slider-mask-blur"
                      style={{ width: '100%', accentColor: '#38bdf8' }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Sponsor Ads (Green Screen Video) Switch */}
          <div style={{ marginTop: 10, marginBottom: 12, borderTop: '1px solid var(--border-subtle)', paddingTop: 10 }}>
            <label className="checkbox-container" style={{ marginBottom: settings?.enableSponsor ? 10 : 6 }}>
              <input
                type="checkbox"
                checked={Boolean(settings?.enableSponsor)}
                onChange={(e) => onSettingChange('enableSponsor', e.target.checked)}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Tv size={14} color="#10B981" />
                <span style={{ fontSize: '0.8rem', color: 'var(--text-primary)', fontWeight: 600 }}>
                  ផ្ទាំងពាណិជ្ជកម្ម (Sponsor Ads)
                </span>
                {settings?.enableSponsor && (
                  <span style={{ fontSize: '0.65rem', background: 'rgba(16, 185, 129, 0.16)', color: '#34D399', padding: '1px 6px', borderRadius: 4, fontWeight: 600 }}>
                    {settings?.sponsorTimingMode === 'interval' ? 'Interval' : (settings?.sponsorTimingMode === 'custom' ? 'Custom' : 'Loop')}
                  </span>
                )}
              </div>
            </label>

            {settings?.enableSponsor && (
              <div style={{
                background: 'var(--bg-secondary-panel)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                padding: '10px',
                marginBottom: 12,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}>
                {/* 1. Video Upload & Preview */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 68,
                    height: 42,
                    borderRadius: 6,
                    overflow: 'hidden',
                    border: '1px solid rgba(16, 185, 129, 0.45)',
                    background: '#000',
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    {settings?.sponsorVideoUrl ? (
                      <video
                        src={settings.sponsorVideoUrl}
                        autoPlay
                        loop
                        muted
                        playsInline
                        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                      />
                    ) : (
                      <Tv size={18} color="#64748b" />
                    )}
                  </div>

                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <label style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 6,
                        background: 'rgba(16, 185, 129, 0.12)',
                        border: '1px solid rgba(16, 185, 129, 0.35)',
                        color: '#34D399',
                        padding: '5px 9px',
                        borderRadius: 6,
                        fontSize: '0.70rem',
                        fontWeight: 600,
                        cursor: isUploadingSponsor ? 'not-allowed' : 'pointer',
                        textAlign: 'center',
                        flex: 1,
                      }}>
                        {isUploadingSponsor ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                        <span>{isUploadingSponsor ? 'កំពុងបង្ហោះ...' : 'បង្ហោះវីដេអូ Sponsor'}</span>
                        <input
                          type="file"
                          accept="video/mp4,video/quicktime,video/webm"
                          style={{ display: 'none' }}
                          disabled={isUploadingSponsor}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            e.target.value = '';
                            if (file) handleSponsorUpload(file);
                          }}
                        />
                      </label>

                      {settings?.sponsorVideoUrl && (
                        <button
                          type="button"
                          onClick={() => {
                            onSettingChange({
                              sponsorVideoUrl: null,
                              sponsorVideoPath: null,
                            });
                          }}
                          style={{
                            padding: '5px 7px',
                            background: 'rgba(239, 68, 68, 0.12)',
                            border: '1px solid rgba(239, 68, 68, 0.35)',
                            borderRadius: 6,
                            color: '#F87171',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                          }}
                          title="លុបវីដេអូ Sponsor ចេញ"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        onSettingChange({
                          sponsorVideoUrl: '/assets/sample_sponsor_green.mp4',
                          sponsorVideoPath: 'frontend/public/assets/sample_sponsor_green.mp4',
                        });
                      }}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text-dim)',
                        fontSize: '0.66rem',
                        cursor: 'pointer',
                        padding: '1px 0',
                      }}
                    >
                      ប្រើគំរូ Dragon Sponsor (Green Screen)
                    </button>
                    {sponsorUploadError && (
                      <span style={{ fontSize: '0.64rem', color: '#F87171' }}>{sponsorUploadError}</span>
                    )}
                  </div>
                </div>

                {/* 2. Auto Chroma Key (Green Screen Removal) */}
                <div style={{
                  background: 'var(--bg-workspace-base)',
                  padding: '6px 8px',
                  borderRadius: 6,
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={settings?.sponsorChromaKey !== false}
                      onChange={(e) => onSettingChange('sponsorChromaKey', e.target.checked)}
                      style={{ accentColor: '#10B981' }}
                    />
                    <span style={{ fontSize: '0.70rem', color: 'var(--text-primary)', fontWeight: 600 }}>
                      កាត់ផ្ទៃពណ៌បៃតង (Chroma Key)
                    </span>
                  </label>

                  {settings?.sponsorChromaKey !== false && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontSize: '0.65rem', color: 'var(--text-dim)' }}>ភាពម៉ត់ចត់</span>
                      <SmoothRangeSlider
                        min={0.10}
                        max={0.45}
                        step={0.02}
                        value={settings?.sponsorChromaSimilarity ?? 0.28}
                        previewKey="sponsorChromaSimilarity"
                        onDraftChange={(v) => setSliderDraft('sponsorChromaSimilarity', v)}
                        onCommit={(v) => onSettingChange('sponsorChromaSimilarity', v)}
                        data-testid="slider-sponsor-sensitivity"
                        style={{ flex: 1, accentColor: '#10B981' }}
                      />
                      <span style={{ fontSize: '0.65rem', color: '#34D399', fontFamily: 'var(--font-mono)', width: 32, textAlign: 'right' }}>
                        {Math.round(getSliderDisplay('sponsorChromaSimilarity', settings?.sponsorChromaSimilarity ?? 0.28) * 100)}%
                      </span>
                    </div>
                  )}
                </div>

                {/* 3. Position & Timing Mode */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <div>
                    <span style={{ fontSize: '0.68rem', color: 'var(--text-dim)', display: 'block', marginBottom: 2 }}>
                      ទីតាំង Sponsor
                    </span>
                    <select
                      data-testid="sponsor-position-select"
                      value={settings?.sponsorPosition || 'bottom-left'}
                      onChange={(e) => {
                        const nextPos = e.target.value;
                        if (nextPos === 'custom') {
                          const curX = Number.isFinite(Number(settings?.sponsorXPercent)) && settings?.sponsorXPercent !== null && settings?.sponsorXPercent !== ''
                            ? Number(settings.sponsorXPercent)
                            : 50;
                          const curY = Number.isFinite(Number(settings?.sponsorYPercent)) && settings?.sponsorYPercent !== null && settings?.sponsorYPercent !== ''
                            ? Number(settings.sponsorYPercent)
                            : 50;
                          onSettingChange({
                            sponsorPosition: 'custom',
                            sponsorXPercent: curX,
                            sponsorYPercent: curY,
                          });
                        } else {
                          onSettingChange({
                            sponsorPosition: nextPos,
                            sponsorXPercent: null,
                            sponsorYPercent: null,
                          });
                        }
                      }}
                      className="inspector-select"
                      style={{ width: '100%', padding: '4px 6px', fontSize: '0.72rem' }}
                    >
                      <option value="bottom-left">ក្រោមឆ្វេង (Bottom Left)</option>
                      <option value="bottom-right">ក្រោមស្តាំ (Bottom Right)</option>
                      <option value="top-right">លើស្តាំ (Top Right)</option>
                      <option value="top-left">លើឆ្វេង (Top Left)</option>
                      <option value="bottom-center">កណ្តាលក្រោម (Bottom Center)</option>
                      <option value="custom">ទីតាំងសេរី (Custom Drag)</option>
                    </select>
                    <span style={{ fontSize: '0.62rem', color: 'var(--text-dim)', display: 'block', marginTop: 2 }}>
                      {settings?.sponsorPosition === 'custom' &&
                      typeof settings?.sponsorXPercent === 'number' &&
                      typeof settings?.sponsorYPercent === 'number'
                        ? `X ${settings.sponsorXPercent}% · Y ${settings.sponsorYPercent}%`
                        : 'អូស Banner លើ Preview ដើម្បីផ្លាស់ទី'}
                    </span>
                  </div>

                  <div>
                    <span style={{ fontSize: '0.68rem', color: 'var(--text-dim)', display: 'block', marginBottom: 2 }}>
                      ពេលបង្ហាញ (Timing)
                    </span>
                    <select
                      value={settings?.sponsorTimingMode || 'loop'}
                      onChange={(e) => onSettingChange('sponsorTimingMode', e.target.value)}
                      className="inspector-select"
                      style={{ width: '100%', padding: '4px 6px', fontSize: '0.72rem' }}
                    >
                      <option value="loop">ចាក់ Loop រហូត</option>
                      <option value="interval">ចន្លោះពេល (Interval)</option>
                      <option value="custom">កំណត់ម៉ោង (Custom)</option>
                    </select>
                  </div>
                </div>

                {/* 4. Timing Config (if interval or custom) */}
                {settings?.sponsorTimingMode === 'interval' && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, background: 'var(--bg-workspace-base)', padding: '6px 8px', borderRadius: 6 }}>
                    <div>
                      <span style={{ fontSize: '0.64rem', color: 'var(--text-dim)', display: 'block' }}>រៀងរាល់ (Cycle)</span>
                      <select
                        value={settings?.sponsorIntervalSec || 60}
                        onChange={(e) => onSettingChange('sponsorIntervalSec', Number(e.target.value))}
                        className="inspector-select"
                        style={{ width: '100%', padding: '3px 5px', fontSize: '0.68rem' }}
                      >
                        <option value={30}>30 វិនាទីម្តង</option>
                        <option value={60}>1 នាទីម្តង</option>
                        <option value={90}>1.5 នាទីម្តង</option>
                        <option value={120}>2 នាទីម្តង</option>
                        <option value={180}>3 នាទីម្តង</option>
                      </select>
                    </div>
                    <div>
                      <span style={{ fontSize: '0.64rem', color: 'var(--text-dim)', display: 'block' }}>រយៈពេលបង្ហាញ</span>
                      <select
                        value={settings?.sponsorDurationSec || 10}
                        onChange={(e) => onSettingChange('sponsorDurationSec', Number(e.target.value))}
                        className="inspector-select"
                        style={{ width: '100%', padding: '3px 5px', fontSize: '0.68rem' }}
                      >
                        <option value={5}>5 វិនាទី</option>
                        <option value={8}>8 វិនាទី</option>
                        <option value={10}>10 វិនាទី</option>
                        <option value={15}>15 វិនាទី</option>
                      </select>
                    </div>
                  </div>
                )}

                {settings?.sponsorTimingMode === 'custom' && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, background: 'var(--bg-workspace-base)', padding: '6px 8px', borderRadius: 6 }}>
                    <div>
                      <span style={{ fontSize: '0.64rem', color: 'var(--text-dim)', display: 'block' }}>ចាប់ពី Start (s)</span>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={settings?.sponsorStartSec ?? 0}
                        onChange={(e) => onSettingChange('sponsorStartSec', Math.max(0, Number(e.target.value) || 0))}
                        className="inspector-select"
                        style={{ width: '100%', padding: '3px 5px', fontSize: '0.68rem' }}
                      />
                    </div>
                    <div>
                      <span style={{ fontSize: '0.64rem', color: 'var(--text-dim)', display: 'block' }}>ដល់ End (s)</span>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={settings?.sponsorEndSec ?? 15}
                        onChange={(e) => onSettingChange('sponsorEndSec', Math.max(1, Number(e.target.value) || 15))}
                        className="inspector-select"
                        style={{ width: '100%', padding: '3px 5px', fontSize: '0.68rem' }}
                      />
                    </div>
                  </div>
                )}

                {/* 5. Size (Scale) & Audio Mute */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, alignItems: 'center' }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                      <span style={{ fontSize: '0.68rem', color: 'var(--text-dim)' }}>ទំហំ (Scale)</span>
                      <span style={{ fontSize: '0.68rem', color: '#34D399', fontFamily: 'var(--font-mono)' }}>
                        {getSliderDisplay('sponsorScale', settings?.sponsorScale || 25)}%
                      </span>
                    </div>
                    <SmoothRangeSlider
                      min={15}
                      max={50}
                      step={2}
                      value={settings?.sponsorScale || 25}
                      previewKey="sponsorScale"
                      onDraftChange={(v) => setSliderDraft('sponsorScale', v)}
                      onCommit={(v) => onSettingChange('sponsorScale', v)}
                      data-testid="slider-sponsor-scale"
                      style={{ width: '100%', accentColor: '#10B981' }}
                    />
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', paddingTop: 10 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={settings?.sponsorMuteAudio !== false}
                        onChange={(e) => onSettingChange('sponsorMuteAudio', e.target.checked)}
                        style={{ accentColor: '#10B981' }}
                      />
                      <VolumeX size={13} color="#34D399" />
                      <span style={{ fontSize: '0.68rem', color: 'var(--text-primary)', fontWeight: 600 }}>
                        បិទសំឡេង Sponsor
                      </span>
                    </label>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Full-Screen Video Ads / Sponsor Insertion (CapCut-style, separate from Green Screen overlay) */}
          <div style={{ marginTop: 10, marginBottom: 12, borderTop: '1px solid var(--border-subtle)', paddingTop: 10 }} data-testid="export-video-ads-section">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: settings?.enableVideoAds ? 10 : 6 }}>
              <label className="checkbox-container" style={{ marginBottom: 0 }}>
                <input
                  type="checkbox"
                  data-testid="toggle-video-ads"
                  checked={Boolean(settings?.enableVideoAds)}
                  onChange={(e) => onSettingChange('enableVideoAds', e.target.checked)}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Clapperboard size={14} color="#FBBF24" />
                  <span style={{ fontSize: '0.8rem', color: '#FDE68A', fontWeight: 600 }}>
                    Video Ads / Sponsor (ពេញអេក្រង់)
                  </span>
                </div>
              </label>
              <span style={{
                fontSize: '0.64rem',
                padding: '2px 7px',
                borderRadius: 999,
                fontWeight: 700,
                background: settings?.enableVideoAds ? 'rgba(245, 158, 11, 0.22)' : 'rgba(255,255,255,0.06)',
                color: settings?.enableVideoAds ? '#FDE68A' : 'var(--text-dim)',
                border: settings?.enableVideoAds ? '1px solid rgba(251, 191, 36, 0.5)' : '1px solid rgba(255,255,255,0.1)',
              }}>
                {settings?.enableVideoAds ? 'ON' : 'OFF'}
              </span>
            </div>

            {settings?.enableVideoAds && (
              <div style={{
                background: 'var(--bg-secondary-panel)',
                border: '1px solid rgba(245, 158, 11, 0.3)',
                borderRadius: 'var(--radius-sm)',
                padding: '10px',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}>
                {/* Selected Ad Asset + Upload + Library */}
                <div style={{
                  border: '1px solid rgba(245, 158, 11, 0.35)',
                  background: 'rgba(245, 158, 11, 0.08)',
                  borderRadius: 8,
                  padding: '8px 10px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: '0.74rem', fontWeight: 700, color: '#FEF3C7', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {settings?.videoAdName || (settings?.videoAdUrl ? settings.videoAdUrl.split('/').pop() : 'មិនទាន់ជ្រើសរើស Video Ads')}
                      </div>
                      <div style={{ fontSize: '0.66rem', color: '#D1D5DB', marginTop: 1 }}>
                        {Number(settings?.videoAdDuration) > 0
                          ? `${Number(settings.videoAdDuration).toFixed(1)}s · ${settings?.videoAdHasAudio === false ? '🔇 គ្មានសំឡេង' : '🔊 មានសំឡេង'}`
                          : 'សូមបង្ហោះ ឬជ្រើសរើសវីដេអូពីបណ្ណាល័យ'}
                      </div>
                    </div>
                    <label style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      background: 'rgba(245, 158, 11, 0.22)',
                      border: '1px solid rgba(251, 191, 36, 0.45)',
                      color: '#FDE68A',
                      padding: '4px 8px',
                      borderRadius: 6,
                      fontSize: '0.68rem',
                      fontWeight: 700,
                      cursor: isUploadingVideoAd ? 'not-allowed' : 'pointer',
                      flexShrink: 0,
                    }}>
                      {isUploadingVideoAd ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
                      <span>{isUploadingVideoAd ? 'កំពុង...' : 'បង្ហោះ'}</span>
                      <input
                        type="file"
                        accept="video/mp4,video/quicktime,video/webm"
                        style={{ display: 'none' }}
                        disabled={isUploadingVideoAd}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          e.target.value = '';
                          if (f) handleVideoAdUpload(f);
                        }}
                      />
                    </label>
                  </div>

                  {videoAdLibrary.length > 0 && (
                    <select
                      aria-label="Sponsor video library"
                      value={settings?.videoAdUrl || ''}
                      onChange={(e) => {
                        const chosen = videoAdLibrary.find((v) => v.videoUrl === e.target.value);
                        if (chosen) {
                          onSettingChange({
                            enableVideoAds: true,
                            videoAdUrl: chosen.videoUrl,
                            videoAdPath: chosen.videoPath,
                            videoAdName: chosen.originalName || chosen.filename,
                            videoAdDuration: Number(chosen.durationSec) || 0,
                            videoAdHasAudio: Boolean(chosen.hasAudio),
                          });
                        }
                      }}
                      style={{
                        width: '100%',
                        padding: '4px 6px',
                        fontSize: '0.70rem',
                        borderRadius: 5,
                        background: 'var(--bg-desktop)',
                        border: '1px solid var(--border-subtle)',
                        color: 'var(--text-primary)',
                      }}
                    >
                      <option value="">-- ជ្រើសពី Sponsor Library ({videoAdLibrary.length}) --</option>
                      {videoAdLibrary.map((v) => (
                        <option key={v.filename} value={v.videoUrl}>
                          {(v.originalName || v.filename)} ({Number(v.durationSec || 0).toFixed(1)}s)
                        </option>
                      ))}
                    </select>
                  )}

                  {videoAdError && (
                    <span style={{ fontSize: '0.65rem', color: '#F87171' }}>{videoAdError}</span>
                  )}
                </div>

                {/* Ads Placement */}
                <div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', fontWeight: 600, marginBottom: 5 }}>
                    Ads Placement
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {[
                      { id: 'manual', label: 'Insert at Split / Playhead' },
                      { id: 'preroll', label: 'Before Episode (Pre-roll)' },
                      { id: 'postroll', label: 'After Episode (Post-roll)' },
                    ].map((opt) => (
                      <label key={opt.id} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: '0.72rem', color: 'var(--text-primary)', cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name="videoAdPlacement"
                          checked={(settings?.videoAdPlacement || 'manual') === opt.id}
                          onChange={() => onSettingChange('videoAdPlacement', opt.id)}
                          style={{ accentColor: '#F59E0B' }}
                        />
                        <span>{opt.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Ads Volume */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Ads Volume</span>
                    <span style={{ fontSize: '0.70rem', fontWeight: 700, color: '#FDE68A' }}>
                      {Math.round(Number(getSliderDisplay('videoAdVolume', settings?.videoAdVolume ?? 1.0)) * 100)}%
                    </span>
                  </div>
                  <SmoothRangeSlider
                    min={0}
                    max={1.5}
                    step={0.05}
                    value={Number.isFinite(Number(settings?.videoAdVolume)) ? Number(settings.videoAdVolume) : 1.0}
                    onDraftChange={(v) => setSliderDraft('videoAdVolume', v)}
                    onCommit={(v) => onSettingChange('videoAdVolume', v)}
                    data-testid="slider-video-ad-volume"
                    style={{ width: '100%', accentColor: '#F59E0B' }}
                  />
                </div>

                {/* Apply To */}
                <div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', fontWeight: 600, marginBottom: 5 }}>
                    Apply To
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {[
                      { id: 'current', label: 'Current Episode' },
                      { id: 'folder', label: 'All Episodes in Folder' },
                      { id: 'merged', label: 'Full Merged Video' },
                    ].map((opt) => (
                      <label key={opt.id} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: '0.72rem', color: 'var(--text-primary)', cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name="videoAdApplyTo"
                          checked={(settings?.videoAdApplyTo || 'current') === opt.id}
                          onChange={() => onSettingChange('videoAdApplyTo', opt.id)}
                          style={{ accentColor: '#F59E0B' }}
                        />
                        <span>{opt.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Action Button: Insert / Apply Ads Settings */}
                <button
                  type="button"
                  data-testid="btn-apply-video-ads"
                  disabled={!settings?.videoAdUrl || Number(settings?.videoAdDuration) <= 0.05}
                  onClick={async () => {
                    const placement = settings?.videoAdPlacement || 'manual';
                    const applyTo = settings?.videoAdApplyTo || 'current';
                    if (onInsertVideoAd && (applyTo === 'current' || placement === 'manual')) {
                      const res = await onInsertVideoAd({
                        videoUrl: settings.videoAdUrl,
                        videoPath: settings.videoAdPath,
                        name: settings.videoAdName || 'Sponsor Ad',
                        duration: Number(settings.videoAdDuration),
                        hasAudio: settings.videoAdHasAudio !== false,
                        adVolume: Number.isFinite(Number(settings.videoAdVolume)) ? Number(settings.videoAdVolume) : 1.0,
                      }, {
                        insertTime: currentTime,
                        placement,
                        dedupePlacement: placement !== 'manual',
                      });
                      setVideoAdAppliedMsg(res?.applied ? '✅ បានបញ្ចូល Ads លើ Timeline' : (res?.reason || 'Already applied'));
                      setTimeout(() => setVideoAdAppliedMsg(null), 2500);
                    } else if (applyTo === 'folder' && typeof onApplyVideoEditSettings === 'function') {
                      await onApplyVideoEditSettings();
                      setVideoAdAppliedMsg('✅ បានរក្សាទុក Ads Settings សម្រាប់ Folder ទាំងមូល');
                      setTimeout(() => setVideoAdAppliedMsg(null), 2500);
                    } else {
                      setVideoAdAppliedMsg('✅ បានរក្សាទុក Ads Settings');
                      setTimeout(() => setVideoAdAppliedMsg(null), 2500);
                    }
                  }}
                  style={{
                    width: '100%',
                    padding: '7px 10px',
                    borderRadius: 6,
                    fontSize: '0.73rem',
                    fontWeight: 700,
                    cursor: (!settings?.videoAdUrl || Number(settings?.videoAdDuration) <= 0.05) ? 'not-allowed' : 'pointer',
                    background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.25), rgba(217, 119, 6, 0.18))',
                    border: '1px solid rgba(251, 191, 36, 0.5)',
                    color: '#FEF3C7',
                  }}
                >
                  {videoAdAppliedMsg || ((settings?.videoAdPlacement || 'manual') === 'manual' ? '+ បញ្ចូល Video Ads ត្រង់ Playhead' : 'Apply Ads Settings')}
                </button>
              </div>
            )}
          </div>

          {/* Anti-Theft Running Marquee & Watermark Switch */}
          <div style={{ marginTop: 10, marginBottom: 12, borderTop: '1px solid var(--border-subtle)', paddingTop: 10 }}>
            <label className="checkbox-container" style={{ marginBottom: settings?.enableAntiTheft ? 10 : 6 }}>
              <input
                type="checkbox"
                checked={Boolean(settings?.enableAntiTheft)}
                onChange={(e) => onSettingChange('enableAntiTheft', e.target.checked)}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <ShieldCheck size={14} color="var(--primary-accent)" />
                <span style={{ fontSize: '0.8rem', color: 'var(--text-primary)', fontWeight: 600 }}>
                  អក្សររត់ការពារ Copy (Anti-Theft)
                </span>
              </div>
            </label>

            {settings?.enableAntiTheft && (
              <div style={{
                background: 'var(--bg-secondary-panel)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                padding: '10px',
                marginBottom: 12,
                display: 'flex',
                flexDirection: 'column',
                gap: 10
              }}>
                {/* 1. Watermark Name */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: '0.70rem', color: 'var(--text-dim)', fontWeight: 600 }}>
                      ឈ្មោះឆានែល (Watermark Text)
                    </span>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: '0.7rem', color: 'var(--text-dim)' }}>
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
                          background: 'var(--bg-workspace-base)',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: 5,
                          color: 'var(--text-primary)',
                        }}
                      />
                      <div>
                        <span style={{ fontSize: '0.68rem', color: 'var(--text-dim)', display: 'block', marginBottom: 2 }}>
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
                        <span style={{ fontSize: '0.68rem', color: 'var(--text-dim)', display: 'block', marginBottom: 2 }}>
                          ពណ៌ Watermark
                        </span>
                        <select
                          value={settings?.watermarkColor || '#38BDF8'}
                          onChange={(e) => onSettingChange('watermarkColor', e.target.value)}
                          className="inspector-select"
                          style={{ width: '100%', padding: '4px 6px', fontSize: '0.72rem' }}
                        >
                          <option value="#38BDF8">ផ្ទៃមេឃ (Cyan)</option>
                          <option value="#FFE600">លឿងមាស (Gold)</option>
                          <option value="#FFFFFF">ពណ៌ស (White)</option>
                        </select>
                      </div>
                    </div>
                  )}
                </div>

                {/* 2. Marquee Ticker Text */}
                <div>
                  <span style={{ fontSize: '0.70rem', color: 'var(--text-dim)', display: 'block', marginBottom: 4, fontWeight: 600 }}>
                    អត្ថបទរត់ (Running Ticker)
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
                      background: 'var(--bg-workspace-base)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 5,
                      color: 'var(--text-primary)',
                      resize: 'vertical',
                      fontFamily: 'inherit',
                    }}
                  />

                  {/* 3 One-click Khmer Preset Chips */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}>
                    <button
                      type="button"
                      onClick={() => onSettingChange('marqueeText', '«ហាមផុសបន្ត • សូមឱ្យតម្លៃលើការខិតខំរបស់ម្ចាស់ដើម»')}
                      className="preset-tag-btn"
                      style={{
                        fontSize: '0.66rem',
                        padding: '3px 7px',
                        borderRadius: 4,
                        background: 'var(--bg-elevated-panel)',
                        border: '1px solid var(--border-subtle)',
                        color: 'var(--text-secondary)',
                        cursor: 'pointer',
                      }}
                    >
                      ហាមផុសបន្ត
                    </button>
                    <button
                      type="button"
                      onClick={() => onSettingChange('marqueeText', '«រក្សាសិទ្ធិគ្រប់យ៉ាង • ហាមយកទៅផុសបន្តគ្រប់ទម្រង់»')}
                      className="preset-tag-btn"
                      style={{
                        fontSize: '0.66rem',
                        padding: '3px 7px',
                        borderRadius: 4,
                        background: 'var(--bg-elevated-panel)',
                        border: '1px solid var(--border-subtle)',
                        color: 'var(--text-secondary)',
                        cursor: 'pointer',
                      }}
                    >
                      រក្សាសិទ្ធិគ្រប់យ៉ាង
                    </button>
                    <button
                      type="button"
                      onClick={() => onSettingChange('marqueeText', '«សូមចុច Like & Follow ដើម្បីទស្សនាភាគបន្ត»')}
                      className="preset-tag-btn"
                      style={{
                        fontSize: '0.66rem',
                        padding: '3px 7px',
                        borderRadius: 4,
                        background: 'var(--bg-elevated-panel)',
                        border: '1px solid var(--border-subtle)',
                        color: 'var(--text-secondary)',
                        cursor: 'pointer',
                      }}
                    >
                      Like &amp; Follow
                    </button>
                  </div>
                </div>

                {/* 3. Speed, Position & Text Color */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                      <span style={{ fontSize: '0.68rem', color: 'var(--text-dim)' }}>
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
                          color: 'var(--primary-accent)',
                          fontFamily: 'var(--font-mono)',
                        }}
                        title="វាយបញ្ចូលចំនួនវិនាទី (វិនាទីកាន់តែច្រើន រត់កាន់តែយឺត)"
                      />
                      <span
                        style={{
                          position: 'absolute',
                          right: 6,
                          fontSize: '0.66rem',
                          color: 'var(--text-dim)',
                          pointerEvents: 'none',
                          fontWeight: 600,
                        }}
                      >
                        s
                      </span>
                    </div>

                    {/* Quick 1-click Preset Buttons (20s, 13s, 9s) */}
                    <div style={{ display: 'flex', gap: 3, marginTop: 4 }}>
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
                              fontSize: '0.62rem',
                              padding: '3px 0',
                              borderRadius: 4,
                              background: isSelected ? 'rgba(56, 189, 248, 0.16)' : 'var(--bg-elevated-panel)',
                              border: isSelected ? '1px solid var(--primary-accent)' : '1px solid var(--border-subtle)',
                              color: isSelected ? 'var(--primary-accent)' : 'var(--text-dim)',
                              cursor: 'pointer',
                              fontWeight: isSelected ? 700 : 500,
                              fontFamily: 'var(--font-mono)',
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
                    <span style={{ fontSize: '0.68rem', color: 'var(--text-dim)', display: 'block', marginBottom: 2 }}>
                      ទំហំរបារ (Size)
                    </span>
                    <select
                      value={settings?.antiTheftSize || 'small'}
                      onChange={(e) => {
                        const nextSize = e.target.value;
                        const sizeToPx = { small: 22, medium: 28, large: 36, xlarge: 48, xxlarge: 64 };
                        onSettingChange({
                          antiTheftSize: nextSize,
                          antiTheftHeight: sizeToPx[nextSize] || 28,
                        });
                      }}
                      className="inspector-select"
                      style={{ width: '100%', padding: '4px 6px', fontSize: '0.72rem' }}
                    >
                      <option value="small">តូចស្អាត (Small · 22px)</option>
                      <option value="medium">មធ្យម (Medium · 28px)</option>
                      <option value="large">ធំ (Large · 36px)</option>
                      <option value="xlarge">ធំខ្លាំង (XL · 48px)</option>
                      <option value="xxlarge">ធំបំផុត (XXL · 64px)</option>
                    </select>
                  </div>

                  {/* Custom Ribbon Height / Thickness Slider (1:1 synced with Live Preview & FFmpeg Export) */}
                  <div style={{ gridColumn: 'span 2' }}>
                    {(() => {
                      const presetPxMap = { small: 22, medium: 28, large: 36, xlarge: 48, xxlarge: 64 };
                      const fallbackHeight = presetPxMap[settings?.antiTheftSize || 'small'] || 22;
                      const committedHeight =
                        settings?.antiTheftHeight !== null && settings?.antiTheftHeight !== undefined && Number(settings?.antiTheftHeight) > 0
                          ? Number(settings.antiTheftHeight)
                          : fallbackHeight;
                      return (
                        <>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                            <span style={{ fontSize: '0.68rem', color: 'var(--text-dim)' }}>កម្រាស់ / កម្ពស់របារ (Height)</span>
                            <span style={{ fontSize: '0.68rem', color: 'var(--primary-accent)', fontFamily: 'var(--font-mono)' }}>
                              {getSliderDisplay('antiTheftHeight', committedHeight)}px
                            </span>
                          </div>
                          <SmoothRangeSlider
                            min={18}
                            max={120}
                            step={2}
                            value={committedHeight}
                            previewKey="antiTheftHeight"
                            onDraftChange={(v) => setSliderDraft('antiTheftHeight', v)}
                            onCommit={(v) => onSettingChange('antiTheftHeight', v)}
                            data-testid="slider-antitheft-height"
                            style={{ width: '100%', accentColor: '#38bdf8' }}
                          />
                        </>
                      );
                    })()}
                  </div>

                  {/* Vertical Position / Bottom Offset Slider */}
                  {(settings?.marqueePosition || 'bottom') === 'bottom' && (
                    <div style={{ gridColumn: 'span 2' }}>
                      {(() => {
                        const committedBottom =
                          settings?.antiTheftBottomPercent !== null && settings?.antiTheftBottomPercent !== undefined && Number.isFinite(Number(settings?.antiTheftBottomPercent))
                            ? Number(settings.antiTheftBottomPercent)
                            : 2;
                        return (
                          <>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                              <span style={{ fontSize: '0.68rem', color: 'var(--text-dim)' }}>ទីតាំងបញ្ឈរ / គម្លាតពីបាតក្រោម (Bottom Offset)</span>
                              <span style={{ fontSize: '0.68rem', color: 'var(--primary-accent)', fontFamily: 'var(--font-mono)' }}>
                                {getSliderDisplay('antiTheftBottomPercent', committedBottom)}%
                              </span>
                            </div>
                            <SmoothRangeSlider
                              min={0}
                              max={35}
                              step={0.5}
                              value={committedBottom}
                              previewKey="antiTheftBottomPercent"
                              onDraftChange={(v) => setSliderDraft('antiTheftBottomPercent', v)}
                              onCommit={(v) => onSettingChange('antiTheftBottomPercent', v)}
                              data-testid="slider-antitheft-bottom"
                              style={{ width: '100%', accentColor: '#38bdf8' }}
                            />
                          </>
                        );
                      })()}
                    </div>
                  )}

                  <div>
                    <span style={{ fontSize: '0.68rem', color: 'var(--text-dim)', display: 'block', marginBottom: 2 }}>
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
                    <span style={{ fontSize: '0.68rem', color: 'var(--text-dim)', display: 'block', marginBottom: 2 }}>
                      ពណ៌អក្សរ (Color)
                    </span>
                    <select
                      value={settings?.marqueeTextColor || '#FFE600'}
                      onChange={(e) => onSettingChange('marqueeTextColor', e.target.value)}
                      className="inspector-select"
                      style={{ width: '100%', padding: '4px 6px', fontSize: '0.72rem' }}
                    >
                      <option value="#FFE600">លឿងមាស (Gold)</option>
                      <option value="#FFFFFF">ពណ៌ស (White)</option>
                      <option value="#38BDF8">ផ្ទៃមេឃ (Cyan)</option>
                      <option value="#4ADE80">បៃតងខ្ចី (Green)</option>
                    </select>
                  </div>

                  {/* 4. Background Style (Dark / Real Blur / Solid Black) */}
                  <div style={{ gridColumn: 'span 2' }}>
                    <span style={{ fontSize: '0.68rem', color: 'var(--text-dim)', display: 'block', marginBottom: 2 }}>
                      ម៉ូដផ្ទៃរបាររត់ (Background Style)
                    </span>
                    <select
                      data-testid="select-antitheft-bg-style"
                      value={settings?.antiTheftBgStyle || 'dark'}
                      onChange={(e) => onSettingChange('antiTheftBgStyle', e.target.value)}
                      className="inspector-select"
                      style={{ width: '100%', padding: '4px 6px', fontSize: '0.72rem' }}
                    >
                      <option value="dark">របារខ្មៅថ្លា (Dark Semi)</option>
                      <option value="blur">ព្រិលពិត (Real Blur បាំងអក្សរចិន)</option>
                      <option value="solid">ខ្មៅសុទ្ធ (Solid Black)</option>
                    </select>
                  </div>
                </div>

                {/* 5. Blur Strength slider (shown when Real Blur style is active) */}
                {(settings?.antiTheftBgStyle || 'dark') === 'blur' && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                      <span style={{ fontSize: '0.68rem', color: 'var(--text-dim)' }}>កម្រិតព្រិល (Blur Strength)</span>
                      <span style={{ fontSize: '0.68rem', color: 'var(--primary-accent)', fontFamily: 'var(--font-mono)' }}>
                        {getSliderDisplay('antiTheftBlur', Number.isFinite(Number(settings?.antiTheftBlur)) ? Number(settings.antiTheftBlur) : 18)}px
                      </span>
                    </div>
                    <SmoothRangeSlider
                      min={6}
                      max={36}
                      step={2}
                      value={Number.isFinite(Number(settings?.antiTheftBlur)) ? Number(settings.antiTheftBlur) : 18}
                      previewKey="antiTheftBlur"
                      onDraftChange={(v) => setSliderDraft('antiTheftBlur', v)}
                      onCommit={(v) => onSettingChange('antiTheftBlur', v)}
                      data-testid="slider-antitheft-blur"
                      style={{ width: '100%', accentColor: '#38bdf8' }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* YouTube Safe Edit (Mirror Flip, Zoom Crop, Color Grade, Mute Original Drama OST) */}
          <div
            style={{
              marginTop: 10,
              marginBottom: 12,
              borderTop: '1px solid var(--border-subtle)',
              paddingTop: 10,
            }}
          >
            <button
              type="button"
              data-testid="toggle-yt-safe-card"
              onClick={() => setIsYoutubeSafeOpen((prev) => !prev)}
              title="សុវត្ថិភាព YouTube — Mirror Flip, Zoom, Color Grade & បិទភ្លេងចិនដើម"
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                padding: '7px 9px',
                borderRadius: 6,
                background: ytActiveCount > 0 ? 'rgba(16, 185, 129, 0.12)' : 'var(--bg-secondary-panel)',
                border: `1px solid ${ytActiveCount > 0 ? 'rgba(16, 185, 129, 0.35)' : 'var(--border-subtle)'}`,
                color: ytActiveCount > 0 ? '#6EE7B7' : 'var(--text-primary)',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <ShieldCheck size={14} color={ytActiveCount > 0 ? '#34d399' : '#fbbf24'} style={{ flexShrink: 0 }} />
                <span style={{ fontSize: '0.78rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  YouTube Safe Edit
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                {ytActiveCount > 0 && (
                  <span
                    style={{
                      fontSize: '0.64rem',
                      fontWeight: 700,
                      padding: '1px 6px',
                      borderRadius: 4,
                      background: 'rgba(16, 185, 129, 0.2)',
                      color: '#6ee7b7',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    {ytActiveCount} ON
                  </span>
                )}
                {isYoutubeSafeOpen ? <ChevronUp size={14} color="var(--text-dim)" /> : <ChevronDown size={14} color="var(--text-dim)" />}
              </div>
            </button>

            {isYoutubeSafeOpen && (
              <div
                style={{
                  marginTop: 8,
                  background: 'var(--bg-secondary-panel)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '10px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                {/* 1-Click Preset Button */}
                <button
                  type="button"
                  data-testid="btn-youtube-safe-preset"
                  onClick={() => {
                    if (isYoutubePresetActive) {
                      // OFF: reset only the preset-controlled keys; keep user's Mirror & custom Zoom
                      onSettingChange({
                        zoomScale: 1.0,
                        enableColorGrade: false,
                        youtubeSafeAudio: false,
                      });
                    } else {
                      // ON: only set preset keys; never override manually set Mirror
                      onSettingChange({
                        zoomScale: ytZoomVal >= 1.055 ? ytZoomVal : 1.06,
                        enableColorGrade: true,
                        youtubeSafeAudio: true,
                      });
                    }
                  }}
                  style={{
                    width: '100%',
                    padding: '7px 10px',
                    borderRadius: 6,
                    fontSize: '0.74rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    border: isYoutubePresetActive
                      ? '1px solid rgba(16, 185, 129, 0.5)'
                      : '1px solid rgba(251, 191, 36, 0.4)',
                    background: isYoutubePresetActive
                      ? 'rgba(16, 185, 129, 0.14)'
                      : 'rgba(245, 158, 11, 0.12)',
                    color: isYoutubePresetActive ? '#6ee7b7' : '#fde68a',
                  }}
                >
                  {isYoutubePresetActive
                    ? 'YouTube Safe Preset: ON (ចុចដើម្បីបិទ)'
                    : 'បើក YouTube Safe Preset (1-Click)'}
                </button>

                {/* 1. Mirror Flip */}
                <label className="checkbox-container" style={{ margin: 0, alignItems: 'flex-start' }}>
                  <input
                    type="checkbox"
                    data-testid="toggle-yt-mirror"
                    checked={ytMirrorOn}
                    onChange={(e) => onSettingChange('enableMirrorFlip', e.target.checked)}
                    style={{ accentColor: '#10b981', marginTop: 2 }}
                  />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <span style={{ fontSize: '0.74rem', color: 'var(--text-primary)', fontWeight: 600 }}>
                      ត្រឡប់រូបឆ្វេង-ស្តាំ (Mirror Flip)
                    </span>
                    <span style={{ fontSize: '0.64rem', color: 'var(--text-dim)' }}>
                      ត្រឡប់តែវីដេអូដើម (Subtitle និង Logo រក្សាទិសដៅធម្មតា)
                    </span>
                  </div>
                </label>

                {/* 2. Zoom Edge Crop (100% - 115%) */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontSize: '0.73rem', color: 'var(--text-primary)', fontWeight: 600 }}>
                      Zoom កាត់គែម (100%–115%)
                    </span>
                    <span style={{ fontSize: '0.72rem', color: ytZoomDisplay > 1.005 ? '#34d399' : 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                      {Math.round(ytZoomDisplay * 100)}%
                    </span>
                  </div>
                  <SmoothRangeSlider
                    min={1.0}
                    max={1.15}
                    step={0.01}
                    value={ytZoomVal}
                    previewKey="zoomScale"
                    onDraftChange={(v) => setSliderDraft('zoomScale', v)}
                    onCommit={(v) => onSettingChange('zoomScale', Number(v.toFixed(2)))}
                    data-testid="slider-yt-zoom"
                    style={{ width: '100%', accentColor: '#10b981' }}
                  />
                </div>

                {/* 3. Color Grade */}
                <label className="checkbox-container" style={{ margin: 0, alignItems: 'flex-start' }}>
                  <input
                    type="checkbox"
                    data-testid="toggle-yt-color-grade"
                    checked={ytColorOn}
                    onChange={(e) => onSettingChange('enableColorGrade', e.target.checked)}
                    style={{ accentColor: '#10b981', marginTop: 2 }}
                  />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <span style={{ fontSize: '0.74rem', color: 'var(--text-primary)', fontWeight: 600 }}>
                      កែពណ៌វីដេអូ (Color Grade)
                    </span>
                    <span style={{ fontSize: '0.64rem', color: 'var(--text-dim)' }}>
                      Contrast +5%, Brightness +1.5%, Saturation +8%
                    </span>
                  </div>
                </label>

                {/* 4. Mute Original Drama OST Completely */}
                <label className="checkbox-container" style={{ margin: 0, alignItems: 'flex-start' }}>
                  <input
                    type="checkbox"
                    data-testid="toggle-yt-safe-audio"
                    checked={ytSafeAudioOn}
                    onChange={(e) => onSettingChange('youtubeSafeAudio', e.target.checked)}
                    style={{ accentColor: '#10b981', marginTop: 2 }}
                  />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <span style={{ fontSize: '0.74rem', color: 'var(--text-primary)', fontWeight: 600 }}>
                      បិទភ្លេងចិនដើមទាំងស្រុង (Mute Original OST)
                    </span>
                    <span style={{ fontSize: '0.64rem', color: ytSafeAudioOn ? '#6ee7b7' : 'var(--text-dim)' }}>
                      {ytSafeAudioOn
                        ? 'បិទសំឡេង & ភ្លេងដើម 100% ទុកតែសំឡេងខ្មែរ AI'
                        : 'ការពារ Music Content ID ដោយបិទភ្លេងដើមចោលទាំងស្រុង'}
                    </span>
                  </div>
                </label>
              </div>
            )}
          </div>

          {/* Apply Settings To — 3-scope radio + Copy Settings */}
          {(onApplyVideoEditSettings || onChangeVideoEditScope) && (
            <div
              style={{
                marginTop: 10,
                marginBottom: 2,
                borderTop: '1px solid var(--border-subtle)',
                paddingTop: 10,
              }}
            >
              <div style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 7 }}>
                Apply Settings To
              </div>
              {/* scope: episode */}
              {[
                { value: 'episode', label: 'Current Episode Only' },
                {
                  value: 'folder',
                  label: (() => {
                    const name = activeSeries?.folderName || activeSeries?.title || 'Current Folder';
                    const count = Array.isArray(activeSeries?.episodes) ? activeSeries.episodes.length : 0;
                    return `All Episodes in ${name}${count > 0 ? ` (${count})` : ''}`;
                  })(),
                },
                { value: 'global', label: 'All Project Folders' },
              ].map(({ value, label }) => (
                <label
                  key={value}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 7,
                    marginBottom: 5,
                    cursor: 'pointer',
                    fontSize: '0.73rem',
                    color: videoEditScope === value ? 'var(--text-primary)' : 'var(--text-secondary)',
                    fontWeight: videoEditScope === value ? 600 : 400,
                  }}
                >
                  <input
                    type="radio"
                    name="video-edit-scope"
                    value={value}
                    checked={videoEditScope === value}
                    onChange={() => onChangeVideoEditScope?.(value)}
                    style={{ accentColor: '#10b981', margin: 0 }}
                  />
                  {label}
                  {value === 'folder' && (
                    <span style={{ fontSize: '0.60rem', padding: '1px 5px', borderRadius: 3, background: 'rgba(16,185,129,0.15)', color: '#6ee7b7', fontWeight: 700 }}>
                      Default
                    </span>
                  )}
                </label>
              ))}
              <button
                type="button"
                disabled={applyStatus === 'applying'}
                onClick={async () => {
                  if (!onApplyVideoEditSettings) return;
                  setApplyStatus('applying');
                  try {
                    await onApplyVideoEditSettings(videoEditScope);
                    setApplyStatus('done');
                    setTimeout(() => setApplyStatus(null), 2000);
                  } catch (_) {
                    setApplyStatus(null);
                  }
                }}
                style={{
                  marginTop: 6,
                  width: '100%',
                  padding: '7px 10px',
                  borderRadius: 6,
                  fontSize: '0.73rem',
                  fontWeight: 600,
                  cursor: applyStatus === 'applying' ? 'not-allowed' : 'pointer',
                  border: applyStatus === 'done'
                    ? '1px solid rgba(16, 185, 129, 0.5)'
                    : '1px solid rgba(16, 185, 129, 0.35)',
                  background: applyStatus === 'done'
                    ? 'rgba(16, 185, 129, 0.18)'
                    : 'rgba(16, 185, 129, 0.10)',
                  color: '#6ee7b7',
                  opacity: applyStatus === 'applying' ? 0.6 : 1,
                }}
              >
                {applyStatus === 'applying'
                  ? '⏳ កំពុង Apply...'
                  : applyStatus === 'done'
                    ? '✓ Applied រួចរាល់!'
                    : '📋 Copy Settings'}
              </button>
            </div>
          )}

          {/* Dynamic 0% - 100% Export Progress Monitor Card */}
          {(isRendering || displayProgress > 0) && (
            <div
              style={{
                background: 'var(--bg-secondary-panel)',
                border: `1px solid ${displayProgress >= 100 ? 'rgba(16, 185, 129, 0.4)' : 'rgba(56, 189, 248, 0.35)'}`,
                borderRadius: 'var(--radius-sm)',
                padding: '12px',
                marginBottom: 0,
              }}
            >
              {/* Header: Title and Large Monospace Percentage */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  {displayProgress >= 100 ? (
                    <div style={{
                      width: 22,
                      height: 22,
                      borderRadius: '50%',
                      background: 'rgba(16, 185, 129, 0.16)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#10b981',
                      flexShrink: 0,
                    }}>
                      <CheckCircle2 size={14} />
                    </div>
                  ) : (
                    <div style={{
                      width: 22,
                      height: 22,
                      borderRadius: '50%',
                      background: 'rgba(56, 189, 248, 0.16)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#38bdf8',
                      flexShrink: 0,
                    }}>
                      <Loader2 size={14} className="animate-spin" />
                    </div>
                  )}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {displayProgress >= 100 ? 'Export វីដេអូជោគជ័យ 100%' : 'កំពុង Export វីដេអូ...'}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: displayProgress >= 100 ? '#34d399' : 'var(--text-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {currentStageText}
                    </div>
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 8 }}>
                  <span style={{
                    fontSize: '1.2rem',
                    fontWeight: 700,
                    fontFamily: 'var(--font-mono)',
                    color: displayProgress >= 100 ? '#10b981' : '#38bdf8',
                    letterSpacing: '-0.02em',
                  }}>
                    {displayProgress}%
                  </span>
                </div>
              </div>

              {/* Clean Flat Progress Bar Track */}
              <div style={{
                width: '100%',
                height: 6,
                background: 'var(--bg-elevated-panel)',
                borderRadius: 9999,
                overflow: 'hidden',
                position: 'relative',
                marginBottom: 8,
              }}>
                <div
                  style={{
                    height: '100%',
                    width: `${displayProgress}%`,
                    background: displayProgress >= 100 ? '#10b981' : '#38bdf8',
                    borderRadius: 9999,
                    transition: 'width 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
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
                  background: displayProgress >= 1 ? 'rgba(56, 189, 248, 0.14)' : 'var(--bg-elevated-panel)',
                  color: displayProgress >= 1 ? '#38bdf8' : 'var(--text-dim)',
                  fontWeight: displayProgress >= 1 && displayProgress < 25 ? 700 : 500,
                  border: displayProgress >= 1 && displayProgress < 25 ? '1px solid rgba(56, 189, 248, 0.35)' : '1px solid transparent',
                }}>
                  1. Sub
                </div>
                <div style={{
                  padding: '3px 4px',
                  borderRadius: 4,
                  fontSize: '0.62rem',
                  textAlign: 'center',
                  background: displayProgress >= 25 ? 'rgba(56, 189, 248, 0.14)' : 'var(--bg-elevated-panel)',
                  color: displayProgress >= 25 ? '#38bdf8' : 'var(--text-dim)',
                  fontWeight: displayProgress >= 25 && displayProgress < 55 ? 700 : 500,
                  border: displayProgress >= 25 && displayProgress < 55 ? '1px solid rgba(56, 189, 248, 0.35)' : '1px solid transparent',
                }}>
                  2. Mix
                </div>
                <div style={{
                  padding: '3px 4px',
                  borderRadius: 4,
                  fontSize: '0.62rem',
                  textAlign: 'center',
                  background: displayProgress >= 55 ? 'rgba(56, 189, 248, 0.14)' : 'var(--bg-elevated-panel)',
                  color: displayProgress >= 55 ? '#38bdf8' : 'var(--text-dim)',
                  fontWeight: displayProgress >= 55 && displayProgress < 85 ? 700 : 500,
                  border: displayProgress >= 55 && displayProgress < 85 ? '1px solid rgba(56, 189, 248, 0.35)' : '1px solid transparent',
                }}>
                  3. Render
                </div>
                <div style={{
                  padding: '3px 4px',
                  borderRadius: 4,
                  fontSize: '0.62rem',
                  textAlign: 'center',
                  background: displayProgress >= 85 ? 'rgba(16, 185, 129, 0.14)' : 'var(--bg-elevated-panel)',
                  color: displayProgress >= 85 ? '#10b981' : 'var(--text-dim)',
                  fontWeight: displayProgress >= 85 ? 700 : 500,
                  border: displayProgress >= 85 ? '1px solid rgba(16, 185, 129, 0.35)' : '1px solid transparent',
                }}>
                  4. Ready
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default React.memo(ExportSettingsPanel);
