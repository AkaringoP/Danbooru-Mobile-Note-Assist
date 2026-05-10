/**
 * Unit tests for src/state/notes-store.ts.
 * vitest globals: describe/it/expect/beforeEach/afterEach/vi — no explicit imports.
 */

import {
  ActionLogEntry,
  Note,
  NoteState,
  asServerNoteId,
  asTempNoteId,
} from '../src/types';
import {
  NotesStoreHooks,
  actionLog,
  addServerNote,
  createTempNote,
  discardAll,
  genNoteId,
  getActiveModeGen,
  getActiveNoteId,
  getMode,
  hardDeleteNote,
  initNotesStore,
  isDirty,
  notes,
  popoverCancel,
  popoverConfirm,
  popoverDelete,
  popoverUndo,
  pushAction,
  setActiveNote,
  setMode,
} from '../src/state/notes-store';

// ---------------------------------------------------------------------------
// Mocks for the api/* deps that enterActiveMode awaits
// ---------------------------------------------------------------------------

vi.mock('../src/api/posts', () => ({
  fetchPostMeta: vi.fn(() => Promise.resolve()),
}));
vi.mock('../src/api/notes', () => ({
  fetchServerNotes: vi.fn(() => Promise.resolve([])),
}));

import {fetchPostMeta} from '../src/api/posts';
import {fetchServerNotes, ServerNoteDescriptor} from '../src/api/notes';

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

