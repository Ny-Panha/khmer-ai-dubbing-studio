const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  resetEpisodeState,
  getSeriesMetadata,
  saveSeriesMetadata,
  withSeriesMetadataLock,
} = require('../services/episodeService');

function createTestEnvironment() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dub_reset_test_'));
  const projectsDir = path.join(tmpDir, 'uploads', 'projects');
  fs.mkdirSync(projectsDir, { recursive: true });

  const seriesId = 'test_series_regeneration';
  const seriesDir = path.join(projectsDir, seriesId);
  const ep1Dir = path.join(seriesDir, 'episodes', 'ep_1');
  const ep2Dir = path.join(seriesDir, 'episodes', 'ep_2');

  fs.mkdirSync(path.join(ep1Dir, 'video'), { recursive: true });
  fs.mkdirSync(path.join(ep1Dir, 'audio'), { recursive: true });
  fs.mkdirSync(path.join(ep1Dir, 'jobs'), { recursive: true });

  fs.mkdirSync(path.join(ep2Dir, 'video'), { recursive: true });
  fs.mkdirSync(path.join(ep2Dir, 'audio'), { recursive: true });
  fs.mkdirSync(path.join(ep2Dir, 'jobs'), { recursive: true });

  // Source video for ep 1 & 2 (NEVER deleted)
  const ep1VideoPath = path.join(ep1Dir, 'video', 'ep1_source.mp4');
  const ep2VideoPath = path.join(ep2Dir, 'video', 'ep2_source.mp4');
  fs.writeFileSync(ep1VideoPath, 'FAKE_VIDEO_CONTENT_EP1');
  fs.writeFileSync(ep2VideoPath, 'FAKE_VIDEO_CONTENT_EP2');

  // Generated audio files for ep 1
  fs.writeFileSync(path.join(ep1Dir, 'audio', 'ep_1_narration_khmer.mp3'), 'FAKE_AUDIO_NARRATION_EP1');
  fs.writeFileSync(path.join(ep1Dir, 'audio', 'seg_1.mp3'), 'FAKE_SEG_1');
  fs.writeFileSync(path.join(ep1Dir, 'audio', 'seg_2.mp3'), 'FAKE_SEG_2');

  // Generated audio files for ep 2
  fs.writeFileSync(path.join(ep2Dir, 'audio', 'ep_2_narration_khmer.mp3'), 'FAKE_AUDIO_NARRATION_EP2');
  fs.writeFileSync(path.join(ep2Dir, 'audio', 'seg_1_ep2.mp3'), 'FAKE_SEG_1_EP2');

  // Completed job manifest for ep 1
  fs.writeFileSync(path.join(ep1Dir, 'jobs', 'job_ep1_comp.json'), JSON.stringify({
    jobId: 'job_ep1_comp',
    status: 'completed',
    finalResult: { segments: [{ id: 1, text: 'Old Job Segment' }] },
  }));

  // Initial series metadata with 2 episodes
  const initialSeries = {
    id: seriesId,
    title: 'Test Regeneration Series',
    episodes: [
      {
        id: 'ep_1',
        episodeNumber: 1,
        title: 'Episode 1',
        video: { videoId: 'ep1_source.mp4', videoUrl: '/uploads/.../ep1_source.mp4' },
        sourceVideoPath: ep1VideoPath,
        scriptData: {
          segments: [
            {
              id: 1,
              speaker: 'តួអង្គប្រុស',
              speakerGender: 'MALE',
              gender: 'male',
              voice: 'km-KH-PisethNeural',
              assignedVoice: 'km-KH-PisethNeural',
              khmer: 'សួស្តីបងប្អូនទាំងអស់គ្នា',
              audioUrl: '/uploads/projects/test_series_regeneration/episodes/ep_1/audio/seg_1.mp3',
              audioPath: path.join(ep1Dir, 'audio', 'seg_1.mp3'),
              ttsStatus: 'ready',
              audioDurationSec: 2.5,
            },
            {
              id: 2,
              speaker: 'តួអង្គស្រី',
              speakerGender: 'FEMALE',
              gender: 'female',
              voice: 'km-KH-SreymomNeural',
              assignedVoice: 'km-KH-SreymomNeural',
              khmer: 'ជម្រាបសួរចាស',
              audioUrl: '/uploads/projects/test_series_regeneration/episodes/ep_1/audio/seg_2.mp3',
              audioPath: path.join(ep1Dir, 'audio', 'seg_2.mp3'),
              ttsStatus: 'ready',
              audioDurationSec: 1.8,
            },
          ],
          updatedAt: 1000,
        },
        speakerRegistry: {
          'តួអង្គប្រុស': { voiceId: 'km-KH-PisethNeural', gender: 'male' },
          'តួអង្គស្រី': { voiceId: 'km-KH-SreymomNeural', gender: 'female' },
        },
        audioGenerated: true,
        hasAudio: true,
        fullAudioUrl: '/uploads/projects/test_series_regeneration/episodes/ep_1/audio/ep_1_narration_khmer.mp3',
        fullAudioPath: path.join(ep1Dir, 'audio', 'ep_1_narration_khmer.mp3'),
        renderedVideo: { videoUrl: '/renders/ep1.mp4' },
      },
      {
        id: 'ep_2',
        episodeNumber: 2,
        title: 'Episode 2',
        video: { videoId: 'ep2_source.mp4', videoUrl: '/uploads/.../ep2_source.mp4' },
        sourceVideoPath: ep2VideoPath,
        scriptData: {
          segments: [
            {
              id: 1,
              speaker: 'មេទ័ព',
              gender: 'male',
              voice: 'km-KH-PisethNeural',
              khmer: 'ចូរចេញទៅភ្លាម',
              audioUrl: '/uploads/projects/test_series_regeneration/episodes/ep_2/audio/seg_1_ep2.mp3',
              audioPath: path.join(ep2Dir, 'audio', 'seg_1_ep2.mp3'),
              ttsStatus: 'ready',
            },
          ],
        },
        audioGenerated: true,
        hasAudio: true,
        fullAudioUrl: '/uploads/projects/test_series_regeneration/episodes/ep_2/audio/ep_2_narration_khmer.mp3',
        fullAudioPath: path.join(ep2Dir, 'audio', 'ep_2_narration_khmer.mp3'),
      },
    ],
  };

  saveSeriesMetadata(initialSeries, { projectsDir });

  return {
    tmpDir,
    projectsDir,
    seriesId,
    seriesDir,
    ep1Dir,
    ep2Dir,
    ep1VideoPath,
    ep2VideoPath,
    cleanup() {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (_) {}
    },
  };
}

