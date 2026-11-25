const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const { resolvePythonBinary } = require('../audioSeparationService');
const { extractFramesAtTimestamps } = require('../ffmpegService');
const { createSmartGenAIClient } = require('../geminiKeyManager');
const {
  resolveValidModelName,
  generateContentWithModelFallback,
  safeParseOrRepairJson,
  DEFAULT_MODELS,
} = require('../geminiService');
const { createAbortError } = require('../../utils/asyncSemaphore');
const {
  detectSpeakerGender,
  normalizeSpeakerName,
  getSpeakerId,
  getDefaultVoiceForGender,
  isGenericSpeakerName,
  isEpisodicRoleSpeakerName,
} = require('../../models/speakerRegistry');
const { enrichCuesWithAcousticPitch } = require('./stages/stage4_analyzeDialogueAudio');

const SYSTEM_CUE_PATTERN =
  /^(?:恭喜(?:龙国)?(?:玩家|宿主)|检测(?:宿主|异常|完毕)|获得(?:SSS?|SS|[ABCDE])?级?天赋|免疫.*伤害|冷却时间\d+|通关奖励结算|国运规则怪谈.*现在开始|规则[一二三四五六七八九十百\d]+(?:$|[：:，,\s]))/;

function isDeterministicSystemCue(text = '') {
  const clean = String(text || '').trim();
  if (!clean) return false;
  return SYSTEM_CUE_PATTERN.test(clean);
}

function normalizeCharacterAliasKey(name = '') {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[\s\u200b\u200c\u200d._-]+/g, '');
}

function normalizeGenderToken(raw) {
  const val = String(raw || '').trim().toUpperCase();
  if (val === 'FEMALE' || val === 'F' || val === 'GIRL' || val === 'WOMAN' || val === 'ស្រី') return 'FEMALE';
  if (val === 'MALE' || val === 'M' || val === 'BOY' || val === 'MAN' || val === 'ប្រុស') return 'MALE';
  return 'UNKNOWN';
}

function voiceForGender(gender) {
  return gender === 'FEMALE' ? 'km-KH-SreymomNeural' : 'km-KH-PisethNeural';
}

function spawnAsync(bin, args, { timeoutMs = 45000, signal = null } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(createAbortError('Process aborted'));
    let settled = false;
    let stdout = '';
    let stderr = '';
    const child = spawn(bin, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = timeoutMs > 0
      ? setTimeout(() => {
          if (!settled) {
            settled = true;
            try { child.kill('SIGKILL'); } catch (_) {}
            reject(new Error(`Process timed out after ${timeoutMs}ms`));
          }
        }, timeoutMs)
      : null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      if (!settled) {
        settled = true;
        cleanup();
        try { child.kill('SIGKILL'); } catch (_) {}
        reject(createAbortError('Process aborted by signal'));
      }
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    child.stdout?.on('data', (d) => { stdout += d.toString(); });
    child.stderr?.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(err);
      }
    });
    child.on('close', (code) => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve({ code, stdout, stderr });
      }
    });
  });
}

async function runCueVisualProbe({ videoPath, cues, workDir, startOffsetSec = 0, signal = null }) {
  const result = new Map();
  if (!videoPath || !fs.existsSync(videoPath) || !Array.isArray(cues) || cues.length === 0) {
    return result;
  }
  const workerPath = path.resolve(__dirname, '../../workers/cue_visual_probe.py');
  if (!fs.existsSync(workerPath)) {
    return result;
  }

  const pyBin = resolvePythonBinary();
  const cuesJson = path.join(workDir, 'probe_cues.json');
  const thumbsDir = path.join(workDir, 'thumbs');
  const probeOut = path.join(workDir, 'probe_out.json');
  fs.mkdirSync(thumbsDir, { recursive: true });

  try {
    const midTimes = cues.map((c) => {
      const startSec = Number(c.startSec ?? c.sourceStartSec ?? 0);
      const endSec = Number(c.endSec ?? c.sourceEndSec ?? (startSec + 1.5));
      const absMid = Math.max(0.05, (startSec + endSec) / 2);
      return parseFloat(absMid.toFixed(2));
    });

    // Extract frames rapidly with native FFmpeg single-pass/parallel seek helper
    const extracted = await extractFramesAtTimestamps(videoPath, midTimes, thumbsDir, { signal });
    const frameByTime = new Map();
    for (const item of extracted || []) {
      if (item && item.filePath && Number.isFinite(item.timestampSec)) {
        frameByTime.set(Number(item.timestampSec).toFixed(2), item.filePath);
      }
    }
    const findNearestThumb = (t) => {
      const exact = frameByTime.get(Number(t).toFixed(2));
      if (exact) return exact;
      let bestPath = null;
      let bestDiff = 0.6;
      for (const [k, fp] of frameByTime.entries()) {
        const diff = Math.abs(Number(k) - t);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestPath = fp;
        }
      }
      return bestPath;
    };

    const imageInput = cues.map((c, idx) => ({
      sourceCueId: c.sourceCueId || c.id || `cue_${idx + 1}`,
      id: c.id ?? idx + 1,
      midSec: midTimes[idx],
      thumbPath: findNearestThumb(midTimes[idx]),
    }));
    fs.writeFileSync(cuesJson, JSON.stringify(imageInput), 'utf8');

    const proc = await spawnAsync(
      pyBin,
      [workerPath, '--mode', 'images', '--cues', cuesJson, '--output', probeOut],
      { timeoutMs: 45000, signal }
    );
    if (proc.code === 0 && fs.existsSync(probeOut)) {
      const parsed = JSON.parse(fs.readFileSync(probeOut, 'utf8'));
      for (const item of parsed?.cues || []) {
        if (item?.sourceCueId) {
          result.set(String(item.sourceCueId), item);
        }
      }
    }
  } catch (err) {
    if (err?.name === 'AbortError' || signal?.aborted) throw err;
    console.warn(`[SpeakerID] Visual probe skipped gracefully: ${err.message}`);
  }
  return result;
}

