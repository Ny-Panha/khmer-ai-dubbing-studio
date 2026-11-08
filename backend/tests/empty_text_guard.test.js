const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');

const audioRoutes = require('../routes/audioRoutes');
const { cleanTextForTts } = require('../services/ttsService');

test('Empty Text Guard: Static code audit of Frontend and Backend', () => {
  const audioDubbingPath = path.resolve(__dirname, '../../frontend/src/hooks/useAudioDubbing.js');
  const clipInspectorPath = path.resolve(__dirname, '../../frontend/src/components/voice/ClipInspectorPanel.jsx');
  const scriptReviewPath = path.resolve(__dirname, '../../frontend/src/components/media/ScriptReviewTab.jsx');
  const geminiModalPath = path.resolve(__dirname, '../../frontend/src/components/dashboard/GeminiRouteModal.jsx');
  const audioRoutesPath = path.resolve(__dirname, '../routes/audioRoutes.js');
  const ttsServicePath = path.resolve(__dirname, '../services/ttsService.js');
  const stage9Path = path.resolve(__dirname, '../services/pipeline/stages/stage9_generateSegmentTTS.js');

  const audioDubbingCode = fs.readFileSync(audioDubbingPath, 'utf8');
  const clipInspectorCode = fs.readFileSync(clipInspectorPath, 'utf8');
  const scriptReviewCode = fs.readFileSync(scriptReviewPath, 'utf8');
  const geminiModalCode = fs.readFileSync(geminiModalPath, 'utf8');
  const audioRoutesCode = fs.readFileSync(audioRoutesPath, 'utf8');
  const ttsServiceCode = fs.readFileSync(ttsServicePath, 'utf8');
  const stage9Code = fs.readFileSync(stage9Path, 'utf8');

  // 1. useAudioDubbing.js audit
  assert.ok(audioDubbingCode.includes('គ្មានអត្ថបទខ្មែរទេ — សូមបកប្រែ ឬវាយអត្ថបទសិន'), 'useAudioDubbing must alert Khmer message when text is empty');
  assert.ok(audioDubbingCode.includes('inspector-khmer-textarea'), 'useAudioDubbing must focus inspector-khmer-textarea');
  assert.ok(audioDubbingCode.includes('skippedEmptyCount'), 'useAudioDubbing batch generation must track skippedEmptyCount');
  assert.ok(audioDubbingCode.includes('handleTranslateSingleSegment'), 'useAudioDubbing must export handleTranslateSingleSegment');

  // 2. ClipInspectorPanel.jsx audit
  assert.ok(clipInspectorCode.includes('inspector-khmer-textarea'), 'ClipInspectorPanel must have id="inspector-khmer-textarea"');
  assert.ok(clipInspectorCode.includes('isKhmerEmpty'), 'ClipInspectorPanel must compute isKhmerEmpty');
  assert.ok(clipInspectorCode.includes('បកប្រែឃ្លានេះ'), 'ClipInspectorPanel must show one-click translate button');
  assert.ok(clipInspectorCode.includes('handleTranslateThisLine'), 'ClipInspectorPanel must define handleTranslateThisLine');

  // 3. ScriptReviewTab.jsx audit
  assert.ok(scriptReviewCode.includes('isTextEmpty'), 'ScriptReviewTab must compute isTextEmpty');
  assert.ok(scriptReviewCode.includes('ខ្វះអត្ថបទ'), 'ScriptReviewTab must show missing text badge');
  assert.ok(scriptReviewCode.includes('filterMode'), 'ScriptReviewTab must support filterMode');
  assert.ok(scriptReviewCode.includes('missingTextCount'), 'ScriptReviewTab must calculate missingTextCount');
  assert.ok(scriptReviewCode.includes('បកប្រែឃ្លានេះ'), 'ScriptReviewTab must show one-click translate button');
  assert.ok(scriptReviewCode.includes('handleTranslateLine'), 'ScriptReviewTab must define handleTranslateLine');

  // 4. GeminiRouteModal.jsx audit (Batch & Keys Console STEP 3)
  assert.ok(geminiModalCode.includes('skippedEmpty'), 'GeminiRouteModal must track skippedEmpty count in live logs');
  assert.ok(geminiModalCode.includes('គ្មានអត្ថបទ'), 'GeminiRouteModal must format missing text summary in Khmer');

  // 5. Backend batch guards audit
  assert.ok(audioRoutesCode.includes('res.status(400)'), 'audioRoutes must return 400 for single empty text');
  assert.ok(audioRoutesCode.includes('skippedEmptyCount'), 'audioRoutes batch branch must track skippedEmptyCount');
  assert.ok(audioRoutesCode.includes('summaryMessage'), 'audioRoutes batch branch must return summaryMessage');
  assert.ok(ttsServiceCode.includes('cleanTextForTts(text)'), 'ttsService generateBatchSegmentsAudio must clean and test text');
  assert.ok(stage9Code.includes('cleanTextForTts'), 'stage9_generateSegmentTTS must use cleanTextForTts');
  assert.ok(stage9Code.includes('skippedEmptyCount'), 'stage9_generateSegmentTTS must track skippedEmptyCount');
});

