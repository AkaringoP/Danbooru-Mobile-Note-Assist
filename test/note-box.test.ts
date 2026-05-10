/**
 * Unit tests for src/ui/note-box.ts.
 * vitest globals: describe/it/expect/beforeEach/afterEach/vi — no explicit imports.
 */

import {Note, NoteState, asTempNoteId} from '../src/types';
import {
  NotesStoreHooks,
  initNotesStore,
  notes,
  setActiveNote,
  setMode,
} from '../src/state/notes-store';
import type {DisplayRect} from '../src/utils/coords';

// ---------------------------------------------------------------------------
// Mocks for ui/note-box's external deps
// ---------------------------------------------------------------------------

vi.mock('../src/utils/dom', () => ({
  getImageElement: vi.fn(),
}));
vi.mock('../src/state/image-state', () => ({
  getOriginalWidth: vi.fn(() => 1000),
}));
vi.mock('../src/utils/visual-viewport', () => ({
  getInvScale: vi.fn(() => 1),
}));

// notes-store also imports from api/posts and api/notes; mock so its
// fetchPostMeta/fetchServerNotes don't reach real fetch().
vi.mock('../src/api/posts', () => ({
  fetchPostMeta: vi.fn(() => Promise.resolve({width: 1000, height: 750})),
}));
vi.mock('../src/api/notes', () => ({
  fetchServerNotes: vi.fn(() => Promise.resolve([])),
}));

import {getImageElement} from '../src/utils/dom';
import {getOriginalWidth} from '../src/state/image-state';
import {getInvScale} from '../src/utils/visual-viewport';

import {
  NoteBoxHooks,
  initNoteBox,
  removeNoteBoxDOM,
  renderNoteBox,
  updateActiveHandleScales,
  updateAllNoteBoxPositions,
  updateAllNoteVisuals,
  updateNoteVisuals,
} from '../src/ui/note-box';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE: NoteState = {x: 0, y: 0, w: 100, h: 100, text: ''};

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    current: {...BASE},
    initialState: {...BASE},
    confirmedState: {...BASE},
    isDeleted: false,
    isServerNote: false,
    everConfirmed: false,
    domElement: null,
    ...overrides,
  };
}

function makeStoreHooks(): NotesStoreHooks {
  return {
    onActiveChanged: vi.fn(),
    onNoteRenderRequested: vi.fn(),
    onNoteVisualsChanged: vi.fn(),
    onNoteRemoved: vi.fn(),
    onModeChanged: vi.fn(),
    onToast: vi.fn(),
    onReopenMenuRequested: vi.fn(),
    hasPendingChanges: vi.fn(() => false),
  };
}

function makeBoxHooks(): NoteBoxHooks {
  return {
    attachBodyDrag: vi.fn(),
    attachHandle: vi.fn(),
    consumeBoxClickSuppression: vi.fn(() => false),
  };
}

function makeFakeImg(rect: {
  left: number;
  top: number;
  width: number;
  height: number;
}): HTMLImageElement {
  return {
    getBoundingClientRect: () =>
      ({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        right: rect.left + rect.width,
        bottom: rect.top + rect.height,
        x: rect.left,
        y: rect.top,
        toJSON: () => ({}),
      }) as DOMRect,
  } as unknown as HTMLImageElement;
}

let storeHooks: NotesStoreHooks;
let boxHooks: NoteBoxHooks;

beforeEach(() => {
  notes.clear();
  storeHooks = makeStoreHooks();
  initNotesStore(storeHooks);
  setActiveNote(null);
  boxHooks = makeBoxHooks();
  initNoteBox(boxHooks);
  document.body.innerHTML = '';
  vi.mocked(getImageElement).mockReset().mockReturnValue(null);
  vi.mocked(getOriginalWidth).mockReset().mockReturnValue(1000);
  vi.mocked(getInvScale).mockReset().mockReturnValue(1);
  // Reset window.pageX/YOffset; getImageDisplayRect adds them.
  Object.defineProperty(window, 'pageXOffset', {value: 0, configurable: true});
  Object.defineProperty(window, 'pageYOffset', {value: 0, configurable: true});
});

