const test = require('node:test');
const assert = require('node:assert/strict');
const {
  autoAlignVoiceSegments,
  resetSegmentsToSourceTiming,
} = require('../../frontend/src/utils/timelineUtils.js');

test('autoAlignVoiceSegments: perfectly aligns voice clips to subtitle onsets with multi-track alternation', () => {
  // Scenario matching Nha's screenshot (Clips #3 to #12)
  const segments = [
    { id: 3, startSec: 93.0, endSec: 94.92, audioStartSec: 93.0, audioEndSec: 94.92, audioDurationSec: 1.92, speaker: 'Speaker A' },
    { id: 4, startSec: 95.5, endSec: 97.91, audioStartSec: 95.5, audioEndSec: 97.91, audioDurationSec: 2.41, speaker: 'Speaker B' },
    { id: 5, startSec: 98.8, endSec: 101.21, audioStartSec: 98.0, audioEndSec: 100.41, audioDurationSec: 2.41, speaker: 'Speaker A' }, // Previously corrupted to 98.0s
    { id: 6, startSec: 101.5, endSec: 104.68, audioStartSec: 100.41, audioEndSec: 103.59, audioDurationSec: 3.18, speaker: 'Speaker B' },
    { id: 7, startSec: 105.0, endSec: 107.14, audioStartSec: 103.59, audioEndSec: 105.73, audioDurationSec: 2.14, speaker: 'Speaker A' },
    { id: 8, startSec: 107.2, endSec: 108.2, audioStartSec: 105.73, audioEndSec: 106.73, audioDurationSec: 1.0, speaker: 'Speaker B' },
    { id: 9, startSec: 108.2, endSec: 109.2, audioStartSec: 107.0, audioEndSec: 108.0, audioDurationSec: 1.0, speaker: 'Speaker A' },
    { id: 10, startSec: 109.6, endSec: 113.25, audioStartSec: 108.5, audioEndSec: 112.15, audioDurationSec: 3.65, speaker: 'Speaker B' },
    { id: 11, startSec: 113.5, endSec: 114.8, audioStartSec: 112.1, audioEndSec: 113.4, audioDurationSec: 1.3, speaker: 'Speaker A' },
    { id: 12, startSec: 115.0, endSec: 117.34, audioStartSec: 113.5, audioEndSec: 115.84, audioDurationSec: 2.34, speaker: 'Speaker B' }
  ];

  const aligned = autoAlignVoiceSegments(segments, 375.37);

  // 1. Verify every segment's audioStartSec is in 100% lockstep with its visual subtitle startSec
  assert.equal(aligned[2].id, 3); // Clip #5 (index 2 in slice)
  assert.equal(aligned[2].audioStartSec, 98.8); // Resets back from 98.0 to true 98.8s
  assert.equal(aligned[2].startSec, 98.8);

  assert.equal(aligned[3].audioStartSec, 101.5);
  assert.equal(aligned[4].audioStartSec, 105.0);
  assert.equal(aligned[7].audioStartSec, 109.6);
  assert.equal(aligned[9].audioStartSec, 115.0);

  // 2. Verify clips that do not collide stay on the same clean line (Row 0 / VOICE 1):
  assert.equal(aligned[0].trackRow, 0); // VOICE 1
  assert.equal(aligned[1].trackRow, 0); // VOICE 1 (non-colliding)
  assert.equal(aligned[2].trackRow, 0); // VOICE 1
  assert.equal(aligned[3].trackRow, 0); // VOICE 1
  assert.equal(aligned[4].trackRow, 0); // VOICE 1
  assert.equal(aligned[5].trackRow, 0); // VOICE 1

  // 3. Verify no clips on the same track overlap
  const trackEnds = {};
  for (const seg of aligned) {
    const row = seg.trackRow;
    if (trackEnds[row] !== undefined) {
      assert.ok(
        seg.audioStartSec >= trackEnds[row] - 0.01,
        `Collision on Track ${row}: Clip #${seg.id} starts at ${seg.audioStartSec} before previous ended at ${trackEnds[row]}`
      );
    }
    trackEnds[row] = seg.audioEndSec;
  }
});

test('autoAlignVoiceSegments: prevents simultaneous multi-track voice overlap and eliminates duplicates', () => {
  // Scenario matching Nha's screenshot at 02:14:
  // Segment #20: 3.5s long narration from 133.59 to 137.09
  // Segment #21: "ម្នាក់ទៀតហើយ" at 133.75s
  // Segment #22: duplicate "ម្នាក់ទៀតហើយ" at 134.00s
  const collidingSegments = [
    {
      id: 20,
      startSec: 133.59,
      endSec: 137.09,
      audioDurationSec: 3.50,
      khmerText: 'ហេតុនេះហើយ គេត្រូវតែមុនពេលពិភពទាំងពីរបញ្ចូលគ្នា',
      originalChineseText: '所以他必须在两界归一之前',
      speaker: 'អ្នកសម្រាយ',
      speakerGender: 'MALE',
    },
    {
      id: 21,
      startSec: 133.75,
      endSec: 135.00,
      audioDurationSec: 1.25,
      khmerText: 'ម្នាក់ទៀតហើយ',
      originalChineseText: '又一个',
      speaker: 'តួអង្គទូទៅ',
      speakerGender: 'MALE',
    },
    {
      id: 22,
      startSec: 134.00,
      endSec: 135.25,
      audioDurationSec: 1.25,
      khmerText: 'ម្នាក់ទៀតហើយ',
      originalChineseText: '又一个',
      speaker: 'តួអង្គទូទៅ',
      speakerGender: 'MALE',
    },
  ];

  const aligned = autoAlignVoiceSegments(collidingSegments, 300.0);

  // 1. Duplicate #22 must be merged into #21 (only 2 distinct segments remain)
  assert.equal(aligned.length, 2, 'Duplicate "ម្នាក់ទៀតហើយ" within 2.5s must be merged');

  // 2. Segment 0 (id 1) plays from 133.59 to ~137.09
  assert.equal(aligned[0].startSec, 133.59);
  assert.equal(aligned[0].endSec, 137.09);

  // 3. Segment 1 (id 2) drops down to Track 1 (VOICE 2) to prevent forward time-drift
  // and stays anchored to its true video startSec (133.75):
  assert.equal(aligned[1].trackRow, 1, 'Overlapping dialogue must drop down to Track 1 (VOICE 2)');
  assert.equal(aligned[1].audioStartSec, 133.75, 'Dialogue onset must stay anchored to video mouth movement (0% drift)');
});

