export function resolveTimelineDeleteTarget({
  selectedClipKind = null,
  selectedSegmentId = null,
  activeClipId = null,
} = {}) {
  const hasSegment = selectedSegmentId !== null && selectedSegmentId !== undefined;
  const hasClip = activeClipId !== null && activeClipId !== undefined;

  if (selectedClipKind === 'video') return hasClip ? { type: 'clip', id: activeClipId } : null;
  if (selectedClipKind === 'voice' || selectedClipKind === 'subtitle') {
    return hasSegment ? { type: 'segment', id: selectedSegmentId } : null;
  }
  if (hasSegment) return { type: 'segment', id: selectedSegmentId };
  if (hasClip) return { type: 'clip', id: activeClipId };
  return null;
}