test('1. Regenerate Script: Clears scriptData, audio files, completed job manifests, and preserves original video', async () => {
  const env = createTestEnvironment();
  try {
    const res = await resetEpisodeState(env.seriesId, 'ep_1', {
      resetType: 'script',
      projectsDir: env.projectsDir,
    });

    assert.equal(res.success, true);
    assert.equal(res.resetType, 'script');
    assert.equal(res.episode.scriptData, null);
    assert.equal(res.episode.audioGenerated, false);
    assert.equal(res.episode.hasAudio, false);
    assert.equal(res.episode.fullAudioUrl, null);

    // Verify original video was NEVER touched
    assert.equal(fs.existsSync(env.ep1VideoPath), true);
    assert.equal(fs.readFileSync(env.ep1VideoPath, 'utf8'), 'FAKE_VIDEO_CONTENT_EP1');

    // Verify ep1 audio files were wiped
    const audioFiles = fs.readdirSync(path.join(env.ep1Dir, 'audio'));
    assert.equal(audioFiles.length, 0);

    // Verify ep1 old job manifest was wiped so hydration cannot resurrect it
    const jobFiles = fs.readdirSync(path.join(env.ep1Dir, 'jobs'));
    assert.equal(jobFiles.length, 0);

    // Verify backup was created
    const backups = fs.readdirSync(path.join(env.ep1Dir, 'backups'));
    assert.equal(backups.some((f) => f.includes('reset_script_script_')), true);
  } finally {
    env.cleanup();
  }
});

