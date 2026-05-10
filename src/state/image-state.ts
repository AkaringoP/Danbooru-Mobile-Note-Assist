/**
 * Post image metadata cache. Holds the original-image dimensions
 * (the canonical coordinate space for `NoteState`) and the in-flight
 * fetch promise that dedupes concurrent `fetchPostMeta()` calls.
 *
 * Layer 2 (state). Read by:
 *   - `utils/coords.ts` callers (which take `originalWidth` as an
 *     explicit parameter — utils/ stays pure)
 *   - `api/posts.ts` (sets the values after the GET completes)
 *   - `state/notes-store.ts` (gates active-mode entry on metadata)
 *
 * Cleared implicitly: only on hard page reload. Concurrent
 * `fetchPostMeta` calls dedupe via `getPostMetaPromise`; on failure
 * the promise is reset to `null` so the next entry can retry, but
 * the cached dimensions (if any) are NOT cleared — once known, they
 * stay known for the page lifetime. Matches v3.1.1 behavior.
 */

/** Cached post image dimensions. `0` = not yet fetched. */
let postOriginalWidth = 0;
let postOriginalHeight = 0;

/** In-flight fetch promise; non-null while a `fetchPostMeta()` call is pending. */
let postMetaPromise: Promise<{width: number; height: number}> | null = null;

/** Original-image width in pixels. `0` until the first successful fetch. */
export function getOriginalWidth(): number {
  return postOriginalWidth;
}

/** Original-image height in pixels. `0` until the first successful fetch. */
export function getOriginalHeight(): number {
  return postOriginalHeight;
}

/**
 * Stores post dimensions after a successful `/posts/{id}.json` fetch.
 * Called by `api/posts.ts#fetchPostMeta`'s success branch.
 */
export function setPostMeta(width: number, height: number): void {
  postOriginalWidth = width;
  postOriginalHeight = height;
}

/**
 * Returns the in-flight fetch promise so concurrent callers dedupe.
 * `null` when no fetch is pending.
 */
export function getPostMetaPromise(): Promise<{
  width: number;
  height: number;
}> | null {
  return postMetaPromise;
}

/**
 * Sets/clears the in-flight fetch promise. Called by
 * `api/posts.ts#fetchPostMeta` — assigns the new promise on entry,
 * clears (`null`) in the catch block so a retry can fire.
 */
export function setPostMetaPromise(
  p: Promise<{width: number; height: number}> | null,
): void {
  postMetaPromise = p;
}
