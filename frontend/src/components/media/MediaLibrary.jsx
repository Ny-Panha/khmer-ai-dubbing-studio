import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Film, Sparkles, Subtitles, Layers, AlertCircle, Plus, CheckCircle2, ArrowRight } from 'lucide-react';
import { uploadVideoFile } from '../../services/api';
import { parseTimeToSeconds, parseTimestampToSeconds, formatMinSec } from '../../utils/timestampUtils';
import { deleteSegmentByIdOrIndex } from '../../utils/timelineUtils';
import { filterScriptSegments } from '../../utils/scriptSearchUtils';

import MediaUploadTab from './MediaUploadTab';
import DubbingModeTab from './DubbingModeTab';
import ScriptReviewTab from './ScriptReviewTab';
import EpisodesTab from './EpisodesTab';
import './MediaLibrary.css';

const RECAP_PRESETS = [
  {
    id: 'story_recap',
    title: 'សម្រាយសាច់រឿងកុន (Story Narration / Recap)',
    sub: 'និទានដំណើររឿងរស់រវើក ចរិតតួអង្គ & បែប TikTok / Reels (ពេញមួយរឿង 100+ ឃ្លា)',
    icon: Sparkles,
    prompt: 'សម្រាយសាច់រឿងវីដេអូនេះជាភាសាខ្មែរបែបកុនរស់រវើក មានការពិពណ៌នាសាច់រឿង ចរិតតួអង្គ ឈុតឆាកទាក់ទាញ និងភាពរំភើបជក់ចិត្ត (បែប TikTok / Reels) ពេញមួយវីដេអូតាំងពីដើមដល់ចប់។',
  },
  {
    id: 'fast_recap',
    title: 'សង្ខេបដំណើររឿងរហ័ស (Fast-Paced Action Recap)',
    sub: 'សង្ខេបព្រឹត្តិការណ៍សំខាន់ៗលឿនៗ ខ្លីខ្លឹម មិនទុកពេលទំនេរយូរ (បែប TikTok វីដេអូខ្លី)',
    icon: Film,
    prompt: 'សង្ខេបដំណើររឿងវីដេអូនេះជាភាសាខ្មែររហ័សខ្លីខ្លឹម ផ្តោតលើចំណុចសំខាន់ៗនៃសាច់រឿង និងឈុតឆាកក្តៅគគុកដោយគ្មានចន្លោះស្ងាត់យូរឡើយ។',
  },
];

const EMPTY_SEGMENTS = Object.freeze([]);