test('2. Regenerate Voice: Keeps translated script, speaker identities, but clears audio references & disk audio', async () => {
  const env = createTestEnvironment();
  try {
    const res = await resetEpisodeState(env.seriesId, 'ep_1', {
      resetType: 'voice',
      projectsDir: env.projectsDir,
    });

    assert.equal(res.success, true);
    assert.equal(res.resetType, 'voice');

    // Script MUST be preserved
    assert.ok(res.episode.scriptData);
    assert.equal(res.episode.scriptData.segments.length, 2);

    // Khmer text & character voice identities preserved
    assert.equal(res.episode.scriptData.segments[0].khmer, 'សួស្តីបងប្អូនទាំងអស់គ្នា');
    assert.equal(res.episode.scriptData.segments[0].voice, 'km-KH-PisethNeural');
    assert.equal(res.episode.scriptData.segments[0].speakerGender, 'MALE');

    assert.equal(res.episode.scriptData.segments[1].khmer, 'ជម្រាបសួរចាស');
    assert.equal(res.episode.scriptData.segments[1].voice, 'km-KH-SreymomNeural');
    assert.equal(res.episode.scriptData.segments[1].speakerGender, 'FEMALE');

    // Audio references MUST be reset to null/pending
    assert.equal(res.episode.scriptData.segments[0].audioPath, null);
    assert.equal(res.episode.scriptData.segments[0].audioUrl, null);
    assert.equal(res.episode.scriptData.segments[0].ttsStatus, 'pending');
    assert.equal(res.episode.scriptData.segments[0].audioDurationSec, null);

    assert.equal(res.episode.audioGenerated, false);
    assert.equal(res.episode.hasAudio, false);
    assert.equal(res.episode.fullAudioUrl, null);
    assert.equal(res.episode.renderedVideo, null);

    // Video preserved
    assert.equal(fs.existsSync(env.ep1VideoPath), true);

    // Ep 1 audio directory emptied
    const audioFiles = fs.readdirSync(path.join(env.ep1Dir, 'audio'));
    assert.equal(audioFiles.length, 0);
  } finally {
    env.cleanup();
  }
});

test('3. Regenerate Script after AUDIO READY: completely resets both script and audio', async () => {
  const env = createTestEnvironment();
  try {
    const res = await resetEpisodeState(env.seriesId, 'ep_1', {
      resetType: 'script',
      projectsDir: env.projectsDir,
    });

    assert.equal(res.episode.scriptData, null);
    assert.equal(res.episode.audioGenerated, false);
    assert.equal(res.episode.hasAudio, false);
    assert.equal(res.episode.fullAudioUrl, null);
    assert.equal(res.episode.renderedVideo, null);
  } finally {
    env.cleanup();
  }
});

test('4. Reload / Persistence Check: series.json reflects reset state when reloaded freshly from disk', async () => {
  const env = createTestEnvironment();
  try {
    await resetEpisodeState(env.seriesId, 'ep_1', {
      resetType: 'voice',
      projectsDir: env.projectsDir,
    });

    // Force re-read directly from disk bypassing any cache
    const freshMeta = getSeriesMetadata(env.seriesId, { forceDisk: true, projectsDir: env.projectsDir });
    const freshEp1 = freshMeta.episodes.find((e) => e.id === 'ep_1');

    assert.equal(freshEp1.audioGenerated, false);
    assert.equal(freshEp1.fullAudioUrl, null);
    assert.equal(freshEp1.scriptData.segments[0].ttsStatus, 'pending');
    assert.equal(freshEp1.scriptData.segments[0].audioPath, null);
  } finally {
    env.cleanup();
  }
});

test('5. Episode Isolation: Resetting EP1 does NOT touch EP2 video, script, or audio', async () => {
  const env = createTestEnvironment();
  try {
    await resetEpisodeState(env.seriesId, 'ep_1', {
      resetType: 'script',
      projectsDir: env.projectsDir,
    });

    const meta = getSeriesMetadata(env.seriesId, { forceDisk: true, projectsDir: env.projectsDir });
    const ep2 = meta.episodes.find((e) => e.id === 'ep_2');

    // EP2 must remain 100% untouched
    assert.equal(ep2.audioGenerated, true);
    assert.equal(ep2.hasAudio, true);
    assert.equal(ep2.scriptData.segments.length, 1);
    assert.equal(ep2.scriptData.segments[0].khmer, 'ចូរចេញទៅភ្លាម');
    assert.equal(ep2.scriptData.segments[0].ttsStatus, 'ready');

    // EP2 disk files preserved
    assert.equal(fs.existsSync(env.ep2VideoPath), true);
    assert.equal(fs.existsSync(path.join(env.ep2Dir, 'audio', 'ep_2_narration_khmer.mp3')), true);
    assert.equal(fs.existsSync(path.join(env.ep2Dir, 'audio', 'seg_1_ep2.mp3')), true);
  } finally {
    env.cleanup();
  }
});

