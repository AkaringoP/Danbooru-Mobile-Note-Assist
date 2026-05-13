/**
 * Per-note popover (v3.0 Phase 3 Wave 3) — textarea + ✔/✖/🗑 + 👁/↶
 * side stack, anchored under the active box.
 *
 * Layer 3 (ui). Module-private state owns:
 *   - the lazily-built popover DOM (`popoverElement`,
 *     `popoverInputElement` — see note on dropped `popoverArrowElement`
 *     below)
 *
 * The popover is a single shared element re-bound to whichever note
 * is currently active. Position is recomputed on:
 *   1. `setActiveNote → showPopover`
 *   2. drag/resize move → `updatePopoverPosition`
 *   3. main.ts viewport-update orchestrator (pinch zoom / scroll /
 *      resize)
 *
 * Public surface:
 *   - `createPopover` — idempotent DOM build, called by main.ts at boot
 *     (or lazily on first showPopover)
 *   - `showPopover(id)` / `hidePopover()` — bind to / release a note
 *   - `updatePopoverForActiveNote` — refresh disabled state from
 *     `note.isDeleted`
 *   - `updatePopoverPosition` — re-pin under the active box
 *   - `refreshActivePopover` — combo of textarea-text sync +
 *     disabled-state refresh + reposition. Called by main.ts when
 *     notes-store fires `onNoteRenderRequested` for the active id
 *     (e.g., after popoverUndo's edit branch).
 *   - `dismissActivePopover` — outside-tap dismiss path (Esc routes
 *     here too via interactions/keyboard)
 */

import {NoteId, isServerNoteId} from '../types';
import {
  POPOVER_OFFSET,
  POPOVER_WIDTH,
  SCRIPT_NAME,
  SCRIPT_VERSION,
} from '../config';
import {getImageDisplayRect, imageToScreenRect} from '../utils/coords';
import {getOriginalWidth} from '../state/image-state';
import {
  getActiveNoteId,
  hardDeleteNote,
  notes,
  popoverCancel,
  popoverConfirm,
  popoverDelete,
  popoverUndo,
  setActiveNote,
} from '../state/notes-store';
import {
  renderNoteBox,
  updateActiveHandleScales,
  updateNoteVisuals,
} from './note-box';

// ---------------------------------------------------------------------------
// Module-private state
// ---------------------------------------------------------------------------

let popoverElement: HTMLElement | null = null;
let popoverInputElement: HTMLTextAreaElement | null = null;
// `popoverArrowElement` from v3.1.1's closure inventory is dropped:
// the arrow div is appended once during createPopover but no caller
// (in or out of this module) reads it after — the static CSS-center
// arrow doesn't need a per-call slide. Phase 1 fidelity loss is
// nominal; Phase 2 won't miss it.

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Builds the popover DOM and wires its input + button events.
 * Idempotent — re-calling is a no-op once the element exists.
 *
 * Called by `showPopover` lazily on first activation, and may also
 * be called by main.ts at boot to front-load the DOM cost.
 */
