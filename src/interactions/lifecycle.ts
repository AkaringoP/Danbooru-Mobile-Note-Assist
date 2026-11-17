/**
 * Page-lifecycle draft persistence (Layer 4 — interactions).
 *
 * Saves the in-progress collection as a draft whenever the page may be
 * going away, and honors an explicit "Leave" answer on the reload /
 * close prompt as a discard (v4.1 force-quit recovery, v4.1.1 discard
 * semantics).
 *
 * Event order differs by browser. Chromium fires
 * `beforeunload → pagehide → visibilitychange(hidden) → unload`, so a
 * discard decided in `pagehide` must also silence the trailing
 * `visibilitychange` — otherwise the draft is written straight back
 * and the next entry shows a Restore prompt for work the user threw
 * away (v5.1).
 *
 * Latches:
 *   - `promptedDiscardOnLeave`: set when our `beforeunload` prompt
 *     fires. Cleared by the next pointerdown / keydown (the user
 *     answered "Stay" and is still here) or a bfcache return.
 *   - `discardedOnLeave`: set when `pagehide` consumes the prompt latch.
 *     Cleared only by a bfcache return (`pageshow` with `persisted`).
 */

import {getIsDraftSaveBlocked, getIsSending} from '../confirm/batch';
import {hasPendingChanges} from '../confirm/classify';
import {clearDraft, saveDraft} from '../state/draft';
import {
  getMode,
  hasContentToSave,
  serializeForDraft,
} from '../state/notes-store';

let bound = false;
let promptedDiscardOnLeave = false;
let discardedOnLeave = false;

/**
 * Writes the draft unless a send is running, the Confirm pipeline has
 * handed authority to the server (`getIsDraftSaveBlocked`), or there
 * is nothing worth keeping. An open Confirm popover alone does not
 * block: nothing has been sent yet.
 */
function saveDraftIfNeeded(): void {
  if (getIsSending() || getIsDraftSaveBlocked()) {
    return;
  }
  if (!hasContentToSave()) {
    return;
  }
  saveDraft(serializeForDraft());
}

function disarmPrompt(): void {
  promptedDiscardOnLeave = false;
}

/**
 * Shows the browser's generic "Leave site?" prompt when there are
 * pending changes, and defers the save/discard decision to `pagehide`.
 * Without pending changes nothing is asked, so save right away.
 */
function onBeforeUnload(e: BeforeUnloadEvent): void {
  promptedDiscardOnLeave = false;
  if (getMode() === 'active' && hasPendingChanges()) {
    promptedDiscardOnLeave = true;
    document.addEventListener('pointerdown', disarmPrompt, {
      capture: true,
      once: true,
    });
    document.addEventListener('keydown', disarmPrompt, {
      capture: true,
      once: true,
    });
    e.preventDefault();
    e.returnValue = '';
    return;
  }
  saveDraftIfNeeded();
}

function onPageHide(): void {
  if (promptedDiscardOnLeave) {
    promptedDiscardOnLeave = false;
    discardedOnLeave = true;
    clearDraft();
    return;
  }
  saveDraftIfNeeded();
}

/** The most reliable mobile signal that the OS may suspend or kill us. */
function onVisibilityChange(): void {
  if (document.visibilityState !== 'hidden' || discardedOnLeave) {
    return;
  }
  saveDraftIfNeeded();
}

function onPageShow(e: PageTransitionEvent): void {
  if (e.persisted) {
    promptedDiscardOnLeave = false;
    discardedOnLeave = false;
  }
}

/** Binds the four lifecycle listeners. Idempotent. */
export function bindLifecycleSave(): void {
  if (bound) {
    return;
  }
  window.addEventListener('beforeunload', onBeforeUnload);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);
  document.addEventListener('visibilitychange', onVisibilityChange);
  bound = true;
}