test('6. Rapid Double-Click Protection: Concurrent resets for same episode serialize safely under lock', async () => {
  const env = createTestEnvironment();
  try {
    const [res1, res2] = await Promise.all([
      resetEpisodeState(env.seriesId, 'ep_1', { resetType: 'voice', projectsDir: env.projectsDir }),
      resetEpisodeState(env.seriesId, 'ep_1', { resetType: 'voice', projectsDir: env.projectsDir }),
    ]);

    assert.equal(res1.success, true);
    assert.equal(res2.success, true);

    const meta = getSeriesMetadata(env.seriesId, { forceDisk: true, projectsDir: env.projectsDir });
    const ep1 = meta.episodes.find((e) => e.id === 'ep_1');
    assert.equal(ep1.audioGenerated, false);
    assert.equal(ep1.scriptData.segments[0].ttsStatus, 'pending');
  } finally {
    env.cleanup();
  }
});

test('7. Error Handling: Non-existent episode or series throws clear Error without corrupting metadata', async () => {
  const env = createTestEnvironment();
  try {
    await assert.rejects(
      () => resetEpisodeState('non_existent_series', 'ep_1', { projectsDir: env.projectsDir }),
      /Series not found/
    );

    await assert.rejects(
      () => resetEpisodeState(env.seriesId, 'ep_999', { projectsDir: env.projectsDir }),
      /Episode ep_999 not found/
    );

    // Verify series is still valid and uncorrupted
    const meta = getSeriesMetadata(env.seriesId, { forceDisk: true, projectsDir: env.projectsDir });
    assert.equal(meta.episodes.length, 2);
  } finally {
    env.cleanup();
  }
});

test('8. Backup and Recovery Snapshot: Backups are properly created before reset', async () => {
  const env = createTestEnvironment();
  try {
    await resetEpisodeState(env.seriesId, 'ep_1', { resetType: 'script', projectsDir: env.projectsDir });

    const backupDir = path.join(env.ep1Dir, 'backups');
    const backups = fs.readdirSync(backupDir);
    assert.ok(backups.length >= 1);

    const scriptBackupFile = backups.find((f) => f.startsWith('reset_script_script_'));
    assert.ok(scriptBackupFile);

    const backedUpContent = JSON.parse(fs.readFileSync(path.join(backupDir, scriptBackupFile), 'utf8'));
    assert.equal(backedUpContent.segments.length, 2);
    assert.equal(backedUpContent.segments[0].khmer, 'សួស្តីបងប្អូនទាំងអស់គ្នា');
  } finally {
    env.cleanup();
  }
});

test('9. No Stale Script / Audio Reappearance after Reset: disk hydration does not restore deleted state', async () => {
  const env = createTestEnvironment();
  try {
    await resetEpisodeState(env.seriesId, 'ep_1', { resetType: 'script', projectsDir: env.projectsDir });

    // When getSeriesMetadata is called (which runs safe disk hydration), deleted files cannot resurrect
    const rehydrated = getSeriesMetadata(env.seriesId, { forceDisk: true, projectsDir: env.projectsDir });
    const ep1 = rehydrated.episodes.find((e) => e.id === 'ep_1');

    assert.equal(ep1.scriptData, null);
    assert.equal(ep1.audioGenerated, false);
    assert.equal(ep1.fullAudioUrl, null);
    assert.equal(ep1.hasAudio, false);
  } finally {
    env.cleanup();
  }
});

