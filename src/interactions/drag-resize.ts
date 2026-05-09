/**
 * Box drag/resize gestures (Layer 4 — interactions).
 *
 * One pointer interaction at a time, serialized via `setPointerCapture`.
 * Move math is "from start" (each frame computes next state from
 * `dragState.startState` + cumulative delta) rather than "from prev",
 * so the gesture is stateless across frames and immune to subpixel
 * drift. NW resize keeps the SE corner pinned (and vice versa) by
 * adjusting both the position and size of the box together.
 *
 * Module-private state:
 *   - `dragState`: the in-flight gesture (null when idle)
 *   - `suppressNextBoxClick`: set on a drag-with-movement's pointerup;
 *     consumed (and reset) by `consumeBoxClickSuppression()` so a
 *     finished drag doesn't also re-activate the box via the trailing
 *     emulated click. Auto-released after 500 ms as a safety net
 *     (matches v2.6's TTL pattern).
 *
 * Public surface (matches `ui/note-box.NoteBoxHooks` contract — wired
 * by main.ts at boot):
 *   - `attachHandleListeners(handle, corner, noteId)`
 *   - `attachBodyDragListener(bodyEl, noteId)`
 *   - `consumeBoxClickSuppression()`
 *
 * Pinch-zoom-aware resize floor: the box's on-screen device-px
 * footprint stays ≥ MIN_BOX_SIZE_DISPLAY device px while the IMAGE-
 * space floor shrinks with pinch zoom — letting users mark
 * progressively smaller image features by pinching in. The image-
 * space safety floor is MIN_BOX_SIZE_IMG.
 */

import {
  DRAG_THRESHOLD_PX,
  MIN_BOX_SIZE_DISPLAY,
  MIN_BOX_SIZE_IMG,
} from '../config';
import {NoteId, NoteState} from '../types';
import {getImageDisplayRect} from '../utils/coords';
import {getImageElement} from '../utils/dom';
import {getOriginalHeight, getOriginalWidth} from '../state/image-state';
import {
  getActiveNoteId,
  getMode,
  notes,
  pushAction,
  setActiveNote,
} from '../state/notes-store';
import {HandleCorner, renderNoteBox} from '../ui/note-box';
import {setPopoverInteracting, updatePopoverPosition} from '../ui/popover';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface DragState {
  kind: 'drag' | 'resize-nw' | 'resize-se';
  noteId: NoteId;
  pointerId: number;
  startScreenX: number;
  startScreenY: number;
  startState: NoteState;
  captureTarget: HTMLElement;
  moved: boolean;
}

let dragState: DragState | null = null;

/**
 * Set on a drag-with-movement's pointerup; consumed (and reset) by
 * `consumeBoxClickSuppression` so a finished drag doesn't also
 * re-activate the box via the trailing emulated click.
 */
let suppressNextBoxClick = false;

// ---------------------------------------------------------------------------
// NoteBoxHooks impl
// ---------------------------------------------------------------------------

/**
 * Wires a corner handle's pointerdown. Idempotent caller pattern —
 * the handle DOM is created once and this is called once per handle.
 */
export function attachHandleListeners(
  handle: HTMLElement,
  corner: HandleCorner,
  noteId: NoteId,
): void {
  handle.addEventListener('pointerdown', e => {
    if (getMode() !== 'active') {
      return;
    }
    // Soft-deleted notes are view-only until the user undoes the
    // delete via the popover ↶. Block drag/resize so the box can't
    // drift while the popover is in undo-only mode.
    const note = notes.get(noteId);
    if (note && note.isDeleted) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    // Activate this note if it isn't already, so the handle is even
    // visible (CSS only shows handles on `.is-active`). Also any
    // popover swap happens before the gesture begins.
    if (getActiveNoteId() !== noteId) {
      setActiveNote(noteId);
    }
    const isResize = corner === 'nw' || corner === 'se';
    const kind: DragState['kind'] = isResize
      ? (`resize-${corner}` as 'resize-nw' | 'resize-se')
      : 'drag';
    startInteraction(noteId, kind, e, handle);
  });
}

/**
 * Wires the box body's pointerdown for body-drag (move). Stops at
 * the body — handles have their own pointerdown that stopPropagation
 * before reaching here.
 */