export function createPopover(): void {
  if (popoverElement) {
    return;
  }
  const root = document.createElement('div');
  root.id = 'dmna-popover';

  const arrow = document.createElement('div');
  arrow.id = 'dmna-popover-arrow';
  root.appendChild(arrow);

  const inputRow = document.createElement('div');
  inputRow.id = 'dmna-popover-input-row';

  const input = document.createElement('textarea');
  input.id = 'dmna-popover-input';
  input.rows = 3;
  input.placeholder = 'Note...';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.addEventListener('input', () => {
    const activeId = getActiveNoteId();
    if (!activeId) {
      return;
    }
    const note = notes.get(activeId);
    if (note) {
      note.current.text = input.value;
      updateNoteVisuals(activeId);
    }
  });
  // Ctrl/Cmd+Enter inside the textarea = ✔. Bare Enter still inserts
  // a newline. Esc is handled at document level
  // (interactions/keyboard) so it works whether or not the textarea
  // has focus.
  input.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handlePopoverAction('confirm');
    }
  });
  inputRow.appendChild(input);

  // Right-side button stack: 👁 (top, hold-to-show debug zones) +
  // ↶ (bottom, per-note undo). Two narrow stacked buttons share the
  // same column width as the old single eye button (44 px).
  const sideStack = document.createElement('div');
  sideStack.id = 'dmna-popover-side-stack';

  // 👁 hold-to-show touch-zone debug button. Press-and-hold mirrors
  // the v2.6 affordance (matches user muscle memory for "where do
  // those invisible corner zones really extend?"). Pointer-capture
  // ensures the up event lands on the button even if the user drags
  // off it during the hold.
  const eyeBtn = document.createElement('button');
  eyeBtn.type = 'button';
  eyeBtn.id = 'dmna-popover-eye';
  eyeBtn.className = 'dmna-popover-side-btn';
  eyeBtn.textContent = '👁';
  eyeBtn.setAttribute('aria-label', 'Show touch zones (press and hold)');
  eyeBtn.addEventListener('pointerdown', e => {
    if (eyeBtn.disabled) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    try {
      eyeBtn.setPointerCapture(e.pointerId);
    } catch (_err) {
      // Non-capturing fallback — debug zones still toggle correctly
      // via the document-level pointerup below.
    }
    document.body.classList.add('dmna-show-debug-zones');
    eyeBtn.classList.add('is-pressed');
  });
  const releaseEye = (e: PointerEvent): void => {
    document.body.classList.remove('dmna-show-debug-zones');
    eyeBtn.classList.remove('is-pressed');
    try {
      eyeBtn.releasePointerCapture(e.pointerId);
    } catch (_err) {
      // Already released.
    }
  };
  eyeBtn.addEventListener('pointerup', releaseEye);
  eyeBtn.addEventListener('pointercancel', releaseEye);
  sideStack.appendChild(eyeBtn);

  // ↶ per-note undo (Wave 3.5). Pops the most recent actionLog entry
  // for the active note and reverses it.
  const undoBtn = document.createElement('button');
  undoBtn.type = 'button';
  undoBtn.id = 'dmna-popover-undo';
  undoBtn.className = 'dmna-popover-side-btn';
  undoBtn.textContent = '↶';
  undoBtn.setAttribute('aria-label', 'Undo last change to this note');
  undoBtn.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    const activeId = getActiveNoteId();
    if (activeId) {
      popoverUndo(activeId);
    }
  });
  sideStack.appendChild(undoBtn);

  inputRow.appendChild(sideStack);
  root.appendChild(inputRow);

  const buttons = document.createElement('div');
  buttons.id = 'dmna-popover-buttons';
  // ✔ / ✖ have dual presentation: text glyph (CSS color applies) or
  // emoji (system color, CSS ignored). On Safari/iOS the default
  // falls back to emoji, which made the buttons look uniformly dark
  // in the user's screenshot. Appending ︎ (Variation Selector-15)
  // forces the text presentation. 🗑 has no text variant so it stays
  // as a system emoji — its CSS color is a visual hint that may be
  // ignored.
  const actions: Array<{
    action: 'confirm' | 'cancel' | 'delete' | 'history';
    icon: string;
    label: string;
  }> = [
    {action: 'confirm', icon: '✔︎', label: 'Confirm'},
    {action: 'cancel', icon: '✖︎', label: 'Cancel'},
    {action: 'delete', icon: '🗑', label: 'Delete'},
    {action: 'history', icon: '📜', label: 'History'},
  ];
  actions.forEach(({action, icon, label}) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dmna-popover-btn';
    b.dataset.action = action;
    b.setAttribute('aria-label', label);
    b.textContent = icon;
    b.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      handlePopoverAction(action);
    });
    buttons.appendChild(b);
  });
  root.appendChild(buttons);

  // Footer credit line — small muted "{NAME} v{VERSION}" at the
  // bottom-right. Out of the typing/action flow but visible enough
  // for "which version is this?" troubleshooting.
  const credit = document.createElement('div');
  credit.className = 'dmna-popover-credit';
  credit.textContent = `${SCRIPT_NAME} v${SCRIPT_VERSION}`;
  root.appendChild(credit);

  document.body.appendChild(root);

  popoverElement = root;
  popoverInputElement = input;
}