afterEach(() => {
  if (
    typeof document !== 'undefined' &&
    document.body.classList.contains('dmna-mode-active')
  ) {
    setMode('idle');
  }
});

// ---------------------------------------------------------------------------
// renderNoteBox — cachedRect 3 branches + DOM lifecycle
// ---------------------------------------------------------------------------

describe('renderNoteBox — cachedRect branches', () => {
  it('cachedRect=undefined resolves fresh via getImageElement + getImageDisplayRect', () => {
    const id = asTempNoteId('temp-render-fresh');
    notes.set(id, makeNote({current: {...BASE, x: 100, y: 50, w: 20, h: 30}}));
    const img = makeFakeImg({left: 0, top: 0, width: 1000, height: 750});
    vi.mocked(getImageElement).mockReturnValueOnce(img);

    renderNoteBox(id);

    expect(getImageElement).toHaveBeenCalledTimes(1);
    const el = notes.get(id)!.domElement!;
    expect(el).not.toBeNull();
    // scale = 1000/1000 = 1; left = 0 + 100*1; top = 0 + 50*1
    expect(el.style.left).toBe('100px');
    expect(el.style.top).toBe('50px');
    expect(el.style.width).toBe('20px');
    expect(el.style.height).toBe('30px');
    expect(el.style.display).toBe('');
  });

  it('cachedRect=DisplayRect uses the cached rect without calling getImageElement', () => {
    const id = asTempNoteId('temp-render-cached');
    notes.set(id, makeNote({current: {...BASE, x: 200, y: 100, w: 50, h: 40}}));
    const cached: DisplayRect = {left: 10, top: 5, width: 1500, height: 1125};

    renderNoteBox(id, cached);

    expect(getImageElement).not.toHaveBeenCalled();
    const el = notes.get(id)!.domElement!;
    // scale = 1500/1000 = 1.5; left = 10 + 200*1.5 = 310; top = 5 + 100*1.5 = 155
    expect(el.style.left).toBe('310px');
    expect(el.style.top).toBe('155px');
    expect(el.style.width).toBe('75px');
    expect(el.style.height).toBe('60px');
  });

  it('cachedRect=null hides the box (display:none) without calling getImageElement', () => {
    const id = asTempNoteId('temp-render-null');
    notes.set(id, makeNote());

    renderNoteBox(id, null);

    expect(getImageElement).not.toHaveBeenCalled();
    const el = notes.get(id)!.domElement!;
    expect(el.style.display).toBe('none');
  });

  it('hides the box when getImageElement returns null', () => {
    const id = asTempNoteId('temp-render-noimg');
    notes.set(id, makeNote());
    vi.mocked(getImageElement).mockReturnValueOnce(null);

    renderNoteBox(id);

    const el = notes.get(id)!.domElement!;
    expect(el.style.display).toBe('none');
  });

  it('hides the box when image rect has zero width (image hidden by display:none)', () => {
    const id = asTempNoteId('temp-render-zero');
    notes.set(id, makeNote());
    const img = makeFakeImg({left: 0, top: 0, width: 0, height: 0});
    vi.mocked(getImageElement).mockReturnValueOnce(img);

    renderNoteBox(id);

    const el = notes.get(id)!.domElement!;
    expect(el.style.display).toBe('none');
  });

  it('is a no-op when noteId is missing from the Map', () => {
    const id = asTempNoteId('temp-render-ghost');

    renderNoteBox(id);

    expect(getImageElement).not.toHaveBeenCalled();
    expect(document.body.querySelector('.dmna-note-box')).toBeNull();
  });
});

