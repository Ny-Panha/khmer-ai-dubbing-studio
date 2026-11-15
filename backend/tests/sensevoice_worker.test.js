const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { transcribeSenseVoice } = require('../services/senseVoiceService');

test('SenseVoice Worker: handles non-existent file gracefully', async () => {
  await assert.rejects(
    async () => {
      await transcribeSenseVoice({
        audioPath: path.resolve(__dirname, 'non_existent_audio.wav'),
        timeoutMs: 5000,
      });
    },
    (err) => {
      assert.ok(err.message.includes('not found'), `Expected error message to mention not found, got: ${err.message}`);
      return true;
    }
  );
});

test('SenseVoice Worker: forced failure surfaces worker error without swallowing', async () => {
  // Pass an invalid audio file (e.g. empty file)
  const tempEmptyFile = path.resolve(__dirname, 'temp_corrupt.wav');
  fs.writeFileSync(tempEmptyFile, 'CORRUPT_DATA_NOT_AUDIO');

  try {
    await assert.rejects(
      async () => {
        await transcribeSenseVoice({
          audioPath: tempEmptyFile,
          timeoutMs: 15000,
        });
      },
      (err) => {
        assert.ok(err instanceof Error, 'Should reject with an Error');
        assert.ok(err.message.length > 0, 'Error message should not be empty');
        return true;
      }
    );
  } finally {
    try {
      if (fs.existsSync(tempEmptyFile)) fs.unlinkSync(tempEmptyFile);
    } catch (_) {}
  }
});