export function attachBodyDragListener(
  bodyEl: HTMLElement,
  noteId: NoteId,
): void {
  bodyEl.addEventListener('pointerdown', e => {
    if (getMode() !== 'active') {
      return;
    }
    const note = notes.get(noteId);
    // Soft-deleted notes: still selectable (so the user can reach the
    // popover ↶) but not draggable. Activate without starting a drag
    // so a tap on a red-dashed box opens the undo-only popover.
    if (note && note.isDeleted) {
      if (getActiveNoteId() !== noteId) {
        setActiveNote(noteId);
      }
      return;
    }
    // Activate-on-touch so a single tap-and-drag works on inactive
    // boxes without requiring two gestures.
    if (getActiveNoteId() !== noteId) {
      setActiveNote(noteId);
    }
    e.preventDefault();
    startInteraction(noteId, 'drag', e, bodyEl);
  });
}

/**
 * Returns true if the next box click should be suppressed (the
 * trailing click after a drag-with-movement). Consumes + resets the
 * flag in one call. Wired into `ui/note-box.NoteBoxHooks` so the box
 * click handler can short-circuit cleanly without exposing the flag.
 */
export function consumeBoxClickSuppression(): boolean {
  if (suppressNextBoxClick) {
    suppressNextBoxClick = false;
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Interaction lifecycle (private)
// ---------------------------------------------------------------------------

/**
 * Common entrypoint for both handle and body interactions. Captures
 * the pointer to the target so subsequent move/up events go there
 * regardless of where the pointer travels.
 */
function startInteraction(
  noteId: NoteId,
  kind: DragState['kind'],
  e: PointerEvent,
  captureTarget: HTMLElement,
): void {
  const note = notes.get(noteId);
  if (!note) {
    return;
  }

  dragState = {
    kind,
    noteId,
    pointerId: e.pointerId,
    startScreenX: e.clientX,
    startScreenY: e.clientY,
    startState: {...note.current},
    captureTarget,
    moved: false,
  };

  try {
    captureTarget.setPointerCapture(e.pointerId);
  } catch (_err) {
    // Some browsers throw if the pointer is no longer active; fall
    // back to plain doc-level listeners. Rare in practice.
  }
  captureTarget.addEventListener('pointermove', onInteractionMove);
  captureTarget.addEventListener('pointerup', onInteractionEnd);
  captureTarget.addEventListener('pointercancel', onInteractionEnd);

  // NB: popover opacity is NOT dimmed here. Dimming is deferred to
  // onInteractionMove (first frame past DRAG_THRESHOLD_PX) so a
  // no-movement tap doesn't trigger a 100→25→100% flash that the
  // user perceives as the popover "appearing twice."
}

/**
 * Pointermove handler: recomputes the note's current geometry from
 * the start state + cumulative pointer delta. Clamps to image bounds
 * and respects MIN_BOX_SIZE_IMG / MIN_BOX_SIZE_DISPLAY (device-px).
 */
function onInteractionMove(e: PointerEvent): void {
  if (!dragState || e.pointerId !== dragState.pointerId) {
    return;
  }
  const note = notes.get(dragState.noteId);
  if (!note) {
    return;
  }

  const dx = e.clientX - dragState.startScreenX;
  const dy = e.clientY - dragState.startScreenY;
  if (!dragState.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
    dragState.moved = true;
    // First frame of actual movement — dim the popover so the user
    // can see the box clearly while dragging. (No-movement taps
    // don't reach this branch, so the popover stays at 100% and the
    // box-select tap doesn't visually flicker.)
    setPopoverInteracting(true);
    // Hide the SE corner triangle for the same reason — the resize
    // affordance is irrelevant once the gesture is in progress and
    // would otherwise sit on top of the art the user is repositioning
    // the box against.
    if (note.domElement) {
      note.domElement.classList.add('is-interacting');
    }
  }

  // Convert display-space delta to image-space.
  const img = getImageElement();
  if (!img) {
    return;
  }
  const rect = getImageDisplayRect(img);
  const originalWidth = getOriginalWidth();
  const originalHeight = getOriginalHeight();
  if (!rect || !originalWidth) {
    return;
  }
  const scale = rect.width / originalWidth;
  const dxImg = dx / scale;
  const dyImg = dy / scale;
  // Resize floor: max of the absolute image-space minimum and the
  // device-px display floor projected to image space.
  // MIN_BOX_SIZE_DISPLAY is in DEVICE px (on-screen, constant across
  // pinch zoom); dividing by vvScale gives the CSS px floor at the
  // current pinch level (CSS px = device px / vv.scale), then
  // dividing by `scale` (display CSS px per image px) gives image
  // px. Net effect: the box's on-screen footprint stays ≥
  // MIN_BOX_SIZE_DISPLAY device px while the IMAGE-space floor
  // shrinks with pinch zoom — letting users mark progressively
  // smaller image features by pinching in.
  // MIN_BOX_SIZE_IMG is the absolute image-space safety floor.
  const vv = window.visualViewport;
  const vvScale = vv ? vv.scale : 1;
  const minImg = Math.max(
    MIN_BOX_SIZE_IMG,
    MIN_BOX_SIZE_DISPLAY / vvScale / scale,
  );

  const start = dragState.startState;
  let nx = start.x;
  let ny = start.y;
  let nw = start.w;
  let nh = start.h;

  if (dragState.kind === 'drag') {
    nx = start.x + dxImg;
    ny = start.y + dyImg;
  } else if (dragState.kind === 'resize-se') {
    nw = Math.max(minImg, start.w + dxImg);
    nh = Math.max(minImg, start.h + dyImg);
  } else if (dragState.kind === 'resize-nw') {
    // NW pivots around the SE corner: the SE-corner image-coord
    // (start.x + start.w, start.y + start.h) stays fixed.
    const seX = start.x + start.w;
    const seY = start.y + start.h;
    let candX = start.x + dxImg;
    let candY = start.y + dyImg;
    if (seX - candX < minImg) {
      candX = seX - minImg;
    }
    if (seY - candY < minImg) {
      candY = seY - minImg;
    }
    nx = candX;
    ny = candY;
    nw = seX - candX;
    nh = seY - candY;
  }

  // Clamp position so the box stays inside the original image.
  nx = Math.max(0, Math.min(originalWidth - nw, nx));
  ny = Math.max(0, Math.min(originalHeight - nh, ny));

  note.current = {x: nx, y: ny, w: nw, h: nh, text: note.current.text};
  renderNoteBox(dragState.noteId);
  updatePopoverPosition();
}

/**
 * Pointerup/cancel handler: releases the pointer capture, restores
 * popover opacity, and sets `suppressNextBoxClick` if the gesture
 * actually moved (so the trailing emulated click on the box doesn't
 * re-run any selection logic on top of the just-completed drag).
 */
function onInteractionEnd(e: PointerEvent): void {
  if (!dragState || e.pointerId !== dragState.pointerId) {
    return;
  }
  const target = dragState.captureTarget;
  try {
    target.releasePointerCapture(e.pointerId);
  } catch (_err) {
    // Already released or never captured — non-fatal.
  }
  target.removeEventListener('pointermove', onInteractionMove);
  target.removeEventListener('pointerup', onInteractionEnd);
  target.removeEventListener('pointercancel', onInteractionEnd);

  if (dragState.moved) {
    // Record the gesture as a 'transform' entry so the popover ↶ can
    // roll the box back to its pre-gesture geometry. Captured at
    // gesture end (rather than on the first frame past the threshold)
    // so a single push covers the whole drag — chained ↶ presses
    // then step back through individual gestures, not individual
    // frames.
    pushAction(dragState.noteId, 'transform', {...dragState.startState});

    // Only reset opacity if we actually dimmed (matches the
    // movement-gated dim in onInteractionMove). Pure-tap gestures
    // never touch popover opacity.
    setPopoverInteracting(false);
    // Restore the SE corner triangle (set in onInteractionMove's
    // first-movement branch).
    const note = notes.get(dragState.noteId);
    if (note && note.domElement) {
      note.domElement.classList.remove('is-interacting');
    }
    suppressNextBoxClick = true;
    // Auto-release after the click event window so a swallowed click
    // can't permanently sink the next legitimate tap (matches the
    // v2.6 suppressNextClick TTL pattern).
    setTimeout(() => {
      suppressNextBoxClick = false;
    }, 500);
  }

  dragState = null;
}