describe('renderNoteBox — DOM lifecycle', () => {
  it('creates the DOM element on first render and reuses it on the second', () => {
    const id = asTempNoteId('temp-lifecycle');
    notes.set(id, makeNote());
    const cached: DisplayRect = {left: 0, top: 0, width: 1000, height: 750};

    renderNoteBox(id, cached);
    const elFirst = notes.get(id)!.domElement!;
    expect(elFirst).not.toBeNull();
    expect(elFirst.classList.contains('dmna-note-box')).toBe(true);
    expect(elFirst.dataset.noteId).toBe(id);
    expect(elFirst.parentElement).toBe(document.body);

    renderNoteBox(id, cached);
    expect(notes.get(id)!.domElement).toBe(elFirst);
    // Still only one .dmna-note-box element in body
    expect(document.body.querySelectorAll('.dmna-note-box').length).toBe(1);
  });

  it('wires the body-drag listener and 4 corner-handle listeners on first render', () => {
    const id = asTempNoteId('temp-wires');
    notes.set(id, makeNote());

    renderNoteBox(id, {left: 0, top: 0, width: 1000, height: 750});

    expect(boxHooks.attachBodyDrag).toHaveBeenCalledTimes(1);
    expect(boxHooks.attachHandle).toHaveBeenCalledTimes(4);
    const corners = vi
      .mocked(boxHooks.attachHandle)
      .mock.calls.map(c => c[1])
      .sort();
    expect(corners).toEqual(['ne', 'nw', 'se', 'sw']);
  });

  it('writes --dmna-triangle-size capped at 8px on large boxes and proportional on small', () => {
    const id = asTempNoteId('temp-tri');
    notes.set(id, makeNote({current: {x: 0, y: 0, w: 600, h: 600, text: ''}}));
    const cached: DisplayRect = {left: 0, top: 0, width: 1000, height: 750};

    renderNoteBox(id, cached);
    const el = notes.get(id)!.domElement!;
    // box display = 600x600 (scale 1) → triSize = min(600/6, 8) = 8
    expect(el.style.getPropertyValue('--dmna-triangle-size')).toBe('8px');

    // Now a small box
    notes.get(id)!.current = {x: 0, y: 0, w: 30, h: 30, text: ''};
    renderNoteBox(id, cached);
    // 30/6 = 5 < 8 → triSize = 5
    expect(el.style.getPropertyValue('--dmna-triangle-size')).toBe('5px');
  });
});

// ---------------------------------------------------------------------------
// updateAllNoteBoxPositions — single getImageElement read shared across N notes
// ---------------------------------------------------------------------------

describe('updateAllNoteBoxPositions', () => {
  it('reads getImageElement exactly once and forwards the rect to each renderNoteBox', () => {
    const ids = [
      asTempNoteId('temp-batch-1'),
      asTempNoteId('temp-batch-2'),
      asTempNoteId('temp-batch-3'),
    ];
    ids.forEach(id => notes.set(id, makeNote()));
    const img = makeFakeImg({left: 0, top: 0, width: 1000, height: 750});
    vi.mocked(getImageElement).mockReturnValueOnce(img);

    updateAllNoteBoxPositions();

    expect(getImageElement).toHaveBeenCalledTimes(1);
    ids.forEach(id => {
      const el = notes.get(id)!.domElement!;
      expect(el).not.toBeNull();
      expect(el.style.display).toBe('');
    });
  });

  it('with getImageElement=null, every note box is hidden (display:none)', () => {
    const ids = [
      asTempNoteId('temp-batch-noimg-1'),
      asTempNoteId('temp-batch-noimg-2'),
    ];
    ids.forEach(id => notes.set(id, makeNote()));
    vi.mocked(getImageElement).mockReturnValueOnce(null);

    updateAllNoteBoxPositions();

    ids.forEach(id => {
      const el = notes.get(id)!.domElement!;
      expect(el.style.display).toBe('none');
    });
  });
});

// ---------------------------------------------------------------------------
// removeNoteBoxDOM
// ---------------------------------------------------------------------------

