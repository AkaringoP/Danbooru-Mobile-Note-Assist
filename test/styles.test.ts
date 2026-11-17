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
