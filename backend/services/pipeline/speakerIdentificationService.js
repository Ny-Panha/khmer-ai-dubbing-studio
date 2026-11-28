const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
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
  isPlaceholderSpeakerName,
  isPositionalSpeakerId,
  buildCharacterId,
} = require('../../models/speakerRegistry');
const { enrichCuesWithAcousticPitch } = require('./stages/stage4_analyzeDialogueAudio');

const AUDIO_MULTIMODAL_FALLBACK_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash',
  'gemini-3-flash-preview',
  'gemini-flash-latest',
];

const SYSTEM_CUE_PATTERN =
  /^(?:恭喜(?:龙国)?(?:玩家|宿主)|检测(?:宿主|异常|完毕)|获得(?:SSS?|SS|[ABCDE])?级?天赋|免疫.*伤害|冷却时间\d+|通关奖励结算|国运规则怪谈.*现在开始|规则[一二三四五六七八九十百\d]+(?:$|[：:，,\s]))/;

const BROADCAST_OR_SYSTEM_TEXT_PATTERN =
  /(?:恭喜|宿主|玩家|天赋|规则|系统|冷却时间|免疫.*伤害|祝福已生效|通关|奖励|陨落|诡异入侵|降临.*全境|副本.*开始|检测到|警告|提示|结算)/;

function isDeterministicSystemCue(text = '') {
  const clean = String(text || '').trim();
  if (!clean) return false;
  return SYSTEM_CUE_PATTERN.test(clean);
}

function isSystemOrBroadcastLikeText(text = '') {
  const clean = String(text || '').trim();
  if (!clean) return false;
  return SYSTEM_CUE_PATTERN.test(clean) || BROADCAST_OR_SYSTEM_TEXT_PATTERN.test(clean);
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
  padBeforeSec = 0.5,
  padAfterSec = 0.5,
  audioBitrate = '48k',
  signal = null,
}) {
  const batchDir = path.join(workDir, `batch_${batchIndex}`);
  fs.mkdirSync(batchDir, { recursive: true });
  const montageJson = path.join(batchDir, 'montage_items.json');
  const montageOut = path.join(batchDir, 'frames_grid.jpg');
  const audioOut = path.join(batchDir, 'scene_audio.mp3');

  const minStart = Math.max(0, Math.min(...batchItems.map((it) => Number(it.cue.startSec || 0))) - padBeforeSec);
  const maxEnd = Math.max(minStart + 1.0, Math.max(...batchItems.map((it) => Number(it.cue.endSec || it.cue.startSec + 1.5))) + padAfterSec);
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
          '-b:a', audioBitrate,
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

const CHARACTER_RECOGNITION_VERSION = 'v3_dynamic_uncontaminated';

function isUnnamedCharacterId(id = '') {
  const s = String(id || '').trim().toLowerCase();
  return s.startsWith('char_unnamed_') || s.startsWith('spk_unnamed_');
}

function buildStableUnnamedIds({
  gender = 'UNKNOWN',
  unnamedEntityKey = null,
  visualAppearance = null,
  voiceTimbreDesc = null,
  acousticClusterId = null,
  sourceCueId = 'cue_0',
} = {}) {
  const gLower = gender === 'FEMALE' ? 'female' : (gender === 'MALE' ? 'male' : 'unknown');
  // Prefer stable acoustic diarization cluster or consistent model entity key over per-shot appearance prose
  const primarySeed = acousticClusterId
    ? `cl:${String(acousticClusterId).trim().toLowerCase()}`
    : (unnamedEntityKey
        ? `ent:${String(unnamedEntityKey).trim().toLowerCase()}`
        : [
            visualAppearance ? `vis:${String(visualAppearance).trim().toLowerCase().slice(0, 48)}` : '',
            voiceTimbreDesc ? `tim:${String(voiceTimbreDesc).trim().toLowerCase().slice(0, 48)}` : '',
          ].filter(Boolean).join('|'));
  const stableSlug = primarySeed
    ? crypto.createHash('md5').update(`${gLower}|${primarySeed}`).digest('hex').slice(0, 8)
    : String(sourceCueId || 'cue').replace(/[^a-zA-Z0-9_]/g, '').slice(-8);
  const speakerId = `spk_unnamed_${gLower}_${stableSlug}`;
  const characterId = `char_unnamed_${gLower}_${stableSlug}`;
  return { speakerId, characterId };
}

function computeSeriesRegistryRevision(seriesSpeakerMap = {}, castRegistry = []) {
  const spkRows = Object.entries(seriesSpeakerMap || {})
    .filter(([, v]) => v && typeof v === 'object')
    .map(([k, v]) => [
      k,
      v.speakerId || v.id || '',
      v.characterId || '',
      v.name || v.speakerName || '',
      v.voiceId || v.khmerVoiceId || '',
      Boolean(v.userOverridden || v.manualCharacterOverridden),
    ])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const castRows = Array.isArray(castRegistry)
    ? castRegistry
        .filter((c) => c && typeof c === 'object')
        .map((c) => [
          c.id || c.speakerId || '',
          c.characterId || '',
          c.name || c.khmerName || '',
          c.voiceId || c.khmerVoiceId || '',
          Boolean(c.userOverridden || c.manualCharacterOverridden),
        ])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    : [];
  return crypto
    .createHash('md5')
    .update(JSON.stringify({ v: CHARACTER_RECOGNITION_VERSION, spkRows, castRows }))
    .digest('hex')
    .slice(0, 12);
}

function buildKnownCastIndex(seriesSpeakerMap = {}, castRegistry = [], { seriesId = null } = {}) {
  const index = new Map();
  const addEntry = (entry) => {
    if (!entry || typeof entry !== 'object') return;
    if (seriesId && entry.seriesId && String(entry.seriesId) !== String(seriesId)) return;
    const isManual = Boolean(entry.userOverridden || entry.manualCharacterOverridden || entry.voiceAssignmentSource === 'manual');
    const rawName = String(entry.speakerName || entry.name || entry.khmerName || '').trim();
    if (!rawName || isPlaceholderSpeakerName(rawName) || isGenericSpeakerName(rawName) || isEpisodicRoleSpeakerName(rawName)) return;
    const rawId = entry.speakerId || entry.id || '';
    const rawCharId = entry.characterId || '';
    if (!isManual && (isUnnamedCharacterId(rawId) || isUnnamedCharacterId(rawCharId))) return;
    if (!isManual && (entry.speakerReviewNeeded || entry.unverifiedSpeaker || entry.speakerStatus === 'review_needed')) return;
    if (!isManual && (entry.hasVerifiedName === false || (typeof entry.characterNameConfidence === 'number' && entry.characterNameConfidence < 0.72))) return;
    if (rawId && isPositionalSpeakerId(rawId) && !entry.manualCharacterOverridden) return;
    const gender = normalizeGenderToken(entry.speakerGender || entry.voiceActorTimbre || entry.voiceGender || entry.gender);
    if (gender === 'UNKNOWN') return;
    const spkId = (rawId && !isPositionalSpeakerId(rawId)) ? String(rawId).trim() : getSpeakerId(rawName);
    const charId = entry.characterId || buildCharacterId(rawName, spkId, { isGeneric: false, isEpisodic: false });
    const canonical = {
      characterId: charId,
      speakerId: spkId,
      seriesId: entry.seriesId || seriesId || null,
      name: normalizeSpeakerName(rawName, gender.toLowerCase()),
      gender,
      characterGender: normalizeGenderToken(entry.characterGender || gender),
      voiceActorTimbre: normalizeGenderToken(entry.voiceActorTimbre || entry.voiceGender || gender),
      voiceId: entry.voiceId || entry.khmerVoiceId || voiceForGender(gender),
      source: entry.voiceAssignmentSource || 'series_glossary',
      userOverridden: Boolean(entry.userOverridden),
      manualCharacterOverridden: Boolean(entry.manualCharacterOverridden),
      characterNameConfidence: typeof entry.characterNameConfidence === 'number' ? entry.characterNameConfidence : null,
      visualAppearance: entry.visualAppearance || null,
      voiceTimbreDesc: entry.voiceTimbreDesc || null,
      aliases: Array.from(new Set([rawName, entry.khmerName, entry.chineseAlias, ...(entry.aliases || [])].filter((a) => a && !isPlaceholderSpeakerName(a)))),
    };
    if (charId && !index.has(`charid:${charId}`)) {
      index.set(`charid:${charId}`, canonical);
    }
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
      if (c && c.name && (c.gender || c.voiceGender)) addEntry(c);
    });
  }
  return index;
}

function findCastMatch(index, candidateNames = [], candidateCharId = null) {
  if (candidateCharId && index.has(`charid:${candidateCharId}`)) {
    return index.get(`charid:${candidateCharId}`);
  }
  for (const cand of candidateNames) {
    if (!cand || isPlaceholderSpeakerName(cand)) continue;
    const key = normalizeCharacterAliasKey(cand);
    if (key && index.has(key)) return index.get(key);
  }
  return null;
}

function formatAuxAudioHint(cue = {}, visual = null) {
  const f0 = Number(cue.pitchHz || 0);
  const vr = Number(cue.voicedRatio || 0);
  const iqr = Number(cue.pitchIqr || 0);
  const durSec = Number(cue.duration || ((Number(cue.endSec || 0) - Number(cue.startSec || 0)) || 0));
  const acG = String(cue.acousticGender || 'unknown').toLowerCase();
  const acC = Number(cue.acousticConfidence || 0);

  const tags = [];
  if (cue.hasReverb || (!cue.bgmSuspected && iqr > 60 && vr > 0 && vr < 0.55)) tags.push('reverb');
  if (cue.hasDistortion) tags.push('distortion');
  if (cue.isScreaming || (f0 > 220 && cue.acousticAmbiguous)) tags.push('scream');
  if (cue.isShortDuration || (durSec > 0 && durSec < 1.5)) tags.push('short');
  if (cue.suspectedOffScreen || (visual && visual.faceCount === 0 && Boolean(cue.chineseText))) tags.push('offscreen_candidate');

  let base;
  if (cue.bgmSuspected || f0 <= 0 || vr < 0.3) base = f0 > 0 ? `noisy_or_mixed(f0~${f0}Hz)` : 'noisy_or_mixed';
  else if (acG === 'female' && acC >= 0.72 && iqr < 68) base = `clean_high_timbre(f0~${f0}Hz)`;
  else if (acG === 'male' && acC >= 0.72 && iqr < 65) base = `clean_low_timbre(f0~${f0}Hz)`;
  else base = f0 > 0 ? `ambiguous_timbre(f0~${f0}Hz)` : 'ambiguous_timbre';

  return tags.length > 0 ? `${base}[${tags.join(',')}]` : base;
}

