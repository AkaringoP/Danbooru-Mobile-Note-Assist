/**
 * Ruby sub-popover — inline modal layered above the note popover that
 * collects a reading (furigana / pronunciation gloss) for a
 * `<ruby>{base}<rt>{reading}</rt></ruby>` wrap around the textarea's
 * current selection. Triggered from the style sub-popover's `ruby`
 * button when the selection is not already wrapped in `<ruby>`.
 *
 * Layer 3 (ui). Mirrors the link-popover pattern (DOM child of
 * `#dmna-popover` so it inherits the popover's transform/scale; dim
 * overlay covers the note popover area only). Same outside-tap close +
 * keyboard-mitigation focus rules apply.
 *
 * Active-state contract: callers set the post-Confirm textarea
 * selection to `{base}<rt>{reading}</rt>` (the entire content of the
 * `<ruby>` element). That keeps the outer `<ruby>` immediately around
 * the live selection, so `detectOuterLayers` recognizes it and the
 * ruby button lights up `is-active`. It also lets the user pile other
 * style tags (B/I/U, color span, …) on top via the same applyWrap /
 * applySpanStyle paths used for any other selection.
 */

import {hideColorPicker} from './color-picker';
import {hideLinkPopover} from './link-popover';
import {getPopoverInputElement} from './popover';
import {hideStrokePicker} from './stroke-picker';

let modalElement: HTMLElement | null = null;
let overlayElement: HTMLElement | null = null;
let readingInput: HTMLInputElement | null = null;
let onConfirmCallback: ((reading: string) => void) | null = null;
let isShown = false;
// Paired with onOutsideClick — see color-picker.ts for the rationale.
let suppressNextClick = false;

export function hideRubyPopover(): void {
  if (!modalElement || !overlayElement) return;
  modalElement.classList.remove('show');
  overlayElement.classList.remove('show');
  isShown = false;
  onConfirmCallback = null;
}

function restoreTextareaSelection(): void {
  const ta = getPopoverInputElement();
  if (!ta) return;
  ta.focus();
  ta.setSelectionRange(ta.selectionStart, ta.selectionEnd);
}

function handleConfirm(): void {
  if (!readingInput) return;
  const reading = readingInput.value.trim();
  const callback = onConfirmCallback;
  hideRubyPopover();
  if (reading && callback) {
    callback(reading);
  } else {
    restoreTextareaSelection();
  }
}

function handleCancel(): void {
  hideRubyPopover();
  restoreTextareaSelection();
}

/**
 * Document-level pointerdown handler — closes the ruby popover when
 * the tap lands outside its modal. Taps that fall outside both the
 * note popover and the style popover have their propagation
 * suppressed so the page-level "dismiss active note" path can't
 * piggy-back on the same tap and close the note popover too.
 */
function onOutsideTap(e: PointerEvent): void {
  if (!isShown || !modalElement) return;
  const target = e.target as Element | null;
  if (!target) return;
  if (modalElement.contains(target)) return;
  // Tap on the ruby button itself — defer to the button's click
  // handler so its same-button toggle path (close vs. re-open) wins.
  if (target.closest('.dmna-style-btn-ruby')) {
    return;
  }
  hideRubyPopover();
  restoreTextareaSelection();
  const notePop = document.getElementById('dmna-popover');
  const stylePop = document.getElementById('dmna-style-popover');
  const inNote = !!notePop?.contains(target);
  const inStyle = !!stylePop?.contains(target);
  if (!inNote && !inStyle) {
    e.preventDefault();
    e.stopPropagation();
    suppressNextClick = true;
    // TTL safety net — see color-picker.ts onOutsideTap for details
    // (Phase 5-h Task 5.27).
    window.setTimeout(() => {
      suppressNextClick = false;
    }, 500);
  }
}

function onOutsideClick(e: MouseEvent): void {
  if (!suppressNextClick) return;
  suppressNextClick = false;
  e.preventDefault();
  e.stopPropagation();
}

export function createRubyPopover(): void {
  if (modalElement && overlayElement) {
    return;
  }
  const host = document.getElementById('dmna-popover');
  if (!host) {
    return;
  }

  const overlay = document.createElement('div');
  overlay.id = 'dmna-ruby-overlay';
  overlay.addEventListener('mousedown', e => {
    e.preventDefault();
    e.stopPropagation();
  });
  overlay.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    handleCancel();
  });

  const modal = document.createElement('div');
  modal.id = 'dmna-ruby-modal';

  const input = document.createElement('input');
  input.type = 'text';
  input.id = 'dmna-ruby-modal-input';
  input.placeholder = 'Reading (furigana)';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.addEventListener('keydown', e => {
    // `e.isComposing` guards IME composition: when a Korean / Japanese
    // / Chinese IME is mid-composition, the first Enter is the user
    // asking the IME to commit the candidate — not asking us to
    // submit. Firing handleConfirm here would close the modal while
    // the IME still has an uncommitted composition; the IME then
    // commits onto the now-focused textarea and the trailing Enter
    // adds a newline there, corrupting the wrap output.
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      e.stopPropagation();
      handleConfirm();
    }
  });
  modal.appendChild(input);

  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.id = 'dmna-ruby-modal-confirm';
  confirmBtn.textContent = '✔';
  confirmBtn.setAttribute('aria-label', 'Confirm reading');
  confirmBtn.addEventListener('mousedown', e => e.preventDefault());
  confirmBtn.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    handleConfirm();
  });
  modal.appendChild(confirmBtn);

  host.appendChild(overlay);
  host.appendChild(modal);

  overlayElement = overlay;
  modalElement = modal;
  readingInput = input;

  document.addEventListener('pointerdown', onOutsideTap, true);
  document.addEventListener('click', onOutsideClick, true);
}

/**
 * Open the modal and hand future Confirm results to `onConfirm`. The
 * `readingInput.focus()` call below MUST run synchronously inside the
 * caller's user-gesture chain (i.e. caller is itself a click handler);
 * otherwise iOS Safari treats the focus as programmatic and refuses
 * to surface the on-screen keyboard.
 */
export function showRubyPopover(onConfirm: (reading: string) => void): void {
  hideColorPicker();
  hideLinkPopover();
  hideStrokePicker();
  createRubyPopover();
  if (!modalElement || !overlayElement || !readingInput) return;
  readingInput.value = '';
  onConfirmCallback = onConfirm;
  overlayElement.classList.add('show');
  modalElement.classList.add('show');
  isShown = true;
  readingInput.focus();
}

export function isRubyPopoverShown(): boolean {
  return isShown;
}
