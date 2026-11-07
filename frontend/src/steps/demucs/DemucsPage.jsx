import React from 'react';

/**
 * DemucsPage (Step 4: Demucs AI BGM)
 * Phase 1 Bridge: Renders the existing separation workspace inside the Pattern A page frame.
 * In Phase 4, this will be upgraded to the dedicated Demucs workspace.
 */
export default function DemucsPage({ children }) {
  return (
    <div className="step-page-frame" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, width: '100%', height: '100%', overflow: 'hidden' }}>
      {children}
    </div>
  );
}
