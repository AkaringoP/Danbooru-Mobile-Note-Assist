/**
 * Unit tests for src/confirm/batch.ts.
 * vitest globals: describe/it/expect/beforeEach/afterEach/vi — no explicit imports.
 */

import {
  Note,
  NoteState,
  TagDelta,
  asServerNoteId,
  asTempNoteId,
} from '../src/types';
import {
  NotesStoreHooks,
  actionLog,
  initNotesStore,
  notes,
  setActiveNote,
  setMode,
} from '../src/state/notes-store';
import type {
  ClassifiedChanges,
  PendingDelete,
  PendingPost,
  PendingPut,
} from '../src/confirm/classify';

// ---------------------------------------------------------------------------
// Mocks for batch.ts external deps
// ---------------------------------------------------------------------------

vi.mock('../src/api/notes', () => ({
  apiPostNote: vi.fn(),
  apiPutNote: vi.fn(),
  apiDeleteNote: vi.fn(),
  fetchServerNotes: vi.fn(() => Promise.resolve([])),
}));
vi.mock('../src/api/posts', () => ({
  apiPatchPostTags: vi.fn(() => Promise.resolve()),
  fetchPostMeta: vi.fn(() => Promise.resolve({width: 1000, height: 750})),
}));

import {apiDeleteNote, apiPostNote, apiPutNote} from '../src/api/notes';
import {apiPatchPostTags} from '../src/api/posts';

import {
  ConfirmFlowHooks,
  SendBatchResult,
  applyServerStateToLocal,
  buildFailureLines,
  countSendResult,
  getIsSending,
  handleSendResult,
  initConfirmFlow,
  runConfirmFlow,
  sendBatch,
} from '../src/confirm/batch';

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

function makeFlowHooks(): ConfirmFlowHooks {
  return {
    onSendStart: vi.fn(),
    onSendEnd: vi.fn(),
    onNoteRenderRequested: vi.fn(),
    onNoteVisualsChanged: vi.fn(),
    onToast: vi.fn(),
    showTagPopover: vi.fn(() =>
      Promise.resolve<TagDelta | null>({tagsToAdd: [], tagsToRemove: []}),
    ),
  };
}

function makeEmptyResult(): SendBatchResult {
  return {
    successful: {posts: [], puts: [], deletes: []},
    failed: {posts: [], puts: [], deletes: [], tagPatch: null},
  };
}

function makeEmptyClassified(): ClassifiedChanges {
  return {
    posts: [],
    puts: [],
    deletes: [],
    dropped: {
      uncommittedTemps: [],
      softDeletedTemps: [],
      unchangedServer: [],
    },
    hasChanges: false,
  };
}

let storeHooks: NotesStoreHooks;
let flowHooks: ConfirmFlowHooks;

