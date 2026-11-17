const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const frontendDir = path.join(__dirname, '..', '..', 'frontend', 'src', 'components', 'timeline');

test('Step 1: TimelineToolbar fixes duplicate plus sign, adds 3-stage left groups, center timecode, and right view/zoom controls', () => {
  const toolbarSource = fs.readFileSync(path.join(frontendDir, 'TimelineToolbar.jsx'), 'utf8');

  // 1. Duplicate "+ + ឃ្លា" fixed -> <Plus size={13} /> <span>ថែមឃ្លា</span>
  assert.doesNotMatch(toolbarSource, /\+\s*ឃ្លា/, 'Should not contain a literal "+" inside the Add Segment button label');
  assert.match(toolbarSource, /<Plus size=\{13\}\s*\/>\s*<span>ថែមឃ្លា<\/span>/);

  // 2. Left Section: 3 logical workflow groups (Group A: history-clip, Group B: video-slicing segmented pill, Group C: voice-timing)
  assert.match(toolbarSource, /data-workflow-group="history-clip"/);
  assert.match(toolbarSource, /data-workflow-group="video-slicing"/);
  assert.match(toolbarSource, /data-workflow-group="voice-timing"/);
  assert.match(toolbarSource, /Full Video/);
  assert.match(toolbarSource, /Auto-Cut by Subs/);
  assert.match(toolbarSource, /Reset Timing/);
  assert.match(toolbarSource, /timeline-pill-tool tool-neutral/);

  // 3. Center Section: Live Monospace Timecode Readout
  assert.match(toolbarSource, /className="toolbar-center-timecode"/);
  assert.match(toolbarSource, /className="timeline-timecode-current"/);
  assert.match(toolbarSource, /className="timeline-timecode-total"/);
  assert.match(toolbarSource, /formatMinSec\(currentTime\)/);
  assert.match(toolbarSource, /formatMinSec\(duration\)/);

  // 4. Right Section: Snap & Subs toggle pills + Zoom controls (0.5x to 3.0x)
  assert.match(toolbarSource, /min="0\.5"/);
  assert.match(toolbarSource, /max="3\.0"/);
  assert.match(toolbarSource, /showSubtitlesTrack \? 'Subs ON' : 'Subs OFF'/);
});

