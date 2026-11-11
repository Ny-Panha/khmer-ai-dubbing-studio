# Plan: Batch Generate Studio Impeccable / Unslop UI Cleanup & Unification

## 1. Architecture & Component Boundary
- **Target File**: [`frontend/src/components/dashboard/GeminiRouteModal.jsx`](file:///e:/khmer_ai_dubbing_studio/frontend/src/components/dashboard/GeminiRouteModal.jsx)
- **Verification Test File**: [`backend/tests/ai_detection_and_dubbing_prompt_fix.test.js`](file:///e:/khmer_ai_dubbing_studio/backend/tests/ai_detection_and_dubbing_prompt_fix.test.js)
- **Preserved State & Handlers**:
  - All state hooks (`selectedEpIds`, `pipelineMode`, `dubbingMode`, `recapStyle`, `dramaGenre`, `genre`, `narratorGender`, `customDirection`, `isScriptSetupExpanded`, `isDirectionExpanded`, `isImportingSubtitles`, `importErrors`, `importSuccess`, `isStartingBatch`, `isGeneratingBatchTTS`, `isSeparatingBatchDemucs`, `isRepairingBroken`, etc.) remain intact.
  - All handlers (`handleStartBatchTranslate`, `handleReTranslateSelected`, `handleBatchGenerateTTS`, `handleRepairBrokenSegments`, `handleBatchDemucsSeparation`, `handleKillTranslate`, `handleKillTTS`, `handleKillDemucs`, `handleImportBatchSubtitleFile`, `handleRetryEpisode`, `openStudioDialog`) remain untouched.

## 2. UI Layout Refactor Blueprint
1. **Header (`data-testid="batch-modal-header"`)**:
   - Title: `"BATCH GENERATE STUDIO"`
   - Single Keys Pool Pill: `"5/6 Keys Ready (75 RPM Pool)"` (clickable to open `onOpenQuotaModal` if provided)
   - Close button (`"✕"`)
   - Removed duplicate `data-testid="header-model-cascade-pill"` (`Auto Cascade`) and subtitle noise.
2. **Episode Quick-Select Row (`data-testid="batch-quick-select-row"`)**:
   - Compact single row: `"ជ្រើសរើសភាគ៖ ២ ភាគ (2 EPs) | ៤ ភាគ (4 EPs) | ភាគនៅសល់ | 🌐 ទាំងអស់ | លុប"`.
   - Removed duplicate collapse button from this row.
3. **Unified Collapsible Script Setup Bar (`data-testid="batch-script-setup-section"`)**:
   - Single container with `1px solid rgba(255, 255, 255, 0.08)` border (maximum ONE border level; zero nested cards).
   - **Summary Header Bar (`data-testid="batch-script-setup-toggle"`)**:
     - Shows single summary line: `⚡ Fast OCR • Mode A: សន្ទនាតួអង្គ • 🏛️ បុរាណចិន / Xianxia • 🎭 Auto Face Gender ▾`
   - **Expanded Flat Rows** (separated by `1px solid rgba(255, 255, 255, 0.06)` dividers, preserving `data-testid="batch-setup-group-pipeline"`, `data-testid="batch-setup-group-dubbing-mode"`, `data-testid="batch-setup-group-genre"`, `data-testid="batch-setup-group-direction"`):
     - Row 1 (`Pipeline Mode`): `🎯 Standard Mode` vs `⚡ Fast OCR Mode` (`OCR + Visual Speaker Gender + Direct Translate`) + `📄 Import .srt / .json`.
     - Row 2 (`Dubbing Mode`): `🗣️ Mode A: សន្ទនាតួអង្គ` vs `🎬 Mode B: សម្រាយរឿង` (+ inline Recap Style & Narrator Voice `👨 ពិសិដ្ឋ` / `👩 ស្រីមុំ` when Mode B is active).
     - Row 3 (`Drama Genre`): `✨ Auto (ស្គាល់ស្វ័យប្រវត្តិ)`, `🏛️ បុរាណចិន / Xianxia`, `🏙️ សម័យទំនើប / CEO`, `⚔️ Action / សងសឹក`, `🎭 កំប្លែង / គ្រួសារ`.
     - Row 4 (`Direction & Character Presets`): 4 preset toggle chips (`🎭 ស្គាល់ភេទតាមមុខតួអង្គ (Auto Face Gender)`, `👑 រាជស័ព្ទបុរាណចិន (Royal/Xianxia)`, `💼 សន្ទនាអគ្គនាយក (Modern CEO)`, `⚡ ឃ្លាខ្លីត្រូវមាត់ 100% (Strict Lip-Sync)`), `✕ សម្អាត`, and a 1-line truncated preview (`whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'`) with `more` / `បង្រួម` toggle to expand the `textarea`.
4. **3 Slim Step Status Rows (`data-testid="batch-step-status-rows"`)**:
   - Row 1: `1. Translate (បកប្រែ Script ខ្មែរ)` — icon + label + count (`${healthyScriptedCount}/${episodes.length} ភាគ`) + thin progress bar (`${translatePercent}%`) + status badge (`DONE` / `RUNNING %` / `READY`).
   - Row 2: `2. សំឡេងខ្មែរ AI (Khmer AI Voice)` — icon + label + count (`${completedAudioCount}/${episodes.length} ភាគ`) + thin progress bar (`${audioPercent}%`) + status badge (`DONE` / `RUNNING %` / `READY`).
   - Row 3: `3. បំបែកសំឡេងដើម AI (Demucs Clean BGM)` — icon + label + count (`${completedDemucsCount}/${episodes.length} ភាគ`) + thin progress bar (`${demucsPercent}%`) + status badge (`DONE` / `RUNNING %` / `READY`).
5. **Actions Bar (`data-testid="batch-actions-bar"`)**:
   - **Primary Contextual CTA**: Automatically highlights the active/next unfinished stage (Step 1 Translate -> Step 2 Khmer AI Voice -> Step 3 Demucs AI Clean BGM -> Step 4 Open Export Studio), while allowing direct execution.
   - **Quiet Secondary Row**: Small, low-noise text buttons for direct step triggers (`Translate`, `សំឡេងខ្មែរ AI`, `Demucs AI`), `Re-Translate (FORCE)` (`data-testid="btn-batch-retranslate"`), `🔧 ជួសជុលឃ្លាខូច & Generate ឡើងវិញ` (`data-testid="btn-repair-broken-segments"`), and `🛑 Kill Translate / Kill TTS / Kill Demucs`, plus Step 4 `16:9 | 9:16` & `Open Export Studio`.
6. **Footer**:
   - Removed the duplicate multi-step status tracker (`1. Translate | 2. សំឡេងខ្មែរ AI | 3. Demucs AI`) from the modal footer; kept only the quiet helper tip and `បិទផ្ទាំង (Close)` button.

## 3. Risks, Security & Rollback
- Zero changes to backend routes, state names, or segment status computation.
- All `StudioConfirmDialog` flows remain 100% intact.

