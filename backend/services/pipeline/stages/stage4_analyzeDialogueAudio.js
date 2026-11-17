const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { extractAudio } = require('../../ffmpegService');
const { classifySegmentAcousticGender, computeYinPitch } = require('../../audioClassifierService');
const { senseVoiceSemaphore, createAbortError } = require('../../../utils/asyncSemaphore');
const { resolvePythonBinary } = require('../../audioSeparationService');

function sleepOrAbortStage4(ms, signal) {
  if (!signal) {
    return new Promise((r) => setTimeout(r, ms));
  }
  if (signal.aborted) {
    return Promise.reject(createAbortError('Stage 4 ASR aborted'));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(createAbortError('Stage 4 ASR aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function killChildTree(child) {
  if (!child) return;
  try {
    if (process.platform === 'win32' && child.pid) {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
    }
    child.kill('SIGTERM');
  } catch (_) {}
}

/**
 * Runs local SenseVoice-Small ASR worker in Python via Sherpa-ONNX
 */
function runSenseVoiceWorker({
  workerPath,
  audioPath,
  modelDir,
  startOffsetSec = 0,
  numThreads = 2,
  vadThreads = 1,
  signal = null,
}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(createAbortError('SenseVoice worker aborted before start'));
    }

    // Portable discovery shared with Demucs: PYTHON_BIN -> .venv -> per-user installs -> PATH
    const pythonExe = resolvePythonBinary();
    const args = [
      workerPath,
      '--audio', audioPath,
      '--model_dir', modelDir,
      '--start_offset', String(startOffsetSec),
      '--num_threads', String(numThreads),
      '--vad_threads', String(vadThreads),
    ];

    const child = spawn(pythonExe, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let settled = false;
    let stdoutData = '';
    let stderrData = '';

    const onAbort = () => {
      killChildTree(child);
      if (!settled) {
        settled = true;
        reject(createAbortError('SenseVoice worker aborted by user'));
      }
    };

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
    const cleanupSignal = () => {
      if (signal) {
        try { signal.removeEventListener('abort', onAbort); } catch (_) {}
      }
    };

    child.stdout.on('data', (d) => {
      stdoutData += d.toString('utf8');
    });

    child.stderr.on('data', (d) => {
      stderrData += d.toString('utf8');
    });

    child.on('error', (err) => {
      cleanupSignal();
      if (settled) return;
      settled = true;
      if (signal?.aborted) {
        return reject(createAbortError('SenseVoice worker aborted by user'));
      }
      reject(err);
    });

    child.on('close', (code) => {
      cleanupSignal();
      if (settled) return;
      settled = true;
      if (signal?.aborted) {
        return reject(createAbortError('SenseVoice worker aborted by user'));
      }
      if (code !== 0) {
        return reject(new Error(`SenseVoice worker exited with code ${code}: ${stderrData || stdoutData}`));
      }
      try {
        const parsed = JSON.parse(stdoutData.trim());
        if (parsed.status === 'success') {
          resolve(parsed);
        } else {
          reject(new Error(parsed.message || 'SenseVoice worker returned error status'));
        }
      } catch (parseErr) {
        reject(new Error(`Failed to parse SenseVoice JSON: ${parseErr.message}. Output was: ${stdoutData.substring(0, 150)}`));
      }
    });
  });
}

function getAudioCachePath(videoPath, startOffsetSec, durationSec, modelName) {
  try {
    const stat = fs.statSync(videoPath);
    const hash = crypto.createHash('md5')
      .update(`${videoPath}_${stat.size}_${stat.mtimeMs}_${startOffsetSec}_${durationSec}_${modelName}`)
      .digest('hex');
    const cacheDir = path.join(__dirname, '../../../uploads/cache');
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    return path.join(cacheDir, `asr_${hash}.json`);
  } catch (_) {
    return null;
  }
}

function parseOffsetToSeconds(offsetStr) {
  if (!offsetStr) return 0;
  return parseFloat(String(offsetStr).replace('s', '')) || 0;
}

function containsChineseCharacters(text = '') {
  return /[\u3400-\u4dbf\u4e00-\u9fa5]/.test(String(text || ''));
}

function filterValidChineseAsrSegments(segments = []) {
  if (!Array.isArray(segments)) return [];
  return segments.filter((s) =>
    containsChineseCharacters(s?.spokenChineseText || s?.chineseText || s?.text || '')
  );
}

function safelyParseSpeechSegments(rawText) {
  if (!rawText) return [];
  const clean = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  // 1. Direct standard parse
  try {
    const parsed = JSON.parse(clean);
    if (Array.isArray(parsed.speechSegments)) return parsed.speechSegments;
    if (Array.isArray(parsed)) return parsed;
  } catch (_) {}

  // 2. Repair cut-off JSON array (when output tokens limit truncated JSON)
  const lastCloseBrace = clean.lastIndexOf('}');
  if (lastCloseBrace !== -1) {
    const repaired = clean.substring(0, lastCloseBrace + 1) + '\n]}';
    try {
      const parsed = JSON.parse(repaired);
      if (Array.isArray(parsed.speechSegments)) return parsed.speechSegments;
      if (Array.isArray(parsed)) return parsed;
    } catch (_) {}
  }

  // 3. Fallback: Extract every complete { ... } segment using regex
  const segmentRegex = /\{[^{}]*"startSec"\s*:\s*([0-9.]+)[^{}]*"endSec"\s*:\s*([0-9.]+)[^{}]*"spokenChineseText"\s*:\s*"([^"]+)"[^{}]*\}/g;
  const recovered = [];
  let match;
  while ((match = segmentRegex.exec(clean)) !== null) {
    try {
      const obj = JSON.parse(match[0]);
      if (obj.spokenChineseText && typeof obj.startSec === 'number') {
        recovered.push(obj);
      }
    } catch (_) {}
  }

  if (recovered.length > 0) {
    console.log(`[Stage 4 Analyze Audio] Safely recovered ${recovered.length} speech segments from truncated response.`);
    return recovered;
  }

  return [];
}

