/**
 * Unit tests for src/interactions/image-pointer.ts — listener options.
 * vitest globals: describe/it/expect/vi.
 */

const imgEl = vi.hoisted(() => ({current: null as HTMLImageElement | null}));

vi.mock('../src/utils/dom', () => ({
  getImageElement: () => imgEl.current,
}));
vi.mock('../src/ui/note-box', () => ({updateAllNoteBoxPositions: vi.fn()}));
vi.mock('../src/ui/popover', () => ({
  dismissActivePopover: vi.fn(),
  focusActiveNoteInput: vi.fn(),
}));
vi.mock('../src/ui/toast', () => ({showToast: vi.fn()}));
vi.mock('../src/state/notes-store', () => ({
  createTempNote: vi.fn(),
  getActiveNoteId: vi.fn(() => null),
  getMode: vi.fn(() => 'active'),
  setActiveNote: vi.fn(),
}));

import {bindImageHandlers} from '../src/interactions/image-pointer';

describe('bindImageHandlers — touchstart blocker (Task 3.1)', () => {
  it('is capture-phase and passive (it never calls preventDefault)', () => {
    const img = document.createElement('img');
    imgEl.current = img;
    const spy = vi.spyOn(img, 'addEventListener');

    bindImageHandlers();

    const call = spy.mock.calls.find(c => c[0] === 'touchstart');
    expect(call).toBeDefined();
    expect(call![2]).toEqual({capture: true, passive: true});
  });

  it('still stops touchstart propagation in active mode', () => {
    const container = document.createElement('div');
    const img = imgEl.current!;
    container.appendChild(img);
    const native = vi.fn();
    container.addEventListener('touchstart', native);
    img.dispatchEvent(new Event('touchstart', {bubbles: true}));
    expect(native).not.toHaveBeenCalled();
  });
});
