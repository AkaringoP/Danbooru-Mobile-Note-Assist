/**
 * Style popover — sub-popover attached to the note popover that
 * exposes basic markup buttons (B / I / U / S / big / small / tn).
 *
 * Layer 3 (ui). Built lazily by `showStylePopover` on first toggle,
 * or eagerly by `main.ts` at boot. Stays a sibling of the note
 * popover at `document.body` rather than a child — that way the
 * two transform independently and the close-policy chain (hide on
 * note-popover hide / active-note swap / Esc) is explicit instead
 * of relying on DOM-parent removal.
 *
 * Attach behavior (PLAN D7):
 *   - default: right of the note popover, 8 px gap
 *   - viewport overflow → flip to the left
 *   - same `1 / scale` counter as the note popover so pinch-zoom
 *     leaves the visual size constant
 *
 * Click handlers are placeholders in this cycle (PLAN D8) — they
 * `console.log` and return. v4.3+ will implement the actual textarea
 * markup-wrap behavior (cursor / selection-aware insertion of
 * `<tag>…</tag>` around the active note's text).
 */

import {POPOVER_OFFSET, POPOVER_WIDTH} from '../config';
import {getOriginalWidth} from '../state/image-state';
import {getActiveNoteId, notes} from '../state/notes-store';
import {getImageDisplayRect, imageToScreenRect} from '../utils/coords';

// Style popover shares the note popover's width so the attach math
// reads symmetrically (left/right flip is a simple width subtraction).
// Imported from config to keep the contract one-sourced.
const STYLE_POPOVER_WIDTH = POPOVER_WIDTH;
const STYLE_POPOVER_GAP = 8;

interface StyleTagButton {
  tag: string;
  label: string;
  className: string;
}

// Row 1: B / I / U
const ROW_1_BUTTONS: StyleTagButton[] = [
  {tag: 'b', label: 'B', className: 'dmna-style-btn-bold'},
  {tag: 'i', label: 'I', className: 'dmna-style-btn-italic'},
  {tag: 'u', label: 'U', className: 'dmna-style-btn-underline'},
];

// Row 2: S / tn / a
const ROW_2_BUTTONS: StyleTagButton[] = [
  {tag: 's', label: 'S', className: 'dmna-style-btn-strike'},
  {tag: 'tn', label: 'tn', className: 'dmna-style-btn-tn'},
  {tag: 'a', label: 'a', className: 'dmna-style-btn-link'},
];

let stylePopoverElement: HTMLElement | null = null;
let isShown = false;

/**
 * Builds the DOM (idempotent). Caller is `main.ts#init` for boot-
 * time front-loading, or `showStylePopover` on lazy first toggle.
 */
/**
 * Builds a row container with N tag-buttons. Caller fills the array
 * and gets back the wrapper div. Click handlers stub-log only — the
 * actual textarea wrap logic ships in a follow-up cycle.
 */
function buildTagRow(buttons: StyleTagButton[]): HTMLElement {
  const row = document.createElement('div');
  row.className = `dmna-style-row dmna-style-row-${buttons.length}`;
  for (const btn of buttons) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `dmna-style-btn ${btn.className}`;
    b.textContent = btn.label;
    b.dataset.tag = btn.tag;
    b.setAttribute('aria-label', `Wrap selection with <${btn.tag}>`);
    b.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      console.log(`[MobileNoteAssist] style tag placeholder: ${btn.tag}`);
    });
    row.appendChild(b);
  }
  return row;
}

function buildColorRow(): HTMLElement {
  const row = document.createElement('div');
  row.className = 'dmna-style-row dmna-style-row-2';

  const text = document.createElement('button');
  text.type = 'button';
  text.className = 'dmna-style-btn dmna-style-color-text';
  text.dataset.control = 'color-text';
  text.setAttribute('aria-label', 'Pick text color');
  const textLabel = document.createElement('span');
  textLabel.className = 'dmna-style-color-label';
  textLabel.textContent = '글자';
  const textSwatch = document.createElement('span');
  textSwatch.className = 'dmna-style-color-swatch';
  textSwatch.style.background = '#000';
  text.appendChild(textLabel);
  text.appendChild(textSwatch);
  text.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    console.log('[MobileNoteAssist] color-text placeholder');
  });

  const bg = document.createElement('button');
  bg.type = 'button';
  bg.className = 'dmna-style-btn dmna-style-color-bg';
  bg.dataset.control = 'color-bg';
  bg.setAttribute('aria-label', 'Pick background color');
  const bgLabel = document.createElement('span');
  bgLabel.className = 'dmna-style-color-label';
  bgLabel.textContent = '배경';
  const bgSwatch = document.createElement('span');
  bgSwatch.className = 'dmna-style-color-swatch dmna-style-color-transparent';
  bg.appendChild(bgLabel);
  bg.appendChild(bgSwatch);
  bg.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    console.log('[MobileNoteAssist] color-bg placeholder');
  });

  row.appendChild(text);
  row.appendChild(bg);
  return row;
}

