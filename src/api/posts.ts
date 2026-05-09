/**
 * Danbooru `/posts/{id}.json` API surface.
 *
 * Layer 2 (api). Pre-Task-1.6 stub: only the function notes-store
 * imports is exposed, with a runtime guard so any accidental call
 * surfaces clearly. Task 1.6 will fill in the real implementation
 * (GET → state/image-state.ts setter chain, plus fetchPostTagString
 * and the Confirm-time tag PATCH).
 */

/**
 * Fetches the post's image dimensions (`/posts/{id}.json`) and writes
 * them into `state/image-state.ts`. Concurrent calls dedupe via the
 * in-flight promise stored in image-state.
 *
 * **STUB (pre-Task 1.6)**: throws unconditionally so callers see a
 * clear error rather than a silent miss. Will be replaced by the real
 * implementation in Task 1.6.
 */
export async function fetchPostMeta(): Promise<void> {
  throw new Error('fetchPostMeta: not yet implemented (pending Task 1.6)');
}
