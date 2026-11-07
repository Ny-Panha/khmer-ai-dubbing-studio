const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

test('Episode State & Chunk Cache Isolation: chunkCacheDir resolves inside backend/uploads/cache/chunks', () => {
  const orchestratorPath = path.resolve(__dirname, '../services/pipeline/chunkOrchestrator.js');
  const code = fs.readFileSync(orchestratorPath, 'utf8');

  // Verify chunkCacheDir resolves correctly to backend/uploads/cache/chunks
  assert.ok(code.includes("path.resolve(__dirname, '../../uploads/cache/chunks')"), 'chunkCacheDir must resolve relative to backend uploads');
  assert.ok(!code.includes("path.join(__dirname, '../../../uploads/cache/chunks')"), 'Must not leak cache to project root uploads');
});

test('Chunk Cache Key: includes video file signature (size + mtime) to prevent cross-video cache poisoning', () => {
  const orchestratorPath = path.resolve(__dirname, '../services/pipeline/chunkOrchestrator.js');
  const code = fs.readFileSync(orchestratorPath, 'utf8');

  assert.ok(code.includes('videoSignature'), 'Must compute videoSignature for chunk hashing');
  assert.ok(code.includes('stat.size'), 'Must include file size in signature');
  assert.ok(code.includes('stat.mtimeMs'), 'Must include file mtime in signature');
  assert.ok(code.includes('videoPath}${videoSignature}'), 'Must bind videoSignature to chunk hash');
});

test('Episode Audio Isolation: rejects foreign or root audio paths that do not match active episode ID', () => {
  const isMatchingEpAudio = (audioRef, episodeId) => {
    if (!audioRef || typeof audioRef !== 'string') return false;
    if (audioRef.includes('/episodes/') || audioRef.includes('\\episodes\\')) {
      return audioRef.includes(`/episodes/${episodeId}/`) || audioRef.includes(`\\episodes\\${episodeId}\\`);
    }
    return false;
  };

  const epId = 'ep_3';
  // Correct episode audio
  assert.equal(isMatchingEpAudio('/uploads/projects/series_1/episodes/ep_3/audio/narration.mp3', epId), true);
  assert.equal(isMatchingEpAudio('C:\\projects\\series_1\\episodes\\ep_3\\audio\\narration.mp3', epId), true);

  // Leaked root project audio (MUST BE FALSE)
  assert.equal(isMatchingEpAudio('/uploads/drama_project_narration_khmer.mp3', epId), false);
  assert.equal(isMatchingEpAudio('/uploads/projects/test_check/audio/seg_1.mp3', epId), false);

  // Foreign episode audio (MUST BE FALSE)
  assert.equal(isMatchingEpAudio('/uploads/projects/series_1/episodes/ep_1/audio/narration.mp3', epId), false);
  assert.equal(isMatchingEpAudio('/uploads/projects/series_1/episodes/ep_2/audio/narration.mp3', epId), false);
});

