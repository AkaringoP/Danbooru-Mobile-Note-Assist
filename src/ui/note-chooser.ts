/**
 * Note chooser (Layer 3 — ui).
 *
 * When a tap on the image is about as close to two or more boxes
 * (`NEAR_BOX_AMBIGUITY_PX`), `interactions/image-pointer` doesn't
 * guess: it opens this list of the nearby notes, nearest first, with
 * each note's text.
 *
 * A row takes two taps. The first marks the row and its box
 * (`.is-chooser-pick`) so the user can see which note the text
 * belongs to; the second opens that note's popover. The last row
 * creates the new box the tap would otherwise have made; the create
 * hint is shown with the list so the user can see where that is, and
 * its "+" works as well.
 *
 * The panel docks to the far edge of the screen from the tap so it
 * never covers the boxes it lists, and is counter-scaled like the
 * toast. `main.ts` hides it on any selection or mode change.
 */

import {NoteId, Rect} from '../types';
import {notes, setActiveNote} from '../state/notes-store';
import {createNoteAt, hideCreateHint, showCreateHint} from './create-hint';

const MARGIN = 16;

let panel: HTMLElement | null = null;
let listElement: HTMLElement | null = null;
let shown = false;
let dockTop = false;
let pickedId: NoteId | null = null;
let createRect: Rect | null = null;

export function isNoteChooserShown(): boolean {
  return shown;
}

/** A note's text as one plain line: markup dropped, whitespace folded. */
export function noteSnippet(text: string): string {
  const plain = text
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain || '(empty)';
}

/**
 * Lists `candidates` (nearest first). `rect` is the new box the tap
 * would have made (image px); `tapClientY` picks the dock edge.
 */
export function showNoteChooser(
  candidates: NoteId[],
  rect: Rect,
  tapClientY: number,
): void {
  ensurePanel();
  setPicked(null);
  createRect = rect;
  const vv = window.visualViewport;
  dockTop = vv
    ? tapClientY - vv.offsetTop > vv.height / 2
    : tapClientY > window.innerHeight / 2;
  listElement!.replaceChildren(...candidates.map(buildNoteRow), buildNewRow());
  panel!.hidden = false;
  shown = true;
  updateNoteChooserPosition();
  showCreateHint(rect);
}

export function hideNoteChooser(): void {
  if (!shown) {
    return;
  }
  setPicked(null);
  createRect = null;
  shown = false;
  panel!.hidden = true;
  hideCreateHint();
}

/** Keeps the panel docked and at a constant on-screen size. */
export function updateNoteChooserPosition(): void {
  if (!panel || !shown) {
    return;
  }
  const vv = window.visualViewport;
  const inv = vv ? 1 / vv.scale : 1;
  const left = vv ? vv.pageLeft : window.pageXOffset;
  const top = vv ? vv.pageTop : window.pageYOffset;
  const width = vv ? vv.width : window.innerWidth;
  const height = vv ? vv.height : window.innerHeight;
  const x = left + width / 2;
  const y = dockTop ? top + MARGIN * inv : top + height - MARGIN * inv;
  panel.style.transform =
    `translate(${x}px, ${y}px) scale(${inv}) ` +
    `translate(-50%, ${dockTop ? '0' : '-100%'})`;
}

function ensurePanel(): void {
  if (panel) {
    return;
  }
  panel = document.createElement('div');
  panel.id = 'dmna-note-chooser';
  panel.hidden = true;
  const title = document.createElement('div');
  title.className = 'dmna-chooser-title';
  title.textContent = 'Which note? Tap one to see it, again to edit';
  listElement = document.createElement('div');
  listElement.className = 'dmna-chooser-list';
  panel.append(title, listElement);
  document.body.appendChild(panel);
  // Capture phase, so an outside tap closes the list before the image
  // handler could read it as a new near-miss. A tap on a box goes
  // through (the box selects itself), and so does one on the create
  // hint's "+".
  document.addEventListener('click', onDocumentClick, true);
}

function onDocumentClick(e: MouseEvent): void {
  if (!shown || !(e.target instanceof Node) || panel!.contains(e.target)) {
    return;
  }
  if (e.target instanceof Element && e.target.closest('#dmna-create-hint')) {
    return;
  }
  const onBox =
    e.target instanceof Element && e.target.closest('.dmna-note-box');
  hideNoteChooser();
  if (!onBox) {
    e.preventDefault();
    e.stopPropagation();
  }
}

function buildRow(className: string): HTMLElement {
  const row = document.createElement('div');
  row.className = className;
  row.setAttribute('role', 'button');
  return row;
}

function buildNoteRow(id: NoteId): HTMLElement {
  const note = notes.get(id);
  const row = buildRow('dmna-chooser-item');
  const dot = document.createElement('span');
  dot.className = 'dmna-chooser-dot';
  if (note?.isDeleted) {
    dot.classList.add('is-deleted');
  } else if (!note?.isServerNote) {
    dot.classList.add('is-new');
  }
  const text = document.createElement('span');
  text.className = 'dmna-chooser-text';
  text.textContent = noteSnippet(note?.current.text ?? '');
  const again = document.createElement('span');
  again.className = 'dmna-chooser-again';
  again.textContent = 'Tap again to edit';
  row.append(dot, text, again);
  row.addEventListener('click', () => {
    if (pickedId !== id) {
      setPicked(id, row);
      return;
    }
    hideNoteChooser();
    setActiveNote(id);
  });
  return row;
}

function buildNewRow(): HTMLElement {
  const row = buildRow('dmna-chooser-item dmna-chooser-new');
  row.textContent = '+ New note here';
  row.addEventListener('click', () => {
    const rect = createRect;
    hideNoteChooser();
    if (rect) {
      createNoteAt(rect);
    }
  });
  return row;
}

function setPicked(id: NoteId | null, row?: HTMLElement): void {
  if (pickedId !== null) {
    notes.get(pickedId)?.domElement?.classList.remove('is-chooser-pick');
  }
  listElement
    ?.querySelectorAll('.is-picked')
    .forEach(el => el.classList.remove('is-picked'));
  pickedId = id;
  if (id !== null) {
    notes.get(id)?.domElement?.classList.add('is-chooser-pick');
    row?.classList.add('is-picked');
  }
}
