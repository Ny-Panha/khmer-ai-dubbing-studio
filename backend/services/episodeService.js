const fs = require('fs');
const path = require('path');
const {
  getNextAvailableEpisodeNumber,
  generateUniqueEpisodeId,
  createEpisode,
  getSegmentIdentityKeys,
  getVideoClipIdentity,
  sanitizeSeriesEpisodes,
} = require('../models/episodeModel');

const { uploadsDir: UPLOADS_DIR } = require('../utils/pathUtils');
const {
  stripLogoSettingsFromObject,
  VIDEO_EDIT_SETTING_KEYS,
  normalizeVideoEditSettings,
  areVideoEditSettingsEqual,
  readGlobalVideoEditSettings,
  writeGlobalVideoEditSettings,
} = require('./globalLogoSettingsService');
const PROJECTS_DIR = path.join(UPLOADS_DIR, 'projects');

// In-memory concurrency locks per series to serialize all read-modify-write operations on series.json
const seriesCreationLocks = new Map();

// In-memory cache for series metadata to prevent event loop freezes on multi-megabyte JSON
const seriesMetadataCache = new Map();

// Track episodes recovered via hydration so each episode is logged once per recovery cycle
const loggedHydratedEpisodes = new Set();

function resolveLatestCompletedJobForEpisode(epJobsDir) {
  if (!epJobsDir || !fs.existsSync(epJobsDir)) return null;
  const files = fs
    .readdirSync(epJobsDir)
    .filter((f) => f.endsWith('.json') && !f.includes('.checkpoints.') && !f.includes('.segments.'));
  const candidates = [];
  for (const jFile of files) {
    try {
      const jobJson = JSON.parse(fs.readFileSync(path.join(epJobsDir, jFile), 'utf8'));
      const segs = Array.isArray(jobJson?.finalResult?.segments)
        ? jobJson.finalResult.segments
        : (Array.isArray(jobJson?.finalResult?.script) ? jobJson.finalResult.script : null);
      if (jobJson?.status === 'completed' && Array.isArray(segs) && segs.length > 0) {
        const sortTs = Number(jobJson.completedAt || jobJson.updatedAt || jobJson.createdAt || 0);
        candidates.push({ jFile, jobJson, segs, sortTs });
      }
    } catch (_) { }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    if (b.sortTs !== a.sortTs) return b.sortTs - a.sortTs;
    return b.jFile.localeCompare(a.jFile);
  });
  return candidates[0];
}

/**
 * Atomic JSON file write (temp file in same dir + rename with Windows copy fallback)
 * to prevent half-written or corrupted series.json under concurrent job updates.
 */
function atomicWriteSeriesJson(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const tempPath = path.join(
    dir,
    `.tmp_${path.basename(filePath)}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
  );

  fs.writeFileSync(tempPath, JSON.stringify(data), 'utf8');

  try {
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch (_) { }
    }
    fs.renameSync(tempPath, filePath);
  } catch (renameErr) {
    try {
      fs.copyFileSync(tempPath, filePath);
      fs.unlinkSync(tempPath);
    } catch (copyErr) {
      if (fs.existsSync(tempPath)) {
        try { fs.unlinkSync(tempPath); } catch (_) { }
      }
      throw copyErr;
    }
  }
}

function sanitizeProjectName(name) {
  if (!name) return 'drama_project';
  return String(name)
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[\uD800-\uDFFF]/g, '')
    .replace(/[/\\?%*:|"<>~#&!$;^{}`]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .trim() || 'drama_project';
}

function sanitizeEpisodeId(id) {
  if (!id) return 'ep_1';
  return String(id)
    .replace(/[/\\?%*:|"<>~#&!$;^{}`\s]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .trim() || 'ep_1';
}

/**
 * Ensures isolated physical directory structure exists for an episode
 */
function ensureEpisodeDirectories(seriesId, episodeId) {
  const cleanSeries = sanitizeProjectName(seriesId);
  const cleanEp = sanitizeEpisodeId(episodeId);

  const seriesDir = path.join(PROJECTS_DIR, cleanSeries);
  const episodeDir = path.join(seriesDir, 'episodes', cleanEp);
  const videoDir = path.join(episodeDir, 'video');
  const audioDir = path.join(episodeDir, 'audio');
  const subDir = path.join(episodeDir, 'subtitles');

  if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir, { recursive: true });
  if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });
  if (!fs.existsSync(subDir)) fs.mkdirSync(subDir, { recursive: true });

  return {
    seriesDir,
    episodeDir,
    videoDir,
    audioDir,
    subDir,
    cleanSeries,
    cleanEpisode: cleanEp,
  };
}

function buildSeriesCacheKey(cleanSeries, projectsDir = PROJECTS_DIR) {
  return projectsDir === PROJECTS_DIR ? cleanSeries : `${projectsDir}::${cleanSeries}`;
}

function getSeriesLockKey(cleanSeries, projectsDir = PROJECTS_DIR) {
  return projectsDir === PROJECTS_DIR ? cleanSeries : `${projectsDir}::${cleanSeries}`;
}

function sanitizeRenderedVideoRef(renderedVideo, { checkDisk = false, uploadsDir = UPLOADS_DIR } = {}) {
  if (!renderedVideo) return null;
  const refs = typeof renderedVideo === 'string'
    ? [renderedVideo]
    : [
      renderedVideo.outputVideoUrl,
      renderedVideo.videoUrl,
      renderedVideo.downloadUrl,
      renderedVideo.outputFilename,
    ];
  const hasMockRef = refs.some(
    (ref) => typeof ref === 'string' && /(?:^|\/|\\)mock_(?:render|16-9|9-16|1-1)/i.test(ref.trim())
  );
  if (hasMockRef) return null;

  if (typeof renderedVideo === 'string') {
    const cleanStr = renderedVideo.trim();
    if (!cleanStr) return null;
    if (checkDisk && cleanStr.startsWith('/uploads/')) {
      const rel = cleanStr.slice('/uploads/'.length).split('?')[0];
      const abs = path.resolve(uploadsDir, rel);
      const relFromUploads = path.relative(path.resolve(uploadsDir), abs);
      if (relFromUploads.startsWith('..') || path.isAbsolute(relFromUploads) || !fs.existsSync(abs)) {
        return null;
      }
    }
    return renderedVideo;
  }

  const localUrl = renderedVideo.outputVideoUrl || renderedVideo.videoUrl || '';
  if (!localUrl && !renderedVideo.downloadUrl) return null;
  if (checkDisk && typeof localUrl === 'string' && localUrl.startsWith('/uploads/')) {
    const rel = localUrl.slice('/uploads/'.length).split('?')[0];
    const abs = path.resolve(uploadsDir, rel);
    const relFromUploads = path.relative(path.resolve(uploadsDir), abs);
    if (relFromUploads.startsWith('..') || path.isAbsolute(relFromUploads) || !fs.existsSync(abs)) {
      return null;
    }
  }
  return renderedVideo;
}

