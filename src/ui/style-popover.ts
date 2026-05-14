/**
 * Style popover — sub-popover attached to the note popover that
 * exposes markup tag buttons (B / I / U; S / tn / a), color swatches,
 * and font/size dropdowns.
 *
 * Layer 3 (ui). Built lazily by `showStylePopover` on first toggle,
 * or eagerly by `main.ts` at boot. Stays a sibling of the note
 * popover at `document.body` rather than a child — that way the
 * two transform independently and the close-policy chain (hide on
 * note-popover hide / active-note swap / Esc) is explicit instead
 * of relying on DOM-parent removal.
 *
 * Attach behavior:
 *   - default: right of the note popover, 8 px gap
 *   - viewport overflow → flip to the left
 *   - same `1 / scale` counter as the note popover so pinch-zoom
 *     leaves the visual size constant
 *
 * Tag-button behavior (v4.2):
 *   - Aa side-stack button enables only when the textarea has a
 *     non-collapsed selection (the wrap target).
 *   - Each tag button wraps the selection in `<tag>…</tag>`. The new
 *     selection is the same text re-selected inside the wrap, so a
 *     subsequent click nests the next layer inward instead of stacking
 *     outside the previous one.
 *   - Active highlights mark every outer layer currently wrapping the
 *     selection; tapping an active button unwraps that specific layer
 *     and leaves the inner ones alone. Selection text is preserved.
 *
 * Color row + size/font dropdowns are still placeholders — the user
 * is defining their behavior in a follow-up; click/change handlers
 * `console.log` for now.
 */

import {POPOVER_OFFSET, POPOVER_WIDTH} from '../config';
import {getOriginalWidth} from '../state/image-state';
import {getActiveNoteId, notes} from '../state/notes-store';
import {getImageDisplayRect, imageToScreenRect} from '../utils/coords';
import {parseStyleAttr, serializeStyleAttr} from '../utils/style-attr';
import {showLinkPopover} from './link-popover';
import {getPopoverInputElement} from './popover';

// Style popover has its own width independent of POPOVER_WIDTH —
// the note popover grew wider in Phase 4 polish to match action-row
// cell widths to the style row, but the style popover keeps the
// original 260 so the B/I/U cell width (the reference target) stays
// where it was. Kept in sync with the literal in styles.ts.
const STYLE_POPOVER_WIDTH = 260;
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

interface OuterLayer {
  tag: string;
  /**
   * Raw attribute run (everything between the tag name and the `>`),
   * preserved verbatim so mutate helpers can rebuild the open tag
   * with non-style attributes (class, title, href) intact while only
   * the `style="…"` portion is rewritten.
   */
  attrs: string;
  /** Index into `before` where the `<tag>` opening starts. */
  openStart: number;
  /** Length of the opening tag string (e.g. `<b>` is 3). */
  openLen: number;
  /** Index into `after` where the matching `</tag>` starts. */
  closeStart: number;
  /** Length of the closing tag string (e.g. `</b>` is 4). */
  closeLen: number;
  /**
   * Parsed `style="..."` attribute as a property → value map.
   * Populated only when the tag carried an inline style attribute
   * (`<span>` in v4.2 markup); undefined when the tag had no style
   * attr. Empty Map is possible when the style attr was present but
   * parsed to nothing (all declarations malformed).
   */
  styleProps?: Map<string, string>;
}

/**
 * Walks outward from the selection (using its `before` / `after`
 * slices of the textarea value) and returns the matched
 * `<tag>...</tag>` wrappers in inner-to-outer order. Stops at the
 * first non-matching layer.
 *
 * The opening regex tolerates an optional attribute run (e.g. the
 * `href="..."` part of an `<a>` typed by hand or sourced from a
 * server note), so markup the user didn't author via these buttons
 * still lights up the matching active highlight. `openLen` carries
 * the precise opening length so a later unwrap removes exactly what
 * was matched (attributes and all) rather than guessing a 3-char
 * `<a>` boundary that would slice into the href.
 *
 * Close tag is required to be the bare `</tag>` form — that's what
 * a balanced wrap produces, and matching arbitrary close variants
 * would let detection drift over malformed input.
 */
