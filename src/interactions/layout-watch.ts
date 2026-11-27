/**
 * Layout watch (Layer 4 — interactions).
 *
 * Note boxes sit on `<body>` in page coordinates, so they have to be
 * re-projected whenever the image moves in the page. A window resize
 * is not the only cause: Danbooru's mobile nav opens and closes, a
 * notice appears, the sample is swapped for the original. None of
 * those fire `resize`, and Danbooru pins `html` / `body` to the
 * viewport height, so the body box doesn't change either.
 *
 * What does change is the size of something that shares the flow with
 * the image: the image itself, a sibling, or a sibling of one of its
 * ancestors (`header#top` for the nav). Those are observed. Anything
 * this misses (an element inserted later, a margin change) is caught
 * at the next scroll frame, where `main.ts` runs the same update.
 */

import {getImageElement} from '../utils/dom';

let bound = false;

const isOwnElement = (el: Element): boolean =>
  el.id.startsWith('dmna-') ||
  Array.from(el.classList).some(c => c.startsWith('dmna-'));

/**
 * Calls `onLayoutChange` when the page around the image is laid out
 * again. ResizeObserver delivers after layout and before paint, so a
 * synchronous reposition lands in the same frame as the shift.
 * Idempotent; retries until `#image` exists, like `bindImageHandlers`.
 */
export function bindLayoutWatch(onLayoutChange: () => void): void {
  if (bound || typeof ResizeObserver === 'undefined') {
    return;
  }
  const img = getImageElement();
  if (!img) {
    setTimeout(() => bindLayoutWatch(onLayoutChange), 1000);
    return;
  }
  bound = true;
  const observer = new ResizeObserver(() => onLayoutChange());
  for (
    let parent = img.parentElement;
    parent && parent !== document.documentElement;
    parent = parent.parentElement
  ) {
    for (const child of Array.from(parent.children)) {
      if (!isOwnElement(child)) {
        observer.observe(child);
      }
    }
  }
}
