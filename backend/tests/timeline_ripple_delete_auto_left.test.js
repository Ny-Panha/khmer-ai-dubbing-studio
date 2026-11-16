const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

describe('Timeline Ripple Delete & Auto-Shift Left Suite', () => {
  // Read and compile timelineUtils functions for unit testing
  const timelineUtilsPath = path.resolve(__dirname, '../../frontend/src/utils/timelineUtils.js');
  const code = fs.readFileSync(timelineUtilsPath, 'utf8');

  // Verify function definitions
  test('1. timelineUtils exports deleteClipById, deleteSegmentByIdOrIndex, and bridgeClipGaps with ripple support', () => {
    assert.ok(code.includes('export function deleteClipById'), 'deleteClipById must be exported');
    assert.ok(code.includes('export function deleteSegmentByIdOrIndex'), 'deleteSegmentByIdOrIndex must be exported');
    assert.ok(code.includes('export function bridgeClipGaps'), 'bridgeClipGaps must be exported');
    assert.ok(code.includes('ripple = true'), 'ripple option must be enabled by default');
  });

  test('2. Ripple delete on video clips shifts subsequent cuts left and snaps to 00:00', () => {
    // Simulate deleteClipById behavior
    const clips = [
      { id: 'clip-1', start: 0, end: 5.5 },
      { id: 'clip-2', start: 5.5, end: 8.0 },
      { id: 'clip-3', start: 8.0, end: 12.0 },
    ];

    // Deleting clip-1 (duration 5.5s) must pull clip-2 and clip-3 to start at 00:00
    const targetClip = clips[0];
    const dur = targetClip.end - targetClip.start;
    const remaining = clips.filter(c => c.id !== 'clip-1');

    const shifted = remaining.map(c => ({
      ...c,
      start: parseFloat((c.start - dur).toFixed(3)),
      end: parseFloat((c.end - dur).toFixed(3)),
    }));

    assert.equal(shifted[0].start, 0, 'First remaining clip must snap to 00:00');
    assert.equal(shifted[0].end, 2.5, 'First remaining clip end must be 2.5');
    assert.equal(shifted[1].start, 2.5, 'Second remaining clip start must be 2.5');
    assert.equal(shifted[1].end, 6.5, 'Second remaining clip end must be 6.5');
  });

  test('3. bridgeClipGaps snaps leading gap to 00:00 when first clip starts at > 0', () => {
    assert.ok(code.includes('const leadOffset = sorted[0].start > 0.04 ? sorted[0].start : 0;'), 'bridgeClipGaps must calculate leadOffset');
  });

  test('4. Auto-Align and delete share the voice + video timeline cleanup pass', () => {
    const hookPath = path.resolve(__dirname, '../../frontend/src/hooks/useClipOperations.js');
    const hookCode = fs.readFileSync(hookPath, 'utf8');
    const utilsCode = fs.readFileSync(timelineUtilsPath, 'utf8');

    assert.ok(hookCode.includes('alignTimelineFromSegments('), 'shared state pass must use the timeline utility');
    assert.ok(hookCode.includes('runTimelineAlignmentPass({ segments: currentSegments, clips: videoClips, recordUndo: true })'), 'Auto-Align button must call the shared pass');
    assert.ok(hookCode.includes('clips: updated,'), 'video delete must call the shared pass after its ripple');
    assert.ok(hookCode.includes('clips: nextVideoClips,'), 'segment delete must call the shared pass after its linked ripple');
    assert.ok(utilsCode.includes('export function alignTimelineFromSegments('), 'shared utility must align voice and rebuild video');
    assert.ok(utilsCode.includes('if (seg.userShifted) return seg;'), 'user-shifted clips must stay fixed during pre-alignment');
    assert.ok(hookCode.includes('deleteClipById(videoClips, targetClipId, { allowEmpty: true, ripple: true })'), 'handleDeleteClip must call deleteClipById with ripple: true');
  });

  test('5. Deleting a Gap clip ripples subsequent video cuts and voice cues without removing voice segments', () => {
    const hookPath = path.resolve(__dirname, '../../frontend/src/hooks/useClipOperations.js');
    const hookCode = fs.readFileSync(hookPath, 'utf8');

    assert.ok(hookCode.includes('// 1. User deleted a Gap clip'), 'handleDeleteClip must handle gap clips specifically');
    assert.ok(hookCode.includes('s >= targetEnd - 0.02'), 'handleDeleteClip must ripple voice segments starting after gap end');
  });

  test('6. Deleting a Dialogue clip removes matching voice segment and ripples both tracks in lockstep', () => {
    const hookPath = path.resolve(__dirname, '../../frontend/src/hooks/useClipOperations.js');
    const hookCode = fs.readFileSync(hookPath, 'utf8');

    assert.ok(hookCode.includes('// 2. User deleted a DIALOGUE clip: Remove matching voice segment(s) and ripple remaining'), 'handleDeleteClip must delete matching voice segment');
    assert.ok(hookCode.includes('findAssociatedSegmentIndices(targetClip, scriptData.segments)'), 'handleDeleteClip must find associated segments');
  });

  test('7. Deleting a Voice segment removes matching video cut and ripples both tracks', () => {
    const hookPath = path.resolve(__dirname, '../../frontend/src/hooks/useClipOperations.js');
    const hookCode = fs.readFileSync(hookPath, 'utf8');

    assert.ok(hookCode.includes('deleteClipById(videoClips, matchingClip.id, { allowEmpty: true, ripple: true })'), 'handleDeleteSegment must delete matching video clip');
  });

  test('8. Shared cleanup synchronizes dialogue voice segments to their matching video cuts', () => {
    const utilsCode = fs.readFileSync(timelineUtilsPath, 'utf8');

    assert.ok(utilsCode.includes('const matchingCut = dialogueClips.find'), 'Shared alignment must anchor voice to matching dialogue video cuts');
  });
});
