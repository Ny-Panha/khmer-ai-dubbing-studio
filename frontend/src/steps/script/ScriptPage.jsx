import React from 'react';

/**
 * ScriptPage (Step 2: Translate & Script)
 * Phase 1 Bridge: Renders the existing script workspace inside the Pattern A page frame.
 * In Phase 2, this will be upgraded to the dedicated transcript-first layout with 320px rail.
 */
export default function ScriptPage({ children }) {
  return (
    <div className="step-page-frame" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, width: '100%', height: '100%', overflow: 'hidden' }}>
      {children}
    </div>
  );
}