test('Step 2: Track Headers widen to 148px, prevent CLEAN BGM truncation, add colored status bars, and bind Mute states', () => {
  const headersSource = fs.readFileSync(path.join(frontendDir, 'TimelineTrackHeaders.jsx'), 'utf8');
  const editorSource = fs.readFileSync(path.join(frontendDir, 'TimelineEditor.jsx'), 'utf8');
  const canvasSource = fs.readFileSync(path.join(frontendDir, 'TimelineTracksCanvas.jsx'), 'utf8');
  const cssSource = fs.readFileSync(path.join(frontendDir, 'TimelineEditor.css'), 'utf8');

  // 1. Track header width 148px in both JS constant and CSS
  assert.match(editorSource, /const TRACK_HEADER_WIDTH = 148;/);
  assert.match(cssSource, /\.track-headers-column,\s*\.capcut-track-headers\s*\{[\s\S]*?width:\s*148px;[\s\S]*?min-width:\s*148px;[\s\S]*?max-width:\s*148px;/);

  // 2. 3px colored left status bars per track type & 22px x 22px control buttons
  assert.match(cssSource, /\.track-header\.video-track-hdr\s*\{[\s\S]*?border-left:\s*3px solid #00e5ff;/);
  assert.match(cssSource, /\.track-header\.voice-track-hdr\s*\{[\s\S]*?border-left:\s*3px solid #3b82f6;/);
  assert.match(cssSource, /\.track-header\.voice-track-hdr\.voice-track-secondary\s*\{[\s\S]*?border-left:\s*3px solid #ec4899;/);
  assert.match(cssSource, /\.track-header\.sub-track-hdr\s*\{[\s\S]*?border-left:\s*3px solid #8b5cf6;/);
  assert.match(cssSource, /\.track-header\.clean-bgm-track-hdr\s*\{[\s\S]*?border-left:\s*3px solid #10b981;/);
  assert.match(cssSource, /\.track-ctrl-mini-btn\s*\{[\s\S]*?width:\s*22px;[\s\S]*?height:\s*22px;/);

  // 3. VOICE 1 (👨/គោល) and VOICE 2 (👩/បន្ទាប់) sub-badges + CLEAN BGM full label
  assert.match(headersSource, /👨\/គោល/);
  assert.match(headersSource, /👩\/បន្ទាប់/);
  assert.match(headersSource, /CLEAN BGM/);

  // 4. Two-way Mute synchronization with VIDEO 1 and CLEAN BGM + Muted lane dimming & badge
  assert.match(headersSource, /onToggleMuteAllCuts\(true\)/);
  assert.match(headersSource, /duckingVolume:\s*isBgmMuted \? 0\.15 : 0/);
  assert.match(canvasSource, /is-track-muted/);
  assert.match(canvasSource, /<span className="track-muted-badge">MUTED<\/span>/);
  assert.match(cssSource, /\.track-lane\.is-track-muted\s*\{\s*opacity:\s*0\.45;\s*\}/);
});

test('Step 3: Smart VOICE 1 / VOICE 2 routing, semantic Male/Female colors, and responsive clip labels + tooltips', () => {
  const editorSource = fs.readFileSync(path.join(frontendDir, 'TimelineEditor.jsx'), 'utf8');
  const canvasSource = fs.readFileSync(path.join(frontendDir, 'TimelineTracksCanvas.jsx'), 'utf8');
  const cssSource = fs.readFileSync(path.join(frontendDir, 'TimelineEditor.css'), 'utf8');

  // 1. CapCut single-lane style: all auto-placed voice clips live sequentially on VOICE 1 (Lane 0)
  assert.match(editorSource, /CapCut single-lane style: all auto-placed voice clips live sequentially on VOICE 1/);
  assert.match(canvasSource, /CapCut single-lane style: all auto-placed voice clips live sequentially on VOICE 1/);

  // 2. Semantic Voice Clip Colors (Male oklch(0.28 0.08 250) + #38bdf8 top border; Female oklch(0.28 0.09 350) + #f472b6 top border)
  assert.match(cssSource, /\.voice-segment-block\.voice-male[\s\S]*?background:\s*oklch\(0\.28 0\.08 250\);[\s\S]*?border-top:\s*2px solid #38bdf8;/);
  assert.match(cssSource, /\.voice-segment-block\.voice-female[\s\S]*?background:\s*oklch\(0\.28 0\.09 350\);[\s\S]*?border-top:\s*2px solid #f472b6;/);

  // 3. Responsive clip labels (< 48px compact #N, 48px..94px #N speaker, >= 95px Khmer dialogue preview in Kantumruy Pro 11px) & rich tooltip
  assert.match(canvasSource, /const isCompactClip = clipWidthPx < 48;/);
  assert.match(canvasSource, /const isWideClip = clipWidthPx >= 95;/);
  assert.match(canvasSource, /voice-khmer-dialogue-preview/);
  assert.match(canvasSource, /title=\{`#\$\{(?:segmentNumber|idx \+ 1)\} \[\$\{speakerTooltipLabel\}\] \(\$\{startSec\.toFixed\(1\)\}s - \$\{endSec\.toFixed\(1\)\}s\)/);
  assert.match(canvasSource, /"\$\{khmerPreview/);
  assert.match(cssSource, /\.voice-khmer-dialogue-preview\s*\{[\s\S]*?font-family:\s*'Kantumruy Pro'/);
});

test('Step 4: Playhead uses CapCut Coral Red (#ff3b5c) with z-index 60 while selected clips keep Cyan accent', () => {
  const cssSource = fs.readFileSync(path.join(frontendDir, 'TimelineEditor.css'), 'utf8');

  // 1. Playhead z-index 60 and #ff3b5c Coral Red with glow
  assert.match(cssSource, /\.timeline-playhead\s*\{[\s\S]*?z-index:\s*60;/);
  assert.match(cssSource, /\.playhead-handle\s*\{[\s\S]*?width:\s*12px;[\s\S]*?height:\s*14px;[\s\S]*?background:\s*#ff3b5c;[\s\S]*?box-shadow:\s*0 0 6px rgba\(255, 59, 92, 0\.5\);/);
  assert.match(cssSource, /\.playhead-line,\s*\.capcut-playhead-line,\s*\.capcut-playhead-stem\s*\{[\s\S]*?background:\s*#ff3b5c;[\s\S]*?box-shadow:\s*0 0 6px rgba\(255, 59, 92, 0\.5\);/);
  assert.match(cssSource, /\.playhead-time-pill\s*\{[\s\S]*?background:\s*#ff3b5c;/);

  // 2. Selected clip border and trim handle remain Cyan (#38BDF8 / var(--primary-accent))
  assert.match(cssSource, /\.voice-segment-block\.selected[\s\S]*?outline:\s*2px solid var\(--primary-accent,\s*#38BDF8\)/);
  assert.match(cssSource, /\.clip-trim-handle\s*\{[\s\S]*?background:\s*var\(--primary-accent,\s*#38BDF8\);/);
});
