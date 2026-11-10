import React, { useState, useEffect } from 'react';
import {
  Clapperboard, Subtitles, Loader2, ChevronUp, ChevronDown,
  CheckCircle2, ShieldCheck, Image, Upload
} from 'lucide-react';
import { resolveDefaultAspectRatio, sanitizeAspectRatio } from '../../utils/projectStorage';

export default function ExportSettingsPanel({
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
}) {
  const [internalProgress, setInternalProgress] = useState(0);
  const [internalStage, setInternalStage] = useState('');

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
              {effectiveAspectRatio === '1:1' && (
                <option value="1:1">1:1 (Square)</option>
              )}
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
                Burn Subtitles to Video (អក្សររត់ CapCut Style)
              </span>
            </div>
          </label>

          {/* Subtitle Style Controls (Style, Color & Size) */}
          {settings?.burnSubtitles !== false && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12, paddingLeft: 6 }}>
              <div style={{ gridColumn: 'span 2' }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>
                  ម៉ូដ Subtitle (Caption Style for TikTok/Reels/FB)
                </span>
                <select
                  data-testid="export-subtitle-style-select"
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
                  data-testid="export-subtitle-color-select"
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
                marginBottom: 0,
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
        </>
      )}
    </div>
  );
}
