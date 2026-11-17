/**
 * Unit tests for src/ui/popover.ts — the action button row.
 * vitest globals: describe/it/expect/beforeEach/vi.
 */

vi.mock('../src/api/posts', () => ({
  fetchPostMeta: vi.fn(() => Promise.resolve({width: 1000, height: 750})),
}));
vi.mock('../src/api/notes', () => ({
  fetchServerNotes: vi.fn(() => Promise.resolve([])),
  apiPreviewNote: vi.fn(),
}));

import {
  NotesStoreHooks,
  initNotesStore,
  notes,
  setActiveNote,
} from '../src/state/notes-store';
import {NoteState, asServerNoteId, asTempNoteId} from '../src/types';
import {createPopover, updatePopoverForActiveNote} from '../src/ui/popover';

const ST: NoteState = {x: 0, y: 0, w: 10, h: 10, text: ''};

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

function buttons(): HTMLButtonElement[] {
  return [
    ...document.querySelectorAll<HTMLButtonElement>(
      '#dmna-popover .dmna-popover-btn',
    ),
  ];
}

beforeAll(() => {
  createPopover();
});

beforeEach(() => {
  notes.clear();
  initNotesStore(hooks());
  setActiveNote(null);
});

describe('popover action buttons — native-style labels (Task 4.7)', () => {
  it('shows text labels in the existing order and keeps data-action', () => {
    expect(buttons().map(b => [b.dataset.action, b.textContent])).toEqual([
      ['confirm', 'Commit'],
      ['cancel', 'Cancel'],
      ['delete', 'Delete'],
      ['history', 'History'],
    ]);
  });

  it('accessible name and tooltip match the visible label', () => {
    for (const b of buttons()) {
      expect(b.getAttribute('aria-label')).toBe(b.textContent);
      expect(b.title).not.toBe('');
    }
  });

  it('a soft-deleted new box disables everything incl. History', () => {
    const id = asTempNoteId('temp-pop-1');
    notes.set(id, {
      current: {...ST},
      initialState: {...ST},
      confirmedState: {...ST},
      isDeleted: true,
      isServerNote: false,
      everConfirmed: true,
      domElement: null,
    });
    setActiveNote(id);
    updatePopoverForActiveNote();
    expect(buttons().map(b => b.disabled)).toEqual([true, true, true, true]);
  });

  it('a soft-deleted server note keeps History enabled', () => {
    const id = asServerNoteId('55');
    notes.set(id, {
      current: {...ST},
      initialState: {...ST},
      confirmedState: {...ST},
      isDeleted: true,
      isServerNote: true,
      everConfirmed: false,
      domElement: null,
    });
    setActiveNote(id);
    updatePopoverForActiveNote();
    expect(buttons().map(b => b.disabled)).toEqual([true, true, true, false]);
  });
});
