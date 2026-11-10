import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error(`[ErrorBoundary:${this.props.name || 'UI'}] Caught render error:`, error, info?.componentStack || '');
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    if (typeof this.props.onReset === 'function') {
      try {
        this.props.onReset();
      } catch {
        // ignore callback reset errors
      }
    }
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    if (this.props.inline) {
      return (
        <div
          role="alert"
          style={{
            padding: '12px 16px',
            margin: '8px',
            borderRadius: '10px',
            background: '#1E293B',
            border: '1px solid rgba(244, 63, 94, 0.4)',
            color: '#F8FAFC',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            fontSize: '13px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertTriangle size={16} style={{ color: '#FB7185', flexShrink: 0 }} />
            <span>
              មានបញ្ហាផ្ទាំង {this.props.name || 'UI'} ({this.state.error?.message || 'Unexpected error'})
            </span>
          </div>
          <button
            type="button"
            onClick={this.handleReset}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              borderRadius: '8px',
              background: '#334155',
              color: '#F8FAFC',
              border: '1px solid rgba(255,255,255,0.12)',
              cursor: 'pointer',
              fontSize: '12px',
            }}
          >
            <RotateCcw size={13} />
            <span>ព្យាយាមម្តងទៀត</span>
          </button>
        </div>
      );
    }

    return (
      <div
        role="alert"
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0B1120',
          color: '#F8FAFC',
          padding: '24px',
        }}
      >
        <div
          style={{
            maxWidth: '460px',
            width: '100%',
            background: '#141E33',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '18px',
            padding: '24px',
            boxShadow: '0 20px 50px rgba(0,0,0,0.6)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
            <AlertTriangle size={22} style={{ color: '#F59E0B', flexShrink: 0 }} />
            <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 700 }}>
              មានបញ្ហាបង្ហាញផ្ទាំង UI ({this.props.name || 'Studio'})
            </h2>
          </div>
          <p style={{ margin: '0 0 16px', fontSize: '13px', color: '#94A3B8', lineHeight: 1.5 }}>
            {this.state.error?.message || 'Unexpected component render error.'}
          </p>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              type="button"
              onClick={this.handleReset}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 14px',
                borderRadius: '10px',
                background: '#2563EB',
                color: '#FFFFFF',
                border: 'none',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: 600,
              }}
            >
              <RotateCcw size={14} />
              <span>ស្ដារផ្ទាំងឡើងវិញ</span>
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                padding: '8px 14px',
                borderRadius: '10px',
                background: '#1E293B',
                color: '#E2E8F0',
                border: '1px solid rgba(255,255,255,0.12)',
                cursor: 'pointer',
                fontSize: '13px',
              }}
            >
              Reload Page
            </button>
          </div>
        </div>
      </div>
    );
  }
}
