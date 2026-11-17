/**
 * POST reconciliation (Layer 3 — confirm, pure).
 *
 * A POST whose response was lost (network drop, timeout) may still have
 * created the note. POST is not idempotent, so before re-sending, the
 * failed POSTs are matched against the post's live notes; a match means
 * the server already has it (v5.1 Task 1.4).
 */

import type {ServerNoteDescriptor} from '../api/notes';
import {NoteState} from '../types';

/**
 * Mirrors what Danbooru does to a note body before saving it (NFC,
 * zero-width strip, whitespace and line-ending normalization, strip),
 * folded further to one space per whitespace run so both sides compare
 * equal regardless of EOL style.
 */
export function normalizeNoteBody(body: string): string {
  return (
    body
      .normalize('NFC')
      .replace(/[\u180E\u200B\u200C\u2060\uFEFF]/g, '')
      // \s doesn't cover NEL, which the server turns into a line break.
      .replace(/[\s\u0085]+/g, ' ')
      .trim()
  );
}

function sameNote(state: NoteState, sn: ServerNoteDescriptor): boolean {
  return (
    Math.round(state.x) === sn.x &&
    Math.round(state.y) === sn.y &&
    Math.round(state.w) === sn.width &&
    Math.round(state.h) === sn.height &&
    normalizeNoteBody(state.text || '') === normalizeNoteBody(sn.body || '')
  );
}

/**
 * Pairs each failed POST with a server note that has the same rounded
 * geometry and normalized body. Server notes in `knownServerIds` (loaded
 * at edit-mode entry, or created by this batch) are never candidates,
 * and each candidate pairs with at most one POST.
 */
export function matchCommittedPosts<T extends {state: NoteState}>(
  failedPosts: readonly T[],
  serverNotes: readonly ServerNoteDescriptor[],
  knownServerIds: ReadonlySet<string>,
): Array<{post: T; serverNote: ServerNoteDescriptor}> {
  const candidates = serverNotes.filter(
    sn => !knownServerIds.has(String(sn.id)),
  );
  const used = new Set<ServerNoteDescriptor>();
  return failedPosts.flatMap(post => {
    const serverNote = candidates.find(
      sn => !used.has(sn) && sameNote(post.state, sn),
    );
    if (!serverNote) {
      return [];
    }
    used.add(serverNote);
    return [{post, serverNote}];
  });
}
