/**
 * Confirm-time tag popover (v3.0 Phase 4 D9) — surfaces the four
 * translation-status TAG_OPTIONS as toggle switches and resolves a
 * Promise with the add/remove delta on Submit (or null on Cancel).
 *
 * Layer 3 (ui). Module-private state owns:
 *   - the lazily-built popover DOM (`tagPopoverElement`)
 *   - `tagPopoverInitialTags`: the tags the post had at open time
 *     (snapshot used to compute the delta at submit)
 *   - `tagPopoverState`: the live working state of the four toggles
 *     (mutated through `applyTagConstraints` so the four rules stay
 *     invariant across every click)
 *   - `pendingTagPopoverResolver`: the in-flight Promise's resolve
 *     function — null when no popover is open
 *
 * Public surface:
 *   - `showTagPopover()` — Promise wrapper. Fetches the post's
 *     current tag_string, opens the popover with toggles pre-set
 *     per existing tags, waits for the user. Wired into
 *     `confirm/batch.ConfirmFlowHooks.showTagPopover` by main.ts.
 *   - `updateTagPopoverPosition()` — re-pin to the LEFT of the
 *     floating button (anchored to its position via
 *     `floating-button.getButtonMargins`). Called by main.ts's
 *     viewport-update orchestrator on pinch zoom / scroll / resize.
 *
 * Toggle constraint rules (PLAN.md D9):
 *   1. `translated` is exclusive — turning it on flips the other
 *      three off.
 *   2. Any non-`translated` tag turning on flips `translated` off.
 *   3. `check_translation` or `partially_translated` turning on
 *      forces `translation_request` on (and locks it on).
 *   4. Turning `c_t` / `p_t` off does NOT auto-unlock `t_r` — it
 *      stays on until the user explicitly turns it off.
 */

import {
  TAG_LABELS,
  TAG_OPTIONS,
  TAG_POPOVER_GAP,
  TAG_POPOVER_WIDTH,
  BTN_SIZE,
} from '../config';
import {TagDelta} from '../types';
import {fetchPostTagString} from '../api/posts';
import {getButtonMargins} from './floating-button';
import {showToast} from './toast';

// ---------------------------------------------------------------------------
// Module-private state
// ---------------------------------------------------------------------------

