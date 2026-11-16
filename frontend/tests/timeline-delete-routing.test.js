import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTimelineDeleteTarget } from '../src/utils/timelineDeleteRouting.js';

test('the most recent voice kind routes Delete to its segment even if the old type was video', () => {
  assert.deepEqual(
    resolveTimelineDeleteTarget({
      selectedClipKind: 'voice',
      selectedSegmentId: '_uid-6',
      activeClipId: 'video-6',
      lastSelectedType: 'video',
    }),
    { type: 'segment', id: '_uid-6' }
  );
});

test('the most recent video kind routes Delete to the video clip even when its voice is selected too', () => {
  assert.deepEqual(
    resolveTimelineDeleteTarget({
      selectedClipKind: 'video',
      selectedSegmentId: '_uid-6',
      activeClipId: 'video-6',
    }),
    { type: 'clip', id: 'video-6' }
  );
});

test('voice or subtitle kind without a selected segment does not fall through to deleting video', () => {
  assert.equal(
    resolveTimelineDeleteTarget({ selectedClipKind: 'subtitle', activeClipId: 'video-6' }),
    null
  );
});

test('an untyped selection keeps the existing segment-first then video fallback', () => {
  assert.deepEqual(
    resolveTimelineDeleteTarget({ selectedSegmentId: '_uid-6', activeClipId: 'video-6' }),
    { type: 'segment', id: '_uid-6' }
  );
  assert.deepEqual(
    resolveTimelineDeleteTarget({ activeClipId: 'video-6' }),
    { type: 'clip', id: 'video-6' }
  );
});
