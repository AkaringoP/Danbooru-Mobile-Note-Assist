/**
 * Toast singleton — bottom-of-viewport status flashes.
 *
 * Layer 3 (ui). Module-private state owns:
 *   - the lazily-created `<div id="dmna-toast">` element + its
 *     `.dmna-toast-msg` / `.dmna-toast-actions` sub-elements
 *   - the auto-dismiss `setTimeout` handle
 *   - the per-type duration / className presets (`TOAST_PRESETS`)
 *
 * Public surface:
 *   - `showToast(msg, type, err?)` — display + auto-hide
 *   - `showToastWithActions(msg, actions)` — display with two-button
 *     prompt and no auto-dismiss (v4.1, restore-draft prompt). Click
 *     on a button invokes its callback and dismisses the toast.
 *   - `updateToastPosition()` — re-pin to bottom-center using the
 *     current visualViewport (called inside show*, and by the
 *     viewport-update orchestrator in main.ts)
 *
 * Position update was originally part of v3.1.1's monolithic
 * `updateVisualViewportPositions`; Task 1.4 split that into per-ui-
 * module helpers so utils/visual-viewport stays pure (Z5).
 */

import {SCRIPT_NAME, TOAST_MARGIN_BOTTOM} from '../config';
import {ToastLevel} from '../types';

export type {ToastLevel};

/**
 * One button in a `showToastWithActions` prompt. `primary` adds the
 * `.is-primary` class for a recommended-choice visual emphasis;
 * leave it unset / false for the secondary option. Callback runs
 * after the toast is dismissed so DOM cleanup doesn't race with
 * downstream state changes (e.g. a Restore handler that opens the
 * popover).
 */
export interface ToastAction {
  label: string;
  onClick: () => void;
  primary?: boolean;
}

/**
 * Per-type presets. `error` lingers longer so actionable messages
 * have time to be read; `success` is brief (the user already knows
 * their action succeeded — the toast just confirms). `info` stays at
 * the v2.6 baseline for consistency.
 */
const TOAST_PRESETS: Record<ToastLevel, {className: string; duration: number}> =
  {
    info: {className: '', duration: 2500},
    success: {className: 'dmna-toast-success', duration: 1800},
    warning: {className: 'dmna-toast-warning', duration: 3000},
    error: {className: 'dmna-toast-error', duration: 4500},
  };

let toastElement: HTMLElement | null = null;
let toastMsgElement: HTMLElement | null = null;
let toastActionsElement: HTMLElement | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Lazily builds the toast container + its two sub-elements. The
 * `.dmna-toast-msg` div carries the text; `.dmna-toast-actions` is
 * the (optionally populated) button row that `showToastWithActions`
 * fills. CSS hides the actions row by default (`display: none`) and
 * the `.has-actions` modifier on `#dmna-toast` reveals it.
 */
function ensureToastDOM(): void {
  if (toastElement) {
    return;
  }
  toastElement = document.createElement('div');
  toastElement.id = 'dmna-toast';
  toastMsgElement = document.createElement('div');
  toastMsgElement.className = 'dmna-toast-msg';
  toastActionsElement = document.createElement('div');
  toastActionsElement.className = 'dmna-toast-actions';
  toastElement.appendChild(toastMsgElement);
  toastElement.appendChild(toastActionsElement);
  document.body.appendChild(toastElement);
}

/**
 * Displays a toast message. A new call cancels the previous timer and
 * replaces the text + class — no queueing.
 *
 * Error/warning toasts also log to the browser console (with the
 * optional `err` object passed to preserve the stack trace) so the
 * actionable diagnostic isn't lost when the user misses the on-screen
 * flash.
 */
