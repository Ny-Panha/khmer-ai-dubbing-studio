import React, { useState, useRef, useEffect } from 'react';
import { Video, Upload, Loader2, AlertCircle } from 'lucide-react';
import { parseTimeToSeconds } from '../utils/formatTime';
import { mapSourceToTimelineTime } from '../utils/timelineUtils';
import { uploadVideoFile } from '../services/api';
import { createAudioRecoveryManager } from '../utils/audioAutoRecovery';

import { PlayerTopBar, PlayerBottomBar } from './player/PlayerControls';
import SafeZonesGuide from './player/SafeZonesGuide';
import LiveSubtitleOverlay from './player/LiveSubtitleOverlay';
import AntiTheftOverlay from './player/AntiTheftOverlay';
import LogoOverlay from './player/LogoOverlay';
import './VideoPlayerPreview.css';

export default function VideoPlayerPreview({
  selectedVideo,
  seriesId,
  episodeId,
  scriptData,
  renderedVideo,
  setRenderedVideo = null,
  isRendering,
  onRenderVideo,
  videoRef,
  currentTime,
  duration,
  isPlaying = false,
  onPlayPause,
  onSeek,
  onTimeUpdate,
  onLoadedMetadata,
  voiceSettings = {},
  onEnded,
  fullAudioUrl = null,
  audioGenerated = false,
  audioOutdated = false,
  onImportClick,
  onVideoSelected,
  videoClips = [],
}) {
  const [aspectRatio, setAspectRatio] = useState('original');
  const [zoomScale, setZoomScale] = useState('fit');
  const [showSafeZones, setShowSafeZones] = useState(false);
  const [videoMeta, setVideoMeta] = useState({ width: 0, height: 0, ratio: 1 });
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const containerRef = useRef(null);
  const narrationAudioRef = useRef(null);
  const fileInputRef = useRef(null);
  const activeSegmentAudiosRef = useRef({});
  const segmentAudioPoolRef = useRef({});
  const isPlayPendingRef = useRef(false);

  // BUG-013: Bounded Audio Auto-Recovery State & Manager
  const [narrationError, setNarrationError] = useState(null);
  const recoveryManagerRef = useRef(null);
  if (!recoveryManagerRef.current) {
    recoveryManagerRef.current = createAudioRecoveryManager({
      onTerminalError: (err) => {
        setNarrationError(err);
      },
      onRetryScheduled: ({ attempt, maxAttempts, delayMs, reason }) => {
        console.warn(`[NarrationAutoRecovery] Scheduling retry #${attempt}/${maxAttempts} in ${delayMs}ms (${reason})`);
      },
      onSuccess: () => {
        setNarrationError(null);
      },
    });
  }

  const hasSegmentAudios = Boolean(
    !renderedVideo &&
    (!audioGenerated || !fullAudioUrl) &&
    scriptData?.segments?.some(s => s.audioUrl || s.audioFile || s.audioPath)
  );

  const stopAllSegmentAudios = () => {
    Object.keys(activeSegmentAudiosRef.current).forEach((key) => {
      const item = activeSegmentAudiosRef.current[key];
      if (item?.audio && !item.audio.paused) {
        item.audio.pause();
      }
    });
    activeSegmentAudiosRef.current = {};
  };

  const getSegmentAudio = (url) => {
    if (!url) return null;
    let audio = segmentAudioPoolRef.current[url];
    if (!audio) {
      audio = new Audio(url);
      audio.preload = 'none'; // Lazy-load only on actual playback to prevent saturating browser connections
      if ('preservesPitch' in audio) audio.preservesPitch = true;
      if ('mozPreservesPitch' in audio) audio.mozPreservesPitch = true;
      if ('webkitPreservesPitch' in audio) audio.webkitPreservesPitch = true;
      segmentAudioPoolRef.current[url] = audio;
    }
    return audio;
  };

  // Preload on-demand: only preload the immediate upcoming 3 segments near playhead
  useEffect(() => {
    if (!hasSegmentAudios || !scriptData?.segments || scriptData.segments.length === 0) return;
    const now = currentTimeRef.current || 0;
    const upcoming = scriptData.segments
      .filter((seg) => {
        const s = (typeof seg.audioStartSec === 'number' && !isNaN(seg.audioStartSec)) ? seg.audioStartSec : (seg.startSec || 0);
        return s >= now && s <= now + 12;
      })
      .slice(0, 3);

    upcoming.forEach((seg) => {
      const rawUrl = seg.audioUrl || (seg.audioPath ? `/uploads/${seg.audioPath.replace(/\\/g, '/').replace(/^.*uploads\//, '')}` : null);
      if (rawUrl) {
        getSegmentAudio(rawUrl);
      }
    });
  }, [hasSegmentAudios, scriptData?.segments]);

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadError(null);

    try {
      const vidObj = await uploadVideoFile(file, { seriesId, episodeId });
      if (onVideoSelected) {
        onVideoSelected(vidObj);
      }
    } catch (err) {
      console.error('Video upload failed:', err);
      setUploadError(err.message || 'Video upload failed');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const triggerFileInput = () => {
    if (isUploading) return;
    if (fileInputRef.current) {
      fileInputRef.current.click();
    } else if (onImportClick) {
      onImportClick();
    }
  };

  const currentTimeRef = useRef(currentTime);
  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  // Stop audio and reset playback state cleanly when switching episodes or projects
  useEffect(() => {
    isPlayPendingRef.current = false;
    stopAllSegmentAudios();
    if (recoveryManagerRef.current) {
      recoveryManagerRef.current.cancelPending();
    }
    if (narrationAudioRef.current) {
      if (!narrationAudioRef.current.paused) narrationAudioRef.current.pause();
      narrationAudioRef.current.playbackRate = 1.0;
    }
  }, [episodeId, seriesId]);

  // Component unmount: cancel all pending recovery timers & network checks
  useEffect(() => {
    return () => {
      if (recoveryManagerRef.current) {
        recoveryManagerRef.current.cancelPending();
      }
    };
  }, []);

  // Reload narration audio buffer and reset retry attempts whenever master narration URL changes
  useEffect(() => {
    if (recoveryManagerRef.current) {
      recoveryManagerRef.current.reset(fullAudioUrl);
    }
    if (narrationAudioRef.current && fullAudioUrl) {
      try {
        const savedTime = currentTimeRef.current;
        narrationAudioRef.current.load();
        if (Number.isFinite(savedTime)) {
          narrationAudioRef.current.currentTime = savedTime;
        }
      } catch (err) {
        console.warn('[TimelineSync] Narration audio reload notice:', err);
      }
    }
  }, [fullAudioUrl]);

  // 🎙️ Real-time Segment-by-Segment Dubbing Playback (0-latency instant preview on drag/move)
  useEffect(() => {
    if (renderedVideo || !hasSegmentAudios) {
      stopAllSegmentAudios();
      return;
    }

    if (!isPlaying) {
      stopAllSegmentAudios();
      return;
    }

    // Pause master narration audio to prevent double-audio/echo
    if (narrationAudioRef.current && !narrationAudioRef.current.paused) {
      narrationAudioRef.current.pause();
    }

    const v = videoRef?.current;
    const currentRate = v?.playbackRate || 1.0;
    const khmerVal = voiceSettings.khmerVolume !== undefined ? Number(voiceSettings.khmerVolume) : 1.0;
    const isKhmerMuted = khmerVal <= 0.01;
    const targetVol = isKhmerMuted ? 0 : Math.min(1.0, Math.max(0, khmerVal));

    const now = currentTime;
    const segments = scriptData?.segments || [];

    // High-performance window filter: only inspect segments within active 6s window of now
    const nearbySegs = segments.map((seg, idx) => ({ seg, idx })).filter(({ seg }) => {
      if (seg.muted || seg.isMuted) return false;
      const s = (typeof seg.audioStartSec === 'number' && !isNaN(seg.audioStartSec)) ? seg.audioStartSec : (seg.startSec || 0);
      const d = (typeof seg.audioDurationSec === 'number' && !isNaN(seg.audioDurationSec)) ? seg.audioDurationSec : 2.5;
      const e = (typeof seg.audioEndSec === 'number' && !isNaN(seg.audioEndSec)) ? seg.audioEndSec : (s + d);
      return now >= (s - 0.2) && now < (e + 0.2);
    });

    // Cleanup active audios no longer in window
    Object.keys(activeSegmentAudiosRef.current).forEach((k) => {
      if (!nearbySegs.some(({ seg, idx }) => String(seg._uid || (seg.id !== undefined && seg.id !== null ? seg.id : idx)) === k)) {
        const item = activeSegmentAudiosRef.current[k];
        if (item?.audio && !item.audio.paused) item.audio.pause();
        delete activeSegmentAudiosRef.current[k];
      }
    });

    nearbySegs.forEach(({ seg, idx }) => {
      const segKey = seg._uid || (seg.id !== undefined && seg.id !== null ? seg.id : idx);
      if (seg.muted || seg.isMuted) {
        if (activeSegmentAudiosRef.current[segKey]) {
          activeSegmentAudiosRef.current[segKey].audio.pause();
          delete activeSegmentAudiosRef.current[segKey];
        }
        return;
      }

      const rawUrl = seg.audioUrl || (seg.audioPath ? `/uploads/${seg.audioPath.replace(/\\/g, '/').replace(/^.*uploads\//, '')}` : null);
      if (!rawUrl) return;

      const segStart = (typeof seg.audioStartSec === 'number' && !isNaN(seg.audioStartSec))
        ? seg.audioStartSec
        : (typeof seg.startSec === 'number' && !isNaN(seg.startSec)
          ? seg.startSec
          : parseTimeToSeconds(seg.audioStart ?? seg.start, 0));
      const segDur = (typeof seg.audioDurationSec === 'number' && !isNaN(seg.audioDurationSec))
        ? seg.audioDurationSec
        : (typeof seg.audioDuration === 'number' && !isNaN(seg.audioDuration)
          ? seg.audioDuration
          : 2.5);
      const segEnd = (typeof seg.audioEndSec === 'number' && !isNaN(seg.audioEndSec))
        ? seg.audioEndSec
        : (segStart + segDur);

      const inRange = now >= (segStart - 0.02) && now < segEnd;

      // Smart Auto-Ducking on Overlapping Dialogues (50% Auto Duck):
      // If next dialogue starts while this one is still speaking, auto-duck this clip to 50% volume!
      const isOverlappedByNext = segments.some((nextSeg, nextIdx) => {
        if (nextIdx <= idx) return false;
        if (nextSeg.muted || nextSeg.isMuted) return false;
        const nextStart = (typeof nextSeg.audioStartSec === "number" && !isNaN(nextSeg.audioStartSec))
          ? nextSeg.audioStartSec
          : (typeof nextSeg.startSec === "number" && !isNaN(nextSeg.startSec)
            ? nextSeg.startSec
            : parseTimeToSeconds(nextSeg.audioStart ?? nextSeg.start, 0));
        return nextStart > segStart && nextStart < segEnd && now >= (nextStart - 0.04);
      });

      const effectiveVol = isOverlappedByNext ? parseFloat((targetVol * 0.50).toFixed(2)) : targetVol;

      if (inRange) {
        const expectedOffset = Math.max(0, now - segStart);
        let activeItem = activeSegmentAudiosRef.current[segKey];

        if (!activeItem) {
          const audio = getSegmentAudio(rawUrl);
          if (audio) {
            audio.volume = effectiveVol;
            audio.playbackRate = currentRate;
            // Only seek if entering mid-sentence (e.g. user scrubbed or jumped)
            if (expectedOffset > 0.08 && Math.abs(audio.currentTime - expectedOffset) > 0.08) {
              try { audio.currentTime = expectedOffset; } catch (_) {}
            } else if (expectedOffset <= 0.08 && audio.currentTime > 0.08) {
              try { audio.currentTime = 0; } catch (_) {}
            }
            if (audio.paused) {
              audio.play().catch((err) => {
                if (err.name !== 'AbortError') console.warn('Segment audio play notice:', err);
              });
            }
            activeSegmentAudiosRef.current[segKey] = { audio, segKey, segStart, segEnd, hasEnded: false };
          }
        } else {
          const audio = activeItem.audio;
          if (audio.volume !== effectiveVol) audio.volume = effectiveVol;

          // Check if audio finished its natural sentence duration
          if (audio.ended || (audio.duration > 0 && audio.currentTime >= audio.duration - 0.04)) {
            activeItem.hasEnded = true;
          }

          if (!activeItem.hasEnded) {
            if (audio.paused) {
              audio.play().catch(() => {});
            }

            // CRITICAL AUDIO SMOOTHNESS WITH HYSTERESIS:
            // Never hard-seek audio on micro-drifts during forward playback!
            const drift = expectedOffset - audio.currentTime;
            const absDrift = Math.abs(drift);
            const isNudged = Math.abs(audio.playbackRate - currentRate) > 0.005;

            if (absDrift > 0.50) {
              // Severe desync (user scrub or seek): resync time cleanly
              try { audio.currentTime = expectedOffset; } catch (_) {}
              if (audio.playbackRate !== currentRate) audio.playbackRate = currentRate;
            } else if (isNudged) {
              // Nudge is currently active: maintain until recovered below 20ms hysteresis threshold
              if (absDrift < 0.020) {
                audio.playbackRate = currentRate;
              } else {
                const rateMultiplier = drift > 0 ? 1.04 : 0.96;
                audio.playbackRate = parseFloat((currentRate * rateMultiplier).toFixed(3));
              }
            } else if (absDrift >= 0.060) {
              // Exceeded 60ms tolerance: activate bounded rate nudge
              const rateMultiplier = drift > 0 ? 1.04 : 0.96;
              audio.playbackRate = parseFloat((currentRate * rateMultiplier).toFixed(3));
            }
          }
        }
      } else {
        if (activeSegmentAudiosRef.current[segKey]) {
          const audio = activeSegmentAudiosRef.current[segKey].audio;
          if (!audio.paused) {
            audio.pause();
          }
          audio.playbackRate = currentRate;
          delete activeSegmentAudiosRef.current[segKey];
        }
      }
    });
  }, [currentTime, isPlaying, hasSegmentAudios, renderedVideo, scriptData?.segments, voiceSettings, videoRef]);

  // Helper: Idempotent audio play to prevent promise rejection warnings & duplicate starts
  const safePlayNarration = (a) => {
    if (!a || !a.paused || isPlayPendingRef.current) return;
    const nowTime = currentTimeRef.current;
    if (a.duration && Number.isFinite(a.duration) && nowTime >= a.duration) return;

    isPlayPendingRef.current = true;
    const p = a.play();
    if (p && typeof p.then === 'function') {
      p.then(() => {
        isPlayPendingRef.current = false;
      }).catch((err) => {
        isPlayPendingRef.current = false;
        if (err.name !== 'AbortError') {
          console.warn('[NarrationSync] Play notice:', err);
        }
      });
    } else {
      isPlayPendingRef.current = false;
    }
  };

  // Synchronize Khmer AI Voice Playback with Canonical Timeline Playhead
  useEffect(() => {
    if (renderedVideo) {
      if (narrationAudioRef.current && !narrationAudioRef.current.paused) {
        narrationAudioRef.current.pause();
      }
      return;
    }
    const a = narrationAudioRef.current;
    if (!a || !audioGenerated || !fullAudioUrl || hasSegmentAudios) return;

    if (isPlaying) {
      const nowTime = currentTimeRef.current;
      if (a.duration && Number.isFinite(a.duration) && nowTime >= a.duration) {
        if (!a.paused) a.pause();
        return;
      }
      // Only seek on significant desync (> 0.50s) to avoid buffer dumps
      if (a.readyState >= 1 && !a.seeking && Number.isFinite(nowTime) && Math.abs(a.currentTime - nowTime) > 0.50) {
        const maxTime = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : nowTime;
        a.currentTime = Math.min(nowTime, maxTime);
      }
      if (a.paused && (!a.duration || nowTime < a.duration)) {
        safePlayNarration(a);
      }
    } else {
      isPlayPendingRef.current = false;
      if (!a.paused) {
        a.pause();
      }
      const v = videoRef?.current;
      a.playbackRate = v?.playbackRate || 1.0;
    }
  }, [isPlaying, renderedVideo, audioGenerated, fullAudioUrl, hasSegmentAudios]);

  // Sync event hooks on video element (Robust 3-Tier Sync: 0-60ms lock, 60-450ms hysteresis nudge, >450ms seek)
  useEffect(() => {
    const v = videoRef?.current;
    if (!v) return;

    // Helper to compute video canonical timeline time
    const getTargetTimelineTime = () => {
      let target = v.currentTime || 0;
      if (Array.isArray(videoClips) && videoClips.length > 0) {
        const c = videoClips.find((clip) => {
          const sStart = Number.isFinite(clip.sourceStart) ? clip.sourceStart : (clip.start || 0);
          const sEnd = Number.isFinite(clip.sourceEnd) ? clip.sourceEnd : (clip.end || (v.duration || 0));
          return target >= (sStart - 0.05) && target <= (sEnd + 0.05);
        });
        if (c) {
          const sStart = Number.isFinite(c.sourceStart) ? c.sourceStart : (c.start || 0);
          const cStart = Number.isFinite(c.start) ? c.start : 0;
          target = cStart + Math.max(0, target - sStart);
        }
      }
      return target;
    };

    const handleSync = () => {
      const a = narrationAudioRef.current;
      if (!a || renderedVideo || !audioGenerated || !fullAudioUrl || hasSegmentAudios) return;

      const targetTime = getTargetTimelineTime();

      if (a.duration && Number.isFinite(a.duration) && targetTime >= a.duration) {
        if (!a.paused) a.pause();
        return;
      }

      // Resume audio if video is playing and audio is unexpectedly paused
      if (!v.paused && a.paused && (!a.duration || targetTime < a.duration)) {
        safePlayNarration(a);
      }

      const baseRate = v.playbackRate || 1.0;
      const drift = targetTime - a.currentTime;
      const absDrift = Math.abs(drift);
      const isCurrentlyNudged = Math.abs(a.playbackRate - baseRate) > 0.005;

      // Tier 3: Severe desync (> 0.50s) or explicit user seeking
      if (v.seeking) {
        if (a.playbackRate !== baseRate) a.playbackRate = baseRate;
      } else if (absDrift > 0.50) {
        if (!a.seeking) {
          const maxTime = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : targetTime;
          a.currentTime = Math.min(targetTime, maxTime);
          if (a.playbackRate !== baseRate) a.playbackRate = baseRate;
        }
      } else if (isCurrentlyNudged) {
        // Tier 2 Recovery Hysteresis: continue nudge until drift falls below 20ms
        if (absDrift < 0.020) {
          a.playbackRate = baseRate;
        } else {
          const rateMultiplier = drift > 0 ? 1.04 : 0.96;
          a.playbackRate = parseFloat((baseRate * rateMultiplier).toFixed(3));
        }
      } else if (absDrift >= 0.060) {
        // Tier 2 Activation: drift exceeded 60ms, apply bounded temporary rate nudge
        const rateMultiplier = drift > 0 ? 1.04 : 0.96;
        a.playbackRate = parseFloat((baseRate * rateMultiplier).toFixed(3));
      } else if (a.playbackRate !== baseRate) {
        // Tier 1: Drift is < 60ms and not nudged; preserve nominal rate
        a.playbackRate = baseRate;
      }
    };

    const handlePlay = () => {
      const a = narrationAudioRef.current;
      if (!a || renderedVideo || !audioGenerated || !fullAudioUrl || hasSegmentAudios) return;
      safePlayNarration(a);
    };

    const handlePause = () => {
      isPlayPendingRef.current = false;
      stopAllSegmentAudios();
      const a = narrationAudioRef.current;
      if (a) {
        if (!a.paused) a.pause();
        a.playbackRate = v.playbackRate || 1.0;
      }
    };

    const handleSeeking = () => {
      isPlayPendingRef.current = false;
      stopAllSegmentAudios();
      const a = narrationAudioRef.current;
      if (a) {
        if (!a.paused) a.pause();
        a.playbackRate = v.playbackRate || 1.0;
      }
    };

    const handleSeeked = () => {
      const a = narrationAudioRef.current;
      if (!a || renderedVideo || !audioGenerated || !fullAudioUrl) return;
      a.playbackRate = v.playbackRate || 1.0;

      const targetTime = getTargetTimelineTime();
      if (a.duration && Number.isFinite(a.duration) && targetTime >= a.duration) {
        if (!a.paused) a.pause();
        return;
      }
      if (a.readyState >= 1) {
        const maxTime = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : targetTime;
        a.currentTime = Math.min(targetTime, maxTime);
      }
      if (!v.paused) {
        safePlayNarration(a);
      }
    };

    const handleVisibilityChange = () => {
      const a = narrationAudioRef.current;
      if (!a || renderedVideo || !audioGenerated || !fullAudioUrl) return;
      const targetTime = getTargetTimelineTime();
      if (document.visibilityState === 'visible' && !v.paused) {
        if (a.duration && Number.isFinite(a.duration) && targetTime >= a.duration) {
          if (!a.paused) a.pause();
          return;
        }
        if (a.readyState >= 1 && !a.seeking) {
          const maxTime = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : targetTime;
          a.currentTime = Math.min(targetTime, maxTime);
        }
        safePlayNarration(a);
      }
    };

    const handleRateChange = () => {
      const a = narrationAudioRef?.current;
      if (a && v) {
        a.playbackRate = v.playbackRate || 1.0;
      }
    };

    // Single idempotent play listener (avoids play/playing race conditions)
    v.addEventListener('play', handlePlay);
    v.addEventListener('timeupdate', handleSync);
    v.addEventListener('seeking', handleSeeking);
    v.addEventListener('seeked', handleSeeked);
    v.addEventListener('pause', handlePause);
    v.addEventListener('ended', handlePause);
    v.addEventListener('ratechange', handleRateChange);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      isPlayPendingRef.current = false;
      v.removeEventListener('play', handlePlay);
      v.removeEventListener('timeupdate', handleSync);
      v.removeEventListener('seeking', handleSeeking);
      v.removeEventListener('seeked', handleSeeked);
      v.removeEventListener('pause', handlePause);
      v.removeEventListener('ended', handlePause);
      v.removeEventListener('ratechange', handleRateChange);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      stopAllSegmentAudios();
      if (narrationAudioRef.current) {
        if (!narrationAudioRef.current.paused) narrationAudioRef.current.pause();
        narrationAudioRef.current.playbackRate = 1.0;
      }
    };
  }, [videoRef, renderedVideo, audioGenerated, fullAudioUrl, hasSegmentAudios, videoClips]);

  // Pre-calculate speaking intervals once per script change (ultra-fast O(1) checks during 60fps playback)
  const speakingIntervals = React.useMemo(() => {
    if (!scriptData?.segments) return [];
    return scriptData.segments
      .filter((seg) => {
        const hasText = Boolean((seg.khmer || seg.textKhmer || seg.text || seg.original || '').trim());
        const hasAudio = Boolean(seg.audioFile || seg.audioPath || seg.audioUrl);
        return !seg.muted && !seg.isMuted && (hasText || hasAudio);
      })
      .map((seg) => {
        const s = (typeof seg.audioStartSec === 'number' && !isNaN(seg.audioStartSec))
          ? seg.audioStartSec
          : (typeof seg.startSec === 'number' && !isNaN(seg.startSec)
            ? seg.startSec
            : parseTimeToSeconds(seg.audioStart ?? seg.start, 0));
        const dur = (typeof seg.audioDurationSec === 'number' && !isNaN(seg.audioDurationSec))
          ? seg.audioDurationSec
          : (typeof seg.audioDuration === 'number' && !isNaN(seg.audioDuration)
            ? seg.audioDuration
            : 2.5);
        const e = (typeof seg.audioEndSec === 'number' && !isNaN(seg.audioEndSec))
          ? seg.audioEndSec
          : (s + dur);
        return { start: s, end: e };
      });
  }, [audioGenerated, fullAudioUrl, scriptData?.segments]);

  // Real-time Live Smart Ducking during Video Preview
  useEffect(() => {
    const v = videoRef?.current;
    if (!v) return;

    if (renderedVideo) {
      if (v.muted) v.muted = false;
      if (v.volume !== 1.0) v.volume = 1.0;
      return;
    }

    const duckVal = voiceSettings.duckingVolume !== undefined ? Number(voiceSettings.duckingVolume) : 0.15;
    const khmerVal = voiceSettings.khmerVolume !== undefined ? Number(voiceSettings.khmerVolume) : 1.0;

    const isSpeaking = speakingIntervals.length > 0 && speakingIntervals.some((intv) => currentTime >= intv.start && currentTime <= intv.end);

    // Live Mute for muted video clips (Mute Original Audio per-clip)
    const isCurrentVideoClipMuted = Array.isArray(videoClips) && videoClips.some((c) => {
      const cStart = Number.isFinite(c.start) ? c.start : 0;
      const cEnd = Number.isFinite(c.end) ? c.end : 0;
      return c.isMuted && currentTime >= (cStart - 0.02) && currentTime < cEnd;
    });

    if (duckVal === 0 || isCurrentVideoClipMuted) {
      if (!v.muted) v.muted = true;
      if (v.volume !== 0) v.volume = 0;
    } else {
      if (v.muted) v.muted = false;
      // Proportional volume scaling: never force a 25% floor when user requests quiet audio (e.g. 1% -> 0.01)
      const targetVol = isSpeaking
        ? Math.min(1.0, Math.max(0, duckVal))
        : (speakingIntervals.length > 0 && duckVal > 0.05
            ? Math.min(1.0, duckVal * 1.4)
            : Math.min(1.0, Math.max(0, duckVal)));

      if (Math.abs(v.volume - targetVol) > 0.001) {
        v.volume = targetVol;
      }
    }

    if (narrationAudioRef.current) {
      // Narration audio volume is governed by khmerVolume setting.
      // Note: The master narration track synthesized by FFmpeg already contains digital silence between segments.
      // Therefore, narration audio is NOT muted during gaps, preventing timer jitter from silencing speech!
      const isMutedBySetting = khmerVal <= 0.01;
      const shouldMute = isMutedBySetting || !audioGenerated || !fullAudioUrl;
      if (narrationAudioRef.current.muted !== shouldMute) {
        narrationAudioRef.current.muted = shouldMute;
      }
      const targetKhmer = shouldMute
        ? 0
        : Math.min(1.0, Math.max(0, khmerVal > 0 ? (khmerVal >= 1.0 ? 1.0 : khmerVal) : 0));
      if (Math.abs(narrationAudioRef.current.volume - targetKhmer) > 0.01) {
        narrationAudioRef.current.volume = targetKhmer;
      }
    }
  }, [currentTime, audioGenerated, audioOutdated, fullAudioUrl, renderedVideo, scriptData, voiceSettings, videoClips, videoRef]);

  const currentVideoSrc = (typeof renderedVideo === 'string' ? renderedVideo : renderedVideo?.outputVideoUrl) || selectedVideo?.videoUrl;

  const handleInternalLoadedMetadata = (e) => {
    if (onLoadedMetadata) onLoadedMetadata(e);
    const v = e.target;
    if (v && v.videoWidth && v.videoHeight) {
      setVideoMeta({
        width: v.videoWidth,
        height: v.videoHeight,
        ratio: v.videoWidth / v.videoHeight,
      });
    }
  };

  // Derive canonical timeline time coordinate for video and subtitle presentation.
  // In multi-clip draft preview with non-zero sourceStart, map HTML5 video element source time to timeline coordinate.
  const effectiveTimelineTime = (() => {
    const v = videoRef?.current;
    if (v && !renderedVideo && Array.isArray(videoClips) && videoClips.length > 0) {
      const srcTime = Number.isFinite(v.currentTime) ? v.currentTime : null;
      if (srcTime !== null && !v.paused) {
        const mappedTl = mapSourceToTimelineTime(srcTime, videoClips);
        if (Number.isFinite(mappedTl)) {
          return mappedTl;
        }
      }
    }
    return Number.isFinite(currentTime) ? currentTime : 0;
  })();

  const activeSegment = scriptData?.segments?.find((seg) => {
    const s = (typeof seg.startSec === 'number' && !isNaN(seg.startSec))
      ? seg.startSec
      : ((typeof seg.audioStartSec === 'number' && !isNaN(seg.audioStartSec))
        ? seg.audioStartSec
        : parseTimeToSeconds(seg.start ?? seg.startTime, 0));

    let e = (typeof seg.endSec === 'number' && !isNaN(seg.endSec))
      ? seg.endSec
      : ((typeof seg.audioEndSec === 'number' && !isNaN(seg.audioEndSec))
        ? seg.audioEndSec
        : parseTimeToSeconds(seg.end ?? seg.endTime, s + (seg.audioDurationSec || 2.5)));

    // Prevent 0.01s or micro-duration clipping in player preview
    if (isNaN(e) || e <= s || (e - s) < 0.6) {
      const textLen = String(seg.khmer || seg.khmerText || seg.khmerTranslatedText || seg.original || '').trim().length || 8;
      e = s + Math.max(1.8, Math.min(6.0, textLen * 0.16));
    }

    // Half-open interval: s <= effectiveTimelineTime < e (strictly prevents boundary collision)
    return effectiveTimelineTime >= s && effectiveTimelineTime < (e - 0.001);
  });

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch((err) => console.error(err));
    } else {
      document.exitFullscreen();
    }
  };

  const getCanvasAspectRatio = () => {
    if (aspectRatio === '9:16') return '9/16';
    if (aspectRatio === '16:9') return '16/9';
    if (aspectRatio === '1:1') return '1/1';
    if (videoMeta.width > 0 && videoMeta.height > 0) {
      return `${videoMeta.width} / ${videoMeta.height}`;
    }
    return '16/9';
  };

  const getCanvasHeight = () => {
    if (zoomScale === '75%') return '75%';
    if (zoomScale === '50%') return '50%';
    return '100%';
  };

  const getAspectBadge = () => {
    if (aspectRatio === '9:16') return '9:16 (TikTok/Reels)';
    if (aspectRatio === '16:9') return '16:9 (YouTube)';
    if (aspectRatio === '1:1') return '1:1 (Square)';
    if (videoMeta.width > 0) {
      const r = videoMeta.ratio;
      if (Math.abs(r - 1) < 0.1) return `${videoMeta.width}x${videoMeta.height} (Square 1:1)`;
      if (r < 0.8) return `${videoMeta.width}x${videoMeta.height} (Vertical 9:16)`;
      if (r > 1.3) return `${videoMeta.width}x${videoMeta.height} (Landscape 16:9)`;
      return `${videoMeta.width}x${videoMeta.height}`;
    }
    return 'Original (Auto)';
  };

  return (
    <div className="capcut-player-panel" ref={containerRef}>
      {/* Player Top Bar */}
      <PlayerTopBar
        renderedVideo={renderedVideo}
        onResetToPreview={() => setRenderedVideo && setRenderedVideo(null)}
        selectedVideo={selectedVideo}
        videoMeta={videoMeta}
        getAspectBadge={getAspectBadge}
        setAspectRatio={setAspectRatio}
        zoomScale={zoomScale}
        setZoomScale={setZoomScale}
        showSafeZones={showSafeZones}
        setShowSafeZones={setShowSafeZones}
        toggleFullscreen={toggleFullscreen}
      />

      {/* Video View Canvas */}
      <div className="player-canvas-container">
        <div
          className="player-canvas-area"
          style={{
            aspectRatio: getCanvasAspectRatio(),
            height: getCanvasHeight(),
          }}
        >
          {currentVideoSrc ? (
            <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <video
                ref={videoRef}
                src={currentVideoSrc}
                muted={!renderedVideo && (voiceSettings.duckingVolume === 0)}
                onTimeUpdate={onTimeUpdate}
                onLoadedMetadata={handleInternalLoadedMetadata}
                onClick={onPlayPause}
                onEnded={onEnded}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  cursor: 'pointer',
                  display: 'block',
                }}
              />

              {/* Real-time Synchronized Khmer AI Dubbing Audio Element */}
              {!renderedVideo && audioGenerated && fullAudioUrl && (
                <audio
                  ref={narrationAudioRef}
                  src={fullAudioUrl}
                  preload="auto"
                  onLoadedMetadata={() => {
                    if (recoveryManagerRef.current) {
                      recoveryManagerRef.current.handleAudioSuccess();
                    }
                    const v = videoRef?.current;
                    const a = narrationAudioRef?.current;
                    if (a) {
                      if ('preservesPitch' in a) a.preservesPitch = true;
                      if ('mozPreservesPitch' in a) a.mozPreservesPitch = true;
                      if ('webkitPreservesPitch' in a) a.webkitPreservesPitch = true;
                    }
                    if (v && a) {
                      const t = Number.isFinite(currentTimeRef.current) ? currentTimeRef.current : (v.currentTime || 0);
                      if (Number.isFinite(t)) {
                        const maxDur = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : t;
                        a.currentTime = Math.max(0, Math.min(t, maxDur));
                      }
                      if (!v.paused) {
                        safePlayNarration(a);
                      }
                    }
                  }}
                  onCanPlay={() => {
                    if (recoveryManagerRef.current) {
                      recoveryManagerRef.current.handleAudioSuccess();
                    }
                  }}
                  onError={(e) => {
                    console.warn('Narration audio load/decode error detected, executing bounded recovery:', e);
                    if (recoveryManagerRef.current && fullAudioUrl) {
                      recoveryManagerRef.current.handleError(fullAudioUrl, narrationAudioRef.current);
                    }
                  }}
                />
              )}

              {/* Narration Media Load Error / 404 Bounded Recovery Notification */}
              {narrationError && (
                <div
                  className="narration-error-banner"
                  style={{
                    position: 'absolute',
                    top: 12,
                    left: 12,
                    right: 12,
                    backgroundColor: 'rgba(220, 38, 38, 0.95)',
                    color: '#ffffff',
                    padding: '8px 14px',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: '500',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    zIndex: 40,
                    backdropFilter: 'blur(4px)',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <AlertCircle size={16} style={{ flexShrink: 0 }} />
                    <span>{narrationError.message}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setNarrationError(null)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#ffffff',
                      cursor: 'pointer',
                      fontSize: '18px',
                      padding: '0 4px',
                      lineHeight: 1,
                    }}
                    title="បិទ"
                  >
                    ×
                  </button>
                </div>
              )}

              {/* TikTok / Reels Safe Zones Guide Overlay */}
              <SafeZonesGuide showSafeZones={showSafeZones} />

              {/* Subtitle Overlay */}
              <LiveSubtitleOverlay
                activeSegment={activeSegment}
                voiceSettings={voiceSettings}
                renderedVideo={renderedVideo}
                currentTime={effectiveTimelineTime}
                aspectRatio={aspectRatio}
                videoMeta={videoMeta}
              />

              {/* Anti-Theft Running Marquee & Watermark Live Overlay */}
              <AntiTheftOverlay
                voiceSettings={voiceSettings}
                renderedVideo={renderedVideo}
                aspectRatio={aspectRatio}
                videoMeta={videoMeta}
              />

              {/* Logo Watermark Live Overlay (សងខាង / ជ្រុងលើ) */}
              <LogoOverlay
                voiceSettings={voiceSettings}
                renderedVideo={renderedVideo}
                aspectRatio={aspectRatio}
              />
            </div>
          ) : (
            <div className="empty-player-placeholder">
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                onChange={handleFileSelect}
                style={{ display: 'none' }}
              />
              <div
                onClick={triggerFileInput}
                style={{
                  width: 50,
                  height: 50,
                  borderRadius: '50%',
                  background: 'rgba(76, 141, 255, 0.12)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 4,
                  border: '1px solid rgba(76, 141, 255, 0.35)',
                  cursor: isUploading ? 'not-allowed' : 'pointer',
                  transition: 'transform 0.15s ease'
                }}
                title="Click to Import Video File"
              >
                {isUploading ? (
                  <Loader2 size={24} className="pulse-glow" color="var(--primary-accent)" />
                ) : (
                  <Video size={24} color="var(--primary-accent)" />
                )}
              </div>
              <span style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                {isUploading ? 'កំពុង Upload វីដេអូរឿងភាគ...' : 'No Video Loaded'}
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', maxWidth: 260, textAlign: 'center', lineHeight: 1.4 }}>
                {isUploading
                  ? 'សូមរង់ចាំបន្តិច ប្រព័ន្ធកំពុងដំណើរការបញ្ចូលវីដេអូ...'
                  : 'Import an MP4 or MOV video file to preview and start dubbing'}
              </span>

              {uploadError && (
                <div style={{ color: 'var(--color-error)', fontSize: '0.74rem', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <AlertCircle size={13} />
                  <span>{uploadError}</span>
                </div>
              )}

              <button
                type="button"
                onClick={triggerFileInput}
                disabled={isUploading}
                className="btn btn-primary"
                style={{
                  marginTop: 10,
                  height: 34,
                  padding: '0 16px',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  cursor: isUploading ? 'not-allowed' : 'pointer'
                }}
              >
                {isUploading ? (
                  <>
                    <Loader2 size={13} className="pulse-glow" />
                    <span>Uploading...</span>
                  </>
                ) : (
                  <>
                    <Upload size={13} />
                    <span>Import Video</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Player Bottom Control Bar */}
      <PlayerBottomBar
        currentTime={currentTime}
        duration={duration}
        onSeek={onSeek}
        currentVideoSrc={currentVideoSrc}
        isPlaying={isPlaying}
        onPlayPause={onPlayPause}
        voiceSettings={voiceSettings}
      />
    </div>
  );
}
