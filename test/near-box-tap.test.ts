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

import {
  MIN_BOX_SIZE_DISPLAY,
  MIN_BOX_SIZE_IMG,
  NEAR_BOX_AMBIGUITY_PX,
  NEAR_BOX_TAP_RADIUS,
  NOTE_CHOOSER_MAX_ITEMS,
} from '../src/config';
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
import {hideNoteChooser, noteSnippet} from '../src/ui/note-chooser';

// Image shown at half size: 1 display px = 2 image px.
const NARROW: NoteState = {x: 400, y: 400, w: 20, h: 600, text: 'narrow'};
const NARROW_ID = asServerNoteId('7');

function hooks(): NotesStoreHooks {
  return {
    // Mirrors main.ts: any selection change drops the hint and chooser.
    onActiveChanged: vi.fn(() => {
      hideCreateHint();
      hideNoteChooser();
    }),
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
    domElement: document.createElement('div'),
  });
}

function tapImage(x: number, y: number): void {
  imgEl.current!.dispatchEvent(
    new MouseEvent('click', {clientX: x, clientY: y, bubbles: true}),
  );
}

const hint = () => document.getElementById('dmna-create-hint');
const hintTarget = () =>
  hint()!.querySelector<HTMLElement>('.dmna-create-hint-target')!;
const hintShown = () => !!hint() && !hint()!.hidden;
const chooser = () => document.getElementById('dmna-note-chooser');
const chooserShown = () => !!chooser() && !chooser()!.hidden;
const rows = () => [
  ...chooser()!.querySelectorAll<HTMLElement>(
    '.dmna-chooser-item:not(.dmna-chooser-new)',
  ),
];
const rowTexts = () =>
  rows().map(r => r.querySelector('.dmna-chooser-text')!.textContent);
const newRow = () =>
  chooser()!.querySelector<HTMLElement>('.dmna-chooser-new')!;
const boxEl = (id: NoteId) => notes.get(id)!.domElement!;

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
  hideNoteChooser();
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

  it('picks the clearly nearer of two boxes in range', () => {
    const other = asServerNoteId('8');
    // On screen: x 230–330, y 200–500. The gap to NARROW is 20 px.
    addServerNote(other, {x: 460, y: 400, w: 200, h: 600, text: 'other'});

    // 16 px from NARROW, 4 px from the other: 12 px apart, not close.
    tapImage(210 + 16, 300);

    expect(getActiveNoteId()).toBe(other);
    expect(chooserShown()).toBe(false);
  });
});

describe('a tap about as close to two boxes', () => {
  const OTHER = asServerNoteId('8');

  beforeEach(() => {
    // On screen: x 230–330, y 200–500. The gap to NARROW is 20 px.
    addServerNote(OTHER, {
      x: 460,
      y: 400,
      w: 200,
      h: 600,
      text: '<b>Other</b>\nline two',
    });
  });

  it('asks instead of guessing: nothing is selected, the chooser lists both', () => {
    // 11 px from NARROW, 9 px from the other.
    tapImage(210 + 11, 300);

    expect(getActiveNoteId()).toBeNull();
    expect(notes.size).toBe(2);
    expect(chooserShown()).toBe(true);
    // The dashed outline shows where "New note here" would put the box.
    expect(hintShown()).toBe(true);
    const el = hint()!;
    expect(
      parseFloat(el.style.left) + parseFloat(el.style.width) / 2,
    ).toBeCloseTo(221, 0);
    // Nearest first, then the row that creates a new note.
    expect(rowTexts()).toEqual(['Other line two', 'narrow']);
    expect(newRow().textContent).toContain('New note here');
  });

  it('is ambiguous up to the configured gap and not past it', () => {
    // Distances 10 + g/2 and 10 - g/2 from the two boxes.
    const half = NEAR_BOX_AMBIGUITY_PX / 2;
    tapImage(220 + half, 300);
    expect(chooserShown()).toBe(true);

    hideNoteChooser();
    tapImage(220 + half + 1, 300);
    expect(chooserShown()).toBe(false);
    expect(getActiveNoteId()).toBe(OTHER);
  });

  it('first tap on a row marks its box, second tap opens it', () => {
    tapImage(221, 300);
    const [otherRow, narrowRow] = rows();

    narrowRow.click();
    expect(getActiveNoteId()).toBeNull();
    expect(chooserShown()).toBe(true);
    expect(narrowRow.classList.contains('is-picked')).toBe(true);
    expect(boxEl(NARROW_ID).classList.contains('is-chooser-pick')).toBe(true);

    // Picking another row moves the mark.
    otherRow.click();
    expect(boxEl(NARROW_ID).classList.contains('is-chooser-pick')).toBe(false);
    expect(boxEl(OTHER).classList.contains('is-chooser-pick')).toBe(true);
    expect(getActiveNoteId()).toBeNull();

    otherRow.click();
    expect(getActiveNoteId()).toBe(OTHER);
    expect(chooserShown()).toBe(false);
    expect(boxEl(OTHER).classList.contains('is-chooser-pick')).toBe(false);
  });

  it('"New note here" creates the box where the tap landed', () => {
    tapImage(221, 300);
    newRow().click();

    expect(notes.size).toBe(3);
    const s = notes.get(getActiveNoteId()!)!.current;
    expect(s.x + s.w / 2).toBeCloseTo(442, 0);
    expect(s.y + s.h / 2).toBeCloseTo(600, 0);
    expect(chooserShown()).toBe(false);
  });

  it('the "+" on the outline creates too, like "New note here"', () => {
    tapImage(221, 300);
    hintTarget().click();

    expect(notes.size).toBe(3);
    expect(getActiveNoteId()).not.toBeNull();
    expect(chooserShown()).toBe(false);
    expect(hintShown()).toBe(false);
  });

  it('picking a note from the list leaves no outline behind', () => {
    tapImage(221, 300);
    const row = rows()[0];
    row.click();
    expect(hintShown()).toBe(true);
    row.click();
    expect(getActiveNoteId()).toBe(OTHER);
    expect(hintShown()).toBe(false);
  });

  it('a tap outside closes it without selecting or creating', () => {
    tapImage(221, 300);
    tapImage(700, 900);

    expect(hintShown()).toBe(false);
    expect(chooserShown()).toBe(false);
    expect(getActiveNoteId()).toBeNull();
    expect(notes.size).toBe(2);
  });

  it('lists at most the configured number of notes, nearest first', () => {
    // A column of small boxes right of the tap, each 1 px farther.
    for (let i = 0; i < NOTE_CHOOSER_MAX_ITEMS + 3; i++) {
      addServerNote(asServerNoteId(String(100 + i)), {
        x: 2 * (232 + i),
        y: 2 * (280 + i * 4),
        w: 4,
        h: 4,
        text: `n${i}`,
      });
    }
    tapImage(221, 300);
    expect(rows().length).toBe(NOTE_CHOOSER_MAX_ITEMS);
  });
});

