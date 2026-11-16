const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('filterScriptSegments matches stable line numbers (#37 / 37 / ៣៧) after deletion and searches text/speaker', async () => {
  const { filterScriptSegments } = await import('../../frontend/src/utils/scriptSearchUtils.js');

  const segments = Array.from({ length: 250 }, (_, idx) => {
    const num = idx + 1;
    const lineNumber = num + 1;
    return {
      id: lineNumber, // Line #1 was deleted; surviving labels retain their original numbers.
      speaker: lineNumber === 37 ? 'តួឯកប្រុស' : (lineNumber % 2 === 0 ? 'ប្រព័ន្ធ' : 'តួអង្គ'),
      khmerTranslatedText: lineNumber === 137
        ? 'ឃ្លាទី ១៣៧'
        : (lineNumber === 37 ? 'ចាំមើលចុះ' : (num === 120 ? 'តម្លៃ 5000 កាក់' : `អត្ថបទទី ${lineNumber}`)),
      originalChineseText: lineNumber === 37 ? '待我站上那测灵石前' : `台词 ${lineNumber}`,
    };
  });

  // 1. Typing "37", " 37 ", "#37", "# 37", or Khmer digits "៣៧" returns stable line #37 (segments[35]).
  for (const query of ['37', ' 37 ', '#37', '# 37', '៣៧']) {
    const res = filterScriptSegments(segments, query);
    assert.equal(res.length, 1, `Query "${query}" must match exact #37 only (not #137/#237)`);
    assert.equal(res[0], segments[35], `Query "${query}" must return line #37 after earlier rows were deleted`);
  }
  const postDelete = [1, 2, 4, 5].map((id) => ({ id, segmentId: id }));
  assert.equal(filterScriptSegments(postDelete, '#4')[0], postDelete[2]);
  assert.equal(filterScriptSegments(postDelete, '#3').length, 0);

  // 2. Out-of-range bare number falls back to text match (e.g. "5000" in 250-segment episode)
  const outOfRangeText = filterScriptSegments(segments, '5000');
  assert.equal(outOfRangeText.length, 1);
  assert.equal(outOfRangeText[0], segments[119]);

  // 3. Explicit "#9999" with no matching id returns empty array
  assert.equal(filterScriptSegments(segments, '#9999').length, 0);

  // 4. Dialogue/Khmer/Chinese/Speaker search still works including khmerTranslatedText
  assert.equal(filterScriptSegments(segments, 'ចាំមើលចុះ')[0], segments[35]);
  assert.equal(filterScriptSegments(segments, '测灵石')[0], segments[35]);
  assert.equal(filterScriptSegments(segments, 'តួឯកប្រុស')[0], segments[35]);
  assert.equal(filterScriptSegments(segments, '').length, 250);
});

test('Script search UI wiring uses filterScriptSegments and stable line numbers', () => {
  const mediaLibraryCode = fs.readFileSync(
    path.resolve(__dirname, '../../frontend/src/components/media/MediaLibrary.jsx'),
    'utf8'
  );
  const scriptReviewCode = fs.readFileSync(
    path.resolve(__dirname, '../../frontend/src/components/media/ScriptReviewTab.jsx'),
    'utf8'
  );

  assert.ok(mediaLibraryCode.includes('filterScriptSegments(scriptData.segments, searchQuery)'));
  assert.ok(scriptReviewCode.includes('s === seg ||'));
  assert.ok(scriptReviewCode.includes('const segmentNumber = seg.segmentId ?? seg.id ?? idx + 1;'));
  assert.ok(scriptReviewCode.includes('#{segmentNumber}'));
  assert.ok(scriptReviewCode.includes('Search #37, dialogue, or speaker...'));
  assert.ok(scriptReviewCode.includes('aria-label="Clear search"'));
});

test('resolveVoiceClipStartSec & computeTimelineScrollForTime accurately target off-screen VOICE clips', async () => {
  const { resolveVoiceClipStartSec, computeTimelineScrollForTime } = await import('../../frontend/src/utils/timelineUtils.js');

  // 1. Priority: audioStartSec -> startSec -> string start -> idx * 4 fallback
  assert.equal(resolveVoiceClipStartSec({ audioStartSec: 38.4, startSec: 38.0, start: '00:37' }, 17), 38.4);
  assert.equal(resolveVoiceClipStartSec({ startSec: 77.25, start: '01:17' }, 36), 77.25);
  assert.equal(resolveVoiceClipStartSec({ start: '01:17' }, 36), 77);
  assert.equal(resolveVoiceClipStartSec({}, 5), 20);
  assert.equal(resolveVoiceClipStartSec({ audioStartSec: -2 }, 1), 0);

  // 2. Scroll geometry matches playhead centering (trackHeaderWidth=112)
  assert.equal(computeTimelineScrollForTime(1.0, 45, 1000, 112), 0); // 1*45+112=157 < 500
  assert.equal(computeTimelineScrollForTime(38.0, 45, 1000, 112), 1322); // 38*45+112=1822 - 500 = 1322
  assert.equal(computeTimelineScrollForTime(77.0, 45, 900, 112), 3127); // 77*45+112=3577 - 450 = 3127
  assert.equal(computeTimelineScrollForTime(77.0, 45, 0, 112), 0);
});

test('Clicking segment in 3. Subs wires to App handleSelectSegmentFromScript -> TimelineEditor timelineFocusRequest', () => {
  const appCode = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/App.jsx'), 'utf8');
  const scriptReviewCode = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/components/media/ScriptReviewTab.jsx'), 'utf8');
  const timelineCode = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/components/timeline/TimelineEditor.jsx'), 'utf8');

  assert.ok(appCode.includes('const handleSelectSegmentFromScript = useCallback'));
  assert.ok(appCode.includes('resolveVoiceClipStartSec(targetSeg'));
  assert.ok(appCode.includes('setTimelineFocusRequest({'));
  assert.ok(appCode.includes('timelineFocusRequest={timelineFocusRequest}'));
  assert.ok(scriptReviewCode.includes('onSelectSegment(segKey, seg, idx)'));
  assert.ok(scriptReviewCode.includes("e.key === 'Enter'"));
  assert.ok(timelineCode.includes('manualFocusLockRef'));
  assert.ok(timelineCode.includes('computeTimelineScrollForTime('));
});