function detectOuterLayers(before: string, after: string): OuterLayer[] {
  const layers: OuterLayer[] = [];
  let bLen = before.length;
  let consumedAfter = 0;
  while (true) {
    const slice = before.slice(0, bLen);
    const openMatch = slice.match(/<([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^<>]*)?)>$/);
    if (!openMatch) {
      break;
    }
    const tag = openMatch[1].toLowerCase();
    const attrs = openMatch[2];
    const expectedClose = `</${tag}>`;
    if (!after.startsWith(expectedClose, consumedAfter)) {
      break;
    }
    const openStart = bLen - openMatch[0].length;
    const layer: OuterLayer = {
      tag,
      attrs,
      openStart,
      openLen: openMatch[0].length,
      closeStart: consumedAfter,
      closeLen: expectedClose.length,
    };
    const styleStr = extractStyleAttr(attrs);
    if (styleStr !== null) {
      layer.styleProps = parseStyleAttr(styleStr);
    }
    layers.push(layer);
    bLen = openStart;
    consumedAfter += expectedClose.length;
  }
  return layers;
}

/**
 * Pulls the value of a `style="…"` attribute out of an open-tag's
 * attribute string. Returns `null` when the tag carried no style attr
 * (versus an empty string when the attr was present but blank). The
 * HTML spec disallows a literal `"` inside a `"`-quoted value (it
 * must be encoded as `&quot;`), so a simple regex suffices — no full
 * attribute parser is needed. Falls back to single-quoted form
 * because Danbooru's sanitize pipeline may re-emit attrs that way.
 */
function extractStyleAttr(attrs: string): string | null {
  const dq = attrs.match(/\bstyle\s*=\s*"([^"]*)"/i);
  if (dq) return dq[1];
  const sq = attrs.match(/\bstyle\s*=\s*'([^']*)'/i);
  if (sq) return sq[1];
  return null;
}

/**
 * Collects, from the textarea's current selection, the union of CSS
 * property → value pairs carried by the outer `<span>` / `<div>`
 * wrappers around the selection. Inner layers' values shadow outer
 * ones (closer-to-the-selection wins), mirroring how browsers
 * resolve inline style on nested elements. Span (inline) and div
 * (block) snapshots are kept separate so callers can target the
 * right wrapper type.
 *
 * Used by Phase 5 apply / remove helpers (Task 5.3) and the active
 * state UI (Task 5.6) so neither has to walk OuterLayer itself.
 * Returns empty maps when there's no textarea or no live selection.
 */
export function getActiveStyleSnapshot(): {
  spanProps: Map<string, string>;
  divProps: Map<string, string>;
} {
  const spanProps = new Map<string, string>();
  const divProps = new Map<string, string>();
  const ta = getPopoverInputElement();
  if (!ta || ta.selectionStart === ta.selectionEnd) {
    return {spanProps, divProps};
  }
  const before = ta.value.slice(0, ta.selectionStart);
  const after = ta.value.slice(ta.selectionEnd);
  // detectOuterLayers returns inner-to-outer; iterate outer-to-inner
  // so inner values overwrite outer values (closer wins).
  const layers = detectOuterLayers(before, after);
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    if (!layer.styleProps) continue;
    let target: Map<string, string> | null;
    if (layer.tag === 'span') {
      target = spanProps;
    } else if (layer.tag === 'div') {
      target = divProps;
    } else {
      target = null;
    }
    if (!target) continue;
    for (const [k, v] of layer.styleProps) {
      target.set(k, v);
    }
  }
  return {spanProps, divProps};
}

/**
 * Strips any `style="…"` (or single-quoted form) attribute from a
 * tag's raw attribute string. Used by `buildOpenTag` to peel the
 * existing style out before rewriting it; non-style attrs (class,
 * title, href) are left in place verbatim.
 */
function stripStyleAttr(attrs: string): string {
  return attrs
    .replace(/\s*\bstyle\s*=\s*"[^"]*"/i, '')
    .replace(/\s*\bstyle\s*=\s*'[^']*'/i, '');
}