function buildVerificationPrompt({ batchItems, sliceStartSec, contextBefore, contextAfter, knownCastList }) {
  const castLines = knownCastList.length > 0
    ? knownCastList
        .slice(0, 30)
        .map((c) => `- "${c.name}" (characterId=${c.characterId || c.speakerId}, speakerId=${c.speakerId}, gender=${c.gender}, voiceTimbre=${c.voiceActorTimbre || c.gender}, voiceId=${c.voiceId}${c.visualAppearance ? `, visual="${c.visualAppearance}"` : ''}${c.voiceTimbreDesc ? `, timbre="${c.voiceTimbreDesc}"` : ''}, aliases=${c.aliases.slice(0, 4).join('/')})`)
        .join('\n')
    : '- (No verified recurring cast yet for this series — discover characters strictly from THIS video\'s audio, visual frames, and dialogue)';

  const beforeText = (contextBefore || [])
    .map((c) => `  [prev ${Number(c.startSec || 0).toFixed(1)}s | speaker="${c.speakerName || '?'}" (${c.speakerGender || 'UNKNOWN'})]: ${c.chineseText}`)
    .join('\n');
  const afterText = (contextAfter || [])
    .map((c) => `  [next ${Number(c.startSec || 0).toFixed(1)}s${c.speakerName ? ` | speaker="${c.speakerName}" (${c.speakerGender || 'UNKNOWN'})` : ''}]: ${c.chineseText}`)
    .join('\n');

  const cueLines = batchItems
    .map((it, slotIdx) => {
      const c = it.cue;
      const relStart = Math.max(0, Number(c.startSec || 0) - sliceStartSec).toFixed(2);
      const relEnd = Math.max(0, Number(c.endSec || c.startSec + 1) - sliceStartSec).toFixed(2);
      const durSec = Math.max(0.2, Number(c.endSec || c.startSec + 1) - Number(c.startSec || 0)).toFixed(2);
      const vis = it.visual;
      const clusterTag = (!c.bgmSuspected && c.acousticClusterId) ? c.acousticClusterId : 'none';
      const audioHint = formatAuxAudioHint(c, vis);
      return `${slotIdx + 1}. sourceCueId="${c.sourceCueId}" | sceneTime=${relStart}s-${relEnd}s (dur=${durSec}s) | frameCell=#${slotIdx + 1} | faces=${vis ? vis.faceCount : '?'} | shotCut=${vis?.sceneCutFromPrev ? 'YES' : 'no'} | audioHint=${audioHint} | voiceCluster=${clusterTag} | zh="${c.chineseText}"`;
    })
    .join('\n');

  return `You are a Multimodal Character & Speaker Recognition Specialist for Chinese-to-Khmer drama dubbing.
Analyze BOTH the attached audio clip (scene_audio.mp3 starting at 0.00s) AND the numbered keyframe contact sheet (frames_grid.jpg where cell #N corresponds to cue #N) together with the dialogue lines and surrounding turns below.

KNOWN VERIFIED RECURRING CAST (CROSS-EPISODE SERIES MEMORY — MATCH BY FACE, APPEARANCE, VOICE TIMBRE, DIALOGUE & CONTEXT):
${castLines}

${beforeText ? `PRECEDING CONTEXT:\n${beforeText}\n` : ''}
CUES TO VERIFY IN THIS SCENE:
${cueLines}
${afterText ? `\nFOLLOWING CONTEXT:\n${afterText}` : ''}

STRICT CHARACTER & VOICE VERIFICATION RULES:
1. **DISCOVER ONLY FROM THIS VIDEO — NEVER INVENT PERSONAL NAMES FROM VOICE GENDER**:
   - Compare face features, hair/build, voice timbre in scene_audio.mp3, dialogue style, and relationship context ONLY against verified cast in KNOWN VERIFIED RECURRING CAST above and the current video itself.
   - Recognize returning characters EVEN when clothing, camera angle, lighting, or scene changes, and reuse their EXACT Khmer "speakerName" and "characterId".
   - ONLY assign a specific personal "speakerName" and set "hasVerifiedName": true + "characterNameConfidence" >= 0.80 when the character's name is explicitly spoken/addressed in THIS video's Chinese dialogue, shown on screen, or present in KNOWN VERIFIED RECURRING CAST above (cite exact source in "nameEvidence").
   - NEVER fabricate or hallucinate a personal character name just because you hear a male or female voice! If a speaker's actual name is NOT established in THIS video, set "speakerName": "តួអង្គ", "chineseAlias": "", "hasVerifiedName": false, "characterNameConfidence": 0.0, "nameEvidence": "none", and assign a consistent "unnamedEntityKey" (e.g. "entity_male_1", "entity_female_1") so repeated appearances of that same unnamed voice stay grouped distinctly without merging different speakers.
   - Separate the three confidences clearly: "voiceGenderConfidence" (0..1 acoustic vocal gender), "characterIdentityConfidence" (0..1 which speaker/body/voice instance is speaking), and "characterNameConfidence" (0..1 evidence for their actual personal name).
   - If you are genuinely uncertain who is speaking or their voice gender, set "speakerName": "តួអង្គ", "speakerGender": "UNKNOWN", "voiceGenderConfidence": 0.45, "characterIdentityConfidence": 0.4, "characterNameConfidence": 0.0, "hasVerifiedName": false, "isAmbiguous": true, "confidence": 0.45.
2. Listen carefully to the ACTUAL human voice at sceneTime in scene_audio.mp3 AND inspect cell #N of frames_grid.jpg together. Treat audioHint/voiceCluster as auxiliary clues only — NEVER blindly inherit the previous speaker's identity or gender across speaker turns.
3. OFF-SCREEN CALLERS vs SILENT LISTENERS & PHONE/INTERCOM: Distinguish the ACTUAL SPEAKER from silent characters/listeners shown on screen! On phone/intercom/off-screen audio, check formant timbre and conversational turns rather than attributing the voice to a silent listener face.
4. SCREAMING/PANICKED/SHORT CUES: Never confuse panicked/crying/screaming men (180-220Hz) with FEMALE, and never confuse high female screams (~250-320Hz) with MALE. For short clips (<1.5s), use surrounding turn context + vocal timbre carefully.
5. **PRIORITY: VOICE ACTOR TIMBRE CLASSIFICATION** — Classify "speakerGender" by the ACTUAL voice actor's acoustic timbre heard in scene_audio.mp3 (Female actress voicing boy/spirit -> "FEMALE"; Male actor voicing woman for comedy -> "MALE"), NOT by character costume/appearance alone. Track visual character gender separately if mismatched.
6. DISTORTED / ECHOEY GHOSTS & MONSTERS: Listen beneath reverb/chorus distortion in scene_audio.mp3 to detect whether the underlying human voice actor is FEMALE (female hiss/wail -> "FEMALE") or MALE (deep male growl -> "MALE").
7. GENERIC SYSTEM BROADCASTS, CROWDS & NARRATORS: Treat generic broadcasts ("ប្រព័ន្ធ"), danmaku crowds ("អ្នកទស្សនា" MALE vs "អ្នកទស្សនាស្រី" FEMALE), and narrators as separate speaker instances based on the ACTUAL voice heard in THIS scene — never overwrite recurring named characters or blindly lock broadcast gender across scenes.
8. Keep grammatical mid-sentence continuations under the same speaker ONLY when the same person actually continues speaking in scene_audio.mp3. Never invent numbered placeholders ("ស្ត្រីទី១/២/៣", "បុរសទី១/២/៣") or English "UNKNOWN" as speakerName.
9. Preserve 1:1 exact "sourceCueId" for EVERY listed cue (do not skip or merge any cue). If ONE cue contains 2 distinct speakers talking inside the same line, keep ONE entry for that sourceCueId and populate "internalTurns": [{ "textZh": "...", "speakerName": "...", "speakerGender": "MALE|FEMALE|UNKNOWN" }].

Return ONLY valid JSON:
{
  "cues": [
    {
      "sourceCueId": "cue_1",
      "characterId": "",
      "speakerName": "តួអង្គ",
      "chineseAlias": "",
      "speakerGender": "MALE",
      "characterGender": "MALE",
      "voiceGenderConfidence": 0.92,
      "characterIdentityConfidence": 0.88,
      "characterNameConfidence": 0.0,
      "hasVerifiedName": false,
      "nameEvidence": "none",
      "unnamedEntityKey": "entity_male_1",
      "confidence": 0.92,
      "deliveryType": "out_loud",
      "speakerLocation": "on_screen",
      "visualAppearance": "<visual description of speaker in frame>",
      "voiceTimbreDesc": "<vocal timbre heard in audio>",
      "isAmbiguous": false,
      "evidence": "<audio + visual evidence from this scene>",
      "internalTurns": []
    }
  ]
}`;
}

