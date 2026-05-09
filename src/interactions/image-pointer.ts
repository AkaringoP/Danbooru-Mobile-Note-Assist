/**
 * Image-element pointer / click wiring (Layer 4 — interactions).
 *
 * Wires the post `<img id="image">` for:
 *   - Tap-to-create on touch (`handleImageClick`): empty-area tap
 *     spawns a default-sized box centered on the click and activates
 *     it. Tap with a popover already open dismisses instead.
 *   - PC drag-to-create (`onImageDragPointer{Down,Move,Up,Cancel}`):
 *     mouse-only path that bypasses the click chain — pointerdown
 *     preventDefault'd to suppress Danbooru's native mousedown
 *     handler, so the tap-to-create path is simulated in pointerup
 *     instead.
 *   - `bindImageHandlers`: idempotent boot-time bind. Includes a
 *     capture-phase mousedown/touchstart blocker that stops
 *     Danbooru's notes.js from receiving the events while we're in
 *     active mode (Danbooru's listener handles drag-to-create-note +
 *     toggles `.hide-notes` on `.note-container` for short taps —
 *     both fight ours).
 *
 * Owns `spawnDefaultBoxAtClient` (TASK 1.1 inventory had it bundled
 * with createTempNote; Task 1.5b decision moved it here, since it
 * handles clientX/Y display coords + waits on in-flight metadata
 * before delegating to `state/notes-store.createTempNote`).
 *
 * Module-private state:
 *   - `imageHandlersBound`: bind-once guard
 *   - `dragCreate`: in-flight PC drag-to-create state
 *   - `suppressNextImageClick`: set on a moved drag-create's
 *     pointerup; consumed by `handleImageClick` so the trailing
 *     click doesn't also spawn a default-sized box on top of the
 *     dragged one.
 */

import {
  DRAG_THRESHOLD_PX,
  INITIAL_SIZE_RATIO,
  MAX_INITIAL_SIZE,
  MIN_DRAG_CREATE_SIZE_DISPLAY,
  MIN_INITIAL_SIZE,
} from '../config';
import {NoteId} from '../types';
import {
  DisplayRect,
  clamp,
  getImageDisplayRect,
  screenToImageRect,
} from '../utils/coords';
import {getImageElement} from '../utils/dom';
import {
  getOriginalHeight,
  getOriginalWidth,
  getPostMetaPromise,
} from '../state/image-state';
import {
  createTempNote,
  getActiveNoteId,
  getMode,
  setActiveNote,
} from '../state/notes-store';
import {updateAllNoteBoxPositions} from '../ui/note-box';
import {dismissActivePopover, focusActiveNoteInput} from '../ui/popover';
import {showToast} from '../ui/toast';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface DragCreateState {
  startX: number;
  startY: number;
  imageRect: DisplayRect;
  ghostEl: HTMLDivElement | null;
  moved: boolean;
}

let imageHandlersBound = false;
let dragCreate: DragCreateState | null = null;

/**
 * Set when drag-to-create resolves with movement; consumed (and
 * reset) by `handleImageClick` so the trailing click doesn't also
 * spawn a default-sized box on top of the dragged one.
 */
let suppressNextImageClick = false;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Attaches the image click handler. If `<img id="image">` isn't in
 * the DOM yet (Danbooru lazily inserts it on some flows), retries
 * with a 1-second timeout — a v2.6 carry-over pattern. Idempotent.
 *
 * Capture-phase mousedown/touchstart blocker: Danbooru's notes.js
 * binds a bubble-phase mousedown on `#image-container` that handles
 * drag-to-create-note AND toggles `.hide-notes` on `.note-container`
 * for short taps. Both behaviors fight ours — in active mode we own
 * tap-to-create, and the `.hide-notes` toggle persists past our CSS
 * rule, leaving native notes invisible after returning to idle. The
 * capture listener stops propagation before Danbooru sees the event;
 * the dual mousedown+touchstart bind covers both PC and mobile.
 */
