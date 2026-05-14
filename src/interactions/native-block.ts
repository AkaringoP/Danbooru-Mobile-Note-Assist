/**
 * Capture-phase blockers for Danbooru's native translation-mode entry
 * points, so a session in our active mode can't accidentally spawn the
 * native editor and stack two overlays on the same image (PLAN D2,
 * Phase 1, v4.2).
 *
 * Layer 4 (interactions). Two entry points are blocked while our
 * overlay is in active mode:
 *
 *   1. Bare `n` keydown. The `#translate` sidebar link is registered
 *      as a `data-shortcut="n"` element in shortcuts.js's
 *      initialize_data_shortcuts — a bubble-phase document keydown
 *      listener. Our capture-phase preventDefault + stopPropagation
 *      swallows the event before that handler runs. Input-focus is
 *      guarded so typing "n" into our popover textarea still works.
 *
 *   2. Click on the `#translate` link itself (the sidebar "Add notes"
 *      label). notes.js's `Note.initialize_all` registers a delegated
 *      `$(document).on("click.danbooru", "#translate", ...)` handler
 *      — same bubble phase, same capture-phase block. `closest()`
 *      catches clicks on any descendant text inside the link.
 *
 * Active-mode-only: when our overlay is idle, native is the user's
 * legitimate path and this module stays out of the way. The reverse
 * direction (native already active, our active-mode entry attempted)
 * is handled in `state/notes-store.setMode`.
 */

import {isTextInputElement} from '../utils/dom';
import {getMode} from '../state/notes-store';
import {showToast} from '../ui/toast';

let bound = false;

// Cooldown for the block-toast — matches the `info` preset duration so
// a fast follow-up trigger (double-tap on #translate, repeated `n`
// keypress, or any mix) doesn't stack overlapping flashes. Shared
// across click + keydown handlers because they're the same logical
// "you can't trigger native while we're active" event from the user's
// perspective.
const BLOCK_TOAST_COOLDOWN_MS = 2500;
const BLOCK_TOAST_MESSAGE = 'Edit mode is on — turn it off first';
let lastBlockToastAt = 0;

function maybeShowBlockToast(): void {
  const now = Date.now();
  if (now - lastBlockToastAt > BLOCK_TOAST_COOLDOWN_MS) {
    lastBlockToastAt = now;
    showToast(BLOCK_TOAST_MESSAGE, 'info');
  }
}

/**
 * Installs the two document capture-phase listeners. Idempotent — a
 * second call is a no-op. Caller is `main.ts#init`, alongside
 * `bindGlobalHotkeys`.
 */
export function bindNativeBlockers(): void {
  if (bound) {
    return;
  }
  document.addEventListener('keydown', handleKeydown, true);
  document.addEventListener('click', handleClick, true);
  bound = true;
}

function handleKeydown(e: KeyboardEvent): void {
  if (getMode() !== 'active') {
    return;
  }
  if (
    e.code === 'KeyN' &&
    !e.shiftKey &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey &&
    !isTextInputElement(e.target as Element)
  ) {
    e.preventDefault();
    e.stopPropagation();
    maybeShowBlockToast();
  }
}

function handleClick(e: MouseEvent): void {
  if (getMode() !== 'active') {
    return;
  }
  const target = e.target as Element | null;
  if (target && typeof target.closest === 'function') {
    if (target.closest('#translate')) {
      e.preventDefault();
      e.stopPropagation();
      maybeShowBlockToast();
    }
  }
}
