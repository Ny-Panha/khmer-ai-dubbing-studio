const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), override: true });
require("dotenv").config({ path: path.join(__dirname, ".env"), override: true });
const dns = require("dns");
try {
  dns.setDefaultResultOrder("ipv4first");
} catch (_) {}

// Global process crash prevention handlers
process.on("uncaughtException", (err) => {
  console.error("[CRITICAL] Uncaught Exception:", err);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("[CRITICAL] Unhandled Rejection at:", promise, "reason:", reason);
});

const express = require("express");
const cors = require("cors");
const { uploadsDir, isSafeUploadPath, safeDecodeURI, resolveMediaFile } = require("./utils/pathUtils.js");
const { productionJobQueue } = require("./services/pipeline/productionJobQueue.js");

// Middlewares & Modular Route Handlers
const mediaStreamMiddleware = require("./middleware/mediaStream.js");
const systemRoutes = require("./routes/systemRoutes.js");
const scriptRoutes = require("./routes/scriptRoutes.js");
const audioRoutes = require("./routes/audioRoutes.js");
const videoRoutes = require("./routes/videoRoutes.js");
const jobRoutes = require("./routes/jobRoutes.js");
const seriesRoutes = require("./routes/seriesRoutes.js");

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS & JSON parsing
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// 1. Resilient Media Streaming & Static Uploads
app.use("/uploads", mediaStreamMiddleware);

// 2. Modular API Routes
app.use("/api", systemRoutes);
app.use("/api", scriptRoutes);
app.use("/api", audioRoutes);
app.use("/api", videoRoutes);
app.use("/api/jobs", jobRoutes);
app.use("/api/series", seriesRoutes);

// Global Error Handler
app.use((err, req, res, next) => {
  console.error("[Global Error Caught]:", err);
  if (!res.headersSent) {
    res.status(500).json({ success: false, error: err.message || "Internal Server Error" });
  }
});

// Start Server
let server = null;
if (require.main === module) {
  // Startup Crash Recovery: Scan and recover any dangling/interrupted jobs
  try {
    console.log("[Server Startup] 🔍 Running dangling jobs crash recovery check...");
    const recoveryResult = productionJobQueue.recoverDanglingJobs({
      baseUploadsDir: uploadsDir,
    });
    console.log(
      `[Server Startup] ✅ Crash recovery complete: ${recoveryResult.recoveredCount} recovered to queue, ${recoveryResult.failedCount} marked failed, ${recoveryResult.untouchedCount} untouched (Total: ${recoveryResult.totalScanned}).`
    );
  } catch (recErr) {
    console.warn("[Server Startup] ⚠️ Crash recovery warning:", recErr.message);
  }

  server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Khmer AI Dubbing Backend running on http://localhost:${PORT}`);
  });
  server.requestTimeout = 0;
  server.setTimeout(0);
  server.keepAliveTimeout = 1800000;
  server.headersTimeout = 1800000;
}

module.exports = { app, server, isSafeUploadPath, safeDecodeURI, resolveMediaFile };
