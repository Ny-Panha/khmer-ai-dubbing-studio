const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { afterEach, test } = require('node:test');
const {
  getSeriesMetadata,
  persistEpisodeTimelineOperation,
  saveSeriesMetadata,
  syncSeriesMetadataSafely,
} = require('../services/episodeService');
const { sanitizeSeriesEpisodes } = require('../models/episodeModel');

const tempRoots = new Set();

function createTempProjectsDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'timeline-delete-'));
  tempRoots.add(root);
  return root;
}

function seedSeries(projectsDir, seriesId, segments, videoClips) {
  const episode = {
    id: 'ep_1',
    episodeNumber: 1,
    title: 'Test Episode',
    status: 'translated',
    video: { videoId: 'test-video', videoUrl: '/test-video.mp4' },
    duration: 12,
    scriptData: {
      mode: 'dialogue',
      hasScript: segments.length > 0,
      totalSegments: segments.length,
      updatedAt: 100,
      segments,
    },
    videoClips,
    videoClipsUpdatedAt: 100,
  };
  const series = { id: seriesId, title: 'Test Series', episodes: [episode] };
  saveSeriesMetadata(series, { projectsDir });
  return series;
}

function readDiskEpisode(projectsDir, seriesId) {
  const file = path.join(projectsDir, seriesId, 'series.json');
  return JSON.parse(fs.readFileSync(file, 'utf8')).episodes[0];
}

afterEach(() => {
  for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true });
  tempRoots.clear();
});

test('segment delete is durable across stale autosave, reload, and Auto-Align writes', async () => {
  const projectsDir = createTempProjectsDir();
  const seriesId = 'timeline_delete_segments';
  const segments = [
    { id: 1, _uid: 'uid-one', startSec: 0, endSec: 2, khmerText: 'one' },
    { id: 2, _uid: 'uid-two', startSec: 2, endSec: 4, khmerText: 'two' },
    { id: 3, _uid: 'uid-three', startSec: 4, endSec: 6, khmerText: 'three' },
  ];
  const clips = [{ id: 'video-a', start: 0, end: 12, sourceStart: 0, sourceEnd: 12 }];
  const original = seedSeries(projectsDir, seriesId, segments, clips);

  await persistEpisodeTimelineOperation({
    projectsDir,
    seriesId,
    episodeId: 'ep_1',
    operation: 'delete',
    track: 'segments',
    items: [segments[0], segments[2]],
    deletedItem: segments[1],
  });

  const persisted = readDiskEpisode(projectsDir, seriesId);
  assert.deepEqual(persisted.scriptData.segments, [segments[0], segments[2]]);
  assert.deepEqual(persisted.videoClips, clips);
  assert.ok(persisted.deletedSegmentKeys.includes('uid:uid-two'));

  await syncSeriesMetadataSafely(seriesId, original, { projectsDir });
  let loaded = getSeriesMetadata(seriesId, { forceDisk: true, projectsDir }).episodes[0];
  assert.deepEqual(loaded.scriptData.segments, [segments[0], segments[2]]);
  assert.equal(loaded.scriptData.segments.some((segment) => segment._uid === 'uid-two'), false);

  const alignedSurvivors = loaded.scriptData.segments.map((segment) => ({
    ...segment,
    startSec: segment.startSec + 0.25,
    endSec: segment.endSec + 0.25,
  }));
  await syncSeriesMetadataSafely(seriesId, {
    ...original,
    episodes: [{
      ...original.episodes[0],
      scriptData: { ...original.episodes[0].scriptData, segments: alignedSurvivors, updatedAt: loaded.scriptData.updatedAt + 1 },
    }],
  }, { projectsDir });
  loaded = getSeriesMetadata(seriesId, { forceDisk: true, projectsDir }).episodes[0];
  assert.deepEqual(loaded.scriptData.segments, alignedSurvivors);
  assert.equal(loaded.scriptData.segments.some((segment) => segment._uid === 'uid-two'), false);
});

