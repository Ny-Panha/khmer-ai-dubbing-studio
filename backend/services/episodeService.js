const fs = require('fs');
const path = require('path');
const {
  getNextAvailableEpisodeNumber,
  generateUniqueEpisodeId,
  createEpisode,
  sanitizeSeriesEpisodes,
} = require('../models/episodeModel');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const PROJECTS_DIR = path.join(UPLOADS_DIR, 'projects');

// In-memory concurrency locks per series to prevent race conditions during concurrent episode creation
const seriesCreationLocks = new Map();

// In-memory cache for series metadata to prevent event loop freezes on multi-megabyte JSON
const seriesMetadataCache = new Map();

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

/**
 * Load series metadata file (series.json) with in-memory caching and mtime checks
 */
function getSeriesMetadata(seriesId, options = {}) {
  const cleanSeries = sanitizeProjectName(seriesId);
  const seriesDir = path.join(PROJECTS_DIR, cleanSeries);
  const metaPath = path.join(seriesDir, 'series.json');

  if (fs.existsSync(metaPath)) {
    try {
      const stat = fs.statSync(metaPath);
      const cached = seriesMetadataCache.get(cleanSeries);
      // Fast path: return in-memory cached object if file mtime hasn't changed
      if (cached && cached.mtimeMs === stat.mtimeMs && !options.forceDisk) {
        return cached.data;
      }

      const data = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      const sanitized = sanitizeSeriesEpisodes(data);

      // Hydration Check: Auto-recover scriptData from completed jobs on disk if missing
      let needsSave = false;
      if (Array.isArray(sanitized.episodes)) {
        for (const ep of sanitized.episodes) {
          if (!ep.scriptData || !Array.isArray(ep.scriptData.segments) || ep.scriptData.segments.length === 0) {
            const epJobsDir = path.join(seriesDir, 'episodes', ep.id, 'jobs');
            if (fs.existsSync(epJobsDir)) {
              try {
                const jobFiles = fs.readdirSync(epJobsDir).filter((f) => f.endsWith('.json')).sort().reverse();
                for (const jFile of jobFiles) {
                  const jobJson = JSON.parse(fs.readFileSync(path.join(epJobsDir, jFile), 'utf8'));
                  if (jobJson.status === 'completed' && jobJson.finalResult?.segments?.length > 0) {
                    ep.scriptData = {
                      mode: jobJson.config?.mode || jobJson.mode || 'dialogue',
                      genre: jobJson.config?.genre || jobJson.genre || 'auto',
                      segments: jobJson.finalResult.segments,
                      hasScript: true,
                      totalSegments: jobJson.finalResult.segments.length,
                      updatedAt: jobJson.completedAt || Date.now(),
                    };
                    if (ep.status === 'uploaded' || !ep.status) {
                      ep.status = 'translated';
                    }
                    needsSave = true;
                    break;
                  }
                }
              } catch (_) {}
            }
          }

          // Ensure hasScript and totalSegments metadata are always populated when segments exist
          if (ep.scriptData && Array.isArray(ep.scriptData.segments) && ep.scriptData.segments.length > 0) {
            if (!ep.scriptData.hasScript || !ep.scriptData.totalSegments) {
              ep.scriptData.hasScript = true;
              ep.scriptData.totalSegments = ep.scriptData.segments.length;
              if (ep.status === 'uploaded' || !ep.status) {
                ep.status = 'translated';
              }
              needsSave = true;
            }
          }

          // Audio Hydration Check: Auto-detect existing master narration on disk
          const narrationFilename = `${ep.id}_narration_khmer.mp3`;
          const narrationPath = path.join(seriesDir, 'episodes', ep.id, 'audio', narrationFilename);
          if (fs.existsSync(narrationPath)) {
            const relAudioUrl = `/uploads/projects/${cleanSeries}/episodes/${ep.id}/audio/${narrationFilename}`;
            if (!ep.audioGenerated || ep.fullAudioUrl !== relAudioUrl) {
              ep.audioGenerated = true;
              ep.fullAudioUrl = relAudioUrl;
              ep.fullAudioPath = narrationPath;
              ep.hasAudio = true;
              needsSave = true;
            }
          }

          // Segment Audio Auto-Hydration: Auto-detect existing segment mp3 files on disk
          const epAudioDir = path.join(seriesDir, 'episodes', ep.id, 'audio');
          if (fs.existsSync(epAudioDir) && ep.scriptData && Array.isArray(ep.scriptData.segments) && ep.scriptData.segments.length > 0) {
            try {
              const audioFiles = fs.readdirSync(epAudioDir).filter((f) => f.endsWith('.mp3') && !f.includes('_narration_khmer'));
              if (audioFiles.length > 0) {
                // Build fast lookup map: seg_<id> -> filename
                const fileMap = new Map();
                for (const f of audioFiles) {
                  const m = f.match(/seg_(\d+)_/);
                  if (m && m[1]) {
                    fileMap.set(String(m[1]), f);
                  }
                }

                let hydratedCount = 0;
                for (const seg of ep.scriptData.segments) {
                  const sid = String(seg.segmentId || seg.id || '');
                  if (!sid) continue;
                  const matchedFile = fileMap.get(sid);
                  if (matchedFile) {
                    const fullSegAudioPath = path.join(epAudioDir, matchedFile);
                    const relSegAudioUrl = `/uploads/projects/${cleanSeries}/episodes/${ep.id}/audio/${matchedFile}`;
                    if (!seg.audioUrl || !seg.audioPath || seg.ttsStatus !== 'ready') {
                      seg.audioPath = fullSegAudioPath;
                      seg.audioUrl = relSegAudioUrl;
                      seg.audioFile = matchedFile;
                      seg.ttsStatus = 'ready';
                      seg.audioGenerated = true;
                      hydratedCount++;
                      needsSave = true;
                    }
                  }
                }

                if (hydratedCount > 0 || fileMap.size > 0) {
                  if (!ep.audioGenerated || !ep.hasAudio) {
                    ep.audioGenerated = true;
                    ep.hasAudio = true;
                    needsSave = true;
                  }
                }
              }
            } catch (_) {}
          }
        }
      }

      if (needsSave) {
        try {
          fs.writeFileSync(metaPath, JSON.stringify(sanitized), 'utf8');
          const updatedStat = fs.statSync(metaPath);
          seriesMetadataCache.set(cleanSeries, { data: sanitized, mtimeMs: updatedStat.mtimeMs, lastCheckTime: Date.now() });
          return sanitized;
        } catch (_) {}
      }

      seriesMetadataCache.set(cleanSeries, { data: sanitized, mtimeMs: stat.mtimeMs, lastCheckTime: Date.now() });
      return sanitized;
    } catch (_) {}
  }

  // Fallback: discover existing episode directories on disk
  const discoveredEpisodes = [];
  const epBaseDir = path.join(seriesDir, 'episodes');
  if (fs.existsSync(epBaseDir)) {
    try {
      const entries = fs.readdirSync(epBaseDir, { withFileTypes: true });
      for (const ent of entries) {
        if (ent.isDirectory()) {
          const epNumMatch = ent.name.match(/^ep_(\d+)/i);
          const epNum = epNumMatch ? parseInt(epNumMatch[1], 10) : discoveredEpisodes.length + 1;
          discoveredEpisodes.push(createEpisode({
            id: ent.name,
            episodeNumber: epNum,
            title: `ភាគទី ${epNum} (EP${epNum})`,
          }));
        }
      }
    } catch (_) {}
  }

  const fallbackData = {
    id: cleanSeries,
    title: 'រឿងភាគ (Series 1)',
    createdAt: Date.now(),
    glossary: { characters: [], terms: [] },
    episodes: discoveredEpisodes.length > 0 ? discoveredEpisodes : [createEpisode({ episodeNumber: 1 })],
  };
  seriesMetadataCache.set(cleanSeries, { data: fallbackData, mtimeMs: 0, lastCheckTime: Date.now() });
  return fallbackData;
}