/**
 * Builds an open tag string from a tag name, the layer's raw attribute
 * run, and a property → value Map. The existing `style="…"` (if any)
 * is dropped and replaced by `serializeStyleAttr(styleMap)`. When the
 * Map is empty the rebuilt tag carries no style attr at all.
 */
function buildOpenTag(
  tag: string,
  attrs: string,
  styleMap: Map<string, string>,
): string {
  const cleaned = stripStyleAttr(attrs);
  const styleStr = serializeStyleAttr(styleMap);
  if (!styleStr) {
    return `<${tag}${cleaned}>`;
  }
  return `<${tag}${cleaned} style="${styleStr}">`;
}

/**
 * Applies (or replaces) a single CSS property on the textarea's
 * current selection using the option-A "unified inline style span"
 * model: when the nearest outer `<span>` around the selection already
 * exists, that span's style attribute is mutated in place (other
 * properties intact); otherwise the selection is wrapped in a fresh
 * `<span style="prop: value">…</span>`. Caller is responsible for
 * confirming the selection is non-collapsed beforehand.
 *
 * Selection is preserved across the mutation — after the replace, the
 * highlighted text is the same characters as before, just shifted by
 * the open tag's length delta.
 */
export function applySpanStyle(prop: string, value: string): void {
  const ta = getPopoverInputElement();
  if (!ta) return;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  if (start === end) return;

  const before = ta.value.slice(0, start);
  const after = ta.value.slice(end);
  const layers = detectOuterLayers(before, after);
  const innerSpan = layers.find(l => l.tag === 'span');

  if (innerSpan) {
    const newProps = new Map(innerSpan.styleProps ?? []);
    newProps.set(prop, value);
    const newOpen = buildOpenTag('span', innerSpan.attrs, newProps);
    const openEnd = innerSpan.openStart + innerSpan.openLen;
    ta.value =
      ta.value.slice(0, innerSpan.openStart) +
      newOpen +
      ta.value.slice(openEnd);
    const lenDelta = newOpen.length - innerSpan.openLen;
    ta.setSelectionRange(start + lenDelta, end + lenDelta);
  } else {
    const selected = ta.value.slice(start, end);
    const open = `<span style="${prop}: ${value}">`;
    const close = '</span>';
    ta.value = before + open + selected + close + after;
    ta.setSelectionRange(start + open.length, end + open.length);
  }

  ta.focus();
  ta.dispatchEvent(new Event('input', {bubbles: true}));
  refreshStylePopoverState();
}

/**
 * Removes a single CSS property from the nearest outer `<span>` that
 * carries it. When that removal empties the span's style attribute
 * AND the tag had no other attributes (class, title …), the entire
 * span wrapper is unwrapped so no empty `<span></span>` shell is
 * left behind. No-op when no outer span carries the property.
 */
export function removeSpanStyle(prop: string): void {
  const ta = getPopoverInputElement();
  if (!ta) return;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  if (start === end) return;

  const before = ta.value.slice(0, start);
  const after = ta.value.slice(end);
  const layers = detectOuterLayers(before, after);
  const target = layers.find(l => l.tag === 'span' && l.styleProps?.has(prop));
  if (!target) return;

  const newProps = new Map(target.styleProps);
  newProps.delete(prop);

  const closeAbsStart = end + target.closeStart;
  const closeAbsEnd = closeAbsStart + target.closeLen;
  const openEnd = target.openStart + target.openLen;

  if (newProps.size === 0 && stripStyleAttr(target.attrs).trim() === '') {
    ta.value =
      ta.value.slice(0, target.openStart) +
      ta.value.slice(openEnd, closeAbsStart) +
      ta.value.slice(closeAbsEnd);
    ta.setSelectionRange(start - target.openLen, end - target.openLen);
  } else {
    const newOpen = buildOpenTag('span', target.attrs, newProps);
    ta.value =
      ta.value.slice(0, target.openStart) + newOpen + ta.value.slice(openEnd);
    const lenDelta = newOpen.length - target.openLen;
    ta.setSelectionRange(start + lenDelta, end + lenDelta);
  }

  ta.focus();
  ta.dispatchEvent(new Event('input', {bubbles: true}));
  refreshStylePopoverState();
}

