/**
 * Stroke picker modal — inline modal mounted as a child of the note
 * popover that collects a CSS color (and optional thickness / sides)
 * for the style sub-popover's Stroke control. Mirrors the
 * color-picker pattern (DOM child of `#dmna-popover`, dim overlay,
 * keyboard mitigation) and adds an Advanced toggle that expands a
 * thickness + sides configuration panel.
 *
 * Layer 3 (ui). The caller's `onConfirm` callback receives a fully-
 * formed `text-shadow` value (multi-shadow CSV) which the caller
 * hands to `applySpanStyle('text-shadow', value)`. An empty string is
 * passed when the user picks "Remove stroke" — the caller should
 * interpret that as a property removal.
 *
 * Default action (color only, advanced un-touched): thickness 1px,
 * all four cardinal sides (top, right, bottom, left). Markup form
 * chosen per D19 (2026-05-14) — `text-shadow` over
 * `-webkit-text-stroke` for cross-browser support + direction control.
 *
 * Active state restore (thickness / sides) is intentionally deferred
 * to v4.3+ — parsing arbitrary multi-shadow values back into our
 * thickness+sides model is non-trivial and not worth the cycle here.
 * The swatch active color, however, is reflected by
 * refreshStylePopoverState from the first hex in the existing
 * `text-shadow` value.
 */

import {hideColorPicker} from './color-picker';
import {hideLinkPopover} from './link-popover';
import {getPopoverInputElement} from './popover';
import {hideRubyPopover} from './ruby-popover';

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

const THICKNESS_OPTIONS = [1, 2, 3] as const;
type Thickness = (typeof THICKNESS_OPTIONS)[number];

const SIDES = ['top', 'right', 'bottom', 'left'] as const;
type Side = (typeof SIDES)[number];

let modalElement: HTMLElement | null = null;
let overlayElement: HTMLElement | null = null;
let hexInput: HTMLInputElement | null = null;
let applyButton: HTMLButtonElement | null = null;
let advancedSection: HTMLElement | null = null;
let advancedToggle: HTMLButtonElement | null = null;
const thicknessButtons = new Map<Thickness, HTMLButtonElement>();
const sideCheckboxes = new Map<Side, HTMLInputElement>();
let onConfirmCallback: ((textShadow: string) => void) | null = null;
let isShown = false;
let isAdvancedOpen = false;
let selectedThickness: Thickness = 1;
// Paired with onOutsideClick — see color-picker.ts for the rationale.
let suppressNextClick = false;

function normalizeHex(input: string): string | null {
  const trimmed = input.trim();
  if (!HEX_RE.test(trimmed)) return null;
  return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
}

/**
 * Build a `text-shadow` value string from a color and the active
 * thickness + sides selection. Returns empty string when no side is
 * checked (caller should treat this as a no-op — equivalent to not
 * confirming).
 */
function buildTextShadow(color: string): string {
  const t = selectedThickness;
  const activeSides: Side[] = [];
  for (const s of SIDES) {
    if (sideCheckboxes.get(s)?.checked) activeSides.push(s);
  }
  if (activeSides.length === 0) return '';
  const shadows = activeSides.map(side => {
    switch (side) {
      case 'top':
        return `0 -${t}px 0 ${color}`;
      case 'right':
        return `${t}px 0 0 ${color}`;
      case 'bottom':
        return `0 ${t}px 0 ${color}`;
      case 'left':
        return `-${t}px 0 0 ${color}`;
    }
  });
  return shadows.join(', ');
}

function refreshApplyState(): void {
  if (!applyButton || !hexInput) return;
  const valid = normalizeHex(hexInput.value) !== null;
  applyButton.disabled = !valid;
  hexInput.classList.toggle('is-invalid', !valid && hexInput.value !== '');
}

function setAdvancedOpen(open: boolean): void {
  isAdvancedOpen = open;
  if (advancedSection) {
    advancedSection.classList.toggle('is-open', open);
  }
  if (advancedToggle) {
    advancedToggle.textContent = open ? 'Advanced ▴' : 'Advanced ▾';
  }
}

