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

// Hard-coded for now — Phase 4 visual check resolves Q3 (1-row vs
// 2-row layout) and may move these into config.ts if a wider/narrower
// choice ships.
const STYLE_POPOVER_WIDTH = 224;
const STYLE_POPOVER_GAP = 8;

interface StyleButton {
  tag: string;
  label: string;
  className: string;
}

const STYLE_BUTTONS: StyleButton[] = [
  {tag: 'b', label: 'B', className: 'dmna-style-btn-bold'},
  {tag: 'i', label: 'I', className: 'dmna-style-btn-italic'},
  {tag: 'u', label: 'U', className: 'dmna-style-btn-underline'},
  {tag: 's', label: 'S', className: 'dmna-style-btn-strike'},
  {tag: 'big', label: 'big', className: 'dmna-style-btn-big'},
  {tag: 'small', label: 'small', className: 'dmna-style-btn-small'},
  {tag: 'tn', label: 'tn', className: 'dmna-style-btn-tn'},
];

let stylePopoverElement: HTMLElement | null = null;
let isShown = false;

/**
 * Builds the DOM (idempotent). Caller is `main.ts#init` for boot-
 * time front-loading, or `showStylePopover` on lazy first toggle.
 */
export function createStylePopover(): void {
  if (stylePopoverElement) {
    return;
  }
  const root = document.createElement('div');
  root.id = 'dmna-style-popover';

  const grid = document.createElement('div');
  grid.id = 'dmna-style-popover-grid';

  for (const btn of STYLE_BUTTONS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `dmna-style-btn ${btn.className}`;
    b.textContent = btn.label;
    b.dataset.tag = btn.tag;
    b.setAttribute('aria-label', `Wrap selection with <${btn.tag}>`);
    b.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      // v4.2 placeholder — wrap logic ships in v4.3+ (PLAN backlog).
      console.log(`[MobileNoteAssist] style button placeholder: ${btn.tag}`);
    });
    grid.appendChild(b);
  }

  root.appendChild(grid);
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
  // Pre-position BEFORE the show class flips display (mirrors the
  // note popover's anti-flicker pattern in showPopover).
  updateStylePopoverPosition();
  stylePopoverElement.classList.add('show');
  isShown = true;
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
