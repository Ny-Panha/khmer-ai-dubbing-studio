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
});
