const express = require("express");
const fs = require("fs");
const path = require("path");
const { uploadsDir, safeDecodeURI, isSafeUploadPath, resolveMediaFile } = require("../utils/pathUtils");

const router = express.Router();

// Resilient Media Streamer for /uploads (Prevents HTTP 416 Range Not Satisfiable crashes during live playback & regeneration)
router.get(/^\/(.+\.(?:mp3|wav|ogg|m4a|aac|mp4|webm|mov))$/i, (req, res, next) => {
  const rawParam = req.params[0] || "";
  const reqRelPath = safeDecodeURI(rawParam);
  if (!reqRelPath || reqRelPath.includes("\0")) {
    return res.status(400).send("Invalid path");
  }

  // Pre-containment validation: resolve against uploads root
  const directPath = path.resolve(uploadsDir, reqRelPath);
  if (!isSafeUploadPath(directPath, uploadsDir)) {
    return res.status(403).send("Forbidden: Access denied");
  }

  let filePath = directPath;
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    const resolved = resolveMediaFile(reqRelPath);
    if (resolved && fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      if (!isSafeUploadPath(resolved, uploadsDir)) {
        return res.status(403).send("Forbidden: Access denied");
      }
      filePath = resolved;
    } else {
      return next();
    }
  }

  // Canonical containment check on final file
  if (!isSafeUploadPath(filePath, uploadsDir)) {
    return res.status(403).send("Forbidden: Access denied");
  }

  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (_) {
    return next();
  }

  const fileSize = stat.size;
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
  };
  const contentType = mimeTypes[ext] || "application/octet-stream";
  const isVideo = ext === ".mp4" || ext === ".webm" || ext === ".mov";
  const isLargeWav = ext === ".wav" && fileSize > 4 * 1024 * 1024;
  const isStreamedMedia = isVideo || isLargeWav;
  const etag = `"${fileSize.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const lastModified = stat.mtime.toUTCString();
  // CRITICAL: Large byte-range media (.mp4/.webm/.mov and >4MB .wav) MUST use Cache-Control: no-store
  // to bypass Chromium's single-writer HttpCache entry lock across concurrent/throttled 206 seeks
  // (prevents 3.5s-infinite respMs stalls when seeking while a previous range stream is open).
  const baseHeaders = isStreamedMedia
    ? {
        "Content-Type": contentType,
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
      }
    : {
        "Content-Type": contentType,
        "Accept-Ranges": "bytes",
        "ETag": etag,
        "Last-Modified": lastModified,
        "Cache-Control": "public, max-age=3600",
      };

  res.setHeader("Accept-Ranges", "bytes");

  // If file is 0 bytes (e.g. freshly created)
  if (fileSize === 0) {
    res.writeHead(200, {
      ...baseHeaders,
      "Content-Length": 0,
    });
    return res.end();
  }

  const range = req.headers.range;
  if (!range) {
    res.writeHead(200, {
      ...baseHeaders,
      "Content-Length": fileSize,
    });
    if (req.method === "HEAD") return res.end();
    const s = fs.createReadStream(filePath);
    res.on('close', () => { if (!res.writableEnded) s.destroy(); });
    s.on('error', () => { if (!res.headersSent) res.status(500).end(); else res.end(); });
    return s.pipe(res);
  }

  const parts = range.replace(/bytes=/, "").split("-");
  const start = parseInt(parts[0], 10);
  const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

  if (isNaN(start) || start >= fileSize || start < 0) {
    res.writeHead(200, {
      ...baseHeaders,
      "Content-Length": fileSize,
    });
    if (req.method === "HEAD") return res.end();
    const s = fs.createReadStream(filePath);
    res.on('close', () => { if (!res.writableEnded) s.destroy(); });
    s.on('error', () => { if (!res.headersSent) res.status(500).end(); else res.end(); });
    return s.pipe(res);
  }

  // 🎥 Media Stream Optimization:
  // - Video open-ended ranges (bytes=start-) capped at 8MB so long 1080p GOPs (e.g. 8.5s / ~4MB)
  //   complete in a single 206 round-trip with zero multi-chunk seek stalls.
  // - Large WAV open-ended ranges (e.g. 100MB+ Demucs no_vocals.wav) capped at 4MB so an audio
  //   element never hogs an HTTP/1.1 connection streaming 100MB on every seek.
  const VIDEO_CHUNK_SIZE = 8 * 1024 * 1024; // 8MB covers 2+ full 1080p GOPs in 1 request
  const WAV_CHUNK_SIZE = 4 * 1024 * 1024;   // 4MB (~22s stereo PCM) prevents 100MB socket hogging
  let effectiveEnd = isNaN(end) ? fileSize - 1 : end;
  if (!parts[1] && isVideo) {
    effectiveEnd = Math.min(start + VIDEO_CHUNK_SIZE - 1, fileSize - 1);
  } else if (!parts[1] && isLargeWav) {
    effectiveEnd = Math.min(start + WAV_CHUNK_SIZE - 1, fileSize - 1);
  }
  const clampedEnd = Math.min(effectiveEnd, fileSize - 1);
  const chunksize = (clampedEnd - start) + 1;

  res.writeHead(206, {
    ...baseHeaders,
    "Content-Range": `bytes ${start}-${clampedEnd}/${fileSize}`,
    "Content-Length": chunksize,
  });

  if (req.method === "HEAD") return res.end();

  const fileStream = fs.createReadStream(filePath, { start, end: clampedEnd });

  res.on('close', () => {
    if (!res.writableEnded) fileStream.destroy();
  });

  fileStream.on('error', () => {
    if (!res.headersSent) {
      res.status(500).end();
    } else {
      res.end();
    }
  });

  fileStream.pipe(res);
});

// Standard static files middleware
router.use(express.static(uploadsDir));

// Fallback resolver: if direct path is not found by express.static, search with resolveMediaFile
router.get("/*", (req, res, next) => {
  const rawParam = req.params[0] || "";
  const reqRelPath = safeDecodeURI(rawParam);
  if (!reqRelPath || reqRelPath.includes("\0")) return next();

  const directPath = path.resolve(uploadsDir, reqRelPath);
  if (!isSafeUploadPath(directPath, uploadsDir)) {
    return res.status(403).send("Forbidden: Access denied");
  }

  if (fs.existsSync(directPath) && fs.statSync(directPath).isFile()) {
    return res.sendFile(directPath);
  }

  const resolved = resolveMediaFile(reqRelPath);
  if (resolved) {
    if (!isSafeUploadPath(resolved, uploadsDir)) {
      return res.status(403).send("Forbidden: Access denied");
    }
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      return res.sendFile(resolved);
    }
  }
  next();
});

module.exports = router;

