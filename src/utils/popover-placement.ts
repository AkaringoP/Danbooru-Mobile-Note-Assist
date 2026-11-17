/**
 * Horizontal placement of the note popover (Layer 1 — pure).
 *
 * All inputs and outputs except `arrowLeft` are in visual (screen) px:
 * the popover is counter-scaled against pinch zoom, so its on-screen
 * width is always `POPOVER_WIDTH × fit` whatever `visualViewport.scale`
 * is. Mixing in layout px (`visualViewport.width`) is what let the
 * popover run off screen under pinch zoom before v5.1.
 */

import {
  POPOVER_ARROW_HALF,
  POPOVER_CORNER_RADIUS,
  POPOVER_VIEWPORT_PADDING,
  POPOVER_WIDTH,
} from '../config';
import {clamp} from './coords';

export interface PopoverPlacement {
  /** Visual px from the visual viewport's left edge. */
  left: number;
  /** Extra scale (≤ 1) applied when the viewport is narrower than the popover. */
  fit: number;
  /** Arrow `left` in the popover's own (unscaled) CSS px. */
  arrowLeft: number;
}

/**
 * Centers the popover on the box, shrinks it when the viewport is too
 * narrow for `POPOVER_WIDTH` plus padding, clamps it inside the
 * padding, and slides the arrow so it keeps pointing at the box.
 */
export function computePopoverPlacement({
  boxCenterX,
  visW,
}: {
  boxCenterX: number;
  visW: number;
}): PopoverPlacement {
  const fit = clamp(
    (visW - 2 * POPOVER_VIEWPORT_PADDING) / POPOVER_WIDTH,
    0.25,
    1,
  );
  const popW = POPOVER_WIDTH * fit;
  const left = Math.max(
    POPOVER_VIEWPORT_PADDING,
    Math.min(boxCenterX - popW / 2, visW - popW - POPOVER_VIEWPORT_PADDING),
  );
  const arrowLeft = clamp(
    (boxCenterX - left) / fit - POPOVER_ARROW_HALF,
    POPOVER_CORNER_RADIUS,
    POPOVER_WIDTH - POPOVER_CORNER_RADIUS - 2 * POPOVER_ARROW_HALF,
  );
  return {left, fit, arrowLeft};
}