/**
 * Shows the popover bound to the given note. Replaces the input
 * value with the note's current text. Idempotent — calling it on
 * the same note re-positions but won't blow away unsaved typing
 * (the input is only overwritten on note swap).
 */
export function showPopover(noteId: NoteId): void {
  createPopover();
  const note = notes.get(noteId);
  if (!note || !popoverElement || !popoverInputElement) {
    return;
  }
  if (popoverInputElement.dataset.boundNoteId !== noteId) {
    popoverInputElement.value = note.current.text || '';
    popoverInputElement.dataset.boundNoteId = noteId;
  }
  updatePopoverForActiveNote();
  // Pre-position BEFORE reveal. If we add `.show` first the popover
  // renders at its previous transform (or at (0, 0) on first show)
  // for one frame before updatePopoverPosition runs, producing a
  // visible flicker / jump to the box anchor. Setting transform
  // while still display:none means the inline style is in place by
  // the time the show class flips display to block.
  updatePopoverPosition();
  updateActiveHandleScales();
  popoverElement.classList.add('show');
  // Hide the floating button while the popover is up so it can't be
  // tapped open and trigger ✓ Confirm prematurely. CSS in STYLES
  // does the actual hide.
  document.body.classList.add('dmna-note-popover-open');
}

/** Hides the popover without destroying it. */
export function hidePopover(): void {
  if (popoverElement) {
    popoverElement.classList.remove('show');
  }
  if (popoverInputElement) {
    delete popoverInputElement.dataset.boundNoteId;
  }
  document.body.classList.remove('dmna-note-popover-open');
}

/**
 * Reflects the active note's `isDeleted` and `isServerNote` state
 * onto the popover's controls.
 *
 * - Soft-deleted note: textarea + ✔ / ✖ / 🗑 / 👁 disabled. ↶ is
 *   highlighted as the only live action. Re-enabled when popoverUndo
 *   restores the note (`isDeleted` flips back to false).
 * - History 📜 (Phase 2, v4.2): disable mirrors `!isServerNote`, not
 *   `isDeleted` — viewing the version history of a server note still
 *   makes sense after deletion (Q to user 2026-05-13), and a temp
 *   note has no server-side history to point at.
 */
export function updatePopoverForActiveNote(): void {
  if (!popoverElement || !popoverInputElement) {
    return;
  }
  const activeId = getActiveNoteId();
  if (!activeId) {
    return;
  }
  const note = notes.get(activeId);
  if (!note) {
    return;
  }
  const isDeleted = !!note.isDeleted;
  popoverInputElement.disabled = isDeleted;
  popoverElement.querySelectorAll('.dmna-popover-btn').forEach(b => {
    const btn = b as HTMLButtonElement;
    btn.disabled =
      btn.dataset.action === 'history' ? !note.isServerNote : isDeleted;
  });
  const eyeBtn = popoverElement.querySelector('#dmna-popover-eye');
  if (eyeBtn instanceof HTMLButtonElement) {
    eyeBtn.disabled = isDeleted;
  }
  const undoBtn = popoverElement.querySelector('#dmna-popover-undo');
  if (undoBtn) {
    undoBtn.classList.toggle('is-highlighted', isDeleted);
  }
}

