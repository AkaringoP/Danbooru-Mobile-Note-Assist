/**
 * Unit tests for src/utils/pointer-tap.ts.
 * vitest globals: describe/it/expect/beforeEach/afterEach/vi — no explicit imports needed.
 */

import {listenDocumentTap} from '../src/utils/pointer-tap';

function dispatch(
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  x: number,
  y: number,
  target: Element = document.body,
): PointerEvent {
  const e = new PointerEvent(type, {
    clientX: x,
    clientY: y,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(e);
  return e;
}

describe('listenDocumentTap', () => {
  let onTap: ReturnType<typeof vi.fn<(e: PointerEvent) => void>>;
  let unregister: () => void;

  beforeEach(() => {
    onTap = vi.fn<(e: PointerEvent) => void>();
    unregister = listenDocumentTap(onTap);
  });

  afterEach(() => {
    unregister();
  });

  it('fires onTap for stationary down→up (zero movement)', () => {
    dispatch('pointerdown', 100, 100);
    dispatch('pointerup', 100, 100);
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it('fires onTap when movement stays within DRAG_THRESHOLD_PX (5)', () => {
    dispatch('pointerdown', 100, 100);
    dispatch('pointermove', 103, 102);
    dispatch('pointerup', 103, 102);
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it('suppresses onTap when movement exceeds threshold (scroll gesture)', () => {
    dispatch('pointerdown', 100, 100);
    dispatch('pointermove', 100, 120);
    dispatch('pointerup', 100, 120);
    expect(onTap).not.toHaveBeenCalled();
  });

  it('latches the drag state once threshold is crossed', () => {
    dispatch('pointerdown', 100, 100);
    dispatch('pointermove', 100, 120);
    dispatch('pointermove', 100, 100);
    dispatch('pointerup', 100, 100);
    expect(onTap).not.toHaveBeenCalled();
  });

  it('passes the pointerup event to onTap', () => {
    dispatch('pointerdown', 100, 100);
    dispatch('pointerup', 100, 100);
    const arg = onTap.mock.calls[0][0] as PointerEvent;
    expect(arg.type).toBe('pointerup');
  });

  it('resets between gestures — a drag does not poison the next tap', () => {
    dispatch('pointerdown', 100, 100);
    dispatch('pointermove', 100, 120);
    dispatch('pointerup', 100, 120);
    dispatch('pointerdown', 200, 200);
    dispatch('pointerup', 200, 200);
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it('pointercancel mid-gesture suppresses the subsequent up', () => {
    dispatch('pointerdown', 100, 100);
    dispatch('pointercancel', 100, 100);
    dispatch('pointerup', 100, 100);
    expect(onTap).not.toHaveBeenCalled();
  });

  it('unregister detaches all listeners', () => {
    unregister();
    dispatch('pointerdown', 100, 100);
    dispatch('pointerup', 100, 100);
    expect(onTap).not.toHaveBeenCalled();
  });
});
