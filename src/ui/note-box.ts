/**
 * Note box rendering (Layer 3 — ui).
 *
 * Owns the per-note DOM lifecycle:
 *   - `renderNoteBox`         — lazily build + position + apply visual classes
 *   - `updateNoteVisuals`     — refresh the 4-color priority classes
 *   - `updateAllNote{Box,Visual}{Positions,s}` — batch updates on viewport
 *     change / mass state mutation
 *   - `removeNoteBoxDOM`      — DOM cleanup (the Map deletion is the
 *     caller's responsibility, e.g., `state/notes-store.hardDeleteNote`)
 *   - `updateActiveHandleScales` — counter-scale the active note's
 *     corner handles against `visualViewport.scale` so each handle's
 *     visual footprint stays a constant ~32 device-px across pinch
 *     zoom levels (v3.1 small-feature-marking workflow).
 *
 * 4-color priority (highest → lowest, applied as CSS classes):
 *   1. `is-active`  — currently focused note (popover open). Solid blue.
 *   2. `is-deleted` — soft-deleted (`isDeleted: true`). Red dashed.
 *   3. `is-dirty`   — `current` differs from `initialState`. Green solid.
 *   4. (default)    — clean, unfocused, server-original. Yellow solid.
 *   `updateNoteVisuals` toggles all three classes; CSS resolves the
 *   priority via specificity (active beats deleted beats dirty).
 *
 * Z5: ui/note-box can't import interactions/drag-resize directly
 * (interactions sits above ui in the layer graph). The two
 * listener-attach calls and the post-drag click-suppression read
 * route through `NoteBoxHooks` injected by main.ts.
 */

import {NoteId} from '../types';
import {
  DisplayRect,
  getImageDisplayRect,
  imageToScreenRect,
} from '../utils/coords';
import {getImageElement} from '../utils/dom';
import {getInvScale} from '../utils/visual-viewport';
import {getOriginalWidth} from '../state/image-state';
import {
  getActiveNoteId,
  getMode,
  isDirty,
  notes,
  setActiveNote,
} from '../state/notes-store';

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** Corner identifier for the 4 handles. NW/SE resize, NE/SW move-only. */
export type HandleCorner = 'nw' | 'ne' | 'sw' | 'se';

/**
 * Cross-layer wires injected by main.ts. ui/note-box can't import
 * interactions/drag-resize (Z5: interactions → ui, never the
 * reverse), so the listener-attach functions and the box-click
 * suppression read are surfaced via these hooks.
 */
export interface NoteBoxHooks {
  /**
   * Attaches the body-drag listener to a freshly-rendered box.
   * Subscriber: interactions/drag-resize.attachBodyDragListener.
   */
  attachBodyDrag: (el: HTMLElement, noteId: NoteId) => void;

  /**
   * Attaches a corner-handle listener (resize for NW/SE, move-only
   * for NE/SW). Subscriber:
   * interactions/drag-resize.attachHandleListeners.
   */
  attachHandle: (el: HTMLElement, corner: HandleCorner, noteId: NoteId) => void;

  /**
   * Returns true if the next box click should be suppressed (the
   * trailing click after a drag-with-movement). Subscriber consumes
   * + resets the flag in one call (interactions/drag-resize owns the
   * underlying `suppressNextBoxClick` state).
   */
  consumeBoxClickSuppression: () => boolean;
}

let hooks: NoteBoxHooks | null = null;

/** Wire hooks at boot; main.ts calls this once. */
export function initNoteBox(h: NoteBoxHooks): void {
  hooks = h;
}

// ---------------------------------------------------------------------------
// Per-note rendering
// ---------------------------------------------------------------------------

/**
 * Creates the DOM box for a note if missing, then projects its
 * image-space `current` rect to display space and writes the box's
 * left/top/width/height. If the image isn't laid out yet (rect 0×0
 * or `<img>` not in the DOM), the box is hidden until a later
 * re-render — this happens on first server-note load before the
 * `<img>` finishes loading.
 *
 * `cachedRect`:
 *   - `undefined` (default): resolve fresh from `getImageElement` +
 *     `getImageDisplayRect`. Single-note paths use this.
 *   - `DisplayRect`: pre-resolved by a batch caller
 *     (`updateAllNoteBoxPositions`) so N notes don't trigger N
 *     `getBoundingClientRect()` reads — Phase 6 layout-thrash audit P2.
 *   - `null`: explicitly "image not on screen" — hide the box.
 */
