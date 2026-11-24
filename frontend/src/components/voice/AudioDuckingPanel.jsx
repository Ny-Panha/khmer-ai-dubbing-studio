import React, { useState, useRef } from 'react';
import {
  Volume2,
  RotateCcw,
  Play,
  Square,
  ChevronUp,
  ChevronDown,
  Music,
  Upload,
  Repeat,
  Trash2,
  Loader2,
  Check,
} from 'lucide-react';
import SmoothRangeSlider from '../common/SmoothRangeSlider';

function formatBgmDuration(sec) {
  const num = Number(sec) || 0;
  if (num <= 0) return '';
  const m = Math.floor(num / 60);
  const s = Math.round(num % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function AudioDuckingPanel({
  isOpen,
  onToggle,
  settings,
  onSettingChange,
  isPlayingTest,
  onToggleTest,
  previewAudioUrl,
}) {
  const [draftDucking, setDraftDucking] = useState(null);
  const [draftKhmer, setDraftKhmer] = useState(null);
  const [isUploadingBgm, setIsUploadingBgm] = useState(false);
  const [bgmUploadError, setBgmUploadError] = useState(null);
  const bgmInputRef = useRef(null);

  const committedDucking = settings?.duckingVolume !== undefined ? settings.duckingVolume : 0.15;
  const committedKhmer = settings?.khmerVolume !== undefined ? settings.khmerVolume : 1.0;
  const duckingVal = draftDucking !== null ? draftDucking : committedDucking;
  const khmerVal = draftKhmer !== null ? draftKhmer : committedKhmer;

  const hasCustomBgmFile = Boolean(settings?.customBgmUrl || settings?.customBgmPath);
  const isCustomBgmLoopActive = Boolean(settings?.enableCustomBgm && hasCustomBgmFile);
  const isMutedByYtSafe = Boolean(settings?.youtubeSafeAudio && !isCustomBgmLoopActive);

  // Linear gain -> dB readout (0 = -∞ dB)
  const toDb = (gain) => {
    if (!(gain > 0)) return '-∞ dB';
    const db = 20 * Math.log10(gain);
    return `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`;
  };

  const handleUploadBgmFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploadingBgm(true);
    setBgmUploadError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/upload-custom-bgm', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (data?.success && data.bgmUrl) {
        onSettingChange({
          enableCustomBgm: true,
          customBgmUrl: data.bgmUrl,
          customBgmPath: data.bgmPath || null,
          customBgmName: data.originalName || file.name || 'Custom_BGM.mp3',
          customBgmDuration: Number(data.durationSec) || 0,
        });
      } else {
        setBgmUploadError(data?.error || 'Upload ភ្លេងមិនជោគជ័យ');
      }
    } catch (err) {
      setBgmUploadError(err?.message || 'Network error');
    } finally {
      setIsUploadingBgm(false);
      if (bgmInputRef.current) {
        bgmInputRef.current.value = '';
      }
    }
  };

  const handleRemoveCustomBgm = () => {
    onSettingChange({
      enableCustomBgm: false,
      customBgmUrl: null,
      customBgmPath: null,
      customBgmName: null,
      customBgmDuration: 0,
    });
  };

  return (
    <div className="inspector-card-group">
      {/* Header */}
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', marginBottom: isOpen ? 10 : 0 }}
        onClick={onToggle}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Volume2 size={14} color="var(--primary-accent)" />
          <label className="section-label" style={{ margin: 0, cursor: 'pointer' }}>
            លាយសំឡេង (Audio Mix)
          </label>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {isCustomBgmLoopActive && (
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '10px',
                fontWeight: 700,
                padding: '1px 6px',
                borderRadius: 4,
                background: 'rgba(16, 185, 129, 0.14)',
                border: '1px solid rgba(16, 185, 129, 0.4)',
                color: '#34D399',
              }}
            >
              Loop BGM
            </span>
          )}
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: duckingVal === 0 ? 'var(--color-error-text)' : 'var(--primary-accent)', fontWeight: 600 }}>
            {duckingVal === 0 ? 'Mute (0%)' : `BGM ${Math.round(duckingVal * 100)}%`}
          </span>
          {isOpen ? <ChevronUp size={14} color="var(--text-dim)" /> : <ChevronDown size={14} color="var(--text-dim)" />}
        </div>
      </div>

      {isOpen && (
        <>
          {/* Reset to standard preset button */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
            <button
              type="button"
              onClick={() => {
                setDraftDucking(null);
                setDraftKhmer(null);
                onSettingChange({ duckingVolume: 0.15, khmerVolume: 1.0 });
              }}
              className="btn-secondary"
              style={{
                minHeight: 26,
                padding: '3px 9px',
                fontSize: '11.5px',
                color: 'var(--primary-accent)',
              }}
              title="កំណត់កម្រិតសំឡេងស្តង់ដារ៖ ភ្លេង 15% / សំឡេងខ្មែរ 100%"
            >
              <RotateCcw size={11} />
              <span>Reset (15% / 100%)</span>
            </button>
          </div>

          {/* Custom Loop Music (Anti-Copyright Background Music) */}
          <div
            data-testid="custom-bgm-loop-box"
            style={{
              background: isCustomBgmLoopActive
                ? 'rgba(16, 185, 129, 0.08)'
                : 'var(--bg-secondary-panel)',
              border: `1px solid ${
                isCustomBgmLoopActive
                  ? 'rgba(16, 185, 129, 0.38)'
                  : 'var(--border-subtle)'
              }`,
              borderRadius: 'var(--radius-sm)',
              padding: '9px 10px',
              marginBottom: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <input
              ref={bgmInputRef}
              type="file"
              accept="audio/*,.mp3,.wav,.m4a,.ogg,.aac,.flac"
              onChange={handleUploadBgmFile}
              style={{ display: 'none' }}
            />

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <Music size={13} color={isCustomBgmLoopActive ? '#34D399' : 'var(--primary-accent)'} />
                <span style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                  ភ្លេង BGM ផ្ទាល់ខ្លួន (Auto-Loop)
                </span>
              </div>
              <span
                style={{
                  fontSize: '10px',
                  fontWeight: 700,
                  padding: '1px 6px',
                  borderRadius: 4,
                  background: isCustomBgmLoopActive ? 'rgba(16, 185, 129, 0.16)' : 'rgba(56, 189, 248, 0.12)',
                  border: `1px solid ${isCustomBgmLoopActive ? 'rgba(16, 185, 129, 0.42)' : 'rgba(56, 189, 248, 0.3)'}`,
                  color: isCustomBgmLoopActive ? '#34D399' : '#38BDF8',
                  whiteSpace: 'nowrap',
                }}
              >
                {isCustomBgmLoopActive ? 'Loop ពេញវីដេអូ' : 'ការពារ Copyright'}
              </span>
            </div>

            {!hasCustomBgmFile ? (
              <>
                <button
                  type="button"
                  data-testid="btn-upload-custom-bgm"
                  onClick={() => !isUploadingBgm && bgmInputRef.current?.click()}
                  disabled={isUploadingBgm}
                  className="btn-secondary"
                  style={{
                    width: '100%',
                    minHeight: 30,
                    padding: '5px 10px',
                    fontSize: '11.5px',
                    fontWeight: 700,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    color: 'var(--primary-accent)',
                    borderColor: 'rgba(56, 189, 248, 0.38)',
                  }}
                >
                  {isUploadingBgm ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                  <span>{isUploadingBgm ? 'កំពុង Upload ភ្លេង...' : '+ ដាក់ភ្លេង BGM (.mp3 / .wav / .m4a)'}</span>
                </button>
                <span style={{ fontSize: '10.5px', color: 'var(--text-dim)', lineHeight: 1.4 }}>
                  ឧ. ភ្លេង 4 នាទី → Loop តគ្នាស្វ័យប្រវត្តិពេញវីដេអូ (ទោះ 5 ម៉ោង) និងបិទភ្លេងដើម 100%
                </span>
              </>
            ) : (
              <>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 6,
                    padding: '5px 8px',
                    borderRadius: 4,
                    background: 'var(--bg-primary-panel)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
                    <Repeat size={12} color="#34D399" style={{ flexShrink: 0 }} />
                    <span
                      style={{
                        fontSize: '11.5px',
                        fontWeight: 600,
                        color: 'var(--text-primary)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                      title={settings?.customBgmName || 'Custom BGM'}
                    >
                      {settings?.customBgmName || 'Custom_BGM.mp3'}
                    </span>
                  </div>
                  {settings?.customBgmDuration > 0 && (
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '10.5px',
                        fontWeight: 700,
                        color: '#34D399',
                        flexShrink: 0,
                      }}
                    >
                      {formatBgmDuration(settings.customBgmDuration)} → ∞
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <button
                    type="button"
                    data-testid="btn-toggle-custom-bgm-loop"
                    onClick={() => onSettingChange('enableCustomBgm', !settings?.enableCustomBgm)}
                    style={{
                      flex: 1,
                      height: 27,
                      padding: '0 8px',
                      borderRadius: 4,
                      fontSize: '11px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 4,
                      background: isCustomBgmLoopActive ? 'rgba(16, 185, 129, 0.18)' : 'var(--bg-primary-panel)',
                      border: `1px solid ${isCustomBgmLoopActive ? 'rgba(16, 185, 129, 0.48)' : 'var(--border-subtle)'}`,
                      color: isCustomBgmLoopActive ? '#34D399' : 'var(--text-secondary)',
                    }}
                  >
                    {isCustomBgmLoopActive ? <Check size={12} /> : <Repeat size={12} />}
                    <span>{isCustomBgmLoopActive ? 'កំពុងប្រើ Loop' : 'បើកប្រើ Loop'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => !isUploadingBgm && bgmInputRef.current?.click()}
                    disabled={isUploadingBgm}
                    className="btn-secondary"
                    style={{ height: 27, padding: '0 8px', fontSize: '11px' }}
                    title="ប្តូរឯកសារភ្លេង BGM ផ្សេង"
                  >
                    {isUploadingBgm ? '...' : 'ប្តូរភ្លេង'}
                  </button>

                  <button
                    type="button"
                    onClick={handleRemoveCustomBgm}
                    className="btn-secondary"
                    style={{
                      height: 27,
                      width: 27,
                      padding: 0,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#F87171',
                      borderColor: 'rgba(239, 68, 68, 0.35)',
                    }}
                    title="លុបភ្លេង BGM ផ្ទាល់ខ្លួនចេញ"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </>
            )}

            {bgmUploadError && (
              <span style={{ fontSize: '11px', color: '#F87171', fontWeight: 600 }}>
                {bgmUploadError}
              </span>
            )}
          </div>

          {isMutedByYtSafe && (
            <div style={{
              fontSize: '11px',
              color: '#6EE7B7',
              background: 'rgba(16, 185, 129, 0.1)',
              border: '1px solid rgba(16, 185, 129, 0.28)',
              borderRadius: 'var(--radius-sm)',
              padding: '6px 9px',
              marginBottom: 10,
              lineHeight: 1.45,
            }}>
              YouTube Safe Audio កំពុងបើក — ភ្លេងដើមត្រូវបានបិទ 100%
            </div>
          )}

          {/* Original Audio Ducking / Background Music Slider (0% - 100%, step 1%) */}
          <div style={{ marginBottom: 12, opacity: isMutedByYtSafe ? 0.55 : 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span className="slider-label">
                {isCustomBgmLoopActive ? 'កម្រិតភ្លេង Custom BGM (Loop)' : 'ភ្លេង BGM / សំឡេងដើម'}
              </span>
              <span className="slider-val" style={{ color: duckingVal === 0 ? 'var(--color-error-text)' : 'var(--primary-accent)', fontWeight: 700, fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
                {duckingVal === 0 ? '0%' : `${Math.round(duckingVal * 100)}%`}
                <span style={{ marginLeft: 6, fontWeight: 500, opacity: 0.7 }}>{toDb(duckingVal)}</span>
              </span>
            </div>
            <SmoothRangeSlider
              min={0}
              max={1}
              step={0.01}
              value={committedDucking}
              previewKey="duckingVolume"
              onDraftChange={setDraftDucking}
              onCommit={(val) => onSettingChange('duckingVolume', val)}
              className="capcut-slider"
              data-testid="slider-ducking-volume"
              title="សារ៉េកម្រិតសំឡេងដើម / BGM (0% - 100%)"
            />
            {duckingVal === 0 && (
              <div style={{ fontSize: '11.5px', color: '#FCA5A5', marginTop: 4 }}>
                បិទសំឡេងដើមត្រង់ឃ្លានិយាយ រក្សាភ្លេងត្រង់ចន្លោះ Gap
              </div>
            )}
            {duckingVal > 0 && duckingVal < 0.08 && (
              <div style={{ fontSize: '11.5px', color: 'var(--primary-accent)', marginTop: 4 }}>
                កម្រិតសំឡេងដើមស្រាល ({Math.round(duckingVal * 100)}%) — ស្តង់ដារ 15%
              </div>
            )}
          </div>

          {/* Khmer Voice Boost Slider (20% - 200%, step 5%) */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span className="slider-label">សំឡេងខ្មែរ AI</span>
              <span className="slider-val" style={{ color: 'var(--color-success-text)', fontWeight: 700, fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
                {Math.round(khmerVal * 100)}%
                <span style={{ marginLeft: 6, fontWeight: 500, opacity: 0.7 }}>{toDb(khmerVal)}</span>
              </span>
            </div>
            <SmoothRangeSlider
              min={0.2}
              max={2.0}
              step={0.05}
              value={committedKhmer}
              previewKey="khmerVolume"
              onDraftChange={setDraftKhmer}
              onCommit={(val) => onSettingChange('khmerVolume', val)}
              className="capcut-slider"
              data-testid="slider-khmer-volume"
              title="សារ៉េកម្រិតសំឡេងខ្មែរ AI (20% - 200%)"
            />
          </div>

          {/* Live Audio Test Button (Web Audio API) with Equalizer animation */}
          <button
            type="button"
            onClick={onToggleTest}
            disabled={!previewAudioUrl}
            className={`test-audio-btn ${isPlayingTest ? 'playing' : ''}`}
            style={{ fontSize: 'var(--text-sm)', padding: '8px 12px' }}
          >
            {isPlayingTest ? (
              <>
                <Square size={13} fill="currentColor" />
                <span>ឈប់ស្តាប់</span>
                <span className="eq-bar" style={{ animationDelay: '0.1s' }} />
                <span className="eq-bar" style={{ animationDelay: '0.3s' }} />
                <span className="eq-bar" style={{ animationDelay: '0.2s' }} />
              </>
            ) : (
              <>
                <Play size={13} fill="currentColor" />
                <span>{previewAudioUrl ? 'ស្តាប់សាកល្បង (Mix)' : 'មិនទាន់មានសំឡេង AI'}</span>
              </>
            )}
          </button>
        </>
      )}
    </div>
  );
}

export default React.memo(AudioDuckingPanel);
