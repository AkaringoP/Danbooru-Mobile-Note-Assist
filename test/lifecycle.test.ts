/**
 * Unit tests for src/interactions/lifecycle.ts.
 * vitest globals: describe/it/expect/beforeEach/vi — no explicit imports.
 *
 * The real draft.ts runs against happy-dom's localStorage; the store
 * and confirm-pipeline reads are mocked so each test can set them.
 */

const state = vi.hoisted(() => ({
  mode: 'active' as 'active' | 'idle',
  pending: true,
  content: true,
  sending: false,
  draftSaveBlocked: false,
}));

vi.mock('../src/state/notes-store', () => ({
  getMode: () => state.mode,
  hasContentToSave: () => state.content,
  serializeForDraft: () => ({
    mode: 'active',
    activeNoteId: null,
    notes: [],
    actionLog: [],
  }),
}));
vi.mock('../src/confirm/classify', () => ({
  hasPendingChanges: () => state.pending,
}));
vi.mock('../src/confirm/batch', () => ({
  getIsSending: () => state.sending,
  getIsDraftSaveBlocked: () => state.draftSaveBlocked,
}));

import {bindLifecycleSave} from '../src/interactions/lifecycle';

const KEY = 'dmna_draft_123';

function hasDraft(): boolean {
  return localStorage.getItem(KEY) !== null;
}

function beforeUnload(): Event {
  const e = new Event('beforeunload', {cancelable: true});
  window.dispatchEvent(e);
  return e;
}

function pageHide(): void {
  window.dispatchEvent(new Event('pagehide'));
}

function pageShow(persisted: boolean): void {
  const e = new Event('pageshow');
  Object.defineProperty(e, 'persisted', {value: persisted});
  window.dispatchEvent(e);
}

function hidden(): void {
  Object.defineProperty(document, 'visibilityState', {
    get: () => 'hidden',
    configurable: true,
  });
  document.dispatchEvent(new Event('visibilitychange'));
  delete (document as {visibilityState?: unknown}).visibilityState;
}

describe('bindLifecycleSave', () => {
  beforeAll(() => {
    window.history.pushState(null, '', '/posts/123');
    bindLifecycleSave();
    bindLifecycleSave(); // idempotent: a second bind adds no listeners
  });

  beforeEach(() => {
    // bfcache return resets both latches — the cleanest reset path.
    pageShow(true);
    localStorage.clear();
    Object.assign(state, {
      mode: 'active',
      pending: true,
      content: true,
      sending: false,
      draftSaveBlocked: false,
    });
  });

  it('saves on visibilitychange → hidden', () => {
    hidden();
    expect(hasDraft()).toBe(true);
  });

  it('Leave: beforeunload → pagehide → hidden leaves no draft', () => {
    hidden();
    expect(hasDraft()).toBe(true);
    const e = beforeUnload();
    expect(e.defaultPrevented).toBe(true);
    pageHide();
    hidden();
    expect(hasDraft()).toBe(false);
  });

  it('no pending changes: beforeunload saves without prompting', () => {
    state.pending = false;
    const e = beforeUnload();
    expect(e.defaultPrevented).toBe(false);
    expect(hasDraft()).toBe(true);
  });

  it('Stay: input after the prompt disarms the discard latch', () => {
    beforeUnload();
    document.dispatchEvent(new Event('pointerdown'));
    hidden();
    expect(hasDraft()).toBe(true);
    localStorage.clear();
    pageHide();
    expect(hasDraft()).toBe(true);
  });

  it('Stay via keyboard also disarms the latch', () => {
    beforeUnload();
    document.dispatchEvent(new KeyboardEvent('keydown', {key: 'a'}));
    pageHide();
    expect(hasDraft()).toBe(true);
  });

  it('bfcache return re-enables saving after a Leave', () => {
    beforeUnload();
    pageHide();
    hidden();
    expect(hasDraft()).toBe(false);
    pageShow(true);
    hidden();
    expect(hasDraft()).toBe(true);
  });

  it('a non-persisted pageshow does not reset the latch', () => {
    beforeUnload();
    pageHide();
    pageShow(false);
    hidden();
    expect(hasDraft()).toBe(false);
  });

  it('does not save while a send is in flight', () => {
    state.sending = true;
    hidden();
    pageHide();
    state.pending = false;
    beforeUnload();
    expect(hasDraft()).toBe(false);
  });

  it('does not save while the Confirm pipeline blocks draft saves', () => {
    state.draftSaveBlocked = true;
    hidden();
    pageHide();
    expect(hasDraft()).toBe(false);
  });

  it('does not save when there is nothing worth keeping', () => {
    state.content = false;
    hidden();
    pageHide();
    expect(hasDraft()).toBe(false);
  });

  it('idle mode never prompts', () => {
    state.mode = 'idle';
    state.content = false;
    const e = beforeUnload();
    expect(e.defaultPrevented).toBe(false);
  });
});
