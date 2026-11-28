import React, { useState } from 'react';
import {
  Image as ImageIcon,
  Shield, Eye, EyeOff, Sliders, ChevronDown, ShieldCheck
} from 'lucide-react';
import './VideoTransformControls.css';
import SmoothRangeSlider from '../common/SmoothRangeSlider';

/**
 * Modern floating glassmorphism toolbar for customizing
 * watermark logo positioning/size, corner disclaimer blocker mask,
 * and bottom anti-theft banner.
 * (Video panning/moving is strictly locked to prevent unwanted video shifting)
 */
export default function VideoTransformControls({
  voiceSettings = {},
  onUpdateVoiceSettings,
  aspectRatio = '16:9',
  inline = false,
}) {
  const [activeMenu, setActiveMenu] = useState(null); // 'logo' | 'mask' | 'ribbon' | null
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [draftSliders, setDraftSliders] = useState({});
  const hostRef = React.useRef(null);

  React.useEffect(() => {
    if (!activeMenu) return undefined;
    const handleOutsideClick = (e) => {
      if (hostRef.current && !hostRef.current.contains(e.target)) {
        setActiveMenu(null);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [activeMenu]);

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
  const getDisplay = (key, committed) =>
    Object.prototype.hasOwnProperty.call(draftSliders, key) ? draftSliders[key] : committed;

  const currentLogoPos = voiceSettings?.logoPosition || 'top-right';
  const currentLogoSize = voiceSettings?.logoSize || 72;
  const isLogoEnabled = Boolean(voiceSettings?.enableLogo);
  const isRibbonEnabled = voiceSettings?.enableAntiTheft !== false;
  const currentRibbonPos = voiceSettings?.marqueePosition || 'bottom';
  const currentRibbonBgStyle = voiceSettings?.antiTheftBgStyle || 'dark';
  const currentRibbonBlur = Number.isFinite(Number(voiceSettings?.antiTheftBlur)) ? Number(voiceSettings.antiTheftBlur) : 18;

  const isMaskEnabled = Boolean(voiceSettings?.enableCornerMask);
  const currentMaskPos = voiceSettings?.cornerMaskPosition || 'top-right';
  const currentMaskStyle = voiceSettings?.cornerMaskStyle || 'badge';
  const currentMaskBlur = Number.isFinite(Number(voiceSettings?.cornerMaskBlur)) ? Number(voiceSettings.cornerMaskBlur) : 18;
  const currentMaskWidth = voiceSettings?.cornerMaskWidth || 220;
  const currentMaskHeight = voiceSettings?.cornerMaskHeight || 54;
  const currentMaskText = voiceSettings?.cornerMaskText ?? '«រឿងប្រឌិតសុទ្ធសាធ • ហាមចម្លង»';

  const showTools = inline || !isCollapsed;

  return (
    <div
      ref={hostRef}
      className={`video-transform-toolbar ${inline ? 'is-inline' : ''} ${!inline && isCollapsed ? 'collapsed' : ''}`}
      onClick={(e) => e.stopPropagation()}
      data-testid="video-transform-toolbar"
    >
      {/* 1. Toggle Collapse Button (floating mode only) */}
      {!inline && (
        <>
          <button
            type="button"
            className="transform-btn collapse-toggle-btn"
            onClick={() => setIsCollapsed(!isCollapsed)}
            title={isCollapsed ? 'បង្ហាញ Tool កែ Logo, Mask & Banner' : 'បង្រួម Tool'}
          >
            <Sliders size={13} />
            {!isCollapsed && <span className="toolbar-label">Customize</span>}
          </button>
          {showTools && <div className="toolbar-divider" />}
        </>
      )}

      {showTools && (
        <>
          {/* 2. Logo Watermark Quick Popover */}
          <div className="toolbar-dropdown-host">
            <button
              type="button"
              className={`transform-btn dropdown-btn ${isLogoEnabled ? 'active-highlight' : ''}`}
              onClick={() => setActiveMenu(activeMenu === 'logo' ? null : 'logo')}
              title="សារ៉េ Logo ឆានែល"
            >
              <ImageIcon size={13} color={isLogoEnabled ? '#EAB308' : 'currentColor'} />
              <span>Logo</span>
              <ChevronDown size={11} />
            </button>

            {activeMenu === 'logo' && (
              <div className="transform-menu-popup">
                <div className="popup-header">
                  <span>Logo ឆានែល</span>
                  <label className="toggle-switch-compact">
                    <input
                      type="checkbox"
                      checked={isLogoEnabled}
                      onChange={(e) => onUpdateVoiceSettings?.({ ...voiceSettings, enableLogo: e.target.checked })}
                    />
                    <span className="slider-round" />
                  </label>
                </div>

                <div className="popup-section">
                  <span className="popup-section-title">ទីតាំង (Position)</span>
                  <div className="position-grid">
                    {[
                      { id: 'top-left', label: 'ឆ្វេងលើ' },
                      { id: 'top-right', label: 'ស្តាំលើ' },
                      { id: 'center', label: 'កណ្តាល' },
                      { id: 'bottom-left', label: 'ឆ្វេងក្រោម' },
                      { id: 'bottom-right', label: 'ស្តាំក្រោម' },
                      { id: 'both', label: 'សងខាងលើ' },
                    ].map((pos) => (
                      <button
                        key={pos.id}
                        type="button"
                        className={`pos-chip ${currentLogoPos === pos.id ? 'active' : ''}`}
                        onClick={() => onUpdateVoiceSettings?.({
                          ...voiceSettings,
                          logoPosition: pos.id,
                          logoXPercent: pos.id === 'center' ? 50 : undefined,
                          logoYPercent: pos.id === 'center' ? 50 : undefined,
                          enableLogo: true,
                        })}
                      >
                        {pos.label}
                      </button>
                    ))}
                  </div>

                  {currentLogoPos === 'custom' && (
                    <div style={{ marginTop: 6, padding: '4px 8px', borderRadius: 'var(--radius-xs)', background: 'rgba(56, 189, 248, 0.1)', border: '1px solid rgba(56, 189, 248, 0.3)', fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--primary-accent)' }}>
                      Custom: X {Math.round(voiceSettings?.logoXPercent ?? 50)}% · Y {Math.round(voiceSettings?.logoYPercent ?? 50)}%
                    </div>
                  )}
                </div>

                <div className="popup-section">
                  <div className="slider-row-header">
                    <span>ទំហំ Logo</span>
                    <span className="value-label">{getDisplay('logoSize', currentLogoSize)}px</span>
                  </div>
                  <SmoothRangeSlider
                    min={36}
                    max={160}
                    step={4}
                    value={currentLogoSize}
                    previewKey="logoSize"
                    onDraftChange={(v) => setSliderDraft('logoSize', v)}
                    onCommit={(v) => onUpdateVoiceSettings?.({ ...voiceSettings, logoSize: v })}
                    className="compact-range"
                  />
                </div>
              </div>
            )}
          </div>

          {/* 3. Corner Blocker / Mask Quick Popover */}
          <div className="toolbar-dropdown-host">
            <button
              type="button"
              className={`transform-btn dropdown-btn ${isMaskEnabled ? 'active-highlight' : ''}`}
              onClick={() => setActiveMenu(activeMenu === 'mask' ? null : 'mask')}
              title="សារ៉េប្រអប់បាំងជ្រុងលើ (Corner Mask)"
            >
              <ShieldCheck size={13} color={isMaskEnabled ? '#38BDF8' : 'currentColor'} />
              <span>Mask</span>
              <ChevronDown size={11} />
            </button>

            {activeMenu === 'mask' && (
              <div className="transform-menu-popup" style={{ width: 264 }}>
                <div className="popup-header">
                  <span>បាំងជ្រុងលើ (Mask)</span>
                  <label className="toggle-switch-compact">
                    <input
                      type="checkbox"
                      checked={isMaskEnabled}
                      onChange={(e) => onUpdateVoiceSettings?.({ ...voiceSettings, enableCornerMask: e.target.checked })}
                    />
                    <span className="slider-round" />
                  </label>
                </div>

                <div className="popup-section">
                  <span className="popup-section-title">អក្សរបិទបាំង</span>
                  <input
                    type="text"
                    value={currentMaskText}
                    onChange={(e) => onUpdateVoiceSettings?.({ ...voiceSettings, cornerMaskText: e.target.value, enableCornerMask: true })}
                    placeholder="អក្សរបិទបាំង..."
                    className="capcut-input"
                    style={{ padding: '4px 8px', fontSize: '12px' }}
                  />
                </div>

                <div className="popup-section">
                  <span className="popup-section-title">ទីតាំង (អូសលើវីដេអូបាន)</span>
                  <div className="position-grid two-col">
                    <button
                      type="button"
                      className={`pos-chip ${currentMaskPos === 'top-left' ? 'active' : ''}`}
                      onClick={() => onUpdateVoiceSettings?.({ ...voiceSettings, cornerMaskPosition: 'top-left', cornerMaskXPercent: null, cornerMaskYPercent: null, enableCornerMask: true })}
                    >
                      ឆ្វេងលើ
                    </button>
                    <button
                      type="button"
                      className={`pos-chip ${currentMaskPos === 'top-right' ? 'active' : ''}`}
                      onClick={() => onUpdateVoiceSettings?.({ ...voiceSettings, cornerMaskPosition: 'top-right', cornerMaskXPercent: null, cornerMaskYPercent: null, enableCornerMask: true })}
                    >
                      ស្តាំលើ
                    </button>
                    <button
                      type="button"
                      className={`pos-chip ${currentMaskPos === 'bottom-left' ? 'active' : ''}`}
                      onClick={() => onUpdateVoiceSettings?.({ ...voiceSettings, cornerMaskPosition: 'bottom-left', cornerMaskXPercent: null, cornerMaskYPercent: null, enableCornerMask: true })}
                    >
                      ឆ្វេងក្រោម
                    </button>
                    <button
                      type="button"
                      className={`pos-chip ${currentMaskPos === 'bottom-right' ? 'active' : ''}`}
                      onClick={() => onUpdateVoiceSettings?.({ ...voiceSettings, cornerMaskPosition: 'bottom-right', cornerMaskXPercent: null, cornerMaskYPercent: null, enableCornerMask: true })}
                    >
                      ស្តាំក្រោម
                    </button>
                  </div>
                  {currentMaskPos === 'custom' && (
                    <div style={{ fontSize: '10.5px', color: '#38BDF8', marginTop: 4 }}>
                      ទីតាំងផ្ទាល់: X {Math.round(voiceSettings?.cornerMaskXPercent ?? 50)}% · Y {Math.round(voiceSettings?.cornerMaskYPercent ?? 50)}%
                    </div>
                  )}
                  <div style={{ fontSize: '10px', color: 'var(--text-dim)', marginTop: 4 }}>
                    💡 អូសប្រអប់ Mask លើវីដេអូដាក់កន្លែងណាក៏បាន
                  </div>
                </div>

                <div className="popup-section">
                  <span className="popup-section-title">ម៉ូដ (Style)</span>
                  <div className="position-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                    <button
                      type="button"
                      className={`pos-chip ${currentMaskStyle === 'badge' ? 'active' : ''}`}
                      onClick={() => onUpdateVoiceSettings?.({ ...voiceSettings, cornerMaskStyle: 'badge', enableCornerMask: true })}
                    >
                      Badge
                    </button>
                    <button
                      type="button"
                      className={`pos-chip ${currentMaskStyle === 'blur' ? 'active' : ''}`}
                      onClick={() => onUpdateVoiceSettings?.({ ...voiceSettings, cornerMaskStyle: 'blur', enableCornerMask: true })}
                    >
                      Blur
                    </button>
                    <button
                      type="button"
                      className={`pos-chip ${currentMaskStyle === 'solid' ? 'active' : ''}`}
                      onClick={() => onUpdateVoiceSettings?.({ ...voiceSettings, cornerMaskStyle: 'solid', enableCornerMask: true })}
                    >
                      Solid
                    </button>
                  </div>
                </div>

                {currentMaskStyle === 'blur' && (
                  <div className="popup-section">
                    <div className="slider-row-header">
                      <span>កម្រិតព្រិល (Blur)</span>
                      <span className="value-label" style={{ color: '#38BDF8' }}>{getDisplay('cornerMaskBlur', currentMaskBlur)}px</span>
                    </div>
                    <SmoothRangeSlider
                      min={6}
                      max={36}
                      step={2}
                      value={currentMaskBlur}
                      previewKey="cornerMaskBlur"
                      onDraftChange={(v) => setSliderDraft('cornerMaskBlur', v)}
                      onCommit={(v) => onUpdateVoiceSettings?.({ ...voiceSettings, cornerMaskBlur: v, cornerMaskStyle: 'blur', enableCornerMask: true })}
                      className="compact-range"
                      style={{ accentColor: '#38BDF8' }}
                    />
                  </div>
                )}

                <div className="popup-section">
                  <div className="slider-row-header">
                    <span>បណ្តោយ (Width)</span>
                    <span className="value-label" style={{ color: '#38BDF8' }}>{getDisplay('cornerMaskWidth', currentMaskWidth)}px</span>
                  </div>
                  <SmoothRangeSlider
                    min={100}
                    max={360}
                    step={5}
                    value={currentMaskWidth}
                    previewKey="cornerMaskWidth"
                    onDraftChange={(v) => setSliderDraft('cornerMaskWidth', v)}
                    onCommit={(v) => onUpdateVoiceSettings?.({ ...voiceSettings, cornerMaskWidth: v, enableCornerMask: true })}
                    className="compact-range"
                    style={{ accentColor: '#38BDF8' }}
                  />
                </div>

                <div className="popup-section">
                  <div className="slider-row-header">
                    <span>កម្ពស់ (Height)</span>
                    <span className="value-label" style={{ color: '#38BDF8' }}>{getDisplay('cornerMaskHeight', currentMaskHeight)}px</span>
                  </div>
                  <SmoothRangeSlider
                    min={24}
                    max={100}
                    step={2}
                    value={currentMaskHeight}
                    previewKey="cornerMaskHeight"
                    onDraftChange={(v) => setSliderDraft('cornerMaskHeight', v)}
                    onCommit={(v) => onUpdateVoiceSettings?.({ ...voiceSettings, cornerMaskHeight: v, enableCornerMask: true })}
                    className="compact-range"
                    style={{ accentColor: '#38BDF8' }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* 4. AntiTheft Ribbon Quick Popover */}
          <div className="toolbar-dropdown-host">
            <button
              type="button"
              className={`transform-btn dropdown-btn ${isRibbonEnabled ? 'active-highlight' : ''}`}
              onClick={() => setActiveMenu(activeMenu === 'ribbon' ? null : 'ribbon')}
              title="សារ៉េរបារអក្សររត់ការពារ Copy (Banner)"
            >
              <Shield size={13} color={isRibbonEnabled ? '#38BDF8' : 'currentColor'} />
              <span>Banner</span>
              <ChevronDown size={11} />
            </button>

            {activeMenu === 'ribbon' && (
              <div className="transform-menu-popup">
                <div className="popup-header">
                  <span>របារអក្សររត់ (Banner)</span>
                  <button
                    type="button"
                    className="toggle-text-btn"
                    onClick={() => onUpdateVoiceSettings?.({ ...voiceSettings, enableAntiTheft: !isRibbonEnabled })}
                  >
                    {isRibbonEnabled ? <Eye size={13} color="#38BDF8" /> : <EyeOff size={13} color="#94A3B8" />}
                    <span>{isRibbonEnabled ? 'បើក' : 'បិទ'}</span>
                  </button>
                </div>

                <div className="popup-section">
                  <span className="popup-section-title">ទីតាំង</span>
                  <div className="position-grid two-col">
                    <button
                      type="button"
                      className={`pos-chip ${currentRibbonPos === 'bottom' ? 'active' : ''}`}
                      onClick={() => onUpdateVoiceSettings?.({ ...voiceSettings, marqueePosition: 'bottom' })}
                    >
                      ខាងក្រោម
                    </button>
                    <button
                      type="button"
                      className={`pos-chip ${currentRibbonPos === 'top' ? 'active' : ''}`}
                      onClick={() => onUpdateVoiceSettings?.({ ...voiceSettings, marqueePosition: 'top' })}
                    >
                      ខាងលើ
                    </button>
                  </div>
                </div>

                <div className="popup-section">
                  <span className="popup-section-title">ម៉ូដរបារ (Style)</span>
                  <div className="position-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                    <button
                      type="button"
                      data-testid="popup-banner-style-dark"
                      className={`pos-chip ${currentRibbonBgStyle === 'dark' ? 'active' : ''}`}
                      onClick={() => onUpdateVoiceSettings?.({ ...voiceSettings, antiTheftBgStyle: 'dark', enableAntiTheft: true })}
                    >
                      Dark
                    </button>
                    <button
                      type="button"
                      data-testid="popup-banner-style-blur"
                      className={`pos-chip ${currentRibbonBgStyle === 'blur' ? 'active' : ''}`}
                      onClick={() => onUpdateVoiceSettings?.({ ...voiceSettings, antiTheftBgStyle: 'blur', enableAntiTheft: true })}
                    >
                      Blur
                    </button>
                    <button
                      type="button"
                      data-testid="popup-banner-style-solid"
                      className={`pos-chip ${currentRibbonBgStyle === 'solid' ? 'active' : ''}`}
                      onClick={() => onUpdateVoiceSettings?.({ ...voiceSettings, antiTheftBgStyle: 'solid', enableAntiTheft: true })}
                    >
                      Solid
                    </button>
                  </div>
                </div>

                {currentRibbonBgStyle === 'blur' && (
                  <div className="popup-section">
                    <div className="slider-row-header">
                      <span>កម្រិតព្រិល (Blur)</span>
                      <span className="value-label" style={{ color: '#38BDF8' }}>
                        {getDisplay('antiTheftBlur', currentRibbonBlur)}px
                      </span>
                    </div>
                    <SmoothRangeSlider
                      min={6}
                      max={36}
                      step={2}
                      value={currentRibbonBlur}
                      previewKey="antiTheftBlur"
                      onDraftChange={(v) => setSliderDraft('antiTheftBlur', v)}
                      onCommit={(v) => onUpdateVoiceSettings?.({ ...voiceSettings, antiTheftBlur: v, antiTheftBgStyle: 'blur', enableAntiTheft: true })}
                      className="compact-range"
                      style={{ accentColor: '#38BDF8' }}
                    />
                  </div>
                )}

                <div className="popup-section">
                  {(() => {
                    const presetPxMap = { small: 22, medium: 28, large: 36, xlarge: 48, xxlarge: 64 };
                    const fallbackH = presetPxMap[voiceSettings?.antiTheftSize || 'small'] || 22;
                    const currentRibbonHeight =
                      voiceSettings?.antiTheftHeight !== null && voiceSettings?.antiTheftHeight !== undefined && Number(voiceSettings?.antiTheftHeight) > 0
                        ? Number(voiceSettings.antiTheftHeight)
                        : fallbackH;
                    return (
                      <>
                        <div className="slider-row-header">
                          <span>កម្រាស់របារ (Height)</span>
                          <span className="value-label" style={{ color: '#38BDF8' }}>
                            {getDisplay('antiTheftHeight', currentRibbonHeight)}px
                          </span>
                        </div>
                        <SmoothRangeSlider
                          min={18}
                          max={120}
                          step={2}
                          value={currentRibbonHeight}
                          previewKey="antiTheftHeight"
                          onDraftChange={(v) => setSliderDraft('antiTheftHeight', v)}
                          onCommit={(v) => onUpdateVoiceSettings?.({ ...voiceSettings, antiTheftHeight: v, enableAntiTheft: true })}
                          className="compact-range"
                          style={{ accentColor: '#38BDF8' }}
                        />
                      </>
                    );
                  })()}
                </div>

                <div className="popup-section">
                  <div className="slider-row-header">
                    <span>ទីតាំងពីក្រោម (Bottom)</span>
                    <span className="value-label" style={{ color: '#38BDF8' }}>
                      {Math.round(getDisplay('antiTheftBottomPercent', voiceSettings?.antiTheftBottomPercent || 2))}%
                    </span>
                  </div>
                  <SmoothRangeSlider
                    min={1}
                    max={60}
                    step={1}
                    value={Math.round(voiceSettings?.antiTheftBottomPercent || 2)}
                    previewKey="antiTheftBottomPercent"
                    onDraftChange={(v) => setSliderDraft('antiTheftBottomPercent', v)}
                    onCommit={(v) => onUpdateVoiceSettings?.({ ...voiceSettings, antiTheftBottomPercent: v, marqueePosition: 'bottom' })}
                    className="compact-range"
                    style={{ accentColor: '#38BDF8' }}
                  />
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