describe('removeNoteBoxDOM', () => {
  it('removes the DOM element and nulls note.domElement', () => {
    const id = asTempNoteId('temp-remove');
    notes.set(id, makeNote());
    renderNoteBox(id, {left: 0, top: 0, width: 1000, height: 750});
    expect(notes.get(id)!.domElement).not.toBeNull();
    expect(document.body.querySelectorAll('.dmna-note-box').length).toBe(1);

    removeNoteBoxDOM(id);

    expect(notes.get(id)!.domElement).toBeNull();
    expect(document.body.querySelectorAll('.dmna-note-box').length).toBe(0);
  });

  it('is a no-op when the note has no DOM element', () => {
    const id = asTempNoteId('temp-remove-no-dom');
    notes.set(id, makeNote());
    expect(() => removeNoteBoxDOM(id)).not.toThrow();
    expect(notes.get(id)!.domElement).toBeNull();
  });

  it('is a no-op when noteId is missing from the Map', () => {
    expect(() => removeNoteBoxDOM(asTempNoteId('temp-ghost'))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// updateNoteVisuals — 4-color priority class toggling
// ---------------------------------------------------------------------------

describe('updateNoteVisuals — 4-color class set', () => {
  function seedAndRender(
    id: ReturnType<typeof asTempNoteId>,
    overrides: Partial<Note>,
  ): HTMLElement {
    notes.set(id, makeNote(overrides));
    renderNoteBox(id, {left: 0, top: 0, width: 1000, height: 750});
    return notes.get(id)!.domElement!;
  }

  it('clean server note (default): no is-active / is-deleted / is-dirty', () => {
    const id = asTempNoteId('temp-vis-default');
    const el = seedAndRender(id, {isServerNote: true});

    expect(el.classList.contains('is-active')).toBe(false);
    expect(el.classList.contains('is-deleted')).toBe(false);
    expect(el.classList.contains('is-dirty')).toBe(false);
  });

  it('active alone: is-active set, others not (server clean)', () => {
    const id = asTempNoteId('temp-vis-active');
    const el = seedAndRender(id, {isServerNote: true});
    setActiveNote(id);
    updateNoteVisuals(id);

    expect(el.classList.contains('is-active')).toBe(true);
    expect(el.classList.contains('is-deleted')).toBe(false);
    expect(el.classList.contains('is-dirty')).toBe(false);
  });

  it('deleted alone: is-deleted set (server, clean current === initial)', () => {
    const id = asTempNoteId('temp-vis-deleted');
    const el = seedAndRender(id, {isServerNote: true, isDeleted: true});

    expect(el.classList.contains('is-active')).toBe(false);
    expect(el.classList.contains('is-deleted')).toBe(true);
    expect(el.classList.contains('is-dirty')).toBe(false);
  });

  it('dirty alone: is-dirty set (server with edited current)', () => {
    const id = asTempNoteId('temp-vis-dirty');
    const el = seedAndRender(id, {
      isServerNote: true,
      current: {...BASE, x: 99},
      initialState: {...BASE},
    });

    expect(el.classList.contains('is-active')).toBe(false);
    expect(el.classList.contains('is-deleted')).toBe(false);
    expect(el.classList.contains('is-dirty')).toBe(true);
  });

  it('temp note (always dirty per isDirty split rule): is-dirty set even when current === initial', () => {
    const id = asTempNoteId('temp-vis-temp-dirty');
    const el = seedAndRender(id, {isServerNote: false});
    expect(el.classList.contains('is-dirty')).toBe(true);
  });

  it('active + deleted + dirty all coexist as classes (CSS specificity decides priority)', () => {
    const id = asTempNoteId('temp-vis-all');
    const el = seedAndRender(id, {
      isServerNote: true,
      isDeleted: true,
      current: {...BASE, x: 99},
      initialState: {...BASE},
    });
    setActiveNote(id);
    updateNoteVisuals(id);

    expect(el.classList.contains('is-active')).toBe(true);
    expect(el.classList.contains('is-deleted')).toBe(true);
    expect(el.classList.contains('is-dirty')).toBe(true);
  });

  it('clearing active flips is-active off on the previously-active note', () => {
    const id = asTempNoteId('temp-vis-active-clear');
    const el = seedAndRender(id, {isServerNote: true});
    setActiveNote(id);
    updateNoteVisuals(id);
    expect(el.classList.contains('is-active')).toBe(true);

    setActiveNote(null);
    updateNoteVisuals(id);
    expect(el.classList.contains('is-active')).toBe(false);
  });

  it('is a no-op when noteId is missing from the Map', () => {
    expect(() =>
      updateNoteVisuals(asTempNoteId('temp-ghost-vis')),
    ).not.toThrow();
  });

  it('is a no-op when the note has no domElement', () => {
    const id = asTempNoteId('temp-no-dom-vis');
    notes.set(id, makeNote());
    expect(() => updateNoteVisuals(id)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// updateAllNoteVisuals
// ---------------------------------------------------------------------------

describe('updateAllNoteVisuals', () => {
  it('toggles classes on every note in the Map', () => {
    const a = asTempNoteId('temp-allvis-a');
    const b = asTempNoteId('temp-allvis-b');
    notes.set(a, makeNote({isServerNote: true, isDeleted: true}));
    notes.set(b, makeNote({isServerNote: true}));
    renderNoteBox(a, {left: 0, top: 0, width: 1000, height: 750});
    renderNoteBox(b, {left: 0, top: 0, width: 1000, height: 750});

    // Force a visual mismatch on b by mutating the Note directly
    // (bypassing setActiveNote). Then call updateAllNoteVisuals.
    notes.get(b)!.isDeleted = true;
    updateAllNoteVisuals();

    expect(notes.get(a)!.domElement!.classList.contains('is-deleted')).toBe(
      true,
    );
    expect(notes.get(b)!.domElement!.classList.contains('is-deleted')).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// updateActiveHandleScales — vvScale → CSS variable
// ---------------------------------------------------------------------------

describe('updateActiveHandleScales', () => {
  it('is a no-op when no active note', () => {
    expect(() => updateActiveHandleScales()).not.toThrow();
  });

  it('is a no-op when active note is missing from the Map', () => {
    setActiveNote(asTempNoteId('temp-handle-ghost'));
    expect(() => updateActiveHandleScales()).not.toThrow();
  });

  it('is a no-op when active note has no DOM element', () => {
    const id = asTempNoteId('temp-handle-no-dom');
    notes.set(id, makeNote());
    setActiveNote(id);
    expect(() => updateActiveHandleScales()).not.toThrow();
  });

  it('writes --dmna-handle-scale = 1 at vvScale=1 (invScale=1)', () => {
    const id = asTempNoteId('temp-handle-scale-1');
    notes.set(id, makeNote());
    renderNoteBox(id, {left: 0, top: 0, width: 1000, height: 750});
    setActiveNote(id);
    vi.mocked(getInvScale).mockReturnValueOnce(1);

    updateActiveHandleScales();

    const el = notes.get(id)!.domElement!;
    expect(el.style.getPropertyValue('--dmna-handle-scale')).toBe('1');
  });

  it('writes --dmna-handle-scale = 0.5 at vvScale=2 (invScale=0.5)', () => {
    const id = asTempNoteId('temp-handle-scale-2');
    notes.set(id, makeNote());
    renderNoteBox(id, {left: 0, top: 0, width: 1000, height: 750});
    setActiveNote(id);
    vi.mocked(getInvScale).mockReturnValueOnce(0.5);

    updateActiveHandleScales();

    const el = notes.get(id)!.domElement!;
    expect(el.style.getPropertyValue('--dmna-handle-scale')).toBe('0.5');
  });
});
