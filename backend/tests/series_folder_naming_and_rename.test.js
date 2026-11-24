import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  resolveUniqueSeriesFolderId,
  rewriteSeriesIdReferences,
  renameSeries,
  saveSeriesMetadata,
  getSeriesMetadata,
} = require('../services/episodeService');

test('1. resolveUniqueSeriesFolderId creates clean human folder names (ss1, ss2) and avoids collisions', () => {
  const tmpProjects = fs.mkdtempSync(path.join(os.tmpdir(), 'dd_series_name_'));
  try {
    assert.equal(resolveUniqueSeriesFolderId('ss1', { projectsDir: tmpProjects }), 'ss1');
    fs.mkdirSync(path.join(tmpProjects, 'ss1'));
    assert.equal(resolveUniqueSeriesFolderId('ss1', { projectsDir: tmpProjects }), 'ss1_2');
    assert.equal(resolveUniqueSeriesFolderId('SS1', { projectsDir: tmpProjects }), process.platform === 'win32' ? 'SS1_2' : 'SS1');
    assert.equal(resolveUniqueSeriesFolderId('Dragon Town 2', { projectsDir: tmpProjects }), 'Dragon_Town_2');
    assert.equal(resolveUniqueSeriesFolderId('CON', { projectsDir: tmpProjects }), 'CON_series');
  } finally {
    fs.rmSync(tmpProjects, { recursive: true, force: true });
  }
});

test('2. rewriteSeriesIdReferences updates directory segments only without breaking filenames inside video/', () => {
  const input = {
    id: 'series_1795175277101',
    videoUrl: '/uploads/projects/series_1795175277101/episodes/ep_1/video/series_1795175277101_ep_1_source.mp4',
    videoPath: 'E:\\khmer_ai_dubbing_studio\\backend\\uploads\\projects\\series_1795175277101\\episodes\\ep_1\\video\\series_1795175277101_ep_1_source.mp4',
    videoId: 'projects/series_1795175277101/episodes/ep_1/video/series_1795175277101_ep_1_source.mp4',
    downloadUrl: '/api/download-export?file=projects%2Fseries_1795175277101%2Fepisodes%2Fep_1%2Fvideo%2Fout.mp4&name=out.mp4',
  };
  const out = rewriteSeriesIdReferences(input, 'series_1795175277101', 'ss2');
  assert.equal(out.videoUrl, '/uploads/projects/ss2/episodes/ep_1/video/series_1795175277101_ep_1_source.mp4');
  assert.equal(out.videoPath, 'E:\\khmer_ai_dubbing_studio\\backend\\uploads\\projects\\ss2\\episodes\\ep_1\\video\\series_1795175277101_ep_1_source.mp4');
  assert.equal(out.videoId, 'projects/ss2/episodes/ep_1/video/series_1795175277101_ep_1_source.mp4');
  assert.equal(out.downloadUrl, '/api/download-export?file=projects%2Fss2%2Fepisodes%2Fep_1%2Fvideo%2Fout.mp4&name=out.mp4');
});

test('3. renameSeries renames physical directory, series.json, audio sidecar, and blocks collisions with 409', async () => {
  const tmpProjects = fs.mkdtempSync(path.join(os.tmpdir(), 'dd_series_rename_'));
  try {
    const oldId = 'series_12345';
    const oldEpAudioDir = path.join(tmpProjects, oldId, 'episodes', 'ep_1', 'audio');
    fs.mkdirSync(oldEpAudioDir, { recursive: true });

    const sidecarPath = path.join(oldEpAudioDir, 'ep_1_narration_khmer.mp3.meta.json');
    fs.writeFileSync(sidecarPath, JSON.stringify({ seriesId: oldId, episodeId: 'ep_1' }), 'utf8');

    saveSeriesMetadata({
      id: oldId,
      title: 'Old Name',
      episodes: [
        {
          id: 'ep_1',
          episodeNumber: 1,
          title: 'ភាគទី 1 (EP1)',
          videoFile: `/uploads/projects/${oldId}/episodes/ep_1/video/${oldId}_ep_1_source.mp4`,
          fullAudioUrl: `/uploads/projects/${oldId}/episodes/ep_1/audio/ep_1_narration_khmer.mp3`,
        },
      ],
    }, { projectsDir: tmpProjects });

    // Create another series to test collision protection
    saveSeriesMetadata({ id: 'ss1', title: 'ss1', episodes: [] }, { projectsDir: tmpProjects });

    // Collision must return 409 and NOT touch either folder
    const collision = await renameSeries(oldId, 'ss1', { projectsDir: tmpProjects });
    assert.equal(collision.success, false);
    assert.equal(collision.statusCode, 409);
    assert.equal(fs.existsSync(path.join(tmpProjects, oldId)), true);

    // Valid rename to ss2 moves physical folder and rewrites all internal refs
    const renamed = await renameSeries(oldId, 'ss2', { projectsDir: tmpProjects });
    assert.equal(renamed.success, true);
    assert.equal(renamed.renamedFolder, true);
    assert.equal(renamed.oldSeriesId, oldId);
    assert.equal(renamed.newSeriesId, 'ss2');
    assert.equal(fs.existsSync(path.join(tmpProjects, oldId)), false);
    assert.equal(fs.existsSync(path.join(tmpProjects, 'ss2', 'series.json')), true);

    const reloaded = getSeriesMetadata('ss2', { forceDisk: true, projectsDir: tmpProjects });
    assert.equal(reloaded.id, 'ss2');
    assert.equal(reloaded.title, 'ss2');
    assert.equal(reloaded.episodes[0].videoFile, `/uploads/projects/ss2/episodes/ep_1/video/${oldId}_ep_1_source.mp4`);
    assert.equal(reloaded.episodes[0].fullAudioUrl, '/uploads/projects/ss2/episodes/ep_1/audio/ep_1_narration_khmer.mp3');

    const updatedSidecar = JSON.parse(
      fs.readFileSync(path.join(tmpProjects, 'ss2', 'episodes', 'ep_1', 'audio', 'ep_1_narration_khmer.mp3.meta.json'), 'utf8')
    );
    assert.equal(updatedSidecar.seriesId, 'ss2');

    // Case-only rename on Windows (ss2 -> SS2) must work cleanly
    const caseRenamed = await renameSeries('ss2', 'SS2', { projectsDir: tmpProjects });
    assert.equal(caseRenamed.success, true);
    assert.equal(caseRenamed.newSeriesId, 'SS2');
    assert.equal(fs.existsSync(path.join(tmpProjects, 'SS2', 'series.json')), true);
  } finally {
    fs.rmSync(tmpProjects, { recursive: true, force: true });
  }
});