function applySafeDiskHydration(ep, cleanSeries, seriesDir, resolvedProjectsDir = PROJECTS_DIR) {
  let mutated = false;
  if (!ep || !ep.id) return false;

  if (ep.renderedVideo) {
    const validRv = sanitizeRenderedVideoRef(ep.renderedVideo, {
      checkDisk: resolvedProjectsDir === PROJECTS_DIR,
      uploadsDir: UPLOADS_DIR,
    });
    if (!validRv) {
      ep.renderedVideo = null;
      if (ep.status === 'completed') {
        ep.status = (ep.audioGenerated && !ep.audioOutdated)
          ? 'voicing'
          : ((ep.scriptData?.segments?.length > 0) ? 'translated' : (ep.video ? 'uploaded' : 'idle'));
      }
      mutated = true;
    }
  }

  // 0. Video Hydration Check: Auto-detect existing video files on disk if ep.video is missing or incomplete,
  // or if ep.video points to an uncut source video when a specific chunk exists
  const epVideoDir = path.join(seriesDir, 'episodes', ep.id, 'video');
  if (fs.existsSync(epVideoDir)) {
    try {
      const vFiles = fs.readdirSync(epVideoDir).filter((f) => f.endsWith('.mp4') && !f.startsWith('.tmp'));
      if (vFiles.length > 0) {
        // Specific episode chunk file (e.g. series_*_ep_1_source.mp4 or *chunk*) has highest priority
        const specificChunkFile = vFiles.find((f) => f.includes(`_${ep.id}_`) || f.includes('chunk_source'));
        const vFile = specificChunkFile || vFiles.find((f) => f.includes('source')) || vFiles[0];
        const vPath = path.join(epVideoDir, vFile);

        const currentPath = ep.video?.videoPath || ep.sourceVideoPath;
        const currentMatchesDisk = currentPath && fs.existsSync(currentPath);
        const shouldUpgradeToSpecificChunk = specificChunkFile && (!currentMatchesDisk || (currentPath && !currentPath.includes(`_${ep.id}_`) && !currentPath.includes('chunk_source')));

        if (!currentMatchesDisk || shouldUpgradeToSpecificChunk) {
          const vStat = fs.statSync(vPath);
          if (vStat.size > 0) {
            const vUrl = `/uploads/projects/${cleanSeries}/episodes/${ep.id}/video/${vFile}`;
            ep.video = {
              ...(ep.video || {}),
              videoId: `projects/${cleanSeries}/episodes/${ep.id}/video/${vFile}`,
              fileName: vFile,
              originalFilename: vFile,
              displayTitle: ep.displayTitle || ep.title || `Episode ${ep.episodeNumber || ep.id}`,
              videoUrl: vUrl,
              videoPath: vPath,
              sizeMB: parseFloat((vStat.size / (1024 * 1024)).toFixed(2)),
              size: (vStat.size / (1024 * 1024)).toFixed(1) + ' MB',
            };
            ep.videoFile = vUrl;
            ep.sourceVideoPath = vPath;
            if (!ep.status || ep.status === 'idle') {
              ep.status = 'uploaded';
            }
            mutated = true;
          }
        }
      }
    } catch (_) { }
  }

  // 1. Hydration Check: Auto-recover scriptData from completed jobs on disk if missing
  if (
    !ep.scriptData?.explicitClear &&
    (!ep.scriptData || !Array.isArray(ep.scriptData.segments) || ep.scriptData.segments.length === 0)
  ) {
    const epJobsDir = path.join(seriesDir, 'episodes', ep.id, 'jobs');
    const recoveredJob = resolveLatestCompletedJobForEpisode(epJobsDir);
    if (recoveredJob) {
      const { jobJson, segs, jFile } = recoveredJob;
      const fr = jobJson.finalResult || {};
      const resolvedGenMode = fr.generationMode || jobJson.config?.generationMode || ep.generationMode || jobJson.mode || 'dialogue';
      ep.scriptData = {
        mode: fr.mode || jobJson.config?.mode || jobJson.mode || 'dialogue',
        generationMode: resolvedGenMode,
        genre: fr.genre || jobJson.config?.genre || jobJson.genre || 'auto',
        ...(fr.detectedGenre ? { detectedGenre: fr.detectedGenre } : {}),
        ...(fr.summary ? { summary: fr.summary } : {}),
        ...(Array.isArray(fr.speakers) ? { speakers: fr.speakers } : {}),
        ...(fr.speakerRegistry ? { speakerRegistry: fr.speakerRegistry } : {}),
        segments: segs,
        hasScript: true,
        totalSegments: segs.length,
        updatedAt: jobJson.completedAt || Date.now(),
      };
      if (!ep.generationMode) {
        ep.generationMode = resolvedGenMode;
      }
      if (ep.status === 'uploaded' || !ep.status) {
        ep.status = 'translated';
      }
      mutated = true;
      const hydrateKey = `${resolvedProjectsDir}::${cleanSeries}:${ep.id}`;
      if (!loggedHydratedEpisodes.has(hydrateKey)) {
        loggedHydratedEpisodes.add(hydrateKey);
        console.log(`[Hydration] Recovered ${segs.length} segments for ${cleanSeries}/${ep.id} from completed job ${jobJson.jobId || jFile}`);
      }
    }
  }

  // 2. Ensure hasScript and totalSegments metadata match stored segments count
  if (ep.scriptData && Array.isArray(ep.scriptData.segments) && ep.scriptData.segments.length > 0) {
    if (!ep.scriptData.hasScript || ep.scriptData.totalSegments !== ep.scriptData.segments.length) {
      ep.scriptData.hasScript = true;
      ep.scriptData.totalSegments = ep.scriptData.segments.length;
      if (ep.status === 'uploaded' || !ep.status) {
        ep.status = 'translated';
      }
      mutated = true;
    }
  }

  // 3. Audio Hydration Check: Auto-detect existing master narration on disk (unless episode/segments marked audioOutdated)
  const narrationFilename = `${ep.id}_narration_khmer.mp3`;
  const narrationPath = path.join(seriesDir, 'episodes', ep.id, 'audio', narrationFilename);
  const hasOutdatedAudioState = Boolean(ep.audioOutdated) || Boolean(
    ep.scriptData &&
    Array.isArray(ep.scriptData.segments) &&
    ep.scriptData.segments.some((s) => {
      if (!s || s.ttsStatus === 'empty_text') return false;
      const txt = String(s.khmer || s.khmerText || s.khmerTranslatedText || s.text || '').trim();
      if (!txt) return false;
      return Boolean(s.audioOutdated || s.ttsStatus === 'outdated');
    })
  );
  if (!hasOutdatedAudioState && fs.existsSync(narrationPath)) {
    const relAudioUrl = `/uploads/projects/${cleanSeries}/episodes/${ep.id}/audio/${narrationFilename}`;
    if (!ep.audioGenerated || ep.fullAudioUrl !== relAudioUrl) {
      ep.audioGenerated = true;
      ep.fullAudioUrl = relAudioUrl;
      ep.fullAudioPath = narrationPath;
      ep.hasAudio = true;
      mutated = true;
    }
  }

  // 4. Segment Audio Auto-Hydration: Auto-detect existing segment mp3 files on disk (matching voiceId cleanly)
  const epAudioDir = path.join(seriesDir, 'episodes', ep.id, 'audio');
  if (fs.existsSync(epAudioDir) && ep.scriptData && Array.isArray(ep.scriptData.segments) && ep.scriptData.segments.length > 0) {
    try {
      const audioFiles = fs.readdirSync(epAudioDir).filter((f) => f.endsWith('.mp3') && !f.includes('_narration_khmer') && !f.startsWith('.tmp'));
      let hydratedCount = 0;
      if (audioFiles.length > 0) {
        const filesBySegId = new Map();
        for (const f of audioFiles) {
          const m = f.match(/seg_(\d+)_/);
          if (m && m[1]) {
            const sidKey = String(m[1]);
            if (!filesBySegId.has(sidKey)) filesBySegId.set(sidKey, []);
            filesBySegId.get(sidKey).push(f);
          }
        }

        const pickNewestFile = (candidates = []) => {
          if (candidates.length === 0) return null;
          if (candidates.length === 1) return candidates[0];
          let best = candidates[candidates.length - 1];
          let bestMtime = -1;
          for (const fname of candidates) {
            try {
              const st = fs.statSync(path.join(epAudioDir, fname));
              if (st.mtimeMs >= bestMtime) {
                bestMtime = st.mtimeMs;
                best = fname;
              }
            } catch (_) { }
          }
          return best;
        };

        for (const seg of ep.scriptData.segments) {
          if (seg.audioOutdated || seg.ttsStatus === 'outdated') continue;
          const sid = String(seg.segmentId || seg.id || '');
          if (!sid) continue;
          const candidates = filesBySegId.get(sid) || [];
          if (candidates.length === 0) continue;

          const segVoiceHint = String(
            seg.voiceOverride ||
            seg.voiceId ||
            seg.khmerVoiceId ||
            seg.voice ||
            (seg.voiceGender === 'female' ? 'km-KH-SreymomNeural' : (seg.voiceGender === 'male' ? 'km-KH-PisethNeural' : ''))
          ).trim();
          const expectedVoice = segVoiceHint.includes('Sreymom')
            ? 'km-KH-SreymomNeural'
            : (segVoiceHint.includes('Piseth') ? 'km-KH-PisethNeural' : '');

          let matchedFile = null;
          if (expectedVoice) {
            const voiceMatched = candidates.filter((f) => f.includes(expectedVoice));
            if (voiceMatched.length > 0) {
              matchedFile = pickNewestFile(voiceMatched);
            } else {
              // Legacy filename without embedded neural voice name only (never cross-wire Sreymom <-> Piseth)
              const voiceAgnostic = candidates.filter((f) => !f.includes('Sreymom') && !f.includes('Piseth'));
              matchedFile = pickNewestFile(voiceAgnostic);
            }
          } else {
            matchedFile = pickNewestFile(candidates);
          }

          if (matchedFile) {
            const fullSegAudioPath = path.join(epAudioDir, matchedFile);
            const relSegAudioUrl = `/uploads/projects/${cleanSeries}/episodes/${ep.id}/audio/${matchedFile}`;
            if (!seg.audioUrl || !seg.audioPath || seg.ttsStatus !== 'ready' || seg.audioFileMissing) {
              seg.audioPath = fullSegAudioPath;
              seg.audioUrl = relSegAudioUrl;
              seg.audioFile = matchedFile;
              seg.ttsStatus = 'ready';
              seg.audioGenerated = true;
              delete seg.audioFileMissing;
              hydratedCount++;
              mutated = true;
            }
          }
        }
      }

      // 4b. Verify existing segment audio references actually exist on disk so missing files are never reported healthy
      for (const seg of ep.scriptData.segments) {
        if (!seg) continue;
        const hasRef = Boolean(seg.audioUrl || seg.audioPath || seg.audioFile);
        if (!hasRef) {
          if (seg.audioFileMissing) {
            delete seg.audioFileMissing;
            mutated = true;
          }
          continue;
        }
        let resolvedSegPath = null;
        if (seg.audioPath && typeof seg.audioPath === 'string' && fs.existsSync(seg.audioPath)) {
          resolvedSegPath = seg.audioPath;
        } else if (typeof seg.audioUrl === 'string' && seg.audioUrl.startsWith('/uploads/')) {
          const rel = seg.audioUrl.slice('/uploads/'.length).split('?')[0];
          const candidate = path.resolve(UPLOADS_DIR, rel);
          const relFromUploads = path.relative(path.resolve(UPLOADS_DIR), candidate);
          if (!relFromUploads.startsWith('..') && !path.isAbsolute(relFromUploads) && fs.existsSync(candidate)) {
            resolvedSegPath = candidate;
          }
        } else if (seg.audioFile && typeof seg.audioFile === 'string') {
          const candidate = path.join(epAudioDir, path.basename(seg.audioFile));
          if (fs.existsSync(candidate)) {
            resolvedSegPath = candidate;
          }
        }

        const existsValid = Boolean(resolvedSegPath && fs.statSync(resolvedSegPath).size > 0);
        if (!existsValid) {
          if (!seg.audioFileMissing) {
            seg.audioFileMissing = true;
            mutated = true;
          }
        } else if (seg.audioFileMissing) {
          delete seg.audioFileMissing;
          mutated = true;
        }
      }

      if (hydratedCount > 0 && !hasOutdatedAudioState) {
        const allValidSegsReady = ep.scriptData.segments.every((s) => {
          const txt = String(s.khmer || s.khmerText || s.khmerTranslatedText || '').trim();
          if (!txt) return true;
          return !s.audioOutdated && s.ttsStatus !== 'outdated' && !s.audioFileMissing && Boolean(s.audioUrl || s.audioPath);
        });
        if (allValidSegsReady && (!ep.audioGenerated || !ep.hasAudio)) {
          ep.audioGenerated = true;
          ep.hasAudio = true;
          mutated = true;
        }
      }
    } catch (_) { }
  }

  return mutated;
}

/**
 * Load series metadata file (series.json) with in-memory caching and mtime+size checks
 */
function getSeriesMetadata(seriesId, options = {}) {
  const cleanSeries = sanitizeProjectName(seriesId);
  const projectsDir = options.projectsDir || PROJECTS_DIR;
  const cacheKey = buildSeriesCacheKey(cleanSeries, projectsDir);
  const lockKey = getSeriesLockKey(cleanSeries, projectsDir);
  const seriesDir = path.join(projectsDir, cleanSeries);
  const metaPath = path.join(seriesDir, 'series.json');

  if (fs.existsSync(metaPath)) {
    try {
      const stat = fs.statSync(metaPath);
      const cached = seriesMetadataCache.get(cacheKey);
      // Fast path: return in-memory cached object if file mtime & size haven't changed
      if (
        cached &&
        cached.mtimeMs === stat.mtimeMs &&
        cached.size === stat.size &&
        !options.forceDisk
      ) {
        return cached.data;
      }

      const data = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      const sanitized = sanitizeSeriesEpisodes(data);

      let needsSave = false;
      if (!Array.isArray(sanitized.episodes)) {
        sanitized.episodes = [];
      }

      // Safe episode discovery & disk hydration (skipped when caller only mutates single-segment metadata)
      if (!options.skipHydration) {
      const epBaseDir = path.join(seriesDir, 'episodes');
      if (fs.existsSync(epBaseDir)) {
        try {
          const entries = fs.readdirSync(epBaseDir, { withFileTypes: true })
            .filter((ent) => ent.isDirectory())
            .sort((a, b) => {
              const matchA = a.name.match(/^ep_(\d+)/i);
              const matchB = b.name.match(/^ep_(\d+)/i);
              const numA = matchA ? parseInt(matchA[1], 10) : Number.MAX_SAFE_INTEGER;
              const numB = matchB ? parseInt(matchB[1], 10) : Number.MAX_SAFE_INTEGER;
              if (numA !== numB) return numA - numB;
              return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
            });

          for (const ent of entries) {
            const alreadyExists = sanitized.episodes.some(
              (e) => String(e.id).toLowerCase() === ent.name.toLowerCase()
            );
            if (!alreadyExists) {
              const epNumMatch = ent.name.match(/^ep_(\d+)/i);
              const epNum = epNumMatch ? parseInt(epNumMatch[1], 10) : sanitized.episodes.length + 1;
              const discoveredEp = createEpisode({
                id: ent.name,
                episodeNumber: epNum,
                title: `ភាគទី ${epNum} (EP${epNum})`,
              });
              sanitized.episodes.push(discoveredEp);
              needsSave = true;
            }
          }
        } catch (_) { }
      }

      if (Array.isArray(sanitized.episodes)) {
        for (let i = 0; i < sanitized.episodes.length; i++) {
          const ep = sanitized.episodes[i];
          const rawEp = data.episodes?.[i];
          if (rawEp?.scriptData?.segments?.length !== ep.scriptData?.segments?.length) {
            needsSave = true;
          }
          if (applySafeDiskHydration(ep, cleanSeries, seriesDir, projectsDir)) {
            needsSave = true;
          }
        }
      }
      }

      if (needsSave && !seriesCreationLocks.has(lockKey)) {
        try {
          // Guard against clobbering a concurrent writer that modified series.json while we read/hydrated
          const preWriteStat = fs.statSync(metaPath);
          let payloadToWrite = sanitized;
          if (preWriteStat.mtimeMs !== stat.mtimeMs || preWriteStat.size !== stat.size) {
            const latestDisk = sanitizeSeriesEpisodes(JSON.parse(fs.readFileSync(metaPath, 'utf8')));
            if (Array.isArray(latestDisk.episodes)) {
              for (const ep of latestDisk.episodes) {
                applySafeDiskHydration(ep, cleanSeries, seriesDir, projectsDir);
              }
            }
            payloadToWrite = latestDisk;
          }
          atomicWriteSeriesJson(metaPath, payloadToWrite);
          const updatedStat = fs.statSync(metaPath);
          seriesMetadataCache.set(cacheKey, {
            data: payloadToWrite,
            mtimeMs: updatedStat.mtimeMs,
            size: updatedStat.size,
            lastCheckTime: Date.now(),
          });
          return payloadToWrite;
        } catch (_) { }
      }

      seriesMetadataCache.set(cacheKey, {
        data: sanitized,
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        lastCheckTime: Date.now(),
      });
      return sanitized;
    } catch (_) { }
  }

  // Fallback: directory exists but has no valid series.json.
  // Only return fallback metadata if the directory contains real media content
  // (video or audio files). Empty/test directories without media are ghosts
  // that should NOT be surfaced as valid series.
  const epBaseDir = path.join(seriesDir, 'episodes');
  let hasRealMedia = false;
  if (fs.existsSync(epBaseDir)) {
    try {
      const epEntries = fs.readdirSync(epBaseDir, { withFileTypes: true }).filter((e) => e.isDirectory());
      for (const ent of epEntries) {
        const vidDir = path.join(epBaseDir, ent.name, 'video');
        const audioDir = path.join(epBaseDir, ent.name, 'audio');
        if (
          (fs.existsSync(vidDir) && fs.readdirSync(vidDir).some((f) => /\.(mp4|mkv|avi|webm|mov)$/i.test(f))) ||
          (fs.existsSync(audioDir) && fs.readdirSync(audioDir).some((f) => /\.(mp3|wav|m4a|ogg)$/i.test(f)))
        ) {
          hasRealMedia = true;
          break;
        }
      }
    } catch (_) {}
  }

  if (!hasRealMedia) {
    // Ghost directory: no series.json and no real media — do not fabricate metadata
    return null;
  }

  // Real orphaned media found: discover episodes for recovery
  const discoveredEpisodes = [];
  if (fs.existsSync(epBaseDir)) {
    try {
      const entries = fs.readdirSync(epBaseDir, { withFileTypes: true })
        .filter((ent) => ent.isDirectory())
        .sort((a, b) => {
          const matchA = a.name.match(/^ep_(\d+)/i);
          const matchB = b.name.match(/^ep_(\d+)/i);
          const numA = matchA ? parseInt(matchA[1], 10) : Number.MAX_SAFE_INTEGER;
          const numB = matchB ? parseInt(matchB[1], 10) : Number.MAX_SAFE_INTEGER;
          if (numA !== numB) return numA - numB;
          return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
        });
      for (const ent of entries) {
        const epNumMatch = ent.name.match(/^ep_(\d+)/i);
        const epNum = epNumMatch ? parseInt(epNumMatch[1], 10) : discoveredEpisodes.length + 1;
        const discoveredEp = createEpisode({
          id: ent.name,
          episodeNumber: epNum,
          title: `ភាគទី ${epNum} (EP${epNum})`,
        });
        applySafeDiskHydration(discoveredEp, cleanSeries, seriesDir, projectsDir);
        discoveredEpisodes.push(discoveredEp);
      }
    } catch (_) { }
  }

  const fallbackData = {
    id: cleanSeries,
    title: 'រឿងភាគ (Series 1)',
    createdAt: Date.now(),
    glossary: { characters: [], terms: [] },
    episodes: discoveredEpisodes.length > 0 ? discoveredEpisodes : [createEpisode({ episodeNumber: 1 })],
  };
  seriesMetadataCache.set(cacheKey, { data: fallbackData, mtimeMs: 0, size: 0, lastCheckTime: Date.now() });
  return fallbackData;
}