function MediaLibrary({
  selectedVideo,
  videoMetadata,
  onVideoSelected,
  scriptData,
  onUpdateScript,
  onGenerateScript,
  isGeneratingScript,
  generatingEpisodeId = null,
  scriptProgress = 0,
  scriptStage = '',
  scriptLogs = [],
  scriptError,
  activeTab = 'media',
  onTabChange,
  onNavigateToVoice,
  isGeneratingAudio = false,
  generatingAudioEpisodeId = null,
  audioProgress = 0,
  audioStage = '',
  onRegenerateSegment,
  onTranslateSegment = null,
  onUpdateSegmentText = null,
  speakerRegistry = {},
  onUpdateSpeakerVoice = null,
  onUpdateSegmentVoice = null,
  selectedSegmentId = null,
  onSelectSegment = null,
  onDeleteSegment = null,
  onUpdateSegments = null,
  onToggleDeliveryType = null,
  videoThumbnails = [],
  videoClips = [],
  mediaAssets = [],
  currentTime = 0,
  duration = 0,
  onAddClipToTimeline = null,
  onRemoveVideo = null,
  seriesList = [],
  activeSeries = null,
  activeEpisode = null,
  seriesId = null,
  episodeId = null,
  seriesGlossary = null,
  onSwitchEpisode = null,
  onCreateEpisode = null,
  onDeleteEpisode = null,
  onRenameEpisode = null,
  onRenameSeries = null,
  onRefreshSeries = null,
  apiKey = null,
}) {
  const [dubbingMode, setDubbingMode] = useState('dialogue');
  const [recapStyle, setRecapStyle] = useState('story_recap');
  const [promptInput, setPromptInput] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [playingSegmentId, setPlayingSegmentId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showImportModal, setShowImportModal] = useState(false);
  const [pendingUploadFile, setPendingUploadFile] = useState(null);
  const audioRef = useRef(null);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.removeAttribute('src');
      }
    };
  }, []);

  const executeUpload = async (file, targetEpId) => {
    setIsUploading(true);
    setUploadError(null);

    try {
      const vidObj = await uploadVideoFile(file, { seriesId, episodeId: targetEpId });
      onVideoSelected(vidObj);
      if (onTabChange) onTabChange('script');
    } catch (err) {
      console.error(err);
      setUploadError(err.message || 'Upload failed');
    } finally {
      setIsUploading(false);
      setPendingUploadFile(null);
      setShowImportModal(false);
    }
  };

  const handleFileUpload = async (e, explicitEpisodeId = null) => {
    const file = e?.target?.files?.[0] || (e instanceof File ? e : null);
    if (!file) return;

    if (explicitEpisodeId) {
      if (explicitEpisodeId !== episodeId && onSwitchEpisode) {
        onSwitchEpisode(explicitEpisodeId);
      }
      await executeUpload(file, explicitEpisodeId);
      return;
    }

    // If current episode already has a video loaded, prompt user to avoid accidental overwrite
    if (selectedVideo?.videoId) {
      setPendingUploadFile(file);
      setShowImportModal(true);
      return;
    }

    // Otherwise, upload directly to current episode
    await executeUpload(file, episodeId);
  };

  const handleConfirmCreateNewEpisode = async () => {
    if (!pendingUploadFile) return;
    const newEp = onCreateEpisode ? onCreateEpisode() : null;
    const targetEpId = newEp ? newEp.id : episodeId;
    await executeUpload(pendingUploadFile, targetEpId);
  };

  const handleConfirmReplaceCurrentVideo = async () => {
    if (!pendingUploadFile) return;
    await executeUpload(pendingUploadFile, episodeId);
  };

  const handleTriggerScript = (options = {}) => {
    if (!selectedVideo?.videoId) return;
    const targetGenMode = options?.generationMode || (dubbingMode === 'fast_ocr' ? 'fast_ocr' : 'standard');
    onGenerateScript({
      videoId: selectedVideo.videoId,
      mode: targetGenMode === 'fast_ocr' ? 'fast_ocr' : dubbingMode,
      generationMode: targetGenMode,
      recapStyle: dubbingMode === 'dialogue' ? 'standard' : (recapStyle || 'story_recap'),
      narratorGender: options?.narratorGender || 'male',
      genre: options?.genre || 'auto',
      customPrompt: promptInput.trim(),
      force: Boolean(options?.force),
      confirmed: Boolean(options?.confirmed),
    });
  };

  const handleSegmentChange = useCallback((index, field, value) => {
    const updated = [...(scriptData?.segments || [])];
    const item = { ...updated[index], [field]: value };
    if (field === 'start') {
      const parsed = parseTimestampToSeconds(value);
      if (parsed.valid && parsed.value !== null) {
        item.startSec = parsed.value;
        item.audioStartSec = parsed.value;
        item.audioStart = value;
        item.userShifted = true;
      }
    } else if (field === 'end') {
      const parsed = parseTimestampToSeconds(value);
      if (parsed.valid && parsed.value !== null) {
        item.endSec = parsed.value;
        item.audioEndSec = parsed.value;
        item.audioEnd = value;
      }
    } else if (field === 'khmer') {
      item.audioOutdated = true;
      item.khmer = value;
      item.khmerText = value;
      if (onUpdateSegmentText) {
        onUpdateSegmentText(item.id || index, value, false, index);
        return;
      }
    }
    updated[index] = item;
    if (onUpdateSegments) {
      onUpdateSegments(updated, false, true);
    } else if (onUpdateScript) {
      onUpdateScript({
        ...scriptData,
        segments: updated,
      });
    }
  }, [scriptData, onUpdateSegmentText, onUpdateSegments, onUpdateScript]);

  const handleSegmentBlur = useCallback(async (idx, explicitText = null) => {
    const targetSeg = scriptData?.segments?.[idx];
    if (!targetSeg) return;
    const cleanText = explicitText !== null ? String(explicitText).trim() : (targetSeg.khmer || targetSeg.khmerText || '').trim();
    if (!cleanText) return;
    if (onUpdateSegmentText) {
      await onUpdateSegmentText(targetSeg.id || idx, cleanText, false, idx);
    }
  }, [scriptData, onUpdateSegmentText]);

  const handleBridgeGaps = useCallback(() => {
    if (!scriptData?.segments || scriptData.segments.length <= 1) return;
    const updated = scriptData.segments.map((seg, idx, arr) => {
      if (idx < arr.length - 1) {
        const next = arr[idx + 1];
        const currEndSec = typeof seg.endSec === 'number' ? seg.endSec : parseTimeToSeconds(seg.end, 0);
        const nextStartSec = typeof next.startSec === 'number' ? next.startSec : parseTimeToSeconds(next.start, 0);
        if (nextStartSec > currEndSec && (nextStartSec - currEndSec) <= 6) {
          return {
            ...seg,
            end: next.start,
            endSec: nextStartSec,
          };
        }
      }
      return seg;
    });
    onUpdateScript({
      ...scriptData,
      segments: updated,
    });
  }, [scriptData, onUpdateScript]);

  const handleAddSegment = useCallback(() => {
    const last = scriptData?.segments?.[scriptData.segments.length - 1];
    const newId = (scriptData?.segments?.length || 0) + 1;
    const startSec = last
      ? (typeof last.endSec === 'number' ? last.endSec : parseTimeToSeconds(last.end, 0))
      : 0;
    const endSec = parseFloat((startSec + 4.0).toFixed(2));
    const newSegment = {
      id: newId,
      start: formatMinSec(startSec),
      end: formatMinSec(endSec),
      startSec,
      endSec,
      khmer: '',
      original: '',
      speaker: 'Speaker',
      status: 'pending',
    };
    onUpdateScript({
      ...scriptData,
      segments: [...(scriptData?.segments || []), newSegment],
    });
  }, [scriptData, onUpdateScript]);

  const handleDeleteSegment = useCallback((segIdOrIdx) => {
    if (onDeleteSegment) {
      onDeleteSegment(segIdOrIdx);
      return;
    }
    const updated = deleteSegmentByIdOrIndex(scriptData?.segments || [], segIdOrIdx);
    if (onUpdateSegments) {
      onUpdateSegments(updated);
    } else if (onUpdateScript) {
      onUpdateScript({
        ...scriptData,
        segments: updated,
      });
    }
  }, [onDeleteSegment, scriptData, onUpdateSegments, onUpdateScript]);

  const handlePlayLine = useCallback((url, segId) => {
    if (!url) return;
    if (playingSegmentId === segId && audioRef.current && !audioRef.current.paused) {
      audioRef.current.pause();
      setPlayingSegmentId(null);
      return;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute('src');
    }
    const a = new Audio(url);
    audioRef.current = a;
    setPlayingSegmentId(segId);
    a.play().catch((err) => {
      if (err.name !== 'AbortError') console.warn('Line play error:', err);
      setPlayingSegmentId(null);
    });
    a.onended = () => setPlayingSegmentId(null);
    a.onerror = () => setPlayingSegmentId(null);
  }, [playingSegmentId]);

  const filteredSegments = useMemo(() => {
    if (!scriptData?.segments) return EMPTY_SEGMENTS;
    return filterScriptSegments(scriptData.segments, searchQuery);
  }, [scriptData?.segments, searchQuery]);

  return (
    <div className="capcut-media-panel">
      {/* Navigation Tabs: 4 Clean Workflow Steps */}
      <div className="media-tabs-header">
        <button
          onClick={() => onTabChange && onTabChange('episodes')}
          className={`media-tab-btn ${activeTab === 'episodes' ? 'active' : ''}`}
          title="គ្រប់គ្រងភាគទាំងអស់ / Episodes Manager & Auto-Split"
        >
          <Layers size={13} />
          <span>Episodes</span>
          {activeSeries?.episodes?.length > 0 && (
            <span className="tab-badge" style={{ background: 'rgba(76, 141, 255, 0.2)', color: 'var(--primary-accent)' }}>
              {activeSeries.episodes.length}
            </span>
          )}
        </button>
        <button
          onClick={() => onTabChange && onTabChange('media')}
          className={`media-tab-btn ${activeTab === 'media' ? 'active' : ''}`}
          title="1. វីដេអូដើម / Original Video File"
        >
          <Film size={13} />
          <span>1. វីដេអូ</span>
          {selectedVideo && (
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#34d399', marginLeft: 3 }} />
          )}
        </button>

        <button
          onClick={() => onTabChange && onTabChange('script')}
          className={`media-tab-btn ${activeTab === 'script' ? 'active' : ''}`}
          title="2. បញ្ចូលសំឡេង AI / AI Dialogue Translation & Recap Generator"
        >
          <Sparkles size={13} />
          <span>2. សំឡេង AI</span>
          {scriptData?.segments && (
            <span className="tab-badge">{scriptData.segments.length}</span>
          )}
        </button>

        <button
          onClick={() => onTabChange && onTabChange('subtitles')}
          className={`media-tab-btn ${activeTab === 'subtitles' ? 'active' : ''}`}
          title="3. កែសម្រួលអត្ថបទ / Khmer Script & Subtitles Editor"
        >
          <Subtitles size={13} />
          <span>3. អត្ថបទ</span>
          {scriptData?.segments && (
            <span className="tab-badge">{scriptData.segments.length}</span>
          )}
        </button>
      </div>

      {activeTab === 'episodes' && (
        <EpisodesTab
          seriesList={seriesList}
          activeSeries={activeSeries}
          activeEpisode={activeEpisode}
          selectedVideo={selectedVideo}
          videoMetadata={videoMetadata}
          duration={duration}
          seriesId={seriesId}
          episodeId={episodeId}
          seriesGlossary={seriesGlossary}
          onSwitchEpisode={onSwitchEpisode}
          onCreateEpisode={onCreateEpisode}
          onDeleteEpisode={onDeleteEpisode}
          onRenameEpisode={onRenameEpisode}
          onRenameSeries={onRenameSeries}
          onFileUpload={(file, targetEpId) => handleFileUpload(file, targetEpId)}
          isUploading={isUploading}
          onTabChange={onTabChange}
          onRefreshSeries={onRefreshSeries}
        />
      )}

      {activeTab === 'media' && (
        <MediaUploadTab
          isUploading={isUploading}
          handleFileUpload={handleFileUpload}
          uploadError={uploadError}
          selectedVideo={selectedVideo}
          videoMetadata={videoMetadata}
          videoClips={videoClips}
          mediaAssets={mediaAssets}
          currentTime={currentTime}
          duration={duration}
          onAddClipToTimeline={onAddClipToTimeline}
          onRemoveVideo={onRemoveVideo}
          onTabChange={onTabChange}
          activeSeries={activeSeries}
          activeEpisode={activeEpisode}
          seriesId={seriesId}
          episodeId={episodeId}
        />
      )}

      {activeTab === 'script' && (
        <DubbingModeTab
          selectedVideo={selectedVideo}
          dubbingMode={dubbingMode}
          setDubbingMode={setDubbingMode}
          recapStyle={recapStyle}
          setRecapStyle={setRecapStyle}
          RECAP_PRESETS={RECAP_PRESETS}
          promptInput={promptInput}
          setPromptInput={setPromptInput}
          handleTriggerScript={handleTriggerScript}
          isGeneratingScript={isGeneratingScript}
          generatingEpisodeId={generatingEpisodeId}
          scriptProgress={scriptProgress}
          scriptStage={scriptStage}
          scriptLogs={scriptLogs}
          scriptError={scriptError}
          scriptData={scriptData}
          onTabChange={onTabChange}
          onNavigateToVoice={onNavigateToVoice}
          isGeneratingAudio={isGeneratingAudio}
          generatingAudioEpisodeId={generatingAudioEpisodeId}
          audioProgress={audioProgress}
          audioStage={audioStage}
          episodeId={episodeId}
          seriesId={seriesId}
          activeEpisode={activeEpisode}
          onUpdateScript={onUpdateScript}
        />
      )}

      {activeTab === 'subtitles' && (
        <ScriptReviewTab
          scriptData={scriptData}
          seriesId={seriesId}
          episodeId={episodeId}
          apiKey={apiKey}
          onRefreshSeries={onRefreshSeries}
          handleBridgeGaps={handleBridgeGaps}
          handleAddSegment={handleAddSegment}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          speakerRegistry={speakerRegistry}
          filteredSegments={filteredSegments}
          selectedSegmentId={selectedSegmentId}
          onSelectSegment={onSelectSegment}
          handleSegmentChange={handleSegmentChange}
          handleSegmentBlur={handleSegmentBlur}
          handlePlayLine={handlePlayLine}
          playingSegmentId={playingSegmentId}
          onRegenerateSegment={onRegenerateSegment}
          onTranslateSegment={onTranslateSegment}
          handleDeleteSegment={handleDeleteSegment}
          onToggleDeliveryType={onToggleDeliveryType}
        />
      )}

      {/* Import Video Decision Modal (Requirement 6: Never silently replace current episode video) */}
      {showImportModal && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
        >
          <div
            style={{
              background: '#181b22',
              border: '1px solid #334155',
              borderRadius: 10,
              padding: '20px 24px',
              maxWidth: 460,
              width: '90%',
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              boxShadow: '0 20px 40px rgba(0,0,0,0.6)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#38bdf8' }}>
              <Layers size={20} />
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#f1f5f9' }}>
                Import Video for Series
              </h3>
            </div>

            <p style={{ margin: 0, fontSize: '0.84rem', color: '#94a3b8', lineHeight: 1.5 }}>
              ភាគបច្ចុប្បន្ន (<strong style={{ color: '#fff' }}>{activeEpisode?.title || 'Episode 1'}</strong>) មានវីដេអូរួចហើយ៖ <br />
              <code style={{ color: '#38bdf8', fontSize: '0.78rem' }}>{selectedVideo?.fileName}</code>
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
              <button
                type="button"
                onClick={handleConfirmCreateNewEpisode}
                className="btn-primary"
                style={{
                  padding: '10px 14px',
                  fontSize: '0.84rem',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  background: 'linear-gradient(135deg, #0284c7, #0369a1)',
                  borderColor: '#38bdf8',
                  cursor: 'pointer',
                }}
              >
                <span>✨ បង្កើតភាគថ្មី (Create New Episode)</span>
                <span style={{ fontSize: '0.72rem', background: 'rgba(255,255,255,0.2)', padding: '2px 6px', borderRadius: 4 }}>Recommended</span>
              </button>

              <button
                type="button"
                onClick={handleConfirmReplaceCurrentVideo}
                className="btn-ghost"
                style={{
                  padding: '8px 14px',
                  fontSize: '0.80rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#f87171',
                  border: '1px solid rgba(248, 113, 113, 0.3)',
                  cursor: 'pointer',
                }}
              >
                <span>⚠️ ជំនួសវីដេអូក្នុងភាគនេះ (Replace Video for this Episode)</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowImportModal(false);
                  setPendingUploadFile(null);
                }}
                className="btn-ghost"
                style={{
                  padding: '6px 14px',
                  fontSize: '0.78rem',
                  color: '#64748b',
                  textAlign: 'center',
                  cursor: 'pointer',
                }}
              >
                បោះបង់ (Cancel)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default React.memo(MediaLibrary);
