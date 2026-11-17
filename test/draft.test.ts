/**
 * Unit tests for src/state/draft.ts.
 * vitest globals: describe/it/expect/beforeEach/afterEach/vi — no explicit imports needed.
 */

import {
  MAX_DRAFT_AGE_MS,
  DRAFT_SCHEMA_VERSION,
  saveDraft,
  loadDraft,
  clearDraft,
  safeSetItem,
  safeGetItem,
  safeRemoveItem,
  sweepExpiredDrafts,
} from '../src/state/draft';
import type {DraftSnapshot} from '../src/state/draft';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SAVE_TIME = new Date('2026-05-12T00:00:00Z');
const FRESH_LOAD_TIME = new Date('2026-05-12T01:00:00Z'); // 1h later — within TTL
const EXPIRED_LOAD_TIME = new Date('2026-05-13T00:00:01Z'); // 24h+1s — beyond TTL

function makeSnapshot(overrides: Partial<DraftSnapshot> = {}): DraftSnapshot {
  return {
    mode: 'active',
    activeNoteId: null,
    notes: [],
    actionLog: [],
    ...overrides,
  };
}

function setPathname(path: string): void {
  window.history.pushState(null, '', path);
}

function draftKey(postId: string): string {
  return `dmna_draft_${postId}`;
}

// ---------------------------------------------------------------------------
// MAX_DRAFT_AGE_MS constant
// ---------------------------------------------------------------------------

describe('MAX_DRAFT_AGE_MS', () => {
  it('equals exactly 24 * 60 * 60 * 1000', () => {
    expect(MAX_DRAFT_AGE_MS).toBe(24 * 60 * 60 * 1000);
  });
});

// ---------------------------------------------------------------------------
// DRAFT_SCHEMA_VERSION constant
// ---------------------------------------------------------------------------