/**
 * Save series metadata to series.json (Atomic write + Compact JSON + cache update)
 */
function saveSeriesMetadata(series, options = {}) {
  if (!series || !series.id) return false;
  const cleanSeries = sanitizeProjectName(series.id);
  const projectsDir = options.projectsDir || PROJECTS_DIR;
  const cacheKey = buildSeriesCacheKey(cleanSeries, projectsDir);
  const seriesDir = path.join(projectsDir, cleanSeries);
  if (!fs.existsSync(seriesDir)) fs.mkdirSync(seriesDir, { recursive: true });

  const sanitized = options.skipSanitize ? series : sanitizeSeriesEpisodes(series);
  const metaPath = path.join(seriesDir, 'series.json');
  atomicWriteSeriesJson(metaPath, sanitized);
  try {
    const stat = fs.statSync(metaPath);
    seriesMetadataCache.set(cacheKey, {
      data: sanitized,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      lastCheckTime: Date.now(),
    });
  } catch (_) {
    seriesMetadataCache.set(cacheKey, {
      data: sanitized,
      mtimeMs: Date.now(),
      size: 0,
      lastCheckTime: Date.now(),
    });
  }
  return sanitized;
}

/**
 * Concurrency-safe read-modify-write helper for series.json.
 * Forces fresh disk read immediately before executing synchronous mutator,
 * preventing concurrent pipeline jobs from clobbering sibling episodes.
 *
 * @param {string} seriesId
 * @param {Function} mutatorFn - (freshSeries) => boolean|void|object (return false to skip write)
 */
function updateSeriesMetadata(seriesId, mutatorFn, options = {}) {
  if (!seriesId || typeof mutatorFn !== 'function') return false;
  const cleanSeries = sanitizeProjectName(seriesId);
  const freshSeries = getSeriesMetadata(cleanSeries, { ...options, forceDisk: !options.useStatCache });
  if (!freshSeries) return false;

  const outcome = mutatorFn(freshSeries);
  if (outcome === false) {
    return freshSeries;
  }

  const nextSeries = (outcome && typeof outcome === 'object' && outcome.id) ? outcome : freshSeries;
  return saveSeriesMetadata(nextSeries, options);
}

/**
 * Queued async mutex per series for all async read-modify-write operations on series.json.
 */
async function withSeriesMetadataLock(seriesId, taskFn, options = {}) {
  const cleanSeries = sanitizeProjectName(seriesId);
  const projectsDir = options.projectsDir || PROJECTS_DIR;
  const lockKey = getSeriesLockKey(cleanSeries, projectsDir);
  const prevTail = seriesCreationLocks.get(lockKey) || Promise.resolve();
  const resultPromise = prevTail.then(() => taskFn());
  const tailPromise = resultPromise.then(() => undefined, () => undefined);
  seriesCreationLocks.set(lockKey, tailPromise);
  try {
    return await resultPromise;
  } finally {
    if (seriesCreationLocks.get(lockKey) === tailPromise) {
      seriesCreationLocks.delete(lockKey);
    }
  }
}

/**
 * Persist completed pipeline scriptData to series.json under the per-series mutex,
 * verify the exact episodeId written matches expected job IDs, and immediately re-read
 * series.json from disk to confirm segments length on disk matches finalResult count.
 * Never swallows errors; logs loud [Persist] ERROR with both IDs on any mismatch.
 */
async function persistEpisodeScriptData({
  seriesId,
  episodeId,
  expectedSeriesId = null,
  expectedEpisodeId = null,
  scriptData,
  generationMode = null,
  status = 'translated',
  seriesGenre = null,
  seriesDetectedGenre = null,
  seriesSpeakerMap = null,
  jobId = null,
  projectsDir = PROJECTS_DIR,
  _afterWriteHook = null,
}) {
  if (!seriesId || !episodeId) {
    const errMsg = `[Persist] ERROR: Missing required identifier(s) seriesId=${seriesId}, episodeId=${episodeId}, expectedSeriesId=${expectedSeriesId}, expectedEpisodeId=${expectedEpisodeId}, jobId=${jobId || 'n/a'}`;
    console.error(errMsg);
    const err = new Error(errMsg);
    err.nonRetryable = true;
    throw err;
  }

  const cleanSeries = sanitizeProjectName(seriesId);
  const cleanEpisode = sanitizeEpisodeId(episodeId);

  if (expectedSeriesId != null && sanitizeProjectName(expectedSeriesId) !== cleanSeries) {
    const errMsg = `[Persist] ERROR: Series ID mismatch! expectedSeriesId=${expectedSeriesId}, actualSeriesId=${seriesId}, episodeId=${episodeId}, jobId=${jobId || 'n/a'}`;
    console.error(errMsg);
    const err = new Error(errMsg);
    err.nonRetryable = true;
    throw err;
  }

  if (expectedEpisodeId != null && sanitizeEpisodeId(expectedEpisodeId) !== cleanEpisode) {
    const errMsg = `[Persist] ERROR: Episode ID mismatch! seriesId=${seriesId}, expectedEpisodeId=${expectedEpisodeId}, actualEpisodeId=${episodeId}, jobId=${jobId || 'n/a'}`;
    console.error(errMsg);
    const err = new Error(errMsg);
    err.nonRetryable = true;
    throw err;
  }

  const incomingSegments = Array.isArray(scriptData?.segments)
    ? scriptData.segments
    : (Array.isArray(scriptData?.script) ? scriptData.script : []);

  return await withSeriesMetadataLock(cleanSeries, async () => {
    const seriesDir = path.join(projectsDir, cleanSeries);
    const metaPath = path.join(seriesDir, 'series.json');
    const diskExists = fs.existsSync(metaPath);

    const freshSeries = getSeriesMetadata(cleanSeries, { forceDisk: true, projectsDir });
    if (!freshSeries || !Array.isArray(freshSeries.episodes)) {
      const errMsg = `[Persist] ERROR: Unable to load series metadata! seriesId=${cleanSeries}, episodeId=${cleanEpisode}, jobId=${jobId || 'n/a'}`;
      console.error(errMsg);
      const err = new Error(errMsg);
      err.nonRetryable = true;
      throw err;
    }

    const targetEp = freshSeries.episodes.find(
      (e) => sanitizeEpisodeId(e.id) === cleanEpisode || String(e.id) === String(episodeId)
    );

    if (!targetEp) {
      const availableIds = freshSeries.episodes.map((e) => e.id).join(', ');
      const errMsg = `[Persist] ERROR: Target episode not found in series.json (diskExists=${diskExists})! seriesId=${cleanSeries}, episodeId=${cleanEpisode}, expectedEpisodeId=${expectedEpisodeId || episodeId}, jobId=${jobId || 'n/a'}, availableEpisodes=[${availableIds}]`;
      console.error(errMsg);
      const err = new Error(errMsg);
      err.nonRetryable = true;
      throw err;
    }

    const { script: _droppedDupScript, ...restScriptData } =
      (scriptData && typeof scriptData === 'object') ? scriptData : {};
    const resolvedMode = restScriptData.mode || 'dialogue';
    const resolvedGenMode =
      generationMode || restScriptData.generationMode || targetEp.generationMode || resolvedMode;
    const hasAnyVoicedSegment = incomingSegments.some(
      (seg) =>
        seg &&
        typeof seg === 'object' &&
        Boolean(seg.audioUrl || seg.audioPath || seg.audioFile) &&
        seg.audioGenerated !== false
    );
    const hadPriorAudio = Boolean(
      targetEp.audioGenerated ||
      targetEp.hasAudio ||
      targetEp.fullAudioUrl ||
      targetEp.fullAudioPath ||
      targetEp.audioOutdated
    );

    targetEp.scriptData = {
      ...restScriptData,
      mode: resolvedMode,
      generationMode: resolvedGenMode,
      segments: incomingSegments,
      hasScript: incomingSegments.length > 0,
      totalSegments: incomingSegments.length,
      updatedAt: Date.now(),
    };
    targetEp.generationMode = resolvedGenMode;
    // Reset obsolete deletion tombstones from previous scripts when saving a fresh full episode script
    targetEp.deletedSegmentKeys = [];
    if (incomingSegments.length > 0) {
      targetEp.status = status || 'translated';
      if (!hasAnyVoicedSegment && hadPriorAudio) {
        targetEp.audioOutdated = true;
      }
    }
    targetEp.lastModified = Date.now();

    if (seriesGenre) freshSeries.genre = seriesGenre;
    if (seriesDetectedGenre) freshSeries.detectedGenre = seriesDetectedGenre;

    // Cross-episode character voice persistence: merge verified speakers into seriesSpeakerMap
    try {
      const { buildVerifiedSeriesSpeakerMapPatch } = require('./pipeline/speakerIdentificationService');
      const incomingMap = (seriesSpeakerMap && typeof seriesSpeakerMap === 'object')
        ? seriesSpeakerMap
        : (restScriptData.seriesSpeakerMap && typeof restScriptData.seriesSpeakerMap === 'object' ? restScriptData.seriesSpeakerMap : {});
      const mergedSpeakerMap = buildVerifiedSeriesSpeakerMapPatch(
        incomingSegments,
        restScriptData.speakerRegistry || {},
        { ...(freshSeries.seriesSpeakerMap || {}), ...incomingMap }
      );
      if (Object.keys(mergedSpeakerMap).length > 0) {
        freshSeries.seriesSpeakerMap = mergedSpeakerMap;
        const existingChars = Array.isArray(freshSeries.glossary?.characters) ? [...freshSeries.glossary.characters] : [];
        const uniqueVerified = new Map();
        for (const entry of Object.values(mergedSpeakerMap)) {
          if (entry && entry.speakerId && entry.name && !uniqueVerified.has(entry.speakerId)) {
            uniqueVerified.set(entry.speakerId, entry);
          }
        }
        for (const entry of uniqueVerified.values()) {
          const idx = existingChars.findIndex(
            (c) => c && (c.id === entry.speakerId || String(c.name || '').trim() === entry.name)
          );
          if (idx === -1) {
            existingChars.push({
              id: entry.speakerId,
              name: entry.name,
              khmerName: entry.name,
              gender: entry.gender,
              voiceId: entry.voiceId,
              khmerVoiceId: entry.khmerVoiceId,
              voiceAssignmentSource: entry.voiceAssignmentSource,
              userOverridden: Boolean(entry.userOverridden),
            });
          } else if (!existingChars[idx].userOverridden) {
            existingChars[idx] = {
              ...existingChars[idx],
              id: entry.speakerId,
              gender: entry.gender,
              voiceId: entry.voiceId,
              khmerVoiceId: entry.khmerVoiceId,
              voiceAssignmentSource: entry.voiceAssignmentSource,
            };
          }
        }
        freshSeries.glossary = {
          ...(freshSeries.glossary || {}),
          characters: existingChars,
        };
      }
    } catch (memErr) {
      console.warn('[Persist] Non-fatal seriesSpeakerMap merge warning:', memErr.message);
    }

    const saved = saveSeriesMetadata(freshSeries, { projectsDir });
    if (!saved) {
      const errMsg = `[Persist] ERROR: saveSeriesMetadata returned false! seriesId=${cleanSeries}, episodeId=${cleanEpisode}, jobId=${jobId || 'n/a'}`;
      console.error(errMsg);
      throw new Error(errMsg);
    }

    if (typeof _afterWriteHook === 'function') {
      await _afterWriteHook({ metaPath, seriesId: cleanSeries, episodeId: cleanEpisode });
    }

    if (!fs.existsSync(metaPath)) {
      const errMsg = `[Persist] ERROR: series.json missing on disk immediately after write! seriesId=${cleanSeries}, episodeId=${cleanEpisode}, jobId=${jobId || 'n/a'}`;
      console.error(errMsg);
      throw new Error(errMsg);
    }

    let diskJson;
    try {
      diskJson = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    } catch (parseErr) {
      const errMsg = `[Persist] ERROR: Failed re-reading series.json for verification! seriesId=${cleanSeries}, episodeId=${cleanEpisode}, jobId=${jobId || 'n/a'}, parseError=${parseErr.message}`;
      console.error(errMsg);
      throw new Error(errMsg);
    }

    const diskEp = (diskJson?.episodes || []).find(
      (e) => sanitizeEpisodeId(e.id) === cleanEpisode || String(e.id) === String(episodeId)
    );
    const diskCount = Array.isArray(diskEp?.scriptData?.segments) ? diskEp.scriptData.segments.length : -1;

    if (!diskEp || diskCount !== incomingSegments.length) {
      const errMsg = `[Persist] ERROR: Post-write verification mismatch! seriesId=${cleanSeries}, episodeId=${cleanEpisode}, expectedSegments=${incomingSegments.length}, diskSegments=${diskCount}, jobId=${jobId || 'n/a'}`;
      console.error(errMsg);
      throw new Error(errMsg);
    }

    loggedHydratedEpisodes.delete(`${projectsDir}::${cleanSeries}:${targetEp.id}`);
    console.log(
      `[Persist] ✅ Verified ${diskCount} segments on disk in series.json for series=${cleanSeries}, episode=${cleanEpisode}${jobId ? ` (job=${jobId})` : ''}`
    );

    return {
      seriesId: cleanSeries,
      episodeId: targetEp.id,
      savedCount: diskCount,
      series: diskJson,
    };
  }, { projectsDir });
}

