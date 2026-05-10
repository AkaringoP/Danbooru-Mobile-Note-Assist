/**
 * Confirm-time batch send + result handling + error modal (Layer 3).
 *
 * Owns the full Confirm flow:
 *   - `runConfirmFlow` (entry from arc-menu's ✅ item)
 *   - tag-popover gating (D9, via injected hook)
 *   - `sendBatch` (DELETE → PUT → POST → tag PATCH order)
 *   - `applyServerStateToLocal` (re-key temp → server id, refresh
 *     baselines, prune actionLog)
 *   - error modal DOM (D12 + D13: Retry / Cancel UX with
 *     re-classification on retry)
 *   - in-flight UI lock state (`isSending`)
 *
 * Z5 layer: confirm/ may import state/, api/, types/, config/, but
 * NOT ui/. UI side-effects (close arc menu on send-start, swap
 * floating button icon, render new boxes after POST, refresh visuals
 * after PUT, toast on success, show tag popover) are delegated via
 * `ConfirmFlowHooks` injected by `main.ts` at boot.
 *
 * `isSending` is module-private state but exposed via `getIsSending`
 * for cross-module re-entrancy gates (interactions/keyboard.ts and
 * box-click handlers consult it).
 */

import {SCRIPT_NAME} from '../config';
import {asServerNoteId, Note, NoteId, NoteState, TagDelta} from '../types';
import {
  notes,
  actionLog,
  hardDeleteNote,
  setMode,
  setActiveNote,
} from '../state/notes-store';
import {
  apiPostNote,
  apiPutNote,
  apiDeleteNote,
  ServerNoteResponse,
} from '../api/notes';
import {apiPatchPostTags} from '../api/posts';
import {
  classifyChanges,
  needsTagPopover,
  ClassifiedChanges,
  PendingPost,
  PendingPut,
  PendingDelete,
} from './classify';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Toast severity. Wider than NotesStoreHooks' set — Confirm uses 'success'. */
type ToastLevel = 'info' | 'success' | 'warning' | 'error';

// `TagDelta` was inline here in Task 1.7; moved to types.ts in
// Task 1.12 so ui/tag-popover and confirm/batch share a single
// definition without introducing a ui→confirm same-layer import.
// Re-exported below for back-compat with anyone who imports it
// from this module.
export type {TagDelta};

export type SuccessfulPost = PendingPost & {
  serverResponse: ServerNoteResponse | null;
};
export type FailedPost = PendingPost & {error: string};
export type FailedPut = PendingPut & {error: string};
export type FailedDelete = PendingDelete & {error: string};

/**
 * Outcome of `sendBatch`. Each item in `classified` ends up in either
 * the matching `successful.*` or `failed.*` array — never both, never
 * neither (apart from skipped-by-classification, which never enter
 * sendBatch).
 *
 * `failed.tagPatch` is the error message string when tag PATCH failed,
 * or `null` when it succeeded / wasn't attempted.
 */
export interface SendBatchResult {
  successful: {
    posts: SuccessfulPost[];
    puts: PendingPut[];
    deletes: PendingDelete[];
  };
  failed: {
    posts: FailedPost[];
    puts: FailedPut[];
    deletes: FailedDelete[];
    tagPatch: string | null;
  };
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * UI side-effects injected at boot by `main.ts`. confirm/batch.ts
 * stays in Layer 3 (no ui/ imports); each hook documents its expected
 * subscriber.
 */
export interface ConfirmFlowHooks {
  /**
   * UI lock engaged at sendBatch entry. Subscribers:
   *   - ui/arc-menu: `closeMenu()` (idempotent if already closed).
   *   - ui/floating-button: swap the icon to '⏳'. Suppresses the
   *     mode-driven '✏️/📝' swap until `onSendEnd`.
   */
  onSendStart: () => void;

  /**
   * UI lock released. Subscribers:
   *   - ui/floating-button: restore the icon based on the current
   *     mode ('✏️' for active, '📝' for idle).
   */
  onSendEnd: () => void;

  /**
   * A note's geometry/text needs re-rendering. Fires from
   * `applyServerStateToLocal` for new server-id boxes after POST.
   * Subscribers:
   *   - ui/note-box: `renderNoteBox(id)`.
   */
  onNoteRenderRequested: (id: NoteId) => void;

  /**
   * A note's metadata changed (dirty class refresh after PUT-clean).
   * Subscribers:
   *   - ui/note-box: `updateNoteVisuals(id)`.
   */
  onNoteVisualsChanged: (id: NoteId) => void;

  /** Status notification. Subscribers: ui/toast.showToast. */
  onToast: (message: string, level: ToastLevel, err?: unknown) => void;