function buildSelectRow(control: string, placeholder: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'dmna-style-row dmna-style-row-1';
  const select = document.createElement('select');
  select.className = 'dmna-style-select';
  select.dataset.control = control;
  const placeholderOpt = document.createElement('option');
  placeholderOpt.textContent = placeholder;
  placeholderOpt.value = '';
  select.appendChild(placeholderOpt);
  select.addEventListener('change', () => {
    console.log(
      `[MobileNoteAssist] style ${control} placeholder: ${select.value}`,
    );
  });
  row.appendChild(select);
  return row;
}

export function createStylePopover(): void {
  if (stylePopoverElement) {
    return;
  }
  const root = document.createElement('div');
  root.id = 'dmna-style-popover';

  // Inner wrapper hosts the slide-in transform — keeping it separate
  // from the outer's translate+scale (set by updateStylePopoverPosition)
  // lets the two animations compose without fighting.
  const inner = document.createElement('div');
  inner.id = 'dmna-style-popover-inner';

  inner.appendChild(buildTagRow(ROW_1_BUTTONS));
  inner.appendChild(buildTagRow(ROW_2_BUTTONS));
  inner.appendChild(buildColorRow());
  inner.appendChild(buildSelectRow('size', '글자 크기'));
  inner.appendChild(buildSelectRow('font', '폰트'));

  root.appendChild(inner);
  document.body.appendChild(root);
  stylePopoverElement = root;
}

export function isStylePopoverShown(): boolean {
  return isShown;
}

export function showStylePopover(): void {
  createStylePopover();
  if (!stylePopoverElement) {
    return;
  }
  // Flip the shown flag BEFORE calling updateStylePopoverPosition —
  // that function's own guard short-circuits on !isShown to save a
  // layout pass per viewport tick while the popover is closed, so
  // calling it pre-flip would no-op and the element would render
  // with no transform (sitting at 0,0). Position first via the flag-
  // then-call ordering, THEN add `.show` to flip display — same
  // anti-flicker pattern as showPopover.
  isShown = true;
  updateStylePopoverPosition();
  stylePopoverElement.classList.add('show');
}

export function hideStylePopover(): void {
  if (!stylePopoverElement) {
    return;
  }
  stylePopoverElement.classList.remove('show');
  isShown = false;
}

export function toggleStylePopover(): void {
  if (isShown) {
    hideStylePopover();
  } else {
    showStylePopover();
  }
}

/**
 * Re-pins the sub-popover next to the note popover. Mirrors the
 * coord math in `popover.updatePopoverPosition`: same image-box →
 * visual-rect computation, then offsets by note popover's width +
 * gap. Right-side default; flips left when right placement would
 * overflow the viewport.
 *
 * No-op when `isShown` is false — saves a layout/getBoundingClientRect
 * pass on every viewport tick when the user has the sub-popover
 * closed (the common case).
 */
export function updateStylePopoverPosition(): void {
  if (!stylePopoverElement || !isShown) {
    return;
  }
  const activeId = getActiveNoteId();
  if (!activeId) {
    return;
  }
  const note = notes.get(activeId);
  if (!note) {
    return;
  }
  const img = document.getElementById('image') as HTMLImageElement | null;
  if (!img) {
    return;
  }
  const displayRect = getImageDisplayRect(img);
  if (!displayRect) {
    return;
  }
  const boxRectPage = imageToScreenRect(
    note.current,
    displayRect,
    getOriginalWidth(),
  );

  const vv = window.visualViewport;
  const scale = vv ? vv.scale : 1;
  const invScale = 1 / scale;
  const vvPageLeft = vv ? vv.pageLeft : window.pageXOffset;
  const vvPageTop = vv ? vv.pageTop : window.pageYOffset;
  const vvWidth = vv ? vv.width : window.innerWidth;

  const boxVisualLeft = (boxRectPage.left - vvPageLeft) * scale;
  const boxVisualTop = (boxRectPage.top - vvPageTop) * scale;
  const boxVisualWidth = boxRectPage.width * scale;
  const boxVisualHeight = boxRectPage.height * scale;
  const boxCenterVisualX = boxVisualLeft + boxVisualWidth / 2;
  const boxBottomVisualY = boxVisualTop + boxVisualHeight;

  // Note popover's visual anchor (must match updatePopoverPosition).
  const notePopVisualLeft = boxCenterVisualX - POPOVER_WIDTH / 2;
  const notePopVisualTop = boxBottomVisualY + POPOVER_OFFSET;
  const notePopVisualRight = notePopVisualLeft + POPOVER_WIDTH;

  // Right default; flip left when right overflows.
  let styleVisualLeft = notePopVisualRight + STYLE_POPOVER_GAP;
  if (styleVisualLeft + STYLE_POPOVER_WIDTH > vvWidth) {
    styleVisualLeft =
      notePopVisualLeft - STYLE_POPOVER_GAP - STYLE_POPOVER_WIDTH;
  }
  const styleVisualTop = notePopVisualTop;

  const tx = vvPageLeft + styleVisualLeft / scale;
  const ty = vvPageTop + styleVisualTop / scale;
  stylePopoverElement.style.transform = `translate(${tx}px, ${ty}px) scale(${invScale})`;
}
