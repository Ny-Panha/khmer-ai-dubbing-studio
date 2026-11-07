import { useState } from 'react';
import { renderVideoApi } from '../services/api';

/**
 * Custom hook to manage final video export and FFmpeg rendering
 */
export function useVideoRender({
  selectedVideo,
  audioGenerated,
  speakerRegistry,
  voiceSettings,
  scriptData,
  videoClips,
  fullAudioPath,
  videoRef,
  setIsPlaying,
  seriesId = null,
  episodeId = null,
}) {
  const [renderedVideo, setRenderedVideo] = useState(null);
  const [isRendering, setIsRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderStage, setRenderStage] = useState('');

  // Render Final Dubbed Video via FFmpeg Backend
  const handleRenderVideo = async () => {
    if (!selectedVideo) {
      alert('សូម Import វីដេអូរឿងភាគចិនជាមុនសិន!');
      return;
    }

    if (!audioGenerated) {
      alert('សូមចុច "Generate Khmer Voice (TTS)" ដើម្បីបង្កើតសំឡេងខ្មែរ AI ជាមុនសិន!');
      return;
    }

    const speakerMap = {};
    Object.values(speakerRegistry || {}).forEach((spk) => {
      if (spk.voiceId) {
        speakerMap[spk.id] = spk.voiceId;
        speakerMap[spk.name] = spk.voiceId;
      }
    });

    setIsRendering(true);
    setRenderProgress(1);
    setRenderStage('1/4 បង្កើត Khmer .ASS Subtitles & ផ្ទុក Fonts...');

    let currentVal = 1;
    const progressTimer = setInterval(() => {
      if (currentVal < 25) {
        currentVal += 2;
        if (currentVal >= 25) {
          setRenderStage('2/4 រៀបចំ Smart Ducking 85% & កម្រិតសំឡេង...');
        }
      } else if (currentVal < 55) {
        currentVal += 1;
        if (currentVal >= 55) {
          setRenderStage('3/4 FFmpeg កំពុង Encode វីដេអូ & ដុត Subtitles...');
        }
      } else if (currentVal < 85) {
        currentVal += 1;
        if (currentVal >= 85) {
          setRenderStage('4/4 កំពុង Export ចូល Downloads Folder លើ PC...');
        }
      } else if (currentVal < 97) {
        if (Math.random() > 0.4) {
          currentVal += 1;
        }
      }
      setRenderProgress(Math.min(currentVal, 97));
    }, 280);

    try {
      const activeVoiceId = voiceSettings.voiceId || 'km-KH-PisethNeural';
      const activeSpeed = voiceSettings.speed || 'normal';

      const humanDisplayTitle = selectedVideo?.displayTitle 
        || selectedVideo?.originalFilename?.replace(/\.[^/.]+$/, '').trim()
        || (selectedVideo?.fileName && !/^ep_\d+/i.test(selectedVideo.fileName) ? selectedVideo.fileName.replace(/\.[^/.]+$/, '').trim() : '')
        || (scriptData?.title || 'Drama_Recap');
      const dramaName = humanDisplayTitle;

      const antiTheftOptions = {
        enabled: Boolean(voiceSettings.enableAntiTheft),
        marqueeText: voiceSettings.marqueeText || '«ហាមផុសបន្ត • សូមឱ្យតម្លៃលើការខិតខំរបស់ម្ចាស់ដើម»',
        marqueeSpeed: voiceSettings.marqueeSpeed || 'normal',
        marqueePosition: voiceSettings.marqueePosition || 'bottom',
        marqueeTextColor: voiceSettings.marqueeTextColor || '#FFE600',
        enableWatermark: voiceSettings.enableWatermark !== false,
        watermarkText: voiceSettings.watermarkText || 'រក្សាសិទ្ធិដោយ ៖ Holiday Kh Drama',
        watermarkPosition: voiceSettings.watermarkPosition || 'above-ticker',
        watermarkColor: voiceSettings.watermarkColor || '#38BDF8',
        antiTheftSize: voiceSettings.antiTheftSize || 'small',
      };

      const logoOptions = {
        enabled: Boolean(voiceSettings.enableLogo),
        image: voiceSettings.logoImage,
        position: voiceSettings.logoPosition || 'both',
        size: Number(voiceSettings.logoSize) || 72,
        opacity: Number(voiceSettings.logoOpacity) || 0.9,
        shape: voiceSettings.logoShape || 'circle',
        margin: Number(voiceSettings.logoMargin) || 20,
      };

      const result = await renderVideoApi({
        videoId: selectedVideo.videoId,
        projectName: dramaName,
        videoTitle: dramaName,
        seriesId,
        episodeId,
        segments: scriptData?.segments || [],
        videoClips: videoClips || [],
        fullAudioPath,
        duckingVolume: voiceSettings.duckingVolume,
        khmerVolume: voiceSettings.khmerVolume,
        enableDemucs: Boolean(voiceSettings.enableDemucs),
        burnSubtitles: voiceSettings.burnSubtitles,
        subtitleColor: voiceSettings.subtitleColor,
        subtitleSize: voiceSettings.subtitleSize,
        subtitleStyle: voiceSettings.subtitleStyle || 'banner',
        aspectRatio: voiceSettings.aspectRatio || '16:9',
        voiceId: activeVoiceId,
        speed: activeSpeed,
        speakerMap,
        antiTheft: antiTheftOptions,
        logoSettings: logoOptions,
      });

      clearInterval(progressTimer);
      setRenderProgress(100);
      setRenderStage('🎉 Render & Export ជោគជ័យ 100%!');
      await new Promise((r) => setTimeout(r, 600));

      setRenderedVideo(result);
      if (videoRef?.current) {
        videoRef.current.pause();
        if (setIsPlaying) setIsPlaying(false);
        videoRef.current.src = result.outputVideoUrl;
        videoRef.current.load();
      }

      // Automatically trigger browser download to user's Downloads folder
      try {
        const link = document.createElement('a');
        link.href = result.downloadUrl || result.outputVideoUrl;
        link.setAttribute('download', result.outputFilename || `${dramaName}_Khmer_Dubbed.mp4`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } catch (dlErr) {
        console.warn('Auto-download trigger error:', dlErr);
      }
    } catch (err) {
      clearInterval(progressTimer);
      setRenderProgress(0);
      setRenderStage('');
      console.error(err);
      alert('Export video failed: ' + err.message);
    } finally {
      clearInterval(progressTimer);
      setIsRendering(false);
      setTimeout(() => setRenderProgress(0), 1500);
    }
  };

  return {
    renderedVideo,
    setRenderedVideo,
    isRendering,
    setIsRendering,
    renderProgress,
    renderStage,
    handleRenderVideo,
  };
}