export function bindImageHandlers(): void {
  if (imageHandlersBound) {
    return;
  }
  const img = getImageElement();
  if (!img) {
    setTimeout(bindImageHandlers, 1000);
    return;
  }
  img.addEventListener('click', handleImageClick);
  img.addEventListener('load', updateAllNoteBoxPositions);
  // PC drag-to-create: bubble-phase pointerdown — capture-phase
  // `blockNativeIfActive` below already stopped propagation upward
  // so Danbooru's notes.js never sees it; our listener on the same
  // element still fires regardless.
  img.addEventListener('pointerdown', onImageDragPointerDown);

  const blockNativeIfActive = (e: Event): void => {
    if (getMode() !== 'active') {
      return;
    }
    e.stopPropagation();
  };
  img.addEventListener('mousedown', blockNativeIfActive, true);
  img.addEventListener('touchstart', blockNativeIfActive, true);

  imageHandlersBound = true;
}

// ---------------------------------------------------------------------------
// Click / drag handlers (private)
// ---------------------------------------------------------------------------

/**
 * Click handler for the post image. In active mode, an empty-area
 * click spawns a default-sized box centered on the click and
 * activates it. Idle-mode clicks are no-ops (the body class also
 * makes this a dead path visually).
 *
 * Note: PC mouse paths route through `onImageDragPointer*` instead —
 * those preventDefault on pointerdown to suppress Danbooru's native
 * mousedown handler, which also kills the click event chain. So this
 * handler typically only runs for touch taps and as a safety net for
 * spurious clicks (e.g., when activeNoteId guard early-returns from
 * pointerdown without preventDefault, the click then dismisses).
 */
function handleImageClick(e: MouseEvent): void {
  if (getMode() !== 'active') {
    return;
  }
  // Safety net for PC drag-to-create: if a click somehow leaks
  // through despite our pointerdown preventDefault (Safari quirks
  // etc.), the suppress flag set in pointerup consumes it.
  if (suppressNextImageClick) {
    suppressNextImageClick = false;
    return;
  }
  // Popover-open guard: a click on the image while a box is active
  // does NOT spawn a second box — it dismisses the active popover
  // (matching v2.6's "tap empty image cancels" UX). See
  // `dismissActivePopover` for the fresh-new vs ✔'d/server routing.
  // The user has to dismiss first, then tap again to create.
  if (getActiveNoteId() !== null) {
    dismissActivePopover();
    return;
  }
  void spawnDefaultBoxAtClient(e.clientX, e.clientY);
}

/**
 * Spawns a default-sized box centered at the given client coords.
 * Shared by `handleImageClick` (browser click event) and
 * `onImageDragPointerUp` (synthesized tap when pointerdown was
 * preventDefault'd, suppressing the click chain). Resolves to the
 * new note id, or null if the spawn was a no-op (image not visible
 * / dimensions unavailable / cancelled while waiting on metadata).
 *
 * Async because of the C1 race fix: when fired during the
 * `setMode('active') → enterActiveMode` metadata-fetch window, the
 * function awaits `postMetaPromise` rather than dropping the user's
 * tap with an "Image dimensions unknown" toast. Callers fire-and-
 * forget; the return value isn't used in production, only the
 * `__dmna3` debug surface inspects it.
 *
 * The textarea autofocus uses requestAnimationFrame so the popover's
 * `.show` flip + layout settles before `.focus()` runs (pre-flip the
 * popover is `display: none`, which would no-op the focus). The
 * `expectedId` guard inside `focusActiveNoteInput` handles the
 * unlikely case where the user dismissed the popover within the
 * same frame.
 */