let tagPopoverElement: HTMLElement | null = null;
let tagPopoverInitialTags: Set<string> | null = null;
let tagPopoverState: Record<string, boolean> | null = null;
let pendingTagPopoverResolver: ((result: TagDelta | null) => void) | null =
  null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Phase 4 D9 entry point: fetches the post's current `tag_string`,
 * opens the popover with toggles pre-set per existing tags, waits
 * for the user. Resolves with the add/remove delta on Submit or
 * `null` on Cancel.
 *
 * Tag-string fetch failure → resolves to `null` after a toast.
 * `runConfirmFlow` treats `null` as user-cancel and aborts the entire
 * send, which is the correct UX when the network's down: opening the
 * popover with all toggles OFF (v3.1.1's behavior) was misleading
 * because the user couldn't see their existing tag state, and any
 * downstream PATCH would also fail. Abort + toast + stay in active
 * mode is cleaner.
 */
export async function showTagPopover(): Promise<TagDelta | null> {
  let tagString: string;
  try {
    tagString = await fetchPostTagString();
  } catch (err) {
    showToast('⚠️ Failed to load post tags', 'error', err);
    return null;
  }
  const initialTags = new Set(
    tagString.split(/\s+/).filter(t => TAG_OPTIONS.includes(t)),
  );
  return new Promise<TagDelta | null>(resolve => {
    // Defensive: if a previous popover somehow stayed open, cancel
    // it before opening a new one.
    if (pendingTagPopoverResolver) {
      const stale = pendingTagPopoverResolver;
      pendingTagPopoverResolver = null;
      stale(null);
    }
    pendingTagPopoverResolver = resolve;
    openTagPopover(initialTags);
  });
}

/**
 * Re-projects the tag popover to the LEFT of the floating button,
 * with its bottom edge aligned to the button's bottom edge so the
 * popover extends UPWARD. The arrow (CSS-positioned at popover's
 * bottom-right with `bottom:12px`) lines up with the button's
 * vertical center. Called on open and every visualViewport change
 * so the popover follows the floating button under pinch zoom /
 * scroll.
 *
 * Bottom-anchoring (vs. vertical-centering on the button) is what
 * keeps the popover's Submit/Cancel row visible: with the floating
 * button typically near the bottom of the viewport, a centered
 * popover overflows below the fold.
 */
export function updateTagPopoverPosition(): void {
  if (!tagPopoverElement) {
    return;
  }
  const vv = window.visualViewport;
  const scale = vv ? vv.scale : 1;
  const invScale = 1 / scale;
  const vvWidth = vv ? vv.width : window.innerWidth;
  const vvHeight = vv ? vv.height : window.innerHeight;
  const vvPageLeft = vv ? vv.pageLeft : window.pageXOffset;
  const vvPageTop = vv ? vv.pageTop : window.pageYOffset;

  const {marginX, marginY} = getButtonMargins();

  // Floating button center in viewport CSS pixels (counter-scaled).
  const btnCenterX = vvWidth - (marginX + BTN_SIZE / 2) * invScale;
  const btnCenterY = vvHeight - (marginY + BTN_SIZE / 2) * invScale;

  // Horizontal: arrow tip sits TAG_POPOVER_GAP visual pixels left of
  // the floating button's left edge. Popover extends left from there.
  // Vertical: popover bottom = button bottom; popover extends up.
  const btnVisualHalf = (BTN_SIZE / 2) * invScale;
  const arrowW = 8; // CSS px (intrinsic, scaled by invScale visually)
  const popW = TAG_POPOVER_WIDTH;
  const popH = tagPopoverElement.offsetHeight;
  const arrowTipX = btnCenterX - btnVisualHalf - TAG_POPOVER_GAP * invScale;
  const popoverRightX = arrowTipX - arrowW * invScale;
  const popoverLeftX = popoverRightX - popW * invScale;
  const popoverBottomY = btnCenterY + btnVisualHalf;
  const popoverTopY = popoverBottomY - popH * invScale;

  // transform-origin is 0 0; convert viewport coords to page coords.
  const tx = vvPageLeft + popoverLeftX;
  const ty = vvPageTop + popoverTopY;
  tagPopoverElement.style.transform = `translate(${tx}px, ${ty}px) scale(${invScale})`;
}

// ---------------------------------------------------------------------------
// Constraint logic (private — pure helpers)
// ---------------------------------------------------------------------------

/**
 * Applies the four constraint rules when a single toggle changes.
 * Pure: returns a new state object, doesn't mutate the input.
 *
 * Exported for unit tests; module-internal otherwise.
 */
export function applyTagConstraints(
  state: Record<string, boolean>,
  changedTag: string,
  newValue: boolean,
): Record<string, boolean> {
  const next = {...state};
  next[changedTag] = newValue;
  if (newValue) {
    // Turning ON.
    if (changedTag === 'translated') {
      // Rule 1: translated is exclusive — all others OFF.
      next.translation_request = false;
      next.check_translation = false;
      next.partially_translated = false;
    } else {
      // Rule 2: any non-translated tag ON → translated OFF.
      next.translated = false;
      // Rule 3: c_t / p_t turning ON forces t_r ON.
      if (
        changedTag === 'check_translation' ||
        changedTag === 'partially_translated'
      ) {
        next.translation_request = true;
      }
    }
  } else {
    // Turning OFF.
    if (
      changedTag === 'translation_request' &&
      (next.check_translation || next.partially_translated)
    ) {
      // Rule 3 lock: t_r can't go OFF while c_t or p_t is ON.
      next.translation_request = true;
    }
    // Other tags: just turn off, no implications. Rule 4 — turning
    // c_t/p_t off doesn't force t_r off (it stays ON unless the user
    // explicitly turns it off later).
  }
  return next;
}

/**
 * Whether a toggle should be `disabled` (visually + non-interactive).
 * Currently only `translation_request` locks (rule 3); the other
 * three are always toggleable.
 *
 * Exported for unit tests; module-internal otherwise.
 */
export function isTagToggleDisabled(
  state: Record<string, boolean>,
  tag: string,
): boolean {
  if (tag === 'translation_request') {
    return state.check_translation || state.partially_translated;
  }
  return false;
}

/**
 * Re-applies `tagPopoverState` to each toggle's class + disabled
 * attribute. Called after every click and on initial open.
 */
function renderTagToggles(): void {
  if (!tagPopoverElement || !tagPopoverState) {
    return;
  }
  const state = tagPopoverState;
  TAG_OPTIONS.forEach(tag => {
    const row = tagPopoverElement!.querySelector(
      `.dmna-tag-row[data-tag="${tag}"]`,
    );
    if (!(row instanceof HTMLElement)) {
      return;
    }
    const switchBtn = row.querySelector('.dmna-tag-switch-btn');
    const disabled = isTagToggleDisabled(state, tag);
    row.classList.toggle('is-on', !!state[tag]);
    row.classList.toggle('is-disabled', disabled);
    if (switchBtn instanceof HTMLButtonElement) {
      switchBtn.disabled = disabled;
    }
  });
}

// ---------------------------------------------------------------------------
// DOM build / open / close (private)
// ---------------------------------------------------------------------------

/**
 * Builds the tag popover DOM (idempotent). Toggle click handlers
 * run `applyTagConstraints` and re-render. Submit/Cancel call
 * `submitTagPopover`.
 */
function createTagPopover(): void {
  if (tagPopoverElement) {
    return;
  }
  const root = document.createElement('div');
  root.id = 'dmna-tag-popover';
  // Stop click bubbling so a tap inside the popover doesn't reach
  // the document-level outside-click handlers (defensive — none of
  // ours fire in this state, but the active-note popover's pattern
  // is the same).
  root.addEventListener('click', e => {
    e.stopPropagation();
  });

  const arrow = document.createElement('div');
  arrow.id = 'dmna-tag-popover-arrow';
  root.appendChild(arrow);

  const header = document.createElement('div');
  header.className = 'dmna-tag-popover-header';
  header.textContent = 'Translation tags';
  root.appendChild(header);

  const list = document.createElement('div');
  list.id = 'dmna-tag-popover-toggles';
  TAG_OPTIONS.forEach(tag => {
    const row = document.createElement('div');
    row.className = 'dmna-tag-row';
    row.dataset.tag = tag;

    const label = document.createElement('span');
    label.className = 'dmna-tag-label';
    label.textContent = TAG_LABELS[tag];
    row.appendChild(label);

    const switchBtn = document.createElement('button');
    switchBtn.type = 'button';
    switchBtn.className = 'dmna-tag-switch-btn';
    switchBtn.dataset.tag = tag;

    const sw = document.createElement('span');
    sw.className = 'dmna-tag-switch';
    const thumb = document.createElement('span');
    thumb.className = 'dmna-tag-switch-thumb';
    sw.appendChild(thumb);
    switchBtn.appendChild(sw);
    row.appendChild(switchBtn);

    switchBtn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      if (switchBtn.disabled || !tagPopoverState) {
        return;
      }
      const currentlyOn = !!tagPopoverState[tag];
      tagPopoverState = applyTagConstraints(tagPopoverState, tag, !currentlyOn);
      renderTagToggles();
    });
    list.appendChild(row);
  });
  root.appendChild(list);

  const buttons = document.createElement('div');
  buttons.id = 'dmna-tag-popover-buttons';
  // Danbooru convention: primary action (Submit) before Cancel
  // (`reference_danbooru_dialog_button_order`).
  const submitBtn = document.createElement('button');
  submitBtn.type = 'button';
  submitBtn.className = 'dmna-tag-popover-btn';
  submitBtn.dataset.action = 'submit';
  submitBtn.textContent = 'Submit';
  submitBtn.addEventListener('click', () => submitTagPopover(false));

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'dmna-tag-popover-btn';
  cancelBtn.dataset.action = 'cancel';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => submitTagPopover(true));

  buttons.appendChild(submitBtn);
  buttons.appendChild(cancelBtn);
  root.appendChild(buttons);

  document.body.appendChild(root);
  tagPopoverElement = root;
}

