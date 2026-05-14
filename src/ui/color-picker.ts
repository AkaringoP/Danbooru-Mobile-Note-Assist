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
 * `applySpanStyle('background-color', …)`. An empty-string color
 * means "remove this property" — the BG-only transparent swatch
 * relies on this path.
 *
 * Behavior:
 *   - 14 Material-Design-toned swatches (D14) in a 7-col grid; tap
 *     to immediately confirm.
 *   - Transparent swatch is inserted at the head of the grid for the
 *     BG target only (Text has no meaningful "transparent" state —
 *     black is its default rather than the absence of color).
 *   - HEX input field beneath the grid for arbitrary colors —
 *     6-digit `#RRGGBB` only (3-digit shorthand deferred per D14 / Q5).
 *   - Apply (✔) confirms the HEX. Disabled + the input outlined red
 *     when the format is invalid.
 *   - Outside-tap close (mid-cycle 2026-05-14): a document-level
 *     pointerdown listener closes the picker when the tap lands
 *     outside the picker's own modal. To keep the parent note popover
 *     from being collateral damage, taps that fall outside BOTH the
 *     note popover AND the style popover get their event propagation
 *     suppressed so the page-level "dismiss active note" path can't
 *     fire after we've already handled the tap. Taps inside the note
 *     popover or style popover proceed normally so the underlying
 *     control still receives its click.
 *   - On confirm or cancel the textarea is re-focused so the mobile
 *     keyboard stays up across the color → textarea transition.
 *
 * Picker chaining: opening the color picker also closes any open
 * link or stroke picker, so only one sub-modal is up at a time.
 * Reverse hides are owned by the other modules so import cycles stay
 * one-directional (each module imports the other two's hide
 * functions, never their show functions).
 */

import {hideLinkPopover} from './link-popover';
import {getPopoverInputElement} from './popover';
import {hideRubyPopover} from './ruby-popover';
import {hideStrokePicker} from './stroke-picker';

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
let transparentSwatch: HTMLElement | null = null;
let onConfirmCallback: ((color: string) => void) | null = null;
let isShown = false;
let currentTarget: 'text' | 'bg' | null = null;
// Set by `onOutsideTap` when it suppressed an outside-popover tap;
// the matching `click` event (fired right after pointerdown finishes
// the up phase) then sees the flag and is also suppressed. Image /
// note-box click handlers register on `click`, not pointerdown, so
// without this paired suppression they still fire and dismiss the
// note popover even though we already stopped pointerdown.
let suppressNextClick = false;

function normalizeHex(input: string): string | null {
  const trimmed = input.trim();
  if (!HEX_RE.test(trimmed)) return null;
  return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
}

function refreshApplyState(): void {
  if (!applyButton || !hexInput) return;
  const valid = normalizeHex(hexInput.value) !== null;
  applyButton.disabled = !valid;
  hexInput.classList.toggle('is-invalid', !valid && hexInput.value !== '');
}

export function hideColorPicker(): void {
  if (!modalElement || !overlayElement) return;
  modalElement.classList.remove('show');
  overlayElement.classList.remove('show');
  isShown = false;
  currentTarget = null;
  onConfirmCallback = null;
}

function commitColor(color: string): void {
  const callback = onConfirmCallback;
  hideColorPicker();
  if (callback) {
    callback(color);
  } else {
    restoreTextareaSelection();
  }
}

function restoreTextareaSelection(): void {
  const ta = getPopoverInputElement();
  if (!ta) return;
  ta.focus();
  // Re-setting the existing range forces the visual highlight to
  // re-appear after the textarea lost focus to the picker — mobile
  // browsers don't always re-paint the selection on focus alone.
  ta.setSelectionRange(ta.selectionStart, ta.selectionEnd);
}

function handleCancel(): void {
  hideColorPicker();
  restoreTextareaSelection();
}

function handleHexApply(): void {
  if (!hexInput) return;
  const color = normalizeHex(hexInput.value);
  if (!color) return;
  // Same black-is-default rule as the swatch path — Text picker
  // collapses #000000 to a property removal.
  if (currentTarget === 'text' && color.toLowerCase() === '#000000') {
    commitColor('');
  } else {
    commitColor(color);
  }
}

/**
 * Document-level pointerdown handler — closes the picker when a tap
 * lands outside the picker's own modal. The picker swatches /
 * input / Apply button live inside `modalElement` so they're
 * filtered out here; the dim overlay has its own click handler that
 * also calls handleCancel(). Taps outside both the note popover and
 * the style popover have their propagation suppressed so the
 * page-level outside-tap path can't dismiss the note popover
 * underneath us.
 */
