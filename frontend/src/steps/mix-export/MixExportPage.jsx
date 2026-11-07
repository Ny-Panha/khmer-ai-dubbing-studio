import React from 'react';

/**
 * MixExportPage (Step 5: Mix & Export)
 * Phase 1 Bridge: Renders the existing export workspace inside the Pattern A page frame.
 * In Phase 5, this will be upgraded to the dedicated HandBrake-style tabs.
 */
export default function MixExportPage({ children }) {
  return (
    <div className="step-page-frame" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, width: '100%', height: '100%', overflow: 'hidden' }}>
      {children}
    </div>
  );
}