/**
 * Re-projects the active box's image-space rect to display space and
 * pins the popover under it. Counter-scales the popover so its
 * visual size stays constant under pinch zoom — the same trick the
 * floating button uses, but with anchoring math.
 *
 * No `.show` check: showPopover deliberately calls this BEFORE
 * adding the show class so the transform is in place when the
 * popover first becomes visible (avoiding a flicker from the
 * previous-or-default position). The activeNoteId guard below is
 * the real "should we be running this" check — activeNoteId and
 * popover-shown are kept in sync by setActiveNote.
 */
export function updatePopoverPosition(): void {
  if (!popoverElement) {
    return;
  }
  const activeId = getActiveNoteId();
  if (!activeId) {
    return;
  }
  const note = notes.get(activeId);
  if (!note) {
    return;
  }
  const img = document.getElementById('image') as HTMLImageElement | null;
  if (!img) {
    return;
  }
  const displayRect = getImageDisplayRect(img);
  if (!displayRect) {
    return;
  }
  const boxRectPage = imageToScreenRect(
    note.current,
    displayRect,
    getOriginalWidth(),
  );

  const vv = window.visualViewport;
  const scale = vv ? vv.scale : 1;
  const invScale = 1 / scale;
  const vvPageLeft = vv ? vv.pageLeft : window.pageXOffset;
  const vvPageTop = vv ? vv.pageTop : window.pageYOffset;

  // Box's visual rect in viewport-CSS-pixels.
  const boxVisualLeft = (boxRectPage.left - vvPageLeft) * scale;
  const boxVisualTop = (boxRectPage.top - vvPageTop) * scale;
  const boxVisualWidth = boxRectPage.width * scale;
  const boxVisualHeight = boxRectPage.height * scale;
  const boxCenterVisualX = boxVisualLeft + boxVisualWidth / 2;
  const boxBottomVisualY = boxVisualTop + boxVisualHeight;

  // Popover visual position: centered on the box. NO horizontal
  // clamp — earlier versions clamped the popover to stay within the
  // visual viewport, but at high pinch-zoom the available range
  // collapses (e.g., vvWidth=300, popover=260 → only 30 px of
  // horizontal slack), which pinned the popover to the viewport's
  // left edge and broke the "anchored to box" illusion entirely. We
  // now accept that the popover may overflow at extreme zoom; the
  // user can pinch out or pan to see the rest. Box-anchoring is the
  // higher-priority affordance. The arrow stays at the popover's
  // CSS-center (set statically in createPopover); no per-call slide
  // needed.
  const popVisualLeft = boxCenterVisualX - POPOVER_WIDTH / 2;
  const popVisualTop = boxBottomVisualY + POPOVER_OFFSET;

  // Convert visual coords back to document coords for the transform.
  const tx = vvPageLeft + popVisualLeft / scale;
  const ty = vvPageTop + popVisualTop / scale;
  popoverElement.style.transform = `translate(${tx}px, ${ty}px) scale(${invScale})`;
}

/**
 * Sync the popover to the currently active note's state: replace
 * textarea text from `note.current.text` (when the popover is
 * already bound to this note), refresh the disabled flags, and
 * re-position. Caller is expected to have already verified that the
 * triggering note id matches `getActiveNoteId()`.
 *
 * Wires `notes-store.popoverUndo`'s edit/delete/transform branches
 * to the popover via main.ts's `onNoteRenderRequested` subscriber —
 * the v3.1.1 inline `popoverInputElement.value = …` write lived
 * inside notes-store, which the modular split moves to here so
 * state/ doesn't reach into ui DOM refs.
 */
export function refreshActivePopover(): void {
  if (!popoverElement || !popoverInputElement) {
    return;
  }
  const activeId = getActiveNoteId();
  if (!activeId) {
    return;
  }
  const note = notes.get(activeId);
  if (!note) {
    return;
  }
  if (popoverInputElement.dataset.boundNoteId === activeId) {
    popoverInputElement.value = note.current.text || '';
  }
  updatePopoverForActiveNote();
  updatePopoverPosition();
}

