const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

describe("Auto-Fit Speed Live Console & Episode Card Parity", () => {
  const cardComponentPath = path.resolve(__dirname, "../../frontend/src/components/dashboard/route-runners/EpisodeAutoFitProgressCard.jsx");
  const modalPath = path.resolve(__dirname, "../../frontend/src/components/dashboard/GeminiRouteModal.jsx");
  const audioRoutesPath = path.resolve(__dirname, "../routes/audioRoutes.js");

  test("1. EpisodeAutoFitProgressCard component exists with Live Console Drawer", () => {
    assert.strictEqual(fs.existsSync(cardComponentPath), true, "EpisodeAutoFitProgressCard.jsx must exist");
    const code = fs.readFileSync(cardComponentPath, "utf8");
    assert.ok(code.includes("CONSOLE LOGS (Auto-Fit Speech Speed Engine)"), "Must include console drawer header");
    assert.ok(code.includes("/api/audio/autofit-progress"), "Must poll autofit-progress endpoint");
    assert.ok(code.includes("Terminal"), "Must render Terminal icon");
  });

  test("2. GeminiRouteModal renders EpisodeAutoFitProgressCard in episode cards", () => {
    const code = fs.readFileSync(modalPath, "utf8");
    assert.ok(code.includes("EpisodeAutoFitProgressCard"), "Must import and use EpisodeAutoFitProgressCard");
    assert.ok(code.includes("⚡ 3. Auto-Fit Speed"), "Must render Stage 3 Auto-Fit Speed");
    assert.ok(code.includes("🔇 3. AI បិទសំឡេងចិន"), "Must render Clean BGM");
  });

  test("3. Backend audioRoutes provides GET /audio/autofit-progress and returns logs", () => {
    const code = fs.readFileSync(audioRoutesPath, "utf8");
    assert.ok(code.includes("/audio/autofit-progress"), "Must register GET /audio/autofit-progress");
    assert.ok(code.includes("autoFitProgressMap"), "Must maintain autoFitProgressMap for real-time logs");
  });
});