/**
 * Wraps the textarea's current selection in `<tag>…</tag>`, then
 * re-selects the same text (now offset by the opening tag length) so
 * a subsequent click on another button nests inside this wrap. Fires
 * an input event so the note's `current.text` follows.
 */
function applyWrap(tag: string): void {
  const ta = getPopoverInputElement();
  if (!ta) return;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  if (start === end) return;
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const before = ta.value.slice(0, start);
  const selected = ta.value.slice(start, end);
  const after = ta.value.slice(end);
  ta.value = before + open + selected + close + after;
  ta.setSelectionRange(start + open.length, end + open.length);
  ta.focus();
  ta.dispatchEvent(new Event('input', {bubbles: true}));
  refreshStylePopoverState();
}

/**
 * Removes the nearest `<tag>…</tag>` wrap around the selection. The
 * selection itself is preserved (same text, shifted by the removed
 * opening tag length). Caller passes the tag identified by the
 * active-highlight UI, so the active branch is always non-empty.
 */
function applyUnwrap(tag: string): void {
  const ta = getPopoverInputElement();
  if (!ta) return;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  if (start === end) return;
  const before = ta.value.slice(0, start);
  const selected = ta.value.slice(start, end);
  const after = ta.value.slice(end);
  const layers = detectOuterLayers(before, after);
  const found = layers.find(l => l.tag === tag);
  if (!found) return;
  const newBefore =
    before.slice(0, found.openStart) +
    before.slice(found.openStart + found.openLen);
  const newAfter =
    after.slice(0, found.closeStart) +
    after.slice(found.closeStart + found.closeLen);
  ta.value = newBefore + selected + newAfter;
  ta.setSelectionRange(newBefore.length, newBefore.length + selected.length);
  ta.focus();
  ta.dispatchEvent(new Event('input', {bubbles: true}));
  refreshStylePopoverState();
}

/**
 * Captures the current textarea selection, then opens the link modal.
 * The captured `(start, end)` is closed over by the Confirm callback
 * so the wrap still targets the right slice even though the textarea
 * lost focus to the modal's URL input in between.
 */
function handleLinkClick(): void {
  const ta = getPopoverInputElement();
  if (!ta) return;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  if (start === end) return;
  showLinkPopover(url => applyLinkWrap(start, end, url));
}

/**
 * Wraps the textarea slice between `start` and `end` in
 * `<a href="…">…</a>` using the URL from the link modal. Mirrors
 * `applyWrap` but inserts the attribute-carrying opening tag; the
 * selection ends up positioned on the link text inside the wrap so
 * a follow-up tag button nests inward.
 */
function applyLinkWrap(start: number, end: number, url: string): void {
  const ta = getPopoverInputElement();
  if (!ta) return;
  const open = `<a href="${url}">`;
  const close = '</a>';
  const before = ta.value.slice(0, start);
  const selected = ta.value.slice(start, end);
  const after = ta.value.slice(end);
  ta.value = before + open + selected + close + after;
  ta.setSelectionRange(start + open.length, end + open.length);
  ta.focus();
  ta.dispatchEvent(new Event('input', {bubbles: true}));
  refreshStylePopoverState();
}