async function buildBatchMontageAndAudio({
  batchItems,
  mediaSourcePath,
  workDir,
  batchIndex,
  startOffsetSec = 0,
  signal = null,
}) {
  const batchDir = path.join(workDir, `batch_${batchIndex}`);
  fs.mkdirSync(batchDir, { recursive: true });
  const montageJson = path.join(batchDir, 'montage_items.json');
  const montageOut = path.join(batchDir, 'frames_grid.jpg');
  const audioOut = path.join(batchDir, 'scene_audio.mp3');

  const minStart = Math.max(0, Math.min(...batchItems.map((it) => Number(it.cue.startSec || 0))) - 0.5);
  const maxEnd = Math.max(minStart + 1.0, Math.max(...batchItems.map((it) => Number(it.cue.endSec || it.cue.startSec + 1.5))) + 0.5);
  const sliceDur = Math.max(1.0, Math.min(95.0, maxEnd - minStart));
  const localSeek = startOffsetSec > 0 && mediaSourcePath && String(mediaSourcePath).includes('chunk_')
    ? Math.max(0, minStart - startOffsetSec)
    : minStart;

  const montagePayload = batchItems.map((it, slotIdx) => {
    const relStart = Math.max(0, Number(it.cue.startSec || 0) - minStart);
    const relEnd = Math.max(relStart, Number(it.cue.endSec || relStart + 1) - minStart);
    return {
      thumbPath: it.visual?.thumbPath || null,
      label: `#${slotIdx + 1} ${relStart.toFixed(1)}-${relEnd.toFixed(1)}s`,
    };
  });
  fs.writeFileSync(montageJson, JSON.stringify(montagePayload), 'utf8');

  const workerPath = path.resolve(__dirname, '../../workers/cue_visual_probe.py');
  let hasMontage = false;
  if (fs.existsSync(workerPath) && batchItems.some((it) => it.visual?.thumbPath && fs.existsSync(it.visual.thumbPath))) {
    try {
      const pyBin = resolvePythonBinary();
      const proc = await spawnAsync(
        pyBin,
        [workerPath, '--mode', 'montage', '--cues', montageJson, '--output', montageOut, '--cols', '3'],
        { timeoutMs: 25000, signal }
      );
      hasMontage = proc.code === 0 && fs.existsSync(montageOut) && fs.statSync(montageOut).size > 200;
    } catch (err) {
      if (err?.name === 'AbortError' || signal?.aborted) throw err;
    }
  }

  let hasAudio = false;
  if (mediaSourcePath && fs.existsSync(mediaSourcePath)) {
    try {
      const ffmpegBin = ffmpegInstaller.path;
      const proc = await spawnAsync(
        ffmpegBin,
        [
          '-y',
          '-ss', localSeek.toFixed(2),
          '-t', sliceDur.toFixed(2),
          '-i', mediaSourcePath,
          '-vn',
          '-ac', '1',
          '-ar', '16000',
          '-c:a', 'libmp3lame',
          '-b:a', '24k',
          audioOut,
        ],
        { timeoutMs: 30000, signal }
      );
      hasAudio = proc.code === 0 && fs.existsSync(audioOut) && fs.statSync(audioOut).size > 300;
    } catch (err) {
      if (err?.name === 'AbortError' || signal?.aborted) throw err;
    }
  }

  return {
    montagePath: hasMontage ? montageOut : null,
    audioPath: hasAudio ? audioOut : null,
    sliceStartSec: minStart,
    sliceDurSec: sliceDur,
  };
}

function buildKnownCastIndex(seriesSpeakerMap = {}, castRegistry = []) {
  const index = new Map();
  const addEntry = (entry) => {
    if (!entry || typeof entry !== 'object') return;
    const rawName = String(entry.speakerName || entry.name || entry.khmerName || '').trim();
    if (!rawName || isGenericSpeakerName(rawName) || isEpisodicRoleSpeakerName(rawName)) return;
    const gender = normalizeGenderToken(entry.speakerGender || entry.voiceGender || entry.gender);
    if (gender === 'UNKNOWN') return;
    const canonical = {
      speakerId: entry.speakerId || entry.id || getSpeakerId(rawName),
      name: normalizeSpeakerName(rawName, gender.toLowerCase()),
      gender,
      voiceId: entry.voiceId || entry.khmerVoiceId || voiceForGender(gender),
      source: entry.voiceAssignmentSource || 'series_glossary',
      userOverridden: Boolean(entry.userOverridden),
      aliases: Array.from(new Set([rawName, entry.khmerName, entry.chineseAlias, ...(entry.aliases || [])].filter(Boolean))),
    };
    for (const alias of canonical.aliases) {
      const key = normalizeCharacterAliasKey(alias);
      if (key && !index.has(key)) {
        index.set(key, canonical);
      }
    }
  };

  Object.values(seriesSpeakerMap || {}).forEach(addEntry);
  if (Array.isArray(castRegistry)) {
    castRegistry.forEach((c) => {
      if (c && c.name && c.gender) addEntry(c);
    });
  }
  return index;
}

function findCastMatch(index, candidateNames = []) {
  for (const cand of candidateNames) {
    const key = normalizeCharacterAliasKey(cand);
    if (key && index.has(key)) return index.get(key);
  }
  return null;
}

