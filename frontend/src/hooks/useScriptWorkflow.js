import { useState, useEffect } from 'react';
import { generateScriptApi, startGenerationJob, getJobStatus, cancelJobApi } from '../services/api';
import { buildSpeakerRegistry, applySpeakerVoiceToSegments } from '../utils/speakerUtils';
import { sanitizeScriptData } from '../utils/timelineUtils';

/**
 * Custom hook to handle Gemini Flash AI script generation workflow and state
 */
export function useScriptWorkflow({
  selectedVideo,
  apiKey,
  scriptData,
  setScriptData,
  speakerRegistry,
  setSpeakerRegistry,
  setAudioGenerated,
  setAudioOutdated,
  setFullAudioPath,
  setFullAudioUrl,
  setSelectedSegmentId,
  duration,
  videoRef,
  setVideoClips,
  setActiveClipId,
  activeRequestRef,
  seriesId,
  episodeId,
  seriesGlossary,
  onSaveEpisodeBackground,
  onNavigateToTab = null,
  onInvalidateRenderedPreview = null,
}) {
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const [generatingEpisodeId, setGeneratingEpisodeId] = useState(null);
  const [scriptProgress, setScriptProgress] = useState(0);
  const [scriptStage, setScriptStage] = useState('');
  const [scriptLogs, setScriptLogs] = useState([]);
  const [scriptError, setScriptError] = useState(null);

  // Sync currently viewed episode to activeRequestRef without creating an extra hook
  if (activeRequestRef?.current) {
    activeRequestRef.current.activeEpisodeId = episodeId;
  }

  // Cleanup abort controller on unmount
  useEffect(() => {
    return () => {
      if (activeRequestRef?.current?.abortController) {
        activeRequestRef.current.abortController.abort();
      }
    };
  }, []);

  const handleGenerateScript = async (params = {}) => {
    if (isGeneratingScript) {
      console.warn('[useScriptWorkflow] Generation already in progress. Ignoring duplicate trigger.');
      return;
    }

    if (!selectedVideo || !selectedVideo.videoId) {
      alert('សូម Import វីដេអូរឿងភាគជាមុនសិន!');
      return;
    }

    const targetVideoId = selectedVideo.videoId;
    const targetFileName = selectedVideo.fileName;
    const targetEpisodeId = episodeId;
    const targetSeriesId = seriesId;
    const mode = typeof params === 'object' && params.mode ? params.mode : 'dialogue';
    const generationMode = typeof params === 'object' && params.generationMode
      ? params.generationMode
      : (mode === 'fast_ocr' ? 'fast_ocr' : 'standard');
    const force = typeof params === 'object' && Boolean(params.force);
    const confirmed = typeof params === 'object' && Boolean(params.confirmed);
    const recapStyle = mode === 'dialogue'
      ? 'standard'
      : (typeof params === 'object' && params.recapStyle ? params.recapStyle : 'story_recap');
    const narratorGender = typeof params === 'object' && params.narratorGender ? params.narratorGender : 'male';
    const genre = typeof params === 'object' && params.genre ? params.genre : 'auto';
    const customPrompt = typeof params === 'object' ? (params.customPrompt || '') : String(params || '');

    // In-flight guard: prevent accidental double-clicks from spawning duplicate jobs
    if (isGeneratingScript && generatingEpisodeId === targetEpisodeId) {
      console.warn('[useScriptWorkflow] Generation already in flight for episode:', targetEpisodeId);
      return;
    }

    // 1. Abort previous generation request
    if (activeRequestRef?.current?.abortController) {
      activeRequestRef.current.abortController.abort();
      if (activeRequestRef.current.jobId) {
        cancelJobApi(activeRequestRef.current.jobId).catch(() => {});
      }
    }

    const abortController = new AbortController();
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    if (activeRequestRef) {
      activeRequestRef.current = {
        requestId,
        videoId: targetVideoId,
        seriesId: targetSeriesId,
        episodeId: targetEpisodeId,
        mode,
        abortController,
        jobId: null,
      };
    }

    setIsGeneratingScript(true);
    setGeneratingEpisodeId(targetEpisodeId);
    setScriptError(null);
    setScriptProgress(0); // Honest progress
    setScriptLogs([]);
    setScriptStage(
      mode === 'dialogue'
        ? '1/5 Ingesting & Analyzing Source Media (FFprobe)...'
        : '1/5 Ingesting & Analyzing Source Narrative Media...'
    );

    let activeJobId = null;
    let response = null;

    try {
      // Step A: Attempt async background job with real-time stage & chunk polling
      try {
        const jobInit = await startGenerationJob({
          videoPath: targetVideoId,
          videoId: targetVideoId,
          videoFileName: targetFileName,
          mode,
          generationMode,
          recapStyle,
          narratorGender,
          genre,
          customPrompt,
          apiKey: apiKey || undefined,
          seriesId: targetSeriesId,
          episodeId: targetEpisodeId,
          seriesGlossary,
          force,
          confirmed,
        });

        if (jobInit && jobInit.jobId) {
          activeJobId = jobInit.jobId;
          if (activeRequestRef?.current) {
            activeRequestRef.current.jobId = activeJobId;
          }

          while (!abortController.signal.aborted) {
            await new Promise((r) => setTimeout(r, 1200));
            if (abortController.signal.aborted) break;

            const jobStatus = await getJobStatus(activeJobId, {
              seriesId: targetSeriesId,
              episodeId: targetEpisodeId,
              signal: abortController.signal,
            }).catch(() => null);

            if (jobStatus) {
              if (typeof jobStatus.progress === 'number') {
                setScriptProgress(jobStatus.progress);
              }
              if (jobStatus.message) {
                setScriptStage(jobStatus.message);
              } else if (jobStatus.stage) {
                setScriptStage(jobStatus.stage);
              }
              if (Array.isArray(jobStatus.logs) && jobStatus.logs.length > 0) {
                setScriptLogs(jobStatus.logs);
              }

              if (jobStatus.status === 'completed') {
                response = {
                  success: true,
                  data: jobStatus.finalResult,
                  jobId: activeJobId,
                  videoId: targetVideoId,
                  episodeId: targetEpisodeId,
                };
                break;
              }

              if (jobStatus.status === 'failed') {
                throw new Error(jobStatus.error || 'Pipeline job failed');
              }

              if (jobStatus.status === 'cancelled') {
                const cancelErr = new Error('Job was cancelled');
                cancelErr.name = 'AbortError';
                throw cancelErr;
              }
            }
          }
        }
      } catch (jobErr) {
        if (jobErr.name === 'AbortError') throw jobErr;

        // Check for 409 DUPLICATE_ACTIVE_JOB
        const isDuplicate = jobErr.status === 409 || jobErr.data?.code === 'DUPLICATE_ACTIVE_JOB';
        if (isDuplicate) {
          const existingJobId = jobErr.data?.existingJobId;
          console.warn(`[useScriptWorkflow] Active job detected (#${existingJobId}). Preventing direct pipeline race condition.`);
          
          if (existingJobId && existingJobId !== 'direct_lock' && !existingJobId.startsWith('lock_')) {
            // Re-bind to monitor the existing active job instead of causing concurrency conflicts
            activeJobId = existingJobId;
            setScriptStage(`មាន Job កំពុងដំណើរការ (#${activeJobId})។ កំពុងភ្ជាប់ទៅតាមដាន...`);
            
            while (!abortController.signal.aborted) {
              await new Promise((r) => setTimeout(r, 1200));
              if (abortController.signal.aborted) break;

              const jobStatus = await getJobStatus(activeJobId, {
                seriesId: targetSeriesId,
                episodeId: targetEpisodeId,
                signal: abortController.signal,
              }).catch(() => null);

              if (jobStatus) {
                if (typeof jobStatus.progress === 'number') {
                  setScriptProgress(jobStatus.progress);
                }
                if (jobStatus.message) {
                  setScriptStage(jobStatus.message);
                } else if (jobStatus.stage) {
                  setScriptStage(jobStatus.stage);
                }
                if (Array.isArray(jobStatus.logs) && jobStatus.logs.length > 0) {
                  setScriptLogs(jobStatus.logs);
                }

                if (jobStatus.status === 'completed') {
                  response = {
                    success: true,
                    data: jobStatus.finalResult,
                    jobId: activeJobId,
                    videoId: targetVideoId,
                    episodeId: targetEpisodeId,
                  };
                  break;
                }

                if (jobStatus.status === 'failed') {
                  throw new Error(jobStatus.error || 'Pipeline job failed');
                }

                if (jobStatus.status === 'cancelled') {
                  const cancelErr = new Error('Job was cancelled');
                  cancelErr.name = 'AbortError';
                  throw cancelErr;
                }
              }
            }
          } else {
            // Cannot bind or direct lock held by another process: halt safely without direct pipeline fallback
            setScriptError(jobErr.data?.error || jobErr.message || 'មាន Job ឬដំណើរការមួយកំពុងដំណើរការសម្រាប់ភាគនេះរួចហើយ');
            setIsGeneratingScript(false);
            setGeneratingEpisodeId(null);
            return;
          }
        } else {
          // If a job was already started/accepted (activeJobId exists), any failure is an actual job failure.
          // Show the true error and NEVER launch a duplicate second pipeline!
          if (activeJobId) {
            throw jobErr;
          }
          // If aborted/cancelled, never fallback
          if (jobErr.name === 'AbortError' || abortController.signal.aborted) {
            throw jobErr;
          }
          // Do not fallback on client validation or authentication errors
          if (jobErr.status === 400 || jobErr.status === 401 || jobErr.status === 403) {
            throw jobErr;
          }
          console.warn('[useScriptWorkflow] Background job API unavailable, falling back to direct pipeline:', jobErr.message);
        }
      }

      // Step B: Fallback to direct synchronous generation ONLY if background job was never started, not cancelled, and no response yet
      if (!response && !activeJobId && !abortController.signal.aborted) {
        response = await generateScriptApi({
          videoId: targetVideoId,
          mode,
          generationMode,
          recapStyle,
          narratorGender,
          genre,
          customPrompt,
          apiKey: apiKey || undefined,
          requestId,
          seriesId: targetSeriesId,
          episodeId: targetEpisodeId,
          seriesGlossary,
          force,
          confirmed,
          signal: abortController.signal,
        });
      }

      // 2. Race condition, video, episode & mode identity guard
      const isStillActive =
        activeRequestRef?.current?.requestId === requestId &&
        activeRequestRef?.current?.videoId === targetVideoId &&
        (!targetEpisodeId || activeRequestRef?.current?.episodeId === targetEpisodeId) &&
        activeRequestRef?.current?.mode === mode;

      if (!isStillActive) {
        console.log(`[Stale Request Guard] Preserving background response ${requestId} for video ${targetVideoId} ep ${targetEpisodeId}`);
        // Safely persist to background storage for targetEpisodeId so work is preserved without corrupting active workspace
        if (onSaveEpisodeBackground && response?.data && targetEpisodeId) {
          const rawSegs = response.data.segments || [];
          const existingBgReg = seriesGlossary?.seriesSpeakerMap || {};
          const bgRegistry = buildSpeakerRegistry(rawSegs, existingBgReg);
          const bgSegsWithVoices = applySpeakerVoiceToSegments(rawSegs, bgRegistry);
          onSaveEpisodeBackground(targetEpisodeId, {
            scriptData: {
              ...response.data,
              videoId: targetVideoId,
              episodeId: targetEpisodeId,
              seriesId: targetSeriesId,
              mode: response.data.mode || mode,
              segments: bgSegsWithVoices,
              speakerRegistry: bgRegistry,
              updatedAt: Date.now(),
            },
            speakerRegistry: bgRegistry,
            renderedVideo: null,
            renderInvalidatedAt: Date.now(),
          });
        }
        return;
      }

      setScriptProgress(100);
      setScriptStage('✅ បង្កើត Script ជោគជ័យ 100%!');
      await new Promise((r) => setTimeout(r, 400));

      const returnedData = response.data;
      const rawSegments = returnedData?.segments || [];

      // 3. Build speaker registry, preserving confirmed series memory and manual user corrections
      const existingReg = (speakerRegistry && Object.keys(speakerRegistry).length > 0)
        ? speakerRegistry
        : (seriesGlossary?.seriesSpeakerMap || {});
      const freshRegistry = buildSpeakerRegistry(rawSegments, existingReg);
      const segmentsWithVoices = applySpeakerVoiceToSegments(rawSegments, freshRegistry);

      const validatedScript = {
        ...returnedData,
        videoId: targetVideoId,
        seriesId: targetSeriesId,
        episodeId: targetEpisodeId,
        mode: returnedData.mode || mode,
        segments: segmentsWithVoices,
        speakerRegistry: freshRegistry,
        updatedAt: Date.now(),
      };

      // 4. Update the active workspace
      if (selectedVideo?.videoId === targetVideoId) {
        if (typeof onInvalidateRenderedPreview === 'function') {
          onInvalidateRenderedPreview(targetEpisodeId);
        }
        setSpeakerRegistry(freshRegistry);
        setScriptData(sanitizeScriptData(validatedScript));
        setAudioGenerated(false);
        setAudioOutdated(false);
        setFullAudioPath(null);
        setFullAudioUrl(null);

        if (rawSegments.length > 0 && setSelectedSegmentId) {
          setSelectedSegmentId(rawSegments[0]?.id || 0);
        }

        const totalDur = duration > 0 ? duration : (videoRef?.current?.duration || 0);
        if (totalDur > 0) {
          const fullClip = [
            { 
              id: `clip-${Date.now()}`, 
              start: 0, 
              end: totalDur, 
              sourceStart: 0, 
              sourceEnd: totalDur, 
              name: targetFileName || 'Full Video' 
            },
          ];
          setVideoClips(fullClip);
          setActiveClipId(fullClip[0]?.id || null);
        }

        // Auto-navigate to Step 3: Script & Subs for immediate review
        if (onNavigateToTab) {
          setTimeout(() => {
            onNavigateToTab('subtitles');
          }, 350);
        }
      }
    } catch (err) {
      setScriptProgress(0);
      setScriptStage('');
      if (err.name === 'AbortError') {
        console.log(`Request ${requestId} for video ${targetVideoId} aborted cleanly.`);
        return;
      }
      if (activeRequestRef?.current?.requestId === requestId) {
        console.error('Script generation error:', err);
        let msg = err.message || 'Error generating script';
        if (msg.includes('503') || msg.includes('high demand') || msg.includes('Service Unavailable')) {
          msg = 'ម៉ាស៊ីនបម្រើ Google Gemini កំពុងមមាញឹកខ្លាំង (503 High Demand)។ សូមរង់ចាំប្រហែល ៥ វិនាទី រួចចុច Generate Script ម្តងទៀត។';
        } else if (msg.includes('ACCESS_TOKEN_TYPE_UNSUPPORTED') || msg.includes('API key not valid') || msg.includes('UNAUTHENTICATED')) {
          msg = '❌ Gemini API Key មិនត្រឹមត្រូវ (Error 401)៖ Key ក្នុង .env ផ្ដើមដោយ "AQ..." គឺ OAuth Token មិនមែនជា Gemini Key ទេ។ សូមប្រើ Key ដែលផ្ដើមដោយ "AIzaSy..." ពី Google AI Studio (aistudio.google.com/apikey)។';
        }
        setScriptError(msg);
      }
    } finally {
      if (activeRequestRef?.current?.requestId === requestId) {
        activeRequestRef.current.abortController = null;
      }
      setIsGeneratingScript(false);
      setGeneratingEpisodeId(null);
      setTimeout(() => {
        setScriptProgress(0);
        setScriptStage('');
      }, 1200);
    }
  };

  const handleUpdateScript = (newScript) => {
    if (typeof onInvalidateRenderedPreview === 'function') {
      onInvalidateRenderedPreview();
    }
    if (newScript?.segments) {
      const updatedReg = buildSpeakerRegistry(newScript.segments, speakerRegistry);
      setSpeakerRegistry(updatedReg);
    }
    const stampedScript = newScript ? { ...newScript, updatedAt: Date.now() } : newScript;
    setScriptData(sanitizeScriptData(stampedScript));
  };

  return {
    isGeneratingScript,
    generatingEpisodeId,
    setIsGeneratingScript,
    scriptProgress,
    scriptStage,
    scriptLogs,
    scriptError,
    setScriptError,
    handleGenerateScript,
    handleUpdateScript,
  };
}
