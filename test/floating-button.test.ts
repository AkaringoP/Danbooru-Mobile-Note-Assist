/**
 * Unit tests for src/ui/floating-button.ts gestures.
 * vitest globals: describe/it/expect/beforeEach/afterEach/vi.
 */

vi.mock('../src/ui/arc-menu', () => ({
  closeMenu: vi.fn(),
  toggleMenu: vi.fn(),
}));
vi.mock('../src/ui/toast', () => ({
  showToast: vi.fn(),
}));
vi.mock('../src/state/notes-store', () => ({
  getMode: vi.fn(() => 'idle'),
  toggleEditMode: vi.fn(),
}));

import {LONG_PRESS_DURATION, POS_KEY, POS_X_KEY} from '../src/config';
import {toggleMenu} from '../src/ui/arc-menu';
import {createFloatingButton} from '../src/ui/floating-button';
import {showToast} from '../src/ui/toast';

/** Touch event with plain-object touch lists (all the handlers read). */
function touch(type: string, x: number, y: number): Event {
  const e = new Event(type, {bubbles: true, cancelable: true});
  const points = [{clientX: x, clientY: y}];
  const lifted = type === 'touchend' || type === 'touchcancel';
  Object.defineProperty(e, 'touches', {value: lifted ? [] : points});
  Object.defineProperty(e, 'changedTouches', {value: points});
  return e;
}

let btn: HTMLElement;

beforeAll(() => {
  createFloatingButton();
  btn = document.getElementById('dmna-float-btn')!;
});

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  vi.mocked(toggleMenu).mockClear();
  vi.mocked(showToast).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('floating button — touchcancel (Task 4.1)', () => {
  it('a cancelled press never turns into drag mode', () => {
    btn.dispatchEvent(touch('touchstart', 100, 100));
    btn.dispatchEvent(touch('touchcancel', 100, 100));
    vi.advanceTimersByTime(LONG_PRESS_DURATION + 100);

    expect(btn.classList.contains('dragging')).toBe(false);
    expect(showToast).not.toHaveBeenCalled();
    expect(toggleMenu).not.toHaveBeenCalled();
  });

  it('a cancel mid-drag ends drag mode and keeps the new position', () => {
    btn.dispatchEvent(touch('touchstart', 100, 100));
    vi.advanceTimersByTime(LONG_PRESS_DURATION + 10);
    expect(btn.classList.contains('dragging')).toBe(true);
    btn.dispatchEvent(touch('touchmove', 70, 60));
    btn.dispatchEvent(touch('touchcancel', 70, 60));

    expect(btn.classList.contains('dragging')).toBe(false);
    expect(localStorage.getItem(POS_X_KEY)).not.toBeNull();
    expect(localStorage.getItem(POS_KEY)).not.toBeNull();
  });
});

describe('floating button — existing gestures still work', () => {
  it('a short tap toggles the menu', () => {
    vi.advanceTimersByTime(1000); // clear any double-tap window
    btn.dispatchEvent(touch('touchstart', 100, 100));
    btn.dispatchEvent(touch('touchend', 100, 100));
    expect(toggleMenu).toHaveBeenCalledTimes(1);
  });

  it('a long press enters drag mode, and lifting ends it', () => {
    btn.dispatchEvent(touch('touchstart', 100, 100));
    vi.advanceTimersByTime(LONG_PRESS_DURATION + 10);
    expect(btn.classList.contains('dragging')).toBe(true);
    expect(showToast).toHaveBeenCalledWith('✥ Drag to reposition', 'info');
    btn.dispatchEvent(touch('touchend', 100, 100));
    expect(btn.classList.contains('dragging')).toBe(false);
  });
});
