const { test, describe } = require("node:test");
const assert = require("node:assert");
const express = require("express");
const videoRoutes = require("../routes/videoRoutes");

describe("Video Framing API Routes (Aliases & Endpoint Resolution)", () => {
  const app = express();
  app.use(express.json());
  app.use(["/api", "/api/video"], videoRoutes);

  test("1. POST /api/video/update-framing-keyframes resolves without 404", async () => {
    const server = app.listen(0);
    const port = server.address().port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/video/update-framing-keyframes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      assert.notStrictEqual(res.status, 404, "Must not return 404 Not Found");
      assert.strictEqual(res.status, 400, "Should return 400 Bad Request for empty payload");
    } finally {
      server.close();
    }
  });

  test("2. POST /api/update-framing-keyframes resolves without 404", async () => {
    const server = app.listen(0);
    const port = server.address().port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/update-framing-keyframes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      assert.notStrictEqual(res.status, 404, "Must not return 404 Not Found");
      assert.strictEqual(res.status, 400, "Should return 400 Bad Request for empty payload");
    } finally {
      server.close();
    }
  });

  test("3. POST /api/video/update-segment-crop resolves without 404", async () => {
    const server = app.listen(0);
    const port = server.address().port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/video/update-segment-crop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      assert.notStrictEqual(res.status, 404, "Must not return 404 Not Found");
      assert.strictEqual(res.status, 400, "Should return 400 Bad Request for empty payload");
    } finally {
      server.close();
    }
  });

  test("4. POST /api/video/analyze-framing resolves without 404", async () => {
    const server = app.listen(0);
    const port = server.address().port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/video/analyze-framing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      assert.notStrictEqual(res.status, 404, "Must not return 404 Not Found");
      assert.strictEqual(res.status, 400, "Should return 400 Bad Request for empty payload");
    } finally {
      server.close();
    }
  });
});

