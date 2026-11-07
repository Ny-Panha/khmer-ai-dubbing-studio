import React from 'react';
import { Check, ChevronRight, Loader2, Sparkles, Lock } from 'lucide-react';
import { WORKFLOW_STEPS, isStepReachable } from '../steps/registry';
import './WorkflowStepper.css';

/**
 * Chinese Drama Dubbing Workflow Stepper (Pattern A Registry-Driven)
 */
export default function WorkflowStepper({
  currentStep = 'import',
  onSelectStep = null,
  workflowState = {},
  isGeneratingAudio = false,
  audioProgress = 0,
  // Backward compatibility
  leftTab = null,
  onTabChange = null,
}) {
  const activeStepId = currentStep || (
    leftTab === 'media' ? 'import' :
    (leftTab === 'script' || leftTab === 'subtitles') ? 'script' :
    leftTab === 'voice' ? 'voice' :
    leftTab === 'mix' ? 'mix-export' : 'import'
  );

  const handleStepClick = (stepId) => {
    if (onSelectStep) {
      onSelectStep(stepId);
    } else if (onTabChange) {
      if (stepId === 'import') onTabChange('media');
      else if (stepId === 'script') onTabChange('subtitles');
      else if (stepId === 'voice') onTabChange('voice');
      else if (stepId === 'demucs') onTabChange('script');
      else if (stepId === 'mix-export') onTabChange('voice');
    }
  };

  return (
    <div className="workflow-stepper-bar">
      <span className="workflow-stepper-label">
        <Sparkles size={11} color="#FF8577" />
        <span>FLOW:</span>
      </span>

      {WORKFLOW_STEPS.map((step, idx) => {
        const isDone = step.isComplete(workflowState);
        const reachable = isStepReachable(step.id, workflowState);
        const isActive = activeStepId === step.id;
        const gateReason = step.gateReason(workflowState);
        const IconComponent = step.icon;

        return (
          <React.Fragment key={step.id}>
            {idx > 0 && (
              <span className="workflow-step-arrow">
                <ChevronRight size={12} />
              </span>
            )}
            <button
              type="button"
              disabled={!reachable}
              onClick={() => reachable && handleStepClick(step.id)}
              className={`workflow-step-btn ${isActive ? 'active' : ''} ${isDone ? 'completed' : ''} ${!reachable ? 'is-disabled' : ''}`}
              title={gateReason ? `${step.label} (${gateReason})` : step.label}
              style={{
                opacity: reachable ? 1 : 0.45,
                cursor: reachable ? 'pointer' : 'not-allowed',
              }}
            >
              <span className="workflow-step-num">
                {isDone ? <Check size={10} strokeWidth={3} /> : (!reachable ? <Lock size={9} /> : step.number)}
              </span>
              {step.id === 'voice' && isGeneratingAudio ? (
                <Loader2 size={12} className="animate-spin" style={{ color: '#34d399' }} />
              ) : (
                <IconComponent size={12} />
              )}
              <span>
                {step.label}
                {step.id === 'voice' && isGeneratingAudio && audioProgress > 0 ? ` [${audioProgress}%]` : ''}
              </span>
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
}
