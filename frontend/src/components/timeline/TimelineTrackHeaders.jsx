import React from 'react';
import { Film, Mic, Subtitles, Lock, Eye, EyeOff, Volume2, VolumeX } from 'lucide-react';

const VOICE_COLORS = ['#34d399', '#38bdf8', '#f472b6', '#fbbf24', '#a78bfa', '#f87171', '#38bdf8', '#c084fc'];
const SUB_COLORS = ['#818CF8', '#6366F1', '#A5B4FC', '#4F46E5', '#818CF8'];

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
  onAddTrack = null,
}) {
  return (
    <div className="track-headers-column">
      <div className="track-header ruler-header">
        <span className="ruler-header-title">TRACKS</span>
      </div>

      {/* Multi-Track Video Headers */}
      {Array.from({ length: Math.max(1, videoRowCount) }).map((_, rIdx) => {
        const trackKey = `video_${rIdx}`;
        const trackLabel = videoRowCount === 1 ? 'VIDEO' : (rIdx === 0 ? 'VIDEO 1' : `VIDEO ${rIdx + 1}`);
        const trackBadge = videoRowCount === 1 ? 'V1' : `V${rIdx + 1}`;
        const isLocked = Boolean(lockedTracks[trackKey] || (rIdx === 0 && lockedTracks.video));
        const isHidden = Boolean(hiddenTracks[trackKey] || (rIdx === 0 && hiddenTracks.video));
        const isMuted = Boolean(mutedTracks[trackKey] || (rIdx === 0 && mutedTracks.video));

        return (
          <div 
            key={`video-header-${rIdx}`} 
            className={`track-header video-track-hdr ${rIdx > 0 ? 'video-track-hdr-sub' : ''}`}
          >
            <div className="track-title-box">
              <span className="track-badge-tag tag-video">{trackBadge}</span>
              <Film size={12} className="track-icon-cyan" title={`Video Track ${trackLabel}`} />
              <span className="track-title-text track-title-cyan">
                {trackLabel}
              </span>
            </div>
            <div className="track-mini-icons">
              <button 
                type="button" 
                className={`track-ctrl-mini-btn ${isLocked ? 'is-active-lock' : ''}`}
                onClick={() => setLockedTracks(p => ({ ...p, [trackKey]: !isLocked, ...(rIdx === 0 ? { video: !isLocked } : {}) }))}
                title={isLocked ? `Unlock Video Track ${trackLabel}` : `Lock Video Track ${trackLabel}`}
              >
                <Lock size={11} />
              </button>
              <button 
                type="button" 
                className={`track-ctrl-mini-btn ${isHidden ? 'is-active-hide' : ''}`}
                onClick={() => setHiddenTracks(p => ({ ...p, [trackKey]: !isHidden, ...(rIdx === 0 ? { video: !isHidden } : {}) }))}
                title={isHidden ? `Show Video Track ${trackLabel}` : `Hide Video Track ${trackLabel}`}
              >
                {isHidden ? <EyeOff size={11} /> : <Eye size={11} />}
              </button>
              <button 
                type="button" 
                className={`track-ctrl-mini-btn ${isMuted ? 'is-active-mute' : ''}`}
                onClick={() => setMutedTracks(p => ({ ...p, [trackKey]: !isMuted, ...(rIdx === 0 ? { video: !isMuted } : {}) }))}
                title={isMuted ? `Unmute Video Track ${trackLabel}` : `Mute Video Track ${trackLabel}`}
              >
                {isMuted ? <VolumeX size={11} /> : <Volume2 size={11} />}
              </button>
            </div>
          </div>
        );
      })}

      {/* Khmer AI Voice Tracks */}
      {audioGenerated && Array.from({ length: voiceRowCount }).map((_, rIdx) => {
        const trackKey = `voice_${rIdx}`;
        const trackLabel = voiceRowCount === 1 ? 'VOICE' : (rIdx === 0 ? 'VOICE 1' : `VOICE ${rIdx + 1}`);
        const trackBadge = voiceRowCount === 1 ? 'A1' : `A${rIdx + 1}`;
        const accentColor = VOICE_COLORS[rIdx % VOICE_COLORS.length];
        const isLocked = Boolean(lockedTracks[trackKey] || (rIdx === 0 && lockedTracks.voice));
        const isHidden = Boolean(hiddenTracks[trackKey] || (rIdx === 0 && hiddenTracks.voice));
        const isMuted = Boolean(mutedTracks[trackKey] || (rIdx === 0 && mutedTracks.voice));

        return (
          <div 
            key={trackKey}
            className={`track-header voice-track-hdr ${rIdx > 0 ? 'voice-track-hdr-sub' : ''}`} 
          >
            <div className="track-title-box">
              <span className="track-badge-tag tag-voice">{trackBadge}</span>
              <Mic size={12} style={{ color: accentColor }} title={`Voice Track ${trackLabel}`} />
              <span className="track-title-text" style={{ color: accentColor }}>
                {trackLabel}
              </span>
            </div>
            <div className="track-mini-icons">
              <button 
                type="button" 
                className={`track-ctrl-mini-btn ${isLocked ? 'is-active-lock' : ''}`}
                onClick={() => setLockedTracks(p => ({ 
                  ...p, 
                  [trackKey]: !isLocked, 
                  ...(rIdx === 0 ? { voice: !isLocked } : {}) 
                }))}
                title={isLocked ? `Unlock Voice Track ${trackLabel}` : `Lock Voice Track ${trackLabel}`}
              >
                <Lock size={11} />
              </button>
              <button 
                type="button" 
                className={`track-ctrl-mini-btn ${isHidden ? 'is-active-hide' : ''}`}
                onClick={() => setHiddenTracks(p => ({ 
                  ...p, 
                  [trackKey]: !isHidden, 
                  ...(rIdx === 0 ? { voice: !isHidden } : {}) 
                }))}
                title={isHidden ? `Show Voice Track ${trackLabel}` : `Hide Voice Track ${trackLabel}`}
              >
                {isHidden ? <EyeOff size={11} /> : <Eye size={11} />}
              </button>
              <button 
                type="button" 
                className={`track-ctrl-mini-btn ${isMuted ? 'is-active-mute' : ''}`}
                onClick={() => setMutedTracks(p => ({ 
                  ...p, 
                  [trackKey]: !isMuted, 
                  ...(rIdx === 0 ? { voice: !isMuted } : {}) 
                }))}
                title={isMuted ? `Unmute Voice Track ${trackLabel}` : `Mute Voice Track ${trackLabel}`}
              >
                {isMuted ? <VolumeX size={11} /> : <Volume2 size={11} />}
              </button>
            </div>
          </div>
        );
      })}

      {/* Subtitles Tracks */}
      {showSubtitles && Array.from({ length: subRowCount }).map((_, rIdx) => {
        const trackKey = `subs_${rIdx}`;
        const trackLabel = subRowCount === 1 ? 'SUBTITLES' : (rIdx === 0 ? 'SUBTITLES 1' : `SUBTITLES ${rIdx + 1}`);
        const trackBadge = subRowCount === 1 ? 'CC' : `CC${rIdx + 1}`;
        const accentColor = SUB_COLORS[rIdx % SUB_COLORS.length];
        const isLocked = Boolean(lockedTracks[trackKey] || (rIdx === 0 && lockedTracks.subs));
        const isHidden = Boolean(hiddenTracks[trackKey] || (rIdx === 0 && hiddenTracks.subs));
        const isMuted = Boolean(mutedTracks[trackKey] || (rIdx === 0 && mutedTracks.subs));

        return (
          <div 
            key={trackKey}
            className={`track-header sub-track-hdr ${rIdx > 0 ? 'sub-track-hdr-sub' : ''}`} 
          >
            <div className="track-title-box">
              <span className="track-badge-tag tag-sub">{trackBadge}</span>
              <Subtitles size={12} style={{ color: accentColor }} title={`Subtitles Track ${trackLabel}`} />
              <span className="track-title-text" style={{ color: accentColor }}>
                {trackLabel}
              </span>
            </div>
            <div className="track-mini-icons">
              <button 
                type="button" 
                className={`track-ctrl-mini-btn ${isLocked ? 'is-active-lock' : ''}`}
                onClick={() => setLockedTracks(p => ({ 
                  ...p, 
                  [trackKey]: !isLocked, 
                  ...(rIdx === 0 ? { subs: !isLocked } : {}) 
                }))}
                title={isLocked ? `Unlock Subtitles Track ${trackLabel}` : `Lock Subtitles Track ${trackLabel}`}
              >
                <Lock size={11} />
              </button>
              <button 
                type="button" 
                className={`track-ctrl-mini-btn ${isHidden ? 'is-active-hide' : ''}`}
                onClick={() => setHiddenTracks(p => ({ 
                  ...p, 
                  [trackKey]: !isHidden, 
                  ...(rIdx === 0 ? { subs: !isHidden } : {}) 
                }))}
                title={isHidden ? `Show Subtitles Track ${trackLabel}` : `Hide Subtitles Track ${trackLabel}`}
              >
                {isHidden ? <EyeOff size={11} /> : <Eye size={11} />}
              </button>
              <button 
                type="button" 
                className={`track-ctrl-mini-btn ${isMuted ? 'is-active-mute' : ''}`}
                onClick={() => setMutedTracks(p => ({ 
                  ...p, 
                  [trackKey]: !isMuted, 
                  ...(rIdx === 0 ? { subs: !isMuted } : {}) 
                }))}
                title={isMuted ? `Unmute Subtitles Track ${trackLabel}` : `Mute Subtitles Track ${trackLabel}`}
              >
                {isMuted ? <VolumeX size={11} /> : <Volume2 size={11} />}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