test('10. Other Episodes Preserved: Multiple resets on EP1 leave EP2 completely intact across all cycles', async () => {
  const env = createTestEnvironment();
  try {
    // Cycle 1: Voice reset on EP1
    await resetEpisodeState(env.seriesId, 'ep_1', { resetType: 'voice', projectsDir: env.projectsDir });
    // Cycle 2: Script reset on EP1
    await resetEpisodeState(env.seriesId, 'ep_1', { resetType: 'script', projectsDir: env.projectsDir });

    const meta = getSeriesMetadata(env.seriesId, { forceDisk: true, projectsDir: env.projectsDir });
    const ep2 = meta.episodes.find((e) => e.id === 'ep_2');

    assert.equal(ep2.audioGenerated, true);
    assert.equal(ep2.scriptData.segments.length, 1);
    assert.equal(ep2.scriptData.segments[0].khmer, 'ចូរចេញទៅភ្លាម');
  } finally {
    env.cleanup();
  }
});

test('11. 257-Segment Scale Test: Preserves all 257 segments, character assignments, gender, custom rates during voice reset', async () => {
  const env = createTestEnvironment();
  try {
    // Generate 257 realistic segments
    const segments257 = [];
    for (let i = 1; i <= 257; i++) {
      const isFemale = i % 3 === 0;
      segments257.push({
        id: i,
        speaker: isFemale ? `នារី #${i}` : `បុរស #${i}`,
        gender: isFemale ? 'female' : 'male',
        speakerGender: isFemale ? 'FEMALE' : 'MALE',
        voice: isFemale ? 'km-KH-SreymomNeural' : 'km-KH-PisethNeural',
        assignedVoice: isFemale ? 'km-KH-SreymomNeural' : 'km-KH-PisethNeural',
        khmer: `ឃ្លាទី #${i} នៃការសន្ទនាក្នុងរឿង`,
        audioPath: path.join(env.ep1Dir, 'audio', `seg_${i}.mp3`),
        audioUrl: `/uploads/.../seg_${i}.mp3`,
        audioFile: `seg_${i}.mp3`,
        ttsStatus: 'ready',
        audioDurationSec: 2.0 + (i % 5) * 0.5,
        speed: i % 4 === 0 ? 1.15 : 'normal',
        userTrimmed: i % 10 === 0,
      });
      // Create mock audio file
      fs.writeFileSync(path.join(env.ep1Dir, 'audio', `seg_${i}.mp3`), `AUDIO_${i}`);
    }

    // Save initial 257-segment state
    const series = getSeriesMetadata(env.seriesId, { forceDisk: true, projectsDir: env.projectsDir });
    series.episodes[0].scriptData = {
      segments: segments257,
      updatedAt: Date.now(),
    };
    series.episodes[0].audioGenerated = true;
    series.episodes[0].hasAudio = true;
    saveSeriesMetadata(series, { projectsDir: env.projectsDir });

    // Execute Voice Reset
    const res = await resetEpisodeState(env.seriesId, 'ep_1', {
      resetType: 'voice',
      projectsDir: env.projectsDir,
    });

    assert.equal(res.success, true);
    assert.equal(res.episode.scriptData.segments.length, 257);

    // Verify all 257 segments have audio reset to pending while text and voice metadata are 100% preserved
    for (let i = 0; i < 257; i++) {
      const seg = res.episode.scriptData.segments[i];
      assert.equal(seg.id, i + 1);
      assert.equal(seg.khmer, `ឃ្លាទី #${i + 1} នៃការសន្ទនាក្នុងរឿង`);
      const isFemale = (i + 1) % 3 === 0;
      assert.equal(seg.voice, isFemale ? 'km-KH-SreymomNeural' : 'km-KH-PisethNeural');
      assert.equal(seg.speakerGender, isFemale ? 'FEMALE' : 'MALE');

      // Audio state reset
      assert.equal(seg.audioPath, null);
      assert.equal(seg.audioUrl, null);
      assert.equal(seg.audioFile, null);
      assert.equal(seg.ttsStatus, 'pending');
      assert.equal(seg.audioDurationSec, null);
    }

    // Verify disk audio files were completely removed
    const remainingFiles = fs.readdirSync(path.join(env.ep1Dir, 'audio'));
    assert.equal(remainingFiles.length, 0);

    // Verify original video is intact
    assert.equal(fs.existsSync(env.ep1VideoPath), true);
  } finally {
    env.cleanup();
  }
});
