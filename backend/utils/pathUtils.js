const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const uploadsDir = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

/**
 * Computes SHA-256 hash of a file for caching and integrity checks
 */
function getFileSha256(filePath) {
  try {
    const fileBuffer = fs.readFileSync(filePath);
    return crypto.createHash("sha256").update(fileBuffer).digest("hex");
  } catch {
    return null;
  }
}

/**
 * Safely decodes a URI component up to 3 times to unwrap single or double-encoded traversal sequences (%252e%252e -> %2e%2e -> ..)
 */
function safeDecodeURI(uri) {
  if (typeof uri !== "string") return "";
  let prev = uri;
  let decoded = uri;
  for (let i = 0; i < 3; i++) {
    try {
      decoded = decodeURIComponent(prev);
      if (decoded === prev) break;
      prev = decoded;
    } catch (_) {
      break;
    }
  }
  return decoded;
}

/**
 * Validates that candidatePath is strictly contained within baseDir,
 * resolving symlinks and normalizing separators/casing on Windows.
 */
function isSafeUploadPath(candidatePath, baseDir = uploadsDir) {
  if (!candidatePath || typeof candidatePath !== "string") return false;
  if (candidatePath.includes("\0")) return false;

  try {
    const canonicalBase = fs.realpathSync(path.resolve(baseDir));
    let canonicalTarget;
    if (fs.existsSync(candidatePath)) {
      canonicalTarget = fs.realpathSync(path.resolve(candidatePath));
    } else {
      canonicalTarget = path.resolve(candidatePath);
    }

    const normBase = process.platform === "win32" ? canonicalBase.toLowerCase() : canonicalBase;
    const normTarget = process.platform === "win32" ? canonicalTarget.toLowerCase() : canonicalTarget;

    const rel = path.relative(normBase, normTarget);
    // Target must be strictly inside base (not equal to base itself, not escaping with '..', not absolute)
    if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
      return false;
    }

    // Disallow dotfiles / hidden folders anywhere in the relative path (e.g. .env, .git/config)
    const relParts = rel.split(/[\\/]/);
    if (relParts.some((part) => part.startsWith("."))) {
      return false;
    }

    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Clean & sanitize project / drama name for folder & file paths
 */
function sanitizeProjectName(name) {
  if (!name) return "drama_project";
  let decoded = name;
  try {
    const candidate = Buffer.from(name, "latin1").toString("utf8");
    if (candidate && candidate !== name && !candidate.includes("\uFFFD")) {
      decoded = candidate;
    }
  } catch (_) {}

  const ext = path.extname(decoded).toLowerCase();
  const KNOWN_EXTS = [".mp4", ".mkv", ".avi", ".mov", ".webm", ".ts", ".flv", ".wmv", ".m4v", ".3gp"];
  const base = KNOWN_EXTS.includes(ext) ? path.basename(decoded, ext) : path.basename(decoded);
  const cleaned = base
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[\uD800-\uDFFF]/g, "")
    .replace(/[/\\?%*:|"<>~#&!$;^{}`]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .trim();
  return cleaned || "drama_project";
}

function sanitizeEpisodeId(id) {
  if (!id) return "ep_1";
  const cleaned = String(id)
    .replace(/[/\\?%*:|"<>~#&!$;^{}`\s]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .trim();
  return cleaned || "ep_1";
}

/**
 * Ensure project folder structure exists:
 * For Episodes:
 * uploads/projects/<seriesName>/episodes/<episodeId>/
 *   ├── video/
 *   ├── audio/
 *   └── subtitles/
 */
function ensureProjectDirs(projectName, episodeId = null, seriesId = null) {
  const cleanSeries = sanitizeProjectName(seriesId || projectName || "drama_project");

  if (episodeId) {
    const cleanEpisode = sanitizeEpisodeId(episodeId);
    const seriesDir = path.join(uploadsDir, "projects", cleanSeries);
    const episodeDir = path.join(seriesDir, "episodes", cleanEpisode);
    const videoDir = path.join(episodeDir, "video");
    const audioDir = path.join(episodeDir, "audio");
    const subDir = path.join(episodeDir, "subtitles");

    if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir, { recursive: true });
    if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });
    if (!fs.existsSync(subDir)) fs.mkdirSync(subDir, { recursive: true });

    return {
      projectDir: episodeDir,
      seriesDir,
      episodeDir,
      videoDir,
      audioDir,
      subDir,
      cleanName: `${cleanSeries}_${cleanEpisode}`,
      cleanSeries,
      cleanEpisode,
      isEpisode: true,
    };
  }

  // Fallback for non-episode single project structure (100% backwards compatible)
  const projectDir = path.join(uploadsDir, "projects", cleanSeries);
  const videoDir = path.join(projectDir, "video");
  const audioDir = path.join(projectDir, "audio");
  const subDir = path.join(projectDir, "subtitles");

  if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir, { recursive: true });
  if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });
  if (!fs.existsSync(subDir)) fs.mkdirSync(subDir, { recursive: true });

  return {
    projectDir,
    seriesDir: projectDir,
    episodeDir: projectDir,
    videoDir,
    audioDir,
    subDir,
    cleanName: cleanSeries,
    cleanSeries,
    cleanEpisode: null,
    isEpisode: false,
  };
}