/**
 * Concurrency-safe merge for client /sync requests under the per-series mutex.
 * Prevents stale UI offloads (segments: []) or outdated timestamps from overwriting
 * backend-persisted episode segments, audio outputs, or sibling episodes.
 */
async function syncSeriesMetadataSafely(seriesId, incomingSeries, options = {}) {
  if (!seriesId || !incomingSeries || typeof incomingSeries !== 'object') {
    throw new Error('seriesId and valid incoming series object are required');
  }
  const cleanSeries = sanitizeProjectName(seriesId);
  const projectsDir = options.projectsDir || PROJECTS_DIR;

  return await withSeriesMetadataLock(cleanSeries, () => {
    const seriesDir = path.join(projectsDir, cleanSeries);
    const metaPath = path.join(seriesDir, 'series.json');

    const incomingWithId = { ...incomingSeries, id: cleanSeries };
    if (!fs.existsSync(metaPath)) {
      const cleanedNewSeries = {
        ...incomingWithId,
        episodes: (Array.isArray(incomingWithId.episodes) ? incomingWithId.episodes : []).map((ep) =>
          ep && ep.voiceSettings
            ? { ...ep, voiceSettings: stripLogoSettingsFromObject(ep.voiceSettings) }
            : ep
        ),
      };
      return saveSeriesMetadata(cleanedNewSeries, { projectsDir });
    }

    const diskSeries = getSeriesMetadata(cleanSeries, { forceDisk: true, projectsDir });
    const diskEpisodes = Array.isArray(diskSeries?.episodes) ? diskSeries.episodes : [];
    const diskEpMap = new Map(diskEpisodes.map((ep) => [sanitizeEpisodeId(ep.id), ep]));

    const incomingEpisodes = Array.isArray(incomingWithId.episodes) ? incomingWithId.episodes : [];
    const seenDiskKeys = new Set();

    const mergedEpisodes = incomingEpisodes.map((incEp) => {
      const key = sanitizeEpisodeId(incEp?.id);
      const diskEp = diskEpMap.get(key);
      if (!diskEp) {
        return incEp && incEp.voiceSettings
          ? { ...incEp, voiceSettings: stripLogoSettingsFromObject(incEp.voiceSettings) }
          : incEp;
      }
      seenDiskKeys.add(key);

      const diskSegs = Array.isArray(diskEp?.scriptData?.segments) ? diskEp.scriptData.segments : [];
      const incSegs = Array.isArray(incEp?.scriptData?.segments) ? incEp.scriptData.segments : [];
      const incUpdatedAt = Number(incEp?.scriptData?.updatedAt || 0);
      const diskUpdatedAt = Number(diskEp?.scriptData?.updatedAt || 0);

      let resolvedScriptData = incEp.scriptData;
      let resolvedStatus = incEp.status;

      if (incUpdatedAt < diskUpdatedAt) {
        resolvedScriptData = diskEp.scriptData;
        if (!resolvedStatus || resolvedStatus === 'uploaded') {
          resolvedStatus = diskEp.status || 'translated';
        }
      } else if (
        incUpdatedAt > 0 &&
        diskUpdatedAt > 0 &&
        incUpdatedAt === diskUpdatedAt &&
        diskSegs.length > 0 &&
        !incEp?.scriptData?.explicitClear
      ) {
        // Non-script partial sync (e.g. renderedVideo/settings patch) carrying unchanged updatedAt:
        // preserve authoritative disk segments so trimmed/stale client copies can never strip trackRow/userShifted/audioStartSec.
        resolvedScriptData = diskEp.scriptData;
        if (!resolvedStatus || resolvedStatus === 'uploaded') {
          resolvedStatus = diskEp.status || 'translated';
        }
      } else if (incSegs.length === 0 && diskSegs.length > 0 && !incEp?.scriptData?.explicitClear) {
        resolvedScriptData = diskEp.scriptData;
        if (!resolvedStatus || resolvedStatus === 'uploaded') {
          resolvedStatus = diskEp.status || 'translated';
        }
      } else if (
        incSegs.length > 0 &&
        diskSegs.length > 0 &&
        diskUpdatedAt > 0 &&
        (incUpdatedAt === 0 || incUpdatedAt < diskUpdatedAt) &&
        !incEp?.scriptData?.explicitClear
      ) {
        resolvedScriptData = diskEp.scriptData;
        if (!resolvedStatus || resolvedStatus === 'uploaded') {
          resolvedStatus = diskEp.status || 'translated';
        }
      } else if (incSegs.length === 0 && diskSegs.length === 0) {
        if (resolvedScriptData && resolvedScriptData.hasScript) {
          resolvedScriptData = {
            ...resolvedScriptData,
            hasScript: false,
            totalSegments: 0,
            segments: [],
          };
        }
      }

      const preserveDiskAudioInvalidation = Boolean(
        diskEp.audioOutdated &&
        !diskEp.audioGenerated &&
        (!incUpdatedAt || !diskUpdatedAt || incUpdatedAt <= diskUpdatedAt)
      );
      const preserveDiskAudioOutdated = Boolean(
        diskEp.audioOutdated &&
        (!incUpdatedAt || (diskUpdatedAt > 0 && incUpdatedAt < diskUpdatedAt))
      );

      const checkDiskRv = projectsDir === PROJECTS_DIR;
      const safeIncRv = sanitizeRenderedVideoRef(incEp.renderedVideo, { checkDisk: checkDiskRv, uploadsDir: UPLOADS_DIR });
      const safeDiskRv = sanitizeRenderedVideoRef(diskEp.renderedVideo, { checkDisk: checkDiskRv, uploadsDir: UPLOADS_DIR });
      // A compact autosave can omit the render. An explicit settings edit carries
      // a cutoff so that a later sync from an old tab cannot restore that MP4.
      const diskCutoff = Number(diskEp.renderInvalidatedAt) || 0;
      const incomingCutoff = Number(incEp.renderInvalidatedAt) || 0;
      const renderInvalidatedAt = Math.max(diskCutoff, incomingCutoff);
      const resolvedRenderedVideo = [safeIncRv, safeDiskRv]
        .filter(render => render && (!renderInvalidatedAt || Number(render.renderedAt) > renderInvalidatedAt))
        .sort((a, b) => (Number(b.renderedAt) || 0) - (Number(a.renderedAt) || 0))[0] || null;
      const voiceSettings = stripLogoSettingsFromObject(
        incEp.voiceSettings !== undefined ? incEp.voiceSettings : diskEp.voiceSettings
      );
      if (incomingCutoff < diskCutoff && voiceSettings && diskEp.voiceSettings) {
        for (const key of ['subtitleSize', 'subtitleStyle', 'subtitleColor']) {
          if (Object.hasOwn(diskEp.voiceSettings, key)) voiceSettings[key] = diskEp.voiceSettings[key];
          else delete voiceSettings[key];
        }
      }
      const incVe = incEp.videoEditSettings && typeof incEp.videoEditSettings === 'object' ? incEp.videoEditSettings : null;
      const diskVe = diskEp.videoEditSettings && typeof diskEp.videoEditSettings === 'object' ? diskEp.videoEditSettings : null;
      const incVeAt = Number(incVe?.updatedAt || 0);
      const diskVeAt = Number(diskVe?.updatedAt || 0);
      const resolvedVideoEditSettings = (incVe || diskVe)
        ? (incVeAt >= diskVeAt && incVe ? incVe : (diskVe || incVe))
        : null;
      if (resolvedVideoEditSettings && diskVeAt > incVeAt && voiceSettings && typeof voiceSettings === 'object') {
        const normDiskVe = normalizeVideoEditSettings(resolvedVideoEditSettings);
        Object.assign(voiceSettings, normDiskVe);
      }
      let finalStatus = resolvedStatus || diskEp.status;
      if (finalStatus === 'completed' && !resolvedRenderedVideo) {
        finalStatus = (preserveDiskAudioInvalidation ? false : Boolean(incEp.audioGenerated || diskEp.audioGenerated))
          ? 'voicing'
          : ((resolvedScriptData?.segments?.length > 0) ? 'translated' : ((incEp.video || diskEp.video) ? 'uploaded' : 'idle'));
      }

      // Defensive Video & Duration Protection:
      // If disk has an authoritative split chunk video or valid duration,
      // never let a stale client /sync payload revert it to the uncut full video or duration: 0
      const diskVideoPath = diskEp.sourceVideoPath || diskEp.video?.videoPath;
      const diskHasChunkVideo = diskVideoPath && fs.existsSync(diskVideoPath) && (diskVideoPath.includes(`_${diskEp.id}_`) || diskVideoPath.includes('chunk_source'));
      const incVideoPath = incEp.sourceVideoPath || incEp.video?.videoPath;
      const incIsUncutStale = incVideoPath && diskHasChunkVideo && !incVideoPath.includes(`_${diskEp.id}_`) && !incVideoPath.includes('chunk_source') && (Number(incEp.duration) > (Number(diskEp.duration) * 1.5 || 1200));

      const resolvedVideo = (diskHasChunkVideo && incIsUncutStale) ? diskEp.video : (incEp.video || diskEp.video);
      const resolvedVideoFile = (diskHasChunkVideo && incIsUncutStale) ? diskEp.videoFile : (incEp.videoFile || diskEp.videoFile);
      const resolvedSourceVideoPath = (diskHasChunkVideo && incIsUncutStale) ? diskEp.sourceVideoPath : (incEp.sourceVideoPath || diskEp.sourceVideoPath);
      const resolvedDuration = (diskHasChunkVideo && incIsUncutStale)
        ? (diskEp.duration || 0)
        : ((incEp.duration && Number(incEp.duration) > 0) ? Number(incEp.duration) : (diskEp.duration || 0));
      const resolvedMetadata = incEp.metadata || diskEp.metadata || (resolvedDuration > 0 ? { duration: resolvedDuration, durationSec: resolvedDuration } : null);
      const incomingVideoClips = Array.isArray(incEp.videoClips) ? incEp.videoClips : null;
      const incomingVideoClipsUpdatedAt = Number(incEp.videoClipsUpdatedAt || 0);
      const diskVideoClipsUpdatedAt = Number(diskEp.videoClipsUpdatedAt || 0);
      const acceptIncomingVideoClips = incomingVideoClips && incomingVideoClipsUpdatedAt >= diskVideoClipsUpdatedAt;
      const incomingTombstonesUpdatedAt = Number(incEp.timelineTombstonesUpdatedAt || 0);
      const diskTombstonesUpdatedAt = Number(diskEp.timelineTombstonesUpdatedAt || 0);
      const acceptIncomingTombstones = incomingTombstonesUpdatedAt >= diskTombstonesUpdatedAt;

      return {
        ...diskEp,
        ...incEp,
        video: resolvedVideo,
        videoFile: resolvedVideoFile,
        sourceVideoPath: resolvedSourceVideoPath,
        duration: resolvedDuration,
        metadata: resolvedMetadata,
        scriptData: resolvedScriptData,
        videoClips: acceptIncomingVideoClips ? incomingVideoClips : (diskEp.videoClips || incomingVideoClips || []),
        videoClipsUpdatedAt: acceptIncomingVideoClips
          ? incomingVideoClipsUpdatedAt
          : diskVideoClipsUpdatedAt,
        deletedSegmentKeys: acceptIncomingTombstones
          ? (incEp.deletedSegmentKeys || [])
          : (diskEp.deletedSegmentKeys || []),
        deletedVideoClipIds: acceptIncomingTombstones
          ? (incEp.deletedVideoClipIds || [])
          : (diskEp.deletedVideoClipIds || []),
        timelineTombstonesUpdatedAt: acceptIncomingTombstones
          ? incomingTombstonesUpdatedAt
          : diskTombstonesUpdatedAt,
        status: finalStatus,
        generationMode: incEp.generationMode || diskEp.generationMode,
        fullAudioUrl: preserveDiskAudioInvalidation ? diskEp.fullAudioUrl : (incEp.fullAudioUrl || diskEp.fullAudioUrl),
        fullAudioPath: preserveDiskAudioInvalidation ? diskEp.fullAudioPath : (incEp.fullAudioPath || diskEp.fullAudioPath),
        audioGenerated: preserveDiskAudioInvalidation ? false : Boolean(incEp.audioGenerated || diskEp.audioGenerated),
        hasAudio: preserveDiskAudioInvalidation ? false : Boolean(incEp.hasAudio || diskEp.hasAudio),
        audioOutdated: preserveDiskAudioInvalidation || preserveDiskAudioOutdated
          ? true
          : (incEp.audioOutdated !== undefined ? Boolean(incEp.audioOutdated) : Boolean(diskEp.audioOutdated)),
        bgmAudioUrl: incEp.bgmAudioUrl || diskEp.bgmAudioUrl,
        cleanBgmPath: incEp.cleanBgmPath || diskEp.cleanBgmPath,
        isDemucsDone: Boolean(incEp.isDemucsDone || diskEp.isDemucsDone),
        hasDemucs: Boolean(incEp.hasDemucs || diskEp.hasDemucs),
        renderedVideo: resolvedRenderedVideo,
        ...(renderInvalidatedAt > 0 && { renderInvalidatedAt }),
        ...(resolvedVideoEditSettings ? { videoEditSettings: resolvedVideoEditSettings } : {}),
        voiceSettings,
      };
    });

    if (!incomingWithId._allowRemoveEpisodes) {
      for (const diskEp of diskEpisodes) {
        const key = sanitizeEpisodeId(diskEp.id);
        if (!seenDiskKeys.has(key)) {
          mergedEpisodes.push(diskEp);
        }
      }
    }

    const incSeriesVe = incomingWithId.videoEditSettings && typeof incomingWithId.videoEditSettings === 'object'
      ? incomingWithId.videoEditSettings
      : null;
    const diskSeriesVe = diskSeries?.videoEditSettings && typeof diskSeries.videoEditSettings === 'object'
      ? diskSeries.videoEditSettings
      : null;
    const resolvedSeriesVideoEditSettings = (incSeriesVe || diskSeriesVe)
      ? (Number(incSeriesVe?.updatedAt || 0) >= Number(diskSeriesVe?.updatedAt || 0) && incSeriesVe
          ? incSeriesVe
          : (diskSeriesVe || incSeriesVe))
      : null;

    const mergedSeries = {
      ...diskSeries,
      ...incomingWithId,
      id: cleanSeries,
      genre: incomingWithId.genre || diskSeries?.genre,
      detectedGenre: incomingWithId.detectedGenre || diskSeries?.detectedGenre,
      ...(resolvedSeriesVideoEditSettings ? { videoEditSettings: resolvedSeriesVideoEditSettings } : {}),
      episodes: mergedEpisodes,
    };
    delete mergedSeries._allowRemoveEpisodes;

    return saveSeriesMetadata(mergedSeries, { projectsDir });
  }, { projectsDir });
}

