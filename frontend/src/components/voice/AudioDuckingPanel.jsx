import React, { useState } from 'react';
import {
  Volume2, RotateCcw, Play, Square, ChevronUp, ChevronDown
} from 'lucide-react';
import SmoothRangeSlider from '../common/SmoothRangeSlider';

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

  const committedDucking = settings?.duckingVolume !== undefined ? settings.duckingVolume : 0.15;
  const committedKhmer = settings?.khmerVolume !== undefined ? settings.khmerVolume : 1.0;
  const duckingVal = draftDucking !== null ? draftDucking : committedDucking;
  const khmerVal = draftKhmer !== null ? draftKhmer : committedKhmer;
  // Linear gain -> dB readout (0 = -∞ dB)
  const toDb = (gain) => {
    if (!(gain > 0)) return '-∞ dB';
    const db = 20 * Math.log10(gain);
    return `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`;
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
            1. Audio Mixing
          </label>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: '0.7rem', color: duckingVal === 0 ? 'var(--color-error)' : 'var(--accent-cyan)', fontWeight: 600 }}>
            {duckingVal === 0 ? 'Mute on Voice (0%)' : `Original ${Math.round(duckingVal * 100)}%`}
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
                onSettingChange('duckingVolume', 0.15);
                onSettingChange('khmerVolume', 1.0);
              }}
              style={{
                background: 'rgba(56, 189, 248, 0.08)',
                border: '1px solid rgba(56, 189, 248, 0.25)',
                color: '#38bdf8',
                borderRadius: 4,
                padding: '3px 8px',
                fontSize: '0.68rem',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4
              }}
              title="Reset to default: Original Audio 15%, Khmer Voice 100%"
            >
              <RotateCcw size={11} />
              <span>Reset កម្រិតសំឡេងស្តង់ដារ (15% / 100%)</span>
            </button>
          </div>

          {/* AI Vocal Separation (Demucs) Optional Toggle */}
          <div style={{
            background: 'rgba(0, 0, 0, 0.25)',
            border: settings?.enableDemucs ? '1px solid rgba(56, 189, 248, 0.4)' : '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: 6,
            padding: '8px 10px',
            marginBottom: 10,
            transition: 'all 0.2s ease',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: 5 }}>
                <span>AI Vocal Separation (Demucs)</span>
              </span>
              <span style={{
                fontSize: '0.65rem',
                fontWeight: 700,
                padding: '1px 6px',
                borderRadius: 4,
                background: settings?.enableDemucs ? 'rgba(34, 197, 94, 0.2)' : 'rgba(148, 163, 184, 0.15)',
                color: settings?.enableDemucs ? '#4ade80' : '#94a3b8',
                border: settings?.enableDemucs ? '1px solid rgba(74, 222, 128, 0.4)' : '1px solid rgba(255, 255, 255, 0.08)'
              }}>
                {settings?.enableDemucs ? 'ENABLED' : 'DISABLED'}
              </span>
            </div>

            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', marginTop: 6 }}>
              <input
                type="checkbox"
                checked={Boolean(settings?.enableDemucs)}
                onChange={(e) => onSettingChange('enableDemucs', e.target.checked)}
                style={{ marginTop: 2, cursor: 'pointer', accentColor: 'var(--primary-accent)' }}
              />
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: '0.74rem', fontWeight: 600, color: settings?.enableDemucs ? 'var(--accent-cyan)' : 'var(--text-primary)' }}>
                  Remove Chinese Dialogue, Preserve BGM & SFX
                </span>
                <span style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginTop: 2, lineHeight: 1.3 }}>
                  ប្រើ CPU ដើម្បីបំបែកសំឡេងដើម មុន Mix សំឡេងខ្មែរ។ អាចចំណាយពេលបន្ថែម។
                </span>
              </div>
            </label>
          </div>

          {/* Original Audio Ducking / Background Music Slider (0% - 100%, step 1%) */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span className="slider-label">
                {settings?.enableDemucs ? 'Background Music Volume (BGM & SFX):' : 'Original Background Audio:'}
              </span>
              <span className="slider-val" style={{ color: duckingVal === 0 ? 'var(--color-error)' : 'var(--primary-accent)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {duckingVal === 0 ? 'Muted (0%)' : `${Math.round(duckingVal * 100)}%`}
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
              title="Adjust Original Drama Audio from 0% to 100%"
            />
            {duckingVal === 0 && (
              <div style={{ fontSize: '0.68rem', color: '#f87171', marginTop: 3 }}>
                🔇 បិទសំឡេងនិយាយដើមលើឃ្លា Voice (Mute Speech) និងរក្សាភ្លេងធម្មតាលើចន្លោះ Gap
              </div>
            )}
            {duckingVal > 0 && duckingVal < 0.08 && (
              <div style={{ fontSize: '0.68rem', color: 'var(--accent-cyan)', marginTop: 3 }}>
                💡 កម្រិតសំឡេងដើម ({Math.round(duckingVal * 100)}%) គឺស្រាលខ្លាំង (Whisper Level)។ ស្តង់ដារទូទៅគឺ 15%។
              </div>
            )}
          </div>

          {/* Khmer Voice Boost Slider (20% - 200%, step 5%) */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span className="slider-label">Khmer Voice Boost:</span>
              <span className="slider-val" style={{ color: 'var(--color-success)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
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
              title="Boost Khmer Voice from 20% up to 200% (Standard is 100%)"
            />
          </div>

          {/* Live Audio Test Button (Web Audio API) with Equalizer animation */}
          <button
            type="button"
            onClick={onToggleTest}
            disabled={!previewAudioUrl}
            className={`test-audio-btn ${isPlayingTest ? 'playing' : ''}`}
            style={{ fontSize: '0.82rem', padding: '8px 12px' }}
          >
            {isPlayingTest ? (
              <>
                <Square size={13} fill="currentColor" />
                <span>Stop Audio Preview</span>
                <span className="eq-bar" style={{ animationDelay: '0.1s' }} />
                <span className="eq-bar" style={{ animationDelay: '0.3s' }} />
                <span className="eq-bar" style={{ animationDelay: '0.2s' }} />
              </>
            ) : (
              <>
                <Play size={13} fill="currentColor" />
                <span>{previewAudioUrl ? 'Preview Audio Ducking Mix' : 'Voice Not Generated (បង្កើតសំឡេងនៅជំហានទី ៣ ជាមុនសិន)'}</span>
              </>
            )}
          </button>
        </>
      )}
    </div>
  );
}

export default React.memo(AudioDuckingPanel);
