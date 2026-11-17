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
import {
  createPopover,
  showPopover,
  updatePopoverForActiveNote,
} from '../src/ui/popover';

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
    onNotesAdded: vi.fn(),
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

describe('character counter (Task 4.5 follow-up)', () => {
  function counter(): HTMLElement {
    return document.querySelector('#dmna-popover-header .dmna-popover-count')!;
  }

  function type(text: string): void {
    const ta = document.getElementById(
      'dmna-popover-input',
    ) as HTMLTextAreaElement;
    ta.value = text;
    ta.dispatchEvent(new Event('input', {bubbles: true}));
  }

  it('sits in the header, left of "view help"', () => {
    const el = counter();
    expect(el).not.toBeNull();
    expect(el.nextElementSibling?.id).toBe('dmna-popover-help-link');
  });

  it('shows the server-side length against 5000 and updates on input', () => {
    const id = asTempNoteId('temp-count-1');
    notes.set(id, {
      current: {...ST, text: 'abc'},
      initialState: {...ST},
      confirmedState: {...ST},
      isDeleted: false,
      isServerNote: false,
      everConfirmed: false,
      domElement: null,
    });
    setActiveNote(id);
    showPopover(id);
    expect(counter().textContent).toBe('3 / 5000');

    type('line one\nline two');
    expect(counter().textContent).toBe('18 / 5000');
    expect(counter().classList.contains('is-over')).toBe(false);

    type('x'.repeat(5001));
    expect(counter().textContent).toBe('5001 / 5000');
    expect(counter().classList.contains('is-over')).toBe(true);
  });
});