function getSegmentKeysForTombstone(segment) {
  return getSegmentIdentityKeys(segment);
}

function mergeKeys(existingKeys, keysToAdd = [], keysToRemove = []) {
  const removed = new Set(keysToRemove.map(String));
  const merged = new Set((Array.isArray(existingKeys) ? existingKeys : []).map(String).filter((key) => !removed.has(key)));
  for (const key of keysToAdd) {
    if (key !== undefined && key !== null && String(key)) merged.add(String(key));
  }
  return [...merged];
}

/**
 * Persist a timeline delete or an undo/redo snapshot as one locked series.json write.
 * Tombstones keep older autosaves and in-flight transforms from restoring deleted IDs;
 * an explicit restore snapshot clears tombstones for the items it puts back.
 */
async function persistEpisodeTimelineOperation({
  seriesId,
  episodeId,
  operation = 'delete',
  track = null,
  items = null,
  deletedItem = null,
  deletedIndex = null,
  segments = null,
  videoClips = null,
  projectsDir = PROJECTS_DIR,
}) {
  if (!seriesId || !episodeId) throw new Error('seriesId and episodeId are required');
  const cleanSeries = sanitizeProjectName(seriesId);
  const cleanEpisode = sanitizeEpisodeId(episodeId);
  if (operation === 'delete' && (!['segments', 'videoClips'].includes(track) || !Array.isArray(items))) {
    throw new Error('delete requires track and items arrays');
  }
  if (operation === 'restore' && (!Array.isArray(segments) || !Array.isArray(videoClips))) {
    throw new Error('restore requires segments and videoClips arrays');
  }
  if (operation === 'update_segments' && !Array.isArray(segments)) {
    throw new Error('update_segments requires segments array');
  }
  if (!['delete', 'restore', 'update_segments'].includes(operation)) throw new Error(`Unsupported timeline operation: ${operation}`);

  return await withSeriesMetadataLock(cleanSeries, () => {
    let operationTimestamps = {};
    const saved = updateSeriesMetadata(cleanSeries, (series) => {
      const episode = (series.episodes || []).find(
        (ep) => sanitizeEpisodeId(ep.id) === cleanEpisode || String(ep.id) === String(episodeId)
      );
      if (!episode) return false;

      const now = Date.now();
      const nextTrackTimestamp = (previous) => Math.max(now, Number(previous || 0) + 1);
      const tombstonesUpdatedAt = nextTrackTimestamp(episode.timelineTombstonesUpdatedAt);
      if (operation === 'delete') {
        if (track === 'segments') {
          const previous = Array.isArray(episode.scriptData?.segments) ? episode.scriptData.segments : [];
          const oldUpdatedAt = Number(episode.scriptData?.updatedAt || 0);
          const updatedAt = nextTrackTimestamp(oldUpdatedAt);
          const tombstones = deletedItem
            ? getSegmentKeysForTombstone(deletedItem)
            : (deletedIndex !== null && previous[deletedIndex]
              ? getSegmentKeysForTombstone(previous[deletedIndex])
              : []);
          episode.deletedSegmentKeys = mergeKeys(episode.deletedSegmentKeys, tombstones);
          episode.timelineTombstonesUpdatedAt = tombstonesUpdatedAt;
          episode.scriptData = {
            ...(episode.scriptData || {}),
            segments: items,
            hasScript: items.length > 0,
            totalSegments: items.length,
            updatedAt,
            explicitClear: items.length === 0,
          };
          operationTimestamps = { updatedAt };
        } else {
          const deletedId = getVideoClipIdentity(deletedItem);
          const updatedAt = nextTrackTimestamp(episode.videoClipsUpdatedAt);
          episode.videoClips = items;
          episode.videoClipsUpdatedAt = updatedAt;
          if (deletedId) {
            episode.deletedVideoClipIds = mergeKeys(episode.deletedVideoClipIds, [deletedId]);
          }
          if (Array.isArray(segments)) {
            const segUpdatedAt = nextTrackTimestamp(episode.scriptData?.updatedAt);
            episode.scriptData = {
              ...(episode.scriptData || {}),
              segments,
              hasScript: segments.length > 0,
              totalSegments: segments.length,
              updatedAt: segUpdatedAt,
              explicitClear: segments.length === 0,
            };
          }
          episode.timelineTombstonesUpdatedAt = tombstonesUpdatedAt;
          operationTimestamps = { updatedAt };
        }
      } else if (operation === 'update_segments') {
        const updatedAt = nextTrackTimestamp(episode.scriptData?.updatedAt);
        episode.scriptData = {
          ...(episode.scriptData || {}),
          segments,
          hasScript: segments.length > 0,
          totalSegments: segments.length,
          updatedAt,
          explicitClear: segments.length === 0,
        };
        operationTimestamps = { updatedAt };
      } else {
        const previousSegments = Array.isArray(episode.scriptData?.segments) ? episode.scriptData.segments : [];
        const restoredSegmentKeys = new Set(segments.flatMap((segment) => getSegmentIdentityKeys(segment)));
        const removedSegmentKeys = previousSegments
          .filter((segment) => !getSegmentIdentityKeys(segment).some((key) => restoredSegmentKeys.has(key)))
          .flatMap((segment) => getSegmentIdentityKeys(segment));
        const currentDeletedSegments = new Set((episode.deletedSegmentKeys || []).map(String));
        const restoreSegmentKeys = [...restoredSegmentKeys].filter((key) => currentDeletedSegments.has(key));

        const previousClips = Array.isArray(episode.videoClips) ? episode.videoClips : [];
        const restoredClipIds = new Set(videoClips.map(getVideoClipIdentity).filter(Boolean));
        const removedClipIds = previousClips
          .map(getVideoClipIdentity)
          .filter((id) => id && !restoredClipIds.has(id));
        const currentDeletedClipIds = new Set((episode.deletedVideoClipIds || []).map(String));
        const restoreClipIds = [...restoredClipIds].filter((id) => currentDeletedClipIds.has(id));

        const updatedAt = nextTrackTimestamp(episode.scriptData?.updatedAt);
        const videoClipsUpdatedAt = nextTrackTimestamp(episode.videoClipsUpdatedAt);
        episode.deletedSegmentKeys = mergeKeys(episode.deletedSegmentKeys, removedSegmentKeys, restoreSegmentKeys);
        episode.deletedVideoClipIds = mergeKeys(episode.deletedVideoClipIds, removedClipIds, restoreClipIds);
        episode.timelineTombstonesUpdatedAt = tombstonesUpdatedAt;
        episode.scriptData = {
          ...(episode.scriptData || {}),
          segments,
          hasScript: segments.length > 0,
          totalSegments: segments.length,
          updatedAt,
          explicitClear: segments.length === 0,
        };
        episode.videoClips = videoClips;
        episode.videoClipsUpdatedAt = videoClipsUpdatedAt;
        operationTimestamps = { updatedAt, videoClipsUpdatedAt };
      }

      // Timeline mutations (delete / undo-redo restore) invalidate any cached rendered preview
      // WITHOUT deleting the rendered MP4 file from disk.
      const prevRenderedAt = Number(episode.renderedVideo?.renderedAt || 0);
      episode.renderedVideo = null;
      episode.renderInvalidatedAt = Math.max(now, Number(episode.renderInvalidatedAt || 0) + 1, prevRenderedAt > 0 ? prevRenderedAt + 1 : 0);
      if (episode.status === 'completed') {
        episode.status = episode.audioGenerated ? 'voicing' : 'translated';
      }

      episode.lastModified = Math.max(now, Number(episode.lastModified || 0) + 1);
      return true;
    }, { projectsDir });

    if (!saved || !Array.isArray(saved.episodes)) {
      throw new Error(`Episode ${cleanEpisode} was not found in series ${cleanSeries}`);
    }
    const persistedEpisode = saved.episodes.find((ep) => sanitizeEpisodeId(ep.id) === cleanEpisode);
    if (!persistedEpisode) throw new Error(`Episode ${cleanEpisode} was not persisted`);
    return { success: true, episode: persistedEpisode, ...operationTimestamps };
  }, { projectsDir });
}

