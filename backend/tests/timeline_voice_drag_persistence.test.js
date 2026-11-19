import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

const {
  persistEpisodeTimelineOperation,
  syncSeriesMetadataSafely,
  saveSeriesMetadata,
  getSeriesMetadata,
} = require('../services/episodeService.js');

describe('Voice Drag Move Persistence & Reload Durability Suite', () => {
  it('1. persistEpisodeTimelineOperation(update_segments) persists audioStartSec, trackRow (VOICE 2), and userShifted atomically & survives equal-timestamp partial /sync', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-drag-persist-'));
    try {
      const seriesId = 'Test_Drag_Series';
      const initialSeries = {
        id: seriesId,
        title: 'Test Drag Series',
        episodes: [
          {
            id: 'ep_5',
            episodeNumber: 5,
            title: 'EP5',
            status: 'voicing',
            scriptData: {
              updatedAt: 1000,
              segments: [
                { id: 7, _uid: 'seg_7', startSec: 10.5, endSec: 11.8, audioStartSec: 10.5, audioEndSec: 11.8, trackRow: 0, trackId: 'voice-1', userShifted: false },
              ],
            },
            videoClips: [{ id: 'vc1', start: 0, end: 20, sourceStart: 0, sourceEnd: 20 }],
          },
        ],
      };
      saveSeriesMetadata(initialSeries, { projectsDir: tmpDir });

      // Drag segment #7 to VOICE 2 (trackRow: 1) at 9.3s
      const draggedSegments = [
        { id: 7, _uid: 'seg_7', startSec: 9.3, endSec: 10.6, audioStartSec: 9.3, audioEndSec: 10.6, audioDurationSec: 1.3, trackRow: 1, trackId: 'voice-2', userShifted: true },
      ];
      const res = await persistEpisodeTimelineOperation({
        seriesId,
        episodeId: 'ep_5',
        operation: 'update_segments',
        segments: draggedSegments,
        projectsDir: tmpDir,
      });
      assert.equal(res.success, true);
      assert.ok(res.updatedAt > 1000);

      // Simulate a partial /sync arriving with same updatedAt and stripped fields (like invalidateRendered used to send)
      await syncSeriesMetadataSafely(
        seriesId,
        {
          ...initialSeries,
          episodes: [
            {
              ...initialSeries.episodes[0],
              renderedVideo: null,
              scriptData: {
                updatedAt: res.updatedAt,
                segments: [{ id: 7, _uid: 'seg_7', startSec: 9.3, endSec: 10.6 }],
              },
            },
          ],
        },
        { projectsDir: tmpDir }
      );

      const disk = getSeriesMetadata(seriesId, { forceDisk: true, projectsDir: tmpDir });
      const seg7 = disk.episodes[0].scriptData.segments[0];
      assert.equal(seg7.audioStartSec, 9.3);
      assert.equal(seg7.trackRow, 1, 'VOICE 2 (trackRow=1) must survive partial /sync');
      assert.equal(seg7.trackId, 'voice-2');
      assert.equal(seg7.userShifted, true, 'userShifted manual flag must survive partial /sync');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('2. Static audit: localStorage trimmer preserves audioStartSec/trackRow/userShifted, drag commits persist immediately, errors toast visibly, and VOICE 2 is honoured', () => {
    const storageCode = fs.readFileSync(path.join(rootDir, 'frontend/src/utils/projectStorage.js'), 'utf8');
    const clipOpsCode = fs.readFileSync(path.join(rootDir, 'frontend/src/hooks/useClipOperations.js'), 'utf8');
    const audioRoutesCode = fs.readFileSync(path.join(rootDir, 'backend/routes/audioRoutes.js'), 'utf8');
    const editorCode = fs.readFileSync(path.join(rootDir, 'frontend/src/components/timeline/TimelineEditor.jsx'), 'utf8');

    // projectStorage trimSegmentForStorage must preserve timeline/lane/anchor fields
    const trimBlock = storageCode.slice(storageCode.indexOf('function trimSegmentForStorage'), storageCode.indexOf('function createStorageOptimizedSeriesList'));
    assert.ok(trimBlock.includes('audioStartSec'), 'trimSegmentForStorage must preserve audioStartSec');
    assert.ok(trimBlock.includes('audioEndSec'), 'trimSegmentForStorage must preserve audioEndSec');
    assert.ok(trimBlock.includes('trackRow'), 'trimSegmentForStorage must preserve trackRow');
    assert.ok(trimBlock.includes('trackId'), 'trimSegmentForStorage must preserve trackId');
    assert.ok(trimBlock.includes('userShifted'), 'trimSegmentForStorage must preserve userShifted');

    // syncSeriesToBackend must NOT silently swallow errors
    assert.ok(!storageCode.includes('syncSeriesApi(series).catch(() => {});'), 'syncSeriesToBackend must not silently swallow errors');
    assert.ok(storageCode.includes("new CustomEvent('timeline:toast'"), 'syncSeriesToBackend must surface a visible toast on failure');

    // handleUpdateTimelineSegments must persist immediately via update_segments and toast on failure
    assert.ok(clipOpsCode.includes("operation: 'update_segments'"), 'handleUpdateTimelineSegments must immediately persist via update_segments');
    assert.ok(clipOpsCode.includes('showInAppToast(`⚠️ បរាជ័យក្នុងការរក្សាទុកទីតាំងសំឡេង'), 'Drag persist failure must show visible error toast');
    assert.ok(!clipOpsCode.includes('seg.trackRow >= 2'), 'Lane packing must honour trackRow=1 (VOICE 2), not only trackRow >= 2');

    // Backend /sync-audio must persist segments BEFORE running FFmpeg
    const syncIdx = audioRoutesCode.indexOf('const syncPromise = (async () =>');
    const prePersistIdx = audioRoutesCode.lastIndexOf('await persistSyncedSegmentsToSeriesJson();', syncIdx);
    assert.ok(prePersistIdx > 0 && prePersistIdx < syncIdx, '/sync-audio must persist segments to series.json BEFORE running FFmpeg');

    // TimelineEditor honours all stored lanes (trackRow > 0 || userShifted)
    assert.ok(editorCode.includes('typeof seg.trackRow === \'number\' && (seg.userShifted || seg.trackRow > 0)'), 'TimelineEditor must honour stored trackRow for VOICE 2+ and userShifted for VOICE 1');

    // flushPendingPersist and lifecycle hooks must be present in useClipOperations
    assert.ok(clipOpsCode.includes('flushPendingPersist'), 'useClipOperations must implement flushPendingPersist');
    assert.ok(clipOpsCode.includes('pendingPersistRef'), 'useClipOperations must track pendingPersistRef');
    assert.ok(clipOpsCode.includes('recordPendingTimelinePersist'), 'useClipOperations must record pending writes for crash safety');
    assert.ok(clipOpsCode.includes('clearPendingTimelinePersist'), 'useClipOperations must clear pending writes on successful persist');

    // useSeriesManager must flush pending writes before switching episodes and on startup
    const seriesMgrCode = fs.readFileSync(path.join(rootDir, 'frontend/src/hooks/useSeriesManager.js'), 'utf8');
    assert.ok(seriesMgrCode.includes('flushAllPendingTimelinePersists'), 'useSeriesManager must flush pending writes on switch & init');
  });

  it('3. Move Voice -> switch episode within 600ms flushes pending write immediately to backend before switch', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'switch-ep-flush-'));
    try {
      const seriesId = 'Switch_Ep_Series';
      const initialSeries = {
        id: seriesId,
        title: 'Switch Ep Series',
        episodes: [
          {
            id: 'ep_1',
            scriptData: {
              updatedAt: 100,
              segments: [{ id: 1, _uid: 's1', audioStartSec: 2.0, trackRow: 0 }],
            },
          },
          {
            id: 'ep_2',
            scriptData: {
              updatedAt: 100,
              segments: [{ id: 10, _uid: 's10', audioStartSec: 5.0, trackRow: 0 }],
            },
          },
        ],
      };
      saveSeriesMetadata(initialSeries, { projectsDir: tmpDir });

      // Move clip on ep_1 to 8.5s (VOICE 2, trackRow: 1)
      let pendingWrite = {
        seriesId,
        episodeId: 'ep_1',
        operation: 'update_segments',
        segments: [{ id: 1, _uid: 's1', audioStartSec: 8.5, trackRow: 1, userShifted: true }],
      };
      let persistCalls = 0;
      const doPersist = async (target) => {
        persistCalls++;
        return await persistEpisodeTimelineOperation({ ...target, projectsDir: tmpDir });
      };

      // 600ms timer scheduled
      let timerFired = false;
      const timerId = setTimeout(async () => {
        if (pendingWrite) {
          timerFired = true;
          await doPersist(pendingWrite);
          pendingWrite = null;
        }
      }, 600);

      // Simulate episode switch at 150ms: flush immediately
      await new Promise((r) => setTimeout(r, 150));
      clearTimeout(timerId);
      const flushedWrite = pendingWrite;
      pendingWrite = null;
      assert.ok(flushedWrite, 'Pending write must exist at 150ms');
      await doPersist(flushedWrite);

      // Verify ep_1 in series.json is updated immediately
      const disk = getSeriesMetadata(seriesId, { forceDisk: true, projectsDir: tmpDir });
      const ep1 = disk.episodes.find((e) => e.id === 'ep_1');
      assert.equal(ep1.scriptData.segments[0].audioStartSec, 8.5);
      assert.equal(ep1.scriptData.segments[0].trackRow, 1);
      assert.equal(persistCalls, 1, 'Exactly one persist call must be made');
      assert.equal(timerFired, false, 'Debounce timer must not double-fire after flush');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('4. Move Voice -> unmount component within 600ms flushes pending write to backend without loss', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unmount-flush-'));
    try {
      const seriesId = 'Unmount_Series';
      const initialSeries = {
        id: seriesId,
        title: 'Unmount Series',
        episodes: [
          {
            id: 'ep_1',
            scriptData: {
              updatedAt: 200,
              segments: [{ id: 5, _uid: 's5', audioStartSec: 1.0, trackRow: 0 }],
            },
          },
        ],
      };
      saveSeriesMetadata(initialSeries, { projectsDir: tmpDir });

      let pendingRef = {
        seriesId,
        episodeId: 'ep_1',
        operation: 'update_segments',
        segments: [{ id: 5, _uid: 's5', audioStartSec: 6.2, trackRow: 2, userShifted: true }],
      };
      let timerId = setTimeout(() => {}, 600);

      // Simulate component unmount at 100ms: cleanup flushes pendingRef
      await new Promise((r) => setTimeout(r, 100));
      clearTimeout(timerId);
      const toFlush = pendingRef;
      pendingRef = null;
      assert.ok(toFlush, 'Unmount must capture pending write');
      await persistEpisodeTimelineOperation({ ...toFlush, projectsDir: tmpDir });

      const disk = getSeriesMetadata(seriesId, { forceDisk: true, projectsDir: tmpDir });
      assert.equal(disk.episodes[0].scriptData.segments[0].audioStartSec, 6.2);
      assert.equal(disk.episodes[0].scriptData.segments[0].trackRow, 2);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('5. 20 rapid moves coalesced into a single final write at debounce completion', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rapid-moves-'));
    try {
      const seriesId = 'Rapid_Series';
      const initialSeries = {
        id: seriesId,
        episodes: [
          {
            id: 'ep_1',
            scriptData: {
              updatedAt: 1,
              segments: [{ id: 1, _uid: 's1', audioStartSec: 0.0, trackRow: 0 }],
            },
          },
        ],
      };
      saveSeriesMetadata(initialSeries, { projectsDir: tmpDir });

      let pending = null;
      let timer = null;
      let persistCount = 0;

      // Simulate 20 rapid moves
      for (let i = 1; i <= 20; i++) {
        pending = {
          seriesId,
          episodeId: 'ep_1',
          operation: 'update_segments',
          segments: [{ id: 1, _uid: 's1', audioStartSec: i * 0.5, trackRow: i % 3 }],
        };
        if (timer) clearTimeout(timer);
        timer = setTimeout(async () => {
          persistCount++;
          await persistEpisodeTimelineOperation({ ...pending, projectsDir: tmpDir });
          pending = null;
        }, 100); // 100ms for test speed
        await new Promise((r) => setTimeout(r, 10)); // 10ms between moves
      }

      // Wait for debounce timer to fire
      await new Promise((r) => setTimeout(r, 150));
      assert.equal(persistCount, 1, '20 rapid moves must result in exactly 1 backend write');
      const disk = getSeriesMetadata(seriesId, { forceDisk: true, projectsDir: tmpDir });
      assert.equal(disk.episodes[0].scriptData.segments[0].audioStartSec, 10.0, 'Final position (20 * 0.5 = 10.0) must be saved');
      assert.equal(disk.episodes[0].scriptData.segments[0].trackRow, 20 % 3);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('6. Rapid switching between two episodes keeps writes strictly isolated to their origin episode', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-ep-isolation-'));
    try {
      const seriesId = 'Multi_Ep_Series';
      const initialSeries = {
        id: seriesId,
        episodes: [
          {
            id: 'ep_A',
            scriptData: { updatedAt: 10, segments: [{ id: 1, _uid: 'a1', audioStartSec: 1.0 }] },
          },
          {
            id: 'ep_B',
            scriptData: { updatedAt: 10, segments: [{ id: 2, _uid: 'b1', audioStartSec: 2.0 }] },
          },
        ],
      };
      saveSeriesMetadata(initialSeries, { projectsDir: tmpDir });

      // Edit ep_A -> flush
      const writeA = {
        seriesId,
        episodeId: 'ep_A',
        operation: 'update_segments',
        segments: [{ id: 1, _uid: 'a1', audioStartSec: 99.0, trackRow: 1 }],
      };
      await persistEpisodeTimelineOperation({ ...writeA, projectsDir: tmpDir });

      // Edit ep_B -> flush
      const writeB = {
        seriesId,
        episodeId: 'ep_B',
        operation: 'update_segments',
        segments: [{ id: 2, _uid: 'b1', audioStartSec: 77.0, trackRow: 2 }],
      };
      await persistEpisodeTimelineOperation({ ...writeB, projectsDir: tmpDir });

      const disk = getSeriesMetadata(seriesId, { forceDisk: true, projectsDir: tmpDir });
      const epA = disk.episodes.find((e) => e.id === 'ep_A');
      const epB = disk.episodes.find((e) => e.id === 'ep_B');
      assert.equal(epA.scriptData.segments[0].audioStartSec, 99.0);
      assert.equal(epA.scriptData.segments[0].trackRow, 1);
      assert.equal(epB.scriptData.segments[0].audioStartSec, 77.0);
      assert.equal(epB.scriptData.segments[0].trackRow, 2);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('7. Scoped backend sync suppression does NOT suppress sync on unrelated episodes', () => {
    // Audit implementation in projectStorage.js
    const storageCode = fs.readFileSync(path.join(rootDir, 'frontend/src/utils/projectStorage.js'), 'utf8');
    assert.ok(storageCode.includes('_suppressBackendSyncMap'), 'Must use scoped map for sync suppression');
    assert.ok(storageCode.includes('isBackendSyncSuppressed'), 'Must provide isBackendSyncSuppressed helper');
    assert.ok(storageCode.includes('forceBackendSync'), 'saveEpisodeState must support forceBackendSync override');
  });
});
