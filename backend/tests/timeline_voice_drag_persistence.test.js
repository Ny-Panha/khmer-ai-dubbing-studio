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
  });
});
