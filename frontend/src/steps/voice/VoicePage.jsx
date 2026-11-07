import React from 'react';

/**
 * VoicePage (Step 3: Khmer Voice TTS)
 * Phase 1 Bridge: Renders the existing voice workspace inside the Pattern A page frame.
 * In Phase 3, this will be upgraded to the dedicated voice workspace.
 */
export default function VoicePage({ children }) {
  return (
    <div className="step-page-frame" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, width: '100%', height: '100%', overflow: 'hidden' }}>
      {children}
    </div>
  );
}
