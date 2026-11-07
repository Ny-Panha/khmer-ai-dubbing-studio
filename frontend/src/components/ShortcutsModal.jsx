import React from 'react';
import { X, Keyboard } from 'lucide-react';

export default function ShortcutsModal({ isOpen, onClose }) {
  if (!isOpen) return null;

  const shortcuts = [
    { key: 'Space', desc: 'Play / Pause Video' },
    { key: 'Ctrl + B  or  S', desc: 'Split Selected Clip at Playhead' },
    { key: 'Delete / Backspace', desc: 'Delete Selected Clip' },
    { key: '← / →', desc: 'Step Back / Forward 1 Second' },
    { key: 'Ctrl + E', desc: 'Render & Export Dubbed Video' },
  ];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <Keyboard size={16} color="var(--accent-cyan)" />
            <h3 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 700, color: '#fff' }}>
              Keyboard Shortcuts & Controls
            </h3>
          </div>
          <button 
            onClick={onClose} 
            className="icon-action-btn"
            style={{ padding: 4 }}
          >
            <X size={15} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '14px 0' }}>
          {shortcuts.map((sc, i) => (
            <div 
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '7px 10px',
                background: 'rgba(0, 0, 0, 0.25)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-xs)',
              }}
            >
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{sc.desc}</span>
              <kbd style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--accent-cyan)',
                fontSize: '0.72rem',
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: 4,
                fontFamily: 'monospace',
              }}>
                {sc.key}
              </kbd>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={onClose} className="btn-secondary" style={{ fontSize: '0.78rem' }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
