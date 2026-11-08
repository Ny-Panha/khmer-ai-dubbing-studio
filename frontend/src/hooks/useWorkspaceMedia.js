import { useState, useCallback } from 'react';
import { fetchVideoMetadata, fetchVideoThumbnails } from '../services/api';
import { generateVideoThumbnails } from '../utils/thumbnailUtils';
import { clearActiveProject } from '../utils/projectStorage';

/**
 * Custom hook to manage workspace media: selected video, metadata, clips, thumbnails, and clip selection
 */
export function useWorkspaceMedia({
  activeRequestRef,
  duration,
  setDuration,
  setCurrentTime,
  setLeftTab,
  clearHistory,
  setRenderedVideo,
  setScriptData,
  setSpeakerRegistry,
  setAudioGenerated,
  setAudioOutdated,
  setFullAudioPath,
  setFullAudioUrl,
  setScriptError,
  setIsGeneratingScript,
}) {
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [videoMetadata, setVideoMetadata] = useState(null);
  const [videoClips, setVideoClips] = useState([]);
  const [mediaAssets, setMediaAssets] = useState([]);
  const [videoThumbnails, setVideoThumbnails] = useState([]);
  const [activeClipId, setActiveClipId] = useState(null);
  const [selectedSegmentId, setSelectedSegmentId] = useState(null);

  // Video Loaded Handler - CapCut style import into Media Bin and VIDEO 1 track
  const handleVideoLoaded = async (vid) => {
    if (!vid?.videoId) return;

    if (activeRequestRef?.current?.abortController) {
      activeRequestRef.current.abortController.abort();
      activeRequestRef.current = { requestId: null, videoId: null, abortController: null };
    }

    const cleanOriginalName = vid.originalFilename || vid.fileName || 'Video 1';
    const displayTitle = vid.displayTitle || cleanOriginalName.replace(/\.[^/.]+$/, '').trim();

    const normalizedVid = {
      ...vid,
      fileName: cleanOriginalName,
      originalFilename: cleanOriginalName,
      displayTitle,
    };

    setSelectedVideo(normalizedVid);
    setVideoMetadata(null);
    if (setRenderedVideo) setRenderedVideo(null);
    if (setScriptData) setScriptData(null);
    if (setSpeakerRegistry) setSpeakerRegistry({});
    if (setAudioGenerated) setAudioGenerated(false);
    if (setAudioOutdated) setAudioOutdated(false);
    if (setFullAudioPath) setFullAudioPath(null);
    if (setFullAudioUrl) setFullAudioUrl(null);
    if (setScriptError) setScriptError(null);
    if (setIsGeneratingScript) setIsGeneratingScript(false);

    // Track in Media Bin assets list
    setMediaAssets((prevAssets) => {
      const exists = (prevAssets || []).some((a) => a.videoId === vid.videoId || a.videoUrl === vid.videoUrl);
      if (exists) return prevAssets;
      return [
        ...(prevAssets || []),
        {
          id: `asset-${Date.now()}`,
          videoId: vid.videoId,
          videoUrl: vid.videoUrl,
          fileName: cleanOriginalName,
          originalFilename: cleanOriginalName,
          displayTitle,
          size: vid.size,
          sizeBytes: vid.sizeBytes,
          uploadedAt: vid.uploadedAt || Date.now(),
        },
      ];
    });

    // Determine initial clip duration (probe or sensible default instead of 0s)
    const knownDur = (typeof vid?.durationSec === 'number' && vid.durationSec > 0)
      ? vid.durationSec
      : (duration > 0 ? duration : 30);

    const initialClipId = `clip-${Date.now()}`;

    // Place imported video into timeline on VIDEO 1 track
    setVideoClips((prevClips) => {
      // If no clips or only empty dummy clip, start at 0
      if (!prevClips || prevClips.length === 0 || (prevClips.length === 1 && (!prevClips[0].end || prevClips[0].end <= 0.1))) {
        return [
          {
            id: initialClipId,
            trackId: 'video-1',
            trackRow: 0,
            start: 0,
            end: knownDur,
            sourceStart: 0,
            sourceEnd: knownDur,
            duration: knownDur,
            name: displayTitle || cleanOriginalName || 'Video 1',
            videoUrl: vid.videoUrl,
            videoId: vid.videoId,
          },
        ];
      }

      // If user already has clips (multi-video import), append to end of VIDEO 1 track
      const lastClip = prevClips[prevClips.length - 1];
      const newStart = Number.isFinite(lastClip?.end) ? lastClip.end : 0;
      const newEnd = parseFloat((newStart + knownDur).toFixed(2));
      return [
        ...prevClips,
        {
          id: initialClipId,
          trackId: 'video-1',
          trackRow: 0,
          start: newStart,
          end: newEnd,
          sourceStart: 0,
          sourceEnd: knownDur,
          duration: knownDur,
          name: vid.fileName || 'Video 1',
          videoUrl: vid.videoUrl,
          videoId: vid.videoId,
        },
      ];
    });

    setActiveClipId(initialClipId);
    setSelectedSegmentId(null);
    if (setDuration) setDuration((prev) => Math.max(prev || 0, knownDur));

    const getMetaWithRetry = async () => {
      try {
        return await fetchVideoMetadata(vid.videoId);
      } catch (firstErr) {
        // Wait 800ms and try once more in case backend was restarting
        await new Promise((r) => setTimeout(r, 800));
        return await fetchVideoMetadata(vid.videoId);
      }
    };

    try {
      const meta = await getMetaWithRetry();
      setVideoMetadata(meta);
      if (meta) {
        setSelectedVideo((prev) => (prev ? {
          ...prev,
          width: meta.width || prev.width,
          height: meta.height || prev.height,
          resolution: meta.resolution || prev.resolution,
          durationSec: meta.durationSec || prev.durationSec,
        } : prev));
      }
      if (meta?.durationSec) {
        const realDur = meta.durationSec;
        if (setDuration) setDuration((prev) => Math.max(prev || 0, realDur));

        // Update the clip's true duration on VIDEO 1 without breaking other clips
        setVideoClips((prevClips) => {
          if (!prevClips || prevClips.length === 0) {
            return [
              {
                id: initialClipId,
                trackId: 'video-1',
                trackRow: 0,
                start: 0,
                end: realDur,
                sourceStart: 0,
                sourceEnd: realDur,
                duration: realDur,
                name: vid.fileName || 'Video 1',
                videoUrl: vid.videoUrl,
                videoId: vid.videoId,
              },
            ];
          }
          return prevClips.map((c) => {
            if (c.id === initialClipId) {
              const clipLen = realDur;
              return {
                ...c,
                end: parseFloat((c.start + clipLen).toFixed(2)),
                sourceEnd: realDur,
                duration: realDur,
              };
            }
            return c;
          });
        });

        // Also update duration & resolution in mediaAssets
        setMediaAssets((prevAssets) =>
          (prevAssets || []).map((a) =>
            a.videoId === vid.videoId
              ? { ...a, durationSec: realDur, resolution: meta.resolution, fps: meta.fps }
              : a
          )
        );

        fetchVideoThumbnails(vid.videoId || vid.videoUrl, realDur).then((serverThumbs) => {
          if (Array.isArray(serverThumbs) && serverThumbs.length > 0) {
            setVideoThumbnails(serverThumbs);
          } else {
            generateVideoThumbnails(vid.videoUrl, realDur).then(setVideoThumbnails);
          }
        });
      } else {
        fetchVideoThumbnails(vid.videoId || vid.videoUrl, 30).then((serverThumbs) => {
          if (Array.isArray(serverThumbs) && serverThumbs.length > 0) {
            setVideoThumbnails(serverThumbs);
          } else {
            generateVideoThumbnails(vid.videoUrl, 30).then(setVideoThumbnails);
          }
        });
      }
    } catch (e) {
      console.warn('Could not fetch FFprobe metadata:', e.message);
      fetchVideoThumbnails(vid.videoId || vid.videoUrl, knownDur).then((serverThumbs) => {
        if (Array.isArray(serverThumbs) && serverThumbs.length > 0) {
          setVideoThumbnails(serverThumbs);
        } else {
          generateVideoThumbnails(vid.videoUrl, knownDur).then(setVideoThumbnails);
        }
      });
    }
  };

  // Remove/Clear active video from project
  const handleClearVideo = useCallback(() => {
    if (activeRequestRef?.current?.abortController) {
      activeRequestRef.current.abortController.abort();
      activeRequestRef.current = { requestId: null, videoId: null, abortController: null };
    }
    clearActiveProject();
    setSelectedVideo(null);
    setVideoMetadata(null);
    setVideoThumbnails([]);
    setVideoClips([]);
    setActiveClipId(null);
    if (setRenderedVideo) setRenderedVideo(null);
    if (setScriptData) setScriptData(null);
    if (setSpeakerRegistry) setSpeakerRegistry({});
    if (setAudioGenerated) setAudioGenerated(false);
    if (setAudioOutdated) setAudioOutdated(false);
    if (setFullAudioPath) setFullAudioPath(null);
    if (setFullAudioUrl) setFullAudioUrl(null);
    if (setScriptError) setScriptError(null);
    if (setIsGeneratingScript) setIsGeneratingScript(false);
    if (setCurrentTime) setCurrentTime(0);
    if (setDuration) setDuration(0);
    setSelectedSegmentId(null);
    if (clearHistory) clearHistory();
    if (setLeftTab) setLeftTab('media');
  }, [
    activeRequestRef,
    clearHistory,
    setLeftTab,
    setRenderedVideo,
    setScriptData,
    setSpeakerRegistry,
    setAudioGenerated,
    setAudioOutdated,
    setFullAudioPath,
    setFullAudioUrl,
    setScriptError,
    setIsGeneratingScript,
    setCurrentTime,
    setDuration,
  ]);

  // Add video clip to timeline on track VIDEO 1 (at current playhead or appended)
  const handleAddClipToTimeline = useCallback((insertTime = null, targetAsset = null) => {
    const asset = targetAsset || selectedVideo;
    if (!asset) return;

    const clipDur = (typeof asset.durationSec === 'number' && asset.durationSec > 0)
      ? asset.durationSec
      : (videoMetadata?.durationSec || (duration > 0 ? duration : 30));

    const newClipId = `clip-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;

    setVideoClips((prevClips) => {
      let newStart = 0;
      if (!prevClips || prevClips.length === 0) {
        // CapCut rule: First clip on empty timeline ALWAYS starts at 00:00!
        newStart = 0;
      } else if (typeof insertTime === 'number' && Number.isFinite(insertTime) && insertTime >= 0) {
        // CapCut magnetic snap: if insertTime is within 1.5s of 0, snap to 0!
        if (insertTime < 1.5) {
          newStart = 0;
        } else {
          const lastEnd = prevClips[prevClips.length - 1]?.end || 0;
          if (Math.abs(lastEnd - insertTime) < 1.2) {
            newStart = lastEnd;
          } else {
            newStart = parseFloat(insertTime.toFixed(2));
          }
        }
      } else if (prevClips && prevClips.length > 0) {
        const lastClip = prevClips[prevClips.length - 1];
        newStart = Number.isFinite(lastClip?.end) ? lastClip.end : 0;
      }

      const newEnd = parseFloat((newStart + clipDur).toFixed(2));
      const newClip = {
        id: newClipId,
        trackId: asset.targetTrackId || 'video-1',
        trackRow: typeof asset.targetTrackRow === 'number' ? asset.targetTrackRow : 0,
        name: asset.fileName || 'Video 1',
        start: newStart,
        end: newEnd,
        sourceStart: 0,
        sourceEnd: clipDur,
        duration: clipDur,
        videoUrl: asset.videoUrl,
        videoId: asset.videoId,
      };

      const updated = prevClips && prevClips.length > 0 ? [...prevClips, newClip] : [newClip];
      // Keep sorted chronologically by start time
      updated.sort((a, b) => (a.start || 0) - (b.start || 0));
      return updated;
    });

    setActiveClipId(newClipId);
    if (setDuration) {
      setDuration((prev) => Math.max(prev || 0, clipDur));
    }
  }, [selectedVideo, duration, videoMetadata, setDuration]);

  const selectedClip = videoClips.find((c) => c.id === activeClipId) || null;

  return {
    selectedVideo,
    setSelectedVideo,
    videoMetadata,
    setVideoMetadata,
    videoClips,
    setVideoClips,
    mediaAssets,
    setMediaAssets,
    videoThumbnails,
    setVideoThumbnails,
    activeClipId,
    setActiveClipId,
    selectedSegmentId,
    setSelectedSegmentId,
    selectedClip,
    handleVideoLoaded,
    handleClearVideo,
    handleAddClipToTimeline,
  };
}
