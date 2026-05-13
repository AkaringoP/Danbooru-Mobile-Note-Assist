/**
 * Document-level keyboard shortcuts (Layer 4 — interactions).
 *
 * - **Esc**         — dismiss the active popover (matches outside-tap;
 *                     `dismissActivePopover` hard-deletes fresh-new
 *                     notes, reverts the rest). Fires regardless of
 *                     whether the popover textarea has focus, so the
 *                     user can dismiss after their focus drifted to
 *                     body / another element via tab/click. Skipped if
 *                     focus is in some unrelated text input on the
 *                     page (e.g., Danbooru's tag search) so we don't
 *                     hijack the native Esc behavior for that input.
 * - **Shift+N**     — toggle active/idle (mirrors menu Edit). Disabled
 *                     while a popover is open or any text input has
 *                     focus, so it can't fire while the user is
 *                     typing. `e.code === 'KeyN'` keeps the binding
 *                     stable across keyboard layouts and Caps Lock;
 *                     the modifier guard avoids hijacking browser
 *                     shortcuts (Ctrl/Cmd/Alt + Shift+N).
 * - **Shift+Enter** — fire arc-menu Confirm (`runConfirmFlow`, the
 *                     batch send) when in active mode. Same gate as
 *                     Shift+N: no popover, no text-input focus.
 *                     Critically NOT consumed inside the textarea —
 *                     Shift+Enter is the standard "insert newline"
 *                     affordance there (translation lines often span
 *                     multiple lines), so the input-focus guard
 *                     preserves it.
 *
 * Sending lock (D11): `getIsSending()` short-circuits everything,
 * preventing keyboard mutation while a Confirm batch is in flight.
 *
 * Modal ownership: when the tag popover (D9) or error modal (D12) is
 * open, those modals' own capture-phase handlers fire first. This
 * handler stays out by checking the body classes those modals set.
 *
 * Native conflict (Phase 1, v4.2, D2): when Danbooru's native
 * translation mode or edit dialog is active, the Shift+N branch
 * preventDefaults the key but routes to a toast instead of
 * `toggleEditMode` — silent suppression would look like a broken
 * hotkey to a user who can't see the (hidden) floating button. The
 * complementary direction (native trigger fired while we're already
 * active) lives in `interactions/native-block`, which swallows both
 * the bare-N keydown and the `#translate` click.
 */

import {isTextInputElement} from '../utils/dom';
import {getIsSending, runConfirmFlow} from '../confirm/batch';
import {getIsNativeActive} from '../state/native-conflict';
import {getActiveNoteId, getMode, toggleEditMode} from '../state/notes-store';
import {dismissActivePopover, isPopoverInput} from '../ui/popover';
import {showToast} from '../ui/toast';

let hotkeysBound = false;

/**
 * Binds the document-level keydown listener (idempotent). Called by
 * `main.ts#init` once at boot.
 */
export function bindGlobalHotkeys(): void {
  if (hotkeysBound) {
    return;
  }
  document.addEventListener('keydown', handleGlobalHotkeys);
  hotkeysBound = true;
}

function handleGlobalHotkeys(e: KeyboardEvent): void {
  // Lock keyboard shortcuts while a Confirm batch is in flight (D11).
  if (getIsSending()) {
    return;
  }
  // Tag popover (D9) and error modal (D12) own Esc / Ctrl-Enter
  // while they're open — their handlers fire first, this one stays
  // out.
  if (
    document.body.classList.contains('dmna-tag-popover-open') ||
    document.body.classList.contains('dmna-error-modal-open')
  ) {
    return;
  }
  if (e.key === 'Escape' && getActiveNoteId() !== null) {
    const ae = document.activeElement;
    if (isTextInputElement(ae) && !isPopoverInput(ae)) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    dismissActivePopover();
    return;
  }
  if (
    e.shiftKey &&
    e.code === 'KeyN' &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey &&
    getActiveNoteId() === null &&
    !isTextInputElement(document.activeElement)
  ) {
    e.preventDefault();
    if (getIsNativeActive()) {
      // Silent suppression would look like a broken hotkey — surface
      // the same reason `setMode` would have given (the floating
      // button is hidden, so the user can't see the icon swap either).
      showToast("Danbooru's native note UI is active — close it first", 'info');
    } else {
      toggleEditMode();
    }
    return;
  }
  if (
    e.shiftKey &&
    e.key === 'Enter' &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey &&
    getMode() === 'active' &&
    getActiveNoteId() === null &&
    !isTextInputElement(document.activeElement)
  ) {
    e.preventDefault();
    void runConfirmFlow();
  }
}