export function showToast(
  msg: string,
  type: ToastLevel = 'info',
  err?: unknown,
): void {
  const preset = TOAST_PRESETS[type] || TOAST_PRESETS.info;
  ensureToastDOM();
  updateToastPosition();
  toastMsgElement!.textContent = msg;
  // Clear any previously-rendered action buttons from a prior
  // showToastWithActions call (their listeners go with the nodes).
  toastActionsElement!.textContent = '';
  // Restart the fade-in transition. Without this reset, calling
  // showToast while a previous toast is still on screen would just
  // replace the text with no visual change — the user can't tell a
  // new event fired. Clearing the class first + forcing a reflow
  // makes the next class assignment re-trigger the opacity / visibility
  // transitions, so every showToast call produces a visible "flash."
  toastElement!.className = '';
  void toastElement!.offsetWidth;
  toastElement!.className = `show ${preset.className}`.trim();
  if (toastTimer) {
    clearTimeout(toastTimer);
  }
  toastTimer = setTimeout(() => {
    if (toastElement) {
      toastElement.className = '';
    }
  }, preset.duration);

  if (type === 'error' || type === 'warning') {
    const logFn = type === 'error' ? console.error : console.warn;
    const tag = `[${SCRIPT_NAME}]`;
    if (err !== undefined) {
      logFn(tag, msg, err);
    } else {
      logFn(tag, msg);
    }
  }
}

/**
 * Displays a toast with one or more action buttons (typically two —
 * primary + secondary). Auto-dismiss is disabled; the toast stays
 * up until the user chooses, at which point the matching callback
 * runs and the toast hides.
 *
 * Use case (v4.1): the force-quit restore prompt — "Saved draft
 * found. Restore?" with [Restore] / [Discard] buttons. The error
 * modal handles confirm-time send failures via its own dedicated
 * DOM (confirm/batch.ts); toast-with-actions is the lighter
 * affordance for boot-time prompts.
 *
 * Empty `actions` array would orphan the toast (no path to dismiss);
 * caller is expected to pass at least one action.
 */
export function showToastWithActions(
  msg: string,
  actions: ToastAction[],
): void {
  ensureToastDOM();
  updateToastPosition();
  toastMsgElement!.textContent = msg;
  toastActionsElement!.textContent = '';
  for (const action of actions) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `dmna-toast-btn${action.primary ? ' is-primary' : ''}`;
    btn.textContent = action.label;
    btn.addEventListener('click', () => {
      hideToast();
      action.onClick();
    });
    toastActionsElement!.appendChild(btn);
  }
  toastElement!.className = '';
  void toastElement!.offsetWidth;
  toastElement!.className = 'show has-actions';
  // No auto-dismiss — wait for a button press. Cancel any timer
  // left over from a prior `showToast` call.
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
}

/**
 * Hides the toast and clears any pending auto-dismiss timer.
 * Module-internal — `showToastWithActions` button callbacks invoke
 * it before running the action callback.
 */
function hideToast(): void {
  if (toastElement) {
    toastElement.className = '';
  }
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
}

/**
 * Re-pins the toast to bottom-center of the current visualViewport
 * (or innerWindow when the API is unavailable). Counter-scaled by
 * `1 / visualViewport.scale` so the on-screen footprint stays
 * constant under pinch zoom — same trick the floating button uses.
 */
export function updateToastPosition(): void {
  if (!toastElement) {
    return;
  }
  const vv = window.visualViewport;
  if (!vv) {
    const scrollX = window.pageXOffset;
    const scrollY = window.pageYOffset;
    toastElement.style.transform =
      `translate(${scrollX + window.innerWidth / 2}px, ` +
      `${scrollY + window.innerHeight - TOAST_MARGIN_BOTTOM}px) ` +
      'translate(-50%, 0)';
    return;
  }
  const invScale = 1 / vv.scale;
  const tx = vv.pageLeft + vv.width / 2;
  const ty = vv.pageTop + vv.height - TOAST_MARGIN_BOTTOM * invScale;
  toastElement.style.transform =
    `translate(${tx}px, ${ty}px) scale(${invScale}) ` +
    'translate(-50%, -100%)';
}