/**
 * Stage 4: Analyze Dialogue Audio
 * First-Class Chinese Speech-to-Text (ASR) & Diarization engine.
 * Works even when NO on-screen subtitles exist.
 * 
 * 1. Primary: gemini-3.5-transcribe with speaker diarization & word-level timestamps.
 * 2. Fallback: Multimodal Gemini cascade (gemini-3.5-flash-lite, gemini-3.8-flash, gemini-3.5-flash).
 * 3. Acoustic Pitch (YIN algorithm) verification for speaker gender identification.
 * 
 * @param {object} params
 * @param {string} params.videoPath
 * @param {number} params.durationSec
 * @param {object} params.aiClient
 * @param {string} [params.modelName='gemini-3.5-flash-lite']
 * @param {number} [params.startOffsetSec=0]
 * @returns {Promise<{ audioSegments: Array, audioMeta: object }>}
 */
function normalizeSegmentGenderAndSpeaker(seg) {
  const f0 = Number(seg.acousticF0 || seg.pitchHz || 0);
  const conf = Number(seg.acousticConfidence || seg.genderConfidence || 0);

  const isStrongFemale = f0 >= 175 && conf >= 0.58;
  const isStrongMale = f0 > 0 && f0 <= 150 && conf >= 0.58;

  if (isStrongFemale) {
    seg.audioGender = 'female';
    seg.acousticGender = 'female';
  } else if (isStrongMale) {
    seg.audioGender = 'male';
    seg.acousticGender = 'male';
  } else if (!seg.audioGender || seg.audioGender === 'unknown') {
    if (seg.acousticGender && seg.acousticGender !== 'unknown') {
      seg.audioGender = seg.acousticGender;
    }
  }

  const normGender = (seg.audioGender === 'female' || seg.audioGender === 'male')
    ? seg.audioGender
    : 'unknown';
  const baseSpk = (!seg.speakerId || seg.speakerId === 'spk_1') ? 'spk' : seg.speakerId;
  if (!baseSpk.endsWith(`_${normGender}`) && normGender !== 'unknown') {
    seg.speakerId = `${baseSpk}_${normGender}`;
  }
  return seg;
}