function resetHydrationLogForTesting() {
  loggedHydratedEpisodes.clear();
}

/**
 * Create a new Episode with atomic numbering and isolated directory guarantee
 *
 * @param {string} seriesId
 * @param {Object} [options] - { customTitle, requestedNumber }
 * @returns {Promise<Object>} Newly created episode
 */
async function createNewEpisode(seriesId, options = {}) {
  const cleanSeries = sanitizeProjectName(seriesId);

  return await withSeriesMetadataLock(cleanSeries, async () => {
    const series = getSeriesMetadata(cleanSeries, { forceDisk: true });
    const existing = series.episodes || [];

    // Determine the next reliable episode number (never based only on array length)
    const nextNum = (typeof options.requestedNumber === 'number' && options.requestedNumber > 0)
      ? options.requestedNumber
      : getNextAvailableEpisodeNumber(existing);

    const newEp = createEpisode({
      episodeNumber: nextNum,
      title: options.customTitle || `ភាគទី ${nextNum} (EP${nextNum})`,
      existingEpisodes: existing,
    });

    // Inherit folder-level (or global) video-edit defaults for newly created episodes
    const inheritedVe = getInheritedVideoEditSettings(cleanSeries, null, {
      series,
      projectsDir: options.projectsDir,
      videoEditStoragePath: options.videoEditStoragePath,
    });
    if (inheritedVe && (series?.videoEditSettings || readGlobalVideoEditSettings(options.videoEditStoragePath).initialized)) {
      const inheritedStamp = Number(series?.videoEditSettings?.updatedAt || Date.now());
      newEp.videoEditSettings = {
        ...normalizeVideoEditSettings(inheritedVe),
        updatedAt: inheritedStamp,
        scope: series?.videoEditSettings ? 'folder' : 'global',
      };
      newEp.voiceSettings = {
        ...(newEp.voiceSettings && typeof newEp.voiceSettings === 'object' ? newEp.voiceSettings : {}),
        ...normalizeVideoEditSettings(inheritedVe),
      };
    }

    // Ensure completely isolated filesystem directories exist
    ensureEpisodeDirectories(cleanSeries, newEp.id);

    series.episodes = [...existing, newEp];
    saveSeriesMetadata(series);

    console.log(`[EpisodeService] Created Episode #${newEp.episodeNumber} (${newEp.id}) for series "${cleanSeries}".`);
    return newEp;
  });
}

/**
 * Safe directory removal with retries and Windows fallback for locked files / transient EPERM
 */
function safeRemoveDirectorySync(dirPath, maxRetries = 10, retryDelay = 100) {
  if (!dirPath || !fs.existsSync(dirPath)) return true;
  try {
    fs.rmSync(dirPath, { recursive: true, force: true, maxRetries, retryDelay });
    return true;
  } catch (err) {
    if (process.platform === 'win32') {
      try {
        const { spawnSync } = require('child_process');
        spawnSync('cmd.exe', ['/c', 'rmdir', '/s', '/q', dirPath], {
          windowsHide: true,
          stdio: 'ignore',
        });
        if (!fs.existsSync(dirPath)) return true;
      } catch (_) {}
    }
    throw err;
  }
}

const WINDOWS_RESERVED_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

function sanitizeSeriesFolderBaseName(name) {
  let clean = sanitizeProjectName(name)
    .replace(/^\.+|\.+$/g, '')
    .trim();
  if (!clean || clean === '.' || clean === '..') {
    clean = `series_${Date.now()}`;
  }
  if (WINDOWS_RESERVED_NAMES.test(clean)) {
    clean = `${clean}_series`;
  }
  return clean.slice(0, 80);
}

function listExistingSeriesDirNames(projectsDir = PROJECTS_DIR) {
  if (!fs.existsSync(projectsDir)) return [];
  try {
    return fs
      .readdirSync(projectsDir, { withFileTypes: true })
      .filter((ent) => ent.isDirectory())
      .map((ent) => ent.name);
  } catch (_) {
    return [];
  }
}

function isSeriesFolderNameTaken(candidate, existingNames, excludeCurrentId = null) {
  const isWin = process.platform === 'win32';
  const normCand = isWin ? candidate.toLowerCase() : candidate;
  const normExcl = excludeCurrentId ? (isWin ? String(excludeCurrentId).toLowerCase() : String(excludeCurrentId)) : null;
  return existingNames.some((name) => {
    const normName = isWin ? name.toLowerCase() : name;
    if (normExcl && normName === normExcl) return false;
    return normName === normCand;
  });
}

function resolveUniqueSeriesFolderId(desiredTitle, options = {}) {
  const projectsDir = options.projectsDir || PROJECTS_DIR;
  const excludeCurrentId = options.excludeCurrentId || null;
  const base = sanitizeSeriesFolderBaseName(desiredTitle);
  const existing = listExistingSeriesDirNames(projectsDir);

  if (!isSeriesFolderNameTaken(base, existing, excludeCurrentId)) {
    return base;
  }
  for (let suffix = 2; suffix <= 999; suffix++) {
    const next = `${base}_${suffix}`;
    if (!isSeriesFolderNameTaken(next, existing, excludeCurrentId)) {
      return next;
    }
  }
  return `${base}_${Date.now()}`;
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function rewriteSeriesIdInString(str, oldId, newId) {
  if (typeof str !== 'string' || !str || oldId === newId) return str;
  const encOld = encodeURIComponent(oldId);
  const encNew = encodeURIComponent(newId);
  let out = str;

  // Replace forward/backslash project directory segments without touching filename prefixes
  const reDir = new RegExp(`((?:^|[\\/\\\\])projects[\\/\\\\])${escapeRegExp(oldId)}(?=[\\/\\\\]|$)`, 'g');
  out = out.replace(reDir, `$1${newId}`);

  // Replace URL-encoded folder segment in /uploads/projects/<encOld>/
  if (encOld !== oldId) {
    const reEncDir = new RegExp(`((?:^|/)projects/)${escapeRegExp(encOld)}(?=/|$)`, 'g');
    out = out.replace(reEncDir, `$1${encNew}`);
  }

  // Replace query-encoded download-export refs: projects%2F<oldId>%2F
  const reQueryEnc = new RegExp(`(projects%2[fF])${escapeRegExp(encOld)}(%2[fF]|$|&)`, 'g');
  out = out.replace(reQueryEnc, `$1${encNew}$2`);

  return out;
}

function rewriteSeriesIdReferences(value, oldId, newId) {
  if (!value || oldId === newId) return value;
  if (typeof value === 'string') {
    return rewriteSeriesIdInString(value, oldId, newId);
  }
  if (Array.isArray(value)) {
    return value.map((item) => rewriteSeriesIdReferences(item, oldId, newId));
  }
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = rewriteSeriesIdReferences(v, oldId, newId);
    }
    return out;
  }
  return value;
}