beforeEach(() => {
  notes.clear();
  actionLog.clear();
  storeHooks = makeStoreHooks();
  initNotesStore(storeHooks);
  setActiveNote(null);
  flowHooks = makeFlowHooks();
  initConfirmFlow(flowHooks);
  // Don't reset document.body — confirm-batch's error-modal singleton
  // (module-level errorModalElement) is created lazily and reused
  // across runs. Wiping body would detach it without clearing the
  // module reference, and createErrorModal's idempotent check would
  // then skip re-attachment. Backdrop/modal classes are toggled per
  // open/close, so leaving the element parked in body is fine.
  vi.mocked(apiPostNote).mockReset();
  vi.mocked(apiPutNote).mockReset();
  vi.mocked(apiDeleteNote).mockReset();
  vi.mocked(apiPatchPostTags).mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  if (document.body.classList.contains('dmna-mode-active')) {
    setMode('idle');
  }
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// getIsSending — UI lock state across sendBatch
// ---------------------------------------------------------------------------

describe('getIsSending', () => {
  it('is false at module load + idle state', () => {
    expect(getIsSending()).toBe(false);
  });

  it('flips true during sendBatch and back to false on completion', async () => {
    vi.mocked(apiDeleteNote).mockImplementation(async () => {
      // While the await is pending, isSending should already be true.
      expect(getIsSending()).toBe(true);
      return null;
    });

    const classified: ClassifiedChanges = {
      ...makeEmptyClassified(),
      deletes: [
        {
          noteId: asServerNoteId('1'),
          serverId: asServerNoteId('1'),
        } satisfies PendingDelete,
      ],
      hasChanges: true,
    };

    const promise = sendBatch(classified, null);
    expect(getIsSending()).toBe(true); // still true mid-flight
    await promise;
    expect(getIsSending()).toBe(false);
    expect(flowHooks.onSendStart).toHaveBeenCalledTimes(1);
    expect(flowHooks.onSendEnd).toHaveBeenCalledTimes(1);
  });

  it('flips back to false even if a request rejects (try/finally)', async () => {
    vi.mocked(apiDeleteNote).mockRejectedValue(new Error('boom'));
    const classified: ClassifiedChanges = {
      ...makeEmptyClassified(),
      deletes: [{noteId: asServerNoteId('2'), serverId: '2'} as PendingDelete],
      hasChanges: true,
    };

    const result = await sendBatch(classified, null);
    expect(getIsSending()).toBe(false);
    expect(result.failed.deletes.length).toBe(1);
    expect(result.failed.deletes[0].error).toContain('boom');
  });
});

// ---------------------------------------------------------------------------
// applyServerStateToLocal — D12 re-key, PUT reset, DELETE hard
// ---------------------------------------------------------------------------

describe('applyServerStateToLocal — D12 re-key', () => {
  it('POST success re-keys temp → server id, replaces note, fires render hook', () => {
    const tempId = asTempNoteId('temp-rekey-1');
    const tempState: NoteState = {x: 50, y: 60, w: 70, h: 80, text: 'body'};
    notes.set(tempId, makeNote({current: tempState, initialState: tempState}));
    actionLog.set(tempId, [{noteId: tempId, type: 'create', prevState: null}]);

    const result = makeEmptyResult();
    result.successful.posts = [
      {
        noteId: tempId,
        state: tempState,
        serverResponse: {
          id: 555,
          x: 50,
          y: 60,
          width: 70,
          height: 80,
          body: 'body',
        },
      },
    ];

    applyServerStateToLocal(result);

    const newId = asServerNoteId(555);
    expect(notes.has(tempId)).toBe(false);
    expect(actionLog.has(tempId)).toBe(false);
    const newNote = notes.get(newId)!;
    expect(newNote).toBeDefined();
    expect(newNote.isServerNote).toBe(true);
    expect(newNote.everConfirmed).toBe(true);
    expect(newNote.current).toEqual(tempState);
    expect(newNote.initialState).toEqual(tempState);
    expect(newNote.confirmedState).toEqual(tempState);
    expect(flowHooks.onNoteRenderRequested).toHaveBeenCalledWith(newId);
  });

  it('POST success uses server-echoed values when they differ from sent state (audit C3)', () => {
    const tempId = asTempNoteId('temp-rekey-2');
    const sent: NoteState = {x: 100, y: 200, w: 50, h: 30, text: 'sent'};
    notes.set(tempId, makeNote({current: sent}));
    const result = makeEmptyResult();
    result.successful.posts = [
      {
        noteId: tempId,
        state: sent,
        serverResponse: {
          id: 100,
          x: 99, // server normalized (rounded etc.)
          y: 199,
          width: 49,
          height: 29,
          body: 'sent',
        },
      },
    ];

    applyServerStateToLocal(result);

    const newNote = notes.get(asServerNoteId(100))!;
    expect(newNote.current).toEqual({
      x: 99,
      y: 199,
      w: 49,
      h: 29,
      text: 'sent',
    });
  });

  it('POST success skips items with null serverResponse', () => {
    const tempId = asTempNoteId('temp-skip-null');
    notes.set(tempId, makeNote());
    const result = makeEmptyResult();
    result.successful.posts = [
      {
        noteId: tempId,
        state: {...BASE},
        serverResponse: null,
      },
    ];

    applyServerStateToLocal(result);

    expect(notes.has(tempId)).toBe(true); // not re-keyed
    expect(flowHooks.onNoteRenderRequested).not.toHaveBeenCalled();
  });

  it('POST success skips items with non-numeric serverResponse.id', () => {
    const tempId = asTempNoteId('temp-skip-nan');
    notes.set(tempId, makeNote());
    const result = makeEmptyResult();
    result.successful.posts = [
      {
        noteId: tempId,
        state: {...BASE},
        serverResponse: {id: undefined, x: 0, y: 0, width: 0, height: 0},
      },
    ];

    applyServerStateToLocal(result);

    expect(notes.has(tempId)).toBe(true);
  });

  it('PUT success resets initialState/confirmedState + clears actionLog + fires visuals hook', () => {
    const id = asServerNoteId('300');
    const sent: NoteState = {x: 5, y: 5, w: 50, h: 50, text: 'PUT'};
    notes.set(
      id,
      makeNote({
        isServerNote: true,
        current: sent,
        initialState: {...BASE},
        confirmedState: {...BASE},
      }),
    );
    actionLog.set(id, [{noteId: id, type: 'edit', prevState: {...BASE}}]);

    const result = makeEmptyResult();
    result.successful.puts = [
      {
        noteId: id,
        serverId: '300',
        state: sent,
        textChanged: true,
      } as PendingPut,
    ];

    applyServerStateToLocal(result);

    const note = notes.get(id)!;
    expect(note.initialState).toEqual(sent);
    expect(note.confirmedState).toEqual(sent);
    expect(actionLog.has(id)).toBe(false);
    expect(flowHooks.onNoteVisualsChanged).toHaveBeenCalledWith(id);
  });

  it('DELETE success hard-deletes the note', () => {
    const id = asServerNoteId('400');
    notes.set(id, makeNote({isServerNote: true, isDeleted: true}));
    actionLog.set(id, [{noteId: id, type: 'delete', prevState: {...BASE}}]);

    const result = makeEmptyResult();
    result.successful.deletes = [
      {noteId: id, serverId: '400'} as PendingDelete,
    ];

    applyServerStateToLocal(result);

    expect(notes.has(id)).toBe(false);
    expect(actionLog.has(id)).toBe(false);
  });

  it('mixed POST + PUT + DELETE flow: each bucket processed independently', () => {
    const tempId = asTempNoteId('temp-mixed');
    const putId = asServerNoteId('500');
    const delId = asServerNoteId('501');
    notes.set(tempId, makeNote());
    notes.set(
      putId,
      makeNote({
        isServerNote: true,
        current: {...BASE, x: 1},
        initialState: {...BASE},
      }),
    );
    notes.set(delId, makeNote({isServerNote: true, isDeleted: true}));

    const result = makeEmptyResult();
    result.successful.posts = [
      {
        noteId: tempId,
        state: {...BASE},
        serverResponse: {
          id: 600,
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          body: '',
        },
      },
    ];
    result.successful.puts = [
      {
        noteId: putId,
        serverId: '500',
        state: {...BASE, x: 1},
        textChanged: false,
      } as PendingPut,
    ];
    result.successful.deletes = [
      {noteId: delId, serverId: '501'} as PendingDelete,
    ];

    applyServerStateToLocal(result);

    expect(notes.has(tempId)).toBe(false);
    expect(notes.has(asServerNoteId(600))).toBe(true);
    expect(notes.get(putId)!.initialState.x).toBe(1);
    expect(notes.has(delId)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// runConfirmFlow — 3 abort branches + happy path
// ---------------------------------------------------------------------------

describe('runConfirmFlow — abort branches', () => {
  it('classified.hasChanges === false → toast "No changes to confirm" + early return', async () => {
    // Empty notes Map → classifyChanges() returns hasChanges=false.
    await runConfirmFlow();

    expect(flowHooks.onToast).toHaveBeenCalledWith(
      'No changes to confirm',
      'info',
    );
    expect(flowHooks.showTagPopover).not.toHaveBeenCalled();
    expect(apiPostNote).not.toHaveBeenCalled();
    expect(apiPutNote).not.toHaveBeenCalled();
    expect(apiDeleteNote).not.toHaveBeenCalled();
  });

  it('showTagPopover returns null (cancel or fetch failure) → silent abort, no sendBatch', async () => {
    // Seed a temp note that will trigger needsTagPopover (POST).
    const tempId = asTempNoteId('temp-abort-1');
    notes.set(
      tempId,
      makeNote({isServerNote: false, everConfirmed: true, isDeleted: false}),
    );
    vi.mocked(flowHooks.showTagPopover).mockResolvedValueOnce(null);

    await runConfirmFlow();

    expect(flowHooks.showTagPopover).toHaveBeenCalledTimes(1);
    expect(apiPostNote).not.toHaveBeenCalled();
    expect(flowHooks.onToast).not.toHaveBeenCalled();
  });

  it('happy path: classify → showTagPopover (delta) → sendBatch → handleSendResult (success)', async () => {
    vi.useFakeTimers();
    const tempId = asTempNoteId('temp-happy-1');
    notes.set(
      tempId,
      makeNote({isServerNote: false, everConfirmed: true, isDeleted: false}),
    );
    vi.mocked(flowHooks.showTagPopover).mockResolvedValueOnce({
      tagsToAdd: ['translated'],
      tagsToRemove: [],
    });
    vi.mocked(apiPostNote).mockResolvedValue({
      id: 700,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      body: '',
    });

    const reloadSpy = vi.fn();
    Object.defineProperty(window.location, 'reload', {
      value: reloadSpy,
      configurable: true,
    });

    await runConfirmFlow();

    expect(apiPostNote).toHaveBeenCalledTimes(1);
    expect(apiPatchPostTags).toHaveBeenCalledWith(['translated'], []);
    expect(flowHooks.onToast).toHaveBeenCalledWith('✓ Saved', 'success');
    expect(notes.has(asServerNoteId(700))).toBe(true);

    // setTimeout(reload, 1000) — drive timer
    vi.advanceTimersByTime(1000);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('isSending guard: re-entry while a previous flow is mid-flight is a silent no-op', async () => {
    let resolveDelete!: () => void;
    vi.mocked(apiDeleteNote).mockReturnValueOnce(
      new Promise<null>(r => {
        resolveDelete = () => r(null);
      }),
    );
    const id = asServerNoteId('800');
    notes.set(id, makeNote({isServerNote: true, isDeleted: true}));

    const first = runConfirmFlow();
    // Start a second invocation while first is mid-DELETE.
    await Promise.resolve();
    const second = runConfirmFlow();
    await second;
    // Second should have early-returned without invoking showTagPopover
    // a second time (or any additional API call).
    expect(apiDeleteNote).toHaveBeenCalledTimes(1);

    resolveDelete();
    await first;
  });
});

// ---------------------------------------------------------------------------
// handleSendResult — success vs partial vs all-fail
// ---------------------------------------------------------------------------

describe('handleSendResult', () => {
  it('full success: clears actionLog + fires success toast + setTimeout reload (1s)', async () => {
    vi.useFakeTimers();
    actionLog.set(asServerNoteId('900'), [
      {noteId: asServerNoteId('900'), type: 'edit', prevState: {...BASE}},
    ]);
    const reloadSpy = vi.fn();
    Object.defineProperty(window.location, 'reload', {
      value: reloadSpy,
      configurable: true,
    });

    const result = makeEmptyResult();
    await handleSendResult(result, null);

    expect(actionLog.size).toBe(0);
    expect(flowHooks.onToast).toHaveBeenCalledWith('✓ Saved', 'success');

    expect(reloadSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('partial failure: opens error modal, no reload, no actionLog clear', async () => {
    actionLog.set(asServerNoteId('1000'), [
      {noteId: asServerNoteId('1000'), type: 'edit', prevState: {...BASE}},
    ]);

    const result = makeEmptyResult();
    result.failed.posts = [
      {
        noteId: asTempNoteId('temp-fail'),
        state: {...BASE},
        error: 'boom',
      } as PendingPost & {error: string},
    ];

    // Schedule modal-cancel: as soon as the modal renders, click cancel.
    const promise = handleSendResult(result, null);
    await Promise.resolve();
    await Promise.resolve();
    const cancelBtn = document.querySelector(
      '#dmna-error-modal .dmna-error-modal-btn[data-action="cancel"]',
    ) as HTMLButtonElement | null;
    expect(cancelBtn).not.toBeNull();
    cancelBtn!.click();

    await promise;
    // actionLog NOT cleared on cancel
    expect(actionLog.has(asServerNoteId('1000'))).toBe(true);
    // No success toast
    expect(flowHooks.onToast).not.toHaveBeenCalledWith('✓ Saved', 'success');
  });

  it('partial failure → Retry path: re-classifies + re-sends; tagDelta dropped if tagPatch had succeeded', async () => {
    // Seed a temp note that classifyChanges() would route to posts on retry.
    const tempId = asTempNoteId('temp-retry-1');
    notes.set(
      tempId,
      makeNote({isServerNote: false, everConfirmed: true, isDeleted: false}),
    );

    // First result: tagPatch succeeded, but a POST failed. The stored
    // failed POST is for the still-pending temp note.
    const result = makeEmptyResult();
    result.failed.posts = [
      {
        noteId: tempId,
        state: {...BASE},
        error: 'boom',
      } as PendingPost & {error: string},
    ];

    // The retry's sendBatch should use null tagDelta (tagPatch had
    // succeeded — no need to re-PATCH).
    vi.mocked(apiPostNote).mockResolvedValueOnce({
      id: 1100,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      body: '',
    });

    const promise = handleSendResult(result, {
      tagsToAdd: ['translated'],
      tagsToRemove: [],
    });
    await Promise.resolve();
    await Promise.resolve();
    const retryBtn = document.querySelector(
      '#dmna-error-modal .dmna-error-modal-btn[data-action="retry"]',
    ) as HTMLButtonElement | null;
    expect(retryBtn).not.toBeNull();
    retryBtn!.click();

    // Drive the retry sendBatch through.
    vi.useFakeTimers();
    const reloadSpy = vi.fn();
    Object.defineProperty(window.location, 'reload', {
      value: reloadSpy,
      configurable: true,
    });
    await promise;
    expect(apiPostNote).toHaveBeenCalledTimes(1);
    // tagPatch should NOT be called again (it had succeeded the first time)
    expect(apiPatchPostTags).not.toHaveBeenCalled();
    // The retry POSTed the temp → it's now the server note
    expect(notes.has(asServerNoteId(1100))).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(reloadSpy).toHaveBeenCalled();
  });

  it('partial failure → Retry path: tagPatch failure carries delta forward into retry', async () => {
    // No notes left to send — only tagPatch failed last time. Retry
    // should re-attempt the tag PATCH with the original delta.
    const result = makeEmptyResult();
    result.failed.tagPatch = 'tag boom';

    vi.mocked(apiPatchPostTags).mockResolvedValueOnce(undefined as unknown);

    const promise = handleSendResult(result, {
      tagsToAdd: ['translated'],
      tagsToRemove: [],
    });
    await Promise.resolve();
    await Promise.resolve();
    const retryBtn = document.querySelector(
      '#dmna-error-modal .dmna-error-modal-btn[data-action="retry"]',
    ) as HTMLButtonElement | null;
    cancelOrRetry(retryBtn, 'retry');

    vi.useFakeTimers();
    const reloadSpy = vi.fn();
    Object.defineProperty(window.location, 'reload', {
      value: reloadSpy,
      configurable: true,
    });
    await promise;
    expect(apiPatchPostTags).toHaveBeenCalledWith(['translated'], []);
    vi.advanceTimersByTime(1000);
    expect(reloadSpy).toHaveBeenCalled();
  });

  it('partial failure → Retry path with nothing left → "Nothing left to retry" toast', async () => {
    // tagPatch was the only failure, but caller passes null tagDelta:
    // retryTagDelta = result.failed.tagPatch ? tagDelta : null = null.
    // newClassified is empty (no notes seeded). So retry has nothing.
    const result = makeEmptyResult();
    result.failed.tagPatch = 'tag boom';

    const promise = handleSendResult(result, null);
    await Promise.resolve();
    await Promise.resolve();
    const retryBtn = document.querySelector(
      '#dmna-error-modal .dmna-error-modal-btn[data-action="retry"]',
    ) as HTMLButtonElement | null;
    cancelOrRetry(retryBtn, 'retry');

    await promise;
    expect(flowHooks.onToast).toHaveBeenCalledWith(
      'Nothing left to retry',
      'info',
    );
  });
});

function cancelOrRetry(
  btn: HTMLButtonElement | null,
  action: 'retry' | 'cancel',
): void {
  expect(btn).not.toBeNull();
  expect(btn!.dataset.action).toBe(action);
  btn!.click();
}

// ---------------------------------------------------------------------------
// buildFailureLines + countSendResult (display formatting)
// ---------------------------------------------------------------------------

describe('buildFailureLines', () => {
  it('returns empty array on no failures', () => {
    expect(buildFailureLines(makeEmptyResult())).toEqual([]);
  });

  it('orders deletes → puts → posts → tagPatch (matches sendBatch send order)', () => {
    const result = makeEmptyResult();
    result.failed.deletes = [
      {
        noteId: asServerNoteId('1'),
        serverId: '1',
        error: 'd-err',
      } as PendingDelete & {error: string},
    ];
    result.failed.puts = [
      {
        noteId: asServerNoteId('2'),
        serverId: '2',
        state: {...BASE},
        textChanged: false,
        error: 'p-err',
      } as PendingPut & {error: string},
    ];
    result.failed.posts = [
      {
        noteId: asTempNoteId('temp-x'),
        state: {...BASE},
        error: 'po-err',
      } as PendingPost & {error: string},
    ];
    result.failed.tagPatch = 'tag-err';

    const lines = buildFailureLines(result);
    expect(lines).toEqual([
      'DELETE note 1: d-err',
      'PUT note 2: p-err',
      'POST new note: po-err',
      'Tag PATCH: tag-err',
    ]);
  });
});

describe('countSendResult', () => {
  it('all empty → 0/0', () => {
    expect(countSendResult(makeEmptyResult())).toEqual({
      successCount: 0,
      failureCount: 0,
    });
  });

  it('counts success + failure across groups; tagPatch failure adds 1 to failureCount', () => {
    const result = makeEmptyResult();
    result.successful.posts = [
      {} as PendingPost & {serverResponse: null},
      {} as PendingPost & {serverResponse: null},
    ];
    result.successful.puts = [{} as PendingPut];
    result.successful.deletes = [{} as PendingDelete];
    result.failed.deletes = [
      {} as PendingDelete & {error: string},
      {} as PendingDelete & {error: string},
    ];
    result.failed.tagPatch = 'tag failed';

    expect(countSendResult(result)).toEqual({
      successCount: 4, // 2 posts + 1 put + 1 delete
      failureCount: 3, // 2 delete failures + 1 tagPatch
    });
  });
});