function buildFocusedRecheckPrompt({ batchItems, sliceStartSec, contextBefore, contextAfter, knownCastList, reasonsByCueId, pass1ByCueId }) {
  const castLines = knownCastList.length > 0
    ? knownCastList
        .slice(0, 24)
        .map((c) => `- "${c.name}" (characterId=${c.characterId || c.speakerId}, gender=${c.gender}${c.visualAppearance ? `, visual="${c.visualAppearance}"` : ''}${c.voiceTimbreDesc ? `, timbre="${c.voiceTimbreDesc}"` : ''})`)
        .join('\n')
    : '- (Use concise consistent Khmer role/character names)';

  const beforeText = (contextBefore || [])
    .map((c) => `  [prev ${Number(c.startSec || 0).toFixed(1)}s | speaker="${c.speakerName || '?'}" (${c.speakerGender || 'UNKNOWN'})]: ${c.chineseText}`)
    .join('\n');
  const afterText = (contextAfter || [])
    .map((c) => `  [next ${Number(c.startSec || 0).toFixed(1)}s | speaker="${c.speakerName || '?'}" (${c.speakerGender || 'UNKNOWN'})]: ${c.chineseText}`)
    .join('\n');

  const cueLines = batchItems
    .map((it, slotIdx) => {
      const c = it.cue;
      const relStart = Math.max(0, Number(c.startSec || 0) - sliceStartSec).toFixed(2);
      const relEnd = Math.max(0, Number(c.endSec || c.startSec + 1) - sliceStartSec).toFixed(2);
      const p1 = pass1ByCueId.get(c.sourceCueId);
      const p1Desc = p1 ? `pass1="${p1.speakerName}"(${p1.speakerGender}, conf=${p1.confidence})` : 'pass1=MISSING';
      const flagReason = reasonsByCueId.get(c.sourceCueId) || 'recheck';
      return `${slotIdx + 1}. sourceCueId="${c.sourceCueId}" | sceneTime=${relStart}s-${relEnd}s | frameCell=#${slotIdx + 1} | ${p1Desc} | flag="${flagReason}" | audioHint=${formatAuxAudioHint(c, it.visual)} | zh="${c.chineseText}"`;
    })
    .join('\n');

  return `FOCUSED SECOND-OPINION CHARACTER & SPEAKER VERIFICATION (TARGETED AUDIT).
Re-listen VERY CAREFULLY to the crisp audio clip (scene_audio.mp3 starting at 0.00s) and inspect frames_grid.jpg together with the surrounding turns below to resolve ONLY these flagged cues.

KNOWN CAST:
${castLines}

${beforeText ? `PRECEDING TURNS:\n${beforeText}\n` : ''}
FLAGGED CUES TO RE-VERIFY:
${cueLines}
${afterText ? `\nFOLLOWING TURNS:\n${afterText}` : ''}

ADJUDICATION INSTRUCTIONS:
1. Focus strictly on the exact voice heard at sceneTime in scene_audio.mp3 combined with visual + surrounding turns. Never blindly carry over Pass-1 character/gender when a speaker switch occurred!
2. Check specifically for common Pass-1 errors:
   - Distinct characters with same gender/pitch merged together -> assign distinct character names/IDs when faces/voices differ.
   - Female voice actress voicing a child/boy -> "FEMALE" (match actual heard voice timbre, not cartoon boy appearance).
   - Distorted/echoey ghostly female voice stereotyped as male -> listen beneath reverb/chorus for true female vs male timbre.
   - Off-screen caller calling an on-screen silent listener's name (check next-turn reaction like "她/他...") -> identify the actual off-screen speaker.
   - Male↔female viewer switches in scrolling danmaku or crowd reactions (do NOT lump all viewers into one male voice).
   - Broadcast / system voice gender mismatch or "ប្រព័ន្ធ" mistakenly applied to human dialogue, inner thoughts, or skill shouts.
   - High-pitched panicked/screaming man -> if you clearly hear a panicked male actor (not a woman/child-actress/female ghost), KEEP "MALE" with high confidence (>=0.80) and explain why!
3. Do NOT guess randomly or invent a personal name if not proven by dialogue, on-screen text, or known series cast! If voice gender is clear but personal name is unverified, keep "speakerName": "តួអង្គ", "hasVerifiedName": false, "characterNameConfidence": 0.0, "unnamedEntityKey": "entity_..." and resolve "speakerGender" with "voiceGenderConfidence" >= 0.75. Only leave "UNKNOWN" / "isAmbiguous": true if voice gender itself is genuinely impossible to tell.
4. Preserve exact 1:1 "sourceCueId" for every listed cue.

Return ONLY valid JSON:
{
  "cues": [
    {
      "sourceCueId": "cue_1",
      "characterId": "",
      "speakerName": "តួអង្គ",
      "chineseAlias": "",
      "speakerGender": "MALE",
      "characterGender": "MALE",
      "voiceGenderConfidence": 0.9,
      "characterIdentityConfidence": 0.85,
      "characterNameConfidence": 0.0,
      "hasVerifiedName": false,
      "nameEvidence": "none",
      "unnamedEntityKey": "entity_male_1",
      "confidence": 0.9,
      "deliveryType": "out_loud",
      "speakerLocation": "on_screen",
      "visualAppearance": "...",
      "voiceTimbreDesc": "...",
      "isAmbiguous": false,
      "evidence": "Clear vocal timbre + turn context explanation",
      "internalTurns": []
    }
  ]
}`;
}