function setThickness(t: Thickness): void {
  selectedThickness = t;
  for (const [thickness, btn] of thicknessButtons) {
    btn.classList.toggle('is-active', thickness === t);
  }
}

function resetState(): void {
  if (!hexInput || !applyButton) return;
  hexInput.value = '';
  hexInput.classList.remove('is-invalid');
  applyButton.disabled = true;
  setAdvancedOpen(false);
  setThickness(1);
  for (const cb of sideCheckboxes.values()) {
    cb.checked = true;
  }
}

export function hideStrokePicker(): void {
  if (!modalElement || !overlayElement) return;
  modalElement.classList.remove('show');
  overlayElement.classList.remove('show');
  isShown = false;
  onConfirmCallback = null;
}

function commitStroke(color: string): void {
  const shadow = buildTextShadow(color);
  const callback = onConfirmCallback;
  hideStrokePicker();
  if (callback && shadow) {
    callback(shadow);
  } else {
    // Empty shadow (no sides checked) or no callback — restore the
    // textarea selection so the highlight reappears.
    restoreTextareaSelection();
  }
}

function commitRemove(): void {
  const callback = onConfirmCallback;
  hideStrokePicker();
  if (callback) {
    callback('');
  } else {
    restoreTextareaSelection();
  }
}

function restoreTextareaSelection(): void {
  const ta = getPopoverInputElement();
  if (!ta) return;
  ta.focus();
  ta.setSelectionRange(ta.selectionStart, ta.selectionEnd);
}

function handleCancel(): void {
  hideStrokePicker();
  restoreTextareaSelection();
}

/**
 * Document-level pointerdown handler — closes the stroke picker
 * when the tap lands outside its modal. Taps that fall outside both
 * the note popover and the style popover have their propagation
 * suppressed so the page-level "dismiss active note" path can't
 * piggy-back on the same tap and close the note popover too.
 */