/**
 * Reveals the tag popover with the given initial-on tags. Pre-
 * positions with `visibility: hidden` so the user never sees a
 * one-frame flash at the popover's stale transform (same trick the
 * active-note popover uses on first show).
 */
function openTagPopover(initialTags: Set<string>): void {
  createTagPopover();
  if (!tagPopoverElement) {
    return;
  }
  tagPopoverInitialTags = initialTags;
  const initState: Record<string, boolean> = {};
  TAG_OPTIONS.forEach(t => {
    initState[t] = initialTags.has(t);
  });
  // Self-heal a rule-3 violation in the loaded state: if c_t or p_t
  // is ON but t_r is OFF (e.g., another editor stripped t_r), pull
  // t_r back ON. The user sees it locked-on; submitting then adds
  // t_r to the server tag_string.
  if (initState.check_translation || initState.partially_translated) {
    initState.translation_request = true;
  }
  tagPopoverState = initState;
  renderTagToggles();
  document.body.classList.add('dmna-tag-popover-open');
  // Pre-position trick: render hidden, measure, position, then
  // reveal.
  tagPopoverElement.style.visibility = 'hidden';
  tagPopoverElement.classList.add('show');
  updateTagPopoverPosition();
  tagPopoverElement.style.visibility = '';
  document.addEventListener('keydown', tagPopoverKeyHandler, true);
}

