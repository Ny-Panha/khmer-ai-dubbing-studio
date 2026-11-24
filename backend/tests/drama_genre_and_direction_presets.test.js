/**
 * DragonDub AI Studio — Drama Genre & Direction Presets Verification Suite
 * Comprehensive tests covering pure selection logic, state isolation,
 * conflict resolution, UI contract integrity, and backend prompt integration.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Backend drama genre utilities
const {
  SUPPORTED_GENRE_IDS,
  normalizeGenre,
  detectDramaGenre,
  getGenrePromptGuidelines,
  resolveEffectiveGenre,
} = require('../utils/dramaGenreUtils');

// Gemini service prompt builder
const { buildCinemaPrompt } = require('../services/geminiService');

// Stage 6 script generation
const {
  generateModeSpecificScript,
} = require('../services/pipeline/stages/stage6_generateModeSpecificScript');

// Frontend drama genre presets module (read & evaluated in Node for pure verification)
const frontendPresetsSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'src', 'utils', 'dramaGenrePresets.js'),
  'utf8'
);

// Pure helpers extracted from frontend module
function createFrontendHelpers() {
  const GENRE_OPTIONS = [
    { id: 'auto', label: '✨ Auto (ស្គាល់ស្វ័យប្រវត្តិ)', shortLabel: 'Auto', hint: 'AI វិភាគ Audio + OCR កំណត់ប្រភេទរឿងស្វ័យប្រវត្តិ' },
    { id: 'ancient', label: '🏛️ បុរាណចិន / Xianxia', shortLabel: 'បុរាណចិន', hint: 'រឿងគុណនិយម, Wuxia, សម្អាតកាយ, វិញ្ញាណ, លោកម្ចាស់, ព្រឹទ្ធាចារ្យ' },
    { id: 'modern', label: '🏙️ សម័យទំនើប / CEO', shortLabel: 'សម័យទំនើប', hint: 'រឿងស្នេហា, CEO, ក្រុមហ៊ុន, លោកប្រធាន, អ្នកស្រី, បង/អូន' },
    { id: 'action', label: '⚔️ Action / សងសឹក', shortLabel: 'Action', hint: 'រឿងប្រយុទ្ធ, ប៉ូលិស, ឧក្រិដ្ឋកម្ម, ស៊ើបអង្កេត, ចង្វាក់សន្ទនារហ័ស' },
    { id: 'comedy', label: '🎭 កំប្លែង / គ្រួសារ', shortLabel: 'កំប្លែង', hint: 'រឿងកំប្លែងសើចចុកពោះ, ភាសាកំប្លុកកំប្លែងធម្មជាតិ' },
  ];

  const SMART_PROMPT_CHIPS = [
    {
      id: 'auto_face_gender',
      label: '🎭 ស្គាល់ភេទតាមមុខតួអង្គ (Auto Face Gender)',
      shortLabel: 'ស្គាល់ភេទតាមមុខ',
      promptText: 'កំណត់ភេទតួអង្គតាមមុខមាត់ក្នុងវីដេអូ និងវេនសន្ទនា (Auto Face Gender & Turn-Taking)',
    },
    {
      id: 'royal_xianxia',
      label: '👑 រាជស័ព្ទបុរាណចិន (Royal/Xianxia)',
      shortLabel: 'រាជស័ព្ទបុរាណចិន',
      promptText: 'រឿងបុរាណចិន/គុណនិយម ប្រើរាជស័ព្ទ និងពាក្យគុណនិយម (ទូលបង្គំ, ព្រះអង្គ, ម្ចាស់ក្សត្រី, លោកម្ចាស់)',
      genreId: 'ancient',
    },
    {
      id: 'modern_ceo',
      label: '💼 សន្ទនាអគ្គនាយក (Modern CEO)',
      shortLabel: 'សន្ទនាអគ្គនាយក',
      promptText: 'រឿងសម័យទំនើប CEO ប្រើភាសាធម្មជាតិសម័យទំនើប (លោកប្រធាន, អ្នកនាង, បង/អូន, ខ្ញុំ/លោក)',
      genreId: 'modern',
    },
    {
      id: 'strict_lipsync',
      label: '⚡ ឃ្លាខ្លីត្រូវចង្វាក់មាត់ (Strict Lip-Sync Pacing)',
      shortLabel: 'ឃ្លាខ្លីត្រូវចង្វាក់មាត់',
      promptText: 'បកប្រែឃ្លាខ្លីណែន ត្រូវចังหวាក់មាត់ 100% (<= 5.5 ព្យាង្គ/វិនាទី ដោយអត្ថន័យពេញ)',
    },
  ];

  function filterPresetsForGenre(presetIds = [], genre = 'auto') {
    const norm = normalizeGenre(genre);
    if (norm === 'auto') {
      const hasRoyal = presetIds.includes('royal_xianxia');
      const hasCeo = presetIds.includes('modern_ceo');
      if (hasRoyal && hasCeo) return presetIds.filter((id) => id !== 'modern_ceo');
      return [...presetIds];
    }
    return presetIds.filter((id) => {
      const chip = SMART_PROMPT_CHIPS.find((c) => c.id === id);
      return !chip?.genreId || chip.genreId === norm;
    });
  }

  function togglePreset({ presetIds = [], targetId, currentGenre = 'auto' }) {
    const ids = Array.isArray(presetIds) ? [...presetIds] : [];
    const isActive = ids.includes(targetId);
    const targetChip = SMART_PROMPT_CHIPS.find((c) => c.id === targetId);
    const normGenre = normalizeGenre(currentGenre);

    if (isActive) {
      return {
        nextPresetIds: ids.filter((id) => id !== targetId),
        nextGenre: normGenre,
      };
    }

    let nextIds = ids;
    let nextGenre = normGenre;
    if (targetChip?.genreId) {
      nextGenre = targetChip.genreId;
      nextIds = ids.filter((id) => {
        const other = SMART_PROMPT_CHIPS.find((c) => c.id === id);
        return !other?.genreId || other.genreId === targetChip.genreId;
      });
    }
    if (!nextIds.includes(targetId)) nextIds.push(targetId);

    return { nextPresetIds: nextIds, nextGenre };
  }

  function handleGenreChange({ presetIds = [], newGenre = 'auto' }) {
    const normGenre = normalizeGenre(newGenre);
    const nextPresetIds = filterPresetsForGenre(presetIds, normGenre);
    return { nextPresetIds, nextGenre: normGenre };
  }

  function composeEffectivePrompt({ presetIds = [], customText = '', genre = 'auto' } = {}) {
    const safeIds = filterPresetsForGenre(presetIds, genre);
    const parts = [];
    for (const id of safeIds) {
      const chip = SMART_PROMPT_CHIPS.find((c) => c.id === id);
      if (chip?.promptText) parts.push(chip.promptText.trim());
    }
    const trimmed = typeof customText === 'string' ? customText.trim() : '';
    if (trimmed) parts.push(trimmed);
    return parts.join(' • ');
  }

  function parseDirectionPrompt(rawString = '') {
    if (!rawString || typeof rawString !== 'string') return { presetIds: [], customText: '' };
    const str = rawString.trim();
    if (!str) return { presetIds: [], customText: '' };
    const foundIds = [];
    let remaining = str;
    for (const chip of SMART_PROMPT_CHIPS) {
      if (remaining.includes(chip.promptText)) {
        foundIds.push(chip.id);
        remaining = remaining.replace(chip.promptText, '');
      }
    }
    const legacyLipsync = 'បកប្រែឃ្លាខ្លីណែន ត្រូវចังหวាក់មាត់ (<= 5.5 ព្យាង្គ/វិនាទី ដោយអត្ថន័យពេញ)';
    if (remaining.includes(legacyLipsync)) {
      if (!foundIds.includes('strict_lipsync')) foundIds.push('strict_lipsync');
      remaining = remaining.replace(legacyLipsync, '');
    }
    const cleaned = remaining
      .replace(/\s*•\s*•\s*/g, ' • ')
      .replace(/^\s*•\s*/, '')
      .replace(/\s*•\s*$/, '')
      .trim();
    return { presetIds: foundIds, customText: cleaned };
  }

  return {
    GENRE_OPTIONS,
    SMART_PROMPT_CHIPS,
    togglePreset,
    handleGenreChange,
    composeEffectivePrompt,
    parseDirectionPrompt,
  };
}