function onOutsideTap(e: PointerEvent): void {
  if (!isShown || !modalElement) return;
  const target = e.target as Element | null;
  if (!target) return;
  if (modalElement.contains(target)) return;
  // Tap on a Text / Stroke / BG color button — defer to the button's
  // own click handler so it can decide between toggle (close) and
  // switch (close + open the other picker). Closing here would race
  // the click handler's isShown check and re-open the picker.
  if (
    target.closest(
      '.dmna-style-color-text, .dmna-style-color-stroke, .dmna-style-color-bg',
    )
  ) {
    return;
  }
  hideColorPicker();
  restoreTextareaSelection();
  const notePop = document.getElementById('dmna-popover');
  const stylePop = document.getElementById('dmna-style-popover');
  const inNote = !!notePop?.contains(target);
  const inStyle = !!stylePop?.contains(target);
  if (!inNote && !inStyle) {
    e.preventDefault();
    e.stopPropagation();
    suppressNextClick = true;
  }
}

/**
 * Companion click handler — pointerdown's stopPropagation only
 * blocks pointer-level listeners. Click-level listeners (e.g.
 * `handleImageClick → dismissActivePopover → hidePopover`) still
 * fire on the same tap because click is a separate event in the
 * sequence. When pointerdown saw an outside-popover tap and set the
 * flag, we suppress the matching click here too.
 */
function onOutsideClick(e: MouseEvent): void {
  if (!suppressNextClick) return;
  suppressNextClick = false;
  e.preventDefault();
  e.stopPropagation();
}

export function createColorPicker(): void {
  if (modalElement && overlayElement) return;
  const host = document.getElementById('dmna-popover');
  if (!host) return;

  const overlay = document.createElement('div');
  overlay.id = 'dmna-color-overlay';
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
  modal.id = 'dmna-color-modal';

  const grid = document.createElement('div');
  grid.id = 'dmna-color-swatches';

  // Transparent swatch — first cell in the grid, BG-only visibility
  // is set in showColorPicker. Clicking commits an empty-string color
  // which the caller treats as a property removal.
  const transparent = document.createElement('button');
  transparent.type = 'button';
  transparent.className = 'dmna-color-swatch dmna-color-swatch-transparent';
  transparent.dataset.color = 'transparent';
  transparent.setAttribute('aria-label', 'Remove color');
  transparent.addEventListener('mousedown', e => e.preventDefault());
  transparent.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    commitColor('');
  });
  grid.appendChild(transparent);
  transparentSwatch = transparent;

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
      // Text picker treats black as "no color set" — the textarea's
      // default ink is already black, so writing `color: #000000` is
      // dead markup. Translate it to a property removal so the user
      // ends up with no <span> at all when that's all that was
      // applied. BG keeps black as a legitimate color choice (dark
      // backgrounds are intentional).
      if (currentTarget === 'text' && hex === '#000000') {
        commitColor('');
      } else {
        commitColor(hex);
      }
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
    // e.isComposing: see ruby-popover.ts for the IME-leak rationale.
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      e.stopPropagation();
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

  // Capture-phase document listeners — pointerdown closes the picker
  // and (when the tap is outside both popovers) suppresses the
  // sibling click via the flag.
  document.addEventListener('pointerdown', onOutsideTap, true);
  document.addEventListener('click', onOutsideClick, true);
}

/**
 * Open the picker. `target` is informational only — the caller's
 * onConfirm already knows whether the chosen color is for text or
 * background — but we set it as a data attribute on the modal so CSS
 * can theme the picker differently per target in a future cycle.
 * Also gates whether the transparent swatch is visible (BG only).
 *
 * The synchronous `hexInput.focus()` at the end is the iOS Safari
 * gesture-chain requirement: focus must land while the click handler
 * is still on the stack or the on-screen keyboard won't surface.
 *
 * Auto-closes any open link / stroke picker so the user never sees
 * two sub-modals stacked.
 */
export function showColorPicker(
  target: 'text' | 'bg',
  onConfirm: (color: string) => void,
): void {
  hideLinkPopover();
  hideStrokePicker();
  hideRubyPopover();
  createColorPicker();
  if (!modalElement || !overlayElement || !hexInput || !applyButton) return;
  currentTarget = target;
  modalElement.dataset.target = target;
  if (transparentSwatch) {
    transparentSwatch.style.display = target === 'bg' ? '' : 'none';
  }
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

/**
 * Which control opened the picker, or `null` when the picker is
 * closed. Used by the style popover's color buttons to implement the
 * "same button = close, different button = switch" toggle.
 */
export function getColorPickerTarget(): 'text' | 'bg' | null {
  return isShown ? currentTarget : null;
}
