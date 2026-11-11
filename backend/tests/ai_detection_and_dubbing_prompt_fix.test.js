const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  stripDecorativeSubtitleNoise,
  deduplicateFastOcrCues,
} = require('../services/pipeline/stages/stage3_extractChineseSubtitles');
const {
  FEMALE_KEYWORDS,
  MALE_KEYWORDS,
  KHMER_FEMALE_PRONOUNS,
  KHMER_MALE_PRONOUNS,
  detectSpeakerGender,
  syncSegmentsWithSpeakerRegistry,
} = require('../models/speakerRegistry');

test('Step 1: Center-bottom subtitle ROI, 0.35s short-cue sensitivity, <0.20s merge gap, and multimodal OCR fields', () => {
  const ffmpegSource = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'ffmpegService.js'),
    'utf8'
  );
  const stage3Source = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'pipeline', 'stages', 'stage3_extractChineseSubtitles.js'),
    'utf8'
  );

  // 1. Center-bottom ROI crop (crop=w=0.72*iw:h=0.16*ih:x=0.14*iw:y=0.78*ih)
  assert.match(ffmpegSource, /crop=w=0\.72\*iw:h=0\.16\*ih:x=0\.14\*iw:y=0\.78\*ih/);
  assert.match(ffmpegSource, /options\.minPeakDist\s*:\s*0\.35/);
  assert.match(ffmpegSource, /options\.minCueDurationSec\s*:\s*0\.35/);

  // 2. Stage 3 short-cue floor (0.35s), <0.20s merge gap, and multimodal speaker/gender fields
  assert.match(stage3Source, /Math\.max\(0\.35/);
  assert.match(stage3Source, /<\s*0\.20/);
  assert.match(stage3Source, /visualGender/);
  assert.match(stage3Source, /speakerVisualHint/);
  assert.match(stage3Source, /deliveryType/);

  // 3. Decorative bracket & music-note stripping
  assert.equal(stripDecorativeSubtitleNoise('♪ 【你敢！】 ♪'), '你敢！');
  assert.equal(stripDecorativeSubtitleNoise('《第12集》'), '');
  assert.equal(stripDecorativeSubtitleNoise('♫ 皇上饶命 ♫'), '皇上饶命');

  // 4. deduplicateFastOcrCues preserves short 0.35s cues when >0.20s apart, merges <0.20s identical cues, and propagates visualGender
  const deduped = deduplicateFastOcrCues([
    {
      index: 0,
      startSec: 1.0,
      endSec: 1.38,
      duration: 0.38,
      textZh: '你敢！',
      chineseText: '你敢！',
      visualGender: 'female',
      speakerVisualHint: 'តួស្រីស្លៀកឈុតស',
      deliveryType: 'shouting',
    },
    {
      index: 1,
      startSec: 1.50,
      endSec: 1.90,
      duration: 0.40,
      textZh: '你敢！',
      chineseText: '你敢！',
      visualGender: 'unknown',
      speakerVisualHint: '',
      deliveryType: 'speech',
    },
    {
      index: 2,
      startSec: 2.30,
      endSec: 2.68,
      duration: 0.38,
      textZh: '是！',
      chineseText: '是！',
      visualGender: 'male',
      speakerVisualHint: 'មេទ័ពពាក់អាវក្រោះ',
      deliveryType: 'speech',
    },
  ]);

  assert.equal(deduped.length, 2);
  assert.equal(deduped[0].visualGender, 'female');
  assert.equal(deduped[0].speakerVisualHint, 'តួស្រីស្លៀកឈុតស');
  assert.equal(deduped[0].deliveryType, 'shouting');
  assert.equal(deduped[1].visualGender, 'male');
});

