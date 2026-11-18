/**
 * A tap that just misses a box selects that box and leaves a dashed
 * "create here" hint at the tap point; tapping the hint creates the
 * new box after all.
 * vitest globals: describe/it/expect/beforeEach/afterEach/vi.
 */

const imgEl = vi.hoisted(() => ({current: null as HTMLImageElement | null}));

vi.mock('../src/utils/dom', () => ({
  getImageElement: () => imgEl.current,
}));
vi.mock('../src/state/image-state', () => ({
  getOriginalWidth: () => 2000,
  getOriginalHeight: () => 2800,
  getPostMetaPromise: () => null,
}));
vi.mock('../src/ui/note-box', () => ({updateAllNoteBoxPositions: vi.fn()}));
vi.mock('../src/ui/popover', () => ({
  dismissActivePopover: vi.fn(),
  focusActiveNoteInput: vi.fn(),
}));
vi.mock('../src/ui/toast', () => ({showToast: vi.fn()}));
vi.mock('../src/api/posts', () => ({
  fetchPostMeta: vi.fn(() => Promise.resolve({width: 2000, height: 2800})),
}));
vi.mock('../src/api/notes', () => ({
  fetchServerNotes: vi.fn(() => Promise.resolve([])),
}));

import {NEAR_BOX_TAP_RADIUS} from '../src/config';
import {bindImageHandlers} from '../src/interactions/image-pointer';
import {
  NotesStoreHooks,
  actionLog,
  getActiveNoteId,
  initNotesStore,
  notes,
  setActiveNote,
  setMode,
} from '../src/state/notes-store';
import {NoteId, NoteState, asServerNoteId} from '../src/types';
import {hideCreateHint} from '../src/ui/create-hint';

// Image shown at half size: 1 display px = 2 image px.
const NARROW: NoteState = {x: 400, y: 400, w: 20, h: 600, text: 'narrow'};
const NARROW_ID = asServerNoteId('7');

function hooks(): NotesStoreHooks {
  return {
    // Mirrors main.ts: any selection change drops the hint.
    onActiveChanged: vi.fn(() => hideCreateHint()),
    onNoteRenderRequested: vi.fn(),
    onNoteVisualsChanged: vi.fn(),
    onNoteRemoved: vi.fn(),
    onModeChanged: vi.fn(),
    onToast: vi.fn(),
    onReopenMenuRequested: vi.fn(),
    hasPendingChanges: vi.fn(() => false),
    onTextUndo: vi.fn(),
    onNotesAdded: vi.fn(),
  };
}

function addServerNote(id: NoteId, state: NoteState): void {
  notes.set(id, {
    current: {...state},
    initialState: {...state},
    confirmedState: {...state},
    isDeleted: false,
    isServerNote: true,
    everConfirmed: false,
    domElement: null,
  });
}

function tapImage(x: number, y: number): void {
  imgEl.current!.dispatchEvent(
    new MouseEvent('click', {clientX: x, clientY: y, bubbles: true}),
  );
}

const hint = () => document.getElementById('dmna-create-hint');
const hintShown = () => !!hint() && !hint()!.hidden;

let storeHooks: NotesStoreHooks;

beforeAll(() => {
  const img = document.createElement('img');
  img.getBoundingClientRect = () =>
    ({left: 0, top: 0, width: 1000, height: 1400}) as DOMRect;
  document.body.appendChild(img);
  imgEl.current = img;
  bindImageHandlers();
});

beforeEach(() => {
  notes.clear();
  actionLog.clear();
  storeHooks = hooks();
  initNotesStore(storeHooks);
  setActiveNote(null);
  setMode('active');
  hideCreateHint();
  // NARROW on screen: x 200–210, y 200–500.
  addServerNote(NARROW_ID, NARROW);
});

afterEach(() => {
  setMode('idle');
});

describe('a tap just outside a box', () => {
  it('selects that box instead of creating one, and shows the hint at the tap', () => {
    tapImage(210 + 8, 300);

    expect(notes.size).toBe(1);
    expect(getActiveNoteId()).toBe(NARROW_ID);
    expect(hintShown()).toBe(true);
    const el = hint()!;
    const w = parseFloat(el.style.width);
    expect(parseFloat(el.style.left) + w / 2).toBeCloseTo(218, 0);
    expect(
      parseFloat(el.style.top) + parseFloat(el.style.height) / 2,
    ).toBeCloseTo(300, 0);
  });

  it('counts diagonal distance from the nearest edge', () => {
    const inside = Math.floor(NEAR_BOX_TAP_RADIUS / Math.SQRT2) - 1;
    tapImage(210 + inside, 200 - inside);
    expect(getActiveNoteId()).toBe(NARROW_ID);
  });

  it('picks the nearest of two boxes in range', () => {
    const other = asServerNoteId('8');
    // On screen: x 230–330, y 200–500. The gap to NARROW is 20 px.
    addServerNote(other, {x: 460, y: 400, w: 200, h: 600, text: 'other'});

    tapImage(210 + 14, 300);

    expect(getActiveNoteId()).toBe(other);
  });
});

describe('a tap away from every box', () => {
  it('creates a new box right away, with no hint', () => {
    tapImage(210 + NEAR_BOX_TAP_RADIUS + 5, 300);

    expect(notes.size).toBe(2);
    expect(getActiveNoteId()).not.toBe(NARROW_ID);
    expect(hintShown()).toBe(false);
  });
});

describe('tapping the hint', () => {
  it('creates the new box where the first tap landed', () => {
    tapImage(218, 300);
    hint()!.click();

    expect(notes.size).toBe(2);
    const id = getActiveNoteId()!;
    expect(id).not.toBe(NARROW_ID);
    const s = notes.get(id)!.current;
    // Centered on the tap, in image px (display × 2).
    expect(s.x + s.w / 2).toBeCloseTo(436, 0);
    expect(s.y + s.h / 2).toBeCloseTo(600, 0);
    expect(s.text).toBe('');
    expect(hintShown()).toBe(false);
  });

  it('does nothing while the selected note is over the length limit', () => {
    tapImage(218, 300);
    notes.get(NARROW_ID)!.current.text = 'x'.repeat(5001);

    hint()!.click();

    expect(notes.size).toBe(1);
    expect(getActiveNoteId()).toBe(NARROW_ID);
    expect(hintShown()).toBe(true);
  });
});

describe('the hint goes away', () => {
  it('when the selection changes or clears', () => {
    tapImage(218, 300);
    expect(hintShown()).toBe(true);
    setActiveNote(null);
    expect(hintShown()).toBe(false);
  });
});
