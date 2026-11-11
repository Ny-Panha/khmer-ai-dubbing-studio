# Technical Plan: Reusable 1-by-1 Sequential Dubbing Feature

## 1. Directory Structure
```
frontend/src/features/dubbing-runner/
├── DubbingRunnerContext.jsx      # React Context & Provider managing step execution, abort signals, and live progress state
├── useDubbingFeature.js          # Hook exposing runner methods, active states, and step metrics
├── DubbingStepCardsBar.jsx       # 3 Interactive step cards (1. Script, 2. Voice, 3. Clean BGM) with 1-by-1 Run/Stop
├── DubbingStepButton.jsx         # Universal single-episode or batch step button with real-time status & stop
└── index.js                      # Barrel export for clean imports across the project
```

## 2. API Services Layer Integration
Ensure `frontend/src/services/api.js` provides clean primitives:
- `startGenerationJob` (existing)
- `getJobStatus` / `fetchJobStatusApi` (existing)
- `generateAudioApi` (existing)
- `syncTimelineAudioApi` (existing)
- `separateAudioApi` (add wrapper for `POST /api/audio/separate`)
- `getSeparationProgressApi` (add wrapper for `GET /api/audio/separation-progress`)
- `killSeparationApi` (add wrapper for `POST /api/audio/separate-kill`)

## 3. Sequential Execution Engine Architecture
```
Step Request ('translate' | 'voice' | 'clean_bgm' | 'all3')
   │
   ▼
Resolve Target Episodes:
   episodesList.length > 0 ? episodesList : autoTargetIncompleteForStep(allEpisodes, stepType)
   │
   ▼
Initialize Step State:
   runnerState[stepType] = { status: 'running', currentEpIndex: 1, totalEps: N, currentEpId, progress: 0 }
   abortControllerRef[stepType] = new AbortController()
   │
   ▼
for (let idx = 0; idx < queue.length; idx++) {
   if (aborted) break;
   const ep = queue[idx];
   // AWAIT 100% completion of episode before moving to next:
   await executeStepOnSingleEpisode(stepType, ep, abortSignal, onProgress);
   await onRefreshSeries(); // Reconcile disk state immediately
}
   │
   ▼
Finalize State:
   runnerState[stepType] = { status: 'idle' }
```

## 4. UI Components Architecture
1. **`<DubbingStepCardsBar />`**:
   - Modern `grid-cols-3 gap-3` layout.
   - Replaces the 3 static/progress rows in `GeminiRouteModal.jsx`.
   - Card 1: `📝 1. Script ខ្មែរ (${doneCount}/${totalCount})` + progress bar + `[▶ Run 1-by-1]` / `[🛑 Stop]`
   - Card 2: `🎙️ 2. សំឡេង AI (${doneCount}/${totalCount})` + progress bar + `[▶ Run 1-by-1]` / `[🛑 Stop]`
   - Card 3: `🔇 3. Clean BGM (${doneCount}/${totalCount})` + progress bar + `[▶ Run 1-by-1]` / `[🛑 Stop]`
2. **`<DubbingStepButton />`**:
   - Universal button used in `EP1..EP21` cards, `EpisodesTab`, `DubbingModeTab`, `VoiceSettings`.
   - Renders 4 states:
     - `Idle`: Action trigger (`[📝 បកប្រែ]`, `[🎙️ បង្កើតសំឡេង]`, `[🔇 បិទសំឡេងចិន]`, `[▶ ផលិតទាំង 3]`)
     - `Queued`: `⏳ រង់ចាំលេខរៀង #X...`
     - `Running`: `🔄 កំពុងរត់ X% [Stop]`
     - `Done`: `✅ រួចរាល់ [↺]`

## 5. Verification & Rollback
- Create comprehensive regression test in `backend/tests/reusable_1by1_dubbing_feature.test.js`.
- Verify with `npm --prefix frontend run lint` and `npm --prefix frontend run build`.
- Preserve all existing handlers, state, and test IDs.