/**
 * Hides the tag popover without destroying it. Keeps the singleton
 * for the next Confirm.
 */
function closeTagPopover(): void {
  document.body.classList.remove('dmna-tag-popover-open');
  if (tagPopoverElement) {
    tagPopoverElement.classList.remove('show');
  }
  document.removeEventListener('keydown', tagPopoverKeyHandler, true);
  tagPopoverInitialTags = null;
  tagPopoverState = null;
}

/**
 * Resolves the in-flight `showTagPopover()` promise:
 *   - canceled=true  → null (caller aborts the Confirm flow)
 *   - canceled=false → {tagsToAdd, tagsToRemove} delta.
 */
function submitTagPopover(canceled: boolean): void {
  const resolver = pendingTagPopoverResolver;
  if (!resolver) {
    return;
  }
  if (canceled) {
    pendingTagPopoverResolver = null;
    closeTagPopover();
    resolver(null);
    return;
  }
  const initial = tagPopoverInitialTags || new Set<string>();
  const state = tagPopoverState || {};
  const tagsToAdd: string[] = [];
  const tagsToRemove: string[] = [];
  TAG_OPTIONS.forEach(tag => {
    const wasOn = initial.has(tag);
    const isOn = !!state[tag];
    if (isOn && !wasOn) {
      tagsToAdd.push(tag);
    } else if (!isOn && wasOn) {
      tagsToRemove.push(tag);
    }
  });
  pendingTagPopoverResolver = null;
  closeTagPopover();
  resolver({tagsToAdd, tagsToRemove});
}

/**
 * PC keyboard shortcuts inside the tag popover. Capture-phase so it
 * preempts any other Esc handler (e.g., the active-note popover's
 * dismiss path, though those don't co-exist with this modal).
 */
function tagPopoverKeyHandler(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    submitTagPopover(true);
  } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    e.stopPropagation();
    submitTagPopover(false);
  }
}