async function spawnDefaultBoxAtClient(
  clientX: number,
  clientY: number,
): Promise<NoteId | null> {
  if (!getOriginalWidth() || !getOriginalHeight()) {
    // Race window: setMode('active') flips the mode + body class
    // synchronously, but enterActiveMode's metadata fetch is async.
    // A click in the gap (1–3 s on slow cellular) used to surface
    // "Image dimensions unknown" — instead, wait for the in-flight
    // promise so the user's intent isn't dropped (Phase 6 audit C1).
    const promise = getPostMetaPromise();
    if (promise) {
      try {
        await promise;
      } catch (err) {
        showToast('⚠️ Failed to load image info', 'error', err);
        return null;
      }
      // While we awaited, the user could have left active mode or
      // selected another box. Silently bail in those cases — they're
      // not "errors," they're cancelled intent.
      if (getMode() !== 'active' || getActiveNoteId() !== null) {
        return null;
      }
    }
    if (!getOriginalWidth() || !getOriginalHeight()) {
      showToast('⚠️ Image info unavailable — refresh the page', 'error');
      return null;
    }
  }
  const img = getImageElement();
  const rect = img ? getImageDisplayRect(img) : null;
  if (!rect) {
    showToast('⚠️ Image not on screen', 'warning');
    return null;
  }
  const shortSide = Math.min(rect.width, rect.height);
  const sizeDisplay = Math.max(
    MIN_INITIAL_SIZE,
    Math.min(MAX_INITIAL_SIZE, shortSide * INITIAL_SIZE_RATIO),
  );

  const pageX = clientX + window.pageXOffset;
  const pageY = clientY + window.pageYOffset;
  let leftDisplay = pageX - sizeDisplay / 2;
  let topDisplay = pageY - sizeDisplay / 2;

  const maxLeft = rect.left + rect.width - sizeDisplay;
  const maxTop = rect.top + rect.height - sizeDisplay;
  leftDisplay = Math.max(rect.left, Math.min(maxLeft, leftDisplay));
  topDisplay = Math.max(rect.top, Math.min(maxTop, topDisplay));

  const imgState = screenToImageRect(
    {
      left: leftDisplay,
      top: topDisplay,
      width: sizeDisplay,
      height: sizeDisplay,
    },
    rect,
    getOriginalWidth(),
  );
  if (!imgState) {
    showToast('⚠️ Image not on screen', 'warning');
    return null;
  }
  const id = createTempNote({
    x: imgState.x,
    y: imgState.y,
    w: imgState.w,
    h: imgState.h,
    text: '',
  });
  setActiveNote(id);
  requestAnimationFrame(() => focusActiveNoteInput(id));
  return id;
}

/**
 * Drag rect in page coords (clamped to the snapshotted image rect),
 * or null if `dragCreate` isn't active.
 */
