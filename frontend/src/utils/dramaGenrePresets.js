/**
 * DragonDub AI Studio — Drama Genre & Direction Presets
 * Consolidated configuration and pure selection/composition helpers.
 */

import {
  Sparkles,
  BookOpen,
  Building2,
  Zap,
  Smile,
  UserCheck,
  Crown,
  Briefcase,
} from 'lucide-react';

export const SUPPORTED_GENRE_IDS = ['auto', 'ancient', 'modern', 'action', 'comedy'];

export const GENRE_OPTIONS = [
  {
    id: 'auto',
    label: '✨ Auto (ស្គាល់ស្វ័យប្រវត្តិ)',
    shortLabel: 'Auto',
    icon: Sparkles,
    hint: 'AI វិភាគ Audio + OCR កំណត់ប្រភេទរឿងស្វ័យប្រវត្តិ',
  },
  {
    id: 'ancient',
    label: '🏛️ បុរាណចិន / Xianxia',
    shortLabel: 'បុរាណចិន',
    icon: BookOpen,
    hint: 'រឿងគុណនិយម, Wuxia, សម្អាតកាយ, វិញ្ញាណ, លោកម្ចាស់, ព្រឹទ្ធាចារ្យ',
  },
  {
    id: 'modern',
    label: '🏙️ សម័យទំនើប / CEO',
    shortLabel: 'សម័យទំនើប',
    icon: Building2,
    hint: 'រឿងស្នេហា, CEO, ក្រុមហ៊ុន, លោកប្រធាន, អ្នកស្រី, បង/អូន',
  },
  {
    id: 'action',
    label: '⚔️ Action / សងសឹក',
    shortLabel: 'Action',
    icon: Zap,
    hint: 'រឿងប្រយុទ្ធ, ប៉ូលិស, ឧក្រិដ្ឋកម្ម, ស៊ើបអង្កេត, ចង្វាក់សន្ទនារហ័ស',
  },
  {
    id: 'comedy',
    label: '🎭 កំប្លែង / គ្រួសារ',
    shortLabel: 'កំប្លែង',
    icon: Smile,
    hint: 'រឿងកំប្លែងសើចចុកពោះ, ភាសាកំប្លុកកំប្លែងធម្មជាតិ',
  },
];

export const SMART_PROMPT_CHIPS = [
  {
    id: 'auto_face_gender',
    label: '🎭 ស្គាល់ភេទតាមមុខតួអង្គ (Auto Face Gender)',
    shortLabel: 'ស្គាល់ភេទតាមមុខ',
    icon: UserCheck,
    promptText:
      'កំណត់ភេទតួអង្គតាមមុខមាត់ក្នុងវីដេអូ និងវេនសន្ទនា (Auto Face Gender & Turn-Taking)',
  },
  {
    id: 'royal_xianxia',
    label: '👑 រាជស័ព្ទបុរាណចិន (Royal/Xianxia)',
    shortLabel: 'រាជស័ព្ទបុរាណចិន',
    icon: Crown,
    promptText:
      'រឿងបុរាណចិន/គុណនិយម ប្រើរាជស័ព្ទ និងពាក្យគុណនិយម (ទូលបង្គំ, ព្រះអង្គ, ម្ចាស់ក្សត្រី, លោកម្ចាស់)',
    genreId: 'ancient',
  },
  {
    id: 'modern_ceo',
    label: '💼 សន្ទនាអគ្គនាយក (Modern CEO)',
    shortLabel: 'សន្ទនាអគ្គនាយក',
    icon: Briefcase,
    promptText:
      'រឿងសម័យទំនើប CEO ប្រើភាសាធម្មជាតិសម័យទំនើប (លោកប្រធាន, អ្នកនាង, បង/អូន, ខ្ញុំ/លោក)',
    genreId: 'modern',
  },
  {
    id: 'strict_lipsync',
    label: '⚡ ឃ្លាខ្លីត្រូវចង្វាក់មាត់ (Strict Lip-Sync Pacing)',
    shortLabel: 'ឃ្លាខ្លីត្រូវចង្វាក់មាត់',
    icon: Zap,
    promptText:
      'បកប្រែឃ្លាខ្លីណែន ត្រូវចังหวាក់មាត់ 100% (<= 5.5 ព្យាង្គ/វិនាទី ដោយអត្ថន័យពេញ)',
  },
];

export const DEFAULT_BATCH_PRESET_IDS = Object.freeze(['auto_face_gender', 'strict_lipsync']);

export const DEFAULT_BATCH_DIRECTION =
  'កំណត់ភេទតួអង្គតាមមុខមាត់ក្នុងវីដេអូ និងវេនសន្ទនា (Auto Face Gender & Turn-Taking) • បកប្រែឃ្លាខ្លីណែន ត្រូវចังหวាក់មាត់ 100% (<= 5.5 ព្យាង្គ/វិនាទី ដោយអត្ថន័យពេញ)';

/**
 * Normalize drama genre string to standard supported ID
 * Maps legacy/alias 'ceo' -> 'modern', 'general' -> 'auto'
 */
export function normalizeGenre(genre) {
  if (!genre || typeof genre !== 'string') return 'auto';
  const clean = genre.trim().toLowerCase();
  if (clean === 'ceo') return 'modern';
  if (clean === 'general') return 'auto';
  if (SUPPORTED_GENRE_IDS.includes(clean)) return clean;
  return 'auto';
}

/**
 * Check if a preset chip conflicts with an explicit genre
 */
