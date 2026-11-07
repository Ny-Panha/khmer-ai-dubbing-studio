import { Video, Sparkles, Mic, Volume2, Download } from 'lucide-react';

export const STEP_IDS = {
  IMPORT: 'import',
  SCRIPT: 'script',
  VOICE: 'voice',
  DEMUCS: 'demucs',
  MIX_EXPORT: 'mix-export',
};

export const WORKFLOW_STEPS = [
  {
    id: STEP_IDS.IMPORT,
    number: 1,
    titleEn: 'Import Video',
    titleKm: 'Import វីដេអូ',
    label: '1. Import Video',
    icon: Video,
    isComplete: (state = {}) => Boolean(state.selectedVideo?.videoId || state.selectedVideo?.videoUrl || state.activeEpisode?.video?.videoId || state.activeEpisode?.video?.videoUrl),
    gateReason: () => null,
  },
  {
    id: STEP_IDS.SCRIPT,
    number: 2,
    titleEn: 'Translate & Script',
    titleKm: 'បកប្រែ & Script',
    label: '2. Translate & Script',
    icon: Sparkles,
    isComplete: (state = {}) => Boolean(state.scriptData?.segments && state.scriptData.segments.length > 0),
    gateReason: (state = {}) => {
      const hasVideo = Boolean(state.selectedVideo?.videoId || state.selectedVideo?.videoUrl || state.activeEpisode?.video?.videoId || state.activeEpisode?.video?.videoUrl);
      if (!hasVideo) {
        return 'សូម Import ឬជ្រើសរើសវីដេអូជាមុនសិន';
      }
      return null;
    },
  },
  {
    id: STEP_IDS.VOICE,
    number: 3,
    titleEn: 'Khmer Voice (TTS)',
    titleKm: 'សំឡេងខ្មែរ (TTS)',
    label: '3. Khmer Voice (TTS)',
    icon: Mic,
    isComplete: (state = {}) => Boolean(state.audioGenerated || state.activeEpisode?.audioGenerated),
    gateReason: (state = {}) => {
      const hasSegments = Boolean(state.scriptData?.segments && state.scriptData.segments.length > 0);
      if (!hasSegments) {
        return 'ត្រូវការ Script បកប្រែជាមុនសិន ទើបអាចបង្កើតសំឡេងបាន';
      }
      return null;
    },
  },
  {
    id: STEP_IDS.DEMUCS,
    number: 4,
    titleEn: 'Demucs AI (BGM)',
    titleKm: 'Demucs AI (BGM)',
    label: '4. Demucs AI',
    icon: Volume2,
    isComplete: (state = {}) => Boolean(state.hasDemucs || state.isDemucsDone || state.cleanBgmPath || state.activeEpisode?.hasDemucs || state.activeEpisode?.isDemucsDone),
    gateReason: (state = {}) => {
      const hasVideo = Boolean(state.selectedVideo?.videoId || state.selectedVideo?.videoUrl || state.activeEpisode?.video?.videoId || state.activeEpisode?.video?.videoUrl);
      if (!hasVideo) {
        return 'សូម Import វីដេអូជាមុនសិន';
      }
      return null;
    },
  },
  {
    id: STEP_IDS.MIX_EXPORT,
    number: 5,
    titleEn: 'Mix & Export',
    titleKm: 'បញ្ចូលសំឡេង & Export',
    label: '5. Mix & Export',
    icon: Download,
    isComplete: (state = {}) => Boolean(state.renderedVideo || state.activeEpisode?.renderedVideo),
    gateReason: (state = {}) => {
      const hasAudio = Boolean(state.audioGenerated || state.activeEpisode?.audioGenerated);
      const hasScript = Boolean(state.scriptData?.segments && state.scriptData.segments.length > 0);
      if (!hasAudio && !hasScript) {
        return 'ត្រូវការ Script ឬសំឡេង dubbing រួចរាល់មុននឹង Export';
      }
      return null;
    },
  },
];

export function isStepReachable(stepId, state = {}) {
  const step = WORKFLOW_STEPS.find((s) => s.id === stepId);
  if (!step) return false;
  // If the step is already completed, it is always re-enterable in 1 click
  if (step.isComplete(state)) return true;
  // Otherwise check gateReason
  return step.gateReason(state) === null;
}

export function getStepById(stepId) {
  return WORKFLOW_STEPS.find((s) => s.id === stepId) || WORKFLOW_STEPS[0];
}