/**
 * Save series metadata to series.json (Compact JSON with cache update)
 */
function saveSeriesMetadata(series) {
  if (!series || !series.id) return false;
  const cleanSeries = sanitizeProjectName(series.id);
  const seriesDir = path.join(PROJECTS_DIR, cleanSeries);
  if (!fs.existsSync(seriesDir)) fs.mkdirSync(seriesDir, { recursive: true });

  const sanitized = sanitizeSeriesEpisodes(series);
  const metaPath = path.join(seriesDir, 'series.json');
  fs.writeFileSync(metaPath, JSON.stringify(sanitized), 'utf8');
  try {
    const stat = fs.statSync(metaPath);
    seriesMetadataCache.set(cleanSeries, { data: sanitized, mtimeMs: stat.mtimeMs, lastCheckTime: Date.now() });
  } catch (_) {
    seriesMetadataCache.set(cleanSeries, { data: sanitized, mtimeMs: Date.now(), lastCheckTime: Date.now() });
  }
  return sanitized;
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

  // Concurrency queue lock per series
  let lockPromise = seriesCreationLocks.get(cleanSeries) || Promise.resolve();

  const task = async () => {
    const series = getSeriesMetadata(cleanSeries);
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

    // Ensure completely isolated filesystem directories exist
    ensureEpisodeDirectories(cleanSeries, newEp.id);

    series.episodes = [...existing, newEp];
    saveSeriesMetadata(series);

    console.log(`[EpisodeService] Created Episode #${newEp.episodeNumber} (${newEp.id}) for series "${cleanSeries}".`);
    return newEp;
  };

  const currentTask = lockPromise.then(task, task);
  seriesCreationLocks.set(cleanSeries, currentTask);

  try {
    return await currentTask;
  } finally {
    if (seriesCreationLocks.get(cleanSeries) === currentTask) {
      seriesCreationLocks.delete(cleanSeries);
    }
  }
}

/**
 * Delete an episode while preserving all other episodes and assets
 */
function deleteEpisode(seriesId, episodeId) {
  const cleanSeries = sanitizeProjectName(seriesId);
  const cleanEp = sanitizeEpisodeId(episodeId);

  const series = getSeriesMetadata(cleanSeries);
  if ((series.episodes || []).length <= 1) {
    return { success: false, error: 'Cannot delete the only remaining episode in a series.' };
  }

  const targetEp = series.episodes.find((e) => String(e.id) === cleanEp);
  if (!targetEp) {
    return { success: false, error: `Episode ${cleanEp} not found in series ${cleanSeries}.` };
  }

  // Filter out the deleted episode from metadata
  series.episodes = series.episodes.filter((e) => String(e.id) !== cleanEp);

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

  saveSeriesMetadata(series);

  console.log(`[EpisodeService] Deleted Episode ${cleanEp} from series "${cleanSeries}". Remaining episodes re-indexed sequentially (1..${series.episodes.length}).`);
  return { success: true, remainingEpisodes: series.episodes };
}

module.exports = {
  getNextAvailableEpisodeNumber,
  generateUniqueEpisodeId,
  createEpisode,
  sanitizeSeriesEpisodes,
  ensureEpisodeDirectories,
  getSeriesMetadata,
  saveSeriesMetadata,
  createNewEpisode,
  deleteEpisode,
};
