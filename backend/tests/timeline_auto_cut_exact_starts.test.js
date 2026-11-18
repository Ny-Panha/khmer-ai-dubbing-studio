import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { autoSplitVideoBySegments, normalizeClips } from '../../frontend/src/utils/timelineUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

describe('Auto-Cut by Subs Exact Dialogue Starts (Zero Leftover Absorption)', () => {
  it('1. Creates a pure Gap clip for ANY positive space (including <= 0.15s) so every dialogue clip starts at its exact voice start', () => {
    const segments = [
      { id: 1, audioStartSec: 0.08, audioEndSec: 1.00, speaker: 'A' }, // 0.08s intro gap
      { id: 2, audioStartSec: 1.11, audioEndSec: 2.50, speaker: 'A' }, // 0.11s gap (previously absorbed!)
      { id: 3, audioStartSec: 2.57, audioEndSec: 4.00, speaker: 'A' }, // 0.07s gap (previously absorbed!)
      { id: 4, audioStartSec: 4.00, audioEndSec: 5.20, speaker: 'A' }, // 0.00s touching (no Gap)
      { id: 5, audioStartSec: 5.65, audioEndSec: 7.00, speaker: 'A' }, // 0.45s gap (#8 -> #9 style)
    ];

    const clips = autoSplitVideoBySegments(segments, 7.09, 'ep.mp4');

    // Expected: Intro Gap [0, 0.08], #1 [0.08, 1], Gap [1, 1.11], #2 [1.11, 2.5], Gap [2.5, 2.57], #3 [2.57, 4], #4 [4, 5.2], Gap [5.2, 5.65], #5 [5.65, 7], Outro [7, 7.09]
    const dialogues = clips.filter((c) => c.isDialogue);
    const gaps = clips.filter((c) => !c.isDialogue && c.name === 'Gap');
    const outro = clips.find((c) => c.name === 'Outro');

    assert.equal(dialogues.length, segments.length, 'Dialogue clip count must match segment count');
    assert.equal(gaps.length, 4, 'Must create 4 pure Gap clips for all 4 positive spaces (0.08s, 0.11s, 0.07s, 0.45s)');
    assert.ok(outro && outro.start === 7 && outro.end === 7.09, 'Must create Outro for 0.09s positive tail');

    // Verify exact dialogue starts (zero leftover heads!)
    segments.forEach((seg, i) => {
      assert.equal(dialogues[i].start, seg.audioStartSec, `Dialogue clip #${seg.id} must start exactly at ${seg.audioStartSec}s`);
      assert.equal(dialogues[i].sourceStart, seg.audioStartSec);
    });

    // Verify Gap boundaries
    assert.deepEqual(
      gaps.map((g) => [g.start, g.end]),
      [[0, 0.08], [1, 1.11], [2.5, 2.57], [5.2, 5.65]]
    );

    // Verify frozen rules: never mutes, pure Gaps (no segmentId/segmentIndex)
    assert.ok(clips.every((c) => c.isMuted === false), 'Auto-Cut must never mute any clip');
    for (const g of [...gaps, outro]) {
      assert.equal('segmentId' in g, false, 'Gap/Outro clip must not carry segmentId');
      assert.equal('segmentIndex' in g, false, 'Gap/Outro clip must not carry segmentIndex');
    }

    // Verify contiguity & zero overlap even after normalizeClips reload
    const reloaded = normalizeClips(clips, 7.09);
    for (let i = 1; i < reloaded.length; i++) {
      assert.equal(
        Number((reloaded[i].start - reloaded[i - 1].end).toFixed(3)),
        0,
        `Clip ${i} (${reloaded[i].name}) must abut clip ${i - 1} (${reloaded[i - 1].name}) with zero overlap after normalizeClips`
      );
    }
  });

  it('2. Preserves existing overlap clamp when next dialogue starts before previous dialogue ends', () => {
    const segments = [
      { id: 1, audioStartSec: 1.00, audioEndSec: 3.50, speaker: 'A' },
      { id: 2, audioStartSec: 2.80, audioEndSec: 4.50, speaker: 'B' },
    ];
    const clips = autoSplitVideoBySegments(segments, 5.0, 'overlap.mp4');
    const d1 = clips.find((c) => c.isDialogue && c.segmentId === 1);
    const d2 = clips.find((c) => c.isDialogue && c.segmentId === 2);

    assert.equal(d1.start, 1.0);
    assert.equal(d1.end, 2.8, 'Previous dialogue clip end must clamp cleanly to next start (2.8s)');
    assert.equal(d2.start, 2.8, 'Overlapping next dialogue clip must start cleanly at 2.8s');
    assert.equal(d2.end, 4.5);
  });

  it('3. Static check: 0.15s gap absorption threshold is removed from autoSplitVideoBySegments', () => {
    const code = fs.readFileSync(path.join(rootDir, 'frontend/src/utils/timelineUtils.js'), 'utf8');
    assert.ok(!code.includes('it.start > curTime + 0.15'), 'Must not absorb gaps <= 0.15s');
    assert.ok(!code.includes('totalDuration > curTime + 0.15'), 'Must not drop outro tails <= 0.15s');
  });
});