/**
 * Whether `el` is the popover's textarea. Used by
 * `interactions/keyboard.ts` to gate the global Esc handler — text
 * inputs elsewhere on the page should keep their native Esc, but
 * the popover textarea routes Esc to dismiss-active-popover.
 */
export function isPopoverInput(el: Element | null): boolean {
  return el !== null && el === popoverInputElement;
}

/**
 * Toggles the popover's drag-in-progress dim. Called by
 * `interactions/drag-resize` from onInteractionMove's first-movement
 * branch (set to true) and from onInteractionEnd (set to false).
 *
 * Lives here, not interactions, so popoverElement stays
 * module-private to ui/popover.
 */
export function setPopoverInteracting(interacting: boolean): void {
  if (popoverElement) {
    popoverElement.style.opacity = interacting ? '0.25' : '';
  }
}

/**
 * Focuses the popover textarea iff the active-note still matches the
 * caller's expected id. Used by `interactions/image-pointer.
 * spawnDefaultBoxAtClient` to autofocus right after spawn — the
 * `expectedId` guard handles the unlikely case where the user
 * dismissed the popover within the same frame.
 */
export function focusActiveNoteInput(expectedId: NoteId): void {
  if (popoverInputElement && getActiveNoteId() === expectedId) {
    popoverInputElement.focus();
  }
}

/**
 * "Tap outside the popover" dismiss path. Routes to either a hard
 * delete (fresh-new note: cancel creation) or a state revert
 * (✔'d / server note: cancel uncommitted edits, like the ✖ button).
 *
 * "Fresh new" = `!isServerNote && !everConfirmed`. The earlier
 * version inferred this from `confirmedState === initialState`, but
 * that mis-classified the case "user ✔'d an empty box without
 * changes" as fresh-new (since the two states were still equal
 * post-confirm) and hard-deleted the box on the next outside-tap.
 * The explicit `everConfirmed` flag is the source of truth — set by
 * popoverConfirm and untouched elsewhere.
 *
 * Used by `interactions/image-pointer.handleImageClick` (Task 1.13)
 * when an image click lands while a popover is open: instead of
 * spawning a second box, the click dismisses the active popover.
 * The user has to dismiss first, then tap again to create another
 * note — matching v2.6's "tap empty image cancels" UX.
 */
export function dismissActivePopover(): void {
  const activeId = getActiveNoteId();
  if (activeId === null) {
    return;
  }
  const note = notes.get(activeId);
  if (!note) {
    setActiveNote(null);
    return;
  }
  const isFreshNew = !note.isServerNote && !note.everConfirmed;
  if (isFreshNew) {
    hardDeleteNote(activeId);
  } else {
    note.current = {...note.confirmedState};
    renderNoteBox(activeId);
    setActiveNote(null);
  }
}

// ---------------------------------------------------------------------------
// Private dispatchers
// ---------------------------------------------------------------------------

/**
 * Routes the popover's three action buttons (and the textarea's
 * Ctrl/Cmd+Enter shortcut) to their handlers. Internal — only the
 * createPopover wiring invokes it.
 */
function handlePopoverAction(
  action: 'confirm' | 'cancel' | 'delete' | 'history',
): void {
  const activeId = getActiveNoteId();
  if (!activeId) {
    return;
  }
  if (action === 'confirm') {
    popoverConfirm(activeId);
  } else if (action === 'cancel') {
    popoverCancel(activeId);
  } else if (action === 'delete') {
    popoverDelete(activeId);
  } else if (action === 'history') {
    // The button is disabled for temp notes (see
    // `updatePopoverForActiveNote`); the guard here is defensive in
    // case the click somehow lands. ServerNoteId is the same string
    // as the numeric note id Danbooru's URL expects.
    if (isServerNoteId(activeId)) {
      window.open(
        `https://danbooru.donmai.us/note_versions?search[note_id]=${activeId}`,
        '_blank',
      );
    }
  }
}
