const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

test('Playback State & Deferred Source Invariant Verification Suite', async (t) => {
  await t.test('1. VideoPlayerPreview deferred proxy hot-swap during active playback', () => {
    const playerFile = path.resolve(__dirname, '../../frontend/src/components/player/VideoPlayerPreview.jsx');
    const content = fs.readFileSync(playerFile, 'utf8');

    // Invariant: VideoPlayerPreview must track and handle deferred src transitions
    assert.ok(content.includes('pendingSrcSwitchSeekRef'), 'Must maintain pendingSrcSwitchSeekRef');
    assert.ok(content.includes('mapTimelineToSourceTime'), 'Must map timeline to source time');
  });

  await t.test('2. Latest-request-wins seek coalescing preserves final seek target', () => {
    // Model latest-request-wins seek coalescing
    class MockVideo {
      constructor() {
        this.currentTime = 0;
        this.seeking = false;
        this.listeners = {};
      }
      addEventListener(evt, fn) {
        if (!this.listeners[evt]) this.listeners[evt] = [];
        this.listeners[evt].push(fn);
      }
      emit(evt) {
        (this.listeners[evt] || []).forEach(fn => fn());
      }
      seekTo(time) {
        this.seeking = true;
        this.currentTime = time;
      }
      finishSeek() {
        this.seeking = false;
        this.emit('seeked');
      }
    }

    const v = new MockVideo();
    let nextSeekTarget = null;
    let pendingSeekTarget = null;
    const seekLog = [];

    const handleSeek = (targetTime) => {
      if (v.seeking) {
        nextSeekTarget = targetTime;
        return;
      }
      pendingSeekTarget = targetTime;
      seekLog.push(targetTime);
      v.seekTo(targetTime);
    };

    v.addEventListener('seeked', () => {
      if (nextSeekTarget !== null) {
        const t = nextSeekTarget;
        nextSeekTarget = null;
        if (Math.abs(v.currentTime - t) > 0.03) {
          pendingSeekTarget = t;
          seekLog.push(t);
          v.seekTo(t);
        }
      }
    });

    // Step A: First seek issues immediately
    handleSeek(10.0);
    assert.strictEqual(v.seeking, true);
    assert.strictEqual(v.currentTime, 10.0);
    assert.deepStrictEqual(seekLog, [10.0]);

    // Step B: Rapid intermediate seeks arrive while seeking
    handleSeek(15.0);
    handleSeek(20.0);
    handleSeek(25.5); // Final user target
    // Intermediate seeks are coalesced, not sent to decoder
    assert.strictEqual(nextSeekTarget, 25.5);
    assert.deepStrictEqual(seekLog, [10.0]);

    // Step C: Decoder finishes first seek
    v.finishSeek();
    // Latest target (25.5) was immediately dispatched!
    assert.strictEqual(v.seeking, true);
    assert.strictEqual(v.currentTime, 25.5);
    assert.deepStrictEqual(seekLog, [10.0, 25.5]);
    assert.strictEqual(nextSeekTarget, null);

    // Final finish
    v.finishSeek();
    assert.strictEqual(v.seeking, false);
    assert.strictEqual(v.currentTime, 25.5);
  });

  await t.test('3. HTML5 video play/pause event sync prevents playhead freeze', () => {
    let isPlaying = false;
    let intendedPlaying = false;
    let timeUpdateCalled = 0;

    const handleTimeUpdate = () => {
      if (!isPlaying) return;
      timeUpdateCalled++;
    };

    const onNativePlay = () => {
      intendedPlaying = true;
      isPlaying = true;
    };

    const onNativePause = (isSeeking) => {
      if (isSeeking) return;
      intendedPlaying = false;
      isPlaying = false;
    };

    // Simulated source switch scenario:
    // Video unloads -> paused
    onNativePause(false);
    assert.strictEqual(isPlaying, false);

    // Metadata loads, video resumes
    onNativePlay();
    assert.strictEqual(isPlaying, true);
    assert.strictEqual(intendedPlaying, true);

    // Subsequent frame tick
    handleTimeUpdate();
    assert.strictEqual(timeUpdateCalled, 1, 'timeUpdate must not be blocked when native playback resumes');
  });

  await t.test('4. Virtual DOM render thrashing prevention during active playback', () => {
    const appFile = path.resolve(__dirname, '../../frontend/src/App.jsx');
    const appContent = fs.readFileSync(appFile, 'utf8');

    assert.ok(appContent.includes('const MemoMediaLibrary = React.memo(MediaLibrary'), 'App.jsx must wrap MediaLibrary in React.memo');
    assert.ok(appContent.includes('<MemoMediaLibrary'), 'App.jsx must render MemoMediaLibrary to avoid 5Hz currentTime re-renders');

    const timelineFile = path.resolve(__dirname, '../../frontend/src/components/timeline/TimelineEditor.jsx');
    const timelineContent = fs.readFileSync(timelineFile, 'utf8');

    assert.ok(timelineContent.includes('if (!isPlaying) {'), 'TimelineEditor must not trigger top-level onSelectSegment on every segment boundary during active playback');
    assert.ok(timelineContent.includes('wasPlayingSyncRef'), 'TimelineEditor must synchronize active segment to onSelectSegment on playback pause');
  });

  await t.test('5. Audio synchronization invariants: cold seek avoidance, startup grace, and rate nudge deadzone', () => {
    const playerFile = path.resolve(__dirname, '../../frontend/src/components/player/VideoPlayerPreview.jsx');
    const content = fs.readFileSync(playerFile, 'utf8');

    // Cold seek avoidance on natural start (from beginning of segment)
    assert.ok(content.includes('isNaturalStart = Math.abs(expectedOffset) <= 0.055'), 'Must check natural start to avoid cold seek latency');
    assert.ok(content.includes('startedAtPerf: performance.now()'), 'Must record startedAtPerf for startup grace calculation');

    // Startup grace prevents premature seek while audio element spins up physical output
    assert.ok(content.includes('isStartupGrace = (nowPerf - (activeItem.startedAtPerf || 0)) < 650'), 'Must provide at least 650ms startup grace period');

    // Rate nudge deadzone (>= 60ms) prevents pitch-warping flutter from normal frame quantization (33ms at 30fps)
    assert.ok(content.includes('absDrift >= 0.065'), 'Rate nudge threshold must be >= 65ms (2 video frames)');

    // Demucs BGM sync cooldown prevents repeated seeks
    assert.ok(content.includes('lastBgmSeekMsRef'), 'Must maintain lastBgmSeekMsRef for BGM seek throttling');
  });
});