/**
 * Robust media resolver: finds media files in project subdirectories, episode directories, or uploads root
 */
function resolveMediaFile(filePathOrRel) {
  if (!filePathOrRel) return null;
  const cleanInput = String(filePathOrRel).split("?")[0].split("#")[0];
  if (path.isAbsolute(cleanInput) && fs.existsSync(cleanInput)) {
    return cleanInput;
  }
  const normRel = cleanInput.replace(/^[/\\]?uploads[/\\]?/i, "");
  const directInUploads = path.join(uploadsDir, normRel);
  if (fs.existsSync(directInUploads)) return directInUploads;

  const rawInUploads = path.join(uploadsDir, cleanInput);
  if (fs.existsSync(rawInUploads)) return rawInUploads;

  const cleanBase = path.basename(cleanInput);
  const inRoot = path.join(uploadsDir, cleanBase);
  if (fs.existsSync(inRoot)) return inRoot;

  // Search projects directory (including episode subdirectories)
  const projectsDir = path.join(uploadsDir, "projects");
  if (fs.existsSync(projectsDir)) {
    try {
      const items = fs.readdirSync(projectsDir, { withFileTypes: true });
      for (const item of items) {
        if (item.isDirectory()) {
          const seriesPath = path.join(projectsDir, item.name);
          const directPaths = [
            path.join(seriesPath, "video", cleanBase),
            path.join(seriesPath, "audio", cleanBase),
            path.join(seriesPath, "subtitles", cleanBase),
            path.join(seriesPath, cleanBase),
          ];
          for (const tp of directPaths) {
            if (fs.existsSync(tp)) return tp;
          }

          // Check episodes subdirectories
          const epSubdir = path.join(seriesPath, "episodes");
          if (fs.existsSync(epSubdir)) {
            const epItems = fs.readdirSync(epSubdir, { withFileTypes: true });
            for (const epItem of epItems) {
              if (epItem.isDirectory()) {
                const epPath = path.join(epSubdir, epItem.name);
                const epTestPaths = [
                  path.join(epPath, "video", cleanBase),
                  path.join(epPath, "audio", cleanBase),
                  path.join(epPath, "subtitles", cleanBase),
                  path.join(epPath, cleanBase),
                ];
                for (const etp of epTestPaths) {
                  if (fs.existsSync(etp)) return etp;
                }
              }
            }
          }
        }
      }
    } catch {}
  }
  return directInUploads;
}

/**
 * Safely decodes multipart form filenames that may have been read as Latin-1 by Multer.
 */
function decodeMultipartFilename(name) {
  if (!name || typeof name !== "string") return "";
  try {
    const candidate = Buffer.from(name, "latin1").toString("utf8");
    if (candidate && candidate !== name && !candidate.includes("\uFFFD")) {
      return candidate;
    }
  } catch (_) {}
  return name;
}

module.exports = {
  uploadsDir,
  getFileSha256,
  safeDecodeURI,
  isSafeUploadPath,
  sanitizeProjectName,
  sanitizeEpisodeId,
  ensureProjectDirs,
  resolveMediaFile,
  decodeMultipartFilename,
};