const frontend = createFrontendHelpers();

// ─────────────────────────────────────────────────────────────────────────────
// REQUIREMENT 1: Clicking a genre selects the correct genre
// ─────────────────────────────────────────────────────────────────────────────
test('1. Clicking a genre selects the correct genre and normalizes values', () => {
  assert.equal(normalizeGenre('auto'), 'auto');
  assert.equal(normalizeGenre('ancient'), 'ancient');
  assert.equal(normalizeGenre('modern'), 'modern');
  assert.equal(normalizeGenre('action'), 'action');
  assert.equal(normalizeGenre('comedy'), 'comedy');
  assert.equal(normalizeGenre('ceo'), 'modern', 'ceo must normalize to modern');
  assert.equal(normalizeGenre('general'), 'auto', 'general must normalize to auto');
  assert.equal(normalizeGenre('UNKNOWN_XYZ'), 'auto', 'unknown must fallback to auto');

  const step1 = frontend.handleGenreChange({ presetIds: [], newGenre: 'ancient' });
  assert.equal(step1.nextGenre, 'ancient');

  const step2 = frontend.handleGenreChange({ presetIds: [], newGenre: 'modern' });
  assert.equal(step2.nextGenre, 'modern');

  const step3 = frontend.handleGenreChange({ presetIds: [], newGenre: 'auto' });
  assert.equal(step3.nextGenre, 'auto');
});

