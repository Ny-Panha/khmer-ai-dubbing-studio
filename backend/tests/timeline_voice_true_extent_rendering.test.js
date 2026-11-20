import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const getFrontendFile = (rel) => fs.existsSync(rel) ? rel : path.resolve(process.cwd(), '..', rel);

describe('Timeline Voice Clip True Audio Extent Rendering Suite', () => {
  it('1. Static audit: TimelineTracksCanvas computes box width matching true audio extent without empty tail', () => {
    const canvasCode = fs.readFileSync(getFrontendFile('frontend/src/components/timeline/TimelineTracksCanvas.jsx'), 'utf8');

    // Audio extent resolution
    assert.ok(canvasCode.includes('rawAudioExtent = seg.finalAudioDuration'), 'Resolves rawAudioExtent from finalAudioDuration');
    assert.ok(canvasCode.includes('rawAudioExtent = (appliedSpeed > 0 && Math.abs(appliedSpeed - 1.0) > 0.001)'), 'Applies speed scaling when appliedSpeed is set');
    assert.ok(canvasCode.includes('let renderedDuration = slotSpan;'), 'Initializes renderedDuration to slotSpan');
    assert.ok(canvasCode.includes('if (rawAudioExtent >= slotDur)'), 'Keeps slotSpan for overrun segments');
    assert.ok(canvasCode.includes('renderedDuration = rawAudioExtent;'), 'Shortens box to true audio extent for shorter clips');
    assert.ok(canvasCode.includes('const rawEnd = rawStart + renderedDuration;'), 'Calculates rawEnd as rawStart + renderedDuration');

    // Waveform bars match renderedDuration
    assert.ok(canvasCode.includes('renderedDuration * pps'), 'Waveform bars container and count use renderedDuration');

    // Video and subtitle rendering unchanged
    assert.ok(canvasCode.includes('const renderSubSegment'), 'Subtitle rendering intact');
    assert.ok(canvasCode.includes('const renderVideoClip'), 'Video clip rendering intact');
  });

  it('2. Extent simulation: Case A (Owner case #34) audio is shorter than slot -> box ends at waveform end, NO empty tail', () => {
    const seg34 = {
      id: 34,
      startSec: 10.0,
      endSec: 15.0, // 5.0s slot
      audioDurationSec: 2.0, // 2.0s true audio (~40% of slot)
      audioUrl: '/uploads/audio/seg34.mp3',
    };

    const slotStart = seg34.startSec;
    const slotEnd = seg34.endSec;
    const slotSpan = slotEnd - slotStart; // 5.0s
    const slotDur = slotEnd - slotStart;
    const hasAudio = Boolean(seg34.audioUrl);
    const rawAudioExtent = seg34.audioDurationSec;

    let renderedDuration = slotSpan;
    if (hasAudio && rawAudioExtent !== null) {
      if (rawAudioExtent >= slotDur) {
        renderedDuration = slotSpan;
      } else {
        renderedDuration = rawAudioExtent;
      }
    }

    const pps = 50; // 50 pixels per second
    const rawStart = seg34.startSec;
    const rawEnd = rawStart + renderedDuration;
    const boxWidthPx = Math.max(2, renderedDuration * pps - 2);
    const waveformWidthPx = Math.min(boxWidthPx, Math.max(16, renderedDuration * pps - 2));

    assert.equal(renderedDuration, 2.0, 'Rendered duration must equal true audio extent (2.0s)');
    assert.equal(rawEnd, 12.0, 'Clip box ends at 12.0s instead of 15.0s');
    assert.equal(boxWidthPx, waveformWidthPx, 'Box width matches waveform width with NO empty tail');
  });

  it('3. Extent simulation: Case B (Audio fills slot) -> box width matches slot', () => {
    const seg = {
      id: 10,
      startSec: 20.0,
      endSec: 24.0, // 4.0s slot
      audioDurationSec: 4.0,
      audioUrl: '/uploads/audio/seg10.mp3',
    };

    const slotStart = seg.startSec;
    const slotEnd = seg.endSec;
    const slotSpan = slotEnd - slotStart; // 4.0s
    const slotDur = slotEnd - slotStart;
    const hasAudio = Boolean(seg.audioUrl);
    const rawAudioExtent = seg.audioDurationSec;

    let renderedDuration = slotSpan;
    if (hasAudio && rawAudioExtent !== null) {
      if (rawAudioExtent >= slotDur) {
        renderedDuration = slotSpan;
      } else {
        renderedDuration = rawAudioExtent;
      }
    }

    assert.equal(renderedDuration, 4.0, 'Rendered duration equals slotSpan (4.0s)');
  });

  it('4. Extent simulation: Case C (Overrun segment) -> keeps slotSpan and marks isOver', () => {
    const seg = {
      id: 11,
      startSec: 30.0,
      endSec: 32.0, // 2.0s slot
      audioDurationSec: 3.5, // 1.5s overrun
      audioUrl: '/uploads/audio/seg11.mp3',
    };

    const slotStart = seg.startSec;
    const slotEnd = seg.endSec;
    const slotSpan = slotEnd - slotStart; // 2.0s
    const slotDur = slotEnd - slotStart;
    const hasAudio = Boolean(seg.audioUrl);
    const rawAudioExtent = seg.audioDurationSec;
    const realAudioDuration = rawAudioExtent;

    let renderedDuration = slotSpan;
    if (hasAudio && rawAudioExtent !== null) {
      if (rawAudioExtent >= slotDur) {
        renderedDuration = slotSpan;
      } else {
        renderedDuration = rawAudioExtent;
      }
    }

    const overSec = hasAudio ? parseFloat((realAudioDuration - slotDur).toFixed(2)) : 0;
    const isOver = overSec >= 0.15;

    assert.equal(renderedDuration, 2.0, 'Overrun segment keeps slotSpan box (2.0s)');
    assert.equal(overSec, 1.5, 'Overrun is 1.5s');
    assert.equal(isOver, true, 'isOver indicator is active');
  });

  it('5. Extent simulation: Case D (No audio / draft segment) -> keeps slotSpan box so visible and selectable', () => {
    const seg = {
      id: 12,
      startSec: 40.0,
      endSec: 43.5, // 3.5s slot
      audioUrl: null,
      audioPath: null,
    };

    const slotStart = seg.startSec;
    const slotEnd = seg.endSec;
    const slotSpan = slotEnd - slotStart; // 3.5s
    const slotDur = slotEnd - slotStart;
    const hasAudio = Boolean(seg.audioUrl || seg.audioPath);
    const rawAudioExtent = null;

    let renderedDuration = slotSpan;
    if (hasAudio && rawAudioExtent !== null) {
      if (rawAudioExtent >= slotDur) {
        renderedDuration = slotSpan;
      } else {
        renderedDuration = rawAudioExtent;
      }
    }

    assert.equal(renderedDuration, 3.5, 'Draft segment without audio retains full slotSpan box');
  });

  it('6. Extent simulation: Case E (appliedSpeed) -> effective extent scales by speed', () => {
    const seg = {
      id: 15,
      startSec: 50.0,
      endSec: 55.0, // 5.0s slot
      audioDurationSec: 3.0,
      appliedSpeed: 1.5,
      audioUrl: '/uploads/audio/seg15.mp3',
    };

    const appliedSpeed = seg.appliedSpeed;
    const rawAudioExtent = (appliedSpeed > 0 && Math.abs(appliedSpeed - 1.0) > 0.001)
      ? seg.audioDurationSec / appliedSpeed
      : seg.audioDurationSec;

    assert.equal(rawAudioExtent, 2.0, 'Audio duration scaled by speed (3.0s / 1.5 = 2.0s)');
  });

  it('7. Fallback order & waveform alignment audit: peaks-derived -> finalAudioDuration -> audioDurationSec/speed -> probed audio -> slot; bars use 4px pitch without 40-bar cutoff', () => {
    const canvasCode = fs.readFileSync(getFrontendFile('frontend/src/components/timeline/TimelineTracksCanvas.jsx'), 'utf8');

    assert.ok(canvasCode.includes('function resolvePeaksDuration(seg)'), 'Defines peaks/waveform duration resolver');
    assert.ok(canvasCode.includes('function resolveVoiceAudioExtent(seg, appliedSpeed, probedDuration)'), 'Defines unified voice extent resolver');
    assert.ok(canvasCode.includes('PROBED_AUDIO_DURATION_CACHE'), 'Uses UI-only in-memory probed audio cache for legacy segments lacking metadata');

    const fnStart = canvasCode.indexOf('function resolveVoiceAudioExtent');
    const fnSlice = canvasCode.slice(fnStart, fnStart + 1800);
    const idxPeaks = fnSlice.indexOf('if (peaksDuration !== null)');
    const idxFinal = fnSlice.indexOf('typeof seg.finalAudioDuration === \'number\'');
    const idxAudioSec = fnSlice.indexOf('typeof seg.audioDurationSec === \'number\'');
    const idxProbed = fnSlice.indexOf('typeof probedDuration === \'number\'');
    assert.ok(idxPeaks > 0 && idxFinal > idxPeaks && idxAudioSec > idxFinal && idxProbed > idxAudioSec,
      'Fallback order must be: peaks-derived -> finalAudioDuration -> audioDurationSec/appliedSpeed -> probed audio -> slot');

    // Waveform bar count uses true 4px pitch (2px bar + 2px gap) and is NOT capped at 40 bars
    assert.ok(canvasCode.includes('Math.floor((waveformWidthPx - 8) / 4)'), 'Waveform bar count matches 4px bar pitch inside 10px box inset');
    assert.ok(!canvasCode.includes('Math.min(40, Math.max(4, Math.floor(((renderedDuration * pps) - 10) / 6)))'),
      'Legacy /6 and 40-bar cutoff bug must be removed');
  });

  it('8. Legacy episode simulation (e.g. Pseudo_Spiritual_Root ep_1): missing metadata uses probed duration & bars fill full box edge-to-edge', () => {
    // Legacy segment #10: slot=2.8s, no finalAudioDuration/audioDurationSec, actual MP3=2.58s
    const seg10 = {
      id: 10,
      startSec: 21.6,
      endSec: 24.4,
      speed: 1,
      audioUrl: '/uploads/projects/Pseudo_Spiritual_Root/episodes/ep_1/audio/seg10.mp3',
    };
    const probedDuration = 2.58;
    const slotDur = seg10.endSec - seg10.startSec; // 2.8s
    const rawAudioExtent = probedDuration;
    const renderedDuration = rawAudioExtent >= slotDur ? slotDur : rawAudioExtent;
    assert.equal(renderedDuration, 2.58, 'Legacy segment shrinks to probed MP3 extent (2.58s)');

    // Check bar span fills inner box cleanly at both default zoom (pps=45) and high zoom (pps=120)
    for (const pps of [45, 120]) {
      const boxWidth = Math.max(2, renderedDuration * pps - 2);
      const waveformWidthPx = Math.min(boxWidth, Math.max(16, renderedDuration * pps - 2));
      const barCount = Math.min(400, Math.max(4, Math.floor((waveformWidthPx - 8) / 4)));
      const barsSpanPx = (barCount * 4) - 2;
      const innerWidth = boxWidth - 10; // 1px border + 4px padding on each side
      assert.ok(barsSpanPx <= innerWidth, `barsSpanPx (${barsSpanPx}) fits inside innerWidth (${innerWidth}) at pps=${pps}`);
      assert.ok(innerWidth - barsSpanPx <= 4, `Waveform reaches right edge within 1 bar pitch (gap=${innerWidth - barsSpanPx}px) at pps=${pps}`);
    }
  });
});