test('Empty Text Guard: HTTP 400 returned on empty single-segment text', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', audioRoutes);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/api/generate-audio`;

  try {
    // 1. Empty string text
    const res1 = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        segment: {
          id: 5,
          index: 5,
          khmer: '',
          khmerText: '',
          khmerTranslatedText: '',
          speaker: 'Speaker 1',
        },
      }),
    });
    assert.equal(res1.status, 400, 'Empty string must return HTTP 400');
    const body1 = await res1.json();
    assert.equal(body1.success, false);
    assert.ok(body1.error.includes('Segment #5 គ្មានអត្ថបទខ្មែរទេ'), 'Must return Khmer error with segment number');

    // 2. Whitespace-only text
    const res2 = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        segment: {
          id: 12,
          khmer: '   \n\t  ',
          khmerText: '',
          speaker: 'Speaker 2',
        },
      }),
    });
    assert.equal(res2.status, 400, 'Whitespace-only text must return HTTP 400');
    const body2 = await res2.json();
    assert.equal(body2.success, false);
    assert.ok(body2.error.includes('Segment #12 គ្មានអត្ថបទខ្មែរទេ'), 'Must return Khmer error with segment number');

    // 3. Null / undefined text
    const res3 = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        segment: {
          id: 1,
          speaker: 'Speaker 1',
        },
      }),
    });
    assert.equal(res3.status, 400, 'Null/missing text must return HTTP 400');
    const body3 = await res3.json();
    assert.equal(body3.success, false);
    assert.ok(body3.error.includes('Segment #1 គ្មានអត្ថបទខ្មែរទេ'));

    // 4. Verification with real series data: ep_2 segment #5 from user repo
    const seriesMetaPath = path.resolve(__dirname, '../uploads/projects/series_1793898268958/series.json');
    if (fs.existsSync(seriesMetaPath)) {
      const meta = JSON.parse(fs.readFileSync(seriesMetaPath, 'utf8'));
      const ep2 = (meta.episodes || []).find((e) => e.id === 'ep_2');
      const segments = ep2?.scriptData?.segments || ep2?.scriptSegments || [];
      const seg5 = segments.find((s) => s.id === 5 || s.index === 5);
      if (seg5) {
        // Clone seg5 with empty Khmer text to simulate the fast_ocr empty-text state
        const emptySeg5 = {
          ...seg5,
          khmer: '',
          khmerText: '',
          khmerTranslatedText: '',
          text: '',
        };
        const resEp2 = await fetch(baseUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            segment: emptySeg5,
            seriesId: 'series_1793898268958',
            episodeId: 'ep_2',
          }),
        });
        assert.equal(resEp2.status, 400, 'EP2 segment #5 with empty text must return HTTP 400');
        const bodyEp2 = await resEp2.json();
        assert.equal(bodyEp2.success, false);
        assert.ok(bodyEp2.error.includes('គ្មានអត្ថបទខ្មែរទេ'), 'EP2 segment #5 must return Khmer empty-text error');
      }
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Empty Text Guard: Batch branch gracefully skips empty segments without throwing 500', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', audioRoutes);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/api/generate-audio`;

  try {
    // 1. Batch where ALL segments are empty -> returns 200 with skipped summary, never fails with 500
    const resAllEmpty = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        segments: [
          { id: 1, khmer: '', chineseText: '你好' },
          { id: 2, khmer: '   ', chineseText: '世界' },
        ],
        seriesId: 'test_empty_series',
        episodeId: 'ep_test',
      }),
    });
    assert.equal(resAllEmpty.status, 200, 'All-empty batch must return 200');
    const dataAllEmpty = await resAllEmpty.json();
    assert.equal(dataAllEmpty.success, true);
    assert.equal(dataAllEmpty.skippedEmptyCount, 2);
    assert.ok(dataAllEmpty.summaryMessage.includes('រំលង 2 ឃ្លា (គ្មានអត្ថបទ)'));

    // 2. Batch with mixed segments (simulating EP2 segment #5 alongside valid segments)
    // Testing with forceRegen=false and existing audio or mock
    const resMixed = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        segments: [
          { id: 1, khmer: 'ជំរាបសួរ', duration: 2 },
          { id: 5, khmer: '', chineseText: '所谓化神自爆', duration: 2 },
        ],
        seriesId: 'test_mixed_series',
        episodeId: 'ep_mixed',
      }),
    });
    assert.equal(resMixed.status, 200, 'Mixed batch must return HTTP 200');
    const dataMixed = await resMixed.json();
    assert.equal(dataMixed.success, true);
    assert.equal(dataMixed.skippedEmptyCount, 1);
    assert.ok(dataMixed.summaryMessage.includes('រំលង 1 ឃ្លា គ្មានអត្ថបទ'));
    const seg5Result = dataMixed.segments.find((s) => s.id === 5);
    assert.equal(seg5Result.ttsStatus, 'empty_text', 'Segment #5 must have ttsStatus empty_text');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