function computeDragRect(curX: number, curY: number): DisplayRect | null {
  if (!dragCreate) {
    return null;
  }
  const r = dragCreate.imageRect;
  const x1 = clamp(dragCreate.startX, r.left, r.left + r.width);
  const y1 = clamp(dragCreate.startY, r.top, r.top + r.height);
  const x2 = clamp(curX, r.left, r.left + r.width);
  const y2 = clamp(curY, r.top, r.top + r.height);
  return {
    left: Math.min(x1, x2),
    top: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

/**
 * pointerdown on the image (PC mouse only). Snapshots the start
 * coord + current image display rect, then attaches doc-level
 * move/up/cancel listeners. Touch path falls through unchanged —
 * mobile users keep tap-to-create via the `click` event chain.
 *
 * Critical: `preventDefault()` here suppresses the compatibility
 * mouse events (mousedown/mousemove/mouseup/click) for the rest of
 * the gesture. That kills Danbooru's native mousedown handler on
 * `#image-container` (drag-to-create-note + `.hide-notes` toggle)
 * regardless of which propagation phase it's bound on — the
 * existing capture-phase blocker can be bypassed if Danbooru
 * registers in capture phase too. Suppressing the click chain also
 * means we have to simulate the tap-to-create path ourselves on
 * pointerup.
 *
 * Guards mirror `handleImageClick`: only fires in active mode with
 * no box currently active. With a box active, we early-return
 * WITHOUT preventDefault — the trailing click then reaches
 * `handleImageClick` and runs the dismiss path.
 */
function onImageDragPointerDown(e: PointerEvent): void {
  if (e.pointerType !== 'mouse' || e.button !== 0) {
    return;
  }
  if (getMode() !== 'active' || getActiveNoteId() !== null) {
    return;
  }
  if (!getOriginalWidth() || !getOriginalHeight()) {
    return;
  }
  const img = getImageElement();
  if (!img) {
    return;
  }
  const rect = getImageDisplayRect(img);
  if (!rect) {
    return;
  }
  e.preventDefault();
  dragCreate = {
    startX: e.clientX + window.pageXOffset,
    startY: e.clientY + window.pageYOffset,
    imageRect: rect,
    ghostEl: null,
    moved: false,
  };
  document.addEventListener('pointermove', onImageDragPointerMove);
  document.addEventListener('pointerup', onImageDragPointerUp);
  document.addEventListener('pointercancel', onImageDragPointerCancel);
}

/**
 * pointermove during drag-to-create. Lazily creates the ghost
 * element once movement crosses DRAG_THRESHOLD_PX, then keeps its
 * rect synced with the current pointer position (clamped to the
 * image).
 */
function onImageDragPointerMove(e: PointerEvent): void {
  if (!dragCreate) {
    return;
  }
  const x = e.clientX + window.pageXOffset;
  const y = e.clientY + window.pageYOffset;
  if (!dragCreate.moved) {
    const dist = Math.hypot(x - dragCreate.startX, y - dragCreate.startY);
    if (dist < DRAG_THRESHOLD_PX) {
      return;
    }
    dragCreate.moved = true;
    const ghost = document.createElement('div');
    ghost.id = 'dmna-drag-ghost';
    document.body.appendChild(ghost);
    dragCreate.ghostEl = ghost;
  }
  const rect = computeDragRect(x, y);
  if (rect && dragCreate.ghostEl) {
    dragCreate.ghostEl.style.left = `${rect.left}px`;
    dragCreate.ghostEl.style.top = `${rect.top}px`;
    dragCreate.ghostEl.style.width = `${rect.width}px`;
    dragCreate.ghostEl.style.height = `${rect.height}px`;
  }
}

/**
 * pointerup ending a drag-to-create gesture. Owns BOTH paths
 * because pointerdown's preventDefault killed the click chain:
 *   - Drag (moved past threshold AND rect ≥
 *     MIN_DRAG_CREATE_SIZE_DISPLAY) → create temp note from drag
 *     rect.
 *   - Tap (no movement) or sub-min drag → spawn a default-sized box
 *     at the release point, mirroring `handleImageClick`'s tap path.
 *
 * `suppressNextImageClick` is set as a safety net in case some
 * browser quirk leaks the click through despite preventDefault.
 */
function onImageDragPointerUp(e: PointerEvent): void {
  if (!dragCreate) {
    return;
  }
  const moved = dragCreate.moved;
  let finalRect: DisplayRect | null = null;
  if (moved) {
    const x = e.clientX + window.pageXOffset;
    const y = e.clientY + window.pageYOffset;
    finalRect = computeDragRect(x, y);
  }
  // Snapshot imageRect BEFORE cleanup — finalRect is page-coord
  // already (computeDragRect ran against dragCreate.imageRect), but
  // screenToImageRect needs the same DisplayRect to project back.
  const imageRect = dragCreate.imageRect;
  cleanupDragCreate();
  suppressNextImageClick = true;

  const usableDrag =
    moved &&
    finalRect &&
    finalRect.width >= MIN_DRAG_CREATE_SIZE_DISPLAY &&
    finalRect.height >= MIN_DRAG_CREATE_SIZE_DISPLAY;
  if (usableDrag && finalRect) {
    const imgState = screenToImageRect(
      finalRect,
      imageRect,
      getOriginalWidth(),
    );
    if (!imgState) {
      return;
    }
    const id = createTempNote({
      x: imgState.x,
      y: imgState.y,
      w: imgState.w,
      h: imgState.h,
      text: '',
    });
    setActiveNote(id);
    requestAnimationFrame(() => focusActiveNoteInput(id));
    return;
  }
  // Tap / sub-min drag → default-size box at release point (the
  // click event won't fire because pointerdown was preventDefault'd).
  void spawnDefaultBoxAtClient(e.clientX, e.clientY);
}

/** pointercancel during drag-to-create — drop the in-flight drag. */
function onImageDragPointerCancel(): void {
  cleanupDragCreate();
}

/** Removes ghost element + listeners + state. Idempotent. */
function cleanupDragCreate(): void {
  if (dragCreate && dragCreate.ghostEl) {
    dragCreate.ghostEl.remove();
  }
  dragCreate = null;
  document.removeEventListener('pointermove', onImageDragPointerMove);
  document.removeEventListener('pointerup', onImageDragPointerUp);
  document.removeEventListener('pointercancel', onImageDragPointerCancel);
}