describe('noteSnippet', () => {
  it('drops markup and folds whitespace', () => {
    expect(
      noteSnippet('<b>Hi</b>\n\n<span style="color: red">there</span>'),
    ).toBe('Hi there');
  });

  it('labels a note with no text', () => {
    expect(noteSnippet('  ')).toBe('(empty)');
    expect(noteSnippet('<br>')).toBe('(empty)');
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
    hintTarget().click();

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

    hintTarget().click();

    expect(notes.size).toBe(1);
    expect(getActiveNoteId()).toBe(NARROW_ID);
    expect(hintShown()).toBe(true);
  });
});

describe('the hint outline itself', () => {
  it('is not a tap target: only the "+" inside it creates', () => {
    tapImage(218, 300);
    hint()!.click();
    expect(notes.size).toBe(1);
    expect(getActiveNoteId()).toBe(NARROW_ID);
    expect(hintTarget().getAttribute('role')).toBe('button');
    expect(hintTarget().textContent).toBe('+');
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

describe('the default new box keeps its on-screen size under pinch zoom', () => {
  function setZoom(scale: number | null): void {
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value:
        scale === null
          ? undefined
          : {
              scale,
              width: 400 / scale,
              height: 800 / scale,
              offsetLeft: 0,
              offsetTop: 0,
              pageLeft: 0,
              pageTop: 0,
            },
    });
  }

  function createdAt(x: number, y: number): NoteState {
    tapImage(x, y);
    const id = getActiveNoteId()!;
    expect(id).not.toBe(NARROW_ID);
    return notes.get(id)!.current;
  }

  afterEach(() => {
    setZoom(null);
  });

  // The image is 1000 px wide on the page: the default box is 100 page
  // px, which is 200 image px.
  it('is 10% of the shorter side with no zoom', () => {
    const s = createdAt(700, 900);
    expect(s.w).toBeCloseTo(200, 5);
    expect(s.h).toBeCloseTo(200, 5);
  });

  it('is a fifth of that at 5x, still centered on the tap', () => {
    setZoom(5);
    const s = createdAt(700, 900);
    expect(s.w).toBeCloseTo(40, 5);
    expect(s.h).toBeCloseTo(40, 5);
    expect(s.x + s.w / 2).toBeCloseTo(1400, 5);
    expect(s.y + s.h / 2).toBeCloseTo(1800, 5);
  });

  it('is never smaller than the resize floor, so a first resize does not jump', () => {
    // A phone-width image: 10% of the shorter side is 39.3 px, below
    // the 48 px resize floor.
    const img = imgEl.current!;
    const original = img.getBoundingClientRect;
    img.getBoundingClientRect = () =>
      ({left: 0, top: 0, width: 393, height: 550}) as DOMRect;
    try {
      const s = createdAt(200, 300);
      // 48 page px at 393 / 2000 page px per image px.
      expect(s.w).toBeCloseTo((MIN_BOX_SIZE_DISPLAY * 2000) / 393, 5);

      setZoom(4);
      hideCreateHint();
      setActiveNote(null);
      const z = createdAt(100, 100);
      expect(z.w).toBeCloseTo((MIN_BOX_SIZE_DISPLAY / 4) * (2000 / 393), 5);
    } finally {
      img.getBoundingClientRect = original;
    }
  });

  it('never goes below the smallest box the image allows', () => {
    setZoom(100);
    const s = createdAt(700, 900);
    expect(s.w).toBeCloseTo(MIN_BOX_SIZE_IMG, 5);
    expect(s.h).toBeCloseTo(MIN_BOX_SIZE_IMG, 5);
  });

  it('sizes the create hint the same way', () => {
    setZoom(5);
    tapImage(210 + 2, 300);
    expect(getActiveNoteId()).toBe(NARROW_ID);
    expect(parseFloat(hint()!.style.width)).toBeCloseTo(20, 5);
  });
});
