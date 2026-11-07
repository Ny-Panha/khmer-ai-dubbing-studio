import React from 'react';
import { 
  Check, Lock, Loader2, ChevronLeft, ChevronRight, Layers,
  PanelLeftClose, PanelLeftOpen, Sparkles
} from 'lucide-react';
import { WORKFLOW_STEPS, isStepReachable } from '../../steps/registry';
import './StageRail.css';

/**
 * StageRail (Left Rail ~200px, collapsible to ~56px icon strip)
 * Vertical status list of the 5 production stages.
 * Clicking a stage does NOT change pages: it switches the WORKSPACE MODE.
 * All stages are ALWAYS clickable to view.
 */
export default function StageRail({
  activeMode = 'script',
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
  isCollapsed = false,
  onToggleCollapse = null,
}) {
  return (
    <nav 
      className={`stage-rail ${isCollapsed ? 'is-collapsed' : ''}`}
      aria-label="Production Stages"
    >
      {/* Rail Top Header */}
      <div className="stage-rail-header">
        {!isCollapsed ? (
          <div className="stage-rail-header-content">
            <div className="stage-rail-title-wrap">
              <Sparkles size={12} color="#38BDF8" />
              <span className="stage-rail-title">STAGES</span>
            </div>
            <button
              type="button"
              className="stage-rail-collapse-btn"
              onClick={onToggleCollapse}
              title="បង្រួម Rail (Collapse to icons)"
            >
              <PanelLeftClose size={14} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="stage-rail-expand-btn"
            onClick={onToggleCollapse}
            title="ពង្រីក Rail (Expand Stages)"
          >
            <PanelLeftOpen size={16} />
          </button>
        )}
      </div>

      {/* Vertical Stages List */}
      <div className="stage-rail-list">
        {WORKFLOW_STEPS.map((step) => {
          const isDone = step.isComplete(workflowState);
          const reachable = isStepReachable(step.id, workflowState);
          const gateReason = step.gateReason(workflowState);
          const isActive = activeMode === step.id;
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
            ? `${step.label} (${gateReason})` 
            : `${step.label} — Switch Mode`;

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

              {/* Status Indicator Icon or Number */}
              <div className="stage-rail-badge">
                {isRunningStage ? (
                  <Loader2 size={12} className="animate-spin" color="#38BDF8" />
                ) : isDone ? (
                  <Check size={12} strokeWidth={3} color="#10B981" />
                ) : !reachable ? (
                  <Lock size={10} color="#94A3B8" />
                ) : (
                  <span className="stage-rail-number">{step.number}</span>
                )}
              </div>

              {/* Stage Icon */}
              <div className="stage-rail-icon">
                <IconComponent size={14} />
              </div>

              {/* Label & Progress (Hidden when collapsed) */}
              {!isCollapsed && (
                <div className="stage-rail-info">
                  <span className="stage-rail-label">{step.titleKm || step.label}</span>
                  {isRunningStage && stageProgress > 0 && (
                    <span className="stage-rail-progress-text">{stageProgress}%</span>
                  )}
                  {!reachable && gateReason && (
                    <span className="stage-rail-gate-hint">Locked</span>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Rail Footer (Optional Quick Info) */}
      {!isCollapsed && (
        <div className="stage-rail-footer">
          <span className="stage-rail-footer-text">Single-Screen Flow</span>
        </div>
      )}
    </nav>
  );
}
