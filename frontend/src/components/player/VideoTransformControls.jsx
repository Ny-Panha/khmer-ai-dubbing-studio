import React, { useState } from 'react';
import {
  Image as ImageIcon,
  Shield, Eye, EyeOff, Sliders, ChevronDown, ShieldCheck
} from 'lucide-react';
import './VideoTransformControls.css';

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
}) {
  const [activeMenu, setActiveMenu] = useState(null); // 'logo' | 'mask' | 'ribbon' | null
  const [isCollapsed, setIsCollapsed] = useState(false);

  const currentLogoPos = voiceSettings?.logoPosition || 'top-right';
  const currentLogoSize = voiceSettings?.logoSize || 72;
  const isLogoEnabled = Boolean(voiceSettings?.enableLogo);
  const isRibbonEnabled = voiceSettings?.enableAntiTheft !== false;
  const currentRibbonPos = voiceSettings?.marqueePosition || 'bottom';

  const isMaskEnabled = Boolean(voiceSettings?.enableCornerMask);
  const currentMaskPos = voiceSettings?.cornerMaskPosition || 'top-right';
  const currentMaskStyle = voiceSettings?.cornerMaskStyle || 'badge';
  const currentMaskWidth = voiceSettings?.cornerMaskWidth || 220;
  const currentMaskHeight = voiceSettings?.cornerMaskHeight || 54;
  const currentMaskText = voiceSettings?.cornerMaskText ?? '«រឿងប្រឌិតសុទ្ធសាធ • ហាមចម្លង»';

  return (
    <div
      className={`video-transform-toolbar ${isCollapsed ? 'collapsed' : ''}`}
      onClick={(e) => e.stopPropagation()}
      data-testid="video-transform-toolbar"
    >
      {/* 1. Toggle Collapse Button */}
      <button
        type="button"
        className="transform-btn collapse-toggle-btn"
        onClick={() => setIsCollapsed(!isCollapsed)}
        title={isCollapsed ? "បង្ហាញ Tool កែ Logo, Mask & Banner" : "បង្រួម Tool"}
      >
        <Sliders size={13} />
        {!isCollapsed && <span className="toolbar-label">Customize</span>}
      </button>

      {!isCollapsed && (
        <>
          <div className="toolbar-divider" />

          {/* 2. Logo Watermark Quick Popover */}
          <div className="toolbar-dropdown-host">
            <button
              type="button"
              className={`transform-btn dropdown-btn ${isLogoEnabled ? 'active-highlight' : ''}`}
              onClick={() => setActiveMenu(activeMenu === 'logo' ? null : 'logo')}
              title="សារ៉េទីតាំង & ទំហំ Logo Watermark"
            >
              <ImageIcon size={13} color={isLogoEnabled ? '#eab308' : 'currentColor'} />
              <span>Logo</span>
              <ChevronDown size={11} />
            </button>

            {activeMenu === 'logo' && (
              <div className="transform-menu-popup">
                <div className="popup-header">
                  <span>Logo Watermark</span>
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
                  <span className="popup-section-title">ជ្រើសរើសជ្រុង (Position):</span>
                  <div className="position-grid">
                    {[
                      { id: 'top-left', label: '↖ ឆ្វេងលើ' },
                      { id: 'top-right', label: '↗ ស្តាំលើ' },
                      { id: 'bottom-left', label: '↙ ឆ្វេងក្រោម' },
                      { id: 'bottom-right', label: '↘ ស្តាំក្រោម' },
                      { id: 'both', label: '↔ សងខាងលើ' },
                    ].map((pos) => (
                      <button
                        key={pos.id}
                        type="button"
                        className={`pos-chip ${currentLogoPos === pos.id ? 'active' : ''}`}
                        onClick={() => onUpdateVoiceSettings?.({ ...voiceSettings, logoPosition: pos.id, enableLogo: true })}
                      >
                        {pos.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="popup-section">
                  <div className="slider-row-header">
                    <span>ទំហំ Logo (Size):</span>
                    <span className="value-label">{currentLogoSize}px</span>
                  </div>
                  <input
                    type="range"
                    min="36"
                    max="160"
                    step="4"
                    value={currentLogoSize}
                    onChange={(e) => onUpdateVoiceSettings?.({ ...voiceSettings, logoSize: Number(e.target.value) })}
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
              title="សារ៉េប្រអប់បិទបាំង Watermark / Disclaimer ចិន"
            >
              <ShieldCheck size={13} color={isMaskEnabled ? '#38bdf8' : 'currentColor'} />
              <span>Mask</span>
              <ChevronDown size={11} />
            </button>

            {activeMenu === 'mask' && (
              <div className="transform-menu-popup" style={{ width: 260 }}>
                <div className="popup-header">
                  <span>ប្រអប់បិទបាំង (Corner Mask)</span>
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
                  <span className="popup-section-title">អក្សរបិទបាំង (Text):</span>
                  <input
                    type="text"
                    value={currentMaskText}
                    onChange={(e) => onUpdateVoiceSettings?.({ ...voiceSettings, cornerMaskText: e.target.value, enableCornerMask: true })}
                    placeholder="អក្សរបិទបាំង..."
                    style={{
                      width: '100%',
                      background: 'rgba(0,0,0,0.5)',
                      border: '1px solid rgba(56, 189, 248, 0.4)',
                      color: '#fff',
                      borderRadius: 4,
                      padding: '3px 6px',
                      fontSize: '0.70rem',
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                <div className="popup-section">
                  <span className="popup-section-title">ទីតាំង (Position):</span>
                  <div className="position-grid two-col">
                    <button
                      type="button"
                      className={`pos-chip ${currentMaskPos === 'top-right' ? 'active' : ''}`}
                      onClick={() => onUpdateVoiceSettings?.({ ...voiceSettings, cornerMaskPosition: 'top-right', enableCornerMask: true })}
                    >
                      ↗ ស្តាំលើ (Top Right)
                    </button>
                    <button
                      type="button"
                      className={`pos-chip ${currentMaskPos === 'top-left' ? 'active' : ''}`}
                      onClick={() => onUpdateVoiceSettings?.({ ...voiceSettings, cornerMaskPosition: 'top-left', enableCornerMask: true })}
                    >
                      ↖ ឆ្វេងលើ (Top Left)
                    </button>
                  </div>
                </div>

                <div className="popup-section">
                  <div className="slider-row-header">
                    <span>បណ្តោយ (Width):</span>
                    <span className="value-label" style={{ color: '#38bdf8' }}>{currentMaskWidth}px</span>
                  </div>
                  <input
                    type="range"
                    min="100"
                    max="360"
                    step="5"
                    value={currentMaskWidth}
                    onChange={(e) => onUpdateVoiceSettings?.({ ...voiceSettings, cornerMaskWidth: Number(e.target.value), enableCornerMask: true })}
                    className="compact-range"
                    style={{ accentColor: '#38bdf8' }}
                  />
                </div>

                <div className="popup-section">
                  <div className="slider-row-header">
                    <span>កម្ពស់ (Height):</span>
                    <span className="value-label" style={{ color: '#38bdf8' }}>{currentMaskHeight}px</span>
                  </div>
                  <input
                    type="range"
                    min="24"
                    max="100"
                    step="2"
                    value={currentMaskHeight}
                    onChange={(e) => onUpdateVoiceSettings?.({ ...voiceSettings, cornerMaskHeight: Number(e.target.value), enableCornerMask: true })}
                    className="compact-range"
                    style={{ accentColor: '#38bdf8' }}
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
              title="សារ៉េរបាររក្សាសិទ្ធិ (Anti-Theft Banner)"
            >
              <Shield size={13} color={isRibbonEnabled ? '#38bdf8' : 'currentColor'} />
              <span>Banner</span>
              <ChevronDown size={11} />
            </button>

            {activeMenu === 'ribbon' && (
              <div className="transform-menu-popup">
                <div className="popup-header">
                  <span>របាររក្សាសិទ្ធិ (Banner)</span>
                  <button
                    type="button"
                    className="toggle-text-btn"
                    onClick={() => onUpdateVoiceSettings?.({ ...voiceSettings, enableAntiTheft: !isRibbonEnabled })}
                  >
                    {isRibbonEnabled ? <Eye size={13} color="#38bdf8" /> : <EyeOff size={13} color="#94a3b8" />}
                    <span>{isRibbonEnabled ? 'កំពុងបើក' : 'បានបិទ'}</span>
                  </button>
                </div>

                <div className="popup-section">
                  <span className="popup-section-title">ទីតាំង (Position):</span>
                  <div className="position-grid two-col">
                    <button
                      type="button"
                      className={`pos-chip ${currentRibbonPos === 'bottom' ? 'active' : ''}`}
                      onClick={() => onUpdateVoiceSettings?.({ ...voiceSettings, marqueePosition: 'bottom' })}
                    >
                      ⬇ ខាងក្រោម (Bottom)
                    </button>
                    <button
                      type="button"
                      className={`pos-chip ${currentRibbonPos === 'top' ? 'active' : ''}`}
                      onClick={() => onUpdateVoiceSettings?.({ ...voiceSettings, marqueePosition: 'top' })}
                    >
                      ⬆ ខាងលើ (Top)
                    </button>
                  </div>
                </div>

                <div className="popup-section">
                  <div className="slider-row-header">
                    <span>កម្ពស់របារ (Bottom Height):</span>
                    <span className="value-label" style={{ color: '#38bdf8' }}>{Math.round(voiceSettings?.antiTheftBottomPercent || 2)}%</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="60"
                    step="1"
                    value={Math.round(voiceSettings?.antiTheftBottomPercent || 2)}
                    onChange={(e) => onUpdateVoiceSettings?.({ ...voiceSettings, antiTheftBottomPercent: Number(e.target.value), marqueePosition: 'bottom' })}
                    className="compact-range"
                    style={{ accentColor: '#38bdf8' }}
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
