import React from 'react';
import { Check, Lock, Loader2 } from 'lucide-react';
import { WORKFLOW_STEPS, isStepReachable } from '../../steps/registry';
import './StageRail.css';

/**
 * StageRail — 48px Icon Rail (FreeCut/OpenCut Anatomy)
 * Permanent vertical icon rail of the 5 production stages.
 * Stage icons with status overlay dot/check, tooltip = stage name,
 * active stage = accent-tinted background.
 */
export default function StageRail({
  currentMode = 'script',
  onSelectMode = null,
  workflowState = {},
  isGeneratingAudio = false,
  audioProgress = 0,
  isSeparatingDemucs = false,
  demucsProgress = 0,
  isRendering = false,
  renderProgress = 0,
  isGeneratingScript = false,
  scriptProgress = 0,
}) {
  return (
    <nav className="stage-rail" aria-label="Production Stages">
      {/* Rail Top Spacer */}
      <div className="stage-rail-header" />

      {/* Vertical 48px Icon Stages List */}
      <div className="stage-rail-list">
        {WORKFLOW_STEPS.map((step) => {
          const isDone = step.isComplete(workflowState);
          const reachable = isStepReachable(step.id, workflowState);
          const gateReason = step.gateReason(workflowState);
          const isActive = currentMode === step.id;
          const IconComponent = step.icon;

          // Check if this specific stage is currently in an active background worker
          let isRunningStage = false;
          let stageProgress = 0;
          if (step.id === 'script' && isGeneratingScript) {
            isRunningStage = true;
            stageProgress = scriptProgress;
          } else if (step.id === 'voice' && isGeneratingAudio) {
            isRunningStage = true;
            stageProgress = audioProgress;
          } else if (step.id === 'demucs' && isSeparatingDemucs) {
            isRunningStage = true;
            stageProgress = demucsProgress;
          } else if (step.id === 'mix-export' && isRendering) {
            isRunningStage = true;
            stageProgress = renderProgress;
          }

          const tooltip = gateReason 
            ? `${step.titleKm || step.label} (${gateReason})` 
            : `${step.titleKm || step.label}`;

          return (
            <button
              key={step.id}
              data-step-id={step.id}
              type="button"
              onClick={() => onSelectMode && onSelectMode(step.id)}
              className={`stage-rail-item ${isActive ? 'is-active' : ''} ${isDone ? 'is-done' : ''} ${!reachable ? 'is-gated' : ''}`}
              title={tooltip}
            >
              {/* Active Indicator Bar on Left */}
              {isActive && <span className="stage-rail-active-pill" />}

              {/* Stage Icon */}
              <div className="stage-rail-icon">
                <IconComponent size={16} />
              </div>

              {/* Status Indicator Dot/Check Overlay */}
              <div className="stage-rail-badge-overlay">
                {isRunningStage ? (
                  <Loader2 size={10} className="animate-spin" color="#38BDF8" />
                ) : isDone ? (
                  <Check size={10} strokeWidth={3} color="#10B981" />
                ) : !reachable ? (
                  <Lock size={9} color="#64748b" />
                ) : (
                  <span className="stage-rail-dot" />
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Rail Bottom Footer: Quiet Studio Dot */}
      <div className="stage-rail-footer">
        <span className="stage-rail-footer-dot" title="DragonDub AI Studio v2.5" />
      </div>
    </nav>
  );
}