function onOutsideTap(e: PointerEvent): void {
  if (!isShown || !modalElement) return;
  const target = e.target as Element | null;
  if (!target) return;
  if (modalElement.contains(target)) return;
  if (
    target.closest(
      '.dmna-style-color-text, .dmna-style-color-stroke, .dmna-style-color-bg',
    )
  ) {
    return;
  }
  hideStrokePicker();
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

function onOutsideClick(e: MouseEvent): void {
  if (!suppressNextClick) return;
  suppressNextClick = false;
  e.preventDefault();
  e.stopPropagation();
}

function handleHexApply(): void {
  if (!hexInput) return;
  const color = normalizeHex(hexInput.value);
  if (!color) return;
  commitStroke(color);
}

export function createStrokePicker(): void {
  if (modalElement && overlayElement) return;
  const host = document.getElementById('dmna-popover');
  if (!host) return;

  const overlay = document.createElement('div');
  overlay.id = 'dmna-stroke-overlay';
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
  modal.id = 'dmna-stroke-modal';

  // Swatch grid: leading transparent tile (= Remove stroke, mirrors
  // the BG picker pattern) + 14-color palette (D14).
  const grid = document.createElement('div');
  grid.id = 'dmna-stroke-swatches';

  const transparent = document.createElement('button');
  transparent.type = 'button';
  transparent.className = 'dmna-color-swatch dmna-color-swatch-transparent';
  transparent.dataset.color = 'transparent';
  transparent.setAttribute('aria-label', 'Remove stroke');
  transparent.addEventListener('mousedown', e => e.preventDefault());
  transparent.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    commitRemove();
  });
  grid.appendChild(transparent);

  for (const hex of SWATCHES) {
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'dmna-color-swatch';
    sw.style.background = hex;
    sw.dataset.color = hex;
    sw.setAttribute('aria-label', `Pick ${hex} stroke`);
    sw.addEventListener('mousedown', e => e.preventDefault());
    sw.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      commitStroke(hex);
    });
    grid.appendChild(sw);
  }
  modal.appendChild(grid);

  // HEX input + Apply (✔).
  const inputRow = document.createElement('div');
  inputRow.id = 'dmna-stroke-input-row';
  const input = document.createElement('input');
  input.type = 'text';
  input.id = 'dmna-stroke-hex';
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
  apply.id = 'dmna-stroke-apply';
  apply.textContent = '✔';
  apply.setAttribute('aria-label', 'Apply HEX stroke color');
  apply.disabled = true;
  apply.addEventListener('mousedown', e => e.preventDefault());
  apply.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    handleHexApply();
  });
  inputRow.appendChild(apply);
  modal.appendChild(inputRow);

  // Advanced toggle (text link) + collapsible advanced section.
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.id = 'dmna-stroke-advanced-toggle';
  toggle.addEventListener('mousedown', e => e.preventDefault());
  toggle.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    setAdvancedOpen(!isAdvancedOpen);
  });
  modal.appendChild(toggle);

  const advanced = document.createElement('div');
  advanced.id = 'dmna-stroke-advanced';

  // Thickness row.
  const thicknessRow = document.createElement('div');
  thicknessRow.className = 'dmna-stroke-advanced-row';
  const thicknessLabel = document.createElement('span');
  thicknessLabel.className = 'dmna-stroke-advanced-label';
  thicknessLabel.textContent = 'Thickness';
  thicknessRow.appendChild(thicknessLabel);
  const thicknessGroup = document.createElement('div');
  thicknessGroup.className = 'dmna-stroke-thickness-group';
  for (const t of THICKNESS_OPTIONS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dmna-stroke-thickness-btn';
    btn.textContent = `${t}px`;
    btn.dataset.thickness = String(t);
    btn.addEventListener('mousedown', e => e.preventDefault());
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      setThickness(t);
    });
    thicknessButtons.set(t, btn);
    thicknessGroup.appendChild(btn);
  }
  thicknessRow.appendChild(thicknessGroup);
  advanced.appendChild(thicknessRow);

  // Sides row (top / right / bottom / left checkboxes).
  const sidesRow = document.createElement('div');
  sidesRow.className = 'dmna-stroke-advanced-row';
  const sidesLabel = document.createElement('span');
  sidesLabel.className = 'dmna-stroke-advanced-label';
  sidesLabel.textContent = 'Sides';
  sidesRow.appendChild(sidesLabel);
  const sidesGroup = document.createElement('div');
  sidesGroup.className = 'dmna-stroke-sides-group';
  for (const side of SIDES) {
    const lbl = document.createElement('label');
    lbl.className = 'dmna-stroke-side-label';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.dataset.side = side;
    cb.addEventListener('mousedown', e => e.preventDefault());
    sideCheckboxes.set(side, cb);
    lbl.appendChild(cb);
    const txt = document.createElement('span');
    txt.textContent = side;
    lbl.appendChild(txt);
    sidesGroup.appendChild(lbl);
  }
  sidesRow.appendChild(sidesGroup);
  advanced.appendChild(sidesRow);

  modal.appendChild(advanced);

  // Remove link — clears the text-shadow property entirely.
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.id = 'dmna-stroke-remove';
  remove.textContent = 'Remove stroke';
  remove.addEventListener('mousedown', e => e.preventDefault());
  remove.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    commitRemove();
  });
  modal.appendChild(remove);

  host.appendChild(overlay);
  host.appendChild(modal);

  overlayElement = overlay;
  modalElement = modal;
  hexInput = input;
  applyButton = apply;
  advancedSection = advanced;
  advancedToggle = toggle;

  setThickness(1);
  setAdvancedOpen(false);

  document.addEventListener('pointerdown', onOutsideTap, true);
  document.addEventListener('click', onOutsideClick, true);
}

/**
 * Open the stroke picker. `onConfirm` receives the assembled
 * `text-shadow` value (or an empty string on Remove). The synchronous
 * `hexInput.focus()` keeps the iOS Safari keyboard up across the
 * triggering click handler.
 */
export function showStrokePicker(
  onConfirm: (textShadow: string) => void,
): void {
  hideColorPicker();
  hideLinkPopover();
  hideRubyPopover();
  createStrokePicker();
  if (!modalElement || !overlayElement || !hexInput) return;
  resetState();
  onConfirmCallback = onConfirm;
  overlayElement.classList.add('show');
  modalElement.classList.add('show');
  isShown = true;
  hexInput.focus();
}

export function isStrokePickerShown(): boolean {
  return isShown;
}
