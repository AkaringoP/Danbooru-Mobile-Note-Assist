/**
 * Static guards on the injected STYLES string — CSS that a regression
 * could quietly drop without any runtime test noticing.
 * vitest globals: describe/it/expect — no explicit imports needed.
 */

import {STYLES} from '../src/styles';

/** Concatenated bodies of every rule whose selector list is exactly `selector`. */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|[\\s}])${escaped}\\s*\\{([^}]*)\\}`, 'g');
  return [...STYLES.matchAll(re)].map(m => m[1]).join('\n');
}

describe('Preview containment (Task 2.1)', () => {
  it('the preview is a positioned, paint-contained box', () => {
    const body = ruleBody('#dmna-popover-preview');
    expect(body).toMatch(/position:\s*relative/);
    expect(body).toMatch(/isolation:\s*isolate/);
    expect(body).toMatch(/contain:\s*paint/);
  });

  it('links inside the preview are not tappable', () => {
    expect(ruleBody('#dmna-popover-preview a')).toMatch(
      /pointer-events:\s*none/,
    );
  });
});

describe('Box touch-action (Task 2.5)', () => {
  it('unselected boxes let the browser scroll; the selected box takes drags', () => {
    expect(ruleBody('body.dmna-mode-active .dmna-note-box')).toMatch(
      /touch-action:\s*manipulation/,
    );
    expect(ruleBody('body.dmna-mode-active .dmna-note-box.is-active')).toMatch(
      /touch-action:\s*none/,
    );
  });

  it('handles keep touch-action: none', () => {
    expect(ruleBody('.dmna-handle')).toMatch(/touch-action:\s*none/);
  });
});

describe('Box stacking (Task 2.6)', () => {
  it('boxes take their z-index from --dmna-box-z', () => {
    expect(ruleBody('.dmna-note-box')).toMatch(
      /z-index:\s*var\(--dmna-box-z,\s*9990\)/,
    );
  });

  it('the selected box sits above every other box, below the ghost', () => {
    expect(ruleBody('.dmna-note-box.is-active')).toMatch(/z-index:\s*10495/);
  });
});

describe('Popover action buttons (Task 4.7)', () => {
  it('stay a touch-sized target (min-height ≥ 34px)', () => {
    const m = ruleBody('.dmna-popover-btn').match(/min-height:\s*(\d+)px/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(34);
  });

  it('use Danbooru form-button colors with fallbacks', () => {
    const body = ruleBody('.dmna-popover-btn');
    expect(body).toMatch(/var\(--form-button-background,\s*#[0-9a-f]{6}\)/i);
    expect(body).toMatch(/var\(--form-button-text-color,\s*#[0-9a-f]{6}\)/i);
  });
});

describe('Pending highlight (Task 4.8)', () => {
  it('outlines the floating button and the Confirm item in green', () => {
    expect(STYLES).toMatch(
      /body\.dmna-has-pending:not\(\.dmna-sending\) #dmna-float-btn:not\(\.expanded\):not\(\.dragging\)[^{]*\{[^}]*#43a047/,
    );
    expect(STYLES).toMatch(
      /body\.dmna-has-pending \.dmna-menu-item\[data-action="confirm"\][^{]*\{[^}]*#43a047/,
    );
  });

  it('draws the count badge from data-pending-count', () => {
    expect(STYLES).toMatch(/content:\s*attr\(data-pending-count\)/);
  });
});
