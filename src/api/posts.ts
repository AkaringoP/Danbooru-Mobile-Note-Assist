/**
 * Danbooru `/posts/{id}.json` API surface (Layer 2 — api).
 *
 * Three functions, all gated by `getPostId()` which returns null on
 * non-post pages:
 *   - `fetchPostMeta` — image dimensions; populates `state/image-
 *     state.ts` and dedupes concurrent calls via the in-flight promise
 *     stored there.
 *   - `fetchPostTagString` — the post's current tag_string; not cached
 *     (the modal's seed state must reflect live tags at open time).
 *   - `apiPatchPostTags` — re-fetches tag_string, applies an add/
 *     remove delta, and PUTs back. Used by the Confirm-time tag modal.
 */

import {apiCall} from './csrf';
import {
  getOriginalHeight,
  getOriginalWidth,
  getPostMetaPromise,
  setPostMeta,
  setPostMetaPromise,
} from '../state/image-state';
import {getPostId} from '../utils/coords';

/**
 * Fetches the post's image dimensions (`/posts/{id}.json?only=...`)
 * and writes them into `state/image-state.ts`. Idempotent on cached
 * dimensions; concurrent calls dedupe via the in-flight promise stored
 * in image-state.
 *
 * On failure the in-flight promise is cleared (so the next entry can
 * retry) but any prior cached dimensions stay intact — once known,
 * dimensions stay known for the page lifetime. Matches v3.1.1.
 */
export function fetchPostMeta(): Promise<{width: number; height: number}> {
  const cachedW = getOriginalWidth();
  const cachedH = getOriginalHeight();
  if (cachedW && cachedH) {
    return Promise.resolve({width: cachedW, height: cachedH});
  }
  const inFlight = getPostMetaPromise();
  if (inFlight) {
    return inFlight;
  }
  const id = getPostId();
  if (!id) {
    return Promise.reject(new Error('No post id in URL'));
  }
  const p = fetch(`/posts/${id}.json?only=image_width,image_height`, {
    credentials: 'same-origin',
  })
    .then(r => {
      if (!r.ok) {
        throw new Error(`HTTP ${r.status}`);
      }
      return r.json();
    })
    .then(data => {
      const w = Number(data.image_width) || 0;
      const h = Number(data.image_height) || 0;
      if (!w || !h) {
        throw new Error('Image dimensions missing in response');
      }
      setPostMeta(w, h);
      return {width: w, height: h};
    })
    .catch(err => {
      setPostMetaPromise(null);
      throw err;
    });
  setPostMetaPromise(p);
  return p;
}

/**
 * Fetches the post's current `tag_string`. Used by the tag modal
 * (Phase 4 D9) to seed initial toggle state — a TAG_OPTIONS entry
 * already present on the post starts out checked, so the user is
 * computing a delta against the live state at modal-open time.
 *
 * Not cached: notes the user took a few minutes ago shouldn't pin
 * a stale tag set, and the request is small (`?only=tag_string`).
 */
export function fetchPostTagString(): Promise<string> {
  const id = getPostId();
  if (!id) {
    return Promise.reject(new Error('No post id in URL'));
  }
  return fetch(`/posts/${id}.json?only=tag_string`, {
    credentials: 'same-origin',
  })
    .then(r => {
      if (!r.ok) {
        throw new Error(`HTTP ${r.status}`);
      }
      return r.json();
    })
    .then(data => String(data.tag_string || ''));
}

/**
 * Re-fetches the post's tag_string, applies the user's add/remove
 * delta, and PUTs the updated tag_string back. Re-fetch (vs. using
 * the snapshot from the modal) closes the race where a co-editor
 * changed tags between modal-open and Confirm-submit; the delta is
 * still meaningful (it only adds tags the user wants ON and removes
 * tags they wanted OFF, leaving everything else alone).
 */
export async function apiPatchPostTags(
  tagsToAdd: string[],
  tagsToRemove: string[],
): Promise<unknown> {
  const current = await fetchPostTagString();
  const tags = new Set(current.split(/\s+/).filter(Boolean));
  tagsToAdd.forEach(t => tags.add(t));
  tagsToRemove.forEach(t => tags.delete(t));
  const newTagString = [...tags].join(' ');
  return apiCall('PUT', `/posts/${getPostId()}.json`, {
    post: {tag_string: newTagString},
  });
}