  /**
   * Opens the Confirm-time tag popover (D9). Resolves to the user's
   * add/remove delta on submit, or `null` on cancel (which aborts
   * the entire Confirm flow).
   */
  showTagPopover: () => Promise<TagDelta | null>;
}

let hooks: ConfirmFlowHooks | null = null;

/** Wire hooks at boot; called once by `main.ts`. */
export function initConfirmFlow(h: ConfirmFlowHooks): void {
  hooks = h;
}

// ---------------------------------------------------------------------------
// Module-private state
// ---------------------------------------------------------------------------

/**
 * In-flight Confirm send. Locks all interactive paths (keyboard
 * shortcuts, box clicks, menu) so the user can't mutate state while
 * requests are in flight (PLAN.md Phase 4 D11). Read across modules
 * via `getIsSending`.
 */
let isSending = false;

let errorModalElement: HTMLElement | null = null;
let errorModalBackdropElement: HTMLElement | null = null;
let pendingErrorModalResolver: ((choice: 'retry' | 'cancel') => void) | null =
  null;

/** Cross-module read of the in-flight lock. */
export function getIsSending(): boolean {
  return isSending;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Mirrors v3.1.1's `String(err.message || err)`. Falls through cleanly
 * when err isn't an Error (e.g., a thrown string) and when `.message`
 * is empty.
 */
function errMessage(err: unknown): string {
  return String((err as {message?: unknown})?.message || err);
}

// ---------------------------------------------------------------------------
// UI lock
// ---------------------------------------------------------------------------

/**
 * Engages the in-flight UI lock: ⏳ icon, body class, menu close.
 * setMode-driven icon swap is paused for the duration — endSendingUI
 * restores from the current `mode`.
 */
function startSendingUI(): void {
  isSending = true;
  document.body.classList.add('dmna-sending');
  hooks!.onSendStart();
}

/** Reverses startSendingUI. */
function endSendingUI(): void {
  isSending = false;
  document.body.classList.remove('dmna-sending');
  hooks!.onSendEnd();
}

// ---------------------------------------------------------------------------
// sendBatch — DELETE → PUT → POST → tag PATCH
// ---------------------------------------------------------------------------

/**
 * Sends the classified batch in DELETE → PUT → POST → tag PATCH order.
 * Sequential within each group so a partial failure has a deterministic
 * "which item broke" answer. Tag PATCH is skipped when the delta is
 * empty (pure submit-without-changes).
 *
 * Always engages and releases the UI lock (try/finally); never throws —
 * caller reads the result object. `handleSendResult` interprets it.
 */
export async function sendBatch(
  classified: ClassifiedChanges,
  tagDelta: TagDelta | null,
): Promise<SendBatchResult> {
  const result: SendBatchResult = {
    successful: {posts: [], puts: [], deletes: []},
    failed: {posts: [], puts: [], deletes: [], tagPatch: null},
  };
  startSendingUI();
  try {
    for (const item of classified.deletes) {
      try {
        await apiDeleteNote(item.serverId);
        result.successful.deletes.push(item);
      } catch (err) {
        // The error modal shows result.failed[...].error (a compact
        // string). Log the full Error here so its stack trace is
        // available in the console for cross-referencing — useful
        // when triaging "what actually went wrong" across multiple
        // partial failures in one batch.
        console.error(
          `[${SCRIPT_NAME}] DELETE note ${item.serverId} failed`,
          err,
        );
        result.failed.deletes.push({...item, error: errMessage(err)});
      }
    }
    for (const item of classified.puts) {
      try {
        await apiPutNote(item.serverId, item.state);
        result.successful.puts.push(item);
      } catch (err) {
        console.error(`[${SCRIPT_NAME}] PUT note ${item.serverId} failed`, err);
        result.failed.puts.push({...item, error: errMessage(err)});
      }
    }
    for (const item of classified.posts) {
      try {
        const serverResponse = await apiPostNote(item.state);
        result.successful.posts.push({...item, serverResponse});
      } catch (err) {
        console.error(`[${SCRIPT_NAME}] POST temp ${item.noteId} failed`, err);
        result.failed.posts.push({...item, error: errMessage(err)});
      }
    }
    if (
      tagDelta &&
      (tagDelta.tagsToAdd.length > 0 || tagDelta.tagsToRemove.length > 0)
    ) {
      try {
        await apiPatchPostTags(tagDelta.tagsToAdd, tagDelta.tagsToRemove);
      } catch (err) {
        console.error(`[${SCRIPT_NAME}] tag PATCH failed`, err);
        result.failed.tagPatch = errMessage(err);
      }
    }
  } finally {
    endSendingUI();
  }
  return result;
}

// ---------------------------------------------------------------------------
// Result handling (D12 + D13)
//
// sendBatch() returns; this layer interprets the result:
//
//   - Apply locally what server-confirmed: temp notes that POSTed get
//     re-keyed under their server id and reborn as server notes;
//     PUT'd server notes drop their accumulated dirty/log state;
//     DELETE'd notes leave the local Map. This is the "no double
//     send" guarantee — a Retry from the error modal re-runs
//     classifyChanges and the already-confirmed items are now in the
//     appropriate "skip" buckets.
//
//   - Full success → clear actionLog, toast, brief delay, reload. The
//     reload is deliberate: Danbooru's native note overlays come from
//     server data, and a fresh page is the cheapest way to put them
//     in sync with our just-committed changes.
//
//   - Any failure → error modal. User picks Retry (re-classify and
//     re-send) or Cancel (stay in active mode with the partial state,
//     which now reflects the server's truth).
// ---------------------------------------------------------------------------

/**
 * Reflects sendBatch's successful results onto the local notes Map +
 * actionLog. Failed items are left untouched (their actionLog entries
 * are preserved so per-note ↶ keeps working until the user gives up
 * via Cancel).
 *
 * Exported for unit tests; module-internal otherwise.
 */
export function applyServerStateToLocal(result: SendBatchResult): void {
  // POST: temp note becomes a server note. Replace in-place rather
  // than mutate the existing entry, because the noteId itself is
  // changing (temp- → server numeric id) and the closures inside
  // the rendered DOM/handlers were captured against the old id.
  // Cheaper to re-render than to surgery the closures.
  for (const item of result.successful.posts) {
    const sr = item.serverResponse;
    if (!sr || typeof sr.id !== 'number') {
      continue;
    }
    const serverId = asServerNoteId(sr.id);
    // Use the server's normalized values (post-clamp / post-round)
    // as the new local baseline rather than the locally-rounded copy
    // we sent. Otherwise a Retry path that follows a sibling failure
    // can mis-classify this note as "dirty" because our sent rect
    // and the server's stored rect differ by a pixel (Phase 6 audit
    // C3). Falls back to item.state for any field the server didn't
    // echo, which keeps the path safe across API shape changes.
    const baselineState: NoteState = {
      x: typeof sr.x === 'number' ? sr.x : Math.round(item.state.x),
      y: typeof sr.y === 'number' ? sr.y : Math.round(item.state.y),
      w: typeof sr.width === 'number' ? sr.width : Math.round(item.state.w),
      h: typeof sr.height === 'number' ? sr.height : Math.round(item.state.h),
      text: typeof sr.body === 'string' ? sr.body : item.state.text || '',
    };
    // Drop the temp side first (DOM gone, Map gone, actionLog
    // entries gone). Then add the fresh server-note entry under
    // the new id and render it.
    hardDeleteNote(item.noteId);
    const newNote: Note = {
      current: {...baselineState},
      initialState: {...baselineState},
      confirmedState: {...baselineState},
      isDeleted: false,
      isServerNote: true,
      everConfirmed: true,
      domElement: null,
    };
    notes.set(serverId, newNote);
    hooks!.onNoteRenderRequested(serverId);
  }
  // PUT: the just-sent state is now the server's truth. Reset
  // initialState so the next isDirty/classifyChanges sees a clean
  // baseline. Strip any actionLog history for this note (it can no
  // longer be undone — it's persisted).
  for (const item of result.successful.puts) {
    const note = notes.get(item.noteId);
    if (!note) {
      continue;
    }
    note.initialState = {...note.current};
    note.confirmedState = {...note.current};
    actionLog.delete(item.noteId);
    hooks!.onNoteVisualsChanged(item.noteId);
  }
  // DELETE: nuke locally too.
  for (const item of result.successful.deletes) {
    hardDeleteNote(item.noteId);
  }
}

/**
 * Builds the human-readable failure list for the error modal.
 * Each line: `<METHOD> <id-or-target>: <error>`. Ordered to match
 * sendBatch's send order (deletes → puts → posts → tagPatch).
 *
 * Exported for unit tests; module-internal otherwise.
 */
export function buildFailureLines(result: SendBatchResult): string[] {
  const lines: string[] = [];
  for (const f of result.failed.deletes) {
    lines.push(`DELETE note ${f.serverId}: ${f.error}`);
  }
  for (const f of result.failed.puts) {
    lines.push(`PUT note ${f.serverId}: ${f.error}`);
  }
  for (const f of result.failed.posts) {
    lines.push(`POST new note: ${f.error}`);
  }
  if (result.failed.tagPatch) {
    lines.push(`Tag PATCH: ${result.failed.tagPatch}`);
  }
  return lines;
}

/**
 * Counts successes + failures across all groups for the modal's
 * summary line.
 *
 * Exported for unit tests; module-internal otherwise.
 */
export function countSendResult(result: SendBatchResult): {
  successCount: number;
  failureCount: number;
} {
  const s = result.successful;
  const f = result.failed;
  const successCount = s.posts.length + s.puts.length + s.deletes.length;
  const failureCount =
    f.posts.length + f.puts.length + f.deletes.length + (f.tagPatch ? 1 : 0);
  return {successCount, failureCount};
}

/**
 * Post-sendBatch orchestration. Updates local state to mirror what
 * the server confirmed, then either:
 *   - All clear: clears actionLog, toasts, reloads after 1s.
 *   - Any failure: shows the error modal. On Retry, re-classifies
 *     (the just-applied successes are now skip-bucket entries) and
 *     re-sends, recursing through this same handler. On Cancel, the
 *     user is left in active mode with the local state already
 *     mirroring the server's partial-success truth.
 *
 * The retry path passes `tagDelta` along only when the previous
 * attempt's tag PATCH actually failed — if it had succeeded (or
 * wasn't needed), we skip it on retry rather than re-PATCHing a
 * no-op delta.
 */
/**
 * Exported for unit tests; module-internal otherwise.
 */
export async function handleSendResult(
  result: SendBatchResult,
  tagDelta: TagDelta | null,
): Promise<void> {
  applyServerStateToLocal(result);

  const hasFailures =
    result.failed.posts.length > 0 ||
    result.failed.puts.length > 0 ||
    result.failed.deletes.length > 0 ||
    result.failed.tagPatch !== null;

  if (!hasFailures) {
    // Defensive: applyServerStateToLocal stripped per-note entries
    // for committed items, but unchangedServer notes / drift could
    // theoretically still leave entries. Clear the rest — the
    // session is done.
    actionLog.clear();
    hooks!.onToast('✓ Saved', 'success');
    // Brief pause so the user sees the success toast before the
    // page swaps. setMode('idle') is overkill (reload nukes
    // everything anyway) but keeps state consistent if reload
    // races against something unexpected.
    setTimeout(() => {
      setMode('idle');
      window.location.reload();
    }, 1000);
    return;
  }

  const choice = await showErrorModal(result);
  if (choice !== 'retry') {
    return;
  }

  const newClassified = classifyChanges();
  const retryTagDelta = result.failed.tagPatch ? tagDelta : null;
  if (!newClassified.hasChanges && !retryTagDelta) {
    // Nothing left to retry — this is rare (would mean failures
    // self-resolved between modal and click), but bail cleanly
    // rather than spin sendBatch on an empty payload.
    hooks!.onToast('Nothing left to retry', 'info');
    return;
  }
  const retryResult = await sendBatch(newClassified, retryTagDelta);
  await handleSendResult(retryResult, retryTagDelta);
}

// ---------------------------------------------------------------------------
// Error modal (D12 + D13)
// ---------------------------------------------------------------------------

/**
 * Builds the error modal DOM (idempotent). Body content (failure
 * list) is filled in per-open by `openErrorModal`.
 */
function createErrorModal(): void {
  if (errorModalElement) {
    return;
  }
  errorModalBackdropElement = document.createElement('div');
  errorModalBackdropElement.id = 'dmna-error-modal-backdrop';
  errorModalBackdropElement.addEventListener('click', () => {
    submitErrorModal('cancel');
  });

  errorModalElement = document.createElement('div');
  errorModalElement.id = 'dmna-error-modal';
  errorModalElement.addEventListener('click', e => e.stopPropagation());

  const header = document.createElement('div');
  header.className = 'dmna-error-modal-header';
  header.textContent = 'Confirm — partial failure';
  errorModalElement.appendChild(header);

  const summary = document.createElement('div');
  summary.className = 'dmna-error-modal-summary';
  summary.id = 'dmna-error-modal-summary';
  errorModalElement.appendChild(summary);

  const list = document.createElement('div');
  list.className = 'dmna-error-modal-list';
  list.id = 'dmna-error-modal-list';
  errorModalElement.appendChild(list);

  const buttons = document.createElement('div');
  buttons.id = 'dmna-error-modal-buttons';

  const retryBtn = document.createElement('button');
  retryBtn.type = 'button';
  retryBtn.className = 'dmna-error-modal-btn';
  retryBtn.dataset.action = 'retry';
  retryBtn.textContent = 'Retry';
  retryBtn.addEventListener('click', () => submitErrorModal('retry'));

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'dmna-error-modal-btn';
  cancelBtn.dataset.action = 'cancel';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => submitErrorModal('cancel'));

  buttons.appendChild(retryBtn);
  buttons.appendChild(cancelBtn);
  errorModalElement.appendChild(buttons);

  document.body.appendChild(errorModalBackdropElement);
  document.body.appendChild(errorModalElement);
}

/** Reveals the error modal with the given result's failure list. */
function openErrorModal(result: SendBatchResult): void {
  createErrorModal();
  const {successCount, failureCount} = countSendResult(result);
  const total = successCount + failureCount;
  const summaryEl = errorModalElement!.querySelector(
    '#dmna-error-modal-summary',
  );
  if (summaryEl) {
    summaryEl.textContent =
      `${successCount} of ${total} operation(s) succeeded; ` +
      `${failureCount} failed.`;
  }
  const listEl = errorModalElement!.querySelector('#dmna-error-modal-list');
  if (listEl) {
    listEl.textContent = '';
    buildFailureLines(result).forEach(line => {
      const div = document.createElement('div');
      div.className = 'dmna-error-modal-list-item';
      div.textContent = line;
      listEl.appendChild(div);
    });
  }
  document.body.classList.add('dmna-error-modal-open');
  errorModalBackdropElement!.classList.add('show');
  errorModalElement!.classList.add('show');
  document.addEventListener('keydown', errorModalKeyHandler, true);
}

/** Hides the error modal without destroying it. */
function closeErrorModal(): void {
  document.body.classList.remove('dmna-error-modal-open');
  if (errorModalBackdropElement) {
    errorModalBackdropElement.classList.remove('show');
  }
  if (errorModalElement) {
    errorModalElement.classList.remove('show');
  }
  document.removeEventListener('keydown', errorModalKeyHandler, true);
}

/** Resolves the in-flight `showErrorModal()` promise. */
function submitErrorModal(choice: 'retry' | 'cancel'): void {
  const resolver = pendingErrorModalResolver;
  if (!resolver) {
    return;
  }
  pendingErrorModalResolver = null;
  closeErrorModal();
  resolver(choice);
}

/**
 * PC keyboard shortcuts inside the error modal: Esc = Cancel,
 * Ctrl/Cmd+Enter = Retry. Capture-phase + stopPropagation to preempt
 * any other Esc handler that might still be live.
 */
function errorModalKeyHandler(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    submitErrorModal('cancel');
  } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    e.stopPropagation();
    submitErrorModal('retry');
  }
}