export function renderNoteBox(
  noteId: NoteId,
  cachedRect?: DisplayRect | null,
): void {
  const note = notes.get(noteId);
  if (!note) {
    return;
  }

  let el = note.domElement;
  if (!el) {
    el = createNoteBoxDOM(noteId);
    note.domElement = el;
  }

  // Resolve display rect
  let rect: DisplayRect | null;
  if (cachedRect === undefined) {
    const img = getImageElement();
    rect = img ? getImageDisplayRect(img) : null;
  } else {
    rect = cachedRect;
  }

  if (rect) {
    const screen = imageToScreenRect(note.current, rect, getOriginalWidth());
    if (screen) {
      el.style.display = '';
      el.style.left = `${screen.left}px`;
      el.style.top = `${screen.top}px`;
      el.style.width = `${screen.width}px`;
      el.style.height = `${screen.height}px`;
      // SE corner triangle (::after) tracks 1/6 of the box's smaller
      // display dimension, capped at 8 CSS px (matches v3.0 / v3.1.1
      // baseline). Pinch zoom is intentionally NOT in this expression
      // — the triangle scales with the box's CSS-px size, and the
      // visual viewport magnifies both the box and triangle by the
      // same factor, so the on-screen ratio is constant across zoom
      // levels. The cap kicks in at box ≥ 48 CSS px (=
      // MIN_BOX_SIZE_DISPLAY at vv=1); below that the proportional
      // shrink applies for sub-MIN states that can occur transiently
      // at high pinch zoom.
      const triSize = Math.min(Math.min(screen.width, screen.height) / 6, 8);
      el.style.setProperty('--dmna-triangle-size', `${triSize}px`);
    } else {
      el.style.display = 'none';
    }
  } else {
    // Image rect not yet known — hide until the next re-render
    // (window resize, image load, or explicit
    // updateAllNoteBoxPositions).
    el.style.display = 'none';
  }

  updateNoteVisuals(noteId);
}

/**
 * Re-projects every box's image-space rect to display space. Call
 * after anything that could change the rendered image rect: window
 * resize, image load, orientation change, pinch zoom.
 *
 * Reads the image rect once and passes it to each `renderNoteBox` —
 * without this batch path, N notes meant N `getBoundingClientRect()`
 * reads on the image interleaved with N style writes, which forces
 * N forced reflows under orientation change at large note counts
 * (Phase 6 audit P2).
 */
export function updateAllNoteBoxPositions(): void {
  const img = getImageElement();
  const rect = img ? getImageDisplayRect(img) : null;
  for (const id of notes.keys()) {
    renderNoteBox(id, rect);
  }
}

/**
 * Removes the DOM box for a note. Does NOT touch the `notes` Map —
 * that is the caller's responsibility for the hard-delete vs.
 * soft-delete distinction (state/notes-store.hardDeleteNote handles
 * the Map deletion).
 */
export function removeNoteBoxDOM(noteId: NoteId): void {
  const note = notes.get(noteId);
  if (note && note.domElement) {
    note.domElement.remove();
    note.domElement = null;
  }
}

// ---------------------------------------------------------------------------
// Visual-class toggles (4-color priority)
// ---------------------------------------------------------------------------

/**
 * Recomputes and applies the visual state classes for a single note.
 * Call after any state change (active swap, dirty toggle,
 * soft-delete) that doesn't change geometry — geometry changes go
 * through `renderNoteBox` which calls this internally.
 */
export function updateNoteVisuals(noteId: NoteId): void {
  const note = notes.get(noteId);
  if (!note || !note.domElement) {
    return;
  }
  const el = note.domElement;
  el.classList.toggle('is-active', getActiveNoteId() === noteId);
  el.classList.toggle('is-deleted', note.isDeleted);
  el.classList.toggle('is-dirty', isDirty(note));
}

/**
 * Recomputes visuals for every note in the collection. Useful after
 * batch state changes (e.g., session reset). Currently no in-tree
 * caller — kept for the debug surface and parity with v3.1.1.
 */
export function updateAllNoteVisuals(): void {
  for (const id of notes.keys()) {
    updateNoteVisuals(id);
  }
}