function safeRenameDirectorySync(oldDir, newDir, maxRetries = 8, retryDelay = 80) {
  const isCaseOnlyRename =
    process.platform === 'win32' &&
    oldDir.toLowerCase() === newDir.toLowerCase() &&
    oldDir !== newDir;

  const attemptRename = (src, dst) => {
    let lastErr = null;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        fs.renameSync(src, dst);
        return;
      } catch (err) {
        lastErr = err;
        if (err && (err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'EACCES') && attempt < maxRetries - 1) {
          const until = Date.now() + retryDelay;
          while (Date.now() < until) { /* brief sync backoff for Windows file handle release */ }
          continue;
        }
        throw err;
      }
    }
    if (lastErr) throw lastErr;
  };

  if (isCaseOnlyRename) {
    const tempDir = `${oldDir}.__rename_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    attemptRename(oldDir, tempDir);
    try {
      attemptRename(tempDir, newDir);
    } catch (err) {
      try { attemptRename(tempDir, oldDir); } catch (_) {}
      throw err;
    }
    return;
  }

  attemptRename(oldDir, newDir);
}

let batchExportModuleRef = null;
function getBatchExportModuleSafe() {
  if (!batchExportModuleRef) {
    try { batchExportModuleRef = require('./batchExportService'); } catch (_) {}
  }
  return batchExportModuleRef;
}

/**
 * Rename a series title AND its physical directory under backend/uploads/projects/<newName>
 * atomically, rewriting internal project directory references in series.json and audio sidecars.
 */
async function renameSeries(oldSeriesId, newTitle, options = {}) {
  const cleanTitle = typeof newTitle === 'string' ? newTitle.trim() : '';
  if (!oldSeriesId || !cleanTitle) {
    return { success: false, statusCode: 400, error: 'seriesId និងឈ្មោះថ្មីត្រូវបានទាមទារ' };
  }

  const projectsDir = options.projectsDir || PROJECTS_DIR;
  const cleanOld = sanitizeProjectName(oldSeriesId);
  const targetId = sanitizeSeriesFolderBaseName(cleanTitle);

  return await withSeriesMetadataLock(cleanOld, () => {
    const oldDir = path.join(projectsDir, cleanOld);
    const newDir = path.join(projectsDir, targetId);

    // 1. Refuse folder rename while active pipeline or batch export jobs are running on this series
    if (cleanOld !== targetId) {
      const q = getProductionJobQueueSafe();
      if (q && q.inMemoryJobs) {
        for (const job of q.inMemoryJobs.values()) {
          if (job?.seriesId === cleanOld && (job.status === 'running' || job.status === 'queued')) {
            return {
              success: false,
              statusCode: 409,
              error: 'កំពុងមាន Job ដំណើរការលើរឿងនេះ! សូមផ្អាក ឬរង់ចាំ Job ចប់សិន មុននឹងប្តូរឈ្មោះ Folder។',
            };
          }
        }
      }
      const batchMod = getBatchExportModuleSafe();
      if (batchMod && typeof batchMod.getLatestBatchExportJob === 'function') {
        const activeBatch = batchMod.getLatestBatchExportJob(cleanOld);
        if (activeBatch && activeBatch.status === 'running') {
          return {
            success: false,
            statusCode: 409,
            error: 'កំពុង Export/Merge រឿងនេះ! សូមផ្អាក ឬរង់ចាំ Export ចប់សិន មុននឹងប្តូរឈ្មោះ Folder។',
          };
        }
      }
    }

    // 2. Check target folder name collision against OTHER series folders
    const existingNames = listExistingSeriesDirNames(projectsDir);
    if (cleanOld !== targetId && isSeriesFolderNameTaken(targetId, existingNames, cleanOld)) {
      return {
        success: false,
        statusCode: 409,
        error: `Folder រឿងឈ្មោះ "${targetId}" មានរួចហើយ! សូមដាក់ឈ្មោះផ្សេង។`,
      };
    }

    // 3. Load current series metadata before renaming
    const existingSeries = fs.existsSync(oldDir)
      ? getSeriesMetadata(cleanOld, { forceDisk: true, projectsDir })
      : null;

    if (!existingSeries && !fs.existsSync(oldDir)) {
      return {
        success: false,
        statusCode: 404,
        error: `រកមិនឃើញ Folder រឿង (${cleanOld}) ទេ`,
      };
    }

    // 4. If folder slug is unchanged, just update display title cleanly
    if (cleanOld === targetId) {
      const updatedSame = {
        ...existingSeries,
        id: cleanOld,
        title: cleanTitle,
        updatedAt: Date.now(),
      };
      const savedSame = saveSeriesMetadata(updatedSame, { projectsDir });
      return {
        success: true,
        renamedFolder: false,
        oldSeriesId: cleanOld,
        newSeriesId: cleanOld,
        series: savedSame,
      };
    }

    // 5. Rename physical folder on disk
    try {
      if (fs.existsSync(oldDir)) {
        safeRenameDirectorySync(oldDir, newDir);
      } else {
        fs.mkdirSync(newDir, { recursive: true });
      }
    } catch (renameErr) {
      console.error(`[EpisodeService] Failed to rename folder ${cleanOld} -> ${targetId}:`, renameErr.message);
      return {
        success: false,
        statusCode: 423,
        error: `មិនអាចប្តូរឈ្មោះ Folder លើ Disk បានទេ (${renameErr.code || renameErr.message}) — សូមបិទ File វីដេអូ ឬកម្មវិធីដែលកំពុងបើក Folder នេះសិន!`,
      };
    }

    // 6. Evict old cache entry and rewrite all internal project directory paths cleanly
    seriesMetadataCache.delete(buildSeriesCacheKey(cleanOld, projectsDir));
    const rewritten = rewriteSeriesIdReferences(existingSeries, cleanOld, targetId);
    rewritten.id = targetId;
    rewritten.title = cleanTitle;
    rewritten.updatedAt = Date.now();

    const savedRenamed = saveSeriesMetadata(rewritten, { projectsDir });

    // 7. Update episode audio sidecars (*.meta.json) & job manifests so seriesId checks stay valid
    const episodesRoot = path.join(newDir, 'episodes');
    if (fs.existsSync(episodesRoot)) {
      try {
        const epEntries = fs.readdirSync(episodesRoot, { withFileTypes: true });
        for (const epEnt of epEntries) {
          if (!epEnt.isDirectory()) continue;
          const epAudioDir = path.join(episodesRoot, epEnt.name, 'audio');
          if (fs.existsSync(epAudioDir)) {
            for (const f of fs.readdirSync(epAudioDir)) {
              if (!f.endsWith('.meta.json')) continue;
              const p = path.join(epAudioDir, f);
              try {
                const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
                if (raw && typeof raw === 'object') {
                  const nextSidecar = rewriteSeriesIdReferences(raw, cleanOld, targetId);
                  if (nextSidecar.seriesId === cleanOld) nextSidecar.seriesId = targetId;
                  fs.writeFileSync(p, JSON.stringify(nextSidecar, null, 2), 'utf8');
                }
              } catch (_) {}
            }
          }
          const epJobsDir = path.join(episodesRoot, epEnt.name, 'jobs');
          if (fs.existsSync(epJobsDir)) {
            for (const f of fs.readdirSync(epJobsDir)) {
              if (!f.endsWith('.json')) continue;
              const p = path.join(epJobsDir, f);
              try {
                const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
                if (raw && typeof raw === 'object') {
                  const nextJob = rewriteSeriesIdReferences(raw, cleanOld, targetId);
                  if (nextJob.seriesId === cleanOld) nextJob.seriesId = targetId;
                  fs.writeFileSync(p, JSON.stringify(nextJob), 'utf8');
                }
              } catch (_) {}
            }
          }
        }
      } catch (_) {}
    }

    console.log(`[EpisodeService] 📁 Renamed series folder on disk: "${cleanOld}" ➜ "${targetId}" (title: "${cleanTitle}")`);
    return {
      success: true,
      renamedFolder: true,
      oldSeriesId: cleanOld,
      newSeriesId: targetId,
      series: savedRenamed,
    };
  }, { projectsDir });
}

/**
 * Delete an entire series and remove its directory from disk atomically
 */
function deleteSeries(seriesId, options = {}) {
  const cleanSeries = sanitizeProjectName(seriesId);
  const projectsDir = options.projectsDir || PROJECTS_DIR;
  const seriesDir = path.join(projectsDir, cleanSeries);
  const cacheKey = buildSeriesCacheKey(cleanSeries, projectsDir);

  seriesMetadataCache.delete(cacheKey);

  // 1. Cancel active generation jobs & release episode locks for this series
  const q = getProductionJobQueueSafe();
  if (q) {
    try {
      if (q.inMemoryJobs) {
        for (const [jobId, job] of q.inMemoryJobs.entries()) {
          if (job?.seriesId === cleanSeries && (job.status === 'running' || job.status === 'queued')) {
            try { q.cancelJob(jobId); } catch (_) {}
          }
        }
      }
      if (q.activeEpisodeLocks) {
        for (const lockKey of Array.from(q.activeEpisodeLocks.keys())) {
          if (lockKey.startsWith(`${cleanSeries}/`)) {
            q.activeEpisodeLocks.delete(lockKey);
          }
        }
      }
    } catch (_) {}
  }

  // 2. Remove series directory from disk with Windows retry and fallback
  if (fs.existsSync(seriesDir)) {
    try {
      safeRemoveDirectorySync(seriesDir, 10, 100);
    } catch (err) {
      if (fs.existsSync(seriesDir)) {
        return { success: false, error: err.message };
      }
    }
  }

  console.log(`[EpisodeService] 🗑️ Deleted series "${cleanSeries}" from disk.`);
  return {
    success: true,
    seriesId: cleanSeries,
    message: `Series ${cleanSeries} deleted successfully.`,
  };
}

/**
 * Delete an episode while preserving all other episodes and assets
 */
function deleteEpisode(seriesId, episodeId) {
  const cleanSeries = sanitizeProjectName(seriesId);
  const cleanEp = sanitizeEpisodeId(episodeId);

  const series = getSeriesMetadata(cleanSeries, { forceDisk: true });
  if (!series) {
    return { success: false, error: `Series ${cleanSeries} not found.` };
  }

  const targetEp = (series.episodes || []).find((e) => String(e.id) === cleanEp);
  if (!targetEp) {
    // Idempotent: If episode already removed or not found, return clean success without 400 Bad Request
    const epDir = path.join(PROJECTS_DIR, cleanSeries, 'episodes', cleanEp);
    if (fs.existsSync(epDir)) {
      try { safeRemoveDirectorySync(epDir, 5, 100); } catch (_) { }
    }
    return {
      success: true,
      alreadyDeleted: true,
      message: `Episode ${cleanEp} is already deleted or not found in series ${cleanSeries}.`,
      remainingEpisodes: series.episodes || [],
    };
  }

  // Filter out the deleted episode from metadata
  series.episodes = (series.episodes || []).filter((e) => String(e.id) !== cleanEp);

  // If the only episode was deleted, create a fresh clean EP1 so the series remains valid
  if (series.episodes.length === 0) {
    const defaultEp = createEpisode(1, 'ភាគទី 1 (EP1)', null, []);
    series.episodes = [defaultEp];
    ensureEpisodeDirectories(cleanSeries, defaultEp.id);
  } else {
    // Renumber remaining episodes sequentially (1..N)
    series.episodes.forEach((ep, idx) => {
      const newNum = idx + 1;
      const oldNum = ep.episodeNumber;
      ep.episodeNumber = newNum;

      const isGeneric = !ep.title ||
        new RegExp(`^ភាគទី\\s*${oldNum}\\s*\\(EP${oldNum}\\)$`, 'i').test(ep.title.trim()) ||
        /^ភាគទី\s*[\d០-៩]+\s*\(EP[\d០-៩]+\)$/i.test(ep.title.trim()) ||
        /^\(EP[\d០-៩]+\)$/i.test(ep.title.trim()) ||
        /^ភាគទី\s*[\d០-៩]+$/i.test(ep.title.trim()) ||
        /^Episode\s*[\d]+$/i.test(ep.title.trim());

      if (isGeneric) {
        ep.title = `ភាគទី ${newNum} (EP${newNum})`;
        ep.displayTitle = ep.title;
      } else if (typeof ep.title === 'string' && /^(?:ភាគទី|ភាគ|EP|Episode)\s*[:#\s]*\d+\s*[:\-\s]*/i.test(ep.title)) {
        const rest = ep.title.replace(/^(?:ភាគទី|ភាគ|EP|Episode)\s*[:#\s]*\d+\s*[:\-\s]*/i, '').trim();
        ep.title = `ភាគទី ${newNum}: ${rest}`;
        if (ep.displayTitle) {
          const restDisplay = ep.displayTitle.replace(/^(?:ភាគទី|ភាគ|EP|Episode)\s*[:#\s]*\d+\s*[:\-\s]*/i, '').trim();
          ep.displayTitle = `ភាគទី ${newNum}: ${restDisplay}`;
        }
      }
    });
  }

  saveSeriesMetadata(series);

  const epDir = path.join(PROJECTS_DIR, cleanSeries, 'episodes', cleanEp);
  if (fs.existsSync(epDir)) {
    try { safeRemoveDirectorySync(epDir, 5, 100); } catch (_) { }
  }

  console.log(`[EpisodeService] Deleted Episode ${cleanEp} from series "${cleanSeries}". Remaining episodes re-indexed sequentially (1..${series.episodes.length}).`);
  return { success: true, remainingEpisodes: series.episodes };
}

let queueModuleRef = null;
function getProductionJobQueueSafe() {
  if (!queueModuleRef) {
    try { queueModuleRef = require('./pipeline/productionJobQueue'); } catch (_) { }
  }
  return queueModuleRef?.productionJobQueue || null;
}

/**
 * Safely reset an episode's generated script or voice state.
 * - 'script': Clears scriptData, audio references, disk audio, and old jobs so regeneration is 100% fresh. Original video is NEVER touched.
 * - 'voice': Keeps translated scriptData, but clears audio references and disk audio files.
 */
async function resetEpisodeState(seriesId, episodeId, options = {}) {
  const resetType = options.resetType === 'voice' ? 'voice' : 'script';
  const projectsDir = options.projectsDir || PROJECTS_DIR;
  const cleanSeries = sanitizeProjectName(seriesId);
  const cleanEp = sanitizeEpisodeId(episodeId);

  return await withSeriesMetadataLock(cleanSeries, async () => {
    const seriesDir = path.join(projectsDir, cleanSeries);
    const metaPath = path.join(seriesDir, 'series.json');
    if (!fs.existsSync(seriesDir) || !fs.existsSync(metaPath)) {
      throw new Error(`Series not found: ${cleanSeries}`);
    }

    const series = getSeriesMetadata(cleanSeries, { forceDisk: true, projectsDir });
    if (!series || !Array.isArray(series.episodes)) {
      throw new Error(`Series not found: ${cleanSeries}`);
    }

    const targetEp = series.episodes.find(
      (e) => sanitizeEpisodeId(e.id) === cleanEp || String(e.id) === String(episodeId)
    );
    if (!targetEp) {
      throw new Error(`Episode ${cleanEp} not found in series ${cleanSeries}`);
    }

    const epDir = path.join(seriesDir, 'episodes', cleanEp);
    const epAudioDir = path.join(epDir, 'audio');
    const epJobsDir = path.join(epDir, 'jobs');
    const backupsDir = path.join(epDir, 'backups');

    // 1. Snapshot backup before any reset
    try {
      if (!fs.existsSync(backupsDir)) {
        fs.mkdirSync(backupsDir, { recursive: true });
      }
      const now = Date.now();
      if (targetEp.scriptData) {
        fs.writeFileSync(
          path.join(backupsDir, `reset_${resetType}_script_${now}.json`),
          JSON.stringify(targetEp.scriptData, null, 2),
          'utf8'
        );
      }
      const metaPath = path.join(seriesDir, 'series.json');
      if (fs.existsSync(metaPath)) {
        fs.copyFileSync(metaPath, path.join(seriesDir, `series.json.backup_${now}`));
      }
    } catch (bErr) {
      console.warn(`[ResetEpisodeState] Backup notice:`, bErr.message);
    }

    // 2. Cancel conflicting active generation jobs for this episode
    const q = getProductionJobQueueSafe();
    if (q && typeof q.hasActiveJobForEpisode === 'function' && q.hasActiveJobForEpisode(cleanSeries, cleanEp)) {
      try {
        const active = q.getActiveJobForEpisode(cleanSeries, cleanEp);
        if (active?.jobId) {
          if (typeof queueModuleRef?.cancelJob === 'function') {
            queueModuleRef.cancelJob(active.jobId);
          }
        }
      } catch (_) { }
      try { q.releaseEpisodeLock(cleanSeries, cleanEp); } catch (_) { }
    }

    // 3. Clear verified generated audio files for this episode (NEVER touch video/)
    if (fs.existsSync(epAudioDir)) {
      try {
        const audioFiles = fs.readdirSync(epAudioDir);
        for (const file of audioFiles) {
          // Delete only .mp3, .wav, and .meta.json files
          if (file.endsWith('.mp3') || file.endsWith('.wav') || file.endsWith('.json')) {
            try { fs.unlinkSync(path.join(epAudioDir, file)); } catch (_) { }
          }
        }
      } catch (aErr) {
        console.warn(`[ResetEpisodeState] Audio cleanup notice:`, aErr.message);
      }
    }

    // 4. Invalidate render cache and audio flags
    targetEp.audioGenerated = false;
    targetEp.audioOutdated = false;
    targetEp.hasAudio = false;
    targetEp.fullAudioUrl = null;
    targetEp.fullAudioPath = null;
    targetEp.renderedVideo = null;

    if (resetType === 'script') {
      // Clear old completed job manifests so hydration doesn't resurrect deleted script
      if (fs.existsSync(epJobsDir)) {
        try {
          const jFiles = fs.readdirSync(epJobsDir).filter((f) => f.endsWith('.json'));
          for (const jf of jFiles) {
            try { fs.unlinkSync(path.join(epJobsDir, jf)); } catch (_) { }
          }
        } catch (_) { }
      }

      // Clear chunk cache on disk matching this video/episode
      try {
        const chunkCacheDir = path.resolve(UPLOADS_DIR, 'cache', 'chunks');
        if (fs.existsSync(chunkCacheDir)) {
          const cFiles = fs.readdirSync(chunkCacheDir).filter((f) => f.startsWith('chunk_') && f.endsWith('.json'));
          for (const cf of cFiles) {
            try { fs.unlinkSync(path.join(chunkCacheDir, cf)); } catch (_) { }
          }
        }
      } catch (_) { }

      // Reset scriptData
      targetEp.scriptData = null;
      targetEp.status = 'uploaded';
      try {
        const epScriptPath = path.join(epDir, 'script.json');
        if (fs.existsSync(epScriptPath)) fs.unlinkSync(epScriptPath);
      } catch (_) { }
    } else {
      // Voice reset: Keep scriptData, but reset all segment audio references to pending
      if (targetEp.scriptData && Array.isArray(targetEp.scriptData.segments)) {
        targetEp.scriptData.segments = targetEp.scriptData.segments.map((seg) => ({
          ...seg,
          audioPath: null,
          audioFile: null,
          audioUrl: null,
          audioFileName: null,
          ttsStatus: 'pending',
          audioDuration: null,
          audioDurationSec: null,
          audioDurationMs: null,
          rawAudioDur: null,
          originalAudioDuration: null,
          finalAudioDuration: null,
          audioOffset: 0,
          audioTrimmed: false,
          userTrimmed: false,
          audioGenerated: false,
          audioOutdated: false,
        }));
        targetEp.scriptData.updatedAt = Date.now();
      }
    }

    targetEp.lastModified = Date.now();
    saveSeriesMetadata(series, { projectsDir });

    console.log(`[ResetEpisodeState] ✅ Episode ${cleanEp} in "${cleanSeries}" reset successfully (${resetType}).`);
    return {
      success: true,
      seriesId: cleanSeries,
      episodeId: cleanEp,
      resetType,
      episode: targetEp,
    };
  });
}

/**
 * Resolves the effective video-edit settings for an episode by comparing timestamps
 * across episode override (`scope === 'episode'`), folder default (`series.videoEditSettings`),
 * and global store (`global_video_edit_settings.json`).
 *
 * @param {string} seriesId
 * @param {string|null} episodeId
 * @param {Object} [options]
 * @returns {{ enableMirrorFlip: boolean, zoomScale: number, enableColorGrade: boolean, youtubeSafeAudio: boolean }}
 */
function getInheritedVideoEditSettings(seriesId, episodeId = null, options = {}) {
  const projectsDir = options.projectsDir || PROJECTS_DIR;
  const globalState = readGlobalVideoEditSettings(options.videoEditStoragePath);
  const globalVe = globalState.initialized && globalState.settings ? globalState.settings : null;
  const globalAt = Number(globalState.updatedAt || 0);

  let series = options.series || null;
  if (!series && seriesId) {
    try {
      series = getSeriesMetadata(seriesId, { projectsDir, useStatCache: true });
    } catch (_) {}
  }

  const folderVe = series?.videoEditSettings && typeof series.videoEditSettings === 'object'
    ? series.videoEditSettings
    : null;
  const folderAt = Number(folderVe?.updatedAt || 0);

  let ep = null;
  if (episodeId && Array.isArray(series?.episodes)) {
    const cleanEp = sanitizeEpisodeId(episodeId);
    ep = series.episodes.find(
      (e) => sanitizeEpisodeId(e.id) === cleanEp || String(e.id) === String(episodeId)
    ) || null;
  }
  const epVe = ep?.videoEditSettings && typeof ep.videoEditSettings === 'object'
    ? ep.videoEditSettings
    : null;
  const epAt = Number(epVe?.updatedAt || 0);

  if (epVe && epVe.scope === 'episode' && epAt >= folderAt && epAt >= globalAt) {
    return normalizeVideoEditSettings(epVe);
  }
  if (folderVe && folderAt >= globalAt) {
    return normalizeVideoEditSettings(folderVe);
  }
  if (globalVe) {
    return normalizeVideoEditSettings(globalVe);
  }
  if (epVe) {
    return normalizeVideoEditSettings(epVe);
  }
  return normalizeVideoEditSettings(null);
}

function applyVideoEditPatchToEpisode(ep, normalizedEdit, scopeName, updatedAt) {
  if (!ep || typeof ep !== 'object') return false;
  const prevEffective = ep.videoEditSettings
    ? normalizeVideoEditSettings(ep.videoEditSettings)
    : (ep.voiceSettings ? normalizeVideoEditSettings(ep.voiceSettings) : normalizeVideoEditSettings(null));
  const changed = !areVideoEditSettingsEqual(prevEffective, normalizedEdit);

  ep.videoEditSettings = {
    ...normalizedEdit,
    updatedAt,
    scope: scopeName,
  };
  const nextVoice = stripLogoSettingsFromObject(
    ep.voiceSettings && typeof ep.voiceSettings === 'object' && !Array.isArray(ep.voiceSettings)
      ? { ...ep.voiceSettings }
      : {}
  );
  for (const key of VIDEO_EDIT_SETTING_KEYS) {
    nextVoice[key] = normalizedEdit[key];
  }
  ep.voiceSettings = nextVoice;

  const rvTransformMismatch = Boolean(
    ep.renderedVideo &&
    (!ep.renderedVideo.youtubeTransform || !areVideoEditSettingsEqual(ep.renderedVideo.youtubeTransform, normalizedEdit))
  );
  if (changed || rvTransformMismatch) {
    const prevRenderedAt = Number(ep.renderedVideo?.renderedAt || 0);
    ep.renderedVideo = null;
    ep.renderInvalidatedAt = Math.max(
      updatedAt,
      Number(ep.renderInvalidatedAt || 0) + 1,
      prevRenderedAt > 0 ? prevRenderedAt + 1 : 0
    );
    if (ep.status === 'completed') {
      ep.status = ep.audioGenerated ? 'voicing' : ((ep.scriptData?.segments?.length > 0) ? 'translated' : (ep.video ? 'uploaded' : 'idle'));
    }
  }
  ep.lastModified = Math.max(updatedAt, Number(ep.lastModified || 0) + 1);
  return true;
}

/**
 * Persist video-edit settings ONLY (Mirror Flip, Zoom, Color Grade, Mute Original OST)
 * at the requested explicit scope:
 * - 'episode': updates only the target episode in seriesId (leaves sibling episodes & folders untouched)
 * - 'folder' | 'series': updates seriesId.videoEditSettings and all episodes in seriesId (leaves other folders untouched)
 * - 'global': updates global_video_edit_settings.json AND all project folders & episodes
 *
 * Strictly preserves scriptData, audio references, timeline edits, and unrelated settings.
 */
async function applyScopedVideoEditSettings(seriesId, episodeId, settings, options = {}) {
  const rawScope = String(options.scope || 'folder').toLowerCase();
  const scope = rawScope === 'series' ? 'folder' : (['episode', 'folder', 'global'].includes(rawScope) ? rawScope : 'folder');
  const projectsDir = options.projectsDir || PROJECTS_DIR;
  const updatedAt = Math.max(Date.now(), Number(options.updatedAt) || 0);
  const normalizedEdit = normalizeVideoEditSettings(settings);
  const scopedRecord = { ...normalizedEdit, updatedAt };

  const updatedSeriesIds = [];
  let updatedEpisodeCount = 0;
  let primarySeries = null;

  if (scope === 'global') {
    writeGlobalVideoEditSettings(normalizedEdit, {
      updatedAt,
      storagePath: options.videoEditStoragePath,
    });

    if (fs.existsSync(projectsDir)) {
      const entries = fs.readdirSync(projectsDir, { withFileTypes: true }).filter((e) => e.isDirectory());
      for (const ent of entries) {
        const sId = ent.name;
        const metaPath = path.join(projectsDir, sId, 'series.json');
        if (!fs.existsSync(metaPath)) continue;
        const saved = await withSeriesMetadataLock(sId, () => {
          return updateSeriesMetadata(sId, (freshSeries) => {
            if (!freshSeries) return false;
            freshSeries.videoEditSettings = { ...scopedRecord };
            if (Array.isArray(freshSeries.episodes)) {
              for (const ep of freshSeries.episodes) {
                if (applyVideoEditPatchToEpisode(ep, normalizedEdit, 'global', updatedAt)) {
                  updatedEpisodeCount++;
                }
              }
            }
            return true;
          }, { projectsDir, skipHydration: true });
        }, { projectsDir });
        if (saved) {
          updatedSeriesIds.push(saved.id || sId);
          if (seriesId && sanitizeProjectName(seriesId) === sanitizeProjectName(sId)) {
            primarySeries = saved;
          }
        }
      }
    }

    return {
      success: true,
      scope: 'global',
      settings: normalizedEdit,
      updatedAt,
      updatedSeriesIds,
      updatedEpisodeCount,
      series: primarySeries,
    };
  }

  if (!seriesId) {
    throw new Error('seriesId is required for folder or episode video-edit scope');
  }

  const cleanSeries = sanitizeProjectName(seriesId);
  const savedSeries = await withSeriesMetadataLock(cleanSeries, () => {
    return updateSeriesMetadata(cleanSeries, (freshSeries) => {
      if (!freshSeries) return false;
      if (scope === 'folder') {
        freshSeries.videoEditSettings = { ...scopedRecord };
        if (Array.isArray(freshSeries.episodes)) {
          for (const ep of freshSeries.episodes) {
            if (applyVideoEditPatchToEpisode(ep, normalizedEdit, 'folder', updatedAt)) {
              updatedEpisodeCount++;
            }
          }
        }
        return true;
      }

      // scope === 'episode'
      const cleanEp = episodeId ? sanitizeEpisodeId(episodeId) : null;
      const targetEp = Array.isArray(freshSeries.episodes)
        ? freshSeries.episodes.find((e) => (cleanEp && sanitizeEpisodeId(e.id) === cleanEp) || String(e.id) === String(episodeId))
        : null;
      if (!targetEp) return false;
      if (applyVideoEditPatchToEpisode(targetEp, normalizedEdit, 'episode', updatedAt)) {
        updatedEpisodeCount++;
      }
      return true;
    }, { projectsDir, skipHydration: true });
  }, { projectsDir });

  if (!savedSeries) {
    throw new Error(`Series "${cleanSeries}" or episode "${episodeId}" not found`);
  }

  return {
    success: true,
    scope,
    settings: normalizedEdit,
    updatedAt,
    updatedSeriesIds: [cleanSeries],
    updatedEpisodeCount,
    series: savedSeries,
  };
}

module.exports = {
  getNextAvailableEpisodeNumber,
  generateUniqueEpisodeId,
  createEpisode,
  sanitizeSeriesEpisodes,
  sanitizeRenderedVideoRef,
  ensureEpisodeDirectories,
  getSeriesMetadata,
  saveSeriesMetadata,
  updateSeriesMetadata,
  withSeriesMetadataLock,
  persistEpisodeScriptData,
  persistEpisodeTimelineOperation,
  syncSeriesMetadataSafely,
  resetHydrationLogForTesting,
  createNewEpisode,
  deleteEpisode,
  deleteSeries,
  renameSeries,
  resolveUniqueSeriesFolderId,
  sanitizeSeriesFolderBaseName,
  rewriteSeriesIdReferences,
  resetEpisodeState,
  getInheritedVideoEditSettings,
  applyScopedVideoEditSettings,
};
