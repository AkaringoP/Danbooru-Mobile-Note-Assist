/**
 * Coordinate and geometry utilities — pure helpers for projecting
 * between image-space and display-space rectangles.
 *
 * Layer 1 (utils): no imports from state/, api/, ui/, interactions/,
 * confirm/, or main.ts.
 */

import {NoteState, Rect} from '../types';

/**
 * Page-coord rectangle (`document.documentElement` space, the same
 * space as note-box `position: absolute` containers). Distinct from
 * the image-space `Rect` in types.ts: this carries `left/top/width/
 * height`, while `Rect` carries `x/y/w/h`.
 */
export interface DisplayRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Math.max(lo, Math.min(hi, v)). */
export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Extracts the post id from the current URL. Returns null on non-post
 * pages.
 */
export function getPostId(): string | null {
  const m = window.location.pathname.match(/^\/posts\/(\d+)/);
  return m ? m[1] : null;
}

/**
 * Reads the post image's bounding rect and translates it from
 * viewport space to page/document space (the same coordinate system
 * note boxes are positioned in, since they're `position: absolute`
 * children of `<body>`). Returns null if the image is missing or has
 * zero size (e.g., not loaded or hidden by display:none).
 *
 * Caller must provide the image element rather than reading
 * `document.getElementById('image')` here, so this helper stays Z5-
 * pure (no DOM-by-id lookups). The caller in `interactions/` or
 * `state/` can resolve the element via `utils/dom.getImageElement()`.
 */
export function getImageDisplayRect(img: HTMLImageElement): DisplayRect | null {
  const r = img.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) {
    return null;
  }
  return {
    left: r.left + window.pageXOffset,
    top: r.top + window.pageYOffset,
    width: r.width,
    height: r.height,
  };
}

/**
 * Projects an image-space `NoteState` to a display-space rect.
 * Returns null if the rendered image rect is unavailable.
 *
 * **Closure-capture removed:** legacy code read `postOriginalWidth`
 * from the IIFE closure; here it's an explicit parameter so coords
 * stays in layer 1.
 *
 * If `originalWidth` is 0 (metadata not yet fetched), the projection
 * falls back to scale 1, which is wrong for real notes but keeps the
 * debug surface usable when poking values via `__dmna3.addNote`
 * before any active-mode entry — same fallback as v3.1.1.
 *
 * `displayRect` must be pre-resolved by the caller (e.g., a per-frame
 * snapshot in `updateAllNoteBoxPositions`) so a batch render of N
 * notes does one `getBoundingClientRect()` instead of N — Phase 6
 * layout-thrash audit.
 */
export function imageToScreenRect(
  state: NoteState,
  displayRect: DisplayRect,
  originalWidth: number,
): DisplayRect | null {
  const scale = originalWidth ? displayRect.width / originalWidth : 1;
  return {
    left: displayRect.left + state.x * scale,
    top: displayRect.top + state.y * scale,
    width: state.w * scale,
    height: state.h * scale,
  };
}

/**
 * Reverse projection: display-space rect → image-space `Rect`.
 * Returns null when the rendered image rect is missing or
 * `originalWidth` is 0 — both indicate "we shouldn't be creating a
 * note right now," not "default to identity."
 *
 * **Closure-capture removed:** as above.
 */
export function screenToImageRect(
  r: DisplayRect,
  displayRect: DisplayRect,
  originalWidth: number,
): Rect | null {
  if (!originalWidth) {
    return null;
  }
  const scale = displayRect.width / originalWidth;
  return {
    x: (r.left - displayRect.left) / scale,
    y: (r.top - displayRect.top) / scale,
    w: r.width / scale,
    h: r.height / scale,
  };
}
