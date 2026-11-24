const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), override: true });
require("dotenv").config({ path: path.join(__dirname, ".env"), override: true });
const dns = require("dns");
try {
  dns.setDefaultResultOrder("ipv4first");
} catch (_) {}

let isServerReady = false;

// Global process crash prevention handlers: fail-fast during startup, resilient once running
process.on("uncaughtException", (err) => {
  if (!isServerReady) {
    console.error("[CRITICAL] Startup Exception:", err);
    process.exit(1);
  } else {
    console.error("[Backend Guard] ⚠️ Caught uncaughtException (prevented server crash):", err?.stack || err?.message || err);
  }
});

process.on("unhandledRejection", (reason, promise) => {
  if (!isServerReady) {
    console.error("[CRITICAL] Startup Unhandled Rejection at:", promise, "reason:", reason);
    process.exit(1);
  } else {
    console.error("[Backend Guard] ⚠️ Caught unhandledRejection (prevented server crash):", reason?.stack || reason?.message || reason);
  }
});

const express = require("express");
const cors = require("cors");
const { uploadsDir, isSafeUploadPath, safeDecodeURI, resolveMediaFile } = require("./utils/pathUtils.js");
const { productionJobQueue } = require("./services/pipeline/productionJobQueue.js");
const { ensurePipelineWorkerRegistered } = require("./services/pipeline/jobWorker.js");

// Middlewares & Modular Route Handlers
const { registerLiveDotenvFiles } = require("./services/geminiKeyManager.js");
const { killAllProcesses } = require("./utils/processRegistry.js");
const { cancelAllBatchExportJobs } = require("./services/batchExportService.js");
const { validateJsonBodyEnvelope } = require("./middleware/validateRequest.js");
const mediaStreamMiddleware = require("./middleware/mediaStream.js");
const systemRoutes = require("./routes/systemRoutes.js");
const scriptRoutes = require("./routes/scriptRoutes.js");
const audioRoutes = require("./routes/audioRoutes.js");
const videoRoutes = require("./routes/videoRoutes.js");
const jobRoutes = require("./routes/jobRoutes.js");
const seriesRoutes = require("./routes/seriesRoutes.js");

const app = express();
const PORT = process.env.PORT || 5000;

// Scoped JSON body parsers: 5MB standard limit, 50MB strictly for project/subtitle/series sync endpoints
const standardJsonParser = express.json({ limit: "5mb" });
const highPayloadJsonParser = express.json({ limit: "50mb" });
const highPayloadUrlEncodedParser = express.urlencoded({ extended: true, limit: "50mb" });

// Enable CORS & scoped JSON parsing
app.use(cors());
app.use("/api/series", highPayloadJsonParser, highPayloadUrlEncodedParser);
app.use("/api", highPayloadJsonParser, highPayloadUrlEncodedParser);
app.use(standardJsonParser);
app.use(express.urlencoded({ extended: true, limit: "5mb" }));
app.use(validateJsonBodyEnvelope);

// 1. Resilient Media Streaming & Static Uploads
app.use("/uploads", mediaStreamMiddleware);

// 2. Modular API Routes
app.use("/api", systemRoutes);
app.use("/api", scriptRoutes);
app.use("/api", audioRoutes);
app.use(["/api", "/api/video"], videoRoutes);
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
  // Enable live .env key hot-reload (when GEMINI_API_KEY* is edited in .env while server runs)
  try {
    registerLiveDotenvFiles([
      path.join(__dirname, "..", ".env"),
      path.join(__dirname, ".env"),
    ]);
  } catch (envSyncErr) {
    console.warn("[Server Startup] ⚠️ Live .env key sync setup warning:", envSyncErr.message);
  }

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

  // Startup Demucs Cleanup: Non-blocking sweep for orphaned Python demucs workers left by a previous crash/restart
  // (runs asynchronously so port 5000 binds immediately without 1-3s ECONNREFUSED/502 startup downtime)
  try {
    const audioSeparationService = require("./services/audioSeparationService");
    if (typeof audioSeparationService.killAllDemucsSystemProcessesAsync === "function") {
      audioSeparationService.killAllDemucsSystemProcessesAsync().catch(() => {});
    } else {
      audioSeparationService.killAllDemucsSystemProcesses();
    }
  } catch (_) {}

  // Register canonical pipeline worker BEFORE listening so queued/recovered jobs start cleanly in worker slots
  ensurePipelineWorkerRegistered(productionJobQueue);

  const startListen = (retries = 5) => {
    server = app.listen(PORT, "0.0.0.0", () => {
      isServerReady = true;
      console.log(`🚀 Khmer AI Dubbing Backend running on http://localhost:${PORT}`);
    });
    server.requestTimeout = 0;
    server.setTimeout(0);
    server.keepAliveTimeout = 1800000;
    server.headersTimeout = 1800000;

    server.on("error", (err) => {
      if (err.code === "EADDRINUSE" && retries > 0) {
        console.warn(`[Server] Port ${PORT} busy (EADDRINUSE), retrying in 500ms (${retries} retries left)...`);
        setTimeout(() => {
          startListen(retries - 1);
        }, 500);
      } else {
        console.error("[CRITICAL] Server listen error:", err);
      }
    });
  };

  startListen();

  let isShuttingDown = false;
  const handleShutdown = () => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    try {
      cancelAllBatchExportJobs();
    } catch (_) {}

    try {
      killAllProcesses();
    } catch (_) {}

    if (typeof jobRoutes.closeAllJobStreams === "function") {
      jobRoutes.closeAllJobStreams();
    }

    if (server) {
      const forceExitTimer = setTimeout(() => {
        process.exit(0);
      }, 300);

      server.close(() => {
        clearTimeout(forceExitTimer);
        process.exit(0);
      });
      if (typeof server.closeIdleConnections === "function") {
        server.closeIdleConnections();
      }
      if (typeof server.closeAllConnections === "function") {
        server.closeAllConnections();
      }
    } else {
      process.exit(0);
    }
  };
  process.on("SIGINT", handleShutdown);
  process.on("SIGTERM", handleShutdown);
}

module.exports = { app, server, isSafeUploadPath, safeDecodeURI, resolveMediaFile };