function buildVerificationPrompt({ batchItems, sliceStartSec, contextBefore, contextAfter, knownCastList }) {
  const castLines = knownCastList.length > 0
    ? knownCastList
        .slice(0, 24)
        .map((c) => `- "${c.name}" (speakerId=${c.speakerId}, gender=${c.gender}, aliases=${c.aliases.slice(0, 4).join('/')})`)
        .join('\n')
    : '- (No prior verified cast yet — assign concise, consistent Khmer character names)';

  const beforeText = (contextBefore || [])
    .map((c) => `  [prev ${Number(c.startSec || 0).toFixed(1)}s | speaker="${c.speakerName || '?'}" (${c.speakerGender || 'UNKNOWN'})]: ${c.chineseText}`)
    .join('\n');
  const afterText = (contextAfter || [])
    .map((c) => `  [next ${Number(c.startSec || 0).toFixed(1)}s]: ${c.chineseText}`)
    .join('\n');

  const cueLines = batchItems
    .map((it, slotIdx) => {
      const c = it.cue;
      const relStart = Math.max(0, Number(c.startSec || 0) - sliceStartSec).toFixed(2);
      const relEnd = Math.max(0, Number(c.endSec || c.startSec + 1) - sliceStartSec).toFixed(2);
      const durSec = Math.max(0.2, Number(c.endSec || c.startSec + 1) - Number(c.startSec || 0)).toFixed(2);
      const vis = it.visual;
      return `${slotIdx + 1}. sourceCueId="${c.sourceCueId}" | sceneTime=${relStart}s-${relEnd}s (dur=${durSec}s) | frameCell=#${slotIdx + 1} | faces=${vis ? vis.faceCount : '?'} | shotCut=${vis?.sceneCutFromPrev ? 'YES' : 'no'} | voiceCluster=${c.acousticClusterId || 'none'} | bgmHeavy=${Boolean(c.bgmSuspected)} | zh="${c.chineseText}"`;
    })
    .join('\n');

  return `You are a Multimodal Speaker Verification Specialist for Chinese-to-Khmer drama dubbing.
Analyze BOTH the attached audio clip (scene_audio.mp3 starting at 0.00s) AND the numbered keyframe contact sheet (frames_grid.jpg where cell #N corresponds to cue #N) together with the dialogue lines below.

KNOWN VERIFIED RECURRING CAST (REUSE EXACT KHMER NAME & GENDER ONLY WHEN THIS SAME CHARACTER ACTUALLY SPEAKS):
${castLines}

${beforeText ? `PRECEDING CONTEXT:\n${beforeText}\n` : ''}
CUES TO VERIFY IN THIS SCENE:
${cueLines}
${afterText ? `\nFOLLOWING CONTEXT:\n${afterText}` : ''}

STRICT VERIFICATION RULES:
1. Listen carefully to the ACTUAL human voice at sceneTime in scene_audio.mp3 AND inspect cell #N of frames_grid.jpg together.
2. Distinguish the ACTUAL SPEAKER from silent characters/listeners shown on screen, off-screen speakers, commentators, or UI system announcements.
3. NEVER confuse panicked, crying, screaming, or excited young/adult men with FEMALE. Judge real vocal timbre & chest/throat resonance in scene_audio.mp3 plus character identity — never guess gender from pitch height or emotion alone.
4. Cartoon animals, spirits, or children should match the ACTUAL voice actor timbre heard in scene_audio.mp3 at sceneTime.
5. Reserve "ប្រព័ន្ធ" (System, FEMALE) STRICTLY when the voice ACTUALLY HEARD in scene_audio.mp3 sounds like a calm female/robotic UI prompt ("恭喜...", "规则...", "检测...", "天赋..."). If a world/invasion/player-death broadcast is spoken by a MALE announcer/commentator voice in scene_audio.mp3, label it "អ្នកអត្ថាធិប្បាយ" with "MALE", NEVER force it to "ប្រព័ន្ធ". Never label cheering spectators, commentators, or officials as "ប្រព័ន្ធ".
6. Keep grammatical mid-sentence continuations under the same speaker unless a clear voice switch occurs in scene_audio.mp3.
7. If a line talks ABOUT another character (e.g. calling "苏铭" or "妈妈"), identify WHO IS SPEAKING, not the person mentioned.
8. Name recurring scene speakers cleanly by role or name (e.g. "ស៊ូ មីង", "ម្តាយ", "យាយចាស់", "នាយក", "ជំនួយការ", "មន្ត្រីជប៉ុន", "អ្នកទស្សនា", "អ្នកទស្សនាស្រី", "បិសាចសក់ស", "ក្មេងស្រី", "យូម៉ា") — NEVER invent numbered placeholders like "ស្ត្រីទី១/២/៣" or "បុរសទី១/២/៣" and NEVER use English "UNKNOWN" as speakerName. If evidence is genuinely ambiguous, set "speakerName": "តួអង្គ", "speakerGender": "UNKNOWN", "isAmbiguous": true, "confidence": 0.45.
9. Preserve 1:1 exact "sourceCueId" for EVERY listed cue (do not skip or merge any cue). If ONE cue contains 2 distinct speakers talking inside the same line, keep ONE entry for that sourceCueId and populate "internalTurns": [{ "textZh": "...", "speakerName": "...", "speakerGender": "MALE|FEMALE|UNKNOWN" }].

Return ONLY valid JSON:
{
  "cues": [
    {
      "sourceCueId": "cue_1",
      "speakerName": "ស៊ូ មីង",
      "chineseAlias": "苏铭",
      "speakerGender": "MALE",
      "confidence": 0.95,
      "deliveryType": "out_loud",
      "speakerLocation": "on_screen",
      "isAmbiguous": false,
      "evidence": "Young male voice on audio speaking onscreen",
      "internalTurns": []
    }
  ]
}`;
}

