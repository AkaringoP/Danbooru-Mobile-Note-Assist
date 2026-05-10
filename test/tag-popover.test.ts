/**
 * Unit tests for src/ui/tag-popover.ts.
 * vitest globals: describe/it/expect/beforeEach/vi — no explicit imports needed.
 */

import {
  applyTagConstraints,
  isTagToggleDisabled,
  showTagPopover,
} from '../src/ui/tag-popover';

vi.mock('../src/api/posts', () => ({
  fetchPostTagString: vi.fn(),
}));
vi.mock('../src/ui/toast', () => ({
  showToast: vi.fn(),
}));
// Stub modules imported transitively by tag-popover but not under test.
vi.mock('../src/ui/floating-button', () => ({
  getButtonMargins: vi.fn(() => ({marginX: 20, marginY: 80})),
}));

import {fetchPostTagString} from '../src/api/posts';
import {showToast} from '../src/ui/toast';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function freshState(): Record<string, boolean> {
  return {
    translated: false,
    translation_request: false,
    check_translation: false,
    partially_translated: false,
  };
}

// ---------------------------------------------------------------------------
// applyTagConstraints — PLAN.md D9 rules
// ---------------------------------------------------------------------------

describe('applyTagConstraints — PLAN.md D9 rules', () => {
  // Rule 1: translated is exclusive
  describe('rule 1: translated ON makes others OFF', () => {
    it('rule 1: translated ON from all-OFF state → only translated true', () => {
      const result = applyTagConstraints(freshState(), 'translated', true);
      expect(result).toEqual({
        translated: true,
        translation_request: false,
        check_translation: false,
        partially_translated: false,
      });
    });

    it('rule 1: translated ON from all-ON state → only translated true', () => {
      const start = {
        translated: false,
        translation_request: true,
        check_translation: true,
        partially_translated: true,
      };
      const result = applyTagConstraints(start, 'translated', true);
      expect(result).toEqual({
        translated: true,
        translation_request: false,
        check_translation: false,
        partially_translated: false,
      });
    });
  });

  // Rule 2: non-translated ON flips translated OFF
  describe('rule 2: non-translated ON flips translated OFF', () => {
    it('rule 2: translation_request ON → translated OFF', () => {
      const start = {...freshState(), translated: true};
      const result = applyTagConstraints(start, 'translation_request', true);
      expect(result.translated).toBe(false);
      expect(result.translation_request).toBe(true);
    });

    it('rule 2+3 chain: check_translation ON → translated OFF and t_r ON', () => {
      const start = {...freshState(), translated: true};
      const result = applyTagConstraints(start, 'check_translation', true);
      expect(result.translated).toBe(false);
      expect(result.check_translation).toBe(true);
      expect(result.translation_request).toBe(true);
    });

    it('rule 2+3 chain: partially_translated ON → translated OFF and t_r ON', () => {
      const start = {...freshState(), translated: true};
      const result = applyTagConstraints(start, 'partially_translated', true);
      expect(result.translated).toBe(false);
      expect(result.partially_translated).toBe(true);
      expect(result.translation_request).toBe(true);
    });
  });

  // Rule 3: c_t / p_t ON forces t_r ON
  describe('rule 3: c_t or p_t ON forces t_r ON', () => {
    it('rule 3: check_translation ON from all-OFF → t_r becomes true', () => {
      const result = applyTagConstraints(
        freshState(),
        'check_translation',
        true,
      );
      expect(result.translation_request).toBe(true);
      expect(result.check_translation).toBe(true);
    });

    it('rule 3: partially_translated ON from all-OFF → t_r becomes true', () => {
      const result = applyTagConstraints(
        freshState(),
        'partially_translated',
        true,
      );
      expect(result.translation_request).toBe(true);
      expect(result.partially_translated).toBe(true);
    });
  });

  // Rule 4: c_t / p_t OFF does not force t_r OFF
  describe('rule 4: c_t or p_t OFF leaves t_r ON', () => {
    it('rule 4: c_t OFF leaves t_r ON', () => {
      const start = {
        ...freshState(),
        check_translation: true,
        translation_request: true,
      };
      const result = applyTagConstraints(start, 'check_translation', false);
      expect(result.check_translation).toBe(false);
      expect(result.translation_request).toBe(true);
    });

    it('rule 4: p_t OFF leaves t_r ON', () => {
      const start = {
        ...freshState(),
        partially_translated: true,
        translation_request: true,
      };
      const result = applyTagConstraints(start, 'partially_translated', false);
      expect(result.partially_translated).toBe(false);
      expect(result.translation_request).toBe(true);
    });
  });

  // Rule 3 lock guard: t_r cannot go OFF while c_t or p_t is ON
  describe('rule 3 lock guard: t_r OFF snaps back when c_t or p_t is ON', () => {
    it('lock guard: t_r OFF snaps back when c_t is ON', () => {
      const start = {
        ...freshState(),
        check_translation: true,
        translation_request: true,
      };
      const result = applyTagConstraints(start, 'translation_request', false);
      expect(result.translation_request).toBe(true);
    });

    it('lock guard: t_r OFF snaps back when p_t is ON', () => {
      const start = {
        ...freshState(),
        partially_translated: true,
        translation_request: true,
      };
      const result = applyTagConstraints(start, 'translation_request', false);
      expect(result.translation_request).toBe(true);
    });

    it('lock guard: t_r OFF succeeds when neither c_t nor p_t is ON', () => {
      const start = {...freshState(), translation_request: true};
      const result = applyTagConstraints(start, 'translation_request', false);
      expect(result.translation_request).toBe(false);
    });
  });

  // Purity: input state must not be mutated
  describe('purity: input not mutated', () => {
    it('purity: original state is unchanged after call', () => {
      const original = freshState();
      const snapshot = JSON.stringify(original);
      applyTagConstraints(original, 'translated', true);
      expect(JSON.stringify(original)).toBe(snapshot);
    });
  });
});

