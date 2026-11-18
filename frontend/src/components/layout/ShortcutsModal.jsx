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
      <div
        className="modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard Shortcuts and Controls"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 440 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Keyboard size={16} color="var(--primary-accent)" />
            <h2 style={{ margin: 0, fontSize: 'var(--text-md)', fontWeight: 700, color: 'var(--text-primary)' }}>
              Keyboard Shortcuts &amp; Controls
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost"
            aria-label="Close Keyboard Shortcuts"
          >
            <X size={16} />
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
                gap: 10,
                padding: '8px 10px',
                background: 'var(--bg-secondary-panel)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>{sc.desc}</span>
              <kbd
                style={{
                  background: 'var(--bg-elevated-panel)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--primary-accent)',
                  fontSize: 'var(--text-2xs)',
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: 'var(--radius-xs)',
                  fontFamily: 'var(--font-mono)',
                  whiteSpace: 'nowrap',
                }}
              >
                {sc.key}
              </kbd>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" onClick={onClose} className="btn-secondary">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
