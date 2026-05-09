/**
 * Danbooru `/notes` API surface (GET / POST / PUT / DELETE).
 *
 * Layer 2 (api). Pre-Task-1.6 stub: only the function notes-store
 * imports is exposed, with a runtime guard so any accidental call
 * surfaces clearly. Task 1.6 will fill in the real implementation
 * (4xx body surface preservation per v3.0 D11, sendBatch, etc.).
 */

/**
 * Server-note descriptor as returned by GET `/notes.json?post_id=…`.
 * The shape mirrors Danbooru's note record. `addServerNote` consumes
 * this and projects it into the in-memory `Note` (renaming `width`/
 * `height` → `w`/`h` and `body` → `text`).
 */
export interface ServerNoteDescriptor {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  body: string;
}

/**
 * Fetches existing notes for the current post.
 *
 * **STUB (pre-Task 1.6)**: throws unconditionally so callers see a
 * clear error rather than a silent miss. Will be replaced by the real
 * implementation in Task 1.6.
 */
export async function fetchServerNotes(): Promise<ServerNoteDescriptor[]> {
  throw new Error('fetchServerNotes: not yet implemented (pending Task 1.6)');
}