test('Step 2: Gemini & Stage 6 Master Dubbing Prompt (castRegistry, detectedGenre, 3-Signal Gender, Turn-Taking, Genre Vocabulary, Lip-Sync <= 5.5 syllables/sec)', () => {
  const geminiSource = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'geminiService.js'),
    'utf8'
  );
  const stage6Source = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'pipeline', 'stages', 'stage6_generateModeSpecificScript.js'),
    'utf8'
  );

  // 1. Pre-Translation Cast Registry & Genre Locking in Schema + Prompt
  assert.match(geminiSource, /detectedGenre:\s*\{/);
  assert.match(geminiSource, /castRegistry:\s*\{/);
  assert.match(geminiSource, /MANDATORY PRE-TRANSLATION CAST REGISTRY & GENRE LOCKING/);
  assert.match(stage6Source, /MANDATORY PRE-TRANSLATION CAST REGISTRY & GENRE LOCKING/);

  // 2. 3-Signal Gender & Conversational Turn-Taking (A -> B -> A -> B)
  assert.match(geminiSource, /STRICT GENDER & CONVERSATIONAL TURN-TAKING RULES/);
  assert.match(geminiSource, /A -> B -> A -> B/);
  assert.match(stage6Source, /STRICT GENDER & CONVERSATIONAL TURN-TAKING RULES/);
  assert.match(stage6Source, /visualGender:\s*s\.visualGender/);
  assert.match(stage6Source, /speakerVisualHint:\s*s\.speakerVisualHint/);

  // 3. Genre-Specific Khmer Vocabulary & Lip-Sync Duration Rule (<= 5.5 syllables/sec)
  assert.match(geminiSource, /detectedGenre:\s*"ancient"\s*\|\s*"ceo"\s*\|\s*"modern"\s*\|\s*"action"\s*\|\s*"comedy"/);
  assert.match(geminiSource, /5\.5 syllables\/sec/);
  assert.match(stage6Source, /GENRE-SPECIFIC KHMER VOCABULARY & LIP-SYNC PACING RULE/);
  assert.match(stage6Source, /5\.5 syllables\/sec/);
});

test('Step 3: speakerRegistry expanded dictionaries and 3-tier priority detectSpeakerGender (Visual -> CastRegistry -> Self-Pronoun vs Addressed Title)', () => {
  // 1. Expanded keyword & pronoun dictionaries
  assert.ok(FEMALE_KEYWORDS.includes('ម្ចាស់ក្សត្រី'));
  assert.ok(FEMALE_KEYWORDS.includes('ព្រះនាង'));
  assert.ok(FEMALE_KEYWORDS.includes('皇太后'));
  assert.ok(MALE_KEYWORDS.includes('ព្រះអង្គ'));
  assert.ok(MALE_KEYWORDS.includes('លោកប្រធាន'));
  assert.ok(MALE_KEYWORDS.includes('皇上'));
  assert.ok(KHMER_FEMALE_PRONOUNS.includes('ខ្ញុំម្ចាស់'));
  assert.ok(KHMER_FEMALE_PRONOUNS.includes('នាងខ្ញុំ'));
  assert.ok(KHMER_MALE_PRONOUNS.includes('ទូលបង្គំ'));

  // 2. Priority 1: segment.visualGender overrides generic speaker labels
  assert.equal(
    detectSpeakerGender({
      speaker: 'Speaker_1',
      visualGender: 'female',
      khmerText: 'ព្រះអង្គ! ខ្ញុំម្ចាស់សុំទោស!',
    }),
    'FEMALE'
  );

  // 3. Priority 2: castRegistry lookup
  assert.equal(
    detectSpeakerGender(
      {
        speaker: 'Lin Wan',
        visualGender: 'unknown',
        khmerText: 'លោកប្រធាន!',
      },
      {
        castRegistry: [{ speakerId: 'Lin Wan', gender: 'female' }],
      }
    ),
    'FEMALE'
  );

  // 4. Priority 3: 1st-person self-pronouns win over 2nd-person addressed titles ("ព្រះអង្គ!", "លោកប្រធាន!")
  assert.equal(
    detectSpeakerGender('Speaker_2', null, 'ព្រះអង្គ! ខ្ញុំម្ចាស់មិនហ៊ានទេ'),
    'FEMALE'
  );
  assert.equal(
    detectSpeakerGender('Speaker_3', null, 'លោកប្រធាន! នាងខ្ញុំសូមអភ័យទោស'),
    'FEMALE'
  );
  assert.equal(
    detectSpeakerGender('Speaker_4', null, 'ម្ចាស់ក្សត្រី! ទូលបង្គំសូមលា'),
    'MALE'
  );

  // 5. syncSegmentsWithSpeakerRegistry respects visualGender into km-KH-SreymomNeural / km-KH-PisethNeural
  const { segments: normalized } = syncSegmentsWithSpeakerRegistry([
    {
      id: 'seg_1',
      speaker: 'តួឯកស្រី',
      visualGender: 'female',
      khmerText: 'ព្រះអង្គ!',
    },
    {
      id: 'seg_2',
      speaker: 'តួឯកប្រុស',
      visualGender: 'male',
      khmerText: 'នាងតូច!',
    },
  ]);

  assert.equal(normalized[0].voiceGender, 'female');
  assert.equal(normalized[0].voiceId, 'km-KH-SreymomNeural');
  assert.equal(normalized[1].voiceGender, 'male');
  assert.equal(normalized[1].voiceId, 'km-KH-PisethNeural');
});

