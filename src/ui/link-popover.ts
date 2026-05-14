/**
 * Link sub-popover — inline modal layered above the note popover that
 * collects a URL for an `<a href="…">` wrap around the textarea's
 * current selection. Triggered from the style sub-popover's `<a>`
 * button when the selection is not already wrapped in `<a>`.
 *
 * Layer 3 (ui). Mounted as a child of `#dmna-popover` so it inherits
 * the popover's transform/scale automatically; the dim overlay covers
 * the note popover area only, not the full viewport.
 *
 * Behavior:
 *   - Open: focus the URL input synchronously inside the triggering
 *     click handler so iOS Safari keeps the on-screen keyboard up
 *     across the textarea → URL input transition.
 *   - Confirm: normalize the URL (trim + strip the internal
 *     `https://danbooru.donmai.us` prefix so internal posts become
 *     relative paths) and hand it back via the onConfirm callback;
 *     the caller restores the textarea selection and wraps the
 *     selected text.
 *   - Cancel (outside tap / empty URL Confirm): hide without firing
 *     the callback; the textarea is re-focused so the keyboard stays
 *     up and the captured selection remains usable.
 *
 * Danbooru sanitizer note: NoteSanitizer accepts only `href` on `<a>`
 * (target / rel are stripped) and the server auto-injects
 * `rel="external noreferrer nofollow"` on save, so this module only
 * needs to deal with the href value.
 */

import {hideColorPicker} from './color-picker';
import {getPopoverInputElement} from './popover';
import {hideRubyPopover} from './ruby-popover';
import {hideStrokePicker} from './stroke-picker';

let modalElement: HTMLElement | null = null;
let overlayElement: HTMLElement | null = null;
let urlInput: HTMLInputElement | null = null;
let onConfirmCallback: ((url: string) => void) | null = null;
let isShown = false;
// Paired with onOutsideClick — see color-picker.ts for the rationale.
let suppressNextClick = false;

const DANBOORU_HOST_RE = /^https?:\/\/danbooru\.donmai\.us/i;
const DANGEROUS_SCHEME_RE = /^\s*(javascript|data|vbscript|file):/i;

/**
 * Trim → strip Danbooru host prefix → defense-in-depth scheme + HTML-
 * char filter. The client-side filter is intentionally redundant with
 * Danbooru's NoteSanitizer (which is the authoritative backstop), but
 * keeps a malformed or scripted URL from entering the request payload
 * in the first place (Phase 5-h Task 5.24). Returns the empty string
 * for rejected schemes so `handleConfirm` falls through its no-url
 * branch (modal closes, no `<a>` wrap inserted).
 */
function normalizeUrl(input: string): string {
  const trimmed = input.trim().replace(DANBOORU_HOST_RE, '');
  if (DANGEROUS_SCHEME_RE.test(trimmed)) {
    return '';
  }
  return trimmed.replace(/[<>"]/g, '');
}

export function hideLinkPopover(): void {
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
  if (!urlInput) return;
  const url = normalizeUrl(urlInput.value);
  const callback = onConfirmCallback;
  hideLinkPopover();
  if (url && callback) {
    callback(url);
  } else {
    restoreTextareaSelection();
  }
}

function handleCancel(): void {
  hideLinkPopover();
  restoreTextareaSelection();
}

/**
 * Document-level pointerdown handler — closes the link popover when
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
  if (target.closest('.dmna-style-btn-link')) {
    return;
  }
  hideLinkPopover();
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

export function createLinkPopover(): void {
  if (modalElement && overlayElement) {
    return;
  }
  const host = document.getElementById('dmna-popover');
  if (!host) {
    return;
  }

  const overlay = document.createElement('div');
  overlay.id = 'dmna-link-overlay';
  overlay.addEventListener('mousedown', e => {
    // Stop bubbling past #dmna-popover so an outside-tap listener
    // higher up doesn't read the overlay tap as a tap outside the
    // note popover and close it.
    e.preventDefault();
    e.stopPropagation();
  });
  overlay.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    handleCancel();
  });

  const modal = document.createElement('div');
  modal.id = 'dmna-link-modal';

  const input = document.createElement('input');
  input.type = 'url';
  input.id = 'dmna-link-modal-input';
  input.placeholder = 'Paste link URL';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.addEventListener('keydown', e => {
    // e.isComposing: see ruby-popover.ts for the IME-leak rationale.
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      e.stopPropagation();
      handleConfirm();
    }
  });
  modal.appendChild(input);

  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.id = 'dmna-link-modal-confirm';
  confirmBtn.textContent = '✔';
  confirmBtn.setAttribute('aria-label', 'Confirm link');
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
  urlInput = input;

  document.addEventListener('pointerdown', onOutsideTap, true);
  document.addEventListener('click', onOutsideClick, true);
}

/**
 * Open the modal and hand future Confirm results to `onConfirm`. The
 * `urlInput.focus()` call below MUST run synchronously inside the
 * caller's user-gesture chain (i.e. caller is itself a click handler);
 * otherwise iOS Safari treats the focus as programmatic and refuses
 * to surface the on-screen keyboard.
 */
export function showLinkPopover(onConfirm: (url: string) => void): void {
  hideColorPicker();
  hideStrokePicker();
  hideRubyPopover();
  createLinkPopover();
  if (!modalElement || !overlayElement || !urlInput) return;
  urlInput.value = '';
  onConfirmCallback = onConfirm;
  overlayElement.classList.add('show');
  modalElement.classList.add('show');
  isShown = true;
  urlInput.focus();
}

export function isLinkPopoverShown(): boolean {
  return isShown;
}
