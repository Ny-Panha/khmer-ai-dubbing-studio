import React, { useState } from 'react';
import { 
  FolderPlus, Loader2, AlertCircle, Sparkles, ArrowRight, Film, 
  Check, Trash2, Clock, Monitor, HardDrive, RefreshCw, Scissors, Info
} from 'lucide-react';
import { splitVideoEpisodesApi } from '../../services/api';
import { formatTimecode } from '../../utils/formatTime';

export default function MediaUploadTab({
  isUploading,
  handleFileUpload,
  uploadError,
  selectedVideo,
  videoMetadata = null,
  videoClips = [],
  currentTime = 0,
  duration = 0,
  onRemoveVideo = null,
  onTabChange,
  activeSeries = null,
  activeEpisode = null,
  seriesId = null,
  episodeId = null,
}) {
  const [showSplitModal, setShowSplitModal] = useState(false);
  const [splitMinutes, setSplitMinutes] = useState(20);
  const [isSplitting, setIsSplitting] = useState(false);
  const [splitError, setSplitError] = useState(null);

  const activeDuration = videoMetadata?.durationSec || duration || selectedVideo?.durationSec || 0;
  const hasVideo = Boolean(selectedVideo?.videoId || selectedVideo?.videoUrl);
  const displayTitle = selectedVideo?.displayTitle || selectedVideo?.originalFilename || selectedVideo?.fileName || 'វីដេអូភាគ (Episode Video)';

  const estimatedEpisodes = activeDuration > 0 ? Math.ceil(activeDuration / (splitMinutes * 60)) : 1;

  const handleAutoSplit = async (customMinutes = null) => {
    const targetMins = customMinutes || splitMinutes || 20;
    const rawRef = selectedVideo?.videoPath || selectedVideo?.videoId || selectedVideo?.videoUrl || activeEpisode?.video?.videoPath || activeEpisode?.video?.videoId || activeEpisode?.videoFile || activeEpisode?.sourceVideoPath;
    if (!rawRef) {
      alert('សូម Import ឬ ជ្រើសរើសវីដេអូជាមុនសិន!');
      return;
    }

    try {
      setIsSplitting(true);
      setSplitError(null);
      const res = await splitVideoEpisodesApi({
        videoId: rawRef,
        videoPath: selectedVideo?.videoPath,
        seriesId: activeSeries?.id || seriesId || selectedVideo?.seriesId || 'drama_project',
        durationMinutes: Number(targetMins) || 20,
      });

      alert(`🎉 ${res.message || 'បានកាត់បំបែកវីដេអូជាភាគៗជោគជ័យ!'}`);
      setShowSplitModal(false);
      window.location.reload();
    } catch (err) {
      console.error(err);
      setSplitError(err.message || 'កាត់បំបែកវីដេអូបរាជ័យ');
      alert('កាត់បំបែកវីដេអូបរាជ័យ: ' + (err.message || err));
    } finally {
      setIsSplitting(false);
    }
  };

  return (
    <div className="media-tab-content" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {(uploadError || splitError) && (
        <div className="error-banner">
          <AlertCircle size={15} />
          <span>{uploadError || splitError}</span>
        </div>
      )}

      {hasVideo ? (
        /* 1. Active Video Card (Clean, Single Card, Zero-Duplicate) */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Card Container */}
          <div 
            className="motion-lift"
            style={{
              background: 'rgba(25, 39, 68, 0.7)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: 14,
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              boxShadow: '0 6px 20px rgba(0, 0, 0, 0.25)',
              transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            {/* Top row: Status Badge & Delete */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div 
                style={{ 
                  display: 'inline-flex', 
                  alignItems: 'center', 
                  gap: 5, 
                  background: 'rgba(52, 211, 153, 0.12)', 
                  border: '1px solid rgba(52, 211, 153, 0.3)',
                  padding: '3px 10px',
                  borderRadius: 9999,
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  color: '#34D399',
                }}
              >
                <Check size={12} strokeWidth={3} />
                <span>វីដេអូសកម្មលើ VIDEO 1</span>
              </div>

              {onRemoveVideo && (
                <button
                  type="button"
                  onClick={onRemoveVideo}
                  className="btn-tactile"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#94A3B8',
                    cursor: 'pointer',
                    padding: '3px 8px',
                    borderRadius: 9999,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: '0.72rem',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = '#F87171';
                    e.currentTarget.style.background = 'rgba(248, 113, 113, 0.1)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = '#94A3B8';
                    e.currentTarget.style.background = 'transparent';
                  }}
                  title="ដកវីដេអូចេញពីគម្រោង (Remove video)"
                >
                  <Trash2 size={13} />
                  <span>ដកចេញ</span>
                </button>
              )}
            </div>

            {/* Video Title */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <div 
                style={{ 
                  width: 40, 
                  height: 40, 
                  borderRadius: 8, 
                  background: 'rgba(56, 189, 248, 0.12)', 
                  border: '1px solid rgba(56, 189, 248, 0.25)',
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  flexShrink: 0
                }}
              >
                <Film size={20} color="#38bdf8" />
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div 
                  style={{ 
                    fontSize: '0.86rem', 
                    fontWeight: 700, 
                    color: '#f8fafc', 
                    lineHeight: 1.35,
                    wordBreak: 'break-word',
                  }}
                  title={displayTitle}
                >
                  {displayTitle}
                </div>
              </div>
            </div>

            {/* Video Specs Grid (Duration, Resolution, File Size) */}
            <div 
              style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(3, 1fr)', 
                gap: 6,
                background: 'rgba(0, 0, 0, 0.25)',
                padding: '8px 10px',
                borderRadius: 6,
                border: '1px solid rgba(255, 255, 255, 0.05)',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: '0.64rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Duration
                </span>
                <span style={{ fontSize: '0.76rem', fontWeight: 700, color: '#38bdf8', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Clock size={11} />
                  {activeDuration > 0 ? formatTimecode(activeDuration) : '--:--'}
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: '0.64rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Resolution
                </span>
                <span style={{ fontSize: '0.76rem', fontWeight: 600, color: '#cbd5e1', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Monitor size={11} />
                  {videoMetadata?.resolution || '1080p'}
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: '0.64rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Size
                </span>
                <span style={{ fontSize: '0.76rem', fontWeight: 600, color: '#cbd5e1', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <HardDrive size={11} />
                  {selectedVideo?.size || videoMetadata?.size || '44 MB'}
                </span>
              </div>
            </div>

            {/* Action Row: Replace Video + Auto-Split 20 Min */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {/* Replace Video Button */}
              <label 
                className="btn-tactile"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  padding: '9px 12px',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: 9999,
                  fontSize: '0.74rem',
                  fontWeight: 600,
                  color: '#CBD5E1',
                  cursor: isUploading ? 'not-allowed' : 'pointer',
                  transition: 'all 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
                  textAlign: 'center',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(56, 189, 248, 0.4)';
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                }}
              >
                <input
                  type="file"
                  accept="video/*"
                  onChange={handleFileUpload}
                  disabled={isUploading}
                  style={{ display: 'none' }}
                />
                {isUploading ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    <span>កំពុងប្តូរវីដេអូ...</span>
                  </>
                ) : (
                  <>
                    <RefreshCw size={13} />
                    <span>ប្តូរវីដេអូ (Replace)</span>
                  </>
                )}
              </label>

              {/* Auto-Split Button */}
              <button
                type="button"
                onClick={() => setShowSplitModal(true)}
                disabled={isSplitting || isUploading}
                className="btn-tactile"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  padding: '9px 12px',
                  background: 'rgba(56, 189, 248, 0.12)',
                  border: '1px solid rgba(56, 189, 248, 0.4)',
                  borderRadius: 9999,
                  fontSize: '0.74rem',
                  fontWeight: 700,
                  color: '#38BDF8',
                  cursor: (isSplitting || isUploading) ? 'not-allowed' : 'pointer',
                  transition: 'all 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = '#38BDF8';
                  e.currentTarget.style.background = 'rgba(56, 189, 248, 0.22)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(56, 189, 248, 0.4)';
                  e.currentTarget.style.background = 'rgba(56, 189, 248, 0.12)';
                }}
                title="កាត់ចែកវីដេអូជាភាគៗ ២០ នាទី / ភាគ"
              >
                {isSplitting ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    <span>កំពុងកាត់ចែក...</span>
                  </>
                ) : (
                  <>
                    <Scissors size={13} />
                    <span>កាត់ជាភាគ ២០ នាទី</span>
                  </>
                )}
              </button>
            </div>

            {/* Smart Long-Video Banner if Video > 15 Minutes */}
            {activeDuration >= 900 && (
              <div 
                style={{
                  background: 'linear-gradient(135deg, rgba(2, 132, 199, 0.12), rgba(15, 23, 42, 0.7))',
                  border: '1px solid rgba(56, 189, 248, 0.35)',
                  borderRadius: 6,
                  padding: '10px 12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#38bdf8' }}>
                    <Scissors size={14} />
                    <span style={{ fontSize: '0.74rem', fontWeight: 800 }}>
                      ⚡ វីដេអូវែង ({formatTimecode(activeDuration)})
                    </span>
                  </div>
                  <span style={{ fontSize: '0.68rem', color: '#38bdf8', background: 'rgba(56, 189, 248, 0.12)', border: '1px solid rgba(56, 189, 248, 0.25)', padding: '2px 6px', borderRadius: 4, fontWeight: 700 }}>
                    ~{Math.ceil(activeDuration / 1200)} ភាគ (២០ នាទី/ភាគ)
                  </span>
                </div>

                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => handleAutoSplit(20)}
                    disabled={isSplitting}
                    style={{
                      flex: 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      padding: '7px 10px',
                      background: 'linear-gradient(135deg, #0284c7, #0369a1)',
                      border: '1px solid #38bdf8',
                      borderRadius: 5,
                      color: '#ffffff',
                      fontSize: '0.74rem',
                      fontWeight: 700,
                      cursor: isSplitting ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {isSplitting ? (
                      <>
                        <Loader2 size={13} className="animate-spin" />
                        <span>កំពុងកាត់ចែក (Fast Copy)...</span>
                      </>
                    ) : (
                      <>
                        <Scissors size={13} />
                        <span>✂️ កាត់ជាភាគ ២០ នាទី ឥឡូវនេះ</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowSplitModal(true)}
                    disabled={isSplitting}
                    style={{
                      padding: '7px 10px',
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      borderRadius: 5,
                      color: '#cbd5e1',
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                    title="ជ្រើសរើសប្រវែងនាទីផ្សេងទៀត"
                  >
                    ជម្រើស...
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Step 2 CTA Card */}
          <button
            type="button"
            onClick={() => onTabChange && onTabChange('script')}
            className="btn-tactile"
            style={{ 
              width: '100%', 
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between', 
              fontSize: '0.82rem',
              fontWeight: 700,
              padding: '13px 16px',
              background: 'linear-gradient(135deg, rgba(255, 133, 119, 0.16) 0%, rgba(56, 189, 248, 0.16) 100%)',
              border: '1px solid rgba(255, 133, 119, 0.35)',
              borderRadius: 14,
              color: '#F8FAFC',
              cursor: 'pointer',
              boxShadow: '0 4px 14px rgba(0, 0, 0, 0.25)',
              transition: 'all 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'linear-gradient(135deg, rgba(255, 133, 119, 0.25) 0%, rgba(56, 189, 248, 0.25) 100%)';
              e.currentTarget.style.borderColor = '#FF8577';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'linear-gradient(135deg, rgba(255, 133, 119, 0.16) 0%, rgba(56, 189, 248, 0.16) 100%)';
              e.currentTarget.style.borderColor = 'rgba(255, 133, 119, 0.35)';
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Sparkles size={16} color="#FF8577" />
              <span>ជំហានបន្ទាប់៖ AI Dubbing & Script</span>
            </div>
            <ArrowRight size={15} color="#FF8577" />
          </button>
        </div>
      ) : (
        /* 2. Upload Zone when NO video is loaded (GetLayers Layer 2 Glass) */
        <div 
          className="motion-lift"
          style={{ 
            display: 'flex', 
            flexDirection: 'column', 
            alignItems: 'center', 
            textAlign: 'center', 
            padding: '40px 20px', 
            border: '2px dashed rgba(255, 133, 119, 0.35)', 
            borderRadius: 16, 
            background: 'rgba(25, 39, 68, 0.45)',
            gap: 14,
            transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          <div 
            style={{ 
              width: 58, 
              height: 58, 
              borderRadius: 14, 
              background: 'rgba(255, 133, 119, 0.12)', 
              border: '1px solid rgba(255, 133, 119, 0.25)',
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
            }}
          >
            <FolderPlus size={28} color="#FF8577" />
          </div>

          <div>
            <div style={{ fontSize: '0.94rem', fontWeight: 800, color: '#F8FAFC', marginBottom: 4 }}>
              បញ្ចូលវីដេអូសម្រាប់ភាគនេះ
            </div>
            <div style={{ fontSize: '0.76rem', color: '#94A3B8', lineHeight: 1.5 }}>
              គាំទ្រ MP4, MKV, MOV, WebM (Full HD, 4K)
            </div>
          </div>

          <label 
            className="btn-tactile"
            style={{ 
              marginTop: 6,
              cursor: isUploading ? 'not-allowed' : 'pointer', 
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 22px',
              borderRadius: 9999,
              background: 'linear-gradient(135deg, #FF8577 0%, #f43f5e 100%)',
              border: '1px solid #FF8577',
              color: '#0B132B',
              fontSize: '0.80rem',
              fontWeight: 800,
              boxShadow: '0 4px 16px rgba(255, 133, 119, 0.35)',
              transition: 'all 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            <input
              type="file"
              accept="video/*"
              onChange={handleFileUpload}
              disabled={isUploading}
              style={{ display: 'none' }}
            />
            {isUploading ? (
              <>
                <Loader2 size={15} className="animate-spin" color="#0B132B" />
                <span>កំពុង Upload & រៀបចំវីដេអូ...</span>
              </>
            ) : (
              <>
                <FolderPlus size={15} color="#0B132B" />
                <span>+ ជ្រើសរើសវីដេអូ (Import Video)</span>
              </>
            )}
          </label>
        </div>
      )}

      {/* Auto-Split Modal */}
      {showSplitModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(4px)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => !isSplitting && setShowSplitModal(false)}
        >
          <div
            style={{
              background: '#0f172a',
              border: '1px solid rgba(56, 189, 248, 0.4)',
              borderRadius: 12,
              padding: 20,
              maxWidth: 440,
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              boxShadow: '0 20px 40px rgba(0,0,0,0.6)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#38bdf8' }}>
              <Scissors size={20} />
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: '#f8fafc' }}>
                Auto-Split វីដេអូវែងជាភាគៗ (EP1, EP2...)
              </h3>
            </div>

            <p style={{ margin: 0, fontSize: '0.80rem', color: '#94a3b8', lineHeight: 1.5 }}>
              បច្ចេកវិទ្យា <strong>Fast Lossless Stream Copy</strong> ជួយកាត់ចែកវីដេអូវែងជា Episode (EP1, EP2, EP3...) ក្នុងពេលត្រឹមតែ <strong>5-10 វិនាទីប៉ុណ្ណោះ</strong> ដោយមិនខូចគុណភាពរូបភាព!
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#cbd5e1' }}>
                កំណត់ប្រវែងក្នុង 1 ភាគ (នាទី / Episode):
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                {[5, 10, 15, 20, 30].map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setSplitMinutes(m)}
                    style={{
                      flex: 1,
                      padding: '6px 0',
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      borderRadius: 6,
                      border: splitMinutes === m ? '1.5px solid #38bdf8' : '1px solid #334155',
                      background: splitMinutes === m ? '#0284c7' : '#1e293b',
                      color: splitMinutes === m ? '#ffffff' : '#94a3b8',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {m} នាទី
                  </button>
                ))}
              </div>
            </div>

            {/* Estimated Episodes Calculation Box */}
            <div
              style={{
                background: 'rgba(56, 189, 248, 0.08)',
                border: '1px solid rgba(56, 189, 248, 0.25)',
                borderRadius: 8,
                padding: '10px 12px',
                fontSize: '0.76rem',
                color: '#e2e8f0',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#38bdf8', fontWeight: 700 }}>
                <span>ប្រវែងវីដេអូសរុប៖ {activeDuration > 0 ? formatTimecode(activeDuration) : '00:00:00'}</span>
                <span>កាត់ម្ដង៖ {splitMinutes} នាទី</span>
              </div>
              <div style={{ color: '#cbd5e1', fontSize: '0.72rem' }}>
                👉 នឹងបង្កើតបានចំនួន <strong>~{estimatedEpisodes} ភាគ</strong> (EP1 ដល់ EP{estimatedEpisodes}) ស្វ័យប្រវត្ត។
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
              <button
                type="button"
                onClick={() => setShowSplitModal(false)}
                disabled={isSplitting}
                style={{
                  padding: '7px 14px',
                  background: 'transparent',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  borderRadius: 6,
                  color: '#94a3b8',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  cursor: isSplitting ? 'not-allowed' : 'pointer',
                }}
              >
                បោះបង់ (Cancel)
              </button>
              <button
                type="button"
                onClick={() => handleAutoSplit()}
                disabled={isSplitting}
                style={{
                  padding: '7px 16px',
                  background: 'linear-gradient(135deg, #0284c7, #0369a1)',
                  border: '1px solid #38bdf8',
                  borderRadius: 6,
                  color: '#ffffff',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  cursor: isSplitting ? 'not-allowed' : 'pointer',
                  boxShadow: '0 2px 8px rgba(2, 132, 199, 0.3)',
                }}
              >
                {isSplitting ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>កំពុងកាត់ចែកភាគ...</span>
                  </>
                ) : (
                  <>
                    <Scissors size={14} />
                    <span>កាត់បំបែកឥឡូវនេះ ({splitMinutes} នាទី)</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}