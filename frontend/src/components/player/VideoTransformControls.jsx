import React, { useState } from 'react';
import {
  ZoomIn, ZoomOut, Move, RotateCcw, Image as ImageIcon,
  Shield, Eye, EyeOff, Sliders, ChevronDown, Check, Sparkles
} from 'lucide-react';
import './VideoTransformControls.css';

/**
 * Modern floating glassmorphism toolbar for interactive video zoom, pan,
 * watermark logo positioning, and bottom banner controls directly on the player.
 */
export default function VideoTransformControls({
  videoZoom = 1.0,
  videoPanX = 0,
  videoPanY = 0,
  onUpdateTransform,
  onResetTransform,
  isPanModeActive = false,
  onTogglePanMode,
  voiceSettings = {},
  onUpdateVoiceSettings,
  aspectRatio = '16:9',
}) {
  const [activeMenu, setActiveMenu] = useState(null); // 'logo' | 'ribbon' | null
  const [isCollapsed, setIsCollapsed] = useState(false);

  const zoomPercent = Math.round(videoZoom * 100);

  const handleZoomChange = (delta) => {
    const nextZoom = Math.max(1.0, Math.min(3.0, Math.round((videoZoom + delta) * 10) / 10));
    onUpdateTransform({
      zoom: nextZoom,
      panX: nextZoom === 1.0 ? 0 : videoPanX,
      panY: nextZoom === 1.0 ? 0 : videoPanY,
    });
  };

  const handleSetExactZoom = (zoomVal) => {
    onUpdateTransform({
      zoom: zoomVal,
      panX: zoomVal === 1.0 ? 0 : videoPanX,
      panY: zoomVal === 1.0 ? 0 : videoPanY,
    });
  };

  const currentLogoPos = voiceSettings?.logoPosition || 'top-right';
  const currentLogoSize = voiceSettings?.logoSize || 72;
  const isLogoEnabled = Boolean(voiceSettings?.enableLogo);
  const isRibbonEnabled = voiceSettings?.enableAntiTheft !== false;
  const currentRibbonPos = voiceSettings?.marqueePosition || 'bottom';

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
        title={isCollapsed ? "បង្ហាញ Tool កែទំហំ & Move វីដេអូ" : "បង្រួម Tool"}
      >
        <Sliders size={13} />
        {!isCollapsed && <span className="toolbar-label">Customize</span>}
      </button>

      {!isCollapsed && (
        <>
          {/* Divider */}
          <div className="toolbar-divider" />

          {/* 2. Video Zoom Controls */}
          <div className="toolbar-group zoom-group">
            <button
              type="button"
              className="transform-btn icon-btn"
              onClick={() => handleZoomChange(-0.1)}
              disabled={videoZoom <= 1.0}
              title="Zoom Out (បង្រួម)"
            >
              <ZoomOut size={13} />
            </button>

            <button
              type="button"
              className={`transform-btn zoom-badge-btn ${videoZoom > 1.0 ? 'active' : ''}`}
              onClick={() => handleSetExactZoom(videoZoom > 1.0 ? 1.0 : 1.25)}
              title="ចុចដើម្បីកំណត់ Zoom (Click to toggle 100% / 125%)"
            >
              <span>{zoomPercent}%</span>
            </button>

            <button
              type="button"
              className="transform-btn icon-btn"
              onClick={() => handleZoomChange(0.1)}
              disabled={videoZoom >= 3.0}
              title="Zoom In (ពង្រីក)"
            >
              <ZoomIn size={13} />
            </button>
          </div>

          {/* 3. Hand Tool (Pan Mode) */}
          <button
            type="button"
            className={`transform-btn tool-toggle-btn ${isPanModeActive ? 'active' : ''}`}
            onClick={onTogglePanMode}
            title={isPanModeActive ? "បិទ Hand Tool (Pan Mode)" : "បើក Hand Tool (ចុចអូស Move វីដេអូសេរី)"}
          >
            <Move size={13} />
            <span>{isPanModeActive ? '✋ Move ON' : 'Move'}</span>
          </button>

          {/* 4. Reset View Button */}
          {(videoZoom > 1.0 || videoPanX !== 0 || videoPanY !== 0) && (
            <button
              type="button"
              className="transform-btn reset-btn"
              onClick={onResetTransform}
              title="Reset View ទៅដើមវិញ (100% Center)"
            >
              <RotateCcw size={12} />
              <span>Reset</span>
            </button>
          )}

          {/* Divider */}
          <div className="toolbar-divider" />

          {/* 5. Logo Watermark Quick Popover */}
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

          {/* 6. AntiTheft Ribbon Quick Popover */}
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
