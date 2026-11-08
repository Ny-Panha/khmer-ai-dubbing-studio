import React from 'react';
import { Lock, Eye, EyeOff, Volume2, VolumeX } from 'lucide-react';

export default function TimelineTrackHeaders({
  lockedTracks,
  setLockedTracks,
  hiddenTracks,
  setHiddenTracks,
  mutedTracks,
  setMutedTracks,
  audioGenerated,
  videoRowCount = 1,
  voiceRowCount = 1,
  subRowCount = 1,
  showSubtitles = true,
  selectedVideo = null,
  scriptSegments = [],
}) {
  const showVoice = audioGenerated || (scriptSegments && scriptSegments.length > 0);

  return (
    <div className="track-headers-column">
      <div className="track-header ruler-header">
        <span className="ruler-header-title">TRACKS</span>
      </div>

      {/* Multi-Track Video Headers (Height: 60px) */}
      {Array.from({ length: Math.max(1, videoRowCount) }).map((_, rIdx) => {
        const trackKey = `video_${rIdx}`;
        const trackLabel = videoRowCount > 1 ? `VIDEO ${rIdx + 1}` : 'VIDEO';
        const isLocked = Boolean(lockedTracks[trackKey] || (rIdx === 0 && lockedTracks.video));
        const isMuted = Boolean(mutedTracks[trackKey] || (rIdx === 0 && mutedTracks.video));

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
                onClick={() => setMutedTracks(p => ({ ...p, [trackKey]: !isMuted, ...(rIdx === 0 ? { video: !isMuted } : {}) }))}
                title={isMuted ? `Unmute ${trackLabel}` : `Mute ${trackLabel}`}
              >
                {isMuted ? <VolumeX size={10} /> : <Volume2 size={10} />}
              </button>
              <button 
                type="button" 
                className={`track-ctrl-mini-btn ${isLocked ? 'is-active-lock' : ''}`}
                onClick={() => setLockedTracks(p => ({ ...p, [trackKey]: !isLocked, ...(rIdx === 0 ? { video: !isLocked } : {}) }))}
                title={isLocked ? `Unlock ${trackLabel}` : `Lock ${trackLabel}`}
              >
                <Lock size={10} />
              </button>
            </div>
          </div>
        );
      })}

      {/* Khmer AI Voice Tracks (Height: 48px) */}
      {showVoice && Array.from({ length: Math.min(2, Math.max(1, voiceRowCount)) }).map((_, rIdx) => {
        const trackKey = `voice_${rIdx}`;
        const trackLabel = `VOICE ${rIdx + 1}`;
        const isLocked = Boolean(lockedTracks[trackKey] || (rIdx === 0 && lockedTracks.voice));
        const isMuted = Boolean(mutedTracks[trackKey] || (rIdx === 0 && mutedTracks.voice));

        return (
          <div 
            key={trackKey}
            className="track-header voice-track-hdr" 
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
                onClick={() => setMutedTracks(p => ({ 
                  ...p, 
                  [trackKey]: !isMuted, 
                  ...(rIdx === 0 ? { voice: !isMuted } : {}) 
                }))}
                title={isMuted ? `Unmute ${trackLabel}` : `Mute ${trackLabel}`}
              >
                {isMuted ? <VolumeX size={10} /> : <Volume2 size={10} />}
              </button>
              <button 
                type="button" 
                className={`track-ctrl-mini-btn ${isLocked ? 'is-active-lock' : ''}`}
                onClick={() => setLockedTracks(p => ({ 
                  ...p, 
                  [trackKey]: !isLocked, 
                  ...(rIdx === 0 ? { voice: !isLocked } : {}) 
                }))}
                title={isLocked ? `Unlock ${trackLabel}` : `Lock ${trackLabel}`}
              >
                <Lock size={10} />
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
                onClick={() => setHiddenTracks(p => ({ 
                  ...p, 
                  [trackKey]: !isHidden, 
                  ...(rIdx === 0 ? { subs: !isHidden } : {}) 
                }))}
                title={isHidden ? `Show ${trackLabel}` : `Hide ${trackLabel}`}
              >
                {isHidden ? <EyeOff size={10} /> : <Eye size={10} />}
              </button>
              <button 
                type="button" 
                className={`track-ctrl-mini-btn ${isLocked ? 'is-active-lock' : ''}`}
                onClick={() => setLockedTracks(p => ({ 
                  ...p, 
                  [trackKey]: !isLocked, 
                  ...(rIdx === 0 ? { subs: !isLocked } : {}) 
                }))}
                title={isLocked ? `Unlock ${trackLabel}` : `Lock ${trackLabel}`}
              >
                <Lock size={10} />
              </button>
            </div>
          </div>
        );
      })}

      {/* Clean BGM Track (Height: 40px) */}
      {selectedVideo && (
        <div className="track-header clean-bgm-track-hdr">
          <div className="track-title-box">
            <span className="track-title-text" title="CLEAN BGM">
              CLEAN BGM
            </span>
          </div>
          <div className="track-mini-icons">
            <button 
              type="button" 
              className={`track-ctrl-mini-btn ${mutedTracks.cleanBgm ? 'is-active-mute' : ''}`}
              onClick={() => setMutedTracks(p => ({ ...p, cleanBgm: !p.cleanBgm }))}
              title={mutedTracks.cleanBgm ? "Unmute CLEAN BGM" : "Mute CLEAN BGM"}
            >
              {mutedTracks.cleanBgm ? <VolumeX size={10} /> : <Volume2 size={10} />}
            </button>
            <button 
              type="button" 
              className={`track-ctrl-mini-btn ${lockedTracks.cleanBgm ? 'is-active-lock' : ''}`}
              onClick={() => setLockedTracks(p => ({ ...p, cleanBgm: !p.cleanBgm }))}
              title={lockedTracks.cleanBgm ? "Unlock CLEAN BGM" : "Lock CLEAN BGM"}
            >
              <Lock size={10} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
