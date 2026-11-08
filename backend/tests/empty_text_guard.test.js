const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');

const audioRoutes = require('../routes/audioRoutes');

test('Empty Text Guard: Static code audit of Frontend and Backend', () => {
  const audioDubbingPath = path.resolve(__dirname, '../../frontend/src/hooks/useAudioDubbing.js');
  const clipInspectorPath = path.resolve(__dirname, '../../frontend/src/components/voice/ClipInspectorPanel.jsx');
  const scriptReviewPath = path.resolve(__dirname, '../../frontend/src/components/media/ScriptReviewTab.jsx');
  const audioRoutesPath = path.resolve(__dirname, '../routes/audioRoutes.js');

  const audioDubbingCode = fs.readFileSync(audioDubbingPath, 'utf8');
  const clipInspectorCode = fs.readFileSync(clipInspectorPath, 'utf8');
  const scriptReviewCode = fs.readFileSync(scriptReviewPath, 'utf8');
  const audioRoutesCode = fs.readFileSync(audioRoutesPath, 'utf8');

  // 1. useAudioDubbing.js audit
  assert.ok(audioDubbingCode.includes('គ្មានអត្ថបទខ្មែរទេ — សូមបកប្រែ ឬវាយអត្ថបទសិន'), 'useAudioDubbing must alert Khmer message when text is empty');
  assert.ok(audioDubbingCode.includes('inspector-khmer-textarea'), 'useAudioDubbing must focus inspector-khmer-textarea');
  assert.ok(audioDubbingCode.includes('skippedEmptyCount'), 'useAudioDubbing batch generation must track skippedEmptyCount');
  assert.ok(audioDubbingCode.includes('validSegments = sanitizedSegments.filter'), 'useAudioDubbing batch generation must filter validSegments');

  // 2. ClipInspectorPanel.jsx audit
  assert.ok(clipInspectorCode.includes('inspector-khmer-textarea'), 'ClipInspectorPanel must have id="inspector-khmer-textarea"');
  assert.ok(clipInspectorCode.includes('isKhmerEmpty'), 'ClipInspectorPanel must compute isKhmerEmpty');
  assert.ok(clipInspectorCode.includes('មិនអាចបង្កើតសំឡេងបានទេ — គ្មានអត្ថបទខ្មែរ (Missing text)'), 'ClipInspectorPanel must display tooltip on disabled button');

  // 3. ScriptReviewTab.jsx audit
  assert.ok(scriptReviewCode.includes('isTextEmpty'), 'ScriptReviewTab must compute isTextEmpty');
  assert.ok(scriptReviewCode.includes('ខ្វះអត្ថបទ'), 'ScriptReviewTab must show missing text badge');
  assert.ok(scriptReviewCode.includes('filterMode'), 'ScriptReviewTab must support filterMode');
  assert.ok(scriptReviewCode.includes('missingTextCount'), 'ScriptReviewTab must calculate missingTextCount');

  // 4. audioRoutes.js audit
  assert.ok(audioRoutesCode.includes('res.status(400)'), 'audioRoutes must return 400 for empty text');
  assert.ok(audioRoutesCode.includes('គ្មានអត្ថបទខ្មែរទេ — សូមបកប្រែ ឬវាយអត្ថបទសិន'), 'audioRoutes must return clear Khmer error message');
});

test('Empty Text Guard: HTTP 400 returned on empty segment text', async () => {
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
      if (ep2 && Array.isArray(ep2.scriptSegments)) {
        const seg5 = ep2.scriptSegments.find((s) => s.id === 5 || s.index === 5);
        if (seg5) {
          const resEp2 = await fetch(baseUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              segment: seg5,
              seriesId: 'series_1793898268958',
              episodeId: 'ep_2',
            }),
          });
          assert.equal(resEp2.status, 400, 'EP2 segment #5 must return HTTP 400');
          const bodyEp2 = await resEp2.json();
          assert.equal(bodyEp2.success, false);
          assert.ok(bodyEp2.error.includes('គ្មានអត្ថបទខ្មែរទេ'), 'EP2 segment #5 must return Khmer empty-text error');
        }
      }
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

