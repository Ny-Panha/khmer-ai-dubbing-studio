import React from 'react';
import { Film, Sparkles, Plus, AlertCircle } from 'lucide-react';
import { formatTimecode } from '../../utils/formatTime';
import './ScriptPage.css';

/**
 * ScriptPage (Step 2: Translate & Script)
 * Pattern A:
 * - NO-SCRIPT LANDING (0 segments): Focused generate-first view with Gemini Route CTA & manual +Add Line.
 * - SCRIPT-EXISTS LANDING (segments > 0): Editing suite with full transcript-first capability.
 */
export default function ScriptPage({
  scriptData = null,
  selectedVideo = null,
  videoMetadata = null,
  activeEpisode = null,
  onOpenGeminiRoute = null,
  onAddSegment = null,
  children,
}) {
  const segments = scriptData?.segments || [];
  const hasSegments = segments.length > 0;

  // If segments exist, render the full editing suite
  if (hasSegments) {
    return (
      <div className="step-page-frame" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, width: '100%', height: '100%', overflow: 'hidden' }}>
        {children}
      </div>
    );
  }

  // Otherwise, render the focused generate-first landing view
  const displayTitle = selectedVideo?.displayTitle || selectedVideo?.originalFilename || selectedVideo?.fileName || activeEpisode?.title || 'វីដេអូភាគ (Episode Video)';
  const videoDurationSec = videoMetadata?.durationSec || selectedVideo?.durationSec || 0;
  const displayDuration = videoDurationSec > 0 ? formatTimecode(videoDurationSec) : '00:00.00';
  const displayResolution = videoMetadata?.width && videoMetadata?.height ? `${videoMetadata.width}x${videoMetadata.height}` : 'HD 1080p';
  const episodeNumber = activeEpisode?.episodeNumber || (activeEpisode?.id ? String(activeEpisode.id).replace(/\D/g, '') : '1');
  const episodeBadge = `ភាគទី ${episodeNumber || 1}`;

  return (
    <div className="script-step-wrapper">
      <div className="script-landing-container">
        <div className="script-landing-card">
          {/* Video / Episode Summary Box */}
          <div className="script-landing-video-summary">
            <div className="script-landing-video-icon">
              <Film size={26} color="#38bdf8" />
            </div>
            <div className="script-landing-video-info">
              <div className="script-landing-eyebrow">
                <span>{episodeBadge}</span>
                <span className="script-landing-dot">•</span>
                <span>{displayDuration}</span>
                <span className="script-landing-dot">•</span>
                <span>{displayResolution}</span>
              </div>
              <h2 className="script-landing-title" title={displayTitle}>
                {displayTitle}
              </h2>
              <div className="script-landing-status-badge">
                <AlertCircle size={12} color="#fbbf24" />
                <span>មិនទាន់មាន Script (No Script Translated Yet)</span>
              </div>
            </div>
          </div>

          {/* Action Area */}
          <div className="script-landing-actions">
            <button
              type="button"
              className="script-landing-primary-btn"
              onClick={() => onOpenGeminiRoute && onOpenGeminiRoute()}
              title="បើក Gemini Multi-Key Route Studio ដើម្បីបង្កើត Script និងបកប្រែ"
            >
              <Sparkles size={18} strokeWidth={2.4} />
              <span>✦ បង្កើត Script & បកប្រែ (Gemini Route)</span>
            </button>

            <div className="script-landing-secondary-row">
              <button
                type="button"
                className="script-landing-secondary-btn"
                onClick={() => onAddSegment && onAddSegment(0)}
                title="បង្កើតបន្ទាត់សន្ទនាដោយដៃ (Add dialogue line manually)"
              >
                <Plus size={14} />
                <span>+ Add Line (manual)</span>
              </button>
            </div>

            <p className="script-landing-hint">
              ដំណើរការ AI ASR / Vision OCR បកប្រែភាសាចិនទៅជាភាសាខ្មែរ ដោយស្វ័យប្រវត្តិតាមរយៈ Gemini Multi-Key Router
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