// ---------------------------------------------------------------------------
// isTagToggleDisabled
// ---------------------------------------------------------------------------

describe('isTagToggleDisabled', () => {
  it('translation_request is disabled when c_t is ON', () => {
    expect(
      isTagToggleDisabled(
        {...freshState(), check_translation: true},
        'translation_request',
      ),
    ).toBe(true);
  });

  it('translation_request is disabled when p_t is ON', () => {
    expect(
      isTagToggleDisabled(
        {...freshState(), partially_translated: true},
        'translation_request',
      ),
    ).toBe(true);
  });

  it('translation_request is disabled when both c_t and p_t are ON', () => {
    expect(
      isTagToggleDisabled(
        {
          ...freshState(),
          check_translation: true,
          partially_translated: true,
        },
        'translation_request',
      ),
    ).toBe(true);
  });

  it('translation_request is NOT disabled when neither c_t nor p_t is ON', () => {
    expect(isTagToggleDisabled(freshState(), 'translation_request')).toBe(
      false,
    );
  });

  it('translated is never disabled', () => {
    expect(
      isTagToggleDisabled(
        {...freshState(), check_translation: true, partially_translated: true},
        'translated',
      ),
    ).toBe(false);
  });

  it('check_translation is never disabled', () => {
    expect(isTagToggleDisabled(freshState(), 'check_translation')).toBe(false);
  });

  it('partially_translated is never disabled', () => {
    expect(isTagToggleDisabled(freshState(), 'partially_translated')).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// showTagPopover — null path on fetchPostTagString failure
// ---------------------------------------------------------------------------

describe('showTagPopover — null path on fetchPostTagString failure', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.mocked(fetchPostTagString).mockReset();
    vi.mocked(showToast).mockReset();
  });

  it('resolves to null and shows error toast when fetch rejects', async () => {
    const err = new Error('network down');
    vi.mocked(fetchPostTagString).mockRejectedValueOnce(err);

    const result = await showTagPopover();

    expect(result).toBeNull();
    expect(showToast).toHaveBeenCalledWith(
      '⚠️ Failed to load post tags',
      'error',
      err,
    );
    expect(document.getElementById('dmna-tag-popover')).toBeNull();
  });

  it('showToast is called exactly once on fetch failure', async () => {
    vi.mocked(fetchPostTagString).mockRejectedValueOnce(new Error('timeout'));

    await showTagPopover();

    expect(vi.mocked(showToast).mock.calls).toHaveLength(1);
  });
});
