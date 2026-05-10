/**
 * Toast singleton — bottom-of-viewport status flashes.
 *
 * Layer 3 (ui). Module-private state owns:
 *   - the lazily-created `<div id="dmna-toast">` element
 *   - the auto-dismiss `setTimeout` handle
 *   - the per-type duration / className presets (`TOAST_PRESETS`)
 *
 * Public surface:
 *   - `showToast(msg, type, err?)` — display + auto-hide
 *   - `updateToastPosition()` — re-pin to bottom-center using the
 *     current visualViewport (called inside showToast, and by the
 *     viewport-update orchestrator in main.ts)
 *
 * Position update was originally part of v3.1.1's monolithic
 * `updateVisualViewportPositions`; Task 1.4 split that into per-ui-
 * module helpers so utils/visual-viewport stays pure (Z5).
 */

import {SCRIPT_NAME, TOAST_MARGIN_BOTTOM} from '../config';

/**
 * Severity for the toast — drives both the accent color (CSS
 * `.dmna-toast-{type}` class) and the auto-dismiss duration.
 */
export type ToastType = 'info' | 'success' | 'warning' | 'error';

/**
 * Per-type presets. `error` lingers longer so actionable messages
 * have time to be read; `success` is brief (the user already knows
 * their action succeeded — the toast just confirms). `info` stays at
 * the v2.6 baseline for consistency.
 */
const TOAST_PRESETS: Record<ToastType, {className: string; duration: number}> =
  {
    info: {className: '', duration: 2500},
    success: {className: 'dmna-toast-success', duration: 1800},
    warning: {className: 'dmna-toast-warning', duration: 3000},
    error: {className: 'dmna-toast-error', duration: 4500},
  };

let toastElement: HTMLElement | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

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
  type: ToastType = 'info',
  err?: unknown,
): void {
  const preset = TOAST_PRESETS[type] || TOAST_PRESETS.info;
  if (!toastElement) {
    toastElement = document.createElement('div');
    toastElement.id = 'dmna-toast';
    document.body.appendChild(toastElement);
  }
  updateToastPosition();
  toastElement.textContent = msg;
  // Restart the fade-in transition. Without this reset, calling
  // showToast while a previous toast is still on screen would just
  // replace the text with no visual change — the user can't tell a
  // new event fired. Clearing the class first + forcing a reflow
  // makes the next class assignment re-trigger the opacity / visibility
  // transitions, so every showToast call produces a visible "flash."
  toastElement.className = '';
  void toastElement.offsetWidth;
  toastElement.className = `show ${preset.className}`.trim();
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
