import React, { useState, useEffect } from 'react';
import {
  FileVideo, Subtitles, Mic, Music, Clapperboard,
  CheckCircle2, AlertTriangle, AlertCircle, Info, Sparkles,
  Play, Pause, RefreshCw, Square, Sliders, Layers, Volume2
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
          <div className="stage-settings-card">
            <h4 className="stage-settings-title">
              <FileVideo size={14} color="#38bdf8" />
              <span>ព័ត៌មានលម្អិតវីដេអូ (Video Metadata)</span>
            </h4>
            <div className="stage-meta-grid">
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

            <div className="stage-control-group" style={{ marginTop: 6 }}>
              <span className="stage-control-label">ភាគបច្ចុប្បន្ន (Active Episode)</span>
              <div className="stage-meta-item" style={{ background: '#090d16' }}>
                <span className="stage-meta-value" style={{ fontWeight: 600, color: '#38bdf8' }}>
                  {activeEpisode?.name || 'EP01'} — {activeSeries?.title || 'Chinese Drama'}
                </span>
              </div>
            </div>

            <div className="stage-alert-banner stage-alert-info">
              <Info size={14} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>
                អ្នកអាចជ្រើសរើស ឬទម្លាក់វីដេអូថ្មីនៅផ្ទាំង <strong>MEDIA</strong> ខាងឆ្វេង ដើម្បីចាប់ផ្តើមបំប្លែងរឿងភាគ។
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
          <div className="stage-settings-card">
            <h4 className="stage-settings-title">
              <Subtitles size={14} color="#a855f7" />
              <span>ការកំណត់ការបកប្រែ (Translation Config)</span>
            </h4>

            <div className="stage-control-group">
              <label className="stage-control-label">
                <span>ម៉ូដបកប្រែ (Dubbing Translation Mode)</span>
              </label>
              <select
                className="stage-select"
                value={voiceSettings?.translationMode || 'mode-a'}
                onChange={(e) => handleSettingChange('translationMode', e.target.value)}
              >
                <option value="mode-a">Mode A: Pure Dialogue Dubbing (បញ្ចូលសំឡេងតួអង្គសុទ្ធ)</option>
                <option value="mode-b">Mode B: Contextual Narration (បញ្ចូលសំឡេងរៀបរាប់ដំណើររឿង)</option>
              </select>
            </div>

            <div className="stage-control-group">
              <label className="stage-control-label">
                <span>Auto-Align ពេលវេលាសន្ទនា (Strict Timing Sync)</span>
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                <input
                  type="checkbox"
                  id="auto-align-timing-chk"
                  checked={voiceSettings?.autoAlignTimings !== false}
                  onChange={(e) => handleSettingChange('autoAlignTimings', e.target.checked)}
                  style={{ accentColor: '#38bdf8' }}
                />
                <label htmlFor="auto-align-timing-chk" style={{ fontSize: '0.76rem', color: '#cbd5e1', cursor: 'pointer' }}>
                  តម្រឹមម៉ោងកុំឱ្យជាន់គ្នា និងចងភ្ជាប់តាម Subtitle ដើម
                </label>
              </div>
            </div>

            <div className="stage-control-group" style={{ marginTop: 4 }}>
              <span className="stage-control-label">
                <span>តួអង្គក្នុងរឿង (Series Characters & Glossary)</span>
                <span className="stage-glossary-badge">{characters.length + terms.length} items</span>
              </span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 110, overflowY: 'auto', padding: 4 }}>
                {characters.length === 0 && terms.length === 0 ? (
                  <span style={{ fontSize: '0.72rem', color: '#64748b', fontStyle: 'italic' }}>
                    មិនទាន់មានឈ្មោះតួអង្គក្នុង Glossary នៅឡើយ
                  </span>
                ) : (
                  <>
                    {characters.map((c, i) => (
                      <span key={i} className="stage-glossary-badge" style={{ borderColor: '#818cf8', color: '#c7d2fe' }}>
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
          <div className="stage-settings-card">
            <h4 className="stage-settings-title">
              <Mic size={14} color="#38bdf8" />
              <span>ការកំណត់សំឡេង (Edge Khmer TTS)</span>
            </h4>

            <div className="stage-control-group">
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
                <span style={{ color: '#38bdf8', fontWeight: 700 }}>{speechRate.toFixed(2)}x</span>
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
                <span style={{ color: '#38bdf8', fontWeight: 700 }}>{Math.round(khmerVol * 100)}%</span>
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
                <span>Smart Ducking ភ្លេង BGM (ពេលមានសំឡេងខ្មែរ)</span>
                <span style={{ color: '#818cf8', fontWeight: 700 }}>{Math.round(duckingVol * 100)}%</span>
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
              style={{ background: '#1e293b', color: '#e2e8f0', border: '1px solid #334155', boxShadow: 'none' }}
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
          <div className="stage-settings-card">
            <h4 className="stage-settings-title">
              <Music size={14} color="#f59e0b" />
              <span>បំបែកសំឡេងដើម (Demucs AI Vocal Split)</span>
            </h4>

            {/* Status Indicator */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.74rem', color: '#94a3b8' }}>ស្ថានភាព BGM ដើម:</span>
              {isCleanBgReady ? (
                <span className="stage-glossary-badge" style={{ borderColor: 'rgba(34, 197, 94, 0.4)', color: '#86efac', background: 'rgba(34, 197, 94, 0.1)' }}>
                  <CheckCircle2 size={11} color="#22c55e" /> Clean BGM រួចរាល់ 100%
                </span>
              ) : isSeparatingAudio ? (
                <span className="stage-glossary-badge" style={{ borderColor: 'rgba(56, 189, 248, 0.4)', color: '#7dd3fc', background: 'rgba(56, 189, 248, 0.1)' }}>
                  <RefreshCw size={11} className="spin" /> កំពុងបំបែក {separationProgress}%
                </span>
              ) : (
                <span className="stage-glossary-badge" style={{ borderColor: 'rgba(245, 158, 11, 0.4)', color: '#fcd34d', background: 'rgba(245, 158, 11, 0.1)' }}>
                  <Volume2 size={11} color="#f59e0b" /> សំឡេងដើម (Raw Audio)
                </span>
              )}
            </div>

            {/* Progress Bar when running */}
            {isSeparatingAudio && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#38bdf8' }}>
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
              <div className="stage-alert-banner stage-alert-warning">
                <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 2 }} />
                <div>
                  <strong style={{ display: 'block', marginBottom: 2 }}>ដំណឹងពីប្រព័ន្ធ (System Alert):</strong>
                  <span>{separationError}</span>
                </div>
              </div>
            )}

            {/* Main Action Buttons */}
            {!isSeparatingAudio ? (
              <button
                type="button"
                className="stage-btn-primary"
                onClick={onStartDemucsSeparation}
                disabled={!selectedVideo || isSeparatingAudio}
              >
                <Music size={14} />
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

            <div className="stage-alert-banner stage-alert-info" style={{ marginTop: 4 }}>
              <Info size={13} style={{ flexShrink: 0, marginTop: 2 }} />
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
          <div className="stage-settings-card">
            <h4 className="stage-settings-title">
              <Clapperboard size={14} color="#22c55e" />
              <span>ការកំណត់ Render & Export (CapCut Pro Style)</span>
            </h4>

            {/* Video Aspect Ratio */}
            <div className="stage-control-group">
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
                <label htmlFor="burn-subtitles-chk" style={{ fontSize: '0.78rem', color: '#f1f5f9', fontWeight: 600, cursor: 'pointer' }}>
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
                  <option value="banner">⬛ Title Banner (ប្រអប់ខ្មៅស្អាត CapCut Pro - បាំង Sub ដើមបានល្អ)</option>
                  <option value="pill">🏷️ CapCut Pill (ប្រអប់មូលថ្លា Modern)</option>
                  <option value="cinema">🎬 Cinema Soft (ស្រមោលអក្សរទន់)</option>
                </select>
              </div>
            )}

            {/* Rendering Progress display */}
            {isRendering && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#22c55e' }}>
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
            <button
              type="button"
              className="stage-btn-primary"
              style={{
                background: 'linear-gradient(135deg, #22c55e 0%, #15803d 100%)',
                boxShadow: '0 2px 8px rgba(34, 197, 94, 0.35)',
                marginTop: 6
              }}
              onClick={onRenderVideo}
              disabled={isRendering || !selectedVideo}
            >
              <Clapperboard size={14} color="#ffffff" />
              <span style={{ color: '#ffffff', fontWeight: 700 }}>
                {isRendering ? 'កំពុង Render វីដេអូ...' : '✦ Render & Export Video'}
              </span>
            </button>

            {renderedVideo && (
              <div className="stage-alert-banner stage-alert-success" style={{ marginTop: 4 }}>
                <CheckCircle2 size={14} style={{ flexShrink: 0, marginTop: 2 }} />
                <span>
                  វីដេអូ Render រួចរាល់! អ្នកអាចទស្សនានៅផ្ទាំង Monitor កណ្តាល ឬ Download ទុកបាន។
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
