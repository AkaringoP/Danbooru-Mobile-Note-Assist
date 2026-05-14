/**
 * Document-level "tap (not drag)" detector — wraps the pointerdown /
 * move / up sequence into a single callback that fires only when the
 * pointer didn't travel beyond DRAG_THRESHOLD_PX between down and up.
 *
 * Used by the sub-modal pickers (color, stroke, link, ruby) to drive
 * their outside-tap dismiss without also dismissing on the first
 * pointerdown of a scroll/swipe gesture. Mirrors the threshold
 * semantics already in `drag-resize.ts` so a finger drift within the
 * same slack the rest of the UI tolerates as "still a tap" reads the
 * same way here.
 *
 * Layer 1 (utils): depends only on config (Layer 0).
 */

import {DRAG_THRESHOLD_PX} from '../config';

/**
 * Register a capture-phase document listener for "tap" events
 * (pointerup-without-drag). The callback receives the pointerup event,
 * so it can inspect `target` / call `preventDefault` / `stopPropagation`
 * the same way an immediate pointerdown handler would.
 *
 * Returns an unregister function that detaches every listener installed.
 */
export function listenDocumentTap(
  onTap: (e: PointerEvent) => void,
): () => void {
  let startX = 0;
  let startY = 0;
  let tracking = false;
  let dragged = false;

  const onPointerDown = (e: PointerEvent): void => {
    startX = e.clientX;
    startY = e.clientY;
    tracking = true;
    dragged = false;
  };

  const onPointerMove = (e: PointerEvent): void => {
    if (!tracking || dragged) return;
    if (
      Math.hypot(e.clientX - startX, e.clientY - startY) > DRAG_THRESHOLD_PX
    ) {
      dragged = true;
    }
  };

  const onPointerUp = (e: PointerEvent): void => {
    if (tracking && !dragged) {
      onTap(e);
    }
    tracking = false;
    dragged = false;
  };

  const onPointerCancel = (): void => {
    tracking = false;
    dragged = false;
  };

  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('pointermove', onPointerMove, true);
  document.addEventListener('pointerup', onPointerUp, true);
  document.addEventListener('pointercancel', onPointerCancel, true);

  return () => {
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('pointermove', onPointerMove, true);
    document.removeEventListener('pointerup', onPointerUp, true);
    document.removeEventListener('pointercancel', onPointerCancel, true);
  };
}