describe('DRAFT_SCHEMA_VERSION', () => {
  it('is exported and equals 1', () => {
    expect(DRAFT_SCHEMA_VERSION).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// safeSetItem
// ---------------------------------------------------------------------------

describe('safeSetItem', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('returns true on success and stores the value', () => {
    const result = safeSetItem('test-key', 'test-value');
    expect(result).toBe(true);
    expect(localStorage.getItem('test-key')).toBe('test-value');
  });

  it('returns false and calls console.warn on QuotaExceededError', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const spy = vi
      .spyOn(window.localStorage, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('quota exceeded', 'QuotaExceededError');
      });

    const result = safeSetItem('some-key', 'some-value');

    expect(result).toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('returns false and calls console.warn on SecurityError (private mode)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const spy = vi
      .spyOn(window.localStorage, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('access denied', 'SecurityError');
      });

    const result = safeSetItem('other-key', 'other-value');

    expect(result).toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe('safeRemoveItem (Task 4.2)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('removes the key', () => {
    localStorage.setItem('gone', '1');
    safeRemoveItem('gone');
    expect(localStorage.getItem('gone')).toBeNull();
  });

  it('swallows a SecurityError and warns instead of throwing', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const spy = vi
      .spyOn(window.localStorage, 'removeItem')
      .mockImplementation(() => {
        throw new DOMException('access denied', 'SecurityError');
      });
    try {
      expect(() => safeRemoveItem('k')).not.toThrow();
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      // happy-dom's Storage isn't reset by restoreAllMocks.
      spy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// safeGetItem
// ---------------------------------------------------------------------------

describe('safeGetItem', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('returns the stored value on success', () => {
    localStorage.setItem('get-test', 'hello');
    expect(safeGetItem('get-test')).toBe('hello');
  });

  it('returns null for a missing key', () => {
    expect(safeGetItem('nonexistent-key')).toBeNull();
  });

  it('returns null and calls console.warn on SecurityError', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const spy = vi
      .spyOn(window.localStorage, 'getItem')
      .mockImplementation(() => {
        throw new DOMException('access denied', 'SecurityError');
      });

    const result = safeGetItem('any-key');

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// saveDraft
// ---------------------------------------------------------------------------

describe('saveDraft', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(SAVE_TIME);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
    setPathname('/');
  });

  it('writes JSON under dmna_draft_{postId} for a post page', () => {
    setPathname('/posts/12345');
    saveDraft(makeSnapshot());

    const raw = localStorage.getItem(draftKey('12345'));
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(typeof parsed).toBe('object');
  });

  it('is a no-op on a non-post page (no key written)', () => {
    setPathname('/users/1');
    saveDraft(makeSnapshot());

    // Nothing matching dmna_draft_ should have been written
    expect(localStorage.getItem('dmna_draft_undefined')).toBeNull();
    expect(localStorage.length).toBe(0);
  });

  it('payload includes schemaVersion: 1', () => {
    setPathname('/posts/111');
    saveDraft(makeSnapshot());

    const parsed = JSON.parse(localStorage.getItem(draftKey('111'))!);
    expect(parsed.schemaVersion).toBe(1);
  });

  it('payload includes savedAt as a number (Date.now())', () => {
    setPathname('/posts/222');
    saveDraft(makeSnapshot());

    const parsed = JSON.parse(localStorage.getItem(draftKey('222'))!);
    expect(typeof parsed.savedAt).toBe('number');
    expect(parsed.savedAt).toBe(SAVE_TIME.getTime());
  });

  it('payload contains the snapshot fields passed in', () => {
    setPathname('/posts/333');
    const snapshot = makeSnapshot({
      mode: 'active',
      activeNoteId: 'temp-abc',
      notes: [
        [
          'temp-abc',
          {
            current: {x: 1, y: 2, w: 3, h: 4, text: 'hi'},
            initialState: {x: 1, y: 2, w: 3, h: 4, text: 'hi'},
            confirmedState: {x: 1, y: 2, w: 3, h: 4, text: 'hi'},
            isDeleted: false,
            isServerNote: false,
            everConfirmed: false,
          },
        ],
      ],
      actionLog: [],
    });
    saveDraft(snapshot);

    const parsed = JSON.parse(localStorage.getItem(draftKey('333'))!);
    expect(parsed.mode).toBe('active');
    expect(parsed.activeNoteId).toBe('temp-abc');
    expect(parsed.notes).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// loadDraft
// ---------------------------------------------------------------------------

describe('loadDraft', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(SAVE_TIME);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
    setPathname('/');
  });

  it('round-trips: loadDraft returns the same snapshot that was saved', () => {
    setPathname('/posts/500');
    const original = makeSnapshot({
      mode: 'active',
      activeNoteId: 'temp-xyz',
      notes: [
        [
          'temp-xyz',
          {
            current: {x: 10, y: 20, w: 30, h: 40, text: 'note'},
            initialState: {x: 10, y: 20, w: 30, h: 40, text: 'note'},
            confirmedState: {x: 10, y: 20, w: 30, h: 40, text: 'note'},
            isDeleted: false,
            isServerNote: false,
            everConfirmed: false,
          },
        ],
      ],
      actionLog: [],
    });
    saveDraft(original);

    vi.setSystemTime(FRESH_LOAD_TIME);
    const loaded = loadDraft();

    expect(loaded).not.toBeNull();
    expect(loaded!.mode).toBe(original.mode);
    expect(loaded!.activeNoteId).toBe(original.activeNoteId);
    expect(loaded!.notes).toEqual(original.notes);
    expect(loaded!.actionLog).toEqual(original.actionLog);
  });

  it('returns null on a non-post page', () => {
    setPathname('/users/1');
    expect(loadDraft()).toBeNull();
  });

  it('returns null when the key is missing', () => {
    setPathname('/posts/600');
    expect(loadDraft()).toBeNull();
  });

  it('returns null + removes key on JSON parse error', () => {
    setPathname('/posts/700');
    localStorage.setItem(draftKey('700'), '{not valid json{{');
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = loadDraft();

    expect(result).toBeNull();
    expect(localStorage.getItem(draftKey('700'))).toBeNull();
  });

  it('returns null + removes key when savedAt is older than MAX_DRAFT_AGE_MS', () => {
    setPathname('/posts/800');
    saveDraft(makeSnapshot());

    vi.setSystemTime(EXPIRED_LOAD_TIME);
    const result = loadDraft();

    expect(result).toBeNull();
    expect(localStorage.getItem(draftKey('800'))).toBeNull();
  });

  it('returns null + removes key on schemaVersion mismatch (version 2)', () => {
    setPathname('/posts/900');
    const payload = {
      schemaVersion: 2,
      savedAt: SAVE_TIME.getTime(),
      mode: 'active',
      activeNoteId: null,
      notes: [],
      actionLog: [],
    };
    localStorage.setItem(draftKey('900'), JSON.stringify(payload));

    const result = loadDraft();

    expect(result).toBeNull();
    expect(localStorage.getItem(draftKey('900'))).toBeNull();
  });

  it('returns null + removes key when notes field is missing', () => {
    setPathname('/posts/901');
    const payload = {
      schemaVersion: 1,
      savedAt: SAVE_TIME.getTime(),
      mode: 'active',
      activeNoteId: null,
      // notes intentionally omitted
      actionLog: [],
    };
    localStorage.setItem(draftKey('901'), JSON.stringify(payload));

    const result = loadDraft();

    expect(result).toBeNull();
    expect(localStorage.getItem(draftKey('901'))).toBeNull();
  });

  it('returns null + removes key when mode is an invalid value', () => {
    setPathname('/posts/902');
    const payload = {
      schemaVersion: 1,
      savedAt: SAVE_TIME.getTime(),
      mode: 'editing', // not 'idle' | 'active'
      activeNoteId: null,
      notes: [],
      actionLog: [],
    };
    localStorage.setItem(draftKey('902'), JSON.stringify(payload));

    const result = loadDraft();

    expect(result).toBeNull();
    expect(localStorage.getItem(draftKey('902'))).toBeNull();
  });

  it('returns null + removes key when activeNoteId is a non-string, non-null value', () => {
    setPathname('/posts/903');
    const payload = {
      schemaVersion: 1,
      savedAt: SAVE_TIME.getTime(),
      mode: 'active',
      activeNoteId: 42, // should be string | null
      notes: [],
      actionLog: [],
    };
    localStorage.setItem(draftKey('903'), JSON.stringify(payload));

    const result = loadDraft();

    expect(result).toBeNull();
    expect(localStorage.getItem(draftKey('903'))).toBeNull();
  });

  it('strips schemaVersion and savedAt from the returned object', () => {
    setPathname('/posts/1000');
    saveDraft(makeSnapshot());

    vi.setSystemTime(FRESH_LOAD_TIME);
    const loaded = loadDraft();

    expect(loaded).not.toBeNull();
    expect('schemaVersion' in loaded!).toBe(false);
    expect('savedAt' in loaded!).toBe(false);
  });

  it('returned object has exactly the DraftSnapshot fields', () => {
    setPathname('/posts/1001');
    saveDraft(makeSnapshot({mode: 'idle'}));

    vi.setSystemTime(FRESH_LOAD_TIME);
    const loaded = loadDraft();

    expect(loaded).not.toBeNull();
    expect(Object.keys(loaded!).sort()).toEqual(
      ['activeNoteId', 'actionLog', 'mode', 'notes'].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// clearDraft
// ---------------------------------------------------------------------------

describe('clearDraft', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(SAVE_TIME);
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
    setPathname('/');
  });

  it('removes the key if present', () => {
    setPathname('/posts/2000');
    saveDraft(makeSnapshot());
    expect(localStorage.getItem(draftKey('2000'))).not.toBeNull();

    clearDraft();

    expect(localStorage.getItem(draftKey('2000'))).toBeNull();
  });

  it('is idempotent on a missing key — no throw', () => {
    setPathname('/posts/2001');
    expect(() => clearDraft()).not.toThrow();
    expect(localStorage.getItem(draftKey('2001'))).toBeNull();
  });

  it('is a no-op on a non-post page', () => {
    // Manually plant a key to verify it stays untouched
    localStorage.setItem(draftKey('3000'), 'something');
    setPathname('/users/1');

    clearDraft();

    // The key is still there — clearDraft had no post id to act on
    expect(localStorage.getItem(draftKey('3000'))).toBe('something');
  });
});

// ---------------------------------------------------------------------------
// Per-post key isolation
// ---------------------------------------------------------------------------

describe('per-post key isolation', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(SAVE_TIME);
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
    setPathname('/');
  });

  it('saveDraft for /posts/100 then loadDraft on /posts/200 returns null', () => {
    setPathname('/posts/100');
    saveDraft(makeSnapshot({mode: 'active'}));

    vi.setSystemTime(FRESH_LOAD_TIME);
    setPathname('/posts/200');
    const result = loadDraft();

    expect(result).toBeNull();
    // The /posts/100 key should still be there
    expect(localStorage.getItem(draftKey('100'))).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Note id validation (v5.1 Task 2.2)
// ---------------------------------------------------------------------------

describe('loadDraft — note id validation', () => {
  const ST = {x: 1, y: 2, w: 30, h: 40, text: 't'};
  const UUID_TEMP = 'temp-0f8fad5b-d9cb-469f-a165-70867728950e';

  function entry(isServerNote: boolean) {
    return {
      current: ST,
      initialState: ST,
      confirmedState: ST,
      isDeleted: false,
      isServerNote,
      everConfirmed: true,
    };
  }

  function store(overrides: Record<string, unknown>): void {
    localStorage.setItem(
      draftKey('123'),
      JSON.stringify({
        schemaVersion: DRAFT_SCHEMA_VERSION,
        savedAt: Date.now(),
        mode: 'active',
        activeNoteId: null,
        notes: [],
        actionLog: [],
        ...overrides,
      }),
    );
  }

  beforeEach(() => {
    localStorage.clear();
    setPathname('/posts/123');
  });

  afterEach(() => {
    localStorage.clear();
    setPathname('/');
  });

  it('accepts uuid temp ids and numeric server ids', () => {
    store({
      activeNoteId: UUID_TEMP,
      notes: [
        [UUID_TEMP, entry(false)],
        ['4535572', entry(true)],
      ],
      actionLog: [
        [UUID_TEMP, [{noteId: UUID_TEMP, type: 'create', prevState: null}]],
        ['4535572', [{noteId: '4535572', type: 'edit', prevState: ST}]],
      ],
    });
    expect(loadDraft()).not.toBeNull();
  });

  it.each([
    ['a path-like note key', {notes: [['../favorites/5', entry(true)]]}],
    ['a numeric key flagged as temp', {notes: [['42', entry(false)]]}],
    ['a temp key flagged as server', {notes: [['temp-abc', entry(true)]]}],
    ['an empty temp suffix', {notes: [['temp-', entry(false)]]}],
    [
      'a bad actionLog key',
      {
        actionLog: [
          ['5/../6', [{noteId: '5', type: 'create', prevState: null}]],
        ],
      },
    ],
    [
      'a bad noteId inside an actionLog entry',
      {
        actionLog: [
          ['5', [{noteId: '5?x=1', type: 'create', prevState: null}]],
        ],
      },
    ],
    ['a bad activeNoteId', {activeNoteId: '5.json'}],
  ])('rejects %s and drops the key', (_label, overrides) => {
    store(overrides);
    expect(loadDraft()).toBeNull();
    expect(localStorage.getItem(draftKey('123'))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// sweepExpiredDrafts (v5.1 Task 3.3)
// ---------------------------------------------------------------------------

describe('sweepExpiredDrafts', () => {
  const NOW = new Date('2026-11-17T00:00:00Z').getTime();

  function envelope(savedAt: number, schemaVersion = DRAFT_SCHEMA_VERSION) {
    return JSON.stringify({
      schemaVersion,
      savedAt,
      mode: 'active',
      activeNoteId: null,
      notes: [],
      actionLog: [],
    });
  }

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('removes expired, unparseable and other-schema drafts only', () => {
    localStorage.setItem(draftKey('1'), envelope(NOW - MAX_DRAFT_AGE_MS - 1));
    localStorage.setItem(draftKey('2'), envelope(NOW - 1000));
    localStorage.setItem(draftKey('3'), '{not json');
    localStorage.setItem(draftKey('4'), envelope(NOW - 1000, 99));
    localStorage.setItem(draftKey('5'), envelope(NOW - MAX_DRAFT_AGE_MS));
    localStorage.setItem('dmna_btn_margin_y', '80');
    localStorage.setItem('unrelated', 'x');

    expect(sweepExpiredDrafts(NOW)).toBe(3);

    expect(Object.keys(localStorage).sort()).toEqual([
      'dmna_btn_margin_y',
      draftKey('2'),
      draftKey('5'),
      'unrelated',
    ]);
  });

  it('returns 0 and does not throw when storage is unavailable', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage')!;
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('denied', 'SecurityError');
      },
    });
    try {
      expect(sweepExpiredDrafts(NOW)).toBe(0);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, 'localStorage', original);
      warnSpy.mockRestore();
    }
  });
});

describe('loadDraft — postOutcomeUnknown (review #1)', () => {
  const ST = {x: 1, y: 2, w: 30, h: 40, text: 't'};
  function store(flag: unknown): void {
    localStorage.setItem(
      draftKey('123'),
      JSON.stringify({
        schemaVersion: DRAFT_SCHEMA_VERSION,
        savedAt: Date.now(),
        mode: 'active',
        activeNoteId: null,
        notes: [
          [
            'temp-abc',
            {
              current: ST,
              initialState: ST,
              confirmedState: ST,
              isDeleted: false,
              isServerNote: false,
              everConfirmed: true,
              postOutcomeUnknown: flag,
            },
          ],
        ],
        actionLog: [],
      }),
    );
  }

  beforeEach(() => {
    localStorage.clear();
    setPathname('/posts/123');
  });

  afterEach(() => {
    localStorage.clear();
    setPathname('/');
  });

  it('keeps the flag', () => {
    store(true);
    expect(loadDraft()!.notes[0][1].postOutcomeUnknown).toBe(true);
  });

  it('rejects a non-boolean flag', () => {
    store('yes');
    expect(loadDraft()).toBeNull();
  });
});
