/**
 * Lightweight, zero-App-rerender live preview event bus for Inspector sliders.
 * While dragging a slider, ONLY the target overlay or audio element subscribes
 * to 'inspector:draft-preview' — preventing full-studio re-renders, localStorage
 * writes, backend syncs, and render invalidations on every pointer move.
 */

export const DRAFT_PREVIEW_EVENT = 'inspector:draft-preview';

const activeDrafts = new Map();

export function dispatchDraftPreview(key, value) {
  if (!key) return;
  activeDrafts.set(key, value);
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent(DRAFT_PREVIEW_EVENT, {
      detail: { key, value, cleared: false },
    }));
  }
}

export function clearDraftPreview(key) {
  if (!key) return;
  activeDrafts.delete(key);
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent(DRAFT_PREVIEW_EVENT, {
      detail: { key, value: undefined, cleared: true },
    }));
  }
}

export function getActiveDraftPreview(key) {
  return activeDrafts.has(key) ? activeDrafts.get(key) : undefined;
}

export function subscribeDraftPreview(keys, handler) {
  if (typeof window === 'undefined' || typeof handler !== 'function') {
    return () => {};
  }
  const keySet = new Set(Array.isArray(keys) ? keys : [keys]);
  const listener = (evt) => {
    const detail = evt?.detail;
    if (!detail || !keySet.has(detail.key)) return;
    handler(detail);
  };
  window.addEventListener(DRAFT_PREVIEW_EVENT, listener);
  return () => window.removeEventListener(DRAFT_PREVIEW_EVENT, listener);
}

/**
 * Pure state machine helper for smooth-drag range sliders (unit-testable in Node).
 * Guarantees:
 * - Zero commits during pointer drag (pointerdown -> N inputs)
 * - Exactly ONE commit on pointer release (if value changed)
 * - Immediate single commit for keyboard / non-drag changes
 * - Displayed value while dragging always comes strictly from draft, never round-tripped store value
 */
export function createSliderDragController({ onDraft, onCommit }) {
  let isDragging = false;
  let dirty = false;
  let draftValue = null;
  let startValue = null;

  return {
    getState() {
      return { isDragging, dirty, draftValue, startValue };
    },
    startDrag(currentCommittedValue) {
      isDragging = true;
      dirty = false;
      startValue = currentCommittedValue;
      draftValue = currentCommittedValue;
    },
    input(nextValue) {
      if (!Number.isFinite(nextValue)) return;
      if (isDragging) {
        dirty = true;
        draftValue = nextValue;
        onDraft?.(nextValue);
      } else {
        // Keyboard arrows or programmatic non-drag change: single immediate commit
        draftValue = null;
        dirty = false;
        onCommit?.(nextValue);
      }
    },
    endDrag() {
      if (!isDragging) return;
      const shouldCommit = dirty && Number.isFinite(draftValue);
      const finalValue = draftValue;
      isDragging = false;
      dirty = false;
      draftValue = null;
      startValue = null;
      if (shouldCommit) {
        onCommit?.(finalValue);
      }
    },
    cancelDrag() {
      isDragging = false;
      dirty = false;
      draftValue = null;
      startValue = null;
    },
  };
}
