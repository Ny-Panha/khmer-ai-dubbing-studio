const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  getSeriesMetadata,
  saveSeriesMetadata,
  syncSeriesMetadataSafely,
  persistEpisodeTimelineOperation,
} = require('../services/episodeService');

const ROOT = path.resolve(__dirname, '..', '..');

function makeTempProjectsDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'render-invalidation-test-'));
}

describe('Rendered Preview Invalidation on Segment / Audio-Mix Mutations', () => {
  it('1. Backend persistEpisodeTimelineOperation (delete segment & undo restore) invalidates renderedVideo WITHOUT deleting MP4 file on disk', async () => {
    const projectsDir = makeTempProjectsDir();
    const seriesId = 'series_render_inv_test';
    const epDir = path.join(projectsDir, seriesId, 'episodes', 'ep_1', 'video');
    fs.mkdirSync(epDir, { recursive: true });

    const renderedMp4Path = path.join(epDir, 'ep_1_rendered.mp4');
    fs.writeFileSync(renderedMp4Path, Buffer.from('FAKE_MP4_BYTES_KEEP_ON_DISK'));
    const renderedAt = Date.now() - 5000;

    const initialSegments = [
      { _uid: 'seg_1', id: 1, startSec: 1.0, endSec: 2.5, audioStartSec: 1.0, audioEndSec: 2.5, khmer: 'សួស្តី' },
      { _uid: 'seg_2', id: 2, startSec: 3.0, endSec: 4.5, audioStartSec: 3.0, audioEndSec: 4.5, khmer: 'តើអ្នកសុខសប្បាយទេ' },
      { _uid: 'seg_3', id: 3, startSec: 5.0, endSec: 6.5, audioStartSec: 5.0, audioEndSec: 6.5, khmer: 'លាហើយ' },
    ];
    const initialClips = [{ id: 'clip-1', start: 0, end: 10, sourceStart: 0, sourceEnd: 10 }];

    saveSeriesMetadata({
      id: seriesId,
      title: 'Render Invalidation Test',
      episodes: [
        {
          id: 'ep_1',
          episodeNumber: 1,
          status: 'completed',
          audioGenerated: true,
          renderedVideo: {
            success: true,
            outputVideoUrl: `/uploads/projects/${seriesId}/episodes/ep_1/video/ep_1_rendered.mp4`,
            outputFilename: 'ep_1_rendered.mp4',
            renderedAt,
          },
          videoClips: initialClips,
          scriptData: { mode: 'dialogue', segments: initialSegments, updatedAt: renderedAt },
        },
      ],
    }, { projectsDir });

    // Delete segment #3
    const delRes = await persistEpisodeTimelineOperation({
      seriesId,
      episodeId: 'ep_1',
      operation: 'delete',
      track: 'segments',
      items: initialSegments.slice(0, 2),
      deletedItem: initialSegments[2],
      deletedIndex: 2,
      projectsDir,
    });

    assert.equal(delRes.success, true);
    assert.equal(delRes.episode.renderedVideo, null, 'Deleting a voice segment must invalidate renderedVideo');
    assert.ok(Number(delRes.episode.renderInvalidatedAt) > renderedAt, 'renderInvalidatedAt cutoff must exceed old renderedAt');
    assert.notEqual(delRes.episode.status, 'completed', 'Episode status must leave completed when render is invalidated');
    assert.equal(fs.existsSync(renderedMp4Path), true, 'Rendered MP4 file MUST NOT be deleted from disk');

    // Stale sync carrying old renderedVideo must NOT revive it
    await syncSeriesMetadataSafely(seriesId, {
      id: seriesId,
      episodes: [
        {
          id: 'ep_1',
          episodeNumber: 1,
          status: 'completed',
          renderedVideo: {
            success: true,
            outputVideoUrl: `/uploads/projects/${seriesId}/episodes/ep_1/video/ep_1_rendered.mp4`,
            outputFilename: 'ep_1_rendered.mp4',
            renderedAt,
          },
        },
      ],
    }, { projectsDir });
    const afterStaleSync = getSeriesMetadata(seriesId, { forceDisk: true, projectsDir });
    assert.equal(afterStaleSync.episodes[0].renderedVideo, null, 'Stale sync must not resurrect invalidated render');

    // Re-render (newer renderedAt > renderInvalidatedAt) MUST be accepted
    const newRenderedAt = Number(delRes.episode.renderInvalidatedAt) + 1000;
    await syncSeriesMetadataSafely(seriesId, {
      id: seriesId,
      episodes: [
        {
          id: 'ep_1',
          episodeNumber: 1,
          status: 'completed',
          renderedVideo: {
            success: true,
            outputVideoUrl: `/uploads/projects/${seriesId}/episodes/ep_1/video/ep_1_rendered.mp4`,
            outputFilename: 'ep_1_rendered.mp4',
            renderedAt: newRenderedAt,
          },
        },
      ],
    }, { projectsDir });
    const afterFreshRender = getSeriesMetadata(seriesId, { forceDisk: true, projectsDir });
    assert.equal(afterFreshRender.episodes[0].renderedVideo?.renderedAt, newRenderedAt, 'Fresh render after invalidation must be accepted');

    // Undo / restore MUST also invalidate the cached rendered preview without deleting the MP4 file
    const restoreRes = await persistEpisodeTimelineOperation({
      seriesId,
      episodeId: 'ep_1',
      operation: 'restore',
      segments: initialSegments,
      videoClips: initialClips,
      projectsDir,
    });
    assert.equal(restoreRes.episode.renderedVideo, null, 'Undo/restore must invalidate renderedVideo');
    assert.ok(Number(restoreRes.episode.renderInvalidatedAt) >= newRenderedAt, 'renderInvalidatedAt must advance on restore');
    assert.equal(fs.existsSync(renderedMp4Path), true, 'Rendered MP4 file MUST stay on disk after restore');

    fs.rmSync(projectsDir, { recursive: true, force: true });
  });

  it('2. Frontend projectStorage saveEpisodeState & saveTimelineOperationToLocalStorage enforce renderInvalidatedAt monotonically', async () => {
    const store = new Map();
    const prevLS = global.localStorage;
    const prevFetch = global.fetch;
    global.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    };
    global.fetch = async () => ({ ok: true, json: async () => ({ success: true }) });

    try {
      const storage = await import(`file:///${path.join(ROOT, 'frontend', 'src', 'utils', 'projectStorage.js').replace(/\\/g, '/')}`);
      const seriesId = 'series_ls_render_inv';
      const oldRenderedAt = 1700000000000;
      storage.saveSeriesList([
        {
          id: seriesId,
          title: 'Local Test',
          episodes: [
            {
              id: 'ep_1',
              episodeNumber: 1,
              status: 'completed',
              audioGenerated: true,
              renderedVideo: {
                success: true,
                outputVideoUrl: '/uploads/ep_1.mp4',
                outputFilename: 'ep_1.mp4',
                renderedAt: oldRenderedAt,
              },
              scriptData: {
                mode: 'dialogue',
                segments: [{ _uid: 's1', id: 1, startSec: 0, endSec: 2, khmer: 'hello' }],
                updatedAt: oldRenderedAt,
              },
              videoClips: [{ id: 'c1', start: 0, end: 5 }],
            },
          ],
        },
      ]);

      // Invalidate via saveEpisodeState
      const invalidatedAt = oldRenderedAt + 5000;
      storage.saveEpisodeState(seriesId, 'ep_1', {
        renderedVideo: null,
        renderInvalidatedAt: invalidatedAt,
      });
      let ep = storage.loadSeriesList()[0].episodes[0];
      assert.equal(ep.renderedVideo, null);
      assert.equal(ep.renderInvalidatedAt, invalidatedAt);

      // Stale autosave with old renderedVideo must NOT revive it
      storage.saveEpisodeState(seriesId, 'ep_1', {
        renderedVideo: {
          success: true,
          outputVideoUrl: '/uploads/ep_1.mp4',
          renderedAt: oldRenderedAt,
        },
      });
      ep = storage.loadSeriesList()[0].episodes[0];
      assert.equal(ep.renderedVideo, null, 'Stale renderedVideo older than renderInvalidatedAt must stay null');

      // New render with renderedAt > renderInvalidatedAt MUST be accepted
      const freshRenderedAt = invalidatedAt + 5000;
      storage.saveEpisodeState(seriesId, 'ep_1', {
        renderedVideo: {
          success: true,
          outputVideoUrl: '/uploads/ep_1.mp4',
          renderedAt: freshRenderedAt,
        },
      });
      ep = storage.loadSeriesList()[0].episodes[0];
      assert.equal(ep.renderedVideo?.renderedAt, freshRenderedAt, 'Fresh render must be stored');

      // saveTimelineOperationToLocalStorage (delete) MUST invalidate renderedVideo
      storage.saveTimelineOperationToLocalStorage({
        seriesId,
        episodeId: 'ep_1',
        operation: 'delete',
        track: 'segments',
        items: [],
        deletedItem: { _uid: 's1', id: 1 },
      });
      ep = storage.loadSeriesList()[0].episodes[0];
      assert.equal(ep.renderedVideo, null, 'Timeline delete in localStorage must invalidate renderedVideo');
      assert.ok(ep.renderInvalidatedAt >= freshRenderedAt);
    } finally {
      if (prevLS === undefined) delete global.localStorage;
      else global.localStorage = prevLS;
      if (prevFetch === undefined) delete global.fetch;
      else global.fetch = prevFetch;
    }
  });

  it('3. Static audit: App.jsx wires invalidateRenderedPreview into all segment/audio-mix hooks and every mutation path invokes it', () => {
    const appSrc = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'App.jsx'), 'utf8');
    const clipsSrc = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'hooks', 'useClipOperations.js'), 'utf8');
    const audioSrc = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'hooks', 'useAudioDubbing.js'), 'utf8');
    const undoSrc = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'hooks', 'useUndoRedo.js'), 'utf8');
    const scriptSrc = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'hooks', 'useScriptWorkflow.js'), 'utf8');

    // App.jsx defines invalidateRenderedPreview and wires it to all 4 hooks
    assert.match(appSrc, /const invalidateRenderedPreview = useCallback/);
    assert.equal((appSrc.match(/onInvalidateRenderedPreview:\s*invalidateRenderedPreview/g) || []).length, 4);

    // useClipOperations.js wires invalidateRendered into all mutation paths
    assert.match(clipsSrc, /onInvalidateRenderedPreview = null/);
    const clipCalls = (clipsSrc.match(/invalidateRendered\(\);/g) || []).length;
    assert.ok(clipCalls >= 13, `Expected >= 13 invalidateRendered() calls in useClipOperations.js (found ${clipCalls})`);

    // useAudioDubbing.js wires invalidateRendered into TTS regen, speed, voice, delivery, text, split, translate, speaker voice
    assert.match(audioSrc, /onInvalidateRenderedPreview = null/);
    const audioCalls = (audioSrc.match(/invalidateRendered\(/g) || []).length;
    assert.ok(audioCalls >= 11, `Expected >= 11 invalidateRendered() calls in useAudioDubbing.js (found ${audioCalls})`);

    // useUndoRedo.js invalidates on BOTH handleUndo and handleRedo
    assert.match(undoSrc, /onInvalidateRenderedPreview = null/);
    assert.equal((undoSrc.match(/onInvalidateRenderedPreview\(\);/g) || []).length, 2);

    // useScriptWorkflow.js invalidates on script generation and handleUpdateScript (add/bridge/merge/edit)
    assert.match(scriptSrc, /onInvalidateRenderedPreview = null/);
    assert.ok((scriptSrc.match(/onInvalidateRenderedPreview\(/g) || []).length >= 2);
  });
});
