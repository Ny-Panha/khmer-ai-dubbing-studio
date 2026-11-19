const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { uploadsDir } = require('../utils/pathUtils');
const { FFMPEG_PATH, FFPROBE_PATH, getMediaInfo } = require('../services/ffmpegService');
const sourceProxy = require('../services/sourceProxyService');

test('Source Proxy Suite: Validation, Cache Hits, Deduplication, and Keyframe Density', async (t) => {
  const tmpDir = path.join(uploadsDir, 'test_source_proxy_' + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });

  const dummySrc = path.join(tmpDir, 'sample_source.mp4');
  // Create a 2-second 30fps test source video with audio
  execFileSync(FFMPEG_PATH, [
    '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc=duration=2:size=1280x720:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=2:sample_rate=44100',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '60',
    '-c:a', 'aac', '-b:a', '64k',
    '-y', dummySrc
  ], { windowsHide: true });

  t.after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });

  await t.test('1. Source Content Hash and Stat Cache', () => {
    const hash1 = sourceProxy.getSourceContentHash(dummySrc);
    assert.ok(hash1 && hash1.length === 64, 'Should compute valid 64-char SHA256');

    const hash2 = sourceProxy.getSourceContentHash(dummySrc);
    assert.equal(hash1, hash2, 'Subsequent hash calls should return identical cached hash');
  });

  await t.test('2. Transcode Job Execution and Target Encoding Settings', async () => {
    const sourceHash = sourceProxy.getSourceContentHash(dummySrc);
    const info = await getMediaInfo(dummySrc);
    const sourceDuration = Number(info.format.duration);

    const job = await sourceProxy.startTranscodeJob(dummySrc, sourceHash, sourceDuration);
    assert.ok(job, 'Job should be created');

    // Wait for job completion
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 250));
      if (job.status === 'ready' || job.status === 'error') break;
    }

    assert.equal(job.status, 'ready', `Job should complete with ready status (error: ${job.error})`);
    assert.ok(job.bytes > 0, 'Proxy bytes should be > 0');
    assert.ok(job.url.includes(sourceHash), 'Proxy URL should include source hash');

    // Inspect the generated proxy file
    const proxyFile = path.join(uploadsDir, 'source_proxies', sourceHash, 'source-proxy.mp4');
    assert.ok(fs.existsSync(proxyFile), 'Proxy MP4 file must exist on disk');

    const proxyInfo = await getMediaInfo(proxyFile);
    const vStream = proxyInfo.streams.find(s => s.codec_type === 'video');
    const aStream = proxyInfo.streams.find(s => s.codec_type === 'audio');

    assert.equal(vStream.codec_name, 'h264', 'Video codec must be H.264');
    assert.equal(vStream.height, 480, 'Height should be 480p');
    assert.ok(vStream.width === 854 || vStream.width === 852, `Width should be 854 (found ${vStream.width})`);
    assert.equal(aStream.codec_name, 'aac', 'Audio codec must be AAC');

    // Verify duration alignment
    const proxyDur = Number(proxyInfo.format.duration);
    assert.ok(Math.abs(proxyDur - sourceDuration) < 0.1, `Duration should align (source: ${sourceDuration}, proxy: ${proxyDur})`);

    // Verify keyframe GOP is 15 frames (-g 15)
    const probeFramesCmd = execFileSync(FFPROBE_PATH, [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-skip_frame', 'nokey',
      '-show_frames',
      '-show_entries', 'frame=pkt_pts_time,best_effort_timestamp_time',
      '-of', 'json',
      proxyFile
    ], { windowsHide: true });
    const keyframes = JSON.parse(probeFramesCmd.toString()).frames;
    assert.ok(keyframes.length >= 4, `Should have keyframes every 15 frames / 0.5s in 2s video (found ${keyframes.length})`);
    for (let i = 1; i < keyframes.length; i++) {
      const t1 = parseFloat(keyframes[i - 1].best_effort_timestamp_time || keyframes[i - 1].pkt_pts_time);
      const t2 = parseFloat(keyframes[i].best_effort_timestamp_time || keyframes[i].pkt_pts_time);
      const diff = t2 - t1;
      assert.ok(diff <= 0.55, `Keyframe interval must be <= 0.5s (found diff: ${diff.toFixed(3)}s)`);
    }

    // Verify moov atom is at beginning (faststart)
    const fd = fs.openSync(proxyFile, 'r');
    const buf1 = Buffer.alloc(16);
    fs.readSync(fd, buf1, 0, 16, 0);
    const atom1Type = buf1.toString('ascii', 4, 8);
    const atom1Size = buf1.readUInt32BE(0);

    const buf2 = Buffer.alloc(16);
    fs.readSync(fd, buf2, 0, 16, atom1Size);
    const atom2Type = buf2.toString('ascii', 4, 8);
    fs.closeSync(fd);

    assert.equal(atom1Type, 'ftyp', 'First atom must be ftyp');
    assert.ok(atom2Type === 'moov' || atom2Type === 'free', `Second atom must be moov or free (found: ${atom2Type})`);
  });

  await t.test('3. Cache Hit Re-use with Zero Transcoding', async () => {
    const sourceHash = sourceProxy.getSourceContentHash(dummySrc);
    const cached = sourceProxy.getValidCachedProxy(sourceHash);
    assert.ok(cached, 'getValidCachedProxy must return cached proxy');
    assert.equal(cached.status, 'ready');
    assert.equal(cached.cached, true);
    assert.ok(cached.bytes > 0);
  });

  await t.test('4. Duplicate Job Prevention for Same Source Hash', async () => {
    const sourceHash = 'mock_hash_' + Date.now();
    const mockJob = {
      sourceHash,
      status: 'transcoding',
      progress: 50,
      startTime: Date.now(),
      elapsedSeconds: 2,
    };
    sourceProxy.activeJobs.set(sourceHash, mockJob);

    // Attempt starting another job with the same hash
    const duplicate = await sourceProxy.startTranscodeJob(dummySrc, sourceHash, 10);
    assert.equal(duplicate, mockJob, 'Must return the existing in-flight job instance');
    assert.equal(sourceProxy.activeJobs.size >= 1, true);

    sourceProxy.activeJobs.delete(sourceHash);
  });
});
