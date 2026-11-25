const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  stripDecorativeSubtitleNoise,
  stripRepeatedLeadingTimeCardPrefix,
  deduplicateFastOcrCues,
  buildVisionBatchContents,
} = require('../services/pipeline/stages/stage3_extractChineseSubtitles');
const {
  isPlaceholderTranslationText,
  computeKhmerSlotBudget,
} = require('../services/pipeline/stages/stage6PromptAndConsistency');
const { generateModeSpecificScript } = require('../services/pipeline/stages/stage6_generateModeSpecificScript');
const { translateAndValidateKhmer } = require('../services/pipeline/stages/stage7_translateAndValidateKhmer');
const {
  findOverflowShortenCandidates,
  autoShortenOverflowingSegments,
} = require('../services/pipeline/stages/stage9_generateSegmentTTS');
const {
  isSegmentTextBroken,
  containsChineseHanzi,
} = require('../utils/translationQuality');
const { buildSegmentMixFilterChain } = require('../services/ffmpegService');
const { resolvePythonBinary } = require('../services/audioSeparationService');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

describe('Subtitle Sync, Anti-Hanzi-Leak, Auto-Shorten & Zero-Overlap Fixes (ep_1 #27-#30)', () => {
  it('Fix 1A: Python local_chinese_ocr_worker filters out side time-cards & vertical banners when centered dialogue exists', () => {
    const pyBin = resolvePythonBinary();
    const workerDir = path.join(REPO_ROOT, 'backend', 'workers').replace(/\\/g, '/');
    const pyScript = `
import sys, json
sys.path.insert(0, "${workerDir}")
import local_chinese_ocr_worker as w

# Simulated 1536x280 ROI matching ep_1 59.6s (bottom-left yellow '几个月前', bottom-center '再快一点', right vertical '灵虚圣地主峰讲坛')
roi_w, roi_h = 1536, 280
ocr_mixed = [
    ([[10, 30], [220, 30], [220, 80], [10, 80]], "几个月前", 0.96),
    ([[640, 175], [896, 175], [896, 225], [640, 225]], "再快一点", 0.98),
    ([[1320, 10], [1370, 10], [1370, 250], [1320, 250]], "灵虚圣地主峰讲坛", 0.92),
]
res_mixed = [it["text"] for it in w.filter_dialogue_ocr_results(ocr_mixed, roi_w, roi_h)]

# Legitimate centered 2-line dialogue must preserve both lines
ocr_two_line = [
    ([[520, 120], [1016, 120], [1016, 165], [520, 165]], "李天维首座", 0.95),
    ([[540, 175], [996, 175], [996, 220], [540, 220]], "正在讲道呢", 0.96),
]
res_two_line = [it["text"] for it in w.filter_dialogue_ocr_results(ocr_two_line, roi_w, roi_h)]

# Single box result must always be preserved
ocr_single = [([[40, 120], [240, 120], [240, 170], [40, 170]], "几个月前", 0.95)]
res_single = [it["text"] for it in w.filter_dialogue_ocr_results(ocr_single, roi_w, roi_h)]

print(json.dumps({"mixed": res_mixed, "two_line": res_two_line, "single": res_single}, ensure_ascii=False))
`;
    const run = spawnSync(pyBin, ['-c', pyScript], { encoding: 'utf8', windowsHide: true });
    assert.equal(run.status, 0, `Python worker test failed: ${run.stderr}`);
    const parsed = JSON.parse(run.stdout.trim());
    assert.deepEqual(parsed.mixed, ['再快一点'], 'Side time-card and right vertical banner must be dropped when centered dialogue exists');
    assert.deepEqual(parsed.two_line, ['李天维首座', '正在讲道呢'], 'Legitimate centered 2-line subtitle must stay intact');
    assert.deepEqual(parsed.single, ['几个月前'], 'Single standalone box must remain preserved');
  });

  it('Fix 1B: Stage 3 strips newline-joined & consecutive repeated leading time-card prefixes without touching normal speech', () => {
    assert.equal(stripDecorativeSubtitleNoise('几个月前\n再快一点'), '再快一点');
    assert.equal(stripDecorativeSubtitleNoise('几个月前\n李天维首座正在讲道呢'), '李天维首座正在讲道呢');

    const ep1LikeCues = [
      { id: 26, startSec: 57.6, endSec: 59.6, originalChineseText: '早就把你干掉', chineseText: '早就把你干掉' },
      { id: 27, startSec: 59.6, endSec: 60.2, originalChineseText: '几个月前再快一点', chineseText: '几个月前再快一点' },
      { id: 28, startSec: 60.2, endSec: 61.6, originalChineseText: '几个月前李天维首座正在讲道呢', chineseText: '几个月前李天维首座正在讲道呢' },
      { id: 29, startSec: 61.6, endSec: 62.8, originalChineseText: '再晚就没座位了', chineseText: '再晚就没座位了' },
      // Isolated single-cue real dialogue starting with 一年前 must NOT be stripped
      { id: 40, startSec: 90.0, endSec: 92.0, originalChineseText: '一年前我曾见过他', chineseText: '一年前我曾见过他' },
    ];

    const cleaned = stripRepeatedLeadingTimeCardPrefix(ep1LikeCues);
    assert.equal(cleaned[0].chineseText, '早就把你干掉');
    assert.equal(cleaned[1].chineseText, '再快一点', '#27 must drop glued 几个月前');
    assert.equal(cleaned[2].chineseText, '李天维首座正在讲道呢', '#28 must drop glued 几个月前');
    assert.equal(cleaned[3].chineseText, '再晚就没座位了');
    assert.equal(cleaned[4].chineseText, '一年前我曾见过他', 'Single-cue real spoken dialogue must NEVER be stripped');

    // deduplicateFastOcrCues must also apply the cleanup automatically
    const deduped = deduplicateFastOcrCues(ep1LikeCues);
    assert.equal(deduped[1].chineseText, '再快一点');
    assert.equal(deduped[2].chineseText, '李天维首座正在讲道呢');

    // Vision prompt contains STRICT DIALOGUE-ONLY ISOLATION
    const runnerSrc = fs.readFileSync(
      path.join(REPO_ROOT, 'backend/services/pipeline/stages/stage3VisionBatchRunner.js'),
      'utf8'
    );
    assert.ok(runnerSrc.includes('STRICT DIALOGUE-ONLY ISOLATION'), 'Vision OCR prompt must enforce dialogue-only isolation');
  });

  it('Fix 2: Backend & Frontend quality guards detect Chinese Hanzi leaks and Stage 6 auto-retries them to 100% Khmer', async () => {
    // Backend translationQuality.js
    assert.equal(containsChineseHanzi('几个月前再快一点'), true);
    assert.equal(isSegmentTextBroken({ khmerText: '几个月前再快一点' }), true);
    assert.equal(isSegmentTextBroken({ khmerText: 'ថាមពល合体អីហự?' }), true);
    assert.equal(isSegmentTextBroken({ khmerText: 'អរគុណលោក首座' }), true);
    assert.equal(isSegmentTextBroken({ khmerText: 'លឿនឡើង!' }), false);

    // Frontend mirror translationQuality.js
    const frontendTq = await import('../../frontend/src/utils/translationQuality.js');
    assert.equal(frontendTq.isSegmentTextBroken({ khmerText: '几个月前再快一点' }), true);
    assert.equal(frontendTq.isSegmentTextBroken({ khmerText: 'ពួកបក្ស灵虚圣地' }), true);
    assert.equal(frontendTq.isSegmentTextBroken({ khmerText: 'លឿនឡើង!' }), false);

    // Stage 6 placeholder check rejects Chinese Hanzi
    assert.equal(isPlaceholderTranslationText('几个月前再快一点'), true);
    assert.equal(isPlaceholderTranslationText('អរគុណលោក首座'), true);
    assert.equal(isPlaceholderTranslationText('លឿនឡើង!'), false);

    // Stage 6 runtime: first batch returns Chinese leak on #1 -> auto-retry rescues it to clean Khmer
    let callCount = 0;
    const mockAiClient = {
      models: {
        generateContent: async ({ contents }) => {
          callCount++;
          if (callCount === 1) {
            return {
              text: JSON.stringify({
                summary: 'test',
                detectedGenre: 'ancient',
                castRegistry: [],
                segments: [
                  { index: 1, segmentId: 27, speaker: 'សិស្សប្អូន', gender: 'male', khmerText: '几个月前再快一点' },
                  { index: 2, segmentId: 28, speaker: 'សិស្សប្អូន', gender: 'male', khmerText: 'លោកគ្រូលីកំពុងបង្រៀនធម៌' },
                ],
              }),
            };
          }
          return {
            text: JSON.stringify({
              segments: [
                { index: 1, segmentId: 1, speaker: 'សិស្សប្អូន', gender: 'male', khmerText: 'លឿនឡើង!' },
              ],
            }),
          };
        },
      },
    };

    const res = await generateModeSpecificScript({
      mode: 'dialogue',
      reconciledSegments: [
        { id: 27, segmentId: 27, startSec: 59.6, endSec: 60.2, duration: 0.6, originalChineseText: '再快一点' },
        { id: 28, segmentId: 28, startSec: 60.2, endSec: 61.6, duration: 1.4, originalChineseText: '李天维首座正在讲道呢' },
      ],
      durationSec: 65,
      aiClient: mockAiClient,
      genre: 'ancient',
      useCache: false,
    });

    assert.ok(callCount >= 2, `Expected auto-retry after Hanzi leak (calls=${callCount})`);
    assert.equal(res.scriptSegments[0].khmerText, 'លឿនឡើង!', 'Leaked Chinese line must be rescued to pure Khmer');
    assert.equal(containsChineseHanzi(res.scriptSegments[0].khmerText), false);

    // Stage 7 validation: clears pure-Chinese untranslated text and flags mixed Hanzi leaks
    const s7 = await translateAndValidateKhmer({
      scriptSegments: [
        { id: 27, originalChineseText: '再快一点', khmerTranslatedText: '几个月前再快一点' },
        { id: 49, originalChineseText: '多谢李首座', khmerTranslatedText: 'អរគុណលោក首座' },
        { id: 30, originalChineseText: '首座首座', khmerTranslatedText: 'លោកគ្រូៗ' },
      ],
    });
    assert.equal(s7.validatedSegments[0].khmerText, '', 'Pure Chinese untranslated line must be cleared before TTS');
    assert.equal(s7.validatedSegments[0].translationStatus, 'review_needed');
    assert.equal(s7.validatedSegments[1].translationStatus, 'review_needed', 'Mixed Hanzi leak must be flagged review_needed');
    assert.equal(s7.validatedSegments[1].reviewNeeded, true);
    assert.equal(s7.validatedSegments[2].translationStatus, 'translated');
  });

  it('Fix 3: Slot character budget (maxKhmerChars) & Post-TTS Auto-Shorten condense only overflowing clips safely', async () => {
    const bShort = computeKhmerSlotBudget(0.6);
    assert.equal(bShort.maxKhmerWords, 2);
    assert.equal(bShort.maxKhmerChars, 10);

    const bMed = computeKhmerSlotBudget(1.2);
    assert.equal(bMed.maxKhmerWords, 3);
    assert.equal(bMed.maxKhmerChars, 19);

    const testSegs = [
      {
        id: 27, startSec: 59.6, endSec: 60.2, duration: 0.6, slotDuration: 0.6,
        originalChineseText: '再快一点', khmerText: '几个月前再快一点', khmerTranslatedText: '几个月前再快一点',
        finalAudioDuration: 2.15, overflowSec: 1.55, ttsStatus: 'ready', audioPath: '/tmp/27.mp3',
      },
      {
        id: 28, startSec: 60.2, endSec: 61.6, duration: 1.4, slotDuration: 1.4,
        originalChineseText: '李天维首座正在讲道呢',
        khmerText: 'ប៉ុន្មានខែមុនលោកគ្រូ លី ធានវៃ កំពុងបង្រៀនធម៌',
        khmerTranslatedText: 'ប៉ុន្មានខែមុនលោកគ្រូ លី ធានវៃ កំពុងបង្រៀនធម៌',
        finalAudioDuration: 1.97, overflowSec: 0.57, ttsStatus: 'ready', audioPath: '/tmp/28.mp3',
      },
      {
        id: 29, startSec: 61.6, endSec: 62.8, duration: 1.2, slotDuration: 1.2,
        originalChineseText: '再晚就没座位了', khmerText: 'យឺតជាងនេះគ្មានកន្លែងអង្គុយទេ', khmerTranslatedText: 'យឺតជាងនេះគ្មានកន្លែងអង្គុយទេ',
        finalAudioDuration: 1.33, overflowSec: 0.13, ttsStatus: 'ready', audioPath: '/tmp/29.mp3',
        userOverridden: true, // manual edit must NEVER be touched
      },
      {
        id: 30, startSec: 62.8, endSec: 64.0, duration: 1.2, slotDuration: 1.2,
        originalChineseText: '首座首座', khmerText: 'លោកគ្រូៗ', khmerTranslatedText: 'លោកគ្រូៗ',
        finalAudioDuration: 0.64, overflowSec: 0, ttsStatus: 'ready', audioPath: '/tmp/30.mp3',
      },
    ];

    const cands = findOverflowShortenCandidates(testSegs, { maxOverflowThresholdSec: 0.15 });
    assert.deepEqual(cands.map((c) => c.seg.id), [27, 28], 'Only overflowing/Hanzi non-overridden clips #27 and #28 should be selected');

    const reSynthIds = [];
    const mockAi = {
      models: {
        generateContent: async () => ({
          text: JSON.stringify({
            segments: [
              { index: 1, segmentId: 27, khmerText: 'លឿនឡើង!' },
              { index: 2, segmentId: 28, khmerText: 'គ្រូលីកំពុងបង្រៀនធម៌' },
            ],
          }),
        }),
      },
    };
    const mockSynth = async (seg) => {
      reSynthIds.push(seg.id);
      const dur = seg.id === 27 ? 0.52 : 1.28;
      return {
        ...seg,
        audioDurationSec: dur,
        finalAudioDuration: dur,
        overflowSec: 0,
        ttsStatus: 'ready',
      };
    };

    const shortenRes = await autoShortenOverflowingSegments({
      segments: testSegs,
      audioDir: '/tmp',
      aiClient: mockAi,
      generateSingleFn: mockSynth,
    });

    assert.equal(shortenRes.shortenedCount, 2);
    assert.deepEqual(reSynthIds, [27, 28]);
    assert.equal(shortenRes.segments[0].khmerText, 'លឿនឡើង!');
    assert.equal(shortenRes.segments[0].overflowSec, 0);
    assert.equal(shortenRes.segments[1].khmerText, 'គ្រូលីកំពុងបង្រៀនធម៌');
    assert.equal(shortenRes.segments[1].overflowSec, 0);
    assert.equal(shortenRes.segments[1].autoShortenedFrom, 'ប៉ុន្មានខែមុនលោកគ្រូ លី ធានវៃ កំពុងបង្រៀនធម៌');
    assert.equal(shortenRes.segments[2].khmerText, 'យឺតជាងនេះគ្មានកន្លែងអង្គុយទេ', 'User-overridden segment must remain untouched');
  });

  it('Fix 4: Smooth Automatic Crossfade Mixer applies adaptive half-sine afade without speed-up or abrupt step ducking', () => {
    // 1. No overlap -> plain adelay
    const plain = buildSegmentMixFilterChain({ startSec: 62.8, durSec: 0.64 }, null, 62800);
    assert.equal(plain, 'adelay=62800|62800');

    // 2. Mild same-lane overlap (#29: 1.33s in 1.20s slot -> 0.13s overlap) -> smooth afade=t=out:curve=hsin, NO atempo, NO abrupt 0.40 step
    const mild = buildSegmentMixFilterChain(
      { startSec: 61.6, durSec: 1.33, trackRow: 0 },
      { startSec: 62.8, durSec: 0.64, trackRow: 0 },
      61600
    );
    assert.doesNotMatch(mild, /atempo=/, 'Crossfade must NOT speed up dialogue via atempo');
    assert.doesNotMatch(mild, /atrim=/, 'Crossfade must NOT truncate untrimmed clips via atrim');
    assert.match(mild, /afade=t=out:st=1\.200:d=0\.130:curve=hsin/, 'Must apply smooth 0.13s half-sine fade-out within overlap boundary');
    assert.doesNotMatch(mild, /0\.40/, 'Must NOT use abrupt 40% volume step');

    // 3. Large same-lane overlap (#27: 2.15s in 0.60s slot -> 1.55s overlap) -> short adaptive fade capped at 0.35s, NO atempo
    const extreme = buildSegmentMixFilterChain(
      { startSec: 59.6, durSec: 2.15, trackRow: 0 },
      { startSec: 60.2, durSec: 1.40, trackRow: 0 },
      59600
    );
    assert.doesNotMatch(extreme, /atempo=/, 'Must preserve original speed and pitch');
    assert.match(extreme, /afade=t=out:st=0\.600:d=0\.350:curve=hsin/, 'Must cap fade duration adaptively to preserve intelligibility');

    // 4. Multi-lane overlap -> smooth half-sine crossfade (no abrupt 0.40 volume jump)
    const multiLane = buildSegmentMixFilterChain(
      { startSec: 10.0, durSec: 3.0, trackRow: 0 },
      { startSec: 11.5, durSec: 2.0, trackRow: 1, userShifted: true },
      10000
    );
    assert.match(multiLane, /afade=t=out:st=1\.500:d=0\.350:curve=hsin/);
    assert.doesNotMatch(multiLane, /0\.40/);

    // 5. Static audit of live preview crossfade & timeline collision sub-lane visibility
    const playerSyncSrc = fs.readFileSync(path.join(REPO_ROOT, 'frontend/src/components/player/usePlayerAudioSync.js'), 'utf8');
    assert.ok(playerSyncSrc.includes('computeOverlapCrossfadePlan'), 'Live preview must compute smooth overlap crossfade plan');
    assert.ok(playerSyncSrc.includes('evalSegmentCrossfadeGainAtTime'), 'Live preview must evaluate smooth crossfade gain envelope');
    const editorSrc = fs.readFileSync(path.join(REPO_ROOT, 'frontend/src/components/timeline/TimelineEditor.jsx'), 'utf8');
    assert.ok(editorSrc.includes('let targetLane = 0;') && editorSrc.includes('rawStart < rowEndTimes[targetLane] - 0.08'), 'TimelineEditor must auto-stagger colliding overflow clips onto free lane');
    const canvasSrc = fs.readFileSync(path.join(REPO_ROOT, 'frontend/src/components/timeline/TimelineTracksCanvas.jsx'), 'utf8');
    assert.ok(canvasSrc.includes('let targetLane = 0;') && canvasSrc.includes('rawStart < endTimes[targetLane] - 0.08'), 'TimelineTracksCanvas must auto-stagger colliding overflow clips onto free lane');
  });

  it('Fix 5: Timeline thumbnails upgrade from 4s/frame (0.25fps) to 1s/frame (1fps <=10min, 0.5fps >10min) with thumb1s_ cache key', () => {
    const probeSrc = fs.readFileSync(
      path.join(REPO_ROOT, 'backend/services/ffmpeg/ffmpegProbeAndFrames.js'),
      'utf8'
    );
    assert.ok(probeSrc.includes("const thumbPrefix = 'thumb1s_';"), 'Must use versioned thumb1s_ prefix to upgrade stale coarse caches');
    assert.ok(probeSrc.includes("const fps = totalDur > 600 ? '0.5' : '1';"), 'Must sample 1fps for <=10min episodes and 0.5fps for longer videos');
  });
});
