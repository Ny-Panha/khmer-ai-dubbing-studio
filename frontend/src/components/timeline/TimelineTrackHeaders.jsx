import React from 'react';
import { Lock, Eye, EyeOff, Volume2, VolumeX } from 'lucide-react';

export default function TimelineTrackHeaders({
  lockedTracks,
  setLockedTracks,
  hiddenTracks,
  setHiddenTracks,
  mutedTracks,
  setMutedTracks,
  soloTracks = {},
  setSoloTracks = null,
  audioGenerated,
  videoRowCount = 1,
  voiceRowCount = 1,
  subRowCount = 1,
  showSubtitles = true,
  selectedVideo = null,
  scriptSegments = [],
  videoClips = [],
  onToggleMuteAllCuts = null,
  voiceSettings = null,
  onUpdateVoiceSettings = null,
}) {
  // Dynamic Unlimited Voice Lanes: Always render headers for all available/empty voice lanes
  const effectiveVoiceRowCount = Math.max(2, voiceRowCount || 2);

  // Compute VIDEO 1 clip mute state
  const dialogueClips = Array.isArray(videoClips) ? videoClips.filter((c) => c.isDialogue) : [];
  const targetVideoClips = dialogueClips.length > 0 ? dialogueClips : (Array.isArray(videoClips) ? videoClips : []);
  const areAllCutsMuted = targetVideoClips.length > 0 && targetVideoClips.every((c) => Boolean(c.isMuted));

  // Compute CLEAN BGM mute state (two-way synced with voiceSettings.duckingVolume === 0)
  const isBgmMuted = Boolean(
    mutedTracks?.cleanBgm || (voiceSettings && typeof voiceSettings.duckingVolume === 'number' && voiceSettings.duckingVolume === 0)
  );

  const handleToggleVideoMute = (rIdx, trackKey, currentlyMuted) => {
    const nextMuted = !currentlyMuted;
    setMutedTracks((p) => ({
      ...p,
      [trackKey]: nextMuted,
      ...(rIdx === 0 ? { video: nextMuted } : {}),
    }));
    if (rIdx === 0 && typeof onToggleMuteAllCuts === 'function') {
      onToggleMuteAllCuts(true);
    }
  };

  const handleToggleCleanBgmMute = () => {
    const nextMuted = !isBgmMuted;
    setMutedTracks((p) => ({ ...p, cleanBgm: nextMuted }));
    if (voiceSettings && typeof onUpdateVoiceSettings === 'function') {
      onUpdateVoiceSettings({
        ...voiceSettings,
        duckingVolume: isBgmMuted ? 0.15 : 0,
      });
    }
  };

  return (
    <div className="track-headers-column capcut-track-headers">
      <div className="track-header ruler-header">
        <span className="ruler-header-title">TRACKS</span>
      </div>

      {/* Multi-Track Video Headers (Height: 60px) */}
      {Array.from({ length: Math.max(1, videoRowCount) }).map((_, rIdx) => {
        const trackKey = `video_${rIdx}`;
        const trackLabel = videoRowCount > 1 ? `VIDEO ${rIdx + 1}` : 'VIDEO 1';
        const isLocked = Boolean(lockedTracks[trackKey] || (rIdx === 0 && lockedTracks.video));
        const isMuted = Boolean(
          mutedTracks[trackKey] ||
          (rIdx === 0 && mutedTracks.video)
        );
        const isSolo = Boolean(soloTracks[trackKey] || (rIdx === 0 && soloTracks.video));

        return (
          <div
            key={`video-header-${rIdx}`}
            className="track-header video-track-hdr"
          >
            <div className="track-title-box">
              <span className="track-title-text" title={trackLabel}>
                {trackLabel}
              </span>
            </div>
            <div className="track-mini-icons">
              <button
                type="button"
                className={`track-ctrl-mini-btn ${isMuted ? 'is-active-mute' : ''}`}
                onClick={() => handleToggleVideoMute(rIdx, trackKey, isMuted)}
                title={isMuted ? `Unmute ${trackLabel} (M)` : `Mute ${trackLabel} (M)`}
              >
                {isMuted ? <VolumeX size={11} /> : <Volume2 size={11} />}
              </button>
              {setSoloTracks && (
                <button
                  type="button"
                  className={`track-ctrl-mini-btn ${isSolo ? 'is-active-solo' : ''}`}
                  onClick={() => setSoloTracks((p) => ({ ...p, [trackKey]: !isSolo, ...(rIdx === 0 ? { video: !isSolo } : {}) }))}
                  title={isSolo ? `Unsolo ${trackLabel} (S)` : `Solo ${trackLabel} (S)`}
                  style={{ fontSize: '9px', fontWeight: 800, color: isSolo ? '#F59E0B' : undefined }}
                >
                  S
                </button>
              )}
              <button
                type="button"
                className={`track-ctrl-mini-btn ${isLocked ? 'is-active-lock' : ''}`}
                onClick={() => setLockedTracks((p) => ({ ...p, [trackKey]: !isLocked, ...(rIdx === 0 ? { video: !isLocked } : {}) }))}
                title={isLocked ? `Unlock ${trackLabel}` : `Lock ${trackLabel}`}
              >
                <Lock size={11} />
              </button>
            </div>
          </div>
        );
      })}

      {/* Khmer AI Voice Tracks (Height: 48px) */}
      {Array.from({ length: effectiveVoiceRowCount }).map((_, rIdx) => {
        const trackKey = `voice_${rIdx}`;
        const trackLabel = `VOICE ${rIdx + 1}`;
        const voiceSubBadge = rIdx === 0 ? '👨/គោល' : (rIdx === 1 ? '👩/បន្ទាប់' : `A${rIdx + 1}`);
        const isLocked = Boolean(lockedTracks[trackKey] || (rIdx === 0 && lockedTracks.voice));
        const isMuted = Boolean(mutedTracks[trackKey] || (rIdx === 0 && mutedTracks.voice));
        const isSolo = Boolean(soloTracks[trackKey] || (rIdx === 0 && soloTracks.voice));

        return (
          <div
            key={trackKey}
            className={`track-header voice-track-hdr ${rIdx === 1 ? 'voice-track-secondary' : ''}`}
          >
            <div className="track-title-box">
              <span className="track-title-text" title={`KHMER ${trackLabel} (${voiceSubBadge})`}>
                {trackLabel}
              </span>
              <span className="track-sub-badge">{voiceSubBadge}</span>
            </div>
            <div className="track-mini-icons">
              <button
                type="button"
                className={`track-ctrl-mini-btn ${isMuted ? 'is-active-mute' : ''}`}
                onClick={() => setMutedTracks((p) => ({
                  ...p,
                  [trackKey]: !isMuted,
                  ...(rIdx === 0 ? { voice: !isMuted } : {}),
                }))}
                title={isMuted ? `Unmute ${trackLabel} (M)` : `Mute ${trackLabel} (M)`}
              >
                {isMuted ? <VolumeX size={11} /> : <Volume2 size={11} />}
              </button>
              {setSoloTracks && (
                <button
                  type="button"
                  className={`track-ctrl-mini-btn ${isSolo ? 'is-active-solo' : ''}`}
                  onClick={() => setSoloTracks((p) => ({
                    ...p,
                    [trackKey]: !isSolo,
                    ...(rIdx === 0 ? { voice: !isSolo } : {}),
                  }))}
                  title={isSolo ? `Unsolo ${trackLabel} (S)` : `Solo ${trackLabel} (S)`}
                  style={{ fontSize: '9px', fontWeight: 800, color: isSolo ? '#F59E0B' : undefined }}
                >
                  S
                </button>
              )}
              <button
                type="button"
                className={`track-ctrl-mini-btn ${isLocked ? 'is-active-lock' : ''}`}
                onClick={() => setLockedTracks((p) => ({
                  ...p,
                  [trackKey]: !isLocked,
                  ...(rIdx === 0 ? { voice: !isLocked } : {}),
                }))}
                title={isLocked ? `Unlock ${trackLabel}` : `Lock ${trackLabel}`}
              >
                <Lock size={11} />
              </button>
            </div>
          </div>
        );
      })}

      {/* Subtitles Tracks (Height: 48px) */}
      {showSubtitles && Array.from({ length: Math.max(1, subRowCount) }).map((_, rIdx) => {
        const trackKey = `subs_${rIdx}`;
        const trackLabel = subRowCount > 1 ? `SUBTITLES ${rIdx + 1}` : 'SUBTITLES';
        const isLocked = Boolean(lockedTracks[trackKey] || (rIdx === 0 && lockedTracks.subs));
        const isHidden = Boolean(hiddenTracks[trackKey] || (rIdx === 0 && hiddenTracks.subs));

        return (
          <div
            key={trackKey}
            className="track-header sub-track-hdr"
          >
            <div className="track-title-box">
              <span className="track-title-text" title={trackLabel}>
                {trackLabel}
              </span>
            </div>
            <div className="track-mini-icons">
              <button
                type="button"
                className={`track-ctrl-mini-btn ${isHidden ? 'is-active-hide' : ''}`}
                onClick={() => setHiddenTracks((p) => ({
                  ...p,
                  [trackKey]: !isHidden,
                  ...(rIdx === 0 ? { subs: !isHidden } : {}),
                }))}
                title={isHidden ? `Show ${trackLabel}` : `Hide ${trackLabel}`}
              >
                {isHidden ? <EyeOff size={11} /> : <Eye size={11} />}
              </button>
              <button
                type="button"
                className={`track-ctrl-mini-btn ${isLocked ? 'is-active-lock' : ''}`}
                onClick={() => setLockedTracks((p) => ({
                  ...p,
                  [trackKey]: !isLocked,
                  ...(rIdx === 0 ? { subs: !isLocked } : {}),
                }))}
                title={isLocked ? `Unlock ${trackLabel}` : `Lock ${trackLabel}`}
              >
                <Lock size={11} />
              </button>
            </div>
          </div>
        );
      })}

      {/* Clean BGM Track (Height: 40px) */}
      <div className="track-header clean-bgm-track-hdr">
        <div className="track-title-box">
          <span className="track-title-text" title="CLEAN BGM">
            CLEAN BGM
          </span>
        </div>
        <div className="track-mini-icons">
          <button
            type="button"
            className={`track-ctrl-mini-btn ${isBgmMuted ? 'is-active-mute' : ''}`}
            onClick={handleToggleCleanBgmMute}
            title={isBgmMuted ? 'Unmute CLEAN BGM (M)' : 'Mute CLEAN BGM (M)'}
          >
            {isBgmMuted ? <VolumeX size={11} /> : <Volume2 size={11} />}
          </button>
          {setSoloTracks && (
            <button
              type="button"
              className={`track-ctrl-mini-btn ${soloTracks.cleanBgm ? 'is-active-solo' : ''}`}
              onClick={() => setSoloTracks((p) => ({ ...p, cleanBgm: !p.cleanBgm }))}
              title={soloTracks.cleanBgm ? 'Unsolo CLEAN BGM (S)' : 'Solo CLEAN BGM (S)'}
              style={{ fontSize: '9px', fontWeight: 800, color: soloTracks.cleanBgm ? '#F59E0B' : undefined }}
            >
              S
            </button>
          )}
          <button
            type="button"
            className={`track-ctrl-mini-btn ${lockedTracks.cleanBgm ? 'is-active-lock' : ''}`}
            onClick={() => setLockedTracks((p) => ({ ...p, cleanBgm: !p.cleanBgm }))}
            title={lockedTracks.cleanBgm ? 'Unlock CLEAN BGM' : 'Lock CLEAN BGM'}
          >
            <Lock size={11} />
          </button>
        </div>
      </div>
    </div>
  );
}
