/**
 * Unit tests for src/utils/coords.ts.
 * vitest globals: describe/it/expect/beforeEach/afterEach/vi — no explicit imports needed.
 */

import type {NoteState, Rect} from '../src/types';
import {
  clamp,
  getPostId,
  getImageDisplayRect,
  imageToScreenRect,
  screenToImageRect,
} from '../src/utils/coords';
import type {DisplayRect} from '../src/utils/coords';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDisplayRect(
  left: number,
  top: number,
  width: number,
  height: number,
): DisplayRect {
  return {left, top, width, height};
}

function makeFakeImg(
  left: number,
  top: number,
  width: number,
  height: number,
): HTMLImageElement {
  return {
    getBoundingClientRect: () =>
      ({
        left,
        top,
        width,
        height,
        right: left + width,
        bottom: top + height,
        x: left,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect,
  } as unknown as HTMLImageElement;
}

function setPageOffset(x: number, y: number): void {
  Object.defineProperty(window, 'pageXOffset', {value: x, configurable: true});
  Object.defineProperty(window, 'pageYOffset', {value: y, configurable: true});
}

// ---------------------------------------------------------------------------
// clamp
// ---------------------------------------------------------------------------

describe('clamp', () => {
  it('returns lo when v < lo', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it('returns lo when v === lo', () => {
    expect(clamp(0, 0, 10)).toBe(0);
  });

  it('returns v when strictly inside', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it('returns hi when v === hi', () => {
    expect(clamp(10, 0, 10)).toBe(10);
  });

  it('returns hi when v > hi', () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// getPostId
// ---------------------------------------------------------------------------

describe('getPostId', () => {
  beforeEach(() => {
    window.history.pushState(null, '', '/');
  });

  it('returns the numeric id for /posts/123', () => {
    window.history.pushState(null, '', '/posts/123');
    expect(getPostId()).toBe('123');
  });

  it('returns the id for /posts/123/ (trailing slash)', () => {
    window.history.pushState(null, '', '/posts/123/');
    expect(getPostId()).toBe('123');
  });

  it('returns the id when search params follow (pathname only)', () => {
    window.history.pushState(null, '', '/posts/123?foo=bar');
    expect(getPostId()).toBe('123');
  });

  it('returns the id for /posts/123/comments (extra path segments)', () => {
    window.history.pushState(null, '', '/posts/123/comments');
    expect(getPostId()).toBe('123');
  });

  it('returns null for /users/123', () => {
    window.history.pushState(null, '', '/users/123');
    expect(getPostId()).toBeNull();
  });

  it('returns null for /posts/abc (non-numeric)', () => {
    window.history.pushState(null, '', '/posts/abc');
    expect(getPostId()).toBeNull();
  });

  it('returns null for /', () => {
    expect(getPostId()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getImageDisplayRect
// ---------------------------------------------------------------------------

describe('getImageDisplayRect', () => {
  beforeEach(() => {
    setPageOffset(0, 0);
  });

  afterEach(() => {
    setPageOffset(0, 0);
  });

  it('returns correct display rect when page is not scrolled', () => {
    const img = makeFakeImg(100, 50, 800, 600);
    expect(getImageDisplayRect(img)).toEqual({
      left: 100,
      top: 50,
      width: 800,
      height: 600,
    });
  });

  it('adds pageXOffset and pageYOffset when page is scrolled', () => {
    setPageOffset(20, 30);
    const img = makeFakeImg(100, 50, 800, 600);
    expect(getImageDisplayRect(img)).toEqual({
      left: 120,
      top: 80,
      width: 800,
      height: 600,
    });
  });

  it('passes through a zoomed-in rect unchanged (pageOffset=0)', () => {
    // Simulate a pinch-zoom scenario where the browser rect already reflects
    // the visual scale — the function does not touch visualViewport itself.
    const img = makeFakeImg(150, 100, 1200, 900);
    expect(getImageDisplayRect(img)).toEqual({
      left: 150,
      top: 100,
      width: 1200,
      height: 900,
    });
  });

  it('returns null when rect width is 0', () => {
    const img = makeFakeImg(100, 50, 0, 600);
    expect(getImageDisplayRect(img)).toBeNull();
  });

  it('returns null when rect height is 0', () => {
    const img = makeFakeImg(100, 50, 800, 0);
    expect(getImageDisplayRect(img)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// imageToScreenRect / screenToImageRect — round-trip at various scales
// ---------------------------------------------------------------------------

describe('imageToScreenRect / screenToImageRect round-trip', () => {
  const originalWidth = 1000;
  const baseState: NoteState = {
    x: 100,
    y: 200,
    w: 50,
    h: 30,
    text: 'irrelevant',
  };
  // Non-origin offset to exercise offset arithmetic
  const baseDisplayLeft = 50;
  const baseDisplayTop = 25;

  function roundTrip(
    state: NoteState,
    displayRect: DisplayRect,
    ow: number,
  ): Rect | null {
    const screen = imageToScreenRect(state, displayRect, ow);
    if (!screen) return null;
    return screenToImageRect(screen, displayRect, ow);
  }

  describe('scale 1.0 (displayRect.width = 1000)', () => {
    const displayRect = makeDisplayRect(
      baseDisplayLeft,
      baseDisplayTop,
      1000,
      750,
    );

    it('round-trips x, y, w, h exactly', () => {
      const round = roundTrip(baseState, displayRect, originalWidth);
      expect(round).not.toBeNull();
      expect(round!.x).toBeCloseTo(100, 10);
      expect(round!.y).toBeCloseTo(200, 10);
      expect(round!.w).toBeCloseTo(50, 10);
      expect(round!.h).toBeCloseTo(30, 10);
    });
  });

  describe('scale 1.5 (displayRect.width = 1500)', () => {
    const displayRect = makeDisplayRect(
      baseDisplayLeft,
      baseDisplayTop,
      1500,
      1125,
    );

    it('round-trips x, y, w, h exactly', () => {
      const round = roundTrip(baseState, displayRect, originalWidth);
      expect(round).not.toBeNull();
      expect(round!.x).toBeCloseTo(100, 10);
      expect(round!.y).toBeCloseTo(200, 10);
      expect(round!.w).toBeCloseTo(50, 10);
      expect(round!.h).toBeCloseTo(30, 10);
    });
  });

  describe('scale 3.0 (displayRect.width = 3000)', () => {
    const displayRect = makeDisplayRect(
      baseDisplayLeft,
      baseDisplayTop,
      3000,
      2250,
    );

    it('round-trips x, y, w, h exactly', () => {
      const round = roundTrip(baseState, displayRect, originalWidth);
      expect(round).not.toBeNull();
      expect(round!.x).toBeCloseTo(100, 10);
      expect(round!.y).toBeCloseTo(200, 10);
      expect(round!.w).toBeCloseTo(50, 10);
      expect(round!.h).toBeCloseTo(30, 10);
    });
  });
});

// ---------------------------------------------------------------------------
// imageToScreenRect — originalWidth=0 fallback
// ---------------------------------------------------------------------------

describe('imageToScreenRect', () => {
  it('falls back to scale=1 when originalWidth is 0', () => {
    const state: NoteState = {x: 10, y: 20, w: 5, h: 5, text: ''};
    const displayRect = makeDisplayRect(0, 0, 100, 100);
    const result = imageToScreenRect(state, displayRect, 0);
    expect(result).toEqual({left: 10, top: 20, width: 5, height: 5});
  });
});

// ---------------------------------------------------------------------------
// screenToImageRect — originalWidth=0 returns null
// ---------------------------------------------------------------------------

describe('screenToImageRect', () => {
  it('returns null when originalWidth is 0', () => {
    const r = makeDisplayRect(10, 20, 5, 5);
    const displayRect = makeDisplayRect(0, 0, 100, 100);
    expect(screenToImageRect(r, displayRect, 0)).toBeNull();
  });
});
