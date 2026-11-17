/**
 * Unit tests for src/utils/popover-placement.ts.
 * vitest globals: describe/it/expect — no explicit imports needed.
 */

import {
  POPOVER_ARROW_HALF,
  POPOVER_CORNER_RADIUS,
  POPOVER_VIEWPORT_PADDING,
  POPOVER_WIDTH,
} from '../src/config';
import {computePopoverPlacement} from '../src/utils/popover-placement';

const PAD = POPOVER_VIEWPORT_PADDING;
const ARROW_MIN = POPOVER_CORNER_RADIUS;
const ARROW_MAX =
  POPOVER_WIDTH - POPOVER_CORNER_RADIUS - 2 * POPOVER_ARROW_HALF;

/** Visual x of the arrow tip for a placement. */
function arrowTipX(p: {left: number; fit: number; arrowLeft: number}): number {
  return p.left + (p.arrowLeft + POPOVER_ARROW_HALF) * p.fit;
}

describe('computePopoverPlacement', () => {
  it('centers on the box when there is room (no clamp, no shrink)', () => {
    const p = computePopoverPlacement({boxCenterX: 206, visW: 412});
    expect(p.fit).toBe(1);
    expect(p.left).toBeCloseTo(206 - POPOVER_WIDTH / 2);
    expect(p.arrowLeft).toBeCloseTo(POPOVER_WIDTH / 2 - POPOVER_ARROW_HALF);
    expect(arrowTipX(p)).toBeCloseTo(206);
  });

  it('pins to the left padding for a box at the left edge', () => {
    const p = computePopoverPlacement({boxCenterX: 20, visW: 412});
    expect(p.left).toBe(PAD);
    expect(p.arrowLeft).toBe(ARROW_MIN);
  });

  it('pins to the right padding for a box at the right edge', () => {
    const p = computePopoverPlacement({boxCenterX: 392, visW: 412});
    expect(p.left + POPOVER_WIDTH * p.fit).toBeCloseTo(412 - PAD);
    expect(p.arrowLeft).toBe(ARROW_MAX);
  });

  it('shrinks to fit a viewport narrower than popover + padding (360 px)', () => {
    const p = computePopoverPlacement({boxCenterX: 20, visW: 360});
    expect(p.fit).toBeCloseTo((360 - 2 * PAD) / POPOVER_WIDTH);
    expect(p.fit).toBeLessThan(1);
    expect(p.left).toBeGreaterThanOrEqual(PAD);
    expect(p.left + POPOVER_WIDTH * p.fit).toBeLessThanOrEqual(
      360 - PAD + 1e-9,
    );
  });

  it('never overflows for any box position on common widths', () => {
    for (const visW of [320, 360, 379, 393, 412, 768]) {
      for (let boxCenterX = 0; boxCenterX <= visW; boxCenterX += 7) {
        const p = computePopoverPlacement({boxCenterX, visW});
        expect(p.left).toBeGreaterThanOrEqual(PAD - 1e-9);
        expect(p.left + POPOVER_WIDTH * p.fit).toBeLessThanOrEqual(
          visW - PAD + 1e-9,
        );
      }
    }
  });

  it('moves the arrow to follow the box center while clamped', () => {
    const p = computePopoverPlacement({boxCenterX: 100, visW: 412});
    expect(p.left).toBe(PAD);
    expect(arrowTipX(p)).toBeCloseTo(100);
  });

  it('stops the arrow at the rounded corners', () => {
    for (const boxCenterX of [-50, 0, 5, 405, 412, 470]) {
      const p = computePopoverPlacement({boxCenterX, visW: 412});
      expect(p.arrowLeft).toBeGreaterThanOrEqual(ARROW_MIN);
      expect(p.arrowLeft).toBeLessThanOrEqual(ARROW_MAX);
    }
  });
});