/** Opens the error modal and waits for the user's choice. */
function showErrorModal(result: SendBatchResult): Promise<'retry' | 'cancel'> {
  return new Promise(resolve => {
    if (pendingErrorModalResolver) {
      const stale = pendingErrorModalResolver;
      pendingErrorModalResolver = null;
      stale('cancel');
    }
    pendingErrorModalResolver = resolve;
    openErrorModal(result);
  });
}

// ---------------------------------------------------------------------------
// runConfirmFlow — top-level entry
// ---------------------------------------------------------------------------

/**
 * Phase 4 entrypoint — orchestrates classify → tag-popover →
 * sendBatch → handleSendResult. Called from `handleMenuAction
 * ('confirm')` (the arc menu's ✅ item). Async but the caller doesn't
 * await; the flow runs to completion in its own task.
 *
 * Re-entrancy: the `isSending` guard at the top covers the rare race
 * where a second Confirm click slips through (the floating button is
 * pointer-events:none during send, but defensive). Modal-open phases
 * are guarded by their own backdrops covering the floating button.
 */
export async function runConfirmFlow(): Promise<void> {
  if (isSending) {
    return;
  }
  // Close any open popover before showing modals or starting sends —
  // the popover is positioned above boxes but below modals; leaving
  // it open would visually layer awkwardly behind a tag modal, and
  // its textarea stays editable until sendBatch's CSS lock kicks in.
  setActiveNote(null);

  const classified = classifyChanges();
  if (!classified.hasChanges) {
    hooks!.onToast('No changes to confirm', 'info');
    return;
  }

  let tagDelta: TagDelta | null = null;
  if (needsTagPopover(classified)) {
    tagDelta = await hooks!.showTagPopover();
    if (tagDelta === null) {
      // User canceled the tag modal — abort the entire Confirm
      // flow. State unchanged, user back in active mode.
      return;
    }
  }

  const result = await sendBatch(classified, tagDelta);
  await handleSendResult(result, tagDelta);
}