test('an explicit delete of the last segment prevents completed-job hydration from restoring it', async () => {
  const projectsDir = createTempProjectsDir();
  const seriesId = 'timeline_delete_empty';
  const segment = { id: 1, _uid: 'deleted-last', startSec: 0, endSec: 2, khmerText: 'last' };
  seedSeries(projectsDir, seriesId, [segment], []);
  const jobsDir = path.join(projectsDir, seriesId, 'episodes', 'ep_1', 'jobs');
  fs.mkdirSync(jobsDir, { recursive: true });
  fs.writeFileSync(path.join(jobsDir, 'completed.json'), JSON.stringify({
    status: 'completed',
    completedAt: 200,
    finalResult: { segments: [segment] },
  }));

  await persistEpisodeTimelineOperation({
    projectsDir,
    seriesId,
    episodeId: 'ep_1',
    operation: 'delete',
    track: 'segments',
    items: [],
    deletedItem: segment,
  });

  const diskEp = readDiskEpisode(projectsDir, seriesId);
  assert.deepEqual(diskEp.scriptData.segments, []);
  assert.equal(diskEp.scriptData.explicitClear, true);
  const loadedEp = getSeriesMetadata(seriesId, { forceDisk: true, projectsDir }).episodes[0];
  assert.deepEqual(loadedEp.scriptData.segments, []);
  assert.equal(loadedEp.scriptData.explicitClear, true);
});

test('stable _uid tombstones do not remove a survivor after Auto-Align reuses a numeric id', () => {
  const series = {
    id: 'timeline_delete_reindexed',
    episodes: [{
      id: 'ep_1',
      deletedSegmentKeys: ['uid:deleted-two', 'id:2', 'segmentId:2'],
      scriptData: {
        segments: [
          { id: 2, segmentId: 2, _uid: 'surviving-three', startSec: 4, endSec: 6 },
          { id: 2, segmentId: 2, _uid: 'deleted-two', startSec: 2, endSec: 4 },
        ],
      },
      videoClips: [],
    }],
  };

  const sanitized = sanitizeSeriesEpisodes(series);
  assert.deepEqual(sanitized.episodes[0].scriptData.segments.map((segment) => segment._uid), ['surviving-three']);
});

test('video delete persists only video clips and undo/redo restores both exact tracks', async () => {
  const projectsDir = createTempProjectsDir();
  const seriesId = 'timeline_delete_video';
  const segments = [
    { id: 1, _uid: 'voice-one', startSec: 0, endSec: 2 },
    { id: 2, _uid: 'voice-two', startSec: 2, endSec: 4 },
  ];
  const clips = [
    { id: 'video-one', name: '#1', start: 0, end: 2, sourceStart: 8, sourceEnd: 10 },
    { id: 'video-two', name: '#2', start: 2, end: 4, sourceStart: 20, sourceEnd: 22 },
  ];
  seedSeries(projectsDir, seriesId, segments, clips);
  const afterDeleteClips = [
    { id: 'gap-one', name: 'Gap', start: 0, end: 2, sourceStart: 0, sourceEnd: 2 },
    clips[1],
  ];

  await persistEpisodeTimelineOperation({
    projectsDir,
    seriesId,
    episodeId: 'ep_1',
    operation: 'delete',
    track: 'videoClips',
    items: afterDeleteClips,
    deletedItem: clips[0],
  });
  let diskEp = readDiskEpisode(projectsDir, seriesId);
  assert.deepEqual(diskEp.videoClips, afterDeleteClips);
  assert.deepEqual(diskEp.scriptData.segments, segments);

  await syncSeriesMetadataSafely(seriesId, {
    id: seriesId,
    episodes: [{ ...diskEp, videoClips: clips, videoClipsUpdatedAt: 100 }],
  }, { projectsDir });
  diskEp = readDiskEpisode(projectsDir, seriesId);
  assert.deepEqual(diskEp.videoClips, afterDeleteClips);
  assert.deepEqual(diskEp.scriptData.segments, segments);

  await persistEpisodeTimelineOperation({
    projectsDir,
    seriesId,
    episodeId: 'ep_1',
    operation: 'restore',
    segments,
    videoClips: clips,
  });
  diskEp = readDiskEpisode(projectsDir, seriesId);
  assert.deepEqual(diskEp.videoClips, clips);
  assert.deepEqual(diskEp.scriptData.segments, segments);
  assert.equal(diskEp.deletedVideoClipIds.includes('video-one'), false);

  await persistEpisodeTimelineOperation({
    projectsDir,
    seriesId,
    episodeId: 'ep_1',
    operation: 'restore',
    segments,
    videoClips: afterDeleteClips,
  });
  diskEp = readDiskEpisode(projectsDir, seriesId);
  assert.deepEqual(diskEp.videoClips, afterDeleteClips);
  assert.deepEqual(diskEp.scriptData.segments, segments);
  assert.ok(diskEp.deletedVideoClipIds.includes('video-one'));
});