test('Step 4: MediaLibrary top tabs prevent truncation and DubbingModeTab renders 1-Click Smart Prompt Chips + Fast OCR summary pill', () => {
  const mediaLibraryJsx = fs.readFileSync(
    path.join(__dirname, '..', '..', 'frontend', 'src', 'components', 'media', 'MediaLibrary.jsx'),
    'utf8'
  );
  const mediaLibraryCss = fs.readFileSync(
    path.join(__dirname, '..', '..', 'frontend', 'src', 'components', 'media', 'MediaLibrary.css'),
    'utf8'
  );
  const dubbingModeTabJsx = fs.readFileSync(
    path.join(__dirname, '..', '..', 'frontend', 'src', 'components', 'media', 'DubbingModeTab.jsx'),
    'utf8'
  );

  // 1. MediaLibrary top tabs anti-truncation CSS & concise Khmer labels
  assert.match(mediaLibraryCss, /\.media-tab-btn\s*\{[\s\S]*?font-size:\s*11\.5px;[\s\S]*?padding:\s*0 6px;/);
  assert.match(mediaLibraryJsx, /<span>1\. វីដេអូ<\/span>/);
  assert.match(mediaLibraryJsx, /<span>2\. សំឡេង AI<\/span>/);
  assert.match(mediaLibraryJsx, /<span>3\. អត្ថបទ<\/span>/);

  // 2. DubbingModeTab 1-Click Smart Prompt Chips & Fast OCR summary pill
  assert.match(dubbingModeTabJsx, /OCR \+ Visual Speaker Gender \+ Direct Translate/);
  assert.match(dubbingModeTabJsx, /🎭 ស្គាល់ភេទតាមមុខតួអង្គ \(Auto Face Gender\)/);
  assert.match(dubbingModeTabJsx, /👑 រាជស័ព្ទបុរាណចិន \(Royal\/Xianxia\)/);
  assert.match(dubbingModeTabJsx, /💼 សន្ទនាអគ្គនាយក \(Modern CEO\)/);
  assert.match(dubbingModeTabJsx, /⚡ ឃ្លាខ្លីត្រូវមាត់ 100% \(Strict Lip-Sync\)/);
});

test('Step 5: Batch Generate Studio (GeminiRouteModal) renders full 4-group Batch Script Setup panel and wires parameters into startGenerationJob', () => {
  const geminiModalJsx = fs.readFileSync(
    path.join(__dirname, '..', '..', 'frontend', 'src', 'components', 'dashboard', 'GeminiRouteModal.jsx'),
    'utf8'
  );

  // 1. Collapsible Batch Script Setup section & 4 configuration groups
  assert.match(geminiModalJsx, /កំណត់ទម្រង់បង្កើត Script \(Batch Script Setup\)/);
  assert.match(geminiModalJsx, /data-testid="batch-setup-group-pipeline"/);
  assert.match(geminiModalJsx, /data-testid="batch-setup-group-dubbing-mode"/);
  assert.match(geminiModalJsx, /data-testid="batch-setup-group-genre"/);
  assert.match(geminiModalJsx, /data-testid="batch-setup-group-direction"/);

  // 2. Group 1, 2, 3, 4 content & badges
  assert.match(geminiModalJsx, /OCR \+ Visual Speaker Gender \+ Direct Translate/);
  assert.match(geminiModalJsx, /📄 Import \.srt \/ \.json/);
  assert.match(geminiModalJsx, /Mode A: សន្ទនាតួអង្គ/);
  assert.match(geminiModalJsx, /Mode B: សម្រាយរឿង/);
  assert.match(geminiModalJsx, /🎭 កំប្លែង \/ គ្រួសារ/);
  assert.match(geminiModalJsx, /បកប្រែឃ្លាខ្លីណែន ត្រូវចังหวាក់មាត់ 100% \(<= 5\.5 ព្យាង្គ\/វិនាទី ដោយអត្ថន័យពេញ\)/);

  // 3. State & Pipeline Wiring to startGenerationJob
  assert.match(geminiModalJsx, /generationMode:\s*pipelineMode/);
  assert.match(geminiModalJsx, /customPrompt:\s*customDirection/);
  assert.match(geminiModalJsx, /genre:\s*dramaGenre/);
});

test('Step 6: Impeccable / Unslop UI cleanup in GeminiRouteModal removes duplicate cascade/footer trackers and renders 3 slim step rows + 1 primary CTA + quiet secondary row', () => {
  const geminiModalJsx = fs.readFileSync(
    path.join(__dirname, '..', '..', 'frontend', 'src', 'components', 'dashboard', 'GeminiRouteModal.jsx'),
    'utf8'
  );

  // 1. Header has no duplicate Auto Cascade pill
  assert.equal(geminiModalJsx.includes('data-testid="header-model-cascade-pill"'), false);

  // 2. Truncated 1-line Direction preview with more / បង្រួម toggle
  assert.match(geminiModalJsx, /data-testid="batch-direction-more-toggle"/);
  assert.match(geminiModalJsx, /isDirectionExpanded\s*\?\s*'បង្រួម ▴'\s*:\s*'more ▾'/);

  // 3. 3 Slim Step Status Rows & duplicate footer tracker removed
  assert.match(geminiModalJsx, /data-testid="batch-step-status-rows"/);
  assert.match(geminiModalJsx, /1\. Translate \(បកប្រែ Script ខ្មែរ\)/);
  assert.match(geminiModalJsx, /2\. សំឡេងខ្មែរ AI \(Khmer AI Voice\)/);
  assert.match(geminiModalJsx, /3\. បំបែកសំឡេងដើម AI \(Demucs Clean BGM\)/);
  assert.equal(geminiModalJsx.includes('data-testid="modal-footer-status"'), false);

  // 4. 1 Primary Contextual CTA + Quiet Secondary Row
  assert.match(geminiModalJsx, /data-testid="btn-batch-primary-cta"/);
  assert.match(geminiModalJsx, /data-testid="batch-quiet-secondary-actions"/);
  assert.match(geminiModalJsx, /🎧 បន្ត Demucs AI \(នៅសល់ \$\{targetDemucsLeft\} ភាគ\)/);
});

test('Step 7: Direct URL Route System (/home, /studio, /batch, /quota, /export, /jobs) and HomeDashboard.jsx are wired and persistent across refresh', () => {
  const rootDir = path.join(__dirname, '..', '..', 'frontend', 'src');
  const modalContextJsx = fs.readFileSync(path.join(rootDir, 'context', 'ModalContext.jsx'), 'utf8');
  const homeDashboardJsx = fs.readFileSync(path.join(rootDir, 'components', 'layout', 'HomeDashboard.jsx'), 'utf8');
  const navbarJsx = fs.readFileSync(path.join(rootDir, 'components', 'layout', 'Navbar.jsx'), 'utf8');
  const appJsx = fs.readFileSync(path.join(rootDir, 'App.jsx'), 'utf8');

  assert.match(modalContextJsx, /export function normalizeStudioRoute/);
  assert.match(modalContextJsx, /window\.history\.pushState/);
  assert.match(modalContextJsx, /window\.addEventListener\('popstate'/);
  assert.match(homeDashboardJsx, /data-testid="home-dashboard-view"/);
  assert.match(homeDashboardJsx, /data-testid="home-route-directory"/);
  assert.match(homeDashboardJsx, /data-testid="btn-home-open-studio"/);
  assert.match(navbarJsx, /data-testid="navbar-home-route-btn"/);
  assert.match(navbarJsx, /data-testid="navbar-studio-route-btn"/);
  assert.match(appJsx, /<HomeDashboard/);
});
