import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Video, Upload, Loader2, AlertCircle } from 'lucide-react';
import { parseTimeToSeconds } from '../utils/formatTime';
import { mapSourceToTimelineTime } from '../utils/timelineUtils';
import { uploadVideoFile } from '../services/api';
import { createAudioRecoveryManager } from '../utils/audioAutoRecovery';

import { PlayerTopBar, PlayerBottomBar } from './player/PlayerControls';
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
  onResetToPreview = null,
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
  const aspectRatio = '16:9'; // Fixed standard 1920x1080 Landscape 16:9 requested by Nha
  const [videoMeta, setVideoMeta] = useState({ width: 0, height: 0, ratio: 1 });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const containerRef = useRef(null);
  const narrationAudioRef = useRef(null);
  const cleanBgAudioRef = useRef(null);
  const [cleanBgAudioUrl, setCleanBgAudioUrl] = useState(null);
  const fileInputRef = useRef(null);
  const activeSegmentAudiosRef = useRef({});
  const segmentAudioPoolRef = useRef({});
  const isPlayPendingRef = useRef(false);
  const playStartTimeRef = useRef(0);

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

  // 🎙️ Real-time Segment Audio Priority:
  // When editing on the timeline, always prioritize direct segment playback for 0-latency instant preview on drag/move/edit.
  // Master narration audio is only a fallback when no individual segment audio clips exist.
  const hasSegmentAudios = Boolean(
    !renderedVideo &&
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
      audio.preload = 'auto'; // Immediate preload for zero-delay speech start
      if ('preservesPitch' in audio) audio.preservesPitch = true;
      if ('mozPreservesPitch' in audio) audio.mozPreservesPitch = true;
      if ('webkitPreservesPitch' in audio) audio.webkitPreservesPitch = true;
      segmentAudioPoolRef.current[url] = audio;
    }
    return audio;
  };

  // Preload on-demand: proactively preload upcoming segments near playhead (-2s to +20s)
  useEffect(() => {
    if (!hasSegmentAudios || !scriptData?.segments || scriptData.segments.length === 0) return;
    const now = currentTimeRef.current || 0;
    const upcoming = scriptData.segments
      .filter((seg) => {
        const s = (typeof seg.audioStartSec === 'number' && !isNaN(seg.audioStartSec)) ? seg.audioStartSec : (seg.startSec || 0);
        return s >= (now - 2) && s <= (now + 20);
      })
      .slice(0, 6);

    upcoming.forEach((seg) => {
      const rawUrl = seg.audioUrl || (seg.audioPath ? `/uploads/${seg.audioPath.replace(/\\/g, '/').replace(/^.*uploads\//, '')}` : null);
      if (rawUrl) {
        getSegmentAudio(rawUrl);
      }
    });
  }, [hasSegmentAudios, scriptData?.segments, currentTime]);

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

  // Track browser fullscreen state (supports Esc key and native exit)
  useEffect(() => {
    const handleFsChange = () => {
      const isFs = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
      setIsFullscreen(isFs);
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    document.addEventListener('webkitfullscreenchange', handleFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFsChange);
      document.removeEventListener('webkitfullscreenchange', handleFsChange);
    };
  }, []);

  // 🎧 AI Vocal Separation (Demucs): Fetch separated clean BGM (no_vocals.wav) when Demucs is enabled
  useEffect(() => {
    if (!voiceSettings?.enableDemucs || !selectedVideo) {
      setCleanBgAudioUrl(null);
      return;
    }
    const videoRefName = selectedVideo?.videoUrl || selectedVideo?.filePath || selectedVideo?.fileName || selectedVideo?.name;
    if (!videoRefName) return;

    fetch('/api/audio/separation-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoPath: videoRefName }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.available && data.noVocalsUrl) {
          const fullUrl = data.noVocalsUrl;
          console.log('[VideoPlayerPreview] 🎧 Found separated clean BGM:', fullUrl);
          setCleanBgAudioUrl(fullUrl);
        } else {
          setCleanBgAudioUrl(null);
        }
      })
      .catch((err) => {
        console.warn('[VideoPlayerPreview] Error checking separation status:', err);
        setCleanBgAudioUrl(null);
      });
  }, [selectedVideo, voiceSettings?.enableDemucs]);

  // Listen for instant Demucs separation completed event from DubbingModeTab
  useEffect(() => {
    const handleSepReady = (e) => {
      if (e.detail?.noVocalsUrl) {
        const fullUrl = e.detail.noVocalsUrl;
        console.log('[VideoPlayerPreview] 🎧 Instant event received clean BGM:', fullUrl);
        setCleanBgAudioUrl(fullUrl);
      }
    };
    window.addEventListener('demucs-separation-ready', handleSepReady);
    return () => window.removeEventListener('demucs-separation-ready', handleSepReady);
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

  // 🎙️ Real-time Segment-by-Segment Dubbing Playback (RAF-based loop for 0-lag during playback)
  // Refs to hold latest values for the RAF loop without re-triggering the effect
  const segAudioConfigRef = useRef({ voiceSettings, videoClips, scriptData, hasSegmentAudios, renderedVideo });
  useEffect(() => {
    segAudioConfigRef.current = { voiceSettings, videoClips, scriptData, hasSegmentAudios, renderedVideo };
  }, [voiceSettings, videoClips, scriptData, hasSegmentAudios, renderedVideo]);

  // Core segment audio sync logic (extracted so both RAF loop and seek effect can call it)
  const syncSegmentAudiosAtTime = useCallback((now) => {
    const { voiceSettings: vs, videoClips: vc, scriptData: sd, hasSegmentAudios: hsa, renderedVideo: rv } = segAudioConfigRef.current;
    if (rv || !hsa) {
      stopAllSegmentAudios();
      return;
    }

    const v = videoRef?.current;
    const currentRate = v?.playbackRate || 1.0;
    const khmerVal = vs.khmerVolume !== undefined ? Number(vs.khmerVolume) : 1.0;
    const isKhmerMuted = khmerVal <= 0.01;
    const targetVol = isKhmerMuted ? 0 : Math.min(1.0, Math.max(0, khmerVal));

    const segments = sd?.segments || [];

    // High-performance window filter: only inspect segments within active window of now
    const nearbySegs = segments.map((seg, idx) => ({ seg, idx })).filter(({ seg }) => {
      if (seg.muted || seg.isMuted) return false;
      const s = (typeof seg.audioStartSec === 'number' && !isNaN(seg.audioStartSec)) ? seg.audioStartSec : (seg.startSec || 0);
      const rawAudioDur = (typeof seg.finalAudioDuration === 'number' && seg.finalAudioDuration > 0)
        ? seg.finalAudioDuration
        : ((typeof seg.audioDuration === 'number' && seg.audioDuration > 0)
          ? seg.audioDuration
          : ((typeof seg.audioDurationSec === 'number' && !isNaN(seg.audioDurationSec)) ? seg.audioDurationSec : 2.5));
      const effectiveEnd = (seg.userTrimmed && typeof seg.audioEndSec === 'number')
        ? seg.audioEndSec
        : Math.max((typeof seg.audioEndSec === 'number' && !isNaN(seg.audioEndSec) ? seg.audioEndSec : 0), s + rawAudioDur);
      return now >= (s - 0.2) && now < (effectiveEnd + 0.3);
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
      const segDur = (typeof seg.finalAudioDuration === 'number' && seg.finalAudioDuration > 0)
        ? seg.finalAudioDuration
        : ((typeof seg.audioDuration === 'number' && seg.audioDuration > 0)
          ? seg.audioDuration
          : ((typeof seg.audioDurationSec === 'number' && !isNaN(seg.audioDurationSec))
            ? seg.audioDurationSec
            : 2.5));

      // CRITICAL: Determine true audio end boundary
      // Allow audio to play to its full natural sentence completion unless explicitly trimmed by user
      const existingAudio = activeSegmentAudiosRef.current[segKey]?.audio;
      const trueAudioDuration = (existingAudio && existingAudio.duration && !isNaN(existingAudio.duration) && existingAudio.duration > 0.2)
        ? existingAudio.duration
        : segDur;
      const effectiveSegDur = Math.max(segDur, trueAudioDuration);
      const effectiveSegEnd = (seg.userTrimmed && typeof seg.audioEndSec === 'number')
        ? seg.audioEndSec
        : Math.max((typeof seg.audioEndSec === 'number' && !isNaN(seg.audioEndSec) ? seg.audioEndSec : 0), segStart + effectiveSegDur);

      const inRange = now >= (segStart - 0.02) && now < effectiveSegEnd;

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
        return nextStart > segStart && nextStart < effectiveSegEnd && now >= (nextStart - 0.04);
      });

      const effectiveVol = isOverlappedByNext ? parseFloat((targetVol * 0.50).toFixed(2)) : targetVol;

      const segAudioOffset = (typeof seg.audioOffset === 'number' && !isNaN(seg.audioOffset)) ? seg.audioOffset : 0;
      const segAudioEndLimit = (seg.userTrimmed && typeof seg.audioDurationSec === 'number')
        ? (segAudioOffset + seg.audioDurationSec)
        : null;

      if (inRange) {
        const expectedOffset = segAudioOffset + Math.max(0, now - segStart);
        let activeItem = activeSegmentAudiosRef.current[segKey];

        if (!activeItem) {
          const audio = getSegmentAudio(rawUrl);
          if (audio) {
            audio.volume = effectiveVol;
            audio.playbackRate = currentRate;
            // Seek accurately to expected offset including slice audioOffset
            if (Math.abs(audio.currentTime - expectedOffset) > 0.08) {
              try { audio.currentTime = expectedOffset; } catch (_) {}
            }
            if (audio.paused) {
              audio.play().catch((err) => {
                if (err.name !== 'AbortError') console.warn('Segment audio play notice:', err);
              });
            }
            activeSegmentAudiosRef.current[segKey] = { audio, segKey, segStart, segEnd: effectiveSegEnd, segAudioEndLimit, hasEnded: false };
          }
        } else {
          const audio = activeItem.audio;
          if (audio.volume !== effectiveVol) audio.volume = effectiveVol;

          // Check if audio finished natural sentence duration or reached the split slice end limit
          if (audio.ended || (audio.duration > 0 && audio.currentTime >= audio.duration - 0.04) || (activeItem.segAudioEndLimit && audio.currentTime >= activeItem.segAudioEndLimit - 0.02)) {
            activeItem.hasEnded = true;
            if (!audio.paused) audio.pause();
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
  }, [videoRef]);

  // PERF: During playback, sync segment audio via RAF loop (bypasses React re-render entirely)
  useEffect(() => {
    if (!isPlaying) {
      stopAllSegmentAudios();
      return;
    }

    const { hasSegmentAudios: hsa, renderedVideo: rv } = segAudioConfigRef.current;
    if (rv || !hsa) {
      stopAllSegmentAudios();
      return;
    }

    // Pause master narration audio to prevent double-audio/echo
    if (narrationAudioRef.current && !narrationAudioRef.current.paused) {
      narrationAudioRef.current.pause();
    }

    let animId;
    let lastSyncPerf = 0;
    const syncLoop = () => {
      const nowPerf = performance.now();
      // Throttle audio sync to ~20Hz (50ms) — audio elements self-play, we only need periodic correction
      if (nowPerf - lastSyncPerf >= 50) {
        lastSyncPerf = nowPerf;
        const v = videoRef?.current;
        const { videoClips: vc } = segAudioConfigRef.current;
        const tlNow = (v && Array.isArray(vc) && vc.length > 0)
          ? (mapSourceToTimelineTime(v.currentTime || 0, vc) ?? currentTimeRef.current)
          : (v?.currentTime ?? currentTimeRef.current);
        syncSegmentAudiosAtTime(tlNow);
      }
      animId = requestAnimationFrame(syncLoop);
    };
    animId = requestAnimationFrame(syncLoop);
    return () => cancelAnimationFrame(animId);
  }, [isPlaying, syncSegmentAudiosAtTime]);

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

  // Synchronize Khmer AI Voice & Clean Demucs BGM Playback with Canonical Timeline Playhead
  useEffect(() => {
    if (renderedVideo) {
      if (narrationAudioRef.current && !narrationAudioRef.current.paused) {
        narrationAudioRef.current.pause();
      }
      if (cleanBgAudioRef.current && !cleanBgAudioRef.current.paused) {
        cleanBgAudioRef.current.pause();
      }
      return;
    }

    const v = videoRef?.current;
    if (isPlaying) {
      if (cleanBgAudioRef.current && cleanBgAudioUrl && voiceSettings?.enableDemucs) {
        const bg = cleanBgAudioRef.current;
        if (v && Number.isFinite(v.currentTime) && Math.abs(bg.currentTime - v.currentTime) > 0.25) {
          bg.currentTime = v.currentTime;
        }
        if (bg.paused) {
          bg.play().catch(() => {});
        }
      }
    } else {
      if (cleanBgAudioRef.current && !cleanBgAudioRef.current.paused) {
        cleanBgAudioRef.current.pause();
      }
    }

    const a = narrationAudioRef.current;
    if (!a || !audioGenerated || !fullAudioUrl || hasSegmentAudios) return;

    if (isPlaying) {
      const targetTime = (v && Array.isArray(videoClips) && videoClips.length > 0)
        ? (mapSourceToTimelineTime(v.currentTime || 0, videoClips) ?? currentTimeRef.current)
        : currentTimeRef.current;
      if (a.duration && Number.isFinite(a.duration) && targetTime >= a.duration) {
        if (!a.paused) a.pause();
        return;
      }
      // Only snap if desync is severe (> 0.40s) before starting playback to prevent double-seek stall
      if (a.readyState >= 1 && !a.seeking && Number.isFinite(targetTime) && Math.abs(a.currentTime - targetTime) > 0.40) {
        const maxTime = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : targetTime;
        a.currentTime = Math.min(targetTime, maxTime);
      }
      if (a.paused && (!a.duration || targetTime < a.duration)) {
        safePlayNarration(a);
      }
    } else {
      isPlayPendingRef.current = false;
      if (!a.paused) {
        a.pause();
      }
      a.playbackRate = v?.playbackRate || 1.0;
    }
  }, [isPlaying, renderedVideo, audioGenerated, fullAudioUrl, hasSegmentAudios, videoClips, videoRef, cleanBgAudioUrl, voiceSettings?.enableDemucs]);

  // Sync event hooks on video element (Robust 3-Tier Sync: 0-40ms lock, 40-450ms hysteresis nudge, >450ms seek)
  useEffect(() => {
    const v = videoRef?.current;
    if (!v) return;

    // Helper to compute video canonical timeline time
    const getTargetTimelineTime = () => {
      let target = v.currentTime || 0;
      if (Array.isArray(videoClips) && videoClips.length > 0) {
        const mapped = mapSourceToTimelineTime(target, videoClips);
        if (Number.isFinite(mapped)) {
          return mapped;
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
      const isStartupGrace = (performance.now() - playStartTimeRef.current) < 800;

      // Tier 3: Severe desync (> 0.45s) or explicit user seeking (suppressed during 800ms startup grace)
      if (v.seeking) {
        if (a.playbackRate !== baseRate) a.playbackRate = baseRate;
      } else if (absDrift > 0.45 && !isStartupGrace) {
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
          const rateMultiplier = drift > 0 ? 1.08 : 0.92;
          a.playbackRate = parseFloat((baseRate * rateMultiplier).toFixed(3));
        }
      } else if (absDrift >= 0.040) {
        // Tier 2 Activation: drift exceeded 40ms, apply bounded temporary rate nudge
        const rateMultiplier = drift > 0 ? 1.08 : 0.92;
        a.playbackRate = parseFloat((baseRate * rateMultiplier).toFixed(3));
      } else if (a.playbackRate !== baseRate) {
        // Tier 1: Drift is < 40ms; preserve nominal rate
        a.playbackRate = baseRate;
      }

      // Sync Clean Demucs BGM (no_vocals.wav) with video
      const bg = cleanBgAudioRef.current;
      if (bg && voiceSettings?.enableDemucs && cleanBgAudioUrl && !v.paused) {
        if (bg.paused) bg.play().catch(() => {});
        if (Number.isFinite(v.currentTime) && Math.abs(bg.currentTime - v.currentTime) > 0.08) {
          bg.currentTime = v.currentTime;
        }
      }
    };

    const handlePlay = () => {
      const bg = cleanBgAudioRef.current;
      if (bg && voiceSettings?.enableDemucs && cleanBgAudioUrl) {
        if (Number.isFinite(v.currentTime)) bg.currentTime = v.currentTime;
        bg.play().catch(() => {});
      }

      const a = narrationAudioRef.current;
      if (!a || renderedVideo || !audioGenerated || !fullAudioUrl || hasSegmentAudios) return;
      playStartTimeRef.current = performance.now();
      const targetTime = getTargetTimelineTime();
      if (a.readyState >= 1 && Number.isFinite(targetTime)) {
        const maxTime = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : targetTime;
        if (Math.abs(a.currentTime - targetTime) > 0.04) {
          a.currentTime = Math.min(targetTime, maxTime);
        }
      }
      safePlayNarration(a);
    };

    const handlePause = () => {
      isPlayPendingRef.current = false;
      stopAllSegmentAudios();
      const bg = cleanBgAudioRef.current;
      if (bg && !bg.paused) {
        bg.pause();
      }
      const a = narrationAudioRef.current;
      if (a) {
        if (!a.paused) a.pause();
        a.playbackRate = v.playbackRate || 1.0;
      }
    };

    const handleSeeking = () => {
      isPlayPendingRef.current = false;
      stopAllSegmentAudios();
      const bg = cleanBgAudioRef.current;
      if (bg) {
        if (!bg.paused) bg.pause();
        if (Number.isFinite(v.currentTime)) bg.currentTime = v.currentTime;
      }
      const a = narrationAudioRef.current;
      if (a) {
        if (!a.paused) a.pause();
        a.playbackRate = v.playbackRate || 1.0;
        const targetTime = getTargetTimelineTime();
        if (a.readyState >= 1 && Number.isFinite(targetTime)) {
          const maxTime = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : targetTime;
          a.currentTime = Math.min(targetTime, maxTime);
        }
      }
    };

    const handleSeeked = () => {
      const bg = cleanBgAudioRef.current;
      if (bg && voiceSettings?.enableDemucs && cleanBgAudioUrl) {
        if (Number.isFinite(v.currentTime)) bg.currentTime = v.currentTime;
        if (!v.paused) bg.play().catch(() => {});
      }

      const a = narrationAudioRef.current;
      if (!a || renderedVideo || !audioGenerated || !fullAudioUrl || hasSegmentAudios) return;
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
      if (!a || renderedVideo || !audioGenerated || !fullAudioUrl || hasSegmentAudios) return;
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
      const bg = cleanBgAudioRef?.current;
      if (bg && v) {
        bg.playbackRate = v.playbackRate || 1.0;
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

  // Fast binary search helper for sorted time intervals
  const findIntervalAtTime = (intervals, t) => {
    if (!intervals || intervals.length === 0) return false;
    let low = 0;
    let high = intervals.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const intv = intervals[mid];
      if (t >= intv.start && t <= intv.end) return true;
      if (t < intv.start) high = mid - 1;
      else low = mid + 1;
    }
    return false;
  };

  // Real-time Live Smart Ducking during Video Preview (O(log N) optimized)
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

    const isSpeaking = findIntervalAtTime(speakingIntervals, currentTime);

    // Live Mute for muted video clips (Mute Original Audio per-clip)
    const isCurrentVideoClipMuted = Array.isArray(videoClips) && videoClips.some((c) => {
      const cStart = Number.isFinite(c.start) ? c.start : 0;
      const cEnd = Number.isFinite(c.end) ? c.end : 0;
      return c.isMuted && currentTime >= (cStart - 0.02) && currentTime < cEnd;
    });

    const isDemucsActive = Boolean(voiceSettings?.enableDemucs && cleanBgAudioUrl);

    if (duckVal === 0 || isCurrentVideoClipMuted || isDemucsActive) {
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

    // Clean Demucs BGM playback during Live Preview (Zero Chinese Dialogue)
    if (cleanBgAudioRef.current && isDemucsActive) {
      const bgAudio = cleanBgAudioRef.current;
      const targetBgmVol = isSpeaking
        ? Math.min(1.0, Math.max(0, duckVal))
        : (speakingIntervals.length > 0 && duckVal > 0.05
            ? Math.min(1.0, duckVal * 1.4)
            : Math.min(1.0, Math.max(0, duckVal)));

      if (Math.abs(bgAudio.volume - targetBgmVol) > 0.001) {
        bgAudio.volume = targetBgmVol;
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
      const r = v.videoWidth / v.videoHeight;
      setVideoMeta({
        width: v.videoWidth,
        height: v.videoHeight,
        ratio: r,
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

  // Pre-index segment intervals once per script update for O(log N) lookup during playback
  const indexedSegments = React.useMemo(() => {
    if (!scriptData?.segments || scriptData.segments.length === 0) return [];
    return scriptData.segments.map((seg) => {
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

      if (isNaN(e) || e <= s || (e - s) < 0.6) {
        const textLen = String(seg.khmer || seg.khmerText || seg.khmerTranslatedText || seg.original || '').trim().length || 8;
        e = s + Math.max(1.8, Math.min(6.0, textLen * 0.16));
      }
      return { start: s, end: e, seg };
    });
  }, [scriptData?.segments]);

  // Fast O(log N) active segment lookup for smooth 60fps subtitle overlay
  const activeSegment = React.useMemo(() => {
    if (!indexedSegments || indexedSegments.length === 0) return null;
    const t = effectiveTimelineTime;
    let low = 0;
    let high = indexedSegments.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const item = indexedSegments[mid];
      if (t >= item.start && t < (item.end - 0.001)) {
        return item.seg;
      }
      if (t < item.start) {
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }
    return null;
  }, [indexedSegments, effectiveTimelineTime]);

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      if (containerRef.current.requestFullscreen) {
        containerRef.current.requestFullscreen().catch((err) => {
          console.warn('Container requestFullscreen notice:', err);
          if (videoRef?.current && videoRef.current.requestFullscreen) {
            videoRef.current.requestFullscreen().catch(() => {});
          }
        });
      } else if (containerRef.current.webkitRequestFullscreen) {
        containerRef.current.webkitRequestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
    }
  };

  const getCanvasAspectRatio = () => '16/9';

  return (
    <div className={`capcut-player-panel ${isFullscreen ? 'is-fullscreen-active' : ''}`} ref={containerRef}>
      {/* Player Top Bar */}
      <PlayerTopBar
        renderedVideo={renderedVideo}
        onResetToPreview={onResetToPreview || (() => setRenderedVideo && setRenderedVideo(null))}
        selectedVideo={selectedVideo}
        videoMeta={videoMeta}
        toggleFullscreen={toggleFullscreen}
        isFullscreen={isFullscreen}
      />

      {/* Video View Canvas (Fixed 1920x1080 Landscape 16:9) */}
      <div className={`player-canvas-container is-full-view ${isFullscreen ? 'is-fullscreen' : ''}`}>
        <div
          className={`player-canvas-area is-full-view ${isFullscreen ? 'is-fullscreen' : ''}`}
          style={{
            width: '100%',
            height: '100%',
            maxWidth: '100%',
            maxHeight: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#000000',
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
                onDoubleClick={toggleFullscreen}
                onEnded={onEnded}
                style={{
                  width: '100%',
                  height: '100%',
                  maxWidth: '100%',
                  maxHeight: '100%',
                  objectFit: 'contain',
                  cursor: 'pointer',
                  display: 'block',
                  backgroundColor: '#000000',
                }}
              />

              {/* Real-time Synchronized Khmer AI Dubbing Audio Element (Fallback for monolithic audio when no segment clips exist) */}
              {!renderedVideo && !hasSegmentAudios && audioGenerated && fullAudioUrl && (
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

              {/* Clean Demucs BGM Audio Element (Zero Chinese speech during Live Preview) */}
              {!renderedVideo && voiceSettings?.enableDemucs && cleanBgAudioUrl && (
                <audio
                  ref={cleanBgAudioRef}
                  src={cleanBgAudioUrl}
                  preload="auto"
                  onLoadedMetadata={() => {
                    const v = videoRef?.current;
                    const bg = cleanBgAudioRef?.current;
                    if (v && bg) {
                      bg.currentTime = v.currentTime || 0;
                      if (!v.paused) bg.play().catch(() => {});
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