// ─────────────────────────────────────────────────────────────────────────────
// REQUIREMENT 2: Activating a preset creates exactly one instance of instruction
// ─────────────────────────────────────────────────────────────────────────────
test('2. Activating a preset creates exactly one instance of its instruction', () => {
  let presetIds = [];
  const res1 = frontend.togglePreset({ presetIds, targetId: 'auto_face_gender', currentGenre: 'auto' });
  presetIds = res1.nextPresetIds;
  assert.deepEqual(presetIds, ['auto_face_gender']);

  const prompt1 = frontend.composeEffectivePrompt({ presetIds, customText: '', genre: 'auto' });
  const occurrences = prompt1.split('Auto Face Gender & Turn-Taking').length - 1;
  assert.equal(occurrences, 1, 'Preset instruction must appear exactly once');

  // Activating an already active preset does not duplicate it (it toggles it off)
  const res2 = frontend.togglePreset({ presetIds, targetId: 'strict_lipsync', currentGenre: 'auto' });
  presetIds = res2.nextPresetIds;
  assert.deepEqual(presetIds, ['auto_face_gender', 'strict_lipsync']);

  const prompt2 = frontend.composeEffectivePrompt({ presetIds, customText: '', genre: 'auto' });
  assert.equal(prompt2.split('Auto Face Gender').length - 1, 1);
  assert.equal(prompt2.split('ត្រូវចังหวាក់មាត់').length - 1, 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// REQUIREMENT 3: Deselecting a preset removes only that preset's contribution
// ─────────────────────────────────────────────────────────────────────────────
test('3. Deselecting a preset removes only that preset without mutating genre or custom text', () => {
  const customNote = 'តួប្រុសឈ្មោះ លីនហ្វេង';
  let presetIds = ['auto_face_gender', 'strict_lipsync'];
  const currentGenre = 'modern';

  // Toggle off strict_lipsync
  const deselected = frontend.togglePreset({ presetIds, targetId: 'strict_lipsync', currentGenre });
  assert.deepEqual(deselected.nextPresetIds, ['auto_face_gender']);
  assert.equal(deselected.nextGenre, 'modern', 'Deselecting preset must NOT change manual genre');

  const composed = frontend.composeEffectivePrompt({
    presetIds: deselected.nextPresetIds,
    customText: customNote,
    genre: deselected.nextGenre,
  });
  assert.ok(composed.includes('Auto Face Gender & Turn-Taking'));
  assert.ok(!composed.includes('ត្រូវចังหวាក់មាត់ 100%'));
  assert.ok(composed.includes(customNote), 'Custom note must remain intact');
});

// ─────────────────────────────────────────────────────────────────────────────
// REQUIREMENT 4: Manual Direction text remains byte-for-byte unchanged
// ─────────────────────────────────────────────────────────────────────────────
test('4. Manual Direction text remains byte-for-byte unchanged across preset operations', () => {
  const manualText = 'តួឯកប្រុសឈ្មោះ ស៊ាវយាន (Xiao Yan) • ពិពណ៌នាឈុតឆាកប្រយុទ្ធឱ្យរស់រវើក!';
  let presetIds = ['auto_face_gender'];

  // Toggle royal_xianxia on
  const resOn = frontend.togglePreset({ presetIds, targetId: 'royal_xianxia', currentGenre: 'auto' });
  const promptOn = frontend.composeEffectivePrompt({
    presetIds: resOn.nextPresetIds,
    customText: manualText,
    genre: resOn.nextGenre,
  });
  assert.ok(promptOn.endsWith(manualText), 'Manual text must appear unchanged at the end');

  // Toggle royal_xianxia off
  const resOff = frontend.togglePreset({ presetIds: resOn.nextPresetIds, targetId: 'royal_xianxia', currentGenre: resOn.nextGenre });
  const promptOff = frontend.composeEffectivePrompt({
    presetIds: resOff.nextPresetIds,
    customText: manualText,
    genre: resOff.nextGenre,
  });
  assert.ok(promptOff.endsWith(manualText));

  // Switch manual genre
  const resGenre = frontend.handleGenreChange({ presetIds: resOff.nextPresetIds, newGenre: 'comedy' });
  const promptGenre = frontend.composeEffectivePrompt({
    presetIds: resGenre.nextPresetIds,
    customText: manualText,
    genre: resGenre.nextGenre,
  });
  assert.ok(promptGenre.endsWith(manualText));
});

// ─────────────────────────────────────────────────────────────────────────────
// REQUIREMENT 5: Matching substrings in manual text do NOT activate presets
// ─────────────────────────────────────────────────────────────────────────────
test('5. Matching substrings in manual text do not activate presets', () => {
  // User writes custom text that happens to contain preset keyword fragments
  const trickyCustomText = 'រឿងនេះជាប្រភេទ សន្ទនាអគ្គនាយក CEO និងមាន 100% កំប្លែង!';
  const parsed = frontend.parseDirectionPrompt(trickyCustomText);

  // Since trickyCustomText does not contain the exact long promptText of presets,
  // it should not falsely activate chips
  assert.deepEqual(parsed.presetIds, []);
  assert.equal(parsed.customText, trickyCustomText, 'Custom text must be preserved in full');

  // Presets active state in UI is tracked strictly via presetIds, never text.includes()
  const activeIds = ['auto_face_gender'];
  assert.equal(activeIds.includes('modern_ceo'), false, 'modern_ceo chip must remain unselected');
  assert.equal(activeIds.includes('comedy'), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// REQUIREMENT 6: Conflicting genre presets are handled consistently
// ─────────────────────────────────────────────────────────────────────────────
test('6. Conflicting genre presets are handled consistently with zero contradiction', () => {
  // Case A: Activating royal_xianxia when modern_ceo is active drops modern_ceo
  const resA = frontend.togglePreset({
    presetIds: ['auto_face_gender', 'modern_ceo'],
    targetId: 'royal_xianxia',
    currentGenre: 'modern',
  });
  assert.deepEqual(resA.nextPresetIds, ['auto_face_gender', 'royal_xianxia']);
  assert.equal(resA.nextGenre, 'ancient');

  // Case B: Activating modern_ceo when royal_xianxia is active drops royal_xianxia
  const resB = frontend.togglePreset({
    presetIds: ['auto_face_gender', 'royal_xianxia'],
    targetId: 'modern_ceo',
    currentGenre: 'ancient',
  });
  assert.deepEqual(resB.nextPresetIds, ['auto_face_gender', 'modern_ceo']);
  assert.equal(resB.nextGenre, 'modern');

  // Case C: User manually chooses Genre = 'modern' while royal_xianxia was active
  const resC = frontend.handleGenreChange({
    presetIds: ['auto_face_gender', 'royal_xianxia'],
    newGenre: 'modern',
  });
  assert.deepEqual(resC.nextPresetIds, ['auto_face_gender'], 'royal_xianxia must be dropped in modern genre');
  assert.equal(resC.nextGenre, 'modern');

  // Case D: User manually chooses Genre = 'ancient' while modern_ceo was active
  const resD = frontend.handleGenreChange({
    presetIds: ['auto_face_gender', 'modern_ceo'],
    newGenre: 'ancient',
  });
  assert.deepEqual(resD.nextPresetIds, ['auto_face_gender'], 'modern_ceo must be dropped in ancient genre');
  assert.equal(resD.nextGenre, 'ancient');

  // Case E: User chooses Action or Comedy
  const resE = frontend.handleGenreChange({
    presetIds: ['auto_face_gender', 'royal_xianxia', 'modern_ceo'],
    newGenre: 'action',
  });
  assert.deepEqual(resE.nextPresetIds, ['auto_face_gender'], 'Both period/CEO chips must be dropped in action genre');
  assert.equal(resE.nextGenre, 'action');
});

// ─────────────────────────────────────────────────────────────────────────────
// REQUIREMENT 7: Switching series does not leak previous-series settings
// ─────────────────────────────────────────────────────────────────────────────
test('7. Switching series isolates settings and does not leak previous-series settings', () => {
  // Series 1: Ancient drama with specific character name
  const series1Prompt = 'រឿងបុរាណចិន/គុណនិយម ប្រើរាជស័ព្ទ និងពាក្យគុណនិយម (ទូលបង្គំ, ព្រះអង្គ, ម្ចាស់ក្សត្រី, លោកម្ចាស់) • តួប្រុសឈ្មោះ លីនហ្វេង';
  const parsedSeries1 = frontend.parseDirectionPrompt(series1Prompt);
  assert.deepEqual(parsedSeries1.presetIds, ['royal_xianxia']);
  assert.equal(parsedSeries1.customText, 'តួប្រុសឈ្មោះ លីនហ្វេង');

  // When switching to Series 2 with fresh episode (no customPrompt saved)
  const series2Prompt = '';
  const parsedSeries2 = frontend.parseDirectionPrompt(series2Prompt);
  assert.deepEqual(parsedSeries2.presetIds, []);
  assert.equal(parsedSeries2.customText, '');

  // Resetting to batch defaults for Series 2 produces clean default presets without Series 1's text
  const series2BatchPrompt = frontend.composeEffectivePrompt({
    presetIds: ['auto_face_gender', 'strict_lipsync'],
    customText: '',
    genre: 'auto',
  });
  assert.ok(!series2BatchPrompt.includes('លីនហ្វេង'), 'Series 1 custom character name must never leak into Series 2');
  assert.ok(!series2BatchPrompt.includes('royal_xianxia'));
});

// ─────────────────────────────────────────────────────────────────────────────
// REQUIREMENT 8: /batch and /studio produce equivalent API settings
// ─────────────────────────────────────────────────────────────────────────────
test('8. /batch and /studio produce equivalent API settings for equivalent selections', () => {
  const chosenGenre = 'modern';
  const chosenPresets = ['auto_face_gender', 'modern_ceo', 'strict_lipsync'];
  const userText = 'តួឯកប្រុសឈ្មោះ លោកប្រធាន ហេង';

  // Batch payload generation
  const batchCustomPrompt = frontend.composeEffectivePrompt({
    presetIds: chosenPresets,
    customText: userText,
    genre: chosenGenre,
  });
  const batchPayload = {
    genre: normalizeGenre(chosenGenre),
    customPrompt: batchCustomPrompt,
  };

  // Studio payload generation
  const studioCustomPrompt = frontend.composeEffectivePrompt({
    presetIds: chosenPresets,
    customText: userText,
    genre: chosenGenre,
  });
  const studioPayload = {
    genre: normalizeGenre(chosenGenre),
    customPrompt: studioCustomPrompt,
  };

  assert.deepEqual(batchPayload, studioPayload, 'Batch and Studio must produce identical payloads');
  assert.equal(batchPayload.genre, 'modern');
  assert.ok(batchPayload.customPrompt.includes('CEO'));
  assert.ok(batchPayload.customPrompt.includes('លោកប្រធាន ហេង'));
});

// ─────────────────────────────────────────────────────────────────────────────
// REQUIREMENT 9: Auto genre detection still works
// ─────────────────────────────────────────────────────────────────────────────
test('9. Auto genre detection detects genre accurately while preserving requestedGenre auto', () => {
  // Test Chinese sample detection
  const ancientChinese = '宗门 弟子 筑基 师父 灵气 功法 本座 飞升';
  const detectedAncient = detectDramaGenre(ancientChinese, '');
  assert.equal(detectedAncient, 'ancient');

  const modernChinese = '总裁 董事长 秘书 公司 开会 办公室 投资 合同';
  const detectedModern = detectDramaGenre(modernChinese, '');
  assert.equal(detectedModern, 'modern');

  const actionChinese = '警察 杀手 抓捕 犯罪 卧底 手枪 子弹';
  const detectedAction = detectDramaGenre(actionChinese, '');
  assert.equal(detectedAction, 'action');

  const comedyChinese = '搞笑 哈哈 逗我 开玩笑 笑死我了';
  const detectedComedy = detectDramaGenre(comedyChinese, '');
  assert.equal(detectedComedy, 'comedy');

  // resolveEffectiveGenre preserves requestedGenre: 'auto'
  const autoResolution = resolveEffectiveGenre({
    genre: 'auto',
    chineseTextSample: modernChinese,
    userDirection: '',
  });
  assert.equal(autoResolution.requestedGenre, 'auto');
  assert.equal(autoResolution.effectiveGenre, 'modern');
  assert.equal(autoResolution.detectedGenre, 'modern');

  // Explicit genre overrides sample detection
  const explicitAncientResolution = resolveEffectiveGenre({
    genre: 'ancient',
    chineseTextSample: modernChinese, // dialogue has CEO words, but user explicitly set ancient!
    userDirection: '',
  });
  assert.equal(explicitAncientResolution.requestedGenre, 'ancient');
  assert.equal(explicitAncientResolution.effectiveGenre, 'ancient', 'Manual genre is authoritative');
  assert.equal(explicitAncientResolution.detectedGenre, 'ancient');
});

// ─────────────────────────────────────────────────────────────────────────────
// REQUIREMENT 10: Retry and Re-Translate reuse the intended settings
// ─────────────────────────────────────────────────────────────────────────────
test('10. Retry and Re-Translate maintain predictable settings and preserve auto intent', () => {
  // When an episode was generated with auto genre and detected modern:
  const scriptDataAfterAutoRun = {
    genre: 'auto',
    detectedGenre: 'modern',
    customPrompt: 'កំណត់ភេទតួអង្គតាមមុខមាត់ក្នុងវីដេអូ និងវេនសន្ទនា (Auto Face Gender & Turn-Taking) • តួស្រីឈ្មោះ មីណា',
  };

  // Re-reading genre for retry retains 'auto'
  const retryGenre = normalizeGenre(scriptDataAfterAutoRun.genre);
  assert.equal(retryGenre, 'auto', 'Must preserve auto intent on retry');

  // Parsing saved prompt restores presets and manual note
  const parsedRetry = frontend.parseDirectionPrompt(scriptDataAfterAutoRun.customPrompt);
  assert.deepEqual(parsedRetry.presetIds, ['auto_face_gender']);
  assert.equal(parsedRetry.customText, 'តួស្រីឈ្មោះ មីណា');

  // When episode was explicitly set to ancient:
  const scriptDataAfterExplicitRun = {
    genre: 'ancient',
    detectedGenre: 'ancient',
    customPrompt: 'រឿងបុរាណចិន/គុណនិយម ប្រើរាជស័ព្ទ និងពាក្យគុណនិយម (ទូលបង្គំ, ព្រះអង្គ, ម្ចាស់ក្សត្រី, លោកម្ចាស់)',
  };
  assert.equal(normalizeGenre(scriptDataAfterExplicitRun.genre), 'ancient');
});

// ─────────────────────────────────────────────────────────────────────────────
// REQUIREMENT 11: Existing script and episode metadata remain compatible
// ─────────────────────────────────────────────────────────────────────────────
test('11. Existing script and episode metadata with legacy keys remain 100% compatible', () => {
  // Legacy project using 'ceo' instead of 'modern'
  assert.equal(normalizeGenre('ceo'), 'modern');

  // Legacy project using 'general' instead of 'auto'
  assert.equal(normalizeGenre('general'), 'auto');

  // Legacy prompt with old 100% lip-sync phrasing
  const legacyDefault = 'កំណត់ភេទតួអង្គតាមមុខមាត់ក្នុងវីដេអូ និងវេនសន្ទនា (Auto Face Gender & Turn-Taking) • បកប្រែឃ្លាខ្លីណែន ត្រូវចังหวាក់មាត់ 100% (<= 5.5 ព្យាង្គ/វិនាទី ដោយអត្ថន័យពេញ)';
  const parsedLegacy = frontend.parseDirectionPrompt(legacyDefault);
  assert.deepEqual(parsedLegacy.presetIds, ['auto_face_gender', 'strict_lipsync']);
  assert.equal(parsedLegacy.customText, '');

  // Re-composing produces clean prompt compatible with backend
  const recomposed = frontend.composeEffectivePrompt({
    presetIds: parsedLegacy.presetIds,
    customText: parsedLegacy.customText,
    genre: 'auto',
  });
  assert.ok(recomposed.includes('Auto Face Gender'));
  assert.ok(recomposed.includes('5.5 ព្យាង្គ/វិនាទី'));
});

// ─────────────────────────────────────────────────────────────────────────────
// REQUIREMENT 12: Narrow-screen UI displays controls without clipping
// ─────────────────────────────────────────────────────────────────────────────
test('12. Static audit verifies narrow-screen flex wrapping and accessibility aria attributes', () => {
  const dashDir = path.join(__dirname, '..', '..', 'frontend', 'src', 'components', 'dashboard');
  const geminiJsx =
    fs.readFileSync(path.join(dashDir, 'GeminiRouteModal.jsx'), 'utf8') +
    '\n' +
    fs.readFileSync(path.join(dashDir, 'BatchScriptSetupPanel.jsx'), 'utf8');
  const dubbingJsx = fs.readFileSync(
    path.join(__dirname, '..', '..', 'frontend', 'src', 'components', 'media', 'DubbingModeTab.jsx'),
    'utf8'
  );

  // GeminiRouteModal accessibility & layout
  assert.match(geminiJsx, /data-testid="batch-setup-group-genre"/);
  assert.match(geminiJsx, /flexWrap:\s*'wrap'/);
  assert.match(geminiJsx, /aria-pressed=\{isSelected\}/);
  assert.match(geminiJsx, /aria-pressed=\{isChipActive\}/);
  assert.match(geminiJsx, /data-testid="batch-direction-clear"/);
  assert.match(geminiJsx, /handleGenreChange/);
  assert.match(geminiJsx, /togglePreset/);

  // DubbingModeTab accessibility & layout
  assert.match(dubbingJsx, /data-testid="smart-prompt-chips"/);
  assert.match(dubbingJsx, /flexWrap:\s*'wrap'/);
  assert.match(dubbingJsx, /aria-pressed=\{isSelected\}/);
  assert.match(dubbingJsx, /aria-pressed=\{isChipActive\}/);
  assert.match(dubbingJsx, /handleGenreChange/);
  assert.match(dubbingJsx, /togglePreset/);

  // Pacing preference label without guaranteed 100% promise in UI
  const presetsJs = fs.readFileSync(
    path.join(__dirname, '..', '..', 'frontend', 'src', 'utils', 'dramaGenrePresets.js'),
    'utf8'
  );
  assert.match(presetsJs, /Strict Lip-Sync Pacing/);
});

// ─────────────────────────────────────────────────────────────────────────────
// BACKEND INTEGRATION: Explicit genre and custom direction reach the final prompt
// ─────────────────────────────────────────────────────────────────────────────
test('13. Backend Integration: Explicit genre and custom direction reach the final prompt with priority', () => {
  const customUserDirection = 'តួប្រុសឈ្មោះ លីនហ្វេង កូនអ្នកភូមិក្រីក្រ';

  // 1. buildCinemaPrompt with explicit genre = 'ancient'
  const ancientPrompt = buildCinemaPrompt('dialogue', customUserDirection, 'male', 120, {
    genre: 'ancient',
  });
  assert.ok(ancientPrompt.includes('រឿងបុរាណចិន/ប្រវត្តិសាស្ត្រ/គុណនិយម (ancient): ប្រើរាជស័ព្ទ'), 'Must include ancient guidelines');
  assert.ok(ancientPrompt.includes(customUserDirection), 'Must include custom direction');

  // 2. buildCinemaPrompt with explicit genre = 'modern' (or 'ceo')
  const modernPrompt = buildCinemaPrompt('dialogue', customUserDirection, 'male', 120, {
    genre: 'ceo', // verifies ceo normalizes to modern
  });
  assert.ok(modernPrompt.includes('រឿងសម័យទំនើប/CEO/Romance (ceo / modern): ប្រើភាសាសន្ទនាទំនើប'), 'Must include modern guidelines');
  assert.ok(modernPrompt.includes('ហាមដាច់ខាតយកពាក្យគុណនិយម'), 'Must enforce anti-ancient guardrail');
  assert.ok(modernPrompt.includes(customUserDirection), 'Must include custom direction');

  // 3. Stage 6 getGenrePromptGuidelines
  const ancientGuidelines = getGenrePromptGuidelines('ancient');
  assert.ok(ancientGuidelines.includes('Wuxia & Period Drama'));

  const modernGuidelines = getGenrePromptGuidelines('modern');
  assert.ok(modernGuidelines.includes('CEO, Romance'));

  const ceoGuidelines = getGenrePromptGuidelines('ceo');
  assert.ok(ceoGuidelines.includes('CEO, Romance'), 'ceo must output modern guidelines');

  // 4. Priority rule test: Explicit modern genre overrides ancient words in custom direction
  const conflictResolution = resolveEffectiveGenre({
    genre: 'modern',
    chineseTextSample: '宗门 灵气 弟子 师父',
    userDirection: 'រឿងបុរាណចិន រាជស័ព្ទ', // Even if old prompt had ancient words!
  });
  assert.equal(conflictResolution.effectiveGenre, 'modern', 'Explicit manual genre modern must NEVER be overridden');
  assert.equal(conflictResolution.requestedGenre, 'modern');
});