test('local autosave cannot replace a just-deleted segment with its captured stale array', async () => {
  const previousStorage = global.localStorage;
  const data = new Map();
  global.localStorage = {
    get length() { return data.size; },
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
    removeItem(key) { data.delete(key); },
    key(index) { return [...data.keys()][index] ?? null; },
  };
  try {
    const storage = await import(pathToFileURL(path.resolve(__dirname, '../../frontend/src/utils/projectStorage.js')));
    const segments = [
      { id: 1, _uid: 'local-one', startSec: 0, endSec: 2 },
      { id: 2, _uid: 'local-two', startSec: 2, endSec: 4 },
    ];
    storage.setActiveSeriesId('local_timeline');
    storage.setActiveEpisodeId('ep_1');
    storage.saveSeriesList([{
      id: 'local_timeline',
      title: 'Local Test',
      episodes: [{
        id: 'ep_1',
        episodeNumber: 1,
        title: 'EP1',
        video: { videoId: 'local-video', videoUrl: '/local-video.mp4' },
        scriptData: { hasScript: true, totalSegments: 2, updatedAt: 100, segments },
        videoClips: [{ id: 'video-local', start: 0, end: 4 }],
        videoClipsUpdatedAt: 100,
      }],
    }]);

    const localDelete = storage.saveTimelineOperationToLocalStorage({
      seriesId: 'local_timeline',
      episodeId: 'ep_1',
      operation: 'delete',
      track: 'segments',
      items: [segments[0]],
      deletedItem: segments[1],
    });
    assert.ok(localDelete.updatedAt > 100);

    storage.saveEpisodeState('local_timeline', 'ep_1', {
      scriptData: { hasScript: true, totalSegments: 2, updatedAt: 100, segments },
      videoClips: [{ id: 'video-local', start: 0, end: 4 }],
      videoClipsUpdatedAt: 100,
    });

    const saved = JSON.parse(global.localStorage.getItem(storage.STORAGE_SERIES_LIST_KEY));
    const savedEpisode = saved[0].episodes[0];
    assert.deepEqual(savedEpisode.scriptData.segments.map((segment) => segment.id), [1]);
    assert.ok(savedEpisode.deletedSegmentKeys.includes('uid:local-two'));
    assert.equal(savedEpisode.scriptData.segments[0]._uid, 'local-one');

    storage.saveSeriesList([{
      id: 'local_timeline',
      title: 'Local Test',
      episodes: [{
        id: 'ep_1',
        episodeNumber: 1,
        title: 'EP1',
        video: { videoId: 'local-video', videoUrl: '/local-video.mp4' },
        deletedSegmentKeys: ['uid:local-deleted-two', 'id:2', 'segmentId:2'],
        scriptData: {
          hasScript: true,
          totalSegments: 2,
          updatedAt: 200,
          segments: [
            { id: 2, segmentId: 2, _uid: 'local-survivor-three', startSec: 4, endSec: 6 },
            { id: 2, segmentId: 2, _uid: 'local-deleted-two', startSec: 2, endSec: 4 },
          ],
        },
        videoClips: [{ id: 'video-local', start: 0, end: 6 }],
      }],
    }]);
    storage.saveEpisodeState('local_timeline', 'ep_1', {
      scriptData: {
        hasScript: true,
        totalSegments: 2,
        updatedAt: 300,
        segments: [
          { id: 2, segmentId: 2, _uid: 'local-survivor-three', startSec: 4, endSec: 6 },
          { id: 2, segmentId: 2, _uid: 'local-deleted-two', startSec: 2, endSec: 4 },
        ],
      },
      videoClips: [{ id: 'video-local', start: 0, end: 6 }],
    });
    const reindexed = JSON.parse(global.localStorage.getItem(storage.STORAGE_SERIES_LIST_KEY))[0].episodes[0];
    assert.deepEqual(reindexed.scriptData.segments.map((segment) => segment._uid), ['local-survivor-three']);
  } finally {
    if (previousStorage === undefined) delete global.localStorage;
    else global.localStorage = previousStorage;
  }
});