function findSuspectCuesForFocusedRecheck(preliminary = [], mmResults = new Map()) {
  const reasonsByCueId = new Map();
  const flaggedIndices = new Set();

  for (let i = 0; i < preliminary.length; i++) {
    const item = preliminary[i];
    if (!item.needsMm || !item.cue.chineseText) continue;
    const c = item.cue;
    const mm = mmResults.get(c.sourceCueId);

    if (!mm || mm.isAmbiguous || mm.speakerGender === 'UNKNOWN' || mm.confidence < 0.65) {
      flaggedIndices.add(i);
      reasonsByCueId.set(c.sourceCueId, !mm ? 'missing_pass1' : `unresolved_or_low_conf(${mm.speakerGender},${mm.confidence})`);
      continue;
    }

    const f0 = Number(c.pitchHz || 0);
    const vr = Number(c.voicedRatio || 0);
    const iqr = Number(c.pitchIqr || 0);
    const acC = Number(c.acousticConfidence || 0);
    const p25 = Number(c.pitchP25 || 0);
    const p75 = Number(c.pitchP75 || 0);

    // 1. High-precision clean-audio vs Pass-1 multimodal disagreement (triggers focused multimodal re-listen, NEVER flips by F0 alone)
    const strongFemaleConflict = Boolean(
      mm.speakerGender === 'MALE' &&
      !c.bgmSuspected &&
      c.acousticGender === 'female' &&
      vr >= 0.45 &&
      iqr < 55 &&
      acC >= 0.80 &&
      p25 >= 180
    );
    const strongMaleConflict = Boolean(
      mm.speakerGender === 'FEMALE' &&
      !c.bgmSuspected &&
      c.acousticGender === 'male' &&
      vr >= 0.35 &&
      iqr < 55 &&
      acC >= 0.74 &&
      p75 > 0 &&
      p75 <= 158
    );
    if (strongFemaleConflict) {
      flaggedIndices.add(i);
      reasonsByCueId.set(c.sourceCueId, `audio_conflict_pass1_MALE_vs_clean_high_voice(f0=${f0}Hz,p25=${p25}Hz,iqr=${iqr},acC=${acC})`);
      continue;
    }
    if (strongMaleConflict) {
      flaggedIndices.add(i);
      reasonsByCueId.set(c.sourceCueId, `audio_conflict_pass1_FEMALE_vs_clean_low_voice(f0=${f0}Hz,p75=${p75}Hz,iqr=${iqr},acC=${acC})`);
      continue;
    }

    // 2. Suspicious System ("ប្រព័ន្ធ") label on non-system dialogue or inner thought
    if (
      mm.speakerName === 'ប្រព័ន្ធ' &&
      !isSystemOrBroadcastLikeText(c.chineseText) &&
      (mm.deliveryType === 'inner_thought' || (f0 > 0 && f0 <= 135))
    ) {
      flaggedIndices.add(i);
      reasonsByCueId.set(c.sourceCueId, `suspicious_system_on_non_system_text(delivery=${mm.deliveryType},f0=${f0}Hz)`);
      continue;
    }
    // 3. Voice-character mismatch conflict (BC2: visual gender vs clean opposing acoustic timbre)
    const visGenderCue = normalizeGenderToken(c.visualGender || (mm.evidence && /boy|male/i.test(mm.evidence) ? 'MALE' : (/girl|female|woman/i.test(mm.evidence || '') ? 'FEMALE' : 'UNKNOWN')));
    const acousticStrongFemale = !c.bgmSuspected && c.acousticGender === 'female' && vr >= 0.65 && iqr < 60 && acC >= 0.80;
    const acousticStrongMale = !c.bgmSuspected && c.acousticGender === 'male' && vr >= 0.65 && iqr < 60 && acC >= 0.80;
    if (
      (mm.speakerGender === 'MALE' && acousticStrongFemale && visGenderCue === 'MALE') ||
      (mm.speakerGender === 'FEMALE' && acousticStrongMale && visGenderCue === 'FEMALE')
    ) {
      flaggedIndices.add(i);
      reasonsByCueId.set(c.sourceCueId, `voice_character_mismatch(mm=${mm.speakerGender},vis=${visGenderCue},f0=${f0}Hz)`);
      continue;
    }

    // 4. Consecutive speaker change conflict (BC3: continuity assumed despite F0 jump or opposing acoustic)
    if (i > 0) {
      const prevItem = preliminary[i - 1];
      const prevMm = mmResults.get(prevItem.cue.sourceCueId);
      if (
        prevMm &&
        prevMm.speakerName === mm.speakerName &&
        !isGenericSpeakerName(mm.speakerName) &&
        !mm.rechecked
      ) {
        const prevF0 = Number(prevItem.cue.pitchHz || 0);
        const f0Jump = prevF0 > 0 && f0 > 0 && Math.abs(f0 - prevF0) >= 55 && !c.bgmSuspected && !prevItem.cue.bgmSuspected;
        const continuityOpposingAc = ((c.acousticGender === 'female' && mm.speakerGender === 'MALE') || (c.acousticGender === 'male' && mm.speakerGender === 'FEMALE')) && acC >= 0.75;
        if ((continuityOpposingAc || f0Jump) && mm.confidence < 0.78) {
          flaggedIndices.add(i);
          reasonsByCueId.set(c.sourceCueId, `speaker_change_conflict(prevF0=${prevF0}Hz,curF0=${f0}Hz,conf=${mm.confidence})`);
          continue;
        }
      }
    }
  }

  // 2b. Multi-cue consecutive female-band acoustic conflict (2+ adjacent cues with clean female voice where Pass 1 said MALE)
  for (let i = 0; i < preliminary.length - 1; i++) {
    const a = preliminary[i];
    const b = preliminary[i + 1];
    if (!a.needsMm || !b.needsMm) continue;
    const mmA = mmResults.get(a.cue.sourceCueId);
    const mmB = mmResults.get(b.cue.sourceCueId);
    if (!mmA || !mmB || mmA.speakerGender !== 'MALE' || mmB.speakerGender !== 'MALE') continue;
    const gap = Math.abs(Number(b.cue.startSec || 0) - Number(a.cue.endSec || 0));
    const isCleanFem = (c) => !c.bgmSuspected && c.acousticGender === 'female' && Number(c.acousticConfidence || 0) >= 0.74 && Number(c.pitchP25 || 0) >= 175 && Number(c.pitchIqr || 0) < 68;
    if (gap <= 3.0 && isCleanFem(a.cue) && isCleanFem(b.cue)) {
      for (const idx of [i, i + 1]) {
        if (!flaggedIndices.has(idx)) {
          flaggedIndices.add(idx);
          reasonsByCueId.set(preliminary[idx].cue.sourceCueId, `multi_cue_audio_conflict_pass1_MALE_vs_clean_female(f0=${preliminary[idx].cue.pitchHz}Hz)`);
        }
      }
    }
  }

  // Expand ±1 immediate same-turn neighbor within 2.0s when the neighbor had noisy/BGM audio and shared the same Pass-1 speaker
  // so Gemini hears the complete uninterrupted turn in the SAME focused clip (0 extra calls).
  const initialFlagged = Array.from(flaggedIndices);
  for (const idx of initialFlagged) {
    const curItem = preliminary[idx];
    const curMm = mmResults.get(curItem.cue.sourceCueId);
    if (!curMm) continue;
    for (const delta of [-1, 1]) {
      const ni = idx + delta;
      if (ni < 0 || ni >= preliminary.length || flaggedIndices.has(ni)) continue;
      const nb = preliminary[ni];
      if (!nb.needsMm || !nb.cue.chineseText) continue;
      const nbMm = mmResults.get(nb.cue.sourceCueId);
      if (!nbMm) continue;
      const gap = delta < 0
        ? Math.abs(Number(curItem.cue.startSec || 0) - Number(nb.cue.endSec || 0))
        : Math.abs(Number(nb.cue.startSec || 0) - Number(curItem.cue.endSec || 0));
      if (gap <= 2.0 && nbMm.speakerName === curMm.speakerName && nbMm.speakerGender === curMm.speakerGender && Boolean(nb.cue.bgmSuspected)) {
        flaggedIndices.add(ni);
        reasonsByCueId.set(nb.cue.sourceCueId, `same_turn_neighbor_of_${curItem.cue.sourceCueId}`);
      }
    }
  }

  const sortedItems = Array.from(flaggedIndices)
    .sort((a, b) => a - b)
    .map((i) => preliminary[i]);

  return { suspectItems: sortedItems, reasonsByCueId };
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
  seriesId = null,
  episodeId = null,
  sourceMediaFingerprint = null,
  seriesSpeakerMap = {},
  castRegistry = [],
  narratorGender = 'male',
  includeGroundTruthValidation = false,
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

    const castIndex = buildKnownCastIndex(seriesSpeakerMap, castRegistry, { seriesId });
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

      const ingestReturnedCues = (returnedCues = [], targetIds = null, { isRecheck = false } = {}) => {
        for (const rc of returnedCues) {
          const cid = String(rc?.sourceCueId || '').trim();
          if (!cid || (targetIds && !targetIds.has(cid))) continue;
          const mmGender = normalizeGenderToken(rc.speakerGender || rc.gender);
          const mmCharGender = normalizeGenderToken(rc.characterGender || rc.speakerGender || rc.gender);
          const mmConf = typeof rc.confidence === 'number' ? Math.max(0, Math.min(1, rc.confidence)) : (mmGender === 'UNKNOWN' ? 0.45 : 0.85);
          const voiceGenderConfidence = typeof rc.voiceGenderConfidence === 'number'
            ? Math.max(0, Math.min(1, rc.voiceGenderConfidence))
            : mmConf;
          const characterIdentityConfidence = typeof rc.characterIdentityConfidence === 'number'
            ? Math.max(0, Math.min(1, rc.characterIdentityConfidence))
            : mmConf;
          const hasExplicitNameConf = typeof rc.characterNameConfidence === 'number';
          const parsedNameConf = hasExplicitNameConf ? Math.max(0, Math.min(1, rc.characterNameConfidence)) : null;

          const rawName = String(rc.speakerName || '').trim();
          const cleanedName = isPlaceholderSpeakerName(rawName) ? 'តួអង្គ' : normalizeSpeakerName(rawName, mmGender.toLowerCase());
          const existingCast = findCastMatch(castIndex, [cleanedName, rawName, rc.chineseAlias], rc.characterId);
          const rawNameEvidence = String(rc.nameEvidence || '').trim().toLowerCase();
          const isRoleOrGeneric = isGenericSpeakerName(cleanedName) || isEpisodicRoleSpeakerName(cleanedName);
          const nameRejectedAsUnverified = !existingCast && !isRoleOrGeneric && (
            rc.hasVerifiedName === false ||
            rc.hasVerifiedName === 'false' ||
            (hasExplicitNameConf && parsedNameConf < 0.72) ||
            rawNameEvidence === 'none' ||
            rawNameEvidence === 'guessed' ||
            rawNameEvidence === 'invented'
          );

          const effectiveRawName = nameRejectedAsUnverified ? 'តួអង្គ' : cleanedName;
          const resolvedName = existingCast?.name || effectiveRawName;
          const isNamedPersonal = Boolean(
            resolvedName &&
            !isPlaceholderSpeakerName(resolvedName) &&
            !isGenericSpeakerName(resolvedName) &&
            !isEpisodicRoleSpeakerName(resolvedName) &&
            !nameRejectedAsUnverified
          );
          const hasVerifiedName = Boolean(
            existingCast
              ? true
              : (isNamedPersonal && rc.hasVerifiedName !== false && (!hasExplicitNameConf || parsedNameConf >= 0.72))
          );
          const characterNameConfidence = hasVerifiedName
            ? (parsedNameConf !== null ? parsedNameConf : mmConf)
            : (parsedNameConf !== null ? parsedNameConf : 0);

          const isLowConfGeneric = (isPlaceholderSpeakerName(resolvedName) || isGenericSpeakerName(resolvedName)) && voiceGenderConfidence < 0.78 && mmConf < 0.78;
          const visualDesc = typeof rc.visualAppearance === 'string' && rc.visualAppearance.trim() ? rc.visualAppearance.trim() : (existingCast?.visualAppearance || null);
          const timbreDesc = typeof rc.voiceTimbreDesc === 'string' && rc.voiceTimbreDesc.trim() ? rc.voiceTimbreDesc.trim() : (existingCast?.voiceTimbreDesc || null);
          const unnamedEntityKey = typeof rc.unnamedEntityKey === 'string' && rc.unnamedEntityKey.trim()
            ? rc.unnamedEntityKey.trim()
            : null;

          mmResults.set(cid, {
            characterId: hasVerifiedName ? (rc.characterId || existingCast?.characterId || null) : null,
            speakerName: resolvedName,
            chineseAlias: hasVerifiedName ? (rc.chineseAlias || null) : null,
            speakerGender: isLowConfGeneric ? 'UNKNOWN' : mmGender,
            characterGender: mmCharGender,
            confidence: isLowConfGeneric ? Math.min(mmConf, 0.5) : mmConf,
            voiceGenderConfidence: isLowConfGeneric ? Math.min(voiceGenderConfidence, 0.5) : voiceGenderConfidence,
            characterIdentityConfidence,
            characterNameConfidence,
            hasVerifiedName,
            nameEvidence: rc.nameEvidence || (existingCast ? 'series_cast' : (hasVerifiedName ? 'dialogue_or_visual' : 'none')),
            unnamedEntityKey,
            deliveryType: ['out_loud', 'inner_thought', 'narration'].includes(rc.deliveryType) ? rc.deliveryType : 'out_loud',
            speakerLocation: rc.speakerLocation || 'on_screen',
            visualAppearance: visualDesc,
            voiceTimbreDesc: timbreDesc,
            isAmbiguous: Boolean(rc.isAmbiguous || mmGender === 'UNKNOWN' || isLowConfGeneric),
            evidence: String(rc.evidence || 'Multimodal audio + visual verification').trim(),
            internalTurns: Array.isArray(rc.internalTurns) ? rc.internalTurns : [],
            rechecked: Boolean(isRecheck),
          });

          // Promote ONLY genuinely named, name-verified, non-placeholder/non-generic/non-crowd characters into running episode cast index
          if (
            resolvedName &&
            hasVerifiedName &&
            characterNameConfidence >= 0.72 &&
            !isPlaceholderSpeakerName(resolvedName) &&
            !isGenericSpeakerName(resolvedName) &&
            !isEpisodicRoleSpeakerName(resolvedName) &&
            mmGender !== 'UNKNOWN' &&
            mmConf >= 0.75 &&
            !rc.isAmbiguous
          ) {
            const aliasKey = normalizeCharacterAliasKey(resolvedName);
            const spkId = existingCast?.speakerId || getSpeakerId(resolvedName, mmGender.toLowerCase());
            const charId = rc.characterId || existingCast?.characterId || buildCharacterId(resolvedName, spkId, { isGeneric: false, isEpisodic: false });
            if (!castIndex.has(aliasKey)) {
              const entry = {
                characterId: charId,
                speakerId: spkId,
                seriesId: seriesId || null,
                name: resolvedName,
                gender: mmGender,
                characterGender: mmCharGender !== 'UNKNOWN' ? mmCharGender : mmGender,
                voiceActorTimbre: mmGender,
                voiceId: voiceForGender(mmGender),
                characterNameConfidence,
                hasVerifiedName: true,
                source: 'multimodal_verified',
                visualAppearance: visualDesc,
                voiceTimbreDesc: timbreDesc,
                aliases: [resolvedName, rawName, rc.chineseAlias].filter((a) => a && !isPlaceholderSpeakerName(a)),
              };
              if (!castIndex.has(`charid:${charId}`)) castIndex.set(`charid:${charId}`, entry);
              for (const al of entry.aliases) {
                const ak = normalizeCharacterAliasKey(al);
                if (ak && !castIndex.has(ak)) castIndex.set(ak, entry);
              }
            }
          }
        }
      };

      const callGeminiVerification = async (promptParts, targetBatch, tagSuffix, { preferStrongAudio = false } = {}) => {
        geminiCallsCount++;
        const primaryForCall = preferStrongAudio ? 'gemini-3.8-flash' : activeModel;
        const modelsForCall = preferStrongAudio
          ? AUDIO_MULTIMODAL_FALLBACK_MODELS
          : [activeModel, ...AUDIO_MULTIMODAL_FALLBACK_MODELS.filter((m) => m !== activeModel)];
        const geminiRes = geminiGenerateFn
          ? await geminiGenerateFn({ client, model: primaryForCall, parts: promptParts, batch: targetBatch, signal })
          : await generateContentWithModelFallback(
              client,
              primaryForCall,
              () => ({
                contents: [{ role: 'user', parts: promptParts }],
                config: {
                  temperature: 0.1,
                  responseMimeType: 'application/json',
                },
              }),
              {
                models: modelsForCall,
                logTag: `speakerId_${tagSuffix}`,
                timeoutMs: preferStrongAudio ? 20000 : 25000,
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
        for (let p = Math.max(0, firstIdx - 3); p < firstIdx; p++) {
          const prevMm = mmResults.get(workingCues[p].sourceCueId) || preliminary[p].localMatch;
          contextBefore.push({
            startSec: workingCues[p].startSec,
            chineseText: workingCues[p].chineseText,
            speakerName: prevMm?.speakerName || workingCues[p].speaker,
            speakerGender: prevMm?.speakerGender || workingCues[p].speakerGender,
          });
        }
        const contextAfter = workingCues.slice(lastIdx + 1, lastIdx + 4).map((c) => ({
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

      // 3b. Targeted Selective Micro-Verification ONLY for unresolved / acoustic-conflicted / suspicious-system cues
      const { suspectItems, reasonsByCueId } = findSuspectCuesForFocusedRecheck(preliminary, mmResults);
      if (suspectItems.length > 0) {
        const recheckGroups = buildCueGroupsForVerification(suspectItems, 6, 22).slice(0, 4);
        log(`Focused re-check on ${suspectItems.length} flagged cue(s) in ${recheckGroups.length} compact group(s)`);
        const pass1Snapshot = new Map(mmResults);

        for (let rIdx = 0; rIdx < recheckGroups.length; rIdx++) {
          if (signal?.aborted) throw createAbortError('Speaker identification aborted');
          const rGroup = recheckGroups[rIdx];
          const firstIdx = rGroup[0].idx;
          const lastIdx = rGroup[rGroup.length - 1].idx;

          const contextBefore = [];
          for (let p = Math.max(0, firstIdx - 3); p < firstIdx; p++) {
            const prevMm = mmResults.get(workingCues[p].sourceCueId) || preliminary[p].localMatch;
            contextBefore.push({
              startSec: workingCues[p].startSec,
              chineseText: workingCues[p].chineseText,
              speakerName: prevMm?.speakerName || workingCues[p].speaker,
              speakerGender: prevMm?.speakerGender || workingCues[p].speakerGender,
            });
          }
          const contextAfter = [];
          for (let n = lastIdx + 1; n < Math.min(workingCues.length, lastIdx + 4); n++) {
            const nextMm = mmResults.get(workingCues[n].sourceCueId) || preliminary[n].localMatch;
            contextAfter.push({
              startSec: workingCues[n].startSec,
              chineseText: workingCues[n].chineseText,
              speakerName: nextMm?.speakerName || workingCues[n].speaker,
              speakerGender: nextMm?.speakerGender || workingCues[n].speakerGender,
            });
          }

          const { montagePath, audioPath: sliceAudioPath, sliceStartSec } = await buildBatchMontageAndAudio({
            batchItems: rGroup,
            mediaSourcePath: (audioPath && fs.existsSync(audioPath)) ? audioPath : videoPath,
            workDir,
            batchIndex: `recheck_${rIdx + 1}`,
            startOffsetSec,
            padBeforeSec: 2.0,
            padAfterSec: 2.0,
            audioBitrate: '64k',
            signal,
          });

          const recheckPrompt = buildFocusedRecheckPrompt({
            batchItems: rGroup,
            sliceStartSec,
            contextBefore,
            contextAfter,
            knownCastList: Array.from(new Map(Array.from(castIndex.values()).map((c) => [c.speakerId, c])).values()),
            reasonsByCueId,
            pass1ByCueId: pass1Snapshot,
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
            const targetIds = new Set(rGroup.map((it) => it.cue.sourceCueId));
            const returned = await callGeminiVerification([...mediaParts, { text: recheckPrompt }], rGroup, `recheck_${rIdx + 1}`, { preferStrongAudio: true });
            ingestReturnedCues(returned, targetIds, { isRecheck: true });
          } catch (recheckErr) {
            if (recheckErr?.name === 'AbortError' || signal?.aborted) throw recheckErr;
            console.warn(`[SpeakerID] Focused recheck ${rIdx + 1} notice:`, recheckErr.message);
          }
        }
      }
    }

    // 4. Deterministic Post-Verification Resolution, Conflict Guard & 1:1 Output Assembly
    const outCastMap = new Map();
    let resolvedCount = 0;
    let reviewNeededCount = 0;
    let dualAccuracyProvided = false;
    let gtTotal = 0;
    let gtBenchmarkCorrect = 0;
    let gtAcousticCorrect = 0;

    const finalCues = preliminary.map(({ idx, cue, visual, localMatch }) => {
      const mm = mmResults.get(cue.sourceCueId) || null;
      const isManual = Boolean(cue.userOverridden || cue.manualCharacterOverridden || cue.voiceAssignmentSource === 'manual' || cue.voiceOverride);

      if (isManual) {
        resolvedCount++;
        const manualVoice = cue.voiceOverride || cue.voiceId || cue.khmerVoiceId || 'km-KH-PisethNeural';
        const gToken = normalizeGenderToken(cue.speakerGender || cue.voiceGender || cue.gender);
        const manualName = String(cue.speakerName || cue.speaker || 'តួអង្គ').trim();
        const manualSpkId = (cue.speakerId && !isPositionalSpeakerId(cue.speakerId))
          ? cue.speakerId
          : getSpeakerId(manualName, gToken.toLowerCase());
        const manualCharId = cue.characterId || buildCharacterId(manualName, manualSpkId, {
          isGeneric: isGenericSpeakerName(manualName),
          isEpisodic: isEpisodicRoleSpeakerName(manualName),
        });
        const manualEvidence = cue.speakerEvidence || {
          source: 'manual',
          audio: `f0=${cue.pitchHz || 0}Hz`,
          visual: `faces=${visual?.faceCount ?? 'na'}`,
          reason: 'User manual character/voice override preserved',
          location: 'manual',
        };
        return {
          ...cue,
          characterId: manualCharId,
          speaker: manualName,
          speakerName: manualName,
          speakerId: manualSpkId,
          aliases: Array.isArray(cue.aliases) && cue.aliases.length > 0 ? cue.aliases : (!isPlaceholderSpeakerName(manualName) ? [manualName] : []),
          speakerGender: gToken,
          characterGender: normalizeGenderToken(cue.characterGender || gToken),
          voiceActorTimbre: normalizeGenderToken(cue.voiceActorTimbre || gToken),
          voiceGender: gToken === 'FEMALE' ? 'female' : (gToken === 'MALE' ? 'male' : 'unknown'),
          gender: gToken === 'FEMALE' ? 'female' : (gToken === 'MALE' ? 'male' : 'unknown'),
          voiceId: manualVoice,
          khmerVoiceId: manualVoice,
          voice: manualVoice,
          confidence: 1.0,
          speakerConfidence: 1.0,
          recognitionConfidence: 1.0,
          genderConfidence: 1.0,
          voiceAssignmentSource: 'manual',
          userOverridden: true,
          manualCharacterOverridden: Boolean(cue.manualCharacterOverridden),
          speakerStatus: 'verified',
          speakerReviewNeeded: false,
          unverifiedSpeaker: false,
          speakerEvidence: manualEvidence,
          recognitionEvidence: cue.recognitionEvidence || manualEvidence,
        };
      }

      let candidateName = mm?.speakerName || localMatch?.speakerName || String(cue.speakerName || cue.speaker || '').trim();
      if (isPlaceholderSpeakerName(candidateName)) candidateName = '';
      const seriesMatch = findCastMatch(castIndex, [candidateName, mm?.chineseAlias, cue.speaker], mm?.characterId || cue.characterId);
      if (seriesMatch && candidateName && !isGenericSpeakerName(candidateName) && !isPlaceholderSpeakerName(candidateName)) {
        candidateName = seriesMatch.name;
      }

      const acGender = normalizeGenderToken(cue.acousticGender);
      const visGender = normalizeGenderToken(cue.visualGender);
      const titleGender = (!candidateName || isGenericSpeakerName(candidateName) || isPlaceholderSpeakerName(candidateName))
        ? 'UNKNOWN'
        : normalizeGenderToken(detectSpeakerGender(candidateName, '', ''));

      let finalGender = 'UNKNOWN';
      let confidence = 0.45;
      let resolvedSource = 'review_needed';
      let reason = 'Ambiguous or insufficient multimodal evidence';
      let location = mm?.speakerLocation || (visual?.faceCount === 0 ? 'off_screen' : 'on_screen');
      let deliveryType = mm?.deliveryType || localMatch?.deliveryType || cue.deliveryType || 'out_loud';
      let voiceCharacterMismatch = false;
      const inferredCharGender = visGender !== 'UNKNOWN'
        ? visGender
        : (mm?.characterGender && mm.characterGender !== 'UNKNOWN' ? mm.characterGender : (titleGender !== 'UNKNOWN' ? titleGender : 'UNKNOWN'));

      const durSec = Number(cue.duration || ((Number(cue.endSec || 0) - Number(cue.startSec || 0)) || 0));
      const pitch = Number(cue.pitchHz || 0);
      const vr = Number(cue.voicedRatio || 0);
      const iqr = Number(cue.pitchIqr || 0);
      const acC = Number(cue.acousticConfidence || 0);
      const hasScreamConfirm = Boolean(mm && /scream|panick|shout|yell|crying|falsetto/i.test(mm.evidence || '') && /male/i.test(mm.evidence || ''));

      if (localMatch && localMatch.speakerGender !== 'UNKNOWN') {
        finalGender = localMatch.speakerGender;
        confidence = localMatch.confidence;
        resolvedSource = localMatch.source;
        reason = localMatch.evidence;
      } else if (mm && cue.acousticAmbiguous && cue.bgmSuspected && (mm.isAmbiguous || mm.confidence < 0.6)) {
        // Genuinely ambiguous overlap + BGM: mark review_needed instead of forcing low-confidence guess
        finalGender = 'UNKNOWN';
        confidence = Math.min(0.55, mm.confidence || 0.45);
        resolvedSource = 'review_needed';
        reason = `Ambiguous audio (F0=${pitch}Hz, IQR=${iqr}, BGM suspected) — marked review_needed`;
      } else if (mm && mm.confidence < 0.65) {
        // Low-confidence Pass 1 with specialized acoustic cues (reverb/scream/short/off-screen)
        if ((cue.hasReverb || cue.hasDistortion) && vr >= 0.45 && (pitch >= 195 || (pitch > 0 && pitch <= 145))) {
          finalGender = pitch >= 195 ? 'FEMALE' : 'MALE';
          confidence = 0.76;
          resolvedSource = 'multimodal_verified';
          reason = `Underlying harmonic timbre beneath distortion (F0=${pitch}Hz -> ${finalGender})`;
        } else if (cue.isScreaming && pitch >= 245 && !hasScreamConfirm) {
          finalGender = 'FEMALE';
          confidence = 0.76;
          resolvedSource = 'multimodal_verified';
          reason = `Arousal-adjusted high female scream timbre (F0=${pitch}Hz -> FEMALE)`;
        } else if ((cue.isShortDuration || (durSec > 0 && durSec < 1.5)) && acGender !== 'UNKNOWN' && !cue.bgmSuspected) {
          finalGender = acGender;
          confidence = 0.76;
          resolvedSource = 'multimodal_verified';
          reason = `Short clip (${durSec.toFixed(2)}s) verified by clean acoustic timbre (${acGender}, F0=${pitch}Hz)`;
        } else if (cue.suspectedOffScreen && !cue.isScreaming && !cue.bgmSuspected && pitch > 0 && pitch <= 174 && /phone|compressed/i.test(mm.evidence || '')) {
          finalGender = 'MALE';
          confidence = 0.74;
          resolvedSource = 'multimodal_verified';
          reason = `Off-screen compressed phone audio formant timbre (F0=${pitch}Hz -> MALE)`;
        } else if (
          mm.confidence < 0.6 &&
          cue.acousticAmbiguous &&
          !cue.khmerText &&
          (cue.khmerPronoun === 'នាង' || cue.khmerPronoun === 'ខ្ញុំបាទ')
        ) {
          finalGender = cue.khmerPronoun === 'នាង' ? 'FEMALE' : 'MALE';
          confidence = 0.72;
          resolvedSource = 'multimodal_verified';
          reason = `Speaker change turn cue resolved ambiguous overlap (${cue.khmerPronoun} -> ${finalGender})`;
          if (/continuity/i.test(mm.evidence || '')) candidateName = '';
        }
      } else if (mm && !mm.isAmbiguous && mm.speakerGender !== 'UNKNOWN' && mm.confidence >= 0.62) {
        const isVisualStereotypeMismatch = Boolean(
          !cue.bgmSuspected &&
          !cue.isScreaming &&
          !hasScreamConfirm &&
          (acGender === 'MALE' || acGender === 'FEMALE') &&
          acGender !== mm.speakerGender &&
          vr >= 0.65 &&
          acC >= 0.84 &&
          iqr < 60 &&
          (visGender === mm.speakerGender || /boy|girl|character on screen|visible on screen/i.test(mm.evidence || ''))
        );
        const isContinuityBiasConflict = Boolean(
          (!mm.rechecked || (mm.confidence < 0.72 && !/scream|panick|shout|falsetto/i.test(mm.evidence || ''))) &&
          mm.confidence < 0.78 &&
          /continuity/i.test(mm.evidence || '') &&
          (acGender === 'MALE' || acGender === 'FEMALE') &&
          acGender !== mm.speakerGender &&
          acC >= 0.75
        );
        // Check severe clean-voice contradiction only when NOT already adjudicated by focused multimodal re-listening
        const cleanAudioContradiction = Boolean(
          !(mm.rechecked && mm.confidence >= 0.72) &&
          !cue.bgmSuspected &&
          vr >= 0.45 &&
          iqr < 42 &&
          acC >= 0.85 &&
          ((mm.speakerGender === 'MALE' && pitch >= 218) || (mm.speakerGender === 'FEMALE' && pitch > 0 && pitch <= 116))
        );

        if (isVisualStereotypeMismatch) {
          finalGender = acGender;
          confidence = Math.max(mm.confidence, acC);
          resolvedSource = 'multimodal_verified';
          voiceCharacterMismatch = true;
          reason = `Voice actor timbre (${acGender}, F0=${pitch}Hz) prioritized over visual character gender (${mm.speakerGender})`;
        } else if (isContinuityBiasConflict) {
          finalGender = acGender;
          confidence = acC;
          resolvedSource = 'multimodal_verified';
          candidateName = String(cue.speakerName && cue.speakerName !== mm.speakerName && !isPlaceholderSpeakerName(cue.speakerName) ? cue.speakerName : '');
          reason = `Speaker change detected via opposing acoustic timbre (${acGender}, F0=${pitch}Hz) overriding continuity`;
        } else if (cleanAudioContradiction) {
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
      const isPlaceholder = isPlaceholderSpeakerName(speakerName);
      const isEpisodic = isEpisodicRoleSpeakerName(speakerName);
      const characterGender = inferredCharGender !== 'UNKNOWN' ? inferredCharGender : finalGender;
      if (characterGender !== 'UNKNOWN' && finalGender !== 'UNKNOWN' && characterGender !== finalGender) {
        voiceCharacterMismatch = true;
      }

      // Mint distinct, consistent speakerId & characterId:
      // - Named recurring characters -> canonical series/character ID
      // - Generic broadcasts / episodic / crowd roles -> gender-qualified isolated ID so male/female instances never collide
      // - Unnamed voice-verified entities -> stable unnamed ID (`char_unnamed_<gender>_<hash>`) without inventing names
      // - Unresolved / ambiguous placeholders -> isolated spk_review_<cluster_or_cue> (NEVER merged by gender/pitch!)
      const voiceGenderConfidence = Number(
        (mm?.voiceGenderConfidence !== undefined
          ? mm.voiceGenderConfidence
          : (isVerified ? confidence : Math.min(confidence, 0.55))).toFixed(2)
      );
      const characterIdentityConfidence = Number(
        (mm?.characterIdentityConfidence !== undefined
          ? mm.characterIdentityConfidence
          : (seriesMatch ? Math.max(confidence, 0.85) : confidence)).toFixed(2)
      );
      const hasVerifiedName = Boolean(
        !isPlaceholder &&
        (seriesMatch || isGeneric || isEpisodic || (mm ? mm.hasVerifiedName !== false : Boolean(candidateName)))
      );
      const characterNameConfidence = Number(
        (hasVerifiedName
          ? (mm?.characterNameConfidence !== undefined ? mm.characterNameConfidence : (seriesMatch ? 0.92 : confidence))
          : (mm?.characterNameConfidence !== undefined ? Math.min(mm.characterNameConfidence, 0.5) : 0)).toFixed(2)
      );

      let speakerId;
      let characterId;
      if (seriesMatch && !isGeneric && !isPlaceholder && isVerified && seriesMatch.gender === finalGender) {
        speakerId = seriesMatch.speakerId;
        characterId = seriesMatch.characterId || buildCharacterId(seriesMatch.name, speakerId, { isGeneric: false, isEpisodic: false });
      } else if (isGeneric && isVerified) {
        const baseGen = getSpeakerId(speakerName).replace(/^spk_/, '');
        speakerId = `spk_${voiceGender}_${baseGen}`;
        characterId = buildCharacterId(speakerName, speakerId, { isGeneric: true, isEpisodic: true });
      } else if (!isGeneric && !isPlaceholder && isVerified && isEpisodic) {
        const baseRole = getSpeakerId(speakerName).replace(/^spk_/, '');
        speakerId = `spk_${voiceGender}_${baseRole}`;
        characterId = buildCharacterId(speakerName, speakerId, { isGeneric: false, isEpisodic: true });
      } else if (!isGeneric && !isPlaceholder && hasVerifiedName && characterNameConfidence >= 0.72 && isVerified) {
        speakerId = getSpeakerId(speakerName, voiceGender);
        characterId = buildCharacterId(speakerName, speakerId, { isGeneric: false, isEpisodic: false });
      } else if (isVerified) {
        const unnamedIds = buildStableUnnamedIds({
          gender: finalGender,
          unnamedEntityKey: mm?.unnamedEntityKey || cue.unnamedEntityKey || null,
          visualAppearance: mm?.visualAppearance || null,
          voiceTimbreDesc: mm?.voiceTimbreDesc || null,
          acousticClusterId: cue.acousticClusterId || null,
          sourceCueId: cue.sourceCueId,
        });
        speakerId = unnamedIds.speakerId;
        characterId = unnamedIds.characterId;
      } else if (cue.acousticClusterId) {
        speakerId = `spk_review_${cue.acousticClusterId}`;
        characterId = buildCharacterId(speakerName, speakerId, { isGeneric: true, isEpisodic: true });
      } else {
        speakerId = `spk_review_${cue.sourceCueId}`;
        characterId = buildCharacterId(speakerName, speakerId, { isGeneric: true, isEpisodic: true });
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
              characterId: buildCharacterId(tn, getSpeakerId(tn, tg.toLowerCase()), { isGeneric: isGenericSpeakerName(tn), isEpisodic: isEpisodicRoleSpeakerName(tn) }),
              speakerGender: tg,
              voiceId: tg === 'MALE' || tg === 'FEMALE' ? voiceForGender(tg) : null,
            };
          })
        : [];

      let groundTruthDisputed = false;
      let disputeReason = null;
      if (includeGroundTruthValidation && cue.groundTruthGender) {
        const gtGender = normalizeGenderToken(cue.groundTruthGender);
        if (gtGender !== 'UNKNOWN' && finalGender !== 'UNKNOWN') {
          gtTotal++;
          if (finalGender === gtGender) {
            gtBenchmarkCorrect++;
            gtAcousticCorrect++;
          } else if (acGender === finalGender || confidence >= 0.85) {
            groundTruthDisputed = true;
            dualAccuracyProvided = true;
            gtAcousticCorrect++;
            disputeReason = `Acoustic/multimodal evidence (${finalGender}, F0=${pitch}Hz) contradicts ground truth label (${gtGender})`;
          }
        }
      }

      const reviewNeeded = !isVerified || Boolean(cue.uncertainOcr);
      const visualAppearance = mm?.visualAppearance || seriesMatch?.visualAppearance || null;
      const voiceTimbreDesc = mm?.voiceTimbreDesc || seriesMatch?.voiceTimbreDesc || null;
      const aliases = Array.from(new Set([
        ...(!isPlaceholder ? [speakerName] : []),
        ...(mm?.chineseAlias ? [mm.chineseAlias] : []),
        ...(seriesMatch?.aliases || []),
      ].filter(Boolean)));
      const evidenceObj = {
        source: resolvedSource,
        audio: `f0=${cue.pitchHz || 0}Hz (${cue.acousticGender || 'unknown'}, conf=${cue.acousticConfidence || 0}, iqr=${cue.pitchIqr || 0}, cl=${cue.acousticClusterId || 'none'})`,
        visual: `faces=${visual ? visual.faceCount : (cue.visualGender ? 'ocr' : 'na')}, visGender=${cue.visualGender || 'unknown'}, shotCut=${Boolean(visual?.sceneCutFromPrev)}`,
        reason,
        location,
      };

      if (isVerified) {
        resolvedCount++;
        if (!isGeneric && !isPlaceholder && hasVerifiedName && !isUnnamedCharacterId(characterId) && !outCastMap.has(speakerId)) {
          outCastMap.set(speakerId, {
            id: speakerId,
            speakerId,
            characterId,
            seriesId: seriesId || null,
            name: speakerName,
            gender: voiceGender,
            speakerGender: finalGender,
            characterGender,
            voiceActorTimbre: finalGender,
            voiceId,
            khmerVoiceId: voiceId,
            voiceAssignmentSource: resolvedSource,
            recognitionConfidence: Number(confidence.toFixed(2)),
            voiceGenderConfidence,
            characterIdentityConfidence,
            characterNameConfidence,
            hasVerifiedName: true,
            recognitionEvidence: evidenceObj,
            visualAppearance,
            voiceTimbreDesc,
            aliases,
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
        characterId,
        speaker: speakerName,
        speakerName,
        speakerId,
        seriesId: seriesId || cue.seriesId || null,
        aliases,
        speakerGender: finalGender,
        characterGender,
        voiceActorTimbre: finalGender,
        ...(voiceCharacterMismatch ? { voiceCharacterMismatch: true } : {}),
        voiceGender,
        gender: voiceGender,
        confidence: Number(confidence.toFixed(2)),
        speakerConfidence: Number(confidence.toFixed(2)),
        recognitionConfidence: Number(confidence.toFixed(2)),
        genderConfidence: isVerified ? voiceGenderConfidence : null,
        voiceGenderConfidence,
        characterIdentityConfidence,
        characterNameConfidence,
        hasVerifiedName,
        ...(mm?.unnamedEntityKey ? { unnamedEntityKey: mm.unnamedEntityKey } : {}),
        ...(mm?.nameEvidence ? { nameEvidence: mm.nameEvidence } : {}),
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
        visualAppearance,
        voiceTimbreDesc,
        speakerEvidence: evidenceObj,
        recognitionEvidence: evidenceObj,
        ...(groundTruthDisputed ? { groundTruthDisputed: true, disputeReason } : {}),
        ...(internalTurns.length > 0 ? { internalSpeakerTurns: internalTurns, hasMultipleSpeakers: true } : {}),
      };
    });

    return {
      cues: finalCues,
      castRegistry: Array.from(outCastMap.values()),
      geminiCallsCount,
      ...(dualAccuracyProvided ? {
        dualAccuracyProvided: true,
        groundTruthValidation: {
          total: gtTotal,
          benchmarkAccuracy: gtTotal > 0 ? Number((gtBenchmarkCorrect / gtTotal).toFixed(4)) : null,
          acousticAdjustedAccuracy: gtTotal > 0 ? Number((gtAcousticCorrect / gtTotal).toFixed(4)) : null,
        },
      } : {}),
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
 * Extract verified recurring characters from a completed episode to merge into seriesSpeakerMap
 * so EP1 -> EP28 retain identical characterId, speakerId and voice across the series.
 * Strictly excludes placeholders ('តួអង្គ'), positional IDs ('spk_ocr_*'), and episodic crowd roles,
 * while keeping generic system IDs isolated under explicit gender-qualified speakerId keys only.
 */
function buildVerifiedSeriesSpeakerMapPatch(segments = [], speakerRegistry = {}, existingSeriesMap = {}, { seriesId = null } = {}) {
  const nextMap = {};
  for (const [k, v] of Object.entries(existingSeriesMap || {})) {
    if (!v || typeof v !== 'object') continue;
    const isExistingManual = Boolean(v.userOverridden || v.manualCharacterOverridden || v.voiceAssignmentSource === 'manual');
    if (seriesId && v.seriesId && String(v.seriesId) !== String(seriesId)) continue;
    const vName = String(v.speakerName || v.name || v.speaker || '').trim();
    const vId = String(v.speakerId || v.id || k || '').trim();
    const vCharId = String(v.characterId || '').trim();
    if (!vName || isPlaceholderSpeakerName(vName)) continue;
    if (!isExistingManual && (isUnnamedCharacterId(vId) || isUnnamedCharacterId(vCharId))) continue;
    if (!isExistingManual && (v.hasVerifiedName === false || (typeof v.characterNameConfidence === 'number' && v.characterNameConfidence < 0.72))) continue;
    if (isPositionalSpeakerId(vId) && !v.manualCharacterOverridden) continue;
    if (isGenericSpeakerName(vName) && !/^spk_(?:male|female)_/i.test(k) && !v.userOverridden) continue;
    nextMap[k] = seriesId && !v.seriesId ? { ...v, seriesId } : v;
  }

  const addVerified = (entry) => {
    if (!entry || typeof entry !== 'object') return;
    const isManual = Boolean(entry.userOverridden || entry.manualCharacterOverridden || entry.voiceAssignmentSource === 'manual' || entry.voiceOverride);
    if (seriesId && entry.seriesId && String(entry.seriesId) !== String(seriesId) && !isManual) return;
    const rawName = String(entry.speakerName || entry.name || entry.speaker || '').trim();
    if (!rawName || isPlaceholderSpeakerName(rawName) || isEpisodicRoleSpeakerName(rawName)) return;
    const spkIdRaw = String(entry.speakerId || entry.id || '').trim();
    const charIdRaw = String(entry.characterId || '').trim();
    if (!entry.manualCharacterOverridden && isPositionalSpeakerId(spkIdRaw)) return;
    if (!isManual && (spkIdRaw.startsWith('spk_unknown_') || isUnnamedCharacterId(spkIdRaw) || isUnnamedCharacterId(charIdRaw))) return;
    if (!isManual && (entry.hasVerifiedName === false || (typeof entry.characterNameConfidence === 'number' && entry.characterNameConfidence < 0.72))) return;

    const gender = normalizeGenderToken(entry.speakerGender || entry.voiceActorTimbre || entry.voiceGender || entry.gender);
    const hasVerifiedStatus = entry.speakerVerified === true || entry.speakerStatus === 'verified';
    const rawConf = entry.speakerConfidence ?? entry.recognitionConfidence ?? entry.voiceGenderConfidence ?? entry.genderConfidence;
    const effectiveConf = rawConf !== undefined && rawConf !== null
      ? Number(rawConf)
      : (hasVerifiedStatus ? 0.85 : 0);
    const isVerified = isManual || (
      gender !== 'UNKNOWN' &&
      !entry.speakerReviewNeeded &&
      !entry.unverifiedSpeaker &&
      entry.speakerStatus !== 'review_needed' &&
      effectiveConf >= 0.68
    );
    if (!isVerified) return;

    const isGeneric = isGenericSpeakerName(rawName);
    const cleanName = normalizeSpeakerName(rawName, gender.toLowerCase());
    if (isPlaceholderSpeakerName(cleanName)) return;

    const voiceId = entry.voiceOverride || entry.voiceId || entry.khmerVoiceId || voiceForGender(gender);
    const spkId = (spkIdRaw && !isPositionalSpeakerId(spkIdRaw))
      ? spkIdRaw
      : (isGeneric ? `spk_${gender.toLowerCase()}_${getSpeakerId(cleanName).replace(/^spk_/, '')}` : getSpeakerId(cleanName, gender.toLowerCase()));
    const charId = entry.characterId || buildCharacterId(cleanName, spkId, { isGeneric, isEpisodic: isGeneric });

    // Generic broadcasts must only persist under explicit gender-qualified speakerId, never bare name
    if (isGeneric && !/^spk_(?:male|female)_/i.test(spkId) && !isManual) return;

    const existing = nextMap[spkId] || (!isGeneric ? nextMap[cleanName] : null) || {};
    if (existing.userOverridden && !isManual) return;

    const record = {
      id: spkId,
      speakerId: spkId,
      characterId: charId,
      ...(seriesId ? { seriesId } : (existing.seriesId ? { seriesId: existing.seriesId } : {})),
      name: cleanName,
      speakerName: cleanName,
      khmerName: cleanName,
      gender: gender.toLowerCase(),
      speakerGender: gender,
      characterGender: normalizeGenderToken(entry.characterGender || existing.characterGender || gender),
      voiceActorTimbre: normalizeGenderToken(entry.voiceActorTimbre || existing.voiceActorTimbre || gender),
      voiceGender: gender.toLowerCase(),
      voiceId,
      khmerVoiceId: voiceId,
      recognitionConfidence: entry.recognitionConfidence ?? entry.speakerConfidence ?? existing.recognitionConfidence ?? (isManual ? 1.0 : effectiveConf),
      voiceGenderConfidence: entry.voiceGenderConfidence ?? existing.voiceGenderConfidence ?? null,
      characterIdentityConfidence: entry.characterIdentityConfidence ?? existing.characterIdentityConfidence ?? null,
      characterNameConfidence: isManual ? 1.0 : (entry.characterNameConfidence ?? existing.characterNameConfidence ?? null),
      hasVerifiedName: isManual || entry.hasVerifiedName !== false,
      recognitionEvidence: entry.recognitionEvidence || entry.speakerEvidence || existing.recognitionEvidence || null,
      visualAppearance: entry.visualAppearance || existing.visualAppearance || null,
      voiceTimbreDesc: entry.voiceTimbreDesc || existing.voiceTimbreDesc || null,
      voiceAssignmentSource: isManual ? 'manual' : (entry.voiceAssignmentSource || 'series_glossary'),
      userOverridden: isManual,
      manualCharacterOverridden: Boolean(entry.manualCharacterOverridden || existing.manualCharacterOverridden),
      aliases: Array.from(new Set([...(existing.aliases || []), ...(entry.aliases || []), cleanName, rawName].filter((a) => a && !isPlaceholderSpeakerName(a)))),
      updatedAt: Date.now(),
    };
    nextMap[spkId] = record;
    if (!isGeneric) {
      nextMap[cleanName] = record;
    }
  };

  Object.values(speakerRegistry || {}).forEach(addVerified);
  (segments || []).forEach(addVerified);
  return nextMap;
}

/**
 * Rescan characters on an existing episode or series while preserving:
 * - originalChineseText / chineseText
 * - khmerText / khmer translations
 * - immutable sourceCueId
 * - timeline positions (startSec, endSec, start, end, audioStartSec, audioEndSec)
 * - manual overrides (userOverridden / manualCharacterOverridden)
 * - existing TTS audio files whenever assigned voiceId remains unchanged
 */
async function rescanEpisodeOrSeriesCharacters({
  seriesMeta,
  episodeId = null,
  scope = 'episode',
  clearStaleRegistry = true,
  resolveVideoPath = null,
  apiKey = null,
  modelName = null,
  geminiGenerateFn = null,
  visualProbeFn = null,
  signal = null,
  onLog = null,
} = {}) {
  if (!seriesMeta || typeof seriesMeta !== 'object') {
    throw new Error('seriesMeta is required');
  }
  const seriesId = seriesMeta.id;
  const allEpisodes = Array.isArray(seriesMeta.episodes) ? seriesMeta.episodes : [];
  const normScope = String(scope || 'episode').toLowerCase() === 'series' ? 'series' : 'episode';

  const targetEpisodes = normScope === 'series'
    ? allEpisodes.filter((e) => Array.isArray(e?.scriptData?.segments || e?.scriptSegments) && (e?.scriptData?.segments || e?.scriptSegments).length > 0)
    : allEpisodes.filter((e) => String(e?.id) === String(episodeId));

  if (targetEpisodes.length === 0) {
    throw new Error(normScope === 'series' ? 'No episodes with segments to rescan' : `Episode not found or has no segments: ${episodeId}`);
  }

  // Keep ONLY explicit manual character-identity overrides in starting map when clearing stale auto-discovered memory
  let runningSeriesMap = {};
  if (clearStaleRegistry) {
    for (const [k, v] of Object.entries(seriesMeta.seriesSpeakerMap || {})) {
      if (v && typeof v === 'object' && v.manualCharacterOverridden === true) {
        runningSeriesMap[k] = { ...v, seriesId };
      }
    }
  } else {
    runningSeriesMap = { ...(seriesMeta.seriesSpeakerMap || {}) };
  }

  const manualGlossaryChars = Array.isArray(seriesMeta.glossary?.characters)
    ? seriesMeta.glossary.characters.filter((c) => c && c.manualCharacterOverridden === true)
    : [];

  const episodeResults = [];

  for (const ep of targetEpisodes) {
    const origSegments = ep.scriptData?.segments || ep.scriptSegments || [];
    if (origSegments.length === 0) continue;

    const rawVideoRef = ep.video?.videoPath || ep.sourceVideoPath || ep.videoPath || ep.videoFile || ep.videoFileName || '';
    const resolvedVideoPath = typeof resolveVideoPath === 'function' ? resolveVideoPath(rawVideoRef, ep) : rawVideoRef;

    const cleanInputCues = origSegments.map((seg, idx) => {
      const isManualChar = Boolean(seg.manualCharacterOverridden);
      const sourceCueId = String(seg.sourceCueId || `cue_${seg.id ?? idx + 1}`).trim();
      const chineseText = String(seg.originalChineseText || seg.chineseText || seg.textZh || seg.originalText || seg.original || seg.text || '').trim();
      if (isManualChar) {
        return {
          ...seg,
          sourceCueId,
          originalChineseText: chineseText,
          chineseText,
        };
      }
      // Strip prior auto-assigned speaker identity (and voice-only manual flags during rescan)
      // so stale character names never bypass fresh character discovery
      const {
        speaker: _oldSpk,
        speakerName: _oldSpkName,
        speakerId: _oldSpkId,
        characterId: _oldCharId,
        aliases: _oldAliases,
        speakerStatus: _oldStatus,
        voiceAssignmentSource: _oldSrc,
        userOverridden: _oldUserOvr,
        voiceOverride: _oldVoiceOvr,
        ...rest
      } = seg;
      return {
        ...rest,
        sourceCueId,
        originalChineseText: chineseText,
        chineseText,
        speaker: 'តួអង្គ',
        speakerName: 'តួអង្គ',
      };
    });

    if (resolvedVideoPath && fs.existsSync(resolvedVideoPath)) {
      await enrichCuesWithAcousticPitch(resolvedVideoPath, cleanInputCues, { signal });
    }

    const spkRes = await identifySpeakersForCues({
      cues: cleanInputCues,
      videoPath: resolvedVideoPath && fs.existsSync(resolvedVideoPath) ? resolvedVideoPath : null,
      apiKey,
      modelName,
      mode: ep.generationMode || ep.scriptData?.mode || 'dialogue',
      seriesId,
      episodeId: ep.id,
      seriesSpeakerMap: runningSeriesMap,
      castRegistry: clearStaleRegistry ? manualGlossaryChars : (seriesMeta.glossary?.characters || []),
      signal,
      geminiGenerateFn,
      visualProbeFn,
      onLog,
    });

    const scannedCues = Array.isArray(spkRes?.cues) && spkRes.cues.length === origSegments.length
      ? spkRes.cues
      : cleanInputCues;

    let changedVoiceCuesCount = 0;
    let preservedAudioCount = 0;

    const mergedSegments = origSegments.map((origSeg, idx) => {
      const freshCue = scannedCues[idx] || {};
      const isManualChar = Boolean(origSeg.manualCharacterOverridden);
      if (isManualChar) {
        if (origSeg.audioUrl || origSeg.audioPath) preservedAudioCount++;
        return origSeg;
      }

      const oldVoice = String(origSeg.voiceOverride || origSeg.khmerVoiceId || origSeg.voiceId || origSeg.voice || '').trim();
      const discoveredVoice = String(freshCue.khmerVoiceId || freshCue.voiceId || oldVoice || getDefaultVoiceForGender(freshCue.speakerGender)).trim();
      const nextVoice = origSeg.voiceOverride ? String(origSeg.voiceOverride).trim() : discoveredVoice;
      const voiceChanged = Boolean(oldVoice && nextVoice && oldVoice !== nextVoice);

      if (voiceChanged) {
        changedVoiceCuesCount++;
      } else if (origSeg.audioUrl || origSeg.audioPath) {
        preservedAudioCount++;
      }

      return {
        ...origSeg,
        sourceCueId: origSeg.sourceCueId || freshCue.sourceCueId,
        characterId: freshCue.characterId,
        speaker: freshCue.speaker || freshCue.speakerName || 'តួអង្គ',
        speakerName: freshCue.speakerName || freshCue.speaker || 'តួអង្គ',
        speakerId: freshCue.speakerId,
        seriesId,
        aliases: Array.isArray(freshCue.aliases) ? freshCue.aliases : [],
        speakerGender: freshCue.speakerGender,
        characterGender: freshCue.characterGender,
        voiceActorTimbre: freshCue.voiceActorTimbre || freshCue.speakerGender,
        voiceGender: freshCue.voiceGender,
        gender: freshCue.gender || freshCue.voiceGender,
        voiceId: nextVoice,
        khmerVoiceId: nextVoice,
        voice: nextVoice,
        confidence: freshCue.confidence,
        speakerConfidence: freshCue.speakerConfidence,
        recognitionConfidence: freshCue.recognitionConfidence,
        genderConfidence: freshCue.genderConfidence,
        voiceGenderConfidence: freshCue.voiceGenderConfidence,
        characterIdentityConfidence: freshCue.characterIdentityConfidence,
        characterNameConfidence: freshCue.characterNameConfidence,
        hasVerifiedName: freshCue.hasVerifiedName,
        ...(freshCue.unnamedEntityKey ? { unnamedEntityKey: freshCue.unnamedEntityKey } : {}),
        ...(freshCue.nameEvidence ? { nameEvidence: freshCue.nameEvidence } : {}),
        speakerVerified: freshCue.speakerVerified,
        speakerStatus: freshCue.speakerStatus,
        speakerReviewNeeded: freshCue.speakerReviewNeeded,
        reviewNeeded: freshCue.reviewNeeded,
        unverifiedSpeaker: freshCue.unverifiedSpeaker,
        voiceAssignmentSource: origSeg.voiceOverride ? 'manual' : freshCue.voiceAssignmentSource,
        userOverridden: Boolean(origSeg.voiceOverride && origSeg.userOverridden),
        manualCharacterOverridden: false,
        visualAppearance: freshCue.visualAppearance || null,
        voiceTimbreDesc: freshCue.voiceTimbreDesc || null,
        speakerEvidence: freshCue.speakerEvidence || null,
        recognitionEvidence: freshCue.recognitionEvidence || null,
        // Preserve subtitle & timeline fields strictly
        originalChineseText: origSeg.originalChineseText ?? origSeg.chineseText ?? origSeg.originalText,
        chineseText: origSeg.chineseText ?? origSeg.originalChineseText ?? origSeg.originalText,
        khmerText: origSeg.khmerText ?? origSeg.khmer,
        khmer: origSeg.khmer ?? origSeg.khmerText,
        startSec: origSeg.startSec,
        endSec: origSeg.endSec,
        start: origSeg.start,
        end: origSeg.end,
        duration: origSeg.duration,
        audioStartSec: origSeg.audioStartSec,
        audioEndSec: origSeg.audioEndSec,
        // Keep existing audio if voice did NOT change; invalidate ONLY when voice changed
        audioUrl: voiceChanged ? null : origSeg.audioUrl,
        audioPath: voiceChanged ? null : origSeg.audioPath,
        audioDurationSec: voiceChanged ? null : origSeg.audioDurationSec,
        audioOutdated: voiceChanged ? true : Boolean(origSeg.audioOutdated),
        ttsStatus: voiceChanged ? 'outdated' : origSeg.ttsStatus,
      };
    });

    const { buildSpeakerRegistry } = require('../../models/speakerRegistry');
    const updatedRegistry = buildSpeakerRegistry(mergedSegments, {});
    runningSeriesMap = buildVerifiedSeriesSpeakerMapPatch(mergedSegments, updatedRegistry, runningSeriesMap, { seriesId });

    episodeResults.push({
      episodeId: ep.id,
      segments: mergedSegments,
      speakerRegistry: updatedRegistry,
      changedVoiceCuesCount,
      preservedAudioCount,
      hasAudioOutdated: changedVoiceCuesCount > 0,
      stats: spkRes?.stats || null,
      castCount: Object.keys(updatedRegistry).length,
      geminiCallsCount: Number(spkRes?.geminiCallsCount || 0),
    });
  }

  return {
    scope: normScope,
    seriesId,
    episodeResults,
    seriesSpeakerMap: runningSeriesMap,
  };
}

module.exports = {
  identifySpeakersForCues,
  buildVerifiedSeriesSpeakerMapPatch,
  rescanEpisodeOrSeriesCharacters,
  normalizeCharacterAliasKey,
  isDeterministicSystemCue,
  isSystemOrBroadcastLikeText,
  findSuspectCuesForFocusedRecheck,
  CHARACTER_RECOGNITION_VERSION,
  computeSeriesRegistryRevision,
  isUnnamedCharacterId,
};
