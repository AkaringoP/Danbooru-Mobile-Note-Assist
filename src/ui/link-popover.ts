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

import {getPopoverInputElement} from './popover';

let modalElement: HTMLElement | null = null;
let overlayElement: HTMLElement | null = null;
let urlInput: HTMLInputElement | null = null;
let onConfirmCallback: ((url: string) => void) | null = null;
let isShown = false;

const DANBOORU_HOST_RE = /^https?:\/\/danbooru\.donmai\.us/i;

function normalizeUrl(input: string): string {
  return input.trim().replace(DANBOORU_HOST_RE, '');
}

function hideLinkPopover(): void {
  if (!modalElement || !overlayElement) return;
  modalElement.classList.remove('show');
  overlayElement.classList.remove('show');
  isShown = false;
  onConfirmCallback = null;
}

function handleConfirm(): void {
  if (!urlInput) return;
  const url = normalizeUrl(urlInput.value);
  const callback = onConfirmCallback;
  hideLinkPopover();
  if (url && callback) {
    callback(url);
  } else {
    const ta = getPopoverInputElement();
    if (ta) ta.focus();
  }
}

function handleCancel(): void {
  hideLinkPopover();
  const ta = getPopoverInputElement();
  if (ta) ta.focus();
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
  overlay.addEventListener('mousedown', e => e.preventDefault());
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
    if (e.key === 'Enter') {
      e.preventDefault();
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
}

/**
 * Open the modal and hand future Confirm results to `onConfirm`. The
 * `urlInput.focus()` call below MUST run synchronously inside the
 * caller's user-gesture chain (i.e. caller is itself a click handler);
 * otherwise iOS Safari treats the focus as programmatic and refuses
 * to surface the on-screen keyboard.
 */
export function showLinkPopover(onConfirm: (url: string) => void): void {
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
