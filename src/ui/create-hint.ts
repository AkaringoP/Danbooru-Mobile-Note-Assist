/**
 * "Create here" hint (Layer 3 — ui).
 *
 * A touch tap that lands just outside a box selects that box (boxes
 * can be ~10 px wide, see `NEAR_BOX_TAP_RADIUS`). The tap may still
 * have meant "new box here", so `interactions/image-pointer` leaves
 * this dashed outline where the new box would have gone; tapping the
 * "+" at its center creates that box after all.
 *
 * The outline never takes a tap and sits below every box. On a post
 * packed with small notes it overlaps several neighbors (5 on average
 * on post #9901204), and the default box is sized in layout px, so
 * under pinch zoom the outline covers much of the screen. Only the
 * "+" is a target, capped at 44 on-screen px.
 *
 * The rect is kept in image px like every note, so the outline stays
 * put under resize. `main.ts` hides it on any selection change.
 */

import {Rect} from '../types';
import {getImageDisplayRect, imageToScreenRect} from '../utils/coords';
import {getImageElement} from '../utils/dom';
import {getInvScale} from '../utils/visual-viewport';
import {getOriginalWidth} from '../state/image-state';
import {
  createTempNote,
  getActiveNoteId,
  hardDeleteNote,
  setActiveNote,
} from '../state/notes-store';
import {focusActiveNoteInput} from './popover';

let hintElement: HTMLElement | null = null;
let hintRect: Rect | null = null;

/** Shows the hint over `rect` (image px). */
export function showCreateHint(rect: Rect): void {
  hintRect = rect;
  if (!hintElement) {
    const el = document.createElement('div');
    el.id = 'dmna-create-hint';
    const target = document.createElement('div');
    target.className = 'dmna-create-hint-target';
    target.setAttribute('role', 'button');
    target.setAttribute('aria-label', 'Create a new note here');
    target.title = 'Create a new note here';
    target.textContent = '+';
    target.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      createFromHint();
    });
    el.appendChild(target);
    document.body.appendChild(el);
    hintElement = el;
  }
  hintElement.hidden = false;
  updateCreateHintPosition();
}

export function hideCreateHint(): void {
  hintRect = null;
  if (hintElement) {
    hintElement.hidden = true;
  }
}

/** Re-projects the hint after the image moved, resized or was zoomed. */
export function updateCreateHintPosition(): void {
  if (!hintElement || !hintRect) {
    return;
  }
  const img = getImageElement();
  const imageRect = img ? getImageDisplayRect(img) : null;
  if (!imageRect) {
    hideCreateHint();
    return;
  }
  const r = imageToScreenRect(
    {...hintRect, text: ''},
    imageRect,
    getOriginalWidth(),
  );
  hintElement.style.left = `${r.left}px`;
  hintElement.style.top = `${r.top}px`;
  hintElement.style.width = `${r.width}px`;
  hintElement.style.height = `${r.height}px`;
  hintElement.style.setProperty('--dmna-hint-scale', String(getInvScale()));
}

function createFromHint(): void {
  if (!hintRect) {
    return;
  }
  const id = createTempNote({...hintRect, text: ''});
  // Leaves the selected note the way tapping another box does (a fresh
  // box is settled, edits stay). The switch is refused while that note
  // is over the length limit; then the new box is taken back.
  setActiveNote(id);
  if (getActiveNoteId() !== id) {
    hardDeleteNote(id);
    return;
  }
  requestAnimationFrame(() => focusActiveNoteInput(id));
}
