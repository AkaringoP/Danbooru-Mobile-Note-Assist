/**
 * Danbooru native conflict detection — observes the DOM for signals
 * that the site's own note UI is active, so our overlay can step
 * aside instead of fighting two parallel editors over the same image.
 *
 * Layer 2 (state). Two signals are OR-combined into `isNativeActive`:
 *
 *   1. `body.mode-translation` — Danbooru's "translation mode" toggle
 *      (N hotkey via the `#translate` link, or the in-notice "Turn
 *      translation mode off" anchor). Set/unset in notes.js's
 *      `Note.TranslationMode.start` / `.stop`.
 *
 *   2. The "Editing note #xxx" / "Creating new note" edit dialog,
 *      detected via two cooperating hooks in notes.js's `Note.Edit`:
 *        - `.note-box.editing` — added in the dialog's `open`
 *          callback, removed in `close`. Most explicit and the
 *          primary signal here.
 *        - `.ui-dialog.note-edit-dialog` — the jQuery UI dialog
 *          wrapper (via `classes: {"ui-dialog": "note-edit-dialog"}`).
 *          Kept as a fallback in case `.note-box.editing` is ever
 *          decoupled, but visibility-checked (`display !== 'none'`)
 *          because jQuery UI `dialog("close")` hides without removing
 *          the wrapper from the DOM.
 *
 * Init runs an initial synchronous detect, then a single
 * `MutationObserver` on `document.body` watches both attribute (class)
 * and childList/subtree changes. `recompute` is cheap (one classList
 * check, up to two querySelectors) so a broad-subtree observer is
 * acceptable; subscribers only fire on actual state transitions.
 *
 * Cross-layer fanout (floating-button auto-hide, keyboard gate,
 * active-mode entry block) is wired in `main.ts` via
 * `onNativeStateChanged`, keeping this module dependency-free per Z5
 * (no upward imports into ui/interactions).
 */

const NATIVE_TRANSLATION_CLASS = 'mode-translation';
const NATIVE_EDITING_BOX_SELECTOR = '.note-box.editing';
const NATIVE_EDIT_DIALOG_SELECTOR = '.ui-dialog.note-edit-dialog';

let isNativeActive = false;
let observer: MutationObserver | null = null;
const subscribers = new Set<(active: boolean) => void>();

function detectEditDialog(): boolean {
  if (document.querySelector(NATIVE_EDITING_BOX_SELECTOR) !== null) {
    return true;
  }
  const dialog = document.querySelector(NATIVE_EDIT_DIALOG_SELECTOR);
  return dialog instanceof HTMLElement && dialog.style.display !== 'none';
}

function detect(): boolean {
  return (
    document.body.classList.contains(NATIVE_TRANSLATION_CLASS) ||
    detectEditDialog()
  );
}

function recompute(): void {
  const next = detect();
  if (next === isNativeActive) {
    return;
  }
  isNativeActive = next;
  for (const cb of subscribers) {
    cb(next);
  }
}

/** `true` while Danbooru's native translation mode or note edit dialog is active. */
export function getIsNativeActive(): boolean {
  return isNativeActive;
}

/**
 * Subscribe to native-active state transitions. The callback fires
 * only on actual edge changes (false→true / true→false), not on
 * every DOM mutation. Returns an unsubscribe function.
 */
export function onNativeStateChanged(
  callback: (active: boolean) => void,
): () => void {
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
  };
}

/**
 * Installs the body-level MutationObserver and records the initial
 * state. Idempotent — a second call is a no-op so accidental
 * re-init at boot can't double-observe.
 */
export function initNativeConflictWatch(): void {
  if (observer !== null) {
    return;
  }
  isNativeActive = detect();
  observer = new MutationObserver(recompute);
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ['class'],
    childList: true,
    subtree: true,
  });
}
