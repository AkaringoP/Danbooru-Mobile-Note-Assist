/**
 * Unit tests for src/confirm/classify.ts.
 * vitest globals: describe/it/expect/beforeEach — no explicit imports needed.
 */

import {Note, NoteState, asTempNoteId, asServerNoteId} from '../src/types';
import {
  hasPendingChanges,
  classifyChanges,
  needsTagPopover,
  ClassifiedChanges,
  PendingPut,
} from '../src/confirm/classify';
import {notes} from '../src/state/notes-store';

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

/**
 * Build a ClassifiedChanges literal for needsTagPopover tests without
 * going through classifyChanges — keeps cases atomic.
 */
function makeClassified(
  overrides: Partial<ClassifiedChanges> = {},
): ClassifiedChanges {
  return {
    posts: [],
    puts: [],
    deletes: [],
    dropped: {uncommittedTemps: [], softDeletedTemps: [], unchangedServer: []},
    hasChanges: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// classifyChanges — D8 routing
// ---------------------------------------------------------------------------

describe('classifyChanges — D8 routing', () => {
  beforeEach(() => notes.clear());

  it('routes temp + everConfirmed + alive to posts', () => {
    const id = asTempNoteId('temp-fixture-post');
    notes.set(
      id,
      makeNote({isServerNote: false, everConfirmed: true, isDeleted: false}),
    );

    const c = classifyChanges();

    expect(c.posts.length).toBe(1);
    expect(c.posts[0].noteId).toBe(id);
    expect(c.posts[0].state).toEqual(BASE);
    expect(c.puts.length).toBe(0);
    expect(c.deletes.length).toBe(0);
    expect(c.dropped.uncommittedTemps.length).toBe(0);
    expect(c.dropped.softDeletedTemps.length).toBe(0);
    expect(c.dropped.unchangedServer.length).toBe(0);
    expect(c.hasChanges).toBe(true);
  });

  it('routes temp + !everConfirmed + alive to dropped.uncommittedTemps', () => {
    const id = asTempNoteId('temp-fixture-uncommitted');
    notes.set(
      id,
      makeNote({isServerNote: false, everConfirmed: false, isDeleted: false}),
    );

    const c = classifyChanges();

    expect(c.dropped.uncommittedTemps.length).toBe(1);
    expect(c.dropped.uncommittedTemps[0]).toBe(id);
    expect(c.posts.length).toBe(0);
    expect(c.hasChanges).toBe(false);
  });

  it('routes temp + everConfirmed + soft-deleted to dropped.softDeletedTemps', () => {
    const id = asTempNoteId('temp-fixture-softdel');
    notes.set(
      id,
      makeNote({isServerNote: false, everConfirmed: true, isDeleted: true}),
    );

    const c = classifyChanges();

    expect(c.dropped.softDeletedTemps.length).toBe(1);
    expect(c.dropped.softDeletedTemps[0]).toBe(id);
    expect(c.hasChanges).toBe(false);
  });

  it('routes server + dirty (geom-only) + alive to puts with textChanged=false', () => {
    const id = asServerNoteId('100');
    notes.set(
      id,
      makeNote({
        isServerNote: true,
        isDeleted: false,
        current: {...BASE, x: 999},
        initialState: {...BASE},
      }),
    );

    const c = classifyChanges();

    expect(c.puts.length).toBe(1);
    expect(c.puts[0].textChanged).toBe(false);
    expect(c.puts[0].serverId).toBe(id);
    // state should be a copy of current, not a reference to the live Note
    expect(c.puts[0].state).toEqual({...BASE, x: 999});
    expect(c.hasChanges).toBe(true);
  });

  it('routes server + clean to dropped.unchangedServer', () => {
    const id = asServerNoteId('200');
    notes.set(
      id,
      makeNote({
        isServerNote: true,
        isDeleted: false,
        current: {...BASE},
        initialState: {...BASE},
      }),
    );

    const c = classifyChanges();

    expect(c.dropped.unchangedServer.length).toBe(1);
    expect(c.dropped.unchangedServer[0]).toBe(id);
    expect(c.hasChanges).toBe(false);
  });

  it('routes server + soft-deleted to deletes', () => {
    const id = asServerNoteId('300');
    notes.set(id, makeNote({isServerNote: true, isDeleted: true}));

    const c = classifyChanges();

    expect(c.deletes.length).toBe(1);
    expect(c.deletes[0].serverId).toBe(id);
    expect(c.hasChanges).toBe(true);
  });

  it('Wave 3.5 silent-drop: temp + !everConfirmed + soft-deleted → softDeletedTemps (no POST)', () => {
    const id = asTempNoteId('temp-fixture-never-confirmed-del');
    notes.set(
      id,
      makeNote({isServerNote: false, everConfirmed: false, isDeleted: true}),
    );

    const c = classifyChanges();

    expect(c.dropped.softDeletedTemps.length).toBe(1);
    expect(c.posts.length).toBe(0);
    expect(c.hasChanges).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// classifyChanges — auxiliary properties
// ---------------------------------------------------------------------------

describe('classifyChanges — auxiliary properties', () => {
  beforeEach(() => notes.clear());

  it('puts[i].textChanged === true when only text differs', () => {
    const id = asServerNoteId('401');
    notes.set(
      id,
      makeNote({
        isServerNote: true,
        isDeleted: false,
        current: {...BASE, text: 'edited'},
        initialState: {...BASE, text: ''},
      }),
    );

    const c = classifyChanges();

    expect(c.puts.length).toBe(1);
    expect(c.puts[0].textChanged).toBe(true);
  });

  it('puts[i].textChanged === true when text and geometry both differ', () => {
    const id = asServerNoteId('402');
    notes.set(
      id,
      makeNote({
        isServerNote: true,
        isDeleted: false,
        current: {...BASE, x: 50, text: 'new text'},
        initialState: {...BASE},
      }),
    );

    const c = classifyChanges();

    expect(c.puts.length).toBe(1);
    expect(c.puts[0].textChanged).toBe(true);
  });

  it('posts[i].state is a copy — mutating it does not affect the live note', () => {
    const id = asTempNoteId('temp-fixture-isolation');
    notes.set(
      id,
      makeNote({isServerNote: false, everConfirmed: true, isDeleted: false}),
    );

    const c = classifyChanges();
    c.posts[0].state.x = 999;

    expect(notes.get(id)!.current.x).toBe(0);
  });

  it('all six D8 buckets filled simultaneously with distinct notes', () => {
    const postId = asTempNoteId('temp-all-post');
    const uncommittedId = asTempNoteId('temp-all-uncommitted');
    const softDelTempId = asTempNoteId('temp-all-softdel');
    const putId = asServerNoteId('501');
    const unchangedId = asServerNoteId('502');
    const deleteId = asServerNoteId('503');

    notes.set(
      postId,
      makeNote({isServerNote: false, everConfirmed: true, isDeleted: false}),
    );
    notes.set(
      uncommittedId,
      makeNote({isServerNote: false, everConfirmed: false, isDeleted: false}),
    );
    notes.set(
      softDelTempId,
      makeNote({isServerNote: false, everConfirmed: true, isDeleted: true}),
    );
    notes.set(
      putId,
      makeNote({
        isServerNote: true,
        isDeleted: false,
        current: {...BASE, y: 50},
        initialState: {...BASE},
      }),
    );
    notes.set(unchangedId, makeNote({isServerNote: true, isDeleted: false}));
    notes.set(deleteId, makeNote({isServerNote: true, isDeleted: true}));

    const c = classifyChanges();

    expect(c.posts.length).toBe(1);
    expect(c.posts[0].noteId).toBe(postId);

    expect(c.dropped.uncommittedTemps.length).toBe(1);
    expect(c.dropped.uncommittedTemps[0]).toBe(uncommittedId);

    expect(c.dropped.softDeletedTemps.length).toBe(1);
    expect(c.dropped.softDeletedTemps[0]).toBe(softDelTempId);

    expect(c.puts.length).toBe(1);
    expect(c.puts[0].noteId).toBe(putId);

    expect(c.dropped.unchangedServer.length).toBe(1);
    expect(c.dropped.unchangedServer[0]).toBe(unchangedId);

    expect(c.deletes.length).toBe(1);
    expect(c.deletes[0].noteId).toBe(deleteId);

    expect(c.hasChanges).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// hasPendingChanges
// ---------------------------------------------------------------------------

describe('hasPendingChanges', () => {
  beforeEach(() => notes.clear());

  it('returns false for empty collection', () => {
    expect(hasPendingChanges()).toBe(false);
  });

  it('returns false when only clean server notes (unchangedServer)', () => {
    notes.set(
      asServerNoteId('600'),
      makeNote({isServerNote: true, isDeleted: false}),
    );
    expect(hasPendingChanges()).toBe(false);
  });

  it('returns false when only uncommitted temps', () => {
    notes.set(
      asTempNoteId('temp-hpc-uncommitted'),
      makeNote({isServerNote: false, everConfirmed: false, isDeleted: false}),
    );
    expect(hasPendingChanges()).toBe(false);
  });

  it('returns false when only soft-deleted temps', () => {
    notes.set(
      asTempNoteId('temp-hpc-softdel'),
      makeNote({isServerNote: false, everConfirmed: true, isDeleted: true}),
    );
    expect(hasPendingChanges()).toBe(false);
  });

  it('returns true when a POST-bound note exists', () => {
    notes.set(
      asTempNoteId('temp-hpc-post'),
      makeNote({isServerNote: false, everConfirmed: true, isDeleted: false}),
    );
    expect(hasPendingChanges()).toBe(true);
  });

  it('returns true when a PUT-bound note exists', () => {
    notes.set(
      asServerNoteId('700'),
      makeNote({
        isServerNote: true,
        isDeleted: false,
        current: {...BASE, w: 200},
        initialState: {...BASE},
      }),
    );
    expect(hasPendingChanges()).toBe(true);
  });

  it('returns true when a DELETE-bound note exists', () => {
    notes.set(
      asServerNoteId('701'),
      makeNote({isServerNote: true, isDeleted: true}),
    );
    expect(hasPendingChanges()).toBe(true);
  });

  it('returns true with mixed (one post + several drops)', () => {
    notes.set(
      asTempNoteId('temp-hpc-mix-post'),
      makeNote({isServerNote: false, everConfirmed: true, isDeleted: false}),
    );
    notes.set(
      asServerNoteId('710'),
      makeNote({isServerNote: true, isDeleted: false}),
    );
    notes.set(
      asTempNoteId('temp-hpc-mix-uncommitted'),
      makeNote({isServerNote: false, everConfirmed: false, isDeleted: false}),
    );
    expect(hasPendingChanges()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// needsTagPopover — D9 trigger rules
// ---------------------------------------------------------------------------

describe('needsTagPopover — D9 trigger rules', () => {
  beforeEach(() => notes.clear());

  it('returns false for empty classified changes', () => {
    expect(needsTagPopover(makeClassified())).toBe(false);
  });

  it('returns true when there is 1 post', () => {
    const id = asTempNoteId('temp-ntp-post');
    expect(
      needsTagPopover(
        makeClassified({
          posts: [{noteId: id, state: {...BASE}}],
          hasChanges: true,
        }),
      ),
    ).toBe(true);
  });

  it('returns true when there is 1 delete', () => {
    const id = asServerNoteId('800');
    expect(
      needsTagPopover(
        makeClassified({
          deletes: [{noteId: id, serverId: id}],
          hasChanges: true,
        }),
      ),
    ).toBe(true);
  });

  it('returns true when there is a put with textChanged=true', () => {
    const id = asServerNoteId('801');
    const put: PendingPut = {
      noteId: id,
      serverId: id,
      state: {...BASE, text: 'new'},
      textChanged: true,
    };
    expect(
      needsTagPopover(makeClassified({puts: [put], hasChanges: true})),
    ).toBe(true);
  });

  it('returns false when there is only a geom-only put (textChanged=false)', () => {
    const id = asServerNoteId('802');
    const put: PendingPut = {
      noteId: id,
      serverId: id,
      state: {...BASE, x: 50},
      textChanged: false,
    };
    expect(
      needsTagPopover(makeClassified({puts: [put], hasChanges: true})),
    ).toBe(false);
  });

  it('returns true for mixed geom-only put + 1 post', () => {
    const tempId = asTempNoteId('temp-ntp-mixed');
    const serverId = asServerNoteId('803');
    const put: PendingPut = {
      noteId: serverId,
      serverId,
      state: {...BASE, h: 200},
      textChanged: false,
    };
    expect(
      needsTagPopover(
        makeClassified({
          posts: [{noteId: tempId, state: {...BASE}}],
          puts: [put],
          hasChanges: true,
        }),
      ),
    ).toBe(true);
  });

  it('returns false for two geom-only puts with no posts or deletes', () => {
    const id1 = asServerNoteId('901');
    const id2 = asServerNoteId('902');
    const put1: PendingPut = {
      noteId: id1,
      serverId: id1,
      state: {...BASE, x: 10},
      textChanged: false,
    };
    const put2: PendingPut = {
      noteId: id2,
      serverId: id2,
      state: {...BASE, y: 20},
      textChanged: false,
    };
    expect(
      needsTagPopover(makeClassified({puts: [put1, put2], hasChanges: true})),
    ).toBe(false);
  });
});
