import React from 'react';
import { Check, ChevronRight, Video, Sparkles, Mic, Sliders, Volume2, Loader2, Download } from 'lucide-react';
import './WorkflowStepper.css';

/**
 * Chinese Drama Dubbing Workflow Stepper Header Component (MotionSites & GetLayers Style)
 */
export default function WorkflowStepper({
  leftTab,
  onTabChange,
  isStep1Done,
  isStep2Done,
  isStep3Done,
  isStep4Done,
  onGenerateAudio,
  isGeneratingAudio,
  audioProgress = 0,
  audioStage = '',
  hasSegments,
}) {
  return (
    <div className="workflow-stepper-bar">
      <span className="workflow-stepper-label">
        <Sparkles size={11} color="#FF8577" />
        <span>FLOW:</span>
      </span>

      {/* Step 1: Import Drama */}
      <button
        type="button"
        onClick={() => onTabChange && onTabChange('media')}
        className={`workflow-step-btn ${leftTab === 'media' ? 'active' : ''} ${isStep1Done ? 'completed' : ''}`}
        title="Step 1: Import Chinese Drama Video"
      >
        <span className="workflow-step-num">
          {isStep1Done ? <Check size={10} strokeWidth={3} /> : '1'}
        </span>
        <Video size={12} />
        <span>1. Import Video</span>
      </button>

      <span className="workflow-step-arrow"><ChevronRight size={12} /></span>

      {/* Step 2: Translate & Script */}
      <button
        type="button"
        onClick={() => onTabChange && onTabChange(isStep2Done ? 'subtitles' : 'script')}
        className={`workflow-step-btn ${leftTab === 'script' || leftTab === 'subtitles' ? 'active' : ''} ${isStep2Done ? 'completed' : ''}`}
        title="Step 2: AI Chinese Dialogue Translation or Drama Recap"
      >
        <span className="workflow-step-num">
          {isStep2Done ? <Check size={10} strokeWidth={3} /> : '2'}
        </span>
        <Sparkles size={12} />
        <span>2. Translate & Script</span>
      </button>

      <span className="workflow-step-arrow"><ChevronRight size={12} /></span>

      {/* Step 3: Khmer Voice TTS */}
      <button
        type="button"
        onClick={onGenerateAudio}
        disabled={!hasSegments || isGeneratingAudio}
        className={`workflow-step-btn ${isStep3Done ? 'completed' : ''} ${isGeneratingAudio ? 'active' : ''}`}
        title="Step 3: Generate Khmer Voice (Microsoft Edge Neural TTS)"
      >
        <span className="workflow-step-num">
          {isStep3Done ? <Check size={10} strokeWidth={3} /> : '3'}
        </span>
        {isGeneratingAudio ? (
          <Loader2 size={12} className="animate-spin" style={{ color: '#34d399' }} />
        ) : (
          <Mic size={12} />
        )}
        <span>
          3. Khmer Voice (TTS)
          {isGeneratingAudio && audioProgress > 0 ? ` [${audioProgress}%]` : ''}
        </span>
      </button>

      <span className="workflow-step-arrow"><ChevronRight size={12} /></span>

      {/* Step 4: Demucs AI (Clean BGM) */}
      <button
        type="button"
        onClick={() => onTabChange && onTabChange('script')}
        className={`workflow-step-btn ${isStep4Done ? 'completed' : ''}`}
        title="Step 4: Demucs AI Vocal Separation (កាត់សំឡេងចិន យក BGM/SFX)"
      >
        <span className="workflow-step-num">
          {isStep4Done ? <Check size={10} strokeWidth={3} /> : '4'}
        </span>
        <Volume2 size={12} />
        <span>4. Demucs AI</span>
      </button>

      <span className="workflow-step-arrow"><ChevronRight size={12} /></span>

      {/* Step 5: Mix & Export */}
      <button
        type="button"
        onClick={() => onTabChange && onTabChange('voice')}
        className={`workflow-step-btn ${isStep4Done ? 'completed' : ''}`}
        title="Step 5: Smart Audio Ducking & Final Render"
      >
        <span className="workflow-step-num">
          5
        </span>
        <Sliders size={12} />
        <span>5. Mix & Export</span>
      </button>
    </div>
  );
}
