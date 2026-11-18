import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveSegmentIsFemale } from '../../frontend/src/utils/timelineUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

describe('Instant Voice Assignment Color/Label, Mid-Gen Persistence & Failure Rollback', () => {
  it('1. resolveSegmentIsFemale prioritizes explicit segment voiceId over stale speakerName (fixes #129 speaker="តួអង្គស្រី" + Piseth)', () => {
    // Owner's exact #129 bug: speakerName contains "ស្រី", but manual voiceId is Piseth -> MUST be male (false)!
    const seg129SwitchedMale = {
      id: 129,
      speaker: 'តួអង្គស្រី',
      speakerName: 'តួអង្គស្រី',
      voiceId: 'km-KH-PisethNeural',
      khmerVoiceId: 'km-KH-PisethNeural',
      speakerGender: 'MALE',
      voiceGender: 'male',
      gender: 'male',
      voiceAssignmentSource: 'manual',
    };
    assert.equal(resolveSegmentIsFemale(seg129SwitchedMale), false, 'Manual Piseth MUST render male-blue even when speaker contains ស្រី');

    // Reverse: speakerName contains "ប្រុស", but manual voiceId is Sreymom -> MUST be female (true)!
    const segSwitchedFemale = {
      id: 6,
      speaker: 'តួឯកប្រុស',
      speakerName: 'តួឯកប្រុស',
      voiceId: 'km-KH-SreymomNeural',
      khmerVoiceId: 'km-KH-SreymomNeural',
      speakerGender: 'FEMALE',
      voiceGender: 'female',
      gender: 'female',
      voiceAssignmentSource: 'manual',
    };
    assert.equal(resolveSegmentIsFemale(segSwitchedFemale), true, 'Manual Sreymom MUST render female-pink even when speaker contains ប្រុស');

    // Fallback when no voiceId/gender exists: uses speakerName
    assert.equal(resolveSegmentIsFemale({ id: 1, speaker: 'តួអង្គស្រី' }), true);
    assert.equal(resolveSegmentIsFemale({ id: 2, speaker: 'តួឯកប្រុស' }), false);
  });

  it('2. Static audit: instant UI update, generating indicator without reverting color, parallel pre-TTS persistence, and failure rollback + toast', () => {
    const canvasCode = fs.readFileSync(path.join(rootDir, 'frontend/src/components/timeline/TimelineTracksCanvas.jsx'), 'utf8');
    const dubbingCode = fs.readFileSync(path.join(rootDir, 'frontend/src/hooks/useAudioDubbing.js'), 'utf8');
    const appCode = fs.readFileSync(path.join(rootDir, 'frontend/src/App.jsx'), 'utf8');
    const routeCode = fs.readFileSync(path.join(rootDir, 'backend/routes/audioRoutes.js'), 'utf8');

    assert.ok(canvasCode.includes('resolveSegmentIsFemale('), 'TimelineTracksCanvas must use resolveSegmentIsFemale');
    assert.ok(canvasCode.includes('is-generating-voice') && canvasCode.includes('data-voice-gender'), 'TimelineTracksCanvas must render subtle generating indicator keeping new voice color');

    assert.ok(dubbingCode.includes('prevSegSnapshot') && dubbingCode.includes('prevSpeakerEntry'), 'useAudioDubbing must capture full rollback snapshot');
    assert.ok(dubbingCode.includes('saveTimelineOperationToLocalStorage(') && dubbingCode.includes('showVoiceSwitchError('), 'useAudioDubbing must persist immediately and show error toast on rollback');

    assert.ok(appCode.includes('voice-switch-error-toast'), 'App.jsx must render visible error toast on voice switch failure');
    assert.ok(routeCode.includes('prePersistPromise') && routeCode.includes('await prePersistPromise'), 'Backend must pre-persist manual voice assignment in parallel with Edge TTS');
  });
});