async function analyzeDialogueAudio({
  videoPath,
  durationSec,
  aiClient,
  modelName = 'gemini-3.5-flash-lite',
  startOffsetSec = 0,
  signal = null,
}) {
  const checkAbort = () => {
    if (signal?.aborted) {
      throw createAbortError('Stage 4 ASR aborted');
    }
  };

  checkAbort();

  if (!videoPath || !fs.existsSync(videoPath)) {
    throw new Error(`[Stage 4 Analyze Audio] Video file not found: ${videoPath}`);
  }

  const cachePath = getAudioCachePath(videoPath, startOffsetSec, durationSec, modelName);
  if (cachePath && fs.existsSync(cachePath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      if (cached && Array.isArray(cached.audioSegments) && cached.audioSegments.length > 0) {
        const beforeCount = cached.audioSegments.length;
        cached.audioSegments = filterValidChineseAsrSegments(cached.audioSegments).map(normalizeSegmentGenderAndSpeaker);
        const droppedFromCache = beforeCount - cached.audioSegments.length;
        if (droppedFromCache > 0) {
          console.log(`[Stage 4 ASR] 🧹 Filtered ${droppedFromCache} non-Chinese hallucination(s) from ASR cache (${path.basename(cachePath)})`);
          cached.audioMeta = {
            ...(cached.audioMeta || {}),
            speechSegmentsDetected: cached.audioSegments.length,
          };
        }
        if (cached.audioSegments.length > 0 || droppedFromCache > 0) {
          console.log(`[Stage 4 ASR] ⚡ Cache Hit: Reusing & normalizing ${cached.audioSegments.length} speech segments (${path.basename(cachePath)})`);
          return cached;
        }
      }
    } catch (_) {}
  }

  const tempDir = path.join(os.tmpdir(), `audio_dia_${Date.now()}_${process.pid}`);
  fs.mkdirSync(tempDir, { recursive: true });
  const audioFilePath = path.join(tempDir, 'extracted_audio.mp3');

  const audioSegments = [];
  let asrEngineUsed = 'none';

  try {
    checkAbort();
    // 1. Extract audio chunk with FFmpeg
    await extractAudio(videoPath, audioFilePath, {
      startSec: startOffsetSec,
      durationSec: durationSec > 0 ? durationSec : undefined,
      signal,
    });

    if (!fs.existsSync(audioFilePath) || fs.statSync(audioFilePath).size < 1000) {
      console.warn('[Stage 4 Analyze Audio] No audio track available in video file.');
      return { audioSegments: [], audioMeta: { hasAudio: false, speechSegmentsDetected: 0 } };
    }

    checkAbort();

    // ==============================================================
    // STEP 1.5: PRIMARY ENGINE -> Local SenseVoice-Small ASR (Sherpa-ONNX)
    // Bounded via senseVoiceSemaphore to prevent ONNX CPU oversubscription
    // ==============================================================
    const pythonWorkerPath = path.resolve(__dirname, '../../../workers/sense_voice_worker.py');
    const senseVoiceModelDir = path.resolve(__dirname, '../../../models/sense-voice');

    if (fs.existsSync(pythonWorkerPath) && fs.existsSync(path.join(senseVoiceModelDir, 'tokens.txt'))) {
      try {
        console.log(`[Stage 4 Analyze Audio] 🚀 Running Local SenseVoice-Small ASR (offset: ${startOffsetSec}s)...`);
        const localRes = await senseVoiceSemaphore.run(
          () => runSenseVoiceWorker({
            workerPath: pythonWorkerPath,
            audioPath: audioFilePath,
            modelDir: senseVoiceModelDir,
            startOffsetSec,
            numThreads: 2,
            vadThreads: 1,
            signal,
          }),
          { signal }
        );

        if (localRes && Array.isArray(localRes.speechSegments) && localRes.speechSegments.length > 0) {
          const validChineseSegs = filterValidChineseAsrSegments(localRes.speechSegments);
          const droppedNonChinese = localRes.speechSegments.length - validChineseSegs.length;
          if (droppedNonChinese > 0) {
            console.log(`[Stage 4 Analyze Audio] 🧹 Filtered ${droppedNonChinese} non-Chinese SenseVoice hallucination(s) (keeping ${validChineseSegs.length} Chinese speech segments).`);
          }
          for (const s of validChineseSegs) {
            audioSegments.push(s);
          }
          if (audioSegments.length > 0) {
            asrEngineUsed = 'sense-voice-small-onnx';
            console.log(`[Stage 4 Analyze Audio] ⚡ Local SenseVoice succeeded with ${audioSegments.length} Chinese speech segments ($0.00 API cost)!`);
          }
        }
      } catch (senseVoiceErr) {
        if (senseVoiceErr?.name === 'AbortError' || signal?.aborted) {
          throw senseVoiceErr?.name === 'AbortError' ? senseVoiceErr : createAbortError('Stage 4 ASR aborted');
        }
        console.warn(`[Stage 4 Analyze Audio] Local SenseVoice notice: ${senseVoiceErr.message}. Falling back to Cloud Gemini ASR.`);
      }
    }

    checkAbort();

    // ==============================================================
    // STEP 2: FALLBACK ENGINE -> Cloud Gemini ASR (if local not used)
    // ==============================================================
    if (audioSegments.length === 0 && aiClient) {
      const audioBuffer = fs.readFileSync(audioFilePath);
      const isUnder20MB = audioBuffer.length < 20 * 1024 * 1024;
      let audioPart;
      let uploadedFile = null;

      if (isUnder20MB) {
        audioPart = {
          inlineData: {
            mimeType: 'audio/mp3',
            data: audioBuffer.toString('base64'),
          },
        };
      } else {
        uploadedFile = await aiClient.files.upload({
          file: audioFilePath,
          mimeType: 'audio/mp3',
        });
        audioPart = {
          fileData: {
            fileUri: uploadedFile.uri,
            mimeType: 'audio/mp3',
          },
        };
      }

      // ==============================================================
      // STEP 2A: PRIMARY ENGINE -> gemini-3.5-transcribe
      // Modern Interactions API for Native Audio Speech-to-Text
      // ==============================================================
      let transcribeSuccess = false;
      try {
        console.log(`[Stage 4 Analyze Audio] Calling primary ASR engine 'gemini-3.5-transcribe' via interactions.create (offset: ${startOffsetSec}s)...`);
        
        let audioInput;
        if (uploadedFile?.uri) {
          audioInput = {
            type: 'audio',
            uri: uploadedFile.uri,
            mime_type: 'audio/mp3',
          };
        } else {
          audioInput = {
            type: 'audio',
            data: audioBuffer.toString('base64'),
            mime_type: 'audio/mp3',
          };
        }

        let resp;
        if (aiClient.interactions && typeof aiClient.interactions.create === 'function') {
          resp = await aiClient.interactions.create({
            model: 'gemini-3.5-transcribe',
            input: [
              {
                type: 'text',
                text: 'Transcribe this audio verbatim in original Chinese with exact timestamps and speaker identification in JSON format.',
              },
              audioInput,
            ],
            response_format: {
              type: 'json',
              schema: {
                type: 'object',
                properties: {
                  speechSegments: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        startSec: { type: 'number' },
                        endSec: { type: 'number' },
                        spokenChineseText: { type: 'string' },
                        speakerId: { type: 'string' },
                        gender: { type: 'string' },
                      },
                      required: ['startSec', 'endSec', 'spokenChineseText'],
                    },
                  },
                },
              },
            },
          });
        } else {
          throw new Error('Interactions API not available on aiClient instance');
        }

        const rawText = resp?.output_text || 
          (typeof resp?.text === 'function' ? resp.text() : resp?.text) ||
          (Array.isArray(resp?.outputs) ? JSON.stringify(resp.outputs) : '');

        const segs = safelyParseSpeechSegments(rawText);
        for (const s of segs) {
          const localStart = typeof s.startSec === 'number' ? parseFloat(s.startSec.toFixed(2)) : parseOffsetToSeconds(s.startSec);
          const localEnd = typeof s.endSec === 'number' ? parseFloat(s.endSec.toFixed(2)) : (localStart + 2.0);
          if (localEnd > localStart && containsChineseCharacters(s.spokenChineseText)) {
            const globalStart = parseFloat((startOffsetSec + localStart).toFixed(2));
            const globalEnd = parseFloat((startOffsetSec + localEnd).toFixed(2));
            audioSegments.push({
              startSec: globalStart,
              endSec: globalEnd,
              duration: parseFloat((globalEnd - globalStart).toFixed(2)),
              sourceStartSec: globalStart,
              sourceEndSec: globalEnd,
              spokenChineseText: s.spokenChineseText.trim(),
              audioGender: s.gender || 'unknown',
              speakerId: s.speakerId || 'spk_1',
              audioConfidence: typeof s.confidence === 'number' ? s.confidence : 0.95,
              source: 'audio_asr',
              evidenceSource: 'audio_asr',
            });
          }
        }

        if (audioSegments.length > 0) {
          transcribeSuccess = true;
          asrEngineUsed = 'gemini-3.5-transcribe';
          console.log(`[Stage 4 Analyze Audio] gemini-3.5-transcribe succeeded with ${audioSegments.length} Chinese speech segments.`);
        } else {
          console.log(`[Stage 4 Analyze Audio] gemini-3.5-transcribe returned 0 segments.`);
        }
      } catch (transcribeErr) {
        if (transcribeErr?.name === 'AbortError' || signal?.aborted) {
          throw transcribeErr?.name === 'AbortError' ? transcribeErr : createAbortError('Stage 4 ASR aborted');
        }
        // Critical: Do NOT mask authentication, permission, or quota errors
        const errMsg = transcribeErr?.message || String(transcribeErr);
        const errLower = errMsg.toLowerCase();
        if (
          errLower.includes('api_key') ||
          errLower.includes('unauthenticated') ||
          errLower.includes('permission_denied') ||
          errLower.includes('403 forbidden') ||
          errLower.includes('401 unauthorized') ||
          errLower.includes('billing')
        ) {
          console.error(`[Stage 4 Analyze Audio] ❌ Fatal API Key / Permission Error in Stage 4:`, errMsg);
          throw transcribeErr;
        }

        console.warn(`[Stage 4 Analyze Audio] gemini-3.5-transcribe interaction notice (${errMsg}), attempting single fallback to multimodal model...`);
      }

      // ==============================================================
      // STEP 2B: SINGLE FALLBACK -> Multimodal Gemini Audio
      // (Used once if transcribe encounters quota/availability error)
      // ==============================================================
      if (!transcribeSuccess && audioSegments.length === 0) {
        const fallbackModel = (modelName && modelName !== 'gemini-3.5-transcribe') ? modelName : 'gemini-3.5-flash-lite';
        console.log(`[Stage 4 Analyze Audio] Activating single fallback to multimodal model '${fallbackModel}'...`);
        const audioPrompt = `
You are an expert Audio Speech-to-Text & Diarization engine for Chinese video dialogue (Modern, Romance, Action, Period, Comedy, etc.).
Listen to this audio track carefully.

TASK:
1. Transcribe spoken Chinese dialogue words with timestamps relative to this audio clip (where 0.0s is clip start).
2. STRICT RULE: DO NOT transcribe background music, songs, singing lyrics, sound effects, or silence. If someone is singing an OST or theme song, IGNORE IT. Only transcribe real spoken dialogue between characters.
3. For each spoken dialogue line:
   - "startSec": when speech starts
   - "endSec": when speech finishes
   - "spokenChineseText": exact Chinese words spoken
   - "gender": "male" | "female" | "unknown"
   - "confidence": confidence score from 0.0 to 1.0

Return JSON ONLY matching this schema:
{
  "speechSegments": [
    {
      "startSec": 10.1,
      "endSec": 12.5,
      "spokenChineseText": "请问今天还有什么具体的安排吗",
      "gender": "male",
      "confidence": 0.95
    }
  ]
}
`;
        let fallbackResp = null;
        let attempt = 0;
        let lastFallbackErr = null;
        while (attempt < 2 && !fallbackResp) {
          checkAbort();
          try {
            fallbackResp = await aiClient.models.generateContent({
              model: fallbackModel,
              contents: [
                audioPart,
                { text: audioPrompt },
              ],
              config: {
                temperature: 0.1,
                responseMimeType: 'application/json',
              },
            });
            asrEngineUsed = fallbackModel;
          } catch (callErr) {
            if (callErr?.name === 'AbortError' || signal?.aborted) {
              throw callErr?.name === 'AbortError' ? callErr : createAbortError('Stage 4 ASR aborted');
            }
            lastFallbackErr = callErr;
            attempt++;
            const errMsg = callErr?.message || String(callErr);
            const errLower = errMsg.toLowerCase();
            if (
              errLower.includes('api_key') ||
              errLower.includes('unauthenticated') ||
              errLower.includes('permission_denied') ||
              errLower.includes('403 forbidden') ||
              errLower.includes('401 unauthorized')
            ) {
              console.error(`[Stage 4 Analyze Audio] ❌ Fatal API Key / Permission Error during fallback:`, errMsg);
              throw callErr;
            }
            if (attempt >= 2) break;
            await sleepOrAbortStage4(1500, signal);
          }
        }

        if (!fallbackResp && lastFallbackErr) {
          console.warn(`[Stage 4 Analyze Audio] Fallback ASR model '${fallbackModel}' error:`, lastFallbackErr.message);
        }

        const rawText = typeof fallbackResp?.text === 'function' ? fallbackResp.text() : fallbackResp?.text;
        if (rawText) {
          const segs = safelyParseSpeechSegments(rawText);
          for (const s of segs) {
            const localStart = typeof s.startSec === 'number' ? parseFloat(s.startSec.toFixed(2)) : 0;
            const localEnd = typeof s.endSec === 'number' ? parseFloat(s.endSec.toFixed(2)) : localStart + 2.0;
            if (localEnd > localStart && containsChineseCharacters(s.spokenChineseText)) {
              const globalStart = parseFloat((startOffsetSec + localStart).toFixed(2));
              const globalEnd = parseFloat((startOffsetSec + localEnd).toFixed(2));
              audioSegments.push({
                startSec: globalStart,
                endSec: globalEnd,
                duration: parseFloat((globalEnd - globalStart).toFixed(2)),
                sourceStartSec: globalStart,
                sourceEndSec: globalEnd,
                spokenChineseText: s.spokenChineseText.trim(),
                audioGender: s.gender || 'unknown',
                speakerId: 'spk_1',
                audioConfidence: typeof s.confidence === 'number' ? s.confidence : 0.85,
                source: 'audio_asr',
                evidenceSource: 'audio_asr',
              });
            }
          }
        }
      }

      if (uploadedFile?.name) {
        try {
          await aiClient.files.delete({ name: uploadedFile.name });
        } catch (_) {}
      }
    }

    // ==============================================================
    // STEP 3: HIGH-SPEED ACOUSTIC PITCH (F0) & GENDER CLASSIFICATION
    // Decodes audio chunk into raw PCM ONCE, then runs in-memory YIN
    // without spawning hundreds of ffmpeg sub-processes!
    // ==============================================================
    if (audioSegments.length > 0 && fs.existsSync(audioFilePath)) {
      checkAbort();
      try {
        const pcmPath = path.join(tempDir, 'chunk_raw.pcm');
        const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
        const ffmpegBin = ffmpegInstaller.path;

        await new Promise((resolvePcm, rejectPcm) => {
          if (signal?.aborted) {
            return rejectPcm(createAbortError('Stage 4 PCM decode aborted'));
          }
          let settled = false;
          const proc = spawn(ffmpegBin, [
            '-y',
            '-threads', '2',
            '-i', audioFilePath,
            '-f', 's16le',
            '-ac', '1',
            '-ar', '16000',
            pcmPath,
          ], { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] });

          const onAbort = () => {
            killChildTree(proc);
            if (!settled) {
              settled = true;
              rejectPcm(createAbortError('Stage 4 PCM decode aborted'));
            }
          };
          if (signal) signal.addEventListener('abort', onAbort, { once: true });
          const detach = () => {
            if (signal) {
              try { signal.removeEventListener('abort', onAbort); } catch (_) {}
            }
          };

          proc.on('close', () => {
            detach();
            if (settled) return;
            settled = true;
            if (signal?.aborted) return rejectPcm(createAbortError('Stage 4 PCM decode aborted'));
            resolvePcm();
          });
          proc.on('error', () => {
            detach();
            if (settled) return;
            settled = true;
            if (signal?.aborted) return rejectPcm(createAbortError('Stage 4 PCM decode aborted'));
            resolvePcm();
          });
        });

        if (fs.existsSync(pcmPath)) {
          const pcmBuf = fs.readFileSync(pcmPath);
          const pcmData = new Int16Array(pcmBuf.buffer, pcmBuf.byteOffset, Math.floor(pcmBuf.length / 2));

          for (const seg of audioSegments) {
            const localStart = Math.max(0, seg.startSec - startOffsetSec);
            const startSample = Math.floor(localStart * 16000);
            const endSample = Math.min(pcmData.length, Math.floor((localStart + seg.duration) * 16000));

            if (endSample > startSample + 1024) {
              const slice = pcmData.subarray(startSample, endSample);
              const acoustic = computeYinPitch(slice, 16000);
              if (acoustic && acoustic.confidence >= 0.5) {
                seg.acousticF0 = acoustic.f0;
                seg.acousticGender = acoustic.gender;
                seg.acousticConfidence = acoustic.confidence;

                // បើ YIN Pitch មានភាពជាក់លាក់ខ្ពស់ (F0 >= 175Hz សម្រាប់ស្រី ឬ <= 150Hz សម្រាប់ប្រុស)
                // ត្រូវយកភេទសំឡេងពិតពី Acoustic ជាធំ ដើម្បីកែតម្រូវករណី AI ទាយភេទខុស!
                const isStrongFemalePitch = acoustic.gender === 'female' && acoustic.f0 >= 175 && acoustic.confidence >= 0.58;
                const isStrongMalePitch = acoustic.gender === 'male' && acoustic.f0 > 0 && acoustic.f0 <= 150 && acoustic.confidence >= 0.58;

                if (!seg.audioGender || seg.audioGender === 'unknown' || isStrongFemalePitch || isStrongMalePitch) {
                  seg.audioGender = acoustic.gender;
                }
              }
            }

            // បំបែក speakerId តាមភេទ ដើម្បីកុំឱ្យតួប្រុស និងតួស្រីប្រើ 'spk_1' រួមគ្នាដាច់ខាត!
            const normGender = (seg.audioGender === 'female' || seg.audioGender === 'male')
              ? seg.audioGender
              : 'unknown';
            const baseSpk = (!seg.speakerId || seg.speakerId === 'spk_1') ? 'spk' : seg.speakerId;
            if (!baseSpk.endsWith(`_${normGender}`) && normGender !== 'unknown') {
              seg.speakerId = `${baseSpk}_${normGender}`;
            }
          }
        }
      } catch (yinErr) {
        if (yinErr?.name === 'AbortError' || signal?.aborted) {
          throw yinErr?.name === 'AbortError' ? yinErr : createAbortError('Stage 4 ASR aborted');
        }
        console.warn('[Stage 4 Analyze Audio] Fast PCM YIN notice:', yinErr.message);
      }
    }
  } finally {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (_) {}
  }

  // Sort chronologically
  audioSegments.sort((a, b) => a.startSec - b.startSec);

  const result = {
    audioSegments,
    audioMeta: {
      hasAudio: true,
      speechSegmentsDetected: audioSegments.length,
      startOffsetSec,
      durationSec,
      asrEngineUsed,
    },
  };

  if (cachePath && audioSegments.length > 0) {
    try {
      fs.writeFileSync(cachePath, JSON.stringify(result, null, 2), 'utf8');
      console.log(`[Stage 4 ASR] 💾 Cached ${audioSegments.length} speech segments to ${path.basename(cachePath)}`);
    } catch (_) {}
  }

  return result;
}

module.exports = {
  analyzeDialogueAudio,
  safelyParseSpeechSegments,
  containsChineseCharacters,
  filterValidChineseAsrSegments,
  normalizeSegmentGenderAndSpeaker,
};
