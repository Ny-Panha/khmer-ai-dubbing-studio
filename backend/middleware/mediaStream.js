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

  res.setHeader("Accept-Ranges", "bytes");

  // If file is 0 bytes (e.g. freshly created)
  if (fileSize === 0) {
    res.writeHead(200, {
      "Content-Length": 0,
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
    });
    return res.end();
  }

  const range = req.headers.range;
  if (!range) {
    res.writeHead(200, {
      "Content-Length": fileSize,
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
    });
    return fs.createReadStream(filePath).pipe(res);
  }

  const parts = range.replace(/bytes=/, "").split("-");
  const start = parseInt(parts[0], 10);
  const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

  if (isNaN(start) || start >= fileSize || start < 0) {
    res.writeHead(200, {
      "Content-Length": fileSize,
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
    });
    return fs.createReadStream(filePath).pipe(res);
  }

  const clampedEnd = Math.min(isNaN(end) ? fileSize - 1 : end, fileSize - 1);
  const chunksize = (clampedEnd - start) + 1;
  const fileStream = fs.createReadStream(filePath, { start, end: clampedEnd });

  res.writeHead(206, {
    "Content-Range": `bytes ${start}-${clampedEnd}/${fileSize}`,
    "Accept-Ranges": "bytes",
    "Content-Length": chunksize,
    "Content-Type": contentType,
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

