import React, { useState } from 'react';
import {
  FileVideo, Subtitles, Mic, Music, Clapperboard,
  CheckCircle2, AlertTriangle, Info,
  Play, Pause, RefreshCw, Square, ChevronDown
} from 'lucide-react';
import { formatTimecode } from '../../utils/formatTime';
import './StageSettingsPanel.css';

export default function StageSettingsPanel({
  workspaceMode = 'script',
  selectedVideo = null,
  videoMetadata = null,
  activeSeries = null,
  activeEpisode = null,
  seriesGlossary = null,
  voiceSettings = {},
  onUpdateVoiceSettings = null,
  voiceCatalog = [],
  // Demucs props
  isCleanBgReady = false,
  isSeparatingAudio = false,
  separationProgress = 0,
  separationError = null,
  onStartDemucsSeparation = null,
  onKillDemucs = null,
  // Mix & Export props
  onRenderVideo = null,
  isRendering = false,
  renderProgress = 0,
  renderStage = '',
  renderedVideo = null,
  audioGenerated = false,
  previewAudioUrl = null,
}) {
  // Local test audio player for voice audition
  const [isPlayingTestVoice, setIsPlayingTestVoice] = useState(false);
  const [testAudioObj, setTestAudioObj] = useState(null);

  const handleTestListenVoice = async () => {
    if (isPlayingTestVoice && testAudioObj) {
      testAudioObj.pause();
      setIsPlayingTestVoice(false);
      return;
    }
    const voiceId = voiceSettings?.voiceId || 'km-KH-PisethNeural';
    try {
      setIsPlayingTestVoice(true);
      const res = await fetch('/api/preview-voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'សួស្តី! ខ្ញុំជាសំឡេងបញ្ចេញបញ្ចូលសំឡេងខ្មែរ AI សម្រាប់រឿងភាគចិន។',
          voice: voiceId,
          rate: voiceSettings?.speechRate || 1.0,
          pitch: voiceSettings?.speechPitch || 1.0,
        }),
      });
      const data = await res.json();
      if (data.audioUrl) {
        const audio = new Audio(data.audioUrl);
        setTestAudioObj(audio);
        audio.onended = () => setIsPlayingTestVoice(false);
        audio.onerror = () => setIsPlayingTestVoice(false);
        await audio.play();
      } else {
        setIsPlayingTestVoice(false);
      }
    } catch (_) {
      setIsPlayingTestVoice(false);
    }
  };

  const handleSettingChange = (key, value) => {
    if (onUpdateVoiceSettings) {
      onUpdateVoiceSettings((prev) => ({
        ...prev,
        [key]: value,
      }));
    }
  };

  // Render content based on current workspaceMode
  switch (workspaceMode) {
    case 'import': {
      const dur = videoMetadata?.duration || selectedVideo?.duration || 0;
      const width = videoMetadata?.width || (selectedVideo?.resolution ? selectedVideo.resolution.split('x')[0] : '1920');
      const height = videoMetadata?.height || (selectedVideo?.resolution ? selectedVideo.resolution.split('x')[1] : '1080');
      const sizeMb = selectedVideo?.fileSize ? (selectedVideo.fileSize / (1024 * 1024)).toFixed(1) + ' MB' : 'N/A';
      const fps = videoMetadata?.fps || selectedVideo?.fps || 30;

      return (
        <div className="stage-settings-panel">
          <div className="stage-settings-section">
            <span className="stage-section-quiet-title">
              <FileVideo size={13} color="#38bdf8" />
              <span>ព័ត៌មានភាគ (Episode Info)</span>
            </span>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#f1f5f9' }}>
                {activeEpisode?.name || 'EP01'} — {activeSeries?.title || 'រឿងភាគ'}
              </div>
              <div style={{ fontSize: 12, color: '#64748b' }}>
                {selectedVideo ? `${selectedVideo.name || 'video.mp4'} • ${formatTimecode(dur)}` : 'មិនទាន់មានវីដេអូ'}
              </div>
            </div>

            {/* Quiet Details Disclosure for Video Technical Metadata (Point 7) */}
            <details className="stage-details-disclosure" style={{ marginTop: 10 }}>
              <summary className="stage-details-summary">
                <span>ព័ត៌មានបច្ចេកទេសវីដេអូ (Video Technical Details)</span>
              </summary>
              <div className="stage-meta-grid" style={{ marginTop: 8 }}>
                <div className="stage-meta-item">
                  <span className="stage-meta-label">Resolution</span>
                  <span className="stage-meta-value">{width} × {height}</span>
                </div>
                <div className="stage-meta-item">
                  <span className="stage-meta-label">Duration</span>
                  <span className="stage-meta-value">{formatTimecode(dur)}</span>
                </div>
                <div className="stage-meta-item">
                  <span className="stage-meta-label">Frame Rate</span>
                  <span className="stage-meta-value">{fps} fps</span>
                </div>
                <div className="stage-meta-item">
                  <span className="stage-meta-label">File Size</span>
                  <span className="stage-meta-value">{sizeMb}</span>
                </div>
              </div>
            </details>

            <div className="stage-alert-banner stage-alert-info" style={{ marginTop: 10 }}>
              <Info size={13} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>
                អ្នកអាចជ្រើសរើស ឬទម្លាក់វីដេអូថ្មីនៅផ្ទាំង <strong>មេឌៀ (Media)</strong> ខាងឆ្វេង។
              </span>
            </div>
          </div>
        </div>
      );
    }

    case 'script': {
      const characters = seriesGlossary?.characters || activeSeries?.characters || [];
      const terms = seriesGlossary?.terms || activeSeries?.terms || [];

      return (
        <div className="stage-settings-panel">
          <div className="stage-settings-section">
            <span className="stage-section-quiet-title">
              <Subtitles size={13} color="#a855f7" />
              <span>ការកំណត់ការបកប្រែ (Translation Config)</span>
            </span>

            <div className="stage-control-group" style={{ marginTop: 6 }}>
              <label className="stage-control-label">
                ម៉ូដបកប្រែ (Dubbing Translation Mode):
              </label>
              <select
                className="stage-select"
                value={voiceSettings?.translationMode || 'mode-a'}
                onChange={(e) => handleSettingChange('translationMode', e.target.value)}
              >
                <option value="mode-a">Mode A: សន្ទនា 1:1 (Dialogue 1:1)</option>
                <option value="mode-b">Mode B: សម្រាយសាច់រឿង (Story Recap)</option>
              </select>
            </div>

            <div className="stage-control-group">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                <input
                  type="checkbox"
                  id="auto-align-timing-chk"
                  checked={voiceSettings?.autoAlignTimings !== false}
                  onChange={(e) => handleSettingChange('autoAlignTimings', e.target.checked)}
                  style={{ accentColor: '#38bdf8' }}
                />
                <label htmlFor="auto-align-timing-chk" style={{ fontSize: 12, color: '#cbd5e1', cursor: 'pointer' }}>
                  Auto-Align ពេលវេលាសន្ទនា (Strict Timing Sync)
                </label>
              </div>
            </div>

            <div className="stage-control-group" style={{ marginTop: 4 }}>
              <div className="stage-control-label">
                <span>តួអង្គក្នុងរឿង (Series Characters & Glossary)</span>
                <span className="stage-glossary-badge">{characters.length + terms.length} items</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, maxHeight: 110, overflowY: 'auto', padding: 2 }}>
                {characters.length === 0 && terms.length === 0 ? (
                  <span style={{ fontSize: 12, color: '#64748b', fontStyle: 'italic' }}>
                    មិនទាន់មានឈ្មោះតួអង្គក្នុង Glossary នៅឡើយ
                  </span>
                ) : (
                  <>
                    {characters.map((c, i) => (
                      <span key={i} className="stage-glossary-badge" style={{ borderColor: 'rgba(129, 140, 248, 0.3)', color: '#c7d2fe' }}>
                        👤 {c.chinese || c.name}: {c.khmer || c.khmerName || 'តួអង្គ'}
                      </span>
                    ))}
                    {terms.map((t, i) => (
                      <span key={i} className="stage-glossary-badge">
                        📖 {t.chinese || t.term}: {t.khmer || t.translation}
                      </span>
                    ))}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      );
    }

    case 'voice': {
      const defaultVoices = [
        { id: 'km-KH-PisethNeural', name: 'Piseth (ប្រុស - សំឡេងកក់ក្តៅ)', gender: 'male' },
        { id: 'km-KH-SreymomNeural', name: 'Sreymom (ស្រី - សំឡេងរស់រវើក)', gender: 'female' },
      ];
      const availableVoices = (voiceCatalog && voiceCatalog.length > 0) ? voiceCatalog : defaultVoices;
      const currentVoice = voiceSettings?.voiceId || 'km-KH-PisethNeural';
      const speechRate = voiceSettings?.speechRate !== undefined ? voiceSettings.speechRate : 1.0;
      const duckingVol = voiceSettings?.duckingVolume !== undefined ? voiceSettings.duckingVolume : 0.15;
      const khmerVol = voiceSettings?.khmerVolume !== undefined ? voiceSettings.khmerVolume : 1.0;

      return (
        <div className="stage-settings-panel">
          <div className="stage-settings-section">
            <span className="stage-section-quiet-title">
              <Mic size={13} color="#38bdf8" />
              <span>ការកំណត់សំឡេង (Edge Khmer TTS)</span>
            </span>

            <div className="stage-control-group" style={{ marginTop: 6 }}>
              <span className="stage-control-label">សំឡេងអ្នករៀបរាប់គោល (Master Voice)</span>
              <select
                className="stage-select"
                value={currentVoice}
                onChange={(e) => handleSettingChange('voiceId', e.target.value)}
              >
                {availableVoices.map((v) => (
                  <option key={v.id || v.shortName} value={v.id || v.shortName}>
                    {v.name || v.displayName || v.id}
                  </option>
                ))}
              </select>
            </div>

            <div className="stage-control-group">
              <div className="stage-control-label">
                <span>ល្បឿននិយាយ (Speech Speed)</span>
                <span style={{ color: '#38bdf8', fontWeight: 600 }}>{speechRate.toFixed(2)}x</span>
              </div>
              <div className="stage-slider-row">
                <input
                  type="range"
                  min="0.7"
                  max="1.5"
                  step="0.05"
                  value={speechRate}
                  onChange={(e) => handleSettingChange('speechRate', parseFloat(e.target.value))}
                  className="stage-slider"
                />
              </div>
            </div>

            <div className="stage-control-group">
              <div className="stage-control-label">
                <span>កម្រិតសំឡេងខ្មែរ (Khmer Voice Volume)</span>
                <span style={{ color: '#38bdf8', fontWeight: 600 }}>{Math.round(khmerVol * 100)}%</span>
              </div>
              <div className="stage-slider-row">
                <input
                  type="range"
                  min="0.2"
                  max="1.5"
                  step="0.05"
                  value={khmerVol}
                  onChange={(e) => handleSettingChange('khmerVolume', parseFloat(e.target.value))}
                  className="stage-slider"
                />
              </div>
            </div>

            <div className="stage-control-group">
              <div className="stage-control-label">
                <span>Smart Ducking ភ្លេង BGM</span>
                <span style={{ color: '#818cf8', fontWeight: 600 }}>{Math.round(duckingVol * 100)}%</span>
              </div>
              <div className="stage-slider-row">
                <input
                  type="range"
                  min="0.0"
                  max="0.5"
                  step="0.05"
                  value={duckingVol}
                  onChange={(e) => handleSettingChange('duckingVolume', parseFloat(e.target.value))}
                  className="stage-slider"
                />
              </div>
            </div>

            <button
              type="button"
              className="stage-btn-primary"
              style={{ background: 'rgba(255, 255, 255, 0.05)', color: '#cbd5e1', border: '1px solid rgba(255, 255, 255, 0.1)', boxShadow: 'none' }}
              onClick={handleTestListenVoice}
            >
              {isPlayingTestVoice ? <Pause size={13} color="#38bdf8" /> : <Play size={13} color="#38bdf8" />}
              <span>{isPlayingTestVoice ? 'កំពុងចាក់សាកល្បង...' : '🎧 ស្តាប់សាកល្បងសំឡេង (Audition)'}</span>
            </button>
          </div>
        </div>
      );
    }

    case 'demucs': {
      return (
        <div className="stage-settings-panel">
          <div className="stage-settings-section">
            <span className="stage-section-quiet-title">
              <Music size={13} color="#f59e0b" />
              <span>បំបែកសំឡេងដើម (Demucs AI Vocal Split)</span>
            </span>

            {/* Status Indicator */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
              <span style={{ fontSize: 12, color: '#94a3b8' }}>ស្ថានភាព BGM ដើម:</span>
              {isCleanBgReady ? (
                <span className="stage-glossary-badge" style={{ borderColor: 'rgba(34, 197, 94, 0.3)', color: '#86efac' }}>
                  <CheckCircle2 size={11} color="#22c55e" /> Clean BGM 100%
                </span>
              ) : isSeparatingAudio ? (
                <span className="stage-glossary-badge" style={{ borderColor: 'rgba(56, 189, 248, 0.3)', color: '#7dd3fc' }}>
                  <RefreshCw size={11} className="spin-icon" /> កំពុងបំបែក {separationProgress}%
                </span>
              ) : (
                <span className="stage-glossary-badge" style={{ borderColor: 'rgba(245, 158, 11, 0.3)', color: '#fcd34d' }}>
                  សំឡេងដើម (Raw Audio)
                </span>
              )}
            </div>

            {/* Progress Bar when running */}
            {isSeparatingAudio && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#38bdf8' }}>
                  <span>Demucs AI កំពុងកាត់សំឡេងចិន...</span>
                  <span>{separationProgress}%</span>
                </div>
                <div className="stage-progress-bar-bg">
                  <div className="stage-progress-bar-fill" style={{ width: `${Math.max(5, separationProgress)}%` }} />
                </div>
              </div>
            )}

            {/* Error / HTTP 409 alert banner */}
            {separationError && (
              <div className="stage-alert-banner stage-alert-warning" style={{ marginTop: 6 }}>
                <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                <div>
                  <strong style={{ display: 'block', marginBottom: 2 }}>ដំណឹងពីប្រព័ន្ធ (System Alert):</strong>
                  <span>{separationError}</span>
                </div>
              </div>
            )}

            {/* Main Action Buttons */}
            <div style={{ marginTop: 8 }}>
              {!isSeparatingAudio ? (
                <button
                  type="button"
                  className="stage-btn-primary"
                  onClick={onStartDemucsSeparation}
                  disabled={!selectedVideo || isSeparatingAudio}
                >
                  <Music size={13} />
                  <span>{isCleanBgReady ? 'បំបែកម្តងទៀត (Re-Separate Demucs)' : '✦ បំបែកសំឡេងដើម (Demucs AI)'}</span>
                </button>
              ) : (
                <button
                  type="button"
                  className="stage-btn-danger"
                  onClick={onKillDemucs}
                >
                  <Square size={13} />
                  <span>⏹ បញ្ឈប់ការបំបែក (Kill Demucs Process)</span>
                </button>
              )}
            </div>

            <div className="stage-alert-banner stage-alert-info" style={{ marginTop: 8 }}>
              <Info size={13} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>
                Demucs AI នឹងបំបែកសំឡេងនិយាយតួអង្គចិនចេញ ដោយរក្សាទុកភ្លេងកំដរ (BGM) និងសំឡេងបែបផែន (SFX) ដើមច្បាស់កម្រិត Studio។
              </span>
            </div>
          </div>
        </div>
      );
    }

    case 'mix-export': {
      const burnSubs = voiceSettings?.burnSubtitles !== false;
      const subStyle = voiceSettings?.subtitleStyle || 'banner';
      const aspectRatio = voiceSettings?.aspectRatio || '16:9';

      return (
        <div className="stage-settings-panel">
          <div className="stage-settings-section">
            <span className="stage-section-quiet-title">
              <Clapperboard size={13} color="#22c55e" />
              <span>ការកំណត់ Export (Video Render & Export)</span>
            </span>

            {/* Video Aspect Ratio */}
            <div className="stage-control-group" style={{ marginTop: 6 }}>
              <span className="stage-control-label">ទម្រង់វីដេអូ (Aspect Ratio)</span>
              <select
                className="stage-select"
                value={aspectRatio}
                onChange={(e) => handleSettingChange('aspectRatio', e.target.value)}
              >
                <option value="16:9">16:9 (Landscape — YouTube / TV)</option>
                <option value="9:16">9:16 (Vertical — TikTok / Reels / Shorts)</option>
                <option value="1:1">1:1 (Square — Facebook / Instagram)</option>
              </select>
            </div>

            {/* Subtitle Burn-In Toggle */}
            <div className="stage-control-group">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                <input
                  type="checkbox"
                  id="burn-subtitles-chk"
                  checked={burnSubs}
                  onChange={(e) => handleSettingChange('burnSubtitles', e.target.checked)}
                  style={{ accentColor: '#22c55e' }}
                />
                <label htmlFor="burn-subtitles-chk" style={{ fontSize: 12, color: '#f1f5f9', fontWeight: 500, cursor: 'pointer' }}>
                  ដុត Subtitle ខ្មែរចូលក្នុងវីដេអូ (Burn Subtitles)
                </label>
              </div>
            </div>

            {/* Subtitle Style */}
            {burnSubs && (
              <div className="stage-control-group">
                <span className="stage-control-label">ម៉ូដ Subtitle (Caption Box Style)</span>
                <select
                  className="stage-select"
                  value={subStyle}
                  onChange={(e) => handleSettingChange('subtitleStyle', e.target.value)}
                >
                  <option value="banner">⬛ Title Banner (ប្រអប់ខ្មៅ CapCut Style)</option>
                  <option value="pill">🏷️ CapCut Pill (ប្រអប់មូលថ្លា Modern)</option>
                  <option value="cinema">🎬 Cinema Soft (ស្រមោលអក្សរទន់)</option>
                </select>
              </div>
            )}

            {/* Rendering Progress display */}
            {isRendering && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#22c55e' }}>
                  <span>{renderStage || 'FFmpeg កំពុង Render វីដេអូ...'}</span>
                  <span>{renderProgress}%</span>
                </div>
                <div className="stage-progress-bar-bg">
                  <div
                    className="stage-progress-bar-fill"
                    style={{
                      width: `${Math.max(5, renderProgress)}%`,
                      background: 'linear-gradient(90deg, #22c55e, #10b981)',
                    }}
                  />
                </div>
              </div>
            )}

            {/* Primary Render Button */}
            <div style={{ marginTop: 8 }}>
              <button
                type="button"
                className="stage-btn-primary"
                style={{
                  background: 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)',
                  boxShadow: '0 2px 8px rgba(34, 197, 94, 0.35)',
                }}
                onClick={onRenderVideo}
                disabled={isRendering || !selectedVideo}
              >
                <Clapperboard size={14} color="#ffffff" />
                <span style={{ color: '#ffffff', fontWeight: 600 }}>
                  {isRendering ? 'កំពុង Render វីដេអូ...' : '✦ Render & Export Video'}
                </span>
              </button>
            </div>

            {renderedVideo && (
              <div className="stage-alert-banner stage-alert-success" style={{ marginTop: 8 }}>
                <CheckCircle2 size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>
                  វីដេអូ Render រួចរាល់! អ្នកអាចទស្សនានៅផ្ទាំង Monitor ឬ Download ទុកបាន។
                </span>
              </div>
            )}
          </div>
        </div>
      );
    }

    default:
      return null;
  }
}