function makeHooks(): NotesStoreHooks {
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

let hooks: NotesStoreHooks;

beforeEach(() => {
  notes.clear();
  actionLog.clear();
  hooks = makeHooks();
  initNotesStore(hooks);
  setActiveNote(null);
  vi.mocked(fetchPostMeta).mockReset().mockResolvedValue({width: 0, height: 0});
  vi.mocked(fetchServerNotes).mockReset().mockResolvedValue([]);
});

afterEach(() => {
  // Drain any in-flight enterActiveMode by transitioning to idle. The
  // module-level mode/gen counters leak across tests otherwise.
  if (getMode() === 'active') {
    setMode('idle');
  }
});

// ---------------------------------------------------------------------------
// genNoteId
// ---------------------------------------------------------------------------

describe('genNoteId', () => {
  it('returns a TempNoteId starting with "temp-"', () => {
    const id = genNoteId();
    expect(typeof id).toBe('string');
    expect(id.startsWith('temp-')).toBe(true);
  });

  it('returns distinct ids on successive calls', () => {
    const a = genNoteId();
    const b = genNoteId();
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// isDirty — split rule (temp always dirty / server compares 5 axes)
// ---------------------------------------------------------------------------

describe('isDirty — split rule', () => {
  it('temp note is always dirty even when current === initialState', () => {
    expect(isDirty(makeNote({isServerNote: false}))).toBe(true);
  });

  it('server note with current === initialState is clean', () => {
    expect(isDirty(makeNote({isServerNote: true}))).toBe(false);
  });

  it('server note with x diff is dirty', () => {
    expect(
      isDirty(
        makeNote({
          isServerNote: true,
          current: {...BASE, x: 1},
          initialState: {...BASE},
        }),
      ),
    ).toBe(true);
  });

  it('server note with y diff is dirty', () => {
    expect(
      isDirty(
        makeNote({
          isServerNote: true,
          current: {...BASE, y: 1},
          initialState: {...BASE},
        }),
      ),
    ).toBe(true);
  });

  it('server note with w diff is dirty', () => {
    expect(
      isDirty(
        makeNote({
          isServerNote: true,
          current: {...BASE, w: 1},
          initialState: {...BASE},
        }),
      ),
    ).toBe(true);
  });

  it('server note with h diff is dirty', () => {
    expect(
      isDirty(
        makeNote({
          isServerNote: true,
          current: {...BASE, h: 1},
          initialState: {...BASE},
        }),
      ),
    ).toBe(true);
  });

  it('server note with text diff is dirty', () => {
    expect(
      isDirty(
        makeNote({
          isServerNote: true,
          current: {...BASE, text: 'edited'},
          initialState: {...BASE, text: ''},
        }),
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// pushAction — per-type prevState shape, lazy stack creation
// ---------------------------------------------------------------------------

describe('pushAction', () => {
  it('lazily creates the per-note stack on first push', () => {
    const id = asTempNoteId('temp-push-1');
    expect(actionLog.has(id)).toBe(false);
    pushAction(id, 'create', null);
    expect(actionLog.get(id)?.length).toBe(1);
  });

  it("'create' pushes an entry with prevState=null", () => {
    const id = asTempNoteId('temp-push-create');
    pushAction(id, 'create', null);
    const entry = actionLog.get(id)![0];
    expect(entry.type).toBe('create');
    expect(entry.prevState).toBeNull();
    expect(entry.noteId).toBe(id);
  });

  it("'edit' pushes an entry with NoteState prevState", () => {
    const id = asServerNoteId('100');
    const prev: NoteState = {...BASE, text: 'before'};
    pushAction(id, 'edit', prev);
    const entry = actionLog.get(id)![0];
    expect(entry.type).toBe('edit');
    expect(entry.prevState).toEqual(prev);
  });

  it("'delete' pushes an entry with NoteState prevState", () => {
    const id = asServerNoteId('101');
    const prev: NoteState = {...BASE, x: 50};
    pushAction(id, 'delete', prev);
    const entry = actionLog.get(id)![0];
    expect(entry.type).toBe('delete');
    expect(entry.prevState).toEqual(prev);
  });

  it("'transform' pushes an entry with NoteState prevState", () => {
    const id = asServerNoteId('102');
    const prev: NoteState = {...BASE, w: 200, h: 200};
    pushAction(id, 'transform', prev);
    const entry = actionLog.get(id)![0];
    expect(entry.type).toBe('transform');
    expect(entry.prevState).toEqual(prev);
  });

  it('pushes onto the existing stack on subsequent calls (latest is tail)', () => {
    const id = asTempNoteId('temp-push-stack');
    pushAction(id, 'create', null);
    pushAction(id, 'edit', {...BASE, text: 'first'});
    pushAction(id, 'edit', {...BASE, text: 'second'});
    const stack = actionLog.get(id)!;
    expect(stack.length).toBe(3);
    expect(stack[0].type).toBe('create');
    expect(stack[2].type).toBe('edit');
    expect(
      (stack[2] as ActionLogEntry & {prevState: NoteState}).prevState.text,
    ).toBe('second');
  });
});

// ---------------------------------------------------------------------------
// setActiveNote — onActiveChanged firing rules
// ---------------------------------------------------------------------------

describe('setActiveNote', () => {
  it('null → null is idempotent (no firing)', () => {
    setActiveNote(null);
    expect(hooks.onActiveChanged).not.toHaveBeenCalled();
  });

  it('null → id fires onActiveChanged(null, id)', () => {
    const id = asTempNoteId('temp-active-1');
    setActiveNote(id);
    expect(hooks.onActiveChanged).toHaveBeenCalledTimes(1);
    expect(hooks.onActiveChanged).toHaveBeenCalledWith(null, id);
    expect(getActiveNoteId()).toBe(id);
  });

  it('id → null fires onActiveChanged(prev, null)', () => {
    const id = asTempNoteId('temp-active-2');
    setActiveNote(id);
    vi.mocked(hooks.onActiveChanged).mockClear();
    setActiveNote(null);
    expect(hooks.onActiveChanged).toHaveBeenCalledTimes(1);
    expect(hooks.onActiveChanged).toHaveBeenCalledWith(id, null);
  });

  it('id → other id fires onActiveChanged(prev, next)', () => {
    const a = asTempNoteId('temp-active-a');
    const b = asTempNoteId('temp-active-b');
    setActiveNote(a);
    vi.mocked(hooks.onActiveChanged).mockClear();
    setActiveNote(b);
    expect(hooks.onActiveChanged).toHaveBeenCalledWith(a, b);
  });

  it('same id → same id is idempotent', () => {
    const id = asTempNoteId('temp-active-same');
    setActiveNote(id);
    vi.mocked(hooks.onActiveChanged).mockClear();
    setActiveNote(id);
    expect(hooks.onActiveChanged).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// discardAll
// ---------------------------------------------------------------------------

describe('discardAll', () => {
  it('clears notes + actionLog + active selection and fires onNoteRemoved per note', () => {
    const a = asTempNoteId('temp-discard-a');
    const b = asTempNoteId('temp-discard-b');
    notes.set(a, makeNote());
    notes.set(b, makeNote());
    pushAction(a, 'create', null);
    setActiveNote(a);
    vi.mocked(hooks.onNoteRemoved).mockClear();
    vi.mocked(hooks.onActiveChanged).mockClear();

    discardAll();

    expect(notes.size).toBe(0);
    expect(actionLog.size).toBe(0);
    expect(getActiveNoteId()).toBeNull();
    expect(hooks.onNoteRemoved).toHaveBeenCalledTimes(2);
    expect(hooks.onActiveChanged).toHaveBeenCalledWith(a, null);
  });
});

// ---------------------------------------------------------------------------
// hardDeleteNote
// ---------------------------------------------------------------------------

describe('hardDeleteNote', () => {
  it('removes the note + actionLog entries + fires onNoteRemoved', () => {
    const id = asTempNoteId('temp-hard-1');
    notes.set(id, makeNote());
    pushAction(id, 'create', null);

    hardDeleteNote(id);

    expect(notes.has(id)).toBe(false);
    expect(actionLog.has(id)).toBe(false);
    expect(hooks.onNoteRemoved).toHaveBeenCalledWith(id);
  });

  it('clears active selection when deleting the active note', () => {
    const id = asTempNoteId('temp-hard-active');
    notes.set(id, makeNote());
    setActiveNote(id);
    vi.mocked(hooks.onActiveChanged).mockClear();

    hardDeleteNote(id);

    expect(getActiveNoteId()).toBeNull();
    expect(hooks.onActiveChanged).toHaveBeenCalledWith(id, null);
  });

  it('leaves active selection alone when deleting a non-active note', () => {
    const active = asTempNoteId('temp-hard-keep-active');
    const target = asTempNoteId('temp-hard-target');
    notes.set(active, makeNote());
    notes.set(target, makeNote());
    setActiveNote(active);
    vi.mocked(hooks.onActiveChanged).mockClear();

    hardDeleteNote(target);

    expect(getActiveNoteId()).toBe(active);
    expect(hooks.onActiveChanged).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// addServerNote / createTempNote
// ---------------------------------------------------------------------------

describe('addServerNote', () => {
  function makeServerDescriptor(
    overrides: Partial<ServerNoteDescriptor> = {},
  ): ServerNoteDescriptor {
    return {
      id: 555,
      x: 10,
      y: 20,
      width: 30,
      height: 40,
      body: 'hello',
      ...overrides,
    } as ServerNoteDescriptor;
  }

  it('inserts a server note with all three state copies and isServerNote=true', () => {
    addServerNote(makeServerDescriptor());
    const id = asServerNoteId(555);
    const note = notes.get(id)!;
    expect(note.isServerNote).toBe(true);
    expect(note.everConfirmed).toBe(false);
    expect(note.isDeleted).toBe(false);
    expect(note.current).toEqual({x: 10, y: 20, w: 30, h: 40, text: 'hello'});
    expect(note.initialState).toEqual(note.current);
    expect(note.confirmedState).toEqual(note.current);
    expect(hooks.onNoteRenderRequested).toHaveBeenCalledWith(id);
  });

  it('is idempotent on duplicate id', () => {
    addServerNote(makeServerDescriptor({id: 100}));
    vi.mocked(hooks.onNoteRenderRequested).mockClear();
    addServerNote(makeServerDescriptor({id: 100, body: 'changed'}));
    expect(notes.size).toBe(1);
    expect(notes.get(asServerNoteId(100))!.current.text).toBe('hello');
    expect(hooks.onNoteRenderRequested).not.toHaveBeenCalled();
  });

  it('coerces missing body to empty string', () => {
    addServerNote(makeServerDescriptor({id: 200, body: undefined}));
    expect(notes.get(asServerNoteId(200))!.current.text).toBe('');
  });
});

describe('createTempNote', () => {
  it('creates a TempNoteId-keyed note + 1 create action + render hook', () => {
    const state: NoteState = {x: 5, y: 5, w: 50, h: 50, text: 'tmp'};
    const id = createTempNote(state);

    expect(id.startsWith('temp-')).toBe(true);
    const note = notes.get(id)!;
    expect(note.isServerNote).toBe(false);
    expect(note.everConfirmed).toBe(false);
    expect(note.isDeleted).toBe(false);
    expect(note.current).toEqual(state);
    expect(note.initialState).toEqual(state);
    expect(note.confirmedState).toEqual(state);
    expect(actionLog.get(id)).toHaveLength(1);
    expect(actionLog.get(id)![0].type).toBe('create');
    expect(actionLog.get(id)![0].prevState).toBeNull();
    expect(hooks.onNoteRenderRequested).toHaveBeenCalledWith(id);
  });

  it('returns distinct ids on successive calls', () => {
    const a = createTempNote({...BASE});
    const b = createTempNote({...BASE});
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// popoverConfirm — ✔ checkpoint commit + edit log push
// ---------------------------------------------------------------------------

describe('popoverConfirm', () => {
  it('pushes an edit entry with the prior confirmedState and copies current → confirmedState', () => {
    const id = asServerNoteId('300');
    const initial: NoteState = {...BASE, text: 'initial'};
    notes.set(
      id,
      makeNote({
        isServerNote: true,
        current: {...BASE, text: 'edited'},
        initialState: initial,
        confirmedState: initial,
      }),
    );
    setActiveNote(id);
    vi.mocked(hooks.onActiveChanged).mockClear();
    vi.mocked(hooks.onNoteVisualsChanged).mockClear();

    popoverConfirm(id);

    const note = notes.get(id)!;
    expect(note.confirmedState).toEqual({...BASE, text: 'edited'});
    expect(note.everConfirmed).toBe(true);
    const stack = actionLog.get(id)!;
    expect(stack[stack.length - 1].type).toBe('edit');
    expect(
      (stack[stack.length - 1] as ActionLogEntry & {prevState: NoteState})
        .prevState,
    ).toEqual(initial);
    expect(hooks.onActiveChanged).toHaveBeenCalledWith(id, null);
    expect(hooks.onNoteVisualsChanged).toHaveBeenCalledWith(id);
  });

  it('is a no-op when the noteId is missing from the Map', () => {
    const ghost = asServerNoteId('999');
    popoverConfirm(ghost);
    expect(actionLog.has(ghost)).toBe(false);
    expect(hooks.onNoteVisualsChanged).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// popoverCancel — ✖ revert / hardDelete fresh-new
// ---------------------------------------------------------------------------

describe('popoverCancel', () => {
  it('hard-deletes a fresh-new temp note (!isServerNote && !everConfirmed)', () => {
    const id = asTempNoteId('temp-cancel-fresh');
    notes.set(id, makeNote({isServerNote: false, everConfirmed: false}));
    pushAction(id, 'create', null);
    setActiveNote(id);
    vi.mocked(hooks.onNoteRemoved).mockClear();

    popoverCancel(id);

    expect(notes.has(id)).toBe(false);
    expect(actionLog.has(id)).toBe(false);
    expect(hooks.onNoteRemoved).toHaveBeenCalledWith(id);
  });

  it('reverts current → confirmedState on a confirmed temp note', () => {
    const id = asTempNoteId('temp-cancel-confirmed');
    const confirmed: NoteState = {...BASE, x: 1, text: 'committed'};
    notes.set(
      id,
      makeNote({
        isServerNote: false,
        everConfirmed: true,
        current: {...BASE, x: 99, text: 'pending'},
        confirmedState: confirmed,
      }),
    );
    setActiveNote(id);
    vi.mocked(hooks.onActiveChanged).mockClear();
    vi.mocked(hooks.onNoteRenderRequested).mockClear();

    popoverCancel(id);

    expect(notes.get(id)!.current).toEqual(confirmed);
    expect(hooks.onNoteRenderRequested).toHaveBeenCalledWith(id);
    expect(hooks.onActiveChanged).toHaveBeenCalledWith(id, null);
    // Note still in collection
    expect(notes.has(id)).toBe(true);
  });

  it('reverts current → confirmedState on a server note', () => {
    const id = asServerNoteId('400');
    const confirmed: NoteState = {...BASE, x: 5, text: 'server'};
    notes.set(
      id,
      makeNote({
        isServerNote: true,
        everConfirmed: false,
        current: {...BASE, x: 99},
        confirmedState: confirmed,
        initialState: confirmed,
      }),
    );
    setActiveNote(id);

    popoverCancel(id);

    expect(notes.get(id)!.current).toEqual(confirmed);
    expect(notes.has(id)).toBe(true);
  });

  it('is a no-op for a missing noteId', () => {
    popoverCancel(asTempNoteId('temp-ghost'));
    expect(hooks.onNoteRenderRequested).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// popoverDelete — 🗑 routing (fresh-new hard / confirmed soft)
// ---------------------------------------------------------------------------

describe('popoverDelete', () => {
  it('hard-deletes a fresh-new temp note', () => {
    const id = asTempNoteId('temp-del-fresh');
    notes.set(id, makeNote({isServerNote: false, everConfirmed: false}));
    pushAction(id, 'create', null);

    popoverDelete(id);

    expect(notes.has(id)).toBe(false);
    expect(hooks.onNoteRemoved).toHaveBeenCalledWith(id);
  });

  it('soft-deletes a confirmed temp note + pushes a delete action', () => {
    const id = asTempNoteId('temp-del-confirmed');
    notes.set(
      id,
      makeNote({
        isServerNote: false,
        everConfirmed: true,
        current: {...BASE, text: 'committed'},
      }),
    );
    setActiveNote(id);
    vi.mocked(hooks.onActiveChanged).mockClear();

    popoverDelete(id);

    expect(notes.get(id)!.isDeleted).toBe(true);
    const stack = actionLog.get(id)!;
    expect(stack[stack.length - 1].type).toBe('delete');
    expect(
      (stack[stack.length - 1] as ActionLogEntry & {prevState: NoteState})
        .prevState.text,
    ).toBe('committed');
    expect(hooks.onActiveChanged).toHaveBeenCalledWith(id, null);
    expect(hooks.onNoteVisualsChanged).toHaveBeenCalledWith(id);
  });

  it('soft-deletes a server note (always confirmed-equivalent)', () => {
    const id = asServerNoteId('500');
    notes.set(id, makeNote({isServerNote: true, everConfirmed: false}));

    popoverDelete(id);

    expect(notes.get(id)!.isDeleted).toBe(true);
    expect(actionLog.get(id)![0].type).toBe('delete');
  });
});

// ---------------------------------------------------------------------------
// popoverUndo — action-type-specific reverse
// ---------------------------------------------------------------------------

describe('popoverUndo', () => {
  it('emits Nothing-to-undo toast on empty stack', () => {
    const id = asTempNoteId('temp-undo-empty');
    notes.set(id, makeNote());

    popoverUndo(id);

    expect(hooks.onToast).toHaveBeenCalledWith(
      'Nothing to undo for this note',
      'info',
    );
    expect(notes.has(id)).toBe(true);
  });

  it("'create' undo hard-deletes the note (cancels creation)", () => {
    const id = createTempNote({...BASE});
    vi.mocked(hooks.onNoteRemoved).mockClear();

    popoverUndo(id);

    expect(notes.has(id)).toBe(false);
    expect(hooks.onNoteRemoved).toHaveBeenCalledWith(id);
  });

  it("'edit' undo restores current AND confirmedState to the prevState snapshot", () => {
    const id = asServerNoteId('600');
    const prior: NoteState = {...BASE, text: 'priorCommit'};
    notes.set(
      id,
      makeNote({
        isServerNote: true,
        current: {...BASE, text: 'newCommit'},
        confirmedState: {...BASE, text: 'newCommit'},
        initialState: prior,
      }),
    );
    pushAction(id, 'edit', prior);

    popoverUndo(id);

    const note = notes.get(id)!;
    expect(note.current).toEqual(prior);
    expect(note.confirmedState).toEqual(prior);
    expect(hooks.onNoteRenderRequested).toHaveBeenCalledWith(id);
  });

  it("'delete' undo flips isDeleted=false and restores current", () => {
    const id = asServerNoteId('601');
    const stateAtDelete: NoteState = {...BASE, x: 7};
    notes.set(
      id,
      makeNote({
        isServerNote: true,
        isDeleted: true,
        current: {...BASE, x: 999},
      }),
    );
    pushAction(id, 'delete', stateAtDelete);

    popoverUndo(id);

    const note = notes.get(id)!;
    expect(note.isDeleted).toBe(false);
    expect(note.current).toEqual(stateAtDelete);
    expect(hooks.onNoteRenderRequested).toHaveBeenCalledWith(id);
  });

  it("'transform' undo restores geometry only — text and confirmedState untouched", () => {
    const id = asServerNoteId('602');
    const beforeDrag: NoteState = {...BASE, x: 1, y: 1, w: 10, h: 10};
    notes.set(
      id,
      makeNote({
        isServerNote: true,
        current: {x: 99, y: 99, w: 50, h: 50, text: 'typed-after-drag'},
        confirmedState: {...BASE, text: 'priorConfirm'},
      }),
    );
    pushAction(id, 'transform', beforeDrag);

    popoverUndo(id);

    const note = notes.get(id)!;
    expect(note.current.x).toBe(1);
    expect(note.current.y).toBe(1);
    expect(note.current.w).toBe(10);
    expect(note.current.h).toBe(10);
    // text preserved (not from prevState, not from confirmedState)
    expect(note.current.text).toBe('typed-after-drag');
    // confirmedState untouched
    expect(note.confirmedState.text).toBe('priorConfirm');
    expect(hooks.onNoteRenderRequested).toHaveBeenCalledWith(id);
  });

  it('pops the latest entry only (subsequent undo gets the prior entry)', () => {
    const id = asServerNoteId('603');
    notes.set(id, makeNote({isServerNote: true}));
    const e1: NoteState = {...BASE, x: 1};
    const e2: NoteState = {...BASE, x: 2};
    pushAction(id, 'edit', e1);
    pushAction(id, 'edit', e2);

    popoverUndo(id);
    expect(notes.get(id)!.current).toEqual(e2);

    popoverUndo(id);
    expect(notes.get(id)!.current).toEqual(e1);
  });

  it('cleans up the empty stack after the last entry is popped', () => {
    const id = asServerNoteId('604');
    notes.set(id, makeNote({isServerNote: true}));
    pushAction(id, 'edit', {...BASE});

    popoverUndo(id);

    expect(actionLog.has(id)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// setMode + enterActiveMode (gen-counter cancellation)
// ---------------------------------------------------------------------------

describe('setMode — basic transitions', () => {
  it('idle → idle is idempotent (no firing)', () => {
    setMode('idle');
    expect(hooks.onModeChanged).not.toHaveBeenCalled();
  });

  it('idle → active fires onModeChanged("active") and bumps activeModeGen', () => {
    const before = getActiveModeGen();
    setMode('active');
    expect(hooks.onModeChanged).toHaveBeenCalledWith('active');
    expect(getActiveModeGen()).toBe(before + 1);
    expect(document.body.classList.contains('dmna-mode-active')).toBe(true);
  });

  it('active → idle bumps gen, runs discardAll, removes body class, fires onModeChanged("idle")', async () => {
    setMode('active');
    // Seed a note so discardAll has something to remove.
    const id = asTempNoteId('temp-mode-cleanup');
    notes.set(id, makeNote());
    vi.mocked(hooks.onNoteRemoved).mockClear();
    vi.mocked(hooks.onModeChanged).mockClear();
    const beforeGen = getActiveModeGen();

    setMode('idle');

    expect(hooks.onModeChanged).toHaveBeenCalledWith('idle');
    expect(getActiveModeGen()).toBe(beforeGen + 1);
    expect(document.body.classList.contains('dmna-mode-active')).toBe(false);
    expect(notes.size).toBe(0);
    expect(hooks.onNoteRemoved).toHaveBeenCalledWith(id);

    // Drain microtasks so the in-flight enterActiveMode (started by the
    // earlier setMode('active')) hits its gen check and exits silently.
    await Promise.resolve();
    await Promise.resolve();
  });
});

describe('enterActiveMode — gen-counter cancellation', () => {
  it('a fast off-toggle while fetchPostMeta is in flight prevents addServerNote calls', async () => {
    let resolveMeta!: (v: {width: number; height: number}) => void;
    vi.mocked(fetchPostMeta).mockReturnValueOnce(
      new Promise<{width: number; height: number}>(r => {
        resolveMeta = r;
      }),
    );
    vi.mocked(fetchServerNotes).mockResolvedValue([
      {
        id: 1,
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        body: '',
      } as ServerNoteDescriptor,
    ]);

    setMode('active');
    setMode('idle'); // bumps gen → next await tick cancels

    resolveMeta({width: 0, height: 0});
    await Promise.resolve();
    await Promise.resolve();

    // Should NOT have hit fetchServerNotes (mode/gen mismatch caught
    // it after fetchPostMeta resolved).
    expect(fetchServerNotes).not.toHaveBeenCalled();
    expect(notes.size).toBe(0);
  });

  it('a fast off-toggle while fetchServerNotes is in flight prevents the addServerNote loop', async () => {
    let resolveServerNotes!: (notes: ServerNoteDescriptor[]) => void;
    vi.mocked(fetchServerNotes).mockReturnValueOnce(
      new Promise<ServerNoteDescriptor[]>(r => {
        resolveServerNotes = r;
      }),
    );

    setMode('active');
    // Allow fetchPostMeta to resolve and enterActiveMode to advance to
    // the fetchServerNotes await.
    await Promise.resolve();
    await Promise.resolve();

    setMode('idle'); // gen bumps before fetchServerNotes resolves

    resolveServerNotes([
      {
        id: 99,
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        body: '',
      } as ServerNoteDescriptor,
    ]);
    await Promise.resolve();
    await Promise.resolve();

    expect(notes.size).toBe(0);
    expect(notes.has(asServerNoteId(99))).toBe(false);
  });

  it('happy path: fetches resolve while gen unchanged → server notes are added', async () => {
    vi.mocked(fetchServerNotes).mockResolvedValueOnce([
      {
        id: 7,
        x: 1,
        y: 2,
        width: 3,
        height: 4,
        body: 'srv',
      } as ServerNoteDescriptor,
    ]);

    setMode('active');
    // Drain the two awaits inside enterActiveMode.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(notes.has(asServerNoteId(7))).toBe(true);
    expect(notes.get(asServerNoteId(7))!.current).toEqual({
      x: 1,
      y: 2,
      w: 3,
      h: 4,
      text: 'srv',
    });
  });

  it('fetchPostMeta rejection emits a toast and aborts (no server-note fetch)', async () => {
    const err = new Error('meta down');
    vi.mocked(fetchPostMeta).mockRejectedValueOnce(err);

    setMode('active');
    await Promise.resolve();
    await Promise.resolve();

    expect(hooks.onToast).toHaveBeenCalledWith(
      '⚠️ Failed to load image info',
      'error',
      err,
    );
    expect(fetchServerNotes).not.toHaveBeenCalled();
  });

  it('fetchServerNotes rejection emits a toast and leaves the collection empty', async () => {
    const err = new Error('notes down');
    vi.mocked(fetchServerNotes).mockRejectedValueOnce(err);

    setMode('active');
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(hooks.onToast).toHaveBeenCalledWith(
      '⚠️ Failed to load existing notes',
      'error',
      err,
    );
    expect(notes.size).toBe(0);
  });
});
