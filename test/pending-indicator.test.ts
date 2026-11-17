/**
 * Unit tests for src/interactions/pending-indicator.ts.
 * vitest globals: describe/it/expect/beforeEach/vi.
 */

vi.mock('../src/api/posts', () => ({
  fetchPostMeta: vi.fn(() => Promise.resolve({width: 1000, height: 750})),
}));
vi.mock('../src/api/notes', () => ({
  fetchServerNotes: vi.fn(() => Promise.resolve([])),
}));

import {
  refreshPendingIndicator,
  schedulePendingRefresh,
} from '../src/interactions/pending-indicator';
import {
  NotesStoreHooks,
  createTempNote,
  initNotesStore,
  notes,
  popoverConfirm,
  popoverDelete,
  popoverUndo,
  setActiveNote,
  setMode,
} from '../src/state/notes-store';
import {NoteState, asServerNoteId} from '../src/types';
import {createFloatingButton} from '../src/ui/floating-button';

const ST: NoteState = {x: 0, y: 0, w: 10, h: 10, text: 'x'};

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
    onNotesAdded: vi.fn(),
  };
}

function serverNote(id: string) {
  const noteId = asServerNoteId(id);
  notes.set(noteId, {
    current: {...ST},
    initialState: {...ST},
    confirmedState: {...ST},
    isDeleted: false,
    isServerNote: true,
    everConfirmed: false,
    domElement: null,
  });
  return noteId;
}

const pending = () => document.body.classList.contains('dmna-has-pending');
const badge = () =>
  document.getElementById('dmna-float-btn')!.getAttribute('data-pending-count');

beforeAll(() => {
  createFloatingButton();
});

beforeEach(() => {
  notes.clear();
  initNotesStore(hooks());
  setActiveNote(null);
  setMode('active');
});

afterEach(() => {
  setMode('idle');
  refreshPendingIndicator();
});

describe('pending indicator (Task 4.8)', () => {
  it('a committed new box is pending; an uncommitted one is not', () => {
    const id = createTempNote({...ST});
    refreshPendingIndicator();
    expect(pending()).toBe(false);
    expect(badge()).toBeNull();

    popoverConfirm(id);
    refreshPendingIndicator();
    expect(pending()).toBe(true);
    expect(badge()).toBe('1');
  });

  it('moving or editing a server note is pending; reverting clears it', () => {
    const id = serverNote('10');
    notes.get(id)!.current.x = 50;
    refreshPendingIndicator();
    expect(pending()).toBe(true);

    notes.get(id)!.current.x = 0;
    notes.get(id)!.current.text = 'edited';
    refreshPendingIndicator();
    expect(pending()).toBe(true);

    notes.get(id)!.current.text = 'x';
    refreshPendingIndicator();
    expect(pending()).toBe(false);
  });

  it('a soft-deleted server note is pending until undone', () => {
    const id = serverNote('11');
    popoverDelete(id);
    refreshPendingIndicator();
    expect(pending()).toBe(true);
    popoverUndo(id);
    refreshPendingIndicator();
    expect(pending()).toBe(false);
  });

  it('the badge counts every request Confirm would send', () => {
    popoverConfirm(createTempNote({...ST}));
    popoverConfirm(createTempNote({...ST, x: 30}));
    notes.get(serverNote('12'))!.current.y = 5;
    popoverDelete(serverNote('13'));
    refreshPendingIndicator();
    expect(badge()).toBe('4');
  });

  it('idle mode shows nothing', () => {
    popoverConfirm(createTempNote({...ST}));
    setMode('idle');
    refreshPendingIndicator();
    expect(pending()).toBe(false);
    expect(badge()).toBeNull();
  });

  it('schedulePendingRefresh coalesces a burst into one update', async () => {
    popoverConfirm(createTempNote({...ST}));
    schedulePendingRefresh();
    schedulePendingRefresh();
    expect(pending()).toBe(false);
    await Promise.resolve();
    expect(pending()).toBe(true);
  });
});
