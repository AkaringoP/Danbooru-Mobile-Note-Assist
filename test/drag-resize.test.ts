/**
 * Unit tests for src/interactions/drag-resize.ts.
 * vitest globals: describe/it/expect/beforeEach/afterEach/vi.
 */

import {NoteState, asServerNoteId} from '../src/types';

const img = vi.hoisted(() => ({
  rectCalls: 0,
  rect: {left: 0, top: 0, width: 1000, height: 1400},
}));

vi.mock('../src/utils/dom', () => ({
  getImageElement: () => ({
    getBoundingClientRect: () => {
      img.rectCalls++;
      return {...img.rect, right: 0, bottom: 0, x: 0, y: 0, toJSON() {}};
    },
  }),
}));
vi.mock('../src/state/image-state', () => ({
  getOriginalWidth: () => 2000,
  getOriginalHeight: () => 2800,
}));
vi.mock('../src/ui/note-box', () => ({
  renderNoteBox: vi.fn(),
}));
vi.mock('../src/ui/popover', () => ({
  setPopoverInteracting: vi.fn(),
  updatePopoverPosition: vi.fn(),
}));
vi.mock('../src/api/posts', () => ({
  fetchPostMeta: vi.fn(() => Promise.resolve({width: 2000, height: 2800})),
}));
vi.mock('../src/api/notes', () => ({
  fetchServerNotes: vi.fn(() => Promise.resolve([])),
}));

import {
  attachBodyDragListener,
  attachHandleListeners,
} from '../src/interactions/drag-resize';
import {renderNoteBox} from '../src/ui/note-box';
import {updatePopoverPosition} from '../src/ui/popover';
import {
  NotesStoreHooks,
  actionLog,
  getActiveNoteId,
  initNotesStore,
  notes,
  setActiveNote,
  setMode,
} from '../src/state/notes-store';

const START: NoteState = {x: 100, y: 100, w: 200, h: 200, text: 'theirs'};
const ID = asServerNoteId('7');

function hooks(): NotesStoreHooks {
  return {
    onActiveChanged: vi.fn(),
    onNoteRenderRequested: vi.fn(),
    onNoteVisualsChanged: vi.fn(),
    onNoteRemoved: vi.fn(),
    onModeChanged: vi.fn(),
    onToast: vi.fn(),
    onReopenMenuRequested: vi.fn(),
    hasPendingChanges: vi.fn(() => false),
    onTextUndo: vi.fn(),
  };
}

function pointer(
  type: string,
  pointerType: string,
  x: number,
  y: number,
): PointerEvent {
  return new PointerEvent(type, {
    pointerType,
    pointerId: 1,
    button: 0,
    clientX: x,
    clientY: y,
    bubbles: true,
    cancelable: true,
  });
}

/** pointerdown at (50,50), `moves` steps of (+5,+5), pointerup. */
function drag(el: HTMLElement, pointerType: string, moves = 10): PointerEvent {
  const down = pointer('pointerdown', pointerType, 50, 50);
  el.dispatchEvent(down);
  for (let i = 1; i <= moves; i++) {
    el.dispatchEvent(
      pointer('pointermove', pointerType, 50 + i * 5, 50 + i * 5),
    );
  }
  el.dispatchEvent(
    pointer('pointerup', pointerType, 50 + moves * 5, 50 + moves * 5),
  );
  return down;
}

let el: HTMLElement;

beforeEach(() => {
  notes.clear();
  actionLog.clear();
  initNotesStore(hooks());
  setActiveNote(null);
  setMode('active');
  notes.set(ID, {
    current: {...START},
    initialState: {...START},
    confirmedState: {...START},
    isDeleted: false,
    isServerNote: true,
    everConfirmed: false,
    domElement: null,
  });
  el = document.createElement('div');
  document.body.appendChild(el);
  attachBodyDragListener(el, ID);
  img.rectCalls = 0;
});

afterEach(() => {
  el.remove();
  setMode('idle');
});

describe('body drag — touch only drags the selected box (Task 2.5)', () => {
  it('a touch swipe on an unselected box neither moves nor selects it', () => {
    const down = drag(el, 'touch');
    expect(notes.get(ID)!.current).toEqual(START);
    expect(actionLog.has(ID)).toBe(false);
    expect(getActiveNoteId()).toBeNull();
    expect(down.defaultPrevented).toBe(false);
  });

  it('a touch drag on the selected box moves it', () => {
    setActiveNote(ID);
    const down = drag(el, 'touch');
    expect(down.defaultPrevented).toBe(true);
    // 50 display px at 0.5 display px per image px = 100 image px.
    expect(notes.get(ID)!.current.x).toBe(200);
    expect(notes.get(ID)!.current.y).toBe(200);
    expect(actionLog.get(ID)!.map(e => e.type)).toEqual(['transform']);
  });

  it('a mouse drag selects and moves an unselected box (unchanged)', () => {
    drag(el, 'mouse');
    expect(getActiveNoteId()).toBe(ID);
    expect(notes.get(ID)!.current.x).toBe(200);
  });

  it('a soft-deleted box is never dragged', () => {
    notes.get(ID)!.isDeleted = true;
    setActiveNote(ID);
    drag(el, 'touch');
    drag(el, 'mouse');
    expect(notes.get(ID)!.current).toEqual(START);
  });
});

describe('drag reads the image rect once per gesture (Task 3.2)', () => {
  it('one getBoundingClientRect for the whole drag; render + popover reuse it', () => {
    setActiveNote(ID);
    drag(el, 'touch', 25);
    expect(img.rectCalls).toBe(1);
    const rect = {left: 0, top: 0, width: 1000, height: 1400};
    expect(vi.mocked(renderNoteBox)).toHaveBeenLastCalledWith(ID, rect);
    expect(vi.mocked(updatePopoverPosition)).toHaveBeenLastCalledWith(rect);
  });

  it('resize results are unchanged by the cache', () => {
    setActiveNote(ID);
    const handle = document.createElement('div');
    el.appendChild(handle);
    attachHandleListeners(handle, 'se', ID);
    drag(handle, 'touch', 10);
    // +50 display px → +100 image px on w and h.
    expect(notes.get(ID)!.current).toEqual({...START, w: 300, h: 300});
  });
});
