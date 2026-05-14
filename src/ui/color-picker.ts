/**
 * Color picker modal — inline modal mounted as a child of the note
 * popover that collects a CSS color for the style sub-popover's
 * Text / Background color controls. Mirrors the link-popover pattern
 * (DOM child of `#dmna-popover` so it inherits transform / scale; dim
 * overlay covers the note popover area only).
 *
 * Layer 3 (ui). A single instance is reused by both Text and BG
 * controls via the `target` parameter on `showColorPicker`; the
 * caller's `onConfirm` callback receives the chosen color and applies
 * it through `applySpanStyle('color', …)` or
 * `applySpanStyle('background-color', …)`.
 *
 * Behavior:
 *   - 14 Material Design-toned swatches (D14) in a 7×2 grid; tap to
 *     immediately confirm
 *   - HEX input field beneath the grid for arbitrary colors —
 *     6-digit `#RRGGBB` only (3-digit shorthand deferred per D14 / Q5)
 *   - Bare `RRGGBB` (no `#` prefix) is auto-prefixed on apply
 *   - Apply (✔) button next to the input confirms the HEX. Disabled +
 *     the input outlined red when the format is invalid.
 *   - Outside tap on the dim overlay cancels
 *   - On confirm or cancel the textarea is re-focused so the mobile
 *     keyboard stays up across the color → textarea transition
 *
 * Mobile keyboard mitigation: same gesture-chain discipline as
 * link-popover — `hexInput.focus()` runs synchronously inside the
 * triggering click handler so iOS Safari keeps the keyboard up.
 */

import {getPopoverInputElement} from './popover';

const SWATCHES: ReadonlyArray<string> = [
  '#000000',
  '#FFFFFF',
  '#E53935',
  '#EC407A',
  '#AB47BC',
  '#5C6BC0',
  '#1E88E5',
  '#00ACC1',
  '#43A047',
  '#9CCC65',
  '#FDD835',
  '#FB8C00',
  '#8D6E63',
  '#757575',
];

const HEX_RE = /^#?[0-9a-fA-F]{6}$/;

let modalElement: HTMLElement | null = null;
let overlayElement: HTMLElement | null = null;
let hexInput: HTMLInputElement | null = null;
let applyButton: HTMLButtonElement | null = null;
let onConfirmCallback: ((color: string) => void) | null = null;
let isShown = false;

function normalizeHex(input: string): string | null {
  const trimmed = input.trim();
  if (!HEX_RE.test(trimmed)) return null;
  return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
}

function refreshApplyState(): void {
  if (!applyButton || !hexInput) return;
  const valid = normalizeHex(hexInput.value) !== null;
  applyButton.disabled = !valid;
  // Only flag visually-invalid when the user has typed something —
  // an empty field is a neutral state, not an error.
  hexInput.classList.toggle('is-invalid', !valid && hexInput.value !== '');
}

function hideColorPicker(): void {
  if (!modalElement || !overlayElement) return;
  modalElement.classList.remove('show');
  overlayElement.classList.remove('show');
  isShown = false;
  onConfirmCallback = null;
}

function commitColor(color: string): void {
  const callback = onConfirmCallback;
  hideColorPicker();
  if (callback) {
    callback(color);
  } else {
    const ta = getPopoverInputElement();
    if (ta) ta.focus();
  }
}

function handleCancel(): void {
  hideColorPicker();
  const ta = getPopoverInputElement();
  if (ta) ta.focus();
}

function handleHexApply(): void {
  if (!hexInput) return;
  const color = normalizeHex(hexInput.value);
  if (!color) return;
  commitColor(color);
}

export function createColorPicker(): void {
  if (modalElement && overlayElement) return;
  const host = document.getElementById('dmna-popover');
  if (!host) return;

  const overlay = document.createElement('div');
  overlay.id = 'dmna-color-overlay';
  overlay.addEventListener('mousedown', e => e.preventDefault());
  overlay.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    handleCancel();
  });

  const modal = document.createElement('div');
  modal.id = 'dmna-color-modal';

  const grid = document.createElement('div');
  grid.id = 'dmna-color-swatches';
  for (const hex of SWATCHES) {
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'dmna-color-swatch';
    sw.style.background = hex;
    sw.dataset.color = hex;
    sw.setAttribute('aria-label', `Pick ${hex}`);
    sw.addEventListener('mousedown', e => e.preventDefault());
    sw.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      commitColor(hex);
    });
    grid.appendChild(sw);
  }
  modal.appendChild(grid);

  const inputRow = document.createElement('div');
  inputRow.id = 'dmna-color-input-row';
  const input = document.createElement('input');
  input.type = 'text';
  input.id = 'dmna-color-hex';
  input.placeholder = '#RRGGBB';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.maxLength = 7;
  input.addEventListener('input', refreshApplyState);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleHexApply();
    }
  });
  inputRow.appendChild(input);

  const apply = document.createElement('button');
  apply.type = 'button';
  apply.id = 'dmna-color-apply';
  apply.textContent = '✔';
  apply.setAttribute('aria-label', 'Apply HEX color');
  apply.disabled = true;
  apply.addEventListener('mousedown', e => e.preventDefault());
  apply.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    handleHexApply();
  });
  inputRow.appendChild(apply);

  modal.appendChild(inputRow);
  host.appendChild(overlay);
  host.appendChild(modal);

  overlayElement = overlay;
  modalElement = modal;
  hexInput = input;
  applyButton = apply;
}

/**
 * Open the picker. `target` is informational only — the caller's
 * onConfirm already knows whether the chosen color is for text or
 * background — but we set it as a data attribute on the modal so CSS
 * can theme the picker differently per target in a future cycle.
 *
 * The synchronous `hexInput.focus()` at the end is the iOS Safari
 * gesture-chain requirement: focus must land while the click handler
 * is still on the stack or the on-screen keyboard won't surface.
 */
export function showColorPicker(
  target: 'text' | 'bg',
  onConfirm: (color: string) => void,
): void {
  createColorPicker();
  if (!modalElement || !overlayElement || !hexInput || !applyButton) return;
  modalElement.dataset.target = target;
  hexInput.value = '';
  hexInput.classList.remove('is-invalid');
  applyButton.disabled = true;
  onConfirmCallback = onConfirm;
  overlayElement.classList.add('show');
  modalElement.classList.add('show');
  isShown = true;
  hexInput.focus();
}

export function isColorPickerShown(): boolean {
  return isShown;
}