// ---------------------------------------------------------------------------
// Counter-scale for pinch zoom (active note's corner handles)
// ---------------------------------------------------------------------------

/**
 * Counter-scales the active note's 4 corner handles against
 * `visualViewport.scale` so each handle's visual footprint stays a
 * constant ~32 device-px across pinch-zoom levels. Each handle's
 * transform-origin (set in CSS) is the point on its bounding box
 * that coincides with the box's actual corner, so `scale(invScale)`
 * collapses the handle TOWARD the box corner — at high pinch zoom
 * the CSS bounding box (and pointer-event hit region) shrinks
 * proportionally, letting small boxes (down to MIN_BOX_SIZE_DISPLAY)
 * remain interactable without handle collision.
 *
 * Implementation: writes a single `--dmna-handle-scale` CSS custom
 * property on the active note element (the parent of all 4 handles).
 * Each handle reads the variable via
 * `transform: scale(var(--dmna-handle-scale, 1))`. One property
 * write per frame instead of four inline-transform writes.
 *
 * The SE corner triangle (::after) is NOT counter-scaled here as of
 * v3.1.4 — its size tracks box display dimensions instead, set
 * separately by `renderNoteBox` via `--dmna-triangle-size`.
 *
 * Scoped to activeNoteId because CSS gates `.dmna-handle` to
 * `display: none` off `.is-active` — non-active boxes don't need
 * transform writes.
 *
 * Called from main.ts's viewport-update orchestrator (RAF-batched on
 * vv resize/scroll) and from `ui/popover.showPopover` (so handles
 * are pre-scaled before reveal — same flicker-avoidance pattern as
 * the popover itself).
 */
export function updateActiveHandleScales(): void {
  const activeId = getActiveNoteId();
  if (activeId === null) {
    return;
  }
  const note = notes.get(activeId);
  if (!note || !note.domElement) {
    return;
  }
  note.domElement.style.setProperty(
    '--dmna-handle-scale',
    String(getInvScale()),
  );
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * One-shot DOM build for a note box: container div + 4 corner
 * handles, with click + drag listeners wired via NoteBoxHooks (Z5
 * inversion of v3.1.1's direct interactions/drag-resize calls).
 *
 * Idempotency is the caller's responsibility — `renderNoteBox`
 * checks `note.domElement` before invoking this.
 */
function createNoteBoxDOM(noteId: NoteId): HTMLElement {
  const el = document.createElement('div');
  el.className = 'dmna-note-box';
  el.dataset.noteId = noteId;
  el.addEventListener('click', e => {
    // In active mode the box owns its own click (selection swap) and
    // must consume it so the underlying image's create-handler
    // doesn't also fire. Outside active mode boxes shouldn't even
    // exist (`discardAll` runs on the idle transition), but the
    // guard is cheap and protects the debug surface.
    if (getMode() !== 'active') {
      return;
    }
    e.stopPropagation();
    // The trailing click after a drag-with-movement would re-trigger
    // setActiveNote(idempotent) and isn't itself harmful, but we
    // also want to make sure the click can't reach any other handler
    // (defensive; no real damage today, but ahead of Wave 4 off-paths
    // we want the boundary clean).
    if (hooks!.consumeBoxClickSuppression()) {
      return;
    }
    setActiveNote(noteId);
  });

  // Body-drag listener on the box itself (handles stop propagation
  // before reaching here for resize/move-only corners).
  hooks!.attachBodyDrag(el, noteId);

  // Add 4 corner handles. NW/SE = resize, NE/SW = move-only.
  // The `data-icon` attribute is consumed by the debug-zone overlay
  // (`body.dmna-show-debug-zones .dmna-handle::before`) — invisible
  // unless the popover's 👁 button is held.
  const handleIcons: Record<HandleCorner, string> = {
    nw: '↖',
    ne: '✥',
    sw: '✥',
    se: '↘',
  };
  (['nw', 'ne', 'sw', 'se'] as const).forEach(corner => {
    const h = document.createElement('div');
    h.className = `dmna-handle dmna-handle-${corner}`;
    h.dataset.corner = corner;
    h.dataset.icon = handleIcons[corner];
    hooks!.attachHandle(h, corner, noteId);
    el.appendChild(h);
  });

  document.body.appendChild(el);
  return el;
}