/**
 * Builds a row container with N tag-buttons. Each click routes to
 * wrap or unwrap depending on whether the button is currently in the
 * active set — keeping the toggle interaction discoverable. `<a>` is
 * a special case: when inactive it opens the link modal to collect a
 * URL before wrapping; the unwrap branch still goes through the
 * standard `applyUnwrap` since `detectOuterLayers` matches the
 * attribute-bearing opening tag.
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
    // Keep textarea focus so its selection highlight doesn't fade out
    // when the user reaches over to the sub-popover.
    b.addEventListener('mousedown', e => e.preventDefault());
    b.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      if (b.classList.contains('is-active')) {
        applyUnwrap(btn.tag);
      } else if (btn.tag === 'a') {
        handleLinkClick();
      } else {
        applyWrap(btn.tag);
      }
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
  textLabel.textContent = 'Text';
  const textSwatch = document.createElement('span');
  textSwatch.className = 'dmna-style-color-swatch';
  textSwatch.style.background = '#000';
  text.appendChild(textLabel);
  text.appendChild(textSwatch);
  text.addEventListener('mousedown', e => e.preventDefault());
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
  bgLabel.textContent = 'BG';
  const bgSwatch = document.createElement('span');
  bgSwatch.className = 'dmna-style-color-swatch dmna-style-color-transparent';
  bg.appendChild(bgLabel);
  bg.appendChild(bgSwatch);
  bg.addEventListener('mousedown', e => e.preventDefault());
  bg.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    console.log('[MobileNoteAssist] color-bg placeholder');
  });

  row.appendChild(text);
  row.appendChild(bg);
  return row;
}

function buildSelectControl(
  control: string,
  placeholder: string,
): HTMLSelectElement {
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
  return select;
}

function buildSelectRow(...controls: HTMLSelectElement[]): HTMLElement {
  const row = document.createElement('div');
  row.className = `dmna-style-row dmna-style-row-${controls.length}`;
  controls.forEach(c => row.appendChild(c));
  return row;
}

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

  // Inner wrapper hosts the slide-in transform — keeping it separate
  // from the outer's translate+scale (set by updateStylePopoverPosition)
  // lets the two animations compose without fighting.
  const inner = document.createElement('div');
  inner.id = 'dmna-style-popover-inner';

  inner.appendChild(buildTagRow(ROW_1_BUTTONS));
  inner.appendChild(buildTagRow(ROW_2_BUTTONS));
  inner.appendChild(buildColorRow());
  inner.appendChild(
    buildSelectRow(
      buildSelectControl('size', 'Size'),
      buildSelectControl('align', 'Align'),
    ),
  );
  inner.appendChild(buildSelectRow(buildSelectControl('font', 'Font')));

  root.appendChild(inner);
  document.body.appendChild(root);
  stylePopoverElement = root;
  refreshStylePopoverState();
}

/**
 * Sync the popover's per-button state to the textarea's current
 * selection: when the selection is collapsed (or no textarea), every
 * control is disabled and all active highlights drop. Otherwise the
 * tag buttons enable, and any outer wrap layer around the selection
 * lights up its corresponding button so the user can spot what's
 * already applied at a glance.
 *
 * Called by `popover.ts`'s selectionchange listener on every cursor
 * move + by `applyWrap` / `applyUnwrap` post-mutation so the UI stays
 * in sync with the textarea content.
 */
export function refreshStylePopoverState(): void {
  if (!stylePopoverElement) return;
  const ta = getPopoverInputElement();
  const hasSelection =
    !!ta && ta.selectionStart !== ta.selectionEnd && !ta.disabled;

  stylePopoverElement
    .querySelectorAll<
      HTMLButtonElement | HTMLSelectElement
    >('.dmna-style-btn, .dmna-style-select')
    .forEach(el => {
      el.disabled = !hasSelection;
    });

  if (!hasSelection || !ta) {
    stylePopoverElement
      .querySelectorAll('.is-active')
      .forEach(el => el.classList.remove('is-active'));
    // Selection went away (user moved the cursor, deleted the
    // selected text, or moved focus off the textarea) — auto-close
    // the popover so it doesn't linger as a dead UI panel. Cheap
    // no-op when the popover wasn't open in the first place.
    hideStylePopover();
    return;
  }

  const before = ta.value.slice(0, ta.selectionStart);
  const after = ta.value.slice(ta.selectionEnd);
  const activeTags = new Set(detectOuterLayers(before, after).map(l => l.tag));

  stylePopoverElement
    .querySelectorAll<HTMLElement>('.dmna-style-btn[data-tag]')
    .forEach(el => {
      const tag = el.dataset.tag;
      el.classList.toggle('is-active', !!tag && activeTags.has(tag));
    });
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
  // Refresh active highlights + per-button disabled state from the
  // current textarea selection — without this the popover would open
  // showing stale state from the previous selection.
  refreshStylePopoverState();
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