export function isGenrePresetConflict(presetId, genre) {
  const normGenre = normalizeGenre(genre);
  if (normGenre === 'auto') return false;

  const chip = SMART_PROMPT_CHIPS.find((c) => c.id === presetId);
  if (!chip || !chip.genreId) return false;

  return chip.genreId !== normGenre;
}

/**
 * Filter preset IDs to remove any that directly contradict an explicit manual genre
 */
export function filterPresetsForGenre(presetIds = [], genre = 'auto') {
  if (!Array.isArray(presetIds)) return [];
  const normGenre = normalizeGenre(genre);
  if (normGenre === 'auto') {
    // Prevent both ancient & modern chips being active simultaneously even in auto
    const hasRoyal = presetIds.includes('royal_xianxia');
    const hasCeo = presetIds.includes('modern_ceo');
    if (hasRoyal && hasCeo) {
      // Keep only the first one
      return presetIds.filter((id) => id !== 'modern_ceo');
    }
    return [...presetIds];
  }

  return presetIds.filter((id) => !isGenrePresetConflict(id, normGenre));
}

/**
 * Pure handler for toggling a preset chip.
 * Deterministic rules:
 * 1. If chip is currently active, clicking it deactivates it without mutating genre.
 * 2. If chip is inactive, activating a genre-specific chip sets the corresponding genre and drops conflicting chips.
 * 3. Activating a non-genre chip keeps the current genre.
 */
export function togglePreset({ presetIds = [], targetId, currentGenre = 'auto' }) {
  const ids = Array.isArray(presetIds) ? [...presetIds] : [];
  const isActive = ids.includes(targetId);
  const targetChip = SMART_PROMPT_CHIPS.find((c) => c.id === targetId);
  const normGenre = normalizeGenre(currentGenre);

  if (isActive) {
    // Deselect: remove preset contribution only. Do NOT touch current genre!
    const nextIds = ids.filter((id) => id !== targetId);
    return {
      nextPresetIds: nextIds,
      nextGenre: normGenre,
    };
  }

  // Activate:
  let nextIds = ids;
  let nextGenre = normGenre;

  if (targetChip?.genreId) {
    // Genre preset activated: select that genre and drop any contradictory genre presets
    nextGenre = targetChip.genreId;
    nextIds = ids.filter((id) => {
      const otherChip = SMART_PROMPT_CHIPS.find((c) => c.id === id);
      return !otherChip?.genreId || otherChip.genreId === targetChip.genreId;
    });
  }

  if (!nextIds.includes(targetId)) {
    nextIds.push(targetId);
  }

  return {
    nextPresetIds: nextIds,
    nextGenre,
  };
}

/**
 * Pure handler for manual genre selection.
 * Manual genre selection is authoritative.
 * Drops any active preset that conflicts with the newly chosen genre.
 */
export function handleGenreChange({ presetIds = [], newGenre = 'auto' }) {
  const normGenre = normalizeGenre(newGenre);
  const nextPresetIds = filterPresetsForGenre(presetIds, normGenre);
  return {
    nextPresetIds,
    nextGenre: normGenre,
  };
}

/**
 * Parse a raw direction / customPrompt string into structured preset IDs and residual user text.
 * Ensures existing direction strings from series.json or defaults cleanly populate presets
 * while keeping user-authored text byte-for-byte intact.
 */
export function parseDirectionPrompt(rawString = '') {
  if (!rawString || typeof rawString !== 'string') {
    return { presetIds: [], customText: '' };
  }

  const str = rawString.trim();
  if (!str) {
    return { presetIds: [], customText: '' };
  }

  const foundIds = [];
  let remaining = str;

  // Check known presets by exact promptText
  for (const chip of SMART_PROMPT_CHIPS) {
    if (remaining.includes(chip.promptText)) {
      foundIds.push(chip.id);
      remaining = remaining.replace(chip.promptText, '');
    }
  }

  // Also check legacy variations (e.g. without 100% or with slight punctuation)
  const legacyLipsync = 'បកប្រែឃ្លាខ្លីណែន ត្រូវចង្វាក់មាត់ (<= 5.5 ព្យាង្គ/វិនាទី ដោយអត្ថន័យពេញ)';
  if (remaining.includes(legacyLipsync)) {
    if (!foundIds.includes('strict_lipsync')) foundIds.push('strict_lipsync');
    remaining = remaining.replace(legacyLipsync, '');
  }

  // Clean bullet separators and stray spaces left over from preset removal
  const cleanedCustomText = remaining
    .replace(/\s*•\s*•\s*/g, ' • ')
    .replace(/^\s*•\s*/, '')
    .replace(/\s*•\s*$/, '')
    .trim();

  return {
    presetIds: foundIds,
    customText: cleanedCustomText,
  };
}

/**
 * Compose the effective Direction prompt from active preset IDs, user-authored text, and genre.
 * Drops any contradictory instructions before generating the combined string.
 */
export function composeEffectivePrompt({ presetIds = [], customText = '', genre = 'auto' } = {}) {
  const safePresetIds = filterPresetsForGenre(presetIds, genre);
  const parts = [];

  for (const id of safePresetIds) {
    const chip = SMART_PROMPT_CHIPS.find((c) => c.id === id);
    if (chip?.promptText) {
      parts.push(chip.promptText.trim());
    }
  }

  const trimmedCustom = typeof customText === 'string' ? customText.trim() : '';
  if (trimmedCustom) {
    parts.push(trimmedCustom);
  }

  return parts.join(' • ');
}