function buildCueGroupsForVerification(indexedItems = [], maxBatchSize = 18, maxSpanSec = 70) {
  const batches = [];
  let current = [];
  let spanStart = 0;

  for (const item of indexedItems) {
    const start = Number(item.cue.startSec || 0);
    const end = Number(item.cue.endSec || start + 1);
    if (
      current.length > 0 &&
      (current.length >= maxBatchSize || end - spanStart > maxSpanSec)
    ) {
      batches.push(current);
      current = [];
    }
    if (current.length === 0) spanStart = start;
    current.push(item);
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/**
 * Step 1 Multimodal Speaker Identification & Verification.
 * Preserves strict 1:1 cue mapping (never adds, removes, or merges cues).
 */
async function identifySpeakersForCues({
  cues = [],
  videoPath = null,
  audioPath = null,
  startOffsetSec = 0,
  durationSec = 0,
  apiKey = null,
  modelName = null,
  mode = 'dialogue',
  seriesSpeakerMap = {},
  castRegistry = [],
  narratorGender = 'male',
  signal = null,
  aiClient = null,
  visualProbeFn = null,
  geminiGenerateFn = null,
  onLog = null,
} = {}) {
  const log = typeof onLog === 'function' ? onLog : (msg) => console.log(`[SpeakerID] ${msg}`);
  if (!Array.isArray(cues) || cues.length === 0) {
    return { cues: [], castRegistry: [], geminiCallsCount: 0, stats: { totalCues: 0, resolvedCount: 0, reviewNeededCount: 0, geminiCallsCount: 0 } };
  }

  const workingCues = cues.map((raw, idx) => {
    const sourceCueId = String(raw.sourceCueId || `cue_${raw.id ?? idx + 1}`).trim();
    const chineseText = String(raw.originalChineseText || raw.chineseText || raw.textZh || raw.originalText || raw.original || raw.text || '').trim();
    return {
      ...raw,
      sourceCueId,
      originalChineseText: chineseText,
      chineseText,
    };
  });

  // 1. Local Acoustic Analysis + Diarization Clustering FIRST (zero Gemini API calls)
  // Note: enrichCuesWithAcousticPitch extracts full 0..end if startOffsetSec=0 on full videoPath
  const mediaForAudio = (audioPath && fs.existsSync(audioPath)) ? audioPath : videoPath;
  const needsAcoustic = workingCues.some((c) => !c.acousticClusterId && (c.pitchHz === undefined || c.voicedRatio === undefined));
  if (needsAcoustic && mediaForAudio && fs.existsSync(mediaForAudio)) {
    const absOffset = (audioPath && fs.existsSync(audioPath)) ? startOffsetSec : 0;
    await enrichCuesWithAcousticPitch(mediaForAudio, workingCues, { startOffsetSec: absOffset, durationSec: absOffset > 0 ? durationSec : 0, signal });
  }

  // Recap mode is single-narrator by definition, but keeps acoustic telemetry & 1:1 sourceCueId
  if (mode === 'recap') {
    const resolvedGender = normalizeGenderToken(narratorGender) === 'FEMALE' ? 'FEMALE' : 'MALE';
    const voiceId = voiceForGender(resolvedGender);
    const out = workingCues.map((c) => ({
      ...c,
      speaker: 'អ្នកសម្រាយរឿង',
      speakerName: 'អ្នកសម្រាយរឿង',
      speakerId: 'spk_narrator',
      speakerGender: resolvedGender,
      voiceGender: resolvedGender.toLowerCase(),
      gender: resolvedGender.toLowerCase(),
      speakerConfidence: 0.95,
      genderConfidence: 0.95,
      voiceId,
      khmerVoiceId: voiceId,
      voice: voiceId,
      deliveryType: 'narration',
      voiceAssignmentSource: 'automatic',
      speakerStatus: 'verified',
      speakerReviewNeeded: false,
      unverifiedSpeaker: false,
      speakerEvidence: {
        source: 'recap_narrator',
        audio: `f0=${c.pitchHz || 0}Hz`,
        visual: 'recap_narration',
        reason: 'Recap mode single verified narrator',
        location: 'narrator',
      },
    }));
    return {
      cues: out,
      castRegistry: [{ name: 'អ្នកសម្រាយរឿង', gender: resolvedGender.toLowerCase(), voiceId }],
      geminiCallsCount: 0,
      stats: { totalCues: out.length, resolvedCount: out.length, reviewNeededCount: 0, geminiCallsCount: 0 },
    };
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dragondub_spkid_'));
  let geminiCallsCount = 0;

  try {
    // 2. Local Visual Face/Shot Context Extraction
    const visualMap = typeof visualProbeFn === 'function'
      ? await visualProbeFn({ videoPath, cues: workingCues, workDir, signal })
      : await runCueVisualProbe({ videoPath, cues: workingCues, workDir, signal });

    const castIndex = buildKnownCastIndex(seriesSpeakerMap, castRegistry);
    const clusterVerifiedCounts = new Map();
    const mmResults = new Map();
    const preliminary = workingCues.map((cue, idx) => {
      const visual = visualMap.get(cue.sourceCueId) || null;
      const isManual = Boolean(cue.userOverridden || cue.voiceAssignmentSource === 'manual' || cue.voiceOverride);

      let localMatch = null;
      let needsMm = true;

      if (isManual) {
        needsMm = false;
      } else if (isDeterministicSystemCue(cue.chineseText) && cue.acousticGender !== 'male') {
        const sysCast = findCastMatch(castIndex, ['ប្រព័ន្ធ', 'System', '系统']);
        localMatch = {
          speakerName: sysCast?.name || 'ប្រព័ន្ធ',
          speakerId: sysCast?.speakerId || 'spk_female_ប្រព័ន្ធ',
          speakerGender: sysCast?.gender || 'FEMALE',
          confidence: cue.acousticGender === 'female' ? 0.94 : 0.86,
          deliveryType: 'narration',
          speakerLocation: 'system',
          source: sysCast ? 'series_glossary' : 'local_system_rule',
          evidence: `Deterministic system announcement matched + acoustic(${cue.acousticGender || 'non-male'})`,
        };
        needsMm = false;
      }

      return { idx, cue, visual, localMatch, needsMm };
    });

    // 3. Selective Batched Gemini Multimodal Verification (ONLY for uncertain/dialogue cues)
    const hasGemini = Boolean(geminiGenerateFn || aiClient || apiKey);
    const itemsToVerify = preliminary.filter((item) => item.needsMm && item.cue.chineseText.length > 0);

    if (hasGemini && itemsToVerify.length > 0) {
      const batches = buildCueGroupsForVerification(itemsToVerify, 10, 35);
      const client = aiClient || (apiKey ? createSmartGenAIClient(apiKey) : null);
      const activeModel = await resolveValidModelName(modelName || DEFAULT_MODELS.FAST || 'gemini-3.5-flash-lite', client);

      log(`Verifying ${itemsToVerify.length}/${workingCues.length} uncertain cues in ${batches.length} multimodal scene batch(es) (model=${activeModel})`);

      const ingestReturnedCues = (returnedCues = [], targetIds = null) => {
        for (const rc of returnedCues) {
          const cid = String(rc?.sourceCueId || '').trim();
          if (!cid || (targetIds && !targetIds.has(cid))) continue;
          const mmGender = normalizeGenderToken(rc.speakerGender || rc.gender);
          const mmConf = typeof rc.confidence === 'number' ? Math.max(0, Math.min(1, rc.confidence)) : (mmGender === 'UNKNOWN' ? 0.45 : 0.85);
          const rawName = String(rc.speakerName || '').trim();
          const cleanedName = isGenericSpeakerName(rawName) ? 'តួអង្គ' : normalizeSpeakerName(rawName, mmGender.toLowerCase());
          const existingCast = findCastMatch(castIndex, [cleanedName, rawName, rc.chineseAlias]);
          const resolvedName = existingCast?.name || cleanedName;
          const isLowConfGeneric = isGenericSpeakerName(resolvedName) && mmConf < 0.78;

          mmResults.set(cid, {
            speakerName: resolvedName,
            chineseAlias: rc.chineseAlias || null,
            speakerGender: isLowConfGeneric ? 'UNKNOWN' : mmGender,
            confidence: isLowConfGeneric ? Math.min(mmConf, 0.5) : mmConf,
            deliveryType: ['out_loud', 'inner_thought', 'narration'].includes(rc.deliveryType) ? rc.deliveryType : 'out_loud',
            speakerLocation: rc.speakerLocation || 'on_screen',
            isAmbiguous: Boolean(rc.isAmbiguous || mmGender === 'UNKNOWN' || isLowConfGeneric),
            evidence: String(rc.evidence || 'Multimodal audio + visual verification').trim(),
            internalTurns: Array.isArray(rc.internalTurns) ? rc.internalTurns : [],
          });

          // Promote ONLY non-numbered/non-crowd verified characters into running episode cast index
          if (resolvedName && !isEpisodicRoleSpeakerName(resolvedName) && mmGender !== 'UNKNOWN' && mmConf >= 0.75 && !rc.isAmbiguous) {
            const aliasKey = normalizeCharacterAliasKey(resolvedName);
            if (!castIndex.has(aliasKey)) {
              const spkId = existingCast?.speakerId || getSpeakerId(resolvedName, mmGender.toLowerCase());
              const entry = {
                speakerId: spkId,
                name: resolvedName,
                gender: mmGender,
                voiceId: voiceForGender(mmGender),
                source: 'multimodal_verified',
                aliases: [resolvedName, rawName, rc.chineseAlias].filter(Boolean),
              };
              for (const al of entry.aliases) {
                const ak = normalizeCharacterAliasKey(al);
                if (ak && !castIndex.has(ak)) castIndex.set(ak, entry);
              }
            }
          }
        }
      };

      const callGeminiVerification = async (promptParts, targetBatch, tagSuffix) => {
        geminiCallsCount++;
        const geminiRes = geminiGenerateFn
          ? await geminiGenerateFn({ client, model: activeModel, parts: promptParts, batch: targetBatch, signal })
          : await generateContentWithModelFallback(
              client,
              activeModel,
              () => ({
                contents: [{ role: 'user', parts: promptParts }],
                config: {
                  temperature: 0.1,
                  responseMimeType: 'application/json',
                },
              }),
              {
                logTag: `speakerId_${tagSuffix}`,
                timeoutMs: 45000,
              }
            );
        const resPayload = geminiRes?.response || geminiRes;
        const rawText = typeof resPayload === 'string'
          ? resPayload
          : (typeof resPayload?.text === 'function'
              ? resPayload.text()
              : (resPayload?.text || resPayload?.response?.text?.() || ''));
        const parsed = typeof resPayload === 'object' && Array.isArray(resPayload?.cues)
          ? resPayload
          : safeParseOrRepairJson(rawText, { fallback: { cues: [] } });
        return Array.isArray(parsed?.cues) ? parsed.cues : [];
      };

      for (let bIdx = 0; bIdx < batches.length; bIdx++) {
        if (signal?.aborted) throw createAbortError('Speaker identification aborted');
        const batch = batches[bIdx];
        const firstIdx = batch[0].idx;
        const lastIdx = batch[batch.length - 1].idx;
        const contextBefore = [];
        for (let p = Math.max(0, firstIdx - 2); p < firstIdx; p++) {
          const prevMm = mmResults.get(workingCues[p].sourceCueId) || preliminary[p].localMatch;
          contextBefore.push({
            startSec: workingCues[p].startSec,
            chineseText: workingCues[p].chineseText,
            speakerName: prevMm?.speakerName || workingCues[p].speaker,
            speakerGender: prevMm?.speakerGender || workingCues[p].speakerGender,
          });
        }
        const contextAfter = workingCues.slice(lastIdx + 1, lastIdx + 2).map((c) => ({
          startSec: c.startSec,
          chineseText: c.chineseText,
        }));

        const { montagePath, audioPath: sliceAudioPath, sliceStartSec } = await buildBatchMontageAndAudio({
          batchItems: batch,
          mediaSourcePath: (audioPath && fs.existsSync(audioPath)) ? audioPath : videoPath,
          workDir,
          batchIndex: bIdx + 1,
          startOffsetSec,
          signal,
        });

        const promptText = buildVerificationPrompt({
          batchItems: batch,
          sliceStartSec,
          contextBefore,
          contextAfter,
          knownCastList: Array.from(new Map(Array.from(castIndex.values()).map((c) => [c.speakerId, c])).values()),
        });

        try {
          const mediaParts = [];
          if (sliceAudioPath && fs.existsSync(sliceAudioPath)) {
            mediaParts.push({
              inlineData: {
                mimeType: 'audio/mp3',
                data: fs.readFileSync(sliceAudioPath).toString('base64'),
              },
            });
          }
          if (montagePath && fs.existsSync(montagePath)) {
            mediaParts.push({
              inlineData: {
                mimeType: 'image/jpeg',
                data: fs.readFileSync(montagePath).toString('base64'),
              },
            });
          }

          const batchTargetIds = new Set(batch.map((it) => it.cue.sourceCueId));
          const returnedCues = await callGeminiVerification([...mediaParts, { text: promptText }], batch, `batch_${bIdx + 1}`);
          ingestReturnedCues(returnedCues, batchTargetIds);

          // Strict 1:1 check: retry any omitted cues in this batch using the already-cached audio/montage
          const missingItems = batch.filter((it) => !mmResults.has(it.cue.sourceCueId));
          if (missingItems.length > 0 && missingItems.length < batch.length) {
            const retryPrompt = buildVerificationPrompt({
              batchItems: missingItems,
              sliceStartSec,
              contextBefore,
              contextAfter,
              knownCastList: Array.from(new Map(Array.from(castIndex.values()).map((c) => [c.speakerId, c])).values()),
            });
            const missingIds = new Set(missingItems.map((it) => it.cue.sourceCueId));
            const retryCues = await callGeminiVerification([...mediaParts, { text: retryPrompt }], missingItems, `batch_${bIdx + 1}_retry`);
            ingestReturnedCues(retryCues, missingIds);
          }
        } catch (batchErr) {
          if (batchErr?.name === 'AbortError' || signal?.aborted) throw batchErr;
          console.warn(`[SpeakerID] Batch ${bIdx + 1} Gemini fallback notice:`, batchErr.message);
        }
      }
    }

    // 4. Deterministic Post-Verification Resolution, Conflict Guard & 1:1 Output Assembly
    const outCastMap = new Map();
    let resolvedCount = 0;
    let reviewNeededCount = 0;

    const finalCues = preliminary.map(({ idx, cue, visual, localMatch }) => {
      const mm = mmResults.get(cue.sourceCueId) || null;
      const isManual = Boolean(cue.userOverridden || cue.voiceAssignmentSource === 'manual' || cue.voiceOverride);

      if (isManual) {
        resolvedCount++;
        const manualVoice = cue.voiceOverride || cue.voiceId || cue.khmerVoiceId || 'km-KH-PisethNeural';
        const gToken = normalizeGenderToken(cue.speakerGender || cue.voiceGender || cue.gender);
        const manualName = String(cue.speakerName || cue.speaker || 'តួអង្គ').trim();
        return {
          ...cue,
          speaker: manualName,
          speakerName: manualName,
          speakerId: cue.speakerId || getSpeakerId(manualName, gToken.toLowerCase()),
          speakerGender: gToken,
          voiceGender: gToken === 'FEMALE' ? 'female' : (gToken === 'MALE' ? 'male' : 'unknown'),
          gender: gToken === 'FEMALE' ? 'female' : (gToken === 'MALE' ? 'male' : 'unknown'),
          voiceId: manualVoice,
          khmerVoiceId: manualVoice,
          voice: manualVoice,
          speakerConfidence: 1.0,
          genderConfidence: 1.0,
          voiceAssignmentSource: 'manual',
          userOverridden: true,
          speakerStatus: 'verified',
          speakerReviewNeeded: false,
          unverifiedSpeaker: false,
          speakerEvidence: cue.speakerEvidence || {
            source: 'manual',
            audio: `f0=${cue.pitchHz || 0}Hz`,
            visual: `faces=${visual?.faceCount ?? 'na'}`,
            reason: 'User manual voice override preserved',
            location: 'manual',
          },
        };
      }

      let candidateName = mm?.speakerName || localMatch?.speakerName || String(cue.speakerName || cue.speaker || '').trim();
      const seriesMatch = findCastMatch(castIndex, [candidateName, mm?.chineseAlias, cue.speaker]);
      if (seriesMatch && !isGenericSpeakerName(candidateName)) {
        candidateName = seriesMatch.name;
      }

      const acGender = normalizeGenderToken(cue.acousticGender);
      const visGender = normalizeGenderToken(cue.visualGender);
      const titleGender = isGenericSpeakerName(candidateName) ? 'UNKNOWN' : normalizeGenderToken(detectSpeakerGender(candidateName, '', ''));

      let finalGender = 'UNKNOWN';
      let confidence = 0.45;
      let resolvedSource = 'review_needed';
      let reason = 'Ambiguous or insufficient multimodal evidence';
      let location = mm?.speakerLocation || (visual?.faceCount === 0 ? 'off_screen' : 'on_screen');
      let deliveryType = mm?.deliveryType || localMatch?.deliveryType || cue.deliveryType || 'out_loud';

      if (localMatch && localMatch.speakerGender !== 'UNKNOWN') {
        finalGender = localMatch.speakerGender;
        confidence = localMatch.confidence;
        resolvedSource = localMatch.source;
        reason = localMatch.evidence;
      } else if (mm && !mm.isAmbiguous && mm.speakerGender !== 'UNKNOWN' && mm.confidence >= 0.62) {
        // Check severe clean-voice contradiction only when audio has low IQR & high periodicity (no scream/BGM confusion)
        const pitch = Number(cue.pitchHz || 0);
        const cleanAudioContradiction = Boolean(
          !cue.bgmSuspected &&
          Number(cue.voicedRatio || 0) >= 0.45 &&
          Number(cue.pitchIqr || 0) < 42 &&
          Number(cue.acousticConfidence || 0) >= 0.85 &&
          ((mm.speakerGender === 'MALE' && pitch >= 218) || (mm.speakerGender === 'FEMALE' && pitch > 0 && pitch <= 116))
        );
        if (cleanAudioContradiction) {
          finalGender = 'UNKNOWN';
          confidence = 0.5;
          resolvedSource = 'review_needed';
          reason = `Conflict: multimodal=${mm.speakerGender} (${mm.confidence}) vs clean audio F0=${pitch}Hz`;
        } else {
          finalGender = mm.speakerGender;
          confidence = mm.confidence;
          resolvedSource = seriesMatch && seriesMatch.source === 'series_glossary' ? 'series_glossary' : 'multimodal_verified';
          reason = mm.evidence;
        }
      } else if (!mm) {
        // Offline / no-API multi-signal fusion (never infer gender solely from raw pitch thresholds or Khmer text — mark ambiguous cues review_needed)
        if (visGender !== 'UNKNOWN' && (acGender === visGender || acGender === 'UNKNOWN')) {
          finalGender = visGender;
          confidence = acGender === visGender ? 0.9 : 0.76;
          resolvedSource = 'local_acoustic_visual';
          reason = `Local visual(${visGender}) + acoustic(${acGender})`;
        } else if (seriesMatch && seriesMatch.gender !== 'UNKNOWN' && (acGender === seriesMatch.gender || acGender === 'UNKNOWN')) {
          finalGender = seriesMatch.gender;
          confidence = 0.82;
          resolvedSource = 'series_glossary';
          reason = `Matched verified series character "${seriesMatch.name}"`;
        } else if (titleGender !== 'UNKNOWN' && (acGender === titleGender || acGender === 'UNKNOWN')) {
          finalGender = titleGender;
          confidence = 0.74;
          resolvedSource = 'local_acoustic_visual';
          reason = `Explicit character role "${candidateName}" (${titleGender})`;
        }
      }

      const isVerified = finalGender === 'MALE' || finalGender === 'FEMALE';
      const voiceGender = isVerified ? finalGender.toLowerCase() : 'unknown';
      const speakerName = normalizeSpeakerName(candidateName || 'តួអង្គ', voiceGender);
      const isGeneric = isGenericSpeakerName(speakerName);

      // Mint distinct, consistent speakerId (same character -> same ID; generic/unknown -> isolated ID)
      let speakerId;
      if (seriesMatch && !isGeneric && isVerified && seriesMatch.gender === finalGender) {
        speakerId = seriesMatch.speakerId;
      } else if (!isGeneric && isVerified) {
        speakerId = getSpeakerId(speakerName, voiceGender);
      } else if (cue.acousticClusterId) {
        speakerId = isVerified ? `spk_${voiceGender}_${cue.acousticClusterId}` : `spk_review_${cue.acousticClusterId}`;
      } else if (isVerified) {
        speakerId = `spk_${voiceGender}_${cue.sourceCueId}`;
      } else {
        speakerId = `spk_review_${cue.sourceCueId}`;
      }

      const voiceId = isVerified ? voiceForGender(finalGender) : getDefaultVoiceForGender('UNKNOWN');
      const internalTurns = Array.isArray(mm?.internalTurns) && mm.internalTurns.length > 1
        ? mm.internalTurns.map((t) => {
            const tg = normalizeGenderToken(t.speakerGender);
            const tn = String(t.speakerName || speakerName).trim();
            return {
              textZh: String(t.textZh || t.text || '').trim(),
              speakerName: tn,
              speakerId: getSpeakerId(tn, tg.toLowerCase()),
              speakerGender: tg,
              voiceId: tg === 'MALE' || tg === 'FEMALE' ? voiceForGender(tg) : null,
            };
          })
        : [];

      const reviewNeeded = !isVerified || Boolean(cue.uncertainOcr);
      if (isVerified) {
        resolvedCount++;
        if (!isGeneric && !outCastMap.has(speakerId)) {
          outCastMap.set(speakerId, {
            id: speakerId,
            speakerId,
            name: speakerName,
            gender: voiceGender,
            speakerGender: finalGender,
            voiceId,
            khmerVoiceId: voiceId,
            voiceAssignmentSource: resolvedSource,
            aliases: Array.from(new Set([speakerName, mm?.chineseAlias].filter(Boolean))),
          });
        }
        if (cue.acousticClusterId) {
          clusterVerifiedCounts.set(cue.acousticClusterId, speakerName);
        }
      } else {
        reviewNeededCount++;
      }

      return {
        ...cue,
        speaker: speakerName,
        speakerName,
        speakerId,
        speakerGender: finalGender,
        voiceGender,
        gender: voiceGender,
        speakerConfidence: Number(confidence.toFixed(2)),
        genderConfidence: isVerified ? Number(confidence.toFixed(2)) : null,
        voiceId,
        khmerVoiceId: voiceId,
        voice: voiceId,
        deliveryType,
        speakerVerified: isVerified,
        speakerStatus: isVerified ? 'verified' : 'review_needed',
        speakerReviewNeeded: !isVerified,
        reviewNeeded,
        unverifiedSpeaker: !isVerified,
        voiceAssignmentSource: isVerified ? resolvedSource : 'fallback',
        speakerEvidence: {
          source: resolvedSource,
          audio: `f0=${cue.pitchHz || 0}Hz (${cue.acousticGender || 'unknown'}, conf=${cue.acousticConfidence || 0}, iqr=${cue.pitchIqr || 0}, cl=${cue.acousticClusterId || 'none'})`,
          visual: `faces=${visual ? visual.faceCount : (cue.visualGender ? 'ocr' : 'na')}, visGender=${cue.visualGender || 'unknown'}, shotCut=${Boolean(visual?.sceneCutFromPrev)}`,
          reason,
          location,
        },
        ...(internalTurns.length > 0 ? { internalSpeakerTurns: internalTurns, hasMultipleSpeakers: true } : {}),
      };
    });

    return {
      cues: finalCues,
      castRegistry: Array.from(outCastMap.values()),
      geminiCallsCount,
      stats: {
        totalCues: finalCues.length,
        resolvedCount,
        reviewNeededCount,
        geminiCallsCount,
        visualProbedCount: visualMap.size,
      },
    };
  } finally {
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

/**
 * Extract verified non-generic speakers from a completed episode to merge into seriesSpeakerMap
 * so EP1 -> EP28 retain identical speakerId and voice across the series.
 */
function buildVerifiedSeriesSpeakerMapPatch(segments = [], speakerRegistry = {}, existingSeriesMap = {}) {
  const nextMap = { ...(existingSeriesMap || {}) };
  const addVerified = (entry) => {
    if (!entry || typeof entry !== 'object') return;
    const rawName = String(entry.speakerName || entry.name || entry.speaker || '').trim();
    if (!rawName || isGenericSpeakerName(rawName) || isEpisodicRoleSpeakerName(rawName)) return;
    const isManual = Boolean(entry.userOverridden || entry.voiceAssignmentSource === 'manual' || entry.voiceOverride);
    const spkIdRaw = String(entry.speakerId || entry.id || '').trim();
    if (!isManual && spkIdRaw.startsWith('spk_unknown_')) return;
    const gender = normalizeGenderToken(entry.speakerGender || entry.voiceGender || entry.gender);
    const isVerified = isManual || (
      gender !== 'UNKNOWN' &&
      !entry.speakerReviewNeeded &&
      !entry.unverifiedSpeaker &&
      entry.speakerStatus !== 'review_needed' &&
      Number(entry.speakerConfidence ?? entry.genderConfidence ?? 0.85) >= 0.68
    );
    if (!isVerified) return;
    const voiceId = entry.voiceOverride || entry.voiceId || entry.khmerVoiceId || voiceForGender(gender);
    const spkId = entry.speakerId || entry.id || getSpeakerId(rawName, gender.toLowerCase());
    const cleanName = normalizeSpeakerName(rawName, gender.toLowerCase());
    const existing = nextMap[spkId] || nextMap[cleanName] || {};
    // Preserve explicit manual series choice over automated discovery
    if (existing.userOverridden && !isManual) return;

    const record = {
      id: spkId,
      speakerId: spkId,
      name: cleanName,
      speakerName: cleanName,
      khmerName: cleanName,
      gender: gender.toLowerCase(),
      speakerGender: gender,
      voiceGender: gender.toLowerCase(),
      voiceId,
      khmerVoiceId: voiceId,
      voiceAssignmentSource: isManual ? 'manual' : (entry.voiceAssignmentSource || 'series_glossary'),
      userOverridden: isManual,
      aliases: Array.from(new Set([...(existing.aliases || []), cleanName, rawName].filter(Boolean))),
      updatedAt: Date.now(),
    };
    nextMap[spkId] = record;
    nextMap[cleanName] = record;
  };

  Object.values(speakerRegistry || {}).forEach(addVerified);
  (segments || []).forEach(addVerified);
  return nextMap;
}

module.exports = {
  identifySpeakersForCues,
  buildVerifiedSeriesSpeakerMapPatch,
  normalizeCharacterAliasKey,
  isDeterministicSystemCue,
};
