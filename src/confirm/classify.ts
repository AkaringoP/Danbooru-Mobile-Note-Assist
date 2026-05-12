/**
 * Confirm-time change classification (PLAN.md D8 + D9).
 *
 * Layer 3 (confirm). Pure read-only over `state/notes-store.notes` —
 * no UI calls, no side effects. Buckets the live collection by what
 * Confirm should do for each note (POST / PUT / DELETE / silent drop)
 * and decides whether the tag-popover modal is needed.
 *
 * Shapes consumed by `confirm/batch.sendBatch` and the debug surface.
 */

import {NoteId, NoteState, ServerNoteId} from '../types';
import {notes} from '../state/notes-store';

/** A new temp note that will be POSTed. */
export interface PendingPost {
  noteId: NoteId;
  state: NoteState;
}

/**
 * An edited server note that will be PUT.
 * `serverId` equals `noteId` for server notes (the Map key is already
 * the numeric server id, stringified). The redundant field is kept
 * for self-documenting call-sites at `sendBatch` time.
 */
export interface PendingPut {
  noteId: NoteId;
  serverId: ServerNoteId;
  state: NoteState;
  /**
   * Whether this PUT carries a text edit (vs. geometry-only).
   * Drives the tag popover decision (D9).
   */
  textChanged: boolean;
}

/** A soft-deleted server note that will be DELETEd. */
export interface PendingDelete {
  noteId: NoteId;
  serverId: ServerNoteId;
}

/**
 * Result of `classifyChanges`. Three send-buckets plus three drop-
 * buckets that account for every note in the collection (no note is
 * silently overlooked).
 */
export interface ClassifiedChanges {
  posts: PendingPost[];
  puts: PendingPut[];
  deletes: PendingDelete[];
  dropped: {
    /** Temp notes never ✔'d. Fresh-new — silent drop on Confirm. */
    uncommittedTemps: NoteId[];
    /** ✔'d temps soft-deleted before Confirm. Never persisted. */
    softDeletedTemps: NoteId[];
    /** Server notes that round-tripped to baseline (no PUT needed). */
    unchangedServer: NoteId[];
  };
  /** True iff at least one of posts/puts/deletes is non-empty. */
  hasChanges: boolean;
}

/**
 * Whether the collection has any change that would alter server state
 * if the user pressed Confirm now. Used by the Z11 off-flow (and the
 * beforeunload guard) to decide whether to show the discard prompt.
 *
 * Distinct from `isDirty(note)` which is a *visual* classification
 * ("temp notes are always green"). A soft-deleted ✔'d temp note
 * isDirty=true (still drawn red dashed via CSS) but pending=false
 * (Confirm would silently drop it — Wave 3.5 D8). Same for fresh-new
 * uncommitted temps: visible as green boxes but never POSTed unless
 * ✔'d, so deactivating them is a no-op server-side.
 *
 * Pending = the note maps to a non-empty `classifyChanges` send-bucket
 * (POST / PUT / DELETE), per PLAN.md D8.
 */
export function hasPendingChanges(): boolean {
  for (const note of notes.values()) {
    if (note.isServerNote) {
      // Soft-deleted server note → DELETE.
      if (note.isDeleted) {
        return true;
      }
      // Edited server note → PUT.
      const a = note.current;
      const b = note.initialState;
      if (
        a.x !== b.x ||
        a.y !== b.y ||
        a.w !== b.w ||
        a.h !== b.h ||
        a.text !== b.text
      ) {
        return true;
      }
    } else {
      // Temp note: only ✔'d AND not soft-deleted notes get POSTed.
      // Fresh-new uncommitted (no ✔) = silent drop. Soft-deleted
      // ✔'d temp = silent drop (never persisted).
      if (note.everConfirmed && !note.isDeleted) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Buckets the current `notes` collection by what API call (if any)
 * Confirm should make for each entry. The result drives both the
 * "anything to do?" check and the eventual `sendBatch()`.
 *
 * Routing rules (PLAN.md D8):
 *   - !isServerNote && !isDeleted && everConfirmed         → posts
 *   - !isServerNote && !isDeleted && !everConfirmed        → dropped.uncommittedTemps
 *   - !isServerNote && isDeleted                           → dropped.softDeletedTemps
 *   - isServerNote && !isDeleted && current ≠ initialState → puts
 *   - isServerNote && !isDeleted && current === initialState → dropped.unchangedServer
 *   - isServerNote && isDeleted                            → deletes
 *
 * `puts[i].textChanged` flags whether the PUT carries a text edit
 * (vs. geometry-only) — drives the tag popover decision (D9).
 *
 * Server note ids: server-loaded notes use the numeric id directly
 * as their Map key, so `noteId === serverId` for them.
 */
export function classifyChanges(): ClassifiedChanges {
  const posts: PendingPost[] = [];
  const puts: PendingPut[] = [];
  const deletes: PendingDelete[] = [];
  const dropped = {
    uncommittedTemps: [] as NoteId[],
    softDeletedTemps: [] as NoteId[],
    unchangedServer: [] as NoteId[],
  };

  for (const [noteId, note] of notes.entries()) {
    if (note.isServerNote) {
      if (note.isDeleted) {
        deletes.push({noteId, serverId: noteId as ServerNoteId});
        continue;
      }
      const a = note.current;
      const b = note.initialState;
      const geomChanged =
        a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h;
      const textChanged = a.text !== b.text;
      if (geomChanged || textChanged) {
        puts.push({
          noteId,
          serverId: noteId as ServerNoteId,
          state: {...a},
          textChanged,
        });
      } else {
        dropped.unchangedServer.push(noteId);
      }
    } else {
      // Temp note
      if (note.isDeleted) {
        dropped.softDeletedTemps.push(noteId);
      } else if (!note.everConfirmed) {
        dropped.uncommittedTemps.push(noteId);
      } else {
        posts.push({noteId, state: {...note.current}});
      }
    }
  }

  const hasChanges = posts.length > 0 || puts.length > 0 || deletes.length > 0;

  return {posts, puts, deletes, dropped, hasChanges};
}

/**
 * Whether the classified changes require the tag popover (D9): any
 * creation, any deletion, or any text edit. Geometry-only edits
 * proceed straight to send.
 */
export function needsTagPopover(c: ClassifiedChanges): boolean {
  if (c.posts.length > 0) {
    return true;
  }
  if (c.deletes.length > 0) {
    return true;
  }
  return c.puts.some(p => p.textChanged);
}
