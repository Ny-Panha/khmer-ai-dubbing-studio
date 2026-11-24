import React from 'react';
import {
  Sparkles, Loader2, FileText, Settings2, ChevronDown, ChevronUp, Zap,
  MessageSquare, Layers, Film, Mic,
} from 'lucide-react';
import {
  GENRE_OPTIONS,
  SMART_PROMPT_CHIPS,
} from '../../utils/dramaGenrePresets';

function BatchScriptSetupPanel({
  dramaGenre,
  setDramaGenre,
  activeEpisode,
  customDirection,
  pipelineMode,
  setPipelineMode,
  dubbingMode,
  setDubbingMode,
  narratorGender,
  setNarratorGender,
  recapStyle,
  setRecapStyle,
  isScriptSetupExpanded,
  setIsScriptSetupExpanded,
  isDirectionExpanded,
  setIsDirectionExpanded,
  presetIds,
  setPresetIds,
  togglePreset,
  customText,
  setCustomText,
  handleGenreChange,
  subtitleFileInputRef,
  isImportingSubtitles,
  importSuccess,
  importErrors,
  handleImportBatchSubtitleFile,
}) {
  return (
  <div
    data-testid="batch-script-setup-section"
    style={{
      background: 'rgba(15, 23, 42, 0.55)',
      borderRadius: 10,
      border: '1px solid rgba(255, 255, 255, 0.08)',
      overflow: 'hidden',
    }}
  >
    {/* Single Summary Line Collapsible Trigger */}
    {(() => {
      const selectedGenreObj = GENRE_OPTIONS.find((g) => g.id === dramaGenre) || GENRE_OPTIONS[0];
      const activeChipLabels = SMART_PROMPT_CHIPS
        .filter((c) => String(customDirection || '').includes(c.promptText) || String(customDirection || '').includes(c.label))
        .map((c) => c.label.replace(/^[^\s]+\s*/, ''));
      const directionSummary = activeChipLabels.length > 0
        ? activeChipLabels.join(', ')
        : (String(customDirection || '').trim() ? 'Custom Direction' : 'Default Direction');
      const summaryLine = `${pipelineMode === 'fast_ocr' ? '⚡ Fast OCR' : '🎯 Standard Mode'} • ${dubbingMode === 'dialogue' ? 'Mode A: សន្ទនាតួអង្គ' : 'Mode B: សម្រាយរឿង'} • ${selectedGenreObj.label} • ${directionSummary}`;
      return (
        <button
          type="button"
          data-testid="batch-script-setup-toggle"
          onClick={() => setIsScriptSetupExpanded((prev) => !prev)}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            padding: '8px 12px',
            background: 'transparent',
            border: 'none',
            borderBottom: isScriptSetupExpanded ? '1px solid rgba(255, 255, 255, 0.06)' : 'none',
            color: '#E2E8F0',
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1, overflow: 'hidden' }}>
            <Settings2 size={13} color="var(--primary-accent)" style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--text-primary)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              កំណត់ទម្រង់បង្កើត Script (Batch Script Setup):
            </span>
            <span
              className="truncate"
              style={{
                fontSize: '0.72rem',
                fontWeight: 600,
                color: '#38BDF8',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                minWidth: 0,
              }}
            >
              {summaryLine}
            </span>
          </div>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#94A3B8', fontSize: '0.70rem', fontWeight: 700, flexShrink: 0 }}>
            <span>{isScriptSetupExpanded ? 'បង្រួម' : 'ពង្រីក'}</span>
            {isScriptSetupExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </span>
        </button>
      );
    })()}

    {isScriptSetupExpanded && (
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {/* ── FLAT ROW 1: ល្បឿន & របៀប PIPELINE (GENERATION MODE) + Import .srt/.json ── */}
        <div
          data-testid="batch-setup-group-pipeline"
          style={{
            padding: '8px 12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.70rem', color: '#94A3B8', fontWeight: 700, minWidth: 118, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <Zap size={11} color="#38BDF8" />
              <span>ល្បឿន &amp; PIPELINE:</span>
            </span>
            <button
              type="button"
              data-testid="batch-pipeline-standard"
              onClick={() => setPipelineMode('standard')}
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                fontSize: '0.72rem',
                fontWeight: pipelineMode === 'standard' ? 800 : 600,
                background: pipelineMode === 'standard' ? 'rgba(168, 85, 247, 0.16)' : 'rgba(255, 255, 255, 0.03)',
                color: pipelineMode === 'standard' ? '#C084FC' : '#CBD5E1',
                border: pipelineMode === 'standard' ? '1px solid rgba(168, 85, 247, 0.5)' : '1px solid transparent',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                transition: 'all 0.15s ease',
              }}
              title="Full 10-Stage (OCR + ASR Diarization + Reconcile)"
            >
              <Layers size={12} />
              <span>Standard Mode</span>
              {pipelineMode === 'standard' && <Check size={11} />}
            </button>
            <button
              type="button"
              data-testid="batch-pipeline-fast-ocr"
              onClick={() => setPipelineMode('fast_ocr')}
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                fontSize: '0.72rem',
                fontWeight: pipelineMode === 'fast_ocr' ? 800 : 600,
                background: pipelineMode === 'fast_ocr' ? 'rgba(234, 179, 8, 0.16)' : 'rgba(255, 255, 255, 0.03)',
                color: pipelineMode === 'fast_ocr' ? '#FACC15' : '#CBD5E1',
                border: pipelineMode === 'fast_ocr' ? '1px solid rgba(234, 179, 8, 0.5)' : '1px solid transparent',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                transition: 'all 0.15s ease',
              }}
              title="Direct Subtitles (OCR ➡️ Translate, 1 Cue = 1 Segment)"
            >
              <Zap size={12} />
              <span>Fast OCR Mode</span>
              <span
                data-testid="batch-fast-ocr-summary-pill"
                style={{
                  fontSize: '0.64rem',
                  opacity: 0.9,
                  fontWeight: 600,
                  padding: '1px 5px',
                  borderRadius: 3,
                  background: pipelineMode === 'fast_ocr' ? 'rgba(234, 179, 8, 0.2)' : 'rgba(255, 255, 255, 0.06)',
                }}
              >
                (OCR + Visual Speaker Gender + Direct Translate)
              </span>
              {pipelineMode === 'fast_ocr' && <Check size={11} />}
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <input
              ref={subtitleFileInputRef}
              type="file"
              accept=".srt,.json"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleImportBatchSubtitleFile(file);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              disabled={isImportingSubtitles}
              onClick={() => subtitleFileInputRef.current?.click()}
              title="📄 Import .srt / .json"
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                fontSize: '0.70rem',
                fontWeight: 700,
                background: 'rgba(56, 189, 248, 0.10)',
                color: '#38BDF8',
                border: '1px solid rgba(56, 189, 248, 0.28)',
                cursor: isImportingSubtitles ? 'not-allowed' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              {isImportingSubtitles ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />}
              <span>📄 Import .srt / .json</span>
            </button>
            {importSuccess && (
              <span style={{ color: '#34D399', fontSize: '0.68rem', fontWeight: 700 }}>
                ✓ {importSuccess}
              </span>
            )}
            {importErrors.length > 0 && (
              <span style={{ color: '#F87171', fontSize: '0.68rem', fontWeight: 700 }}>
                ⚠️ {importErrors[0]}
              </span>
            )}
          </div>
        </div>

        {/* ── FLAT ROW 2: ជ្រើសរើសទម្រង់បញ្ចូលសំឡេង AI (DUBBING MODE) ── */}
        <div
          data-testid="batch-setup-group-dubbing-mode"
          style={{
            padding: '8px 12px',
            borderTop: '1px solid rgba(255, 255, 255, 0.06)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.70rem', color: '#94A3B8', fontWeight: 700, minWidth: 118, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <MessageSquare size={11} color="#38BDF8" />
              <span>ទម្រង់សំឡេង AI:</span>
            </span>
            <button
              type="button"
              data-testid="batch-dubbing-mode-dialogue"
              onClick={() => setDubbingMode('dialogue')}
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                fontSize: '0.72rem',
                fontWeight: dubbingMode === 'dialogue' ? 800 : 600,
                background: dubbingMode === 'dialogue' ? 'rgba(56, 189, 248, 0.16)' : 'rgba(255, 255, 255, 0.03)',
                color: dubbingMode === 'dialogue' ? '#38BDF8' : '#CBD5E1',
                border: dubbingMode === 'dialogue' ? '1px solid rgba(56, 189, 248, 0.5)' : '1px solid transparent',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                transition: 'all 0.15s ease',
              }}
              title="បកប្រែសន្ទនា ១-ទល់-១ ត្រូវតាមមាត់ និងសំឡេងតួអង្គ"
            >
              <MessageSquare size={12} />
              <span>Mode A: សន្ទនាតួអង្គ</span>
              {dubbingMode === 'dialogue' && <Check size={11} />}
            </button>
            <button
              type="button"
              data-testid="batch-dubbing-mode-recap"
              onClick={() => {
                setDubbingMode('recap');
                if (recapStyle !== 'story_recap' && recapStyle !== 'fast_recap') setRecapStyle('story_recap');
              }}
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                fontSize: '0.72rem',
                fontWeight: dubbingMode === 'recap' ? 800 : 600,
                background: dubbingMode === 'recap' ? 'rgba(168, 85, 247, 0.16)' : 'rgba(255, 255, 255, 0.03)',
                color: dubbingMode === 'recap' ? '#C084FC' : '#CBD5E1',
                border: dubbingMode === 'recap' ? '1px solid rgba(168, 85, 247, 0.5)' : '1px solid transparent',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                transition: 'all 0.15s ease',
              }}
              title="និទានដំណើររឿងបែប TikTok/Reels រស់រវើក"
            >
              <Film size={12} />
              <span>Mode B: សម្រាយរឿង</span>
              {dubbingMode === 'recap' && <Check size={11} />}
            </button>
          </div>

          {dubbingMode === 'recap' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: '0.68rem', color: '#E2E8F0' }}>
                <input
                  type="radio"
                  name="batchRecapStyle"
                  value="story_recap"
                  checked={recapStyle === 'story_recap'}
                  onChange={(e) => setRecapStyle(e.target.value)}
                  style={{ accentColor: '#38BDF8' }}
                />
                <span>Story Recap</span>
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: '0.68rem', color: '#E2E8F0' }}>
                <input
                  type="radio"
                  name="batchRecapStyle"
                  value="fast_recap"
                  checked={recapStyle === 'fast_recap'}
                  onChange={(e) => setRecapStyle(e.target.value)}
                  style={{ accentColor: '#38BDF8' }}
                />
                <span>Fast Recap</span>
              </label>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <button
                  type="button"
                  onClick={() => setNarratorGender('male')}
                  style={{
                    padding: '2px 8px',
                    fontSize: '0.68rem',
                    borderRadius: 5,
                    border: 'none',
                    background: narratorGender === 'male' ? '#2563EB' : 'rgba(255, 255, 255, 0.06)',
                    color: '#FFF',
                    cursor: 'pointer',
                    fontWeight: narratorGender === 'male' ? 700 : 500,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <Mic size={10} /> ពិសិដ្ឋ
                </button>
                <button
                  type="button"
                  onClick={() => setNarratorGender('female')}
                  style={{
                    padding: '2px 8px',
                    fontSize: '0.68rem',
                    borderRadius: 5,
                    border: 'none',
                    background: narratorGender === 'female' ? '#DB2777' : 'rgba(255, 255, 255, 0.06)',
                    color: '#FFF',
                    cursor: 'pointer',
                    fontWeight: narratorGender === 'female' ? 700 : 500,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <Mic size={10} /> ស្រីមុំ
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── FLAT ROW 3: ប្រភេទរឿង (DRAMA GENRE) ── */}
        <div
          data-testid="batch-setup-group-genre"
          style={{
            padding: '8px 12px',
            borderTop: '1px solid rgba(255, 255, 255, 0.06)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label style={{ fontSize: '10.5px', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <BookOpen size={12} color="#38bdf8" />
              <span>ប្រភេទរឿង (DRAMA GENRE)</span>
            </label>
            {activeEpisode?.scriptData?.detectedGenre && (
              <span style={{
                fontSize: '9.5px',
                background: 'rgba(56, 189, 248, 0.12)',
                color: '#38bdf8',
                border: '1px solid rgba(56, 189, 248, 0.3)',
                padding: '1.5px 6px',
                borderRadius: 4,
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}>
                <Sparkles size={10} /> AI: {activeEpisode.scriptData.detectedGenre}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {GENRE_OPTIONS.map((g) => {
              const isSelected = dramaGenre === g.id;
              const GenreIcon = g.icon || Sparkles;
              return (
                <button
                  key={g.id}
                  type="button"
                  data-testid={`batch-genre-${g.id}`}
                  aria-pressed={isSelected}
                  aria-label={`ជ្រើសរើសប្រភេទរឿង ${g.shortLabel || g.label}`}
                  onClick={() => {
                    const res = handleGenreChange({ presetIds, newGenre: g.id });
                    setDramaGenre(res.nextGenre);
                    setPresetIds(res.nextPresetIds);
                  }}
                  title={g.hint}
                  style={{
                    padding: '4px 9px',
                    fontSize: '11px',
                    borderRadius: 6,
                    border: isSelected ? '1.5px solid #38bdf8' : '1px solid rgba(255, 255, 255, 0.08)',
                    background: isSelected
                      ? 'linear-gradient(135deg, rgba(14, 165, 233, 0.25) 0%, rgba(56, 189, 248, 0.15) 100%)'
                      : '#0b0f19',
                    color: isSelected ? '#38bdf8' : '#cbd5e1',
                    cursor: 'pointer',
                    fontWeight: isSelected ? 700 : 500,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    transition: 'all 0.15s ease',
                    boxShadow: isSelected ? '0 0 10px rgba(56, 189, 248, 0.25)' : 'none',
                  }}
                >
                  <GenreIcon size={12} />
                  <span>{g.shortLabel || g.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── FLAT ROW 4: ឈ្មោះតួអង្គ / DIRECTION (1-Click Smart Prompt Chips + Textarea) ── */}
        <div
          data-testid="batch-setup-group-direction"
          style={{
            padding: '8px 12px',
            borderTop: '1px solid rgba(255, 255, 255, 0.06)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label style={{ fontSize: '10.5px', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', display: 'flex', alignItems: 'center', gap: 5 }}>
              <span>{dubbingMode === 'dialogue' ? 'ឈ្មោះតួអង្គ / DIRECTION' : 'ទិសដៅសម្រាយបន្ថែម (DIRECTION)'}</span>
              <span style={{ fontSize: '9px', color: '#64748b', background: 'rgba(255, 255, 255, 0.06)', padding: '1px 5px', borderRadius: 3, fontWeight: 500, textTransform: 'none' }}>
                ស្រេចចិត្ត
              </span>
            </label>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {(customText || presetIds.length > 0) && (
                <button
                  type="button"
                  data-testid="batch-direction-clear"
                  aria-label="សម្អាតទិសដៅបន្ថែម"
                  onClick={() => {
                    setCustomText('');
                    setPresetIds([]);
                  }}
                  style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '10px', cursor: 'pointer', fontWeight: 600 }}
                  title="សម្អាតទិសដៅបន្ថែម (Clear custom text)"
                >
                  ✕ សម្អាត
                </button>
              )}
              <button
                type="button"
                data-testid="batch-direction-more-toggle"
                onClick={() => setIsDirectionExpanded((prev) => !prev)}
                style={{ display: 'none' }}
                aria-hidden="true"
              >
                {isDirectionExpanded ? 'បង្រួម ▴' : 'more ▾'}
              </button>
            </div>
          </div>

          {/* 1-Click Smart Prompt Chips */}
          <div
            data-testid="batch-smart-prompt-chips"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 5,
            }}
          >
            {SMART_PROMPT_CHIPS.map((chip) => {
              const isChipActive = presetIds.includes(chip.id);
              const ChipIcon = chip.icon || Sparkles;
              return (
                <button
                  key={chip.id}
                  type="button"
                  data-testid={`batch-smart-prompt-chip-${chip.id}`}
                  aria-pressed={isChipActive}
                  aria-label={`ទិសដៅ ${chip.shortLabel || chip.label}`}
                  title={chip.promptText}
                  onClick={() => {
                    const res = togglePreset({ presetIds, targetId: chip.id, currentGenre: dramaGenre });
                    setPresetIds(res.nextPresetIds);
                    if (res.nextGenre !== dramaGenre) {
                      setDramaGenre(res.nextGenre);
                    }
                  }}
                  style={{
                    padding: '3.5px 8px',
                    borderRadius: 6,
                    fontSize: '10.5px',
                    fontWeight: isChipActive ? 700 : 500,
                    fontFamily: "'Kantumruy Pro', 'Battambang', system-ui, sans-serif",
                    background: isChipActive
                      ? 'rgba(56, 189, 248, 0.2)'
                      : 'rgba(15, 23, 42, 0.75)',
                    color: isChipActive ? '#38bdf8' : '#cbd5e1',
                    border: isChipActive
                      ? '1px solid rgba(56, 189, 248, 0.55)'
                      : '1px solid rgba(255, 255, 255, 0.09)',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    transition: 'all 0.15s ease',
                  }}
                >
                  <ChipIcon size={12} color={isChipActive ? '#38bdf8' : '#94a3b8'} />
                  <span>{chip.shortLabel || chip.label}</span>
                </button>
              );
            })}
          </div>

          {/* Direct Textarea exactly matching Image 2 */}
          <textarea
            rows={2}
            data-testid="batch-direction-textarea"
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            placeholder={dubbingMode === 'dialogue'
              ? 'ឧ. រឿងភាគបុរាណចិន, តួប្រុសឈ្មោះ: លីនហ្វេង...'
              : 'ឧ. សម្រាយបែបរន្ធត់ ជក់ចិត្ត ផ្តោតលើប្រយុទ្ធ...'}
            style={{
              width: '100%',
              padding: '9px 12px',
              borderRadius: 8,
              background: '#0a0d15',
              border: '1px solid #1e2536',
              color: '#f1f5f9',
              fontSize: '11px',
              resize: 'vertical',
              fontFamily: "'Kantumruy Pro', 'Battambang', system-ui, sans-serif",
              lineHeight: 1.5,
              boxSizing: 'border-box',
              outline: 'none',
              transition: 'all 0.15s ease',
            }}
            onFocus={(e) => e.target.style.borderColor = dubbingMode === 'dialogue' ? '#38bdf8' : '#c084fc'}
            onBlur={(e) => e.target.style.borderColor = '#1e2536'}
          />
        </div>
      </div>
    )}
  </div>
  );
}

export default React.memo(BatchScriptSetupPanel);
