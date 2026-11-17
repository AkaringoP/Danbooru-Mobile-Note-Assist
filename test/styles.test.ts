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
  it('outlines the floating button and the Confirm item in orange (not sent yet)', () => {
    expect(STYLES).toMatch(
      /body\.dmna-has-pending:not\(\.dmna-sending\) #dmna-float-btn:not\(\.expanded\):not\(\.dragging\)[^{]*\{[^}]*#ff9800/,
    );
    expect(STYLES).toMatch(
      /body\.dmna-has-pending \.dmna-menu-item\[data-action="confirm"\][^{]*\{[^}]*#ff9800/,
    );
  });

  it('turns them green once everything was sent', () => {
    expect(STYLES).toMatch(
      /body\.dmna-send-success:not\(\.dmna-sending\) #dmna-float-btn:not\(\.expanded\):not\(\.dragging\)[^{]*\{[^}]*#43a047/,
    );
    expect(STYLES).toMatch(
      /body\.dmna-send-success \.dmna-menu-item\[data-action="confirm"\][^{]*\{[^}]*#43a047/,
    );
  });

  it('glows like the open-menu state instead of a hard ring', () => {
    expect(STYLES).toMatch(
      /body\.dmna-has-pending:not\(\.dmna-sending\) #dmna-float-btn:not\(\.expanded\):not\(\.dragging\)[^{]*\{[^}]*box-shadow:\s*0 0 12px rgba\(255, 152, 0/,
    );
    expect(STYLES).toMatch(
      /body\.dmna-send-success:not\(\.dmna-sending\) #dmna-float-btn:not\(\.expanded\):not\(\.dragging\)[^{]*\{[^}]*box-shadow:\s*0 0 12px rgba\(67, 160, 71/,
    );
  });

  it('adds a rippled ring that turns, on the button and the Confirm item', () => {
    const ring = STYLES.match(
      /#dmna-float-btn:not\(\.expanded\):not\(\.dragging\)::before,[^{]*\.dmna-menu-item\[data-action="confirm"\]::before\s*\{([^}]*)\}/,
    );
    expect(ring).not.toBeNull();
    expect(ring![1]).toMatch(/mask:\s*url\("data:image\/svg\+xml,/);
    expect(ring![1]).toMatch(/animation:\s*dmna-ripple/);
    expect(ring![1]).toMatch(/pointer-events:\s*none/);
    expect(STYLES).toMatch(/@keyframes dmna-ripple/);
  });

  it('holds the ring still for prefers-reduced-motion', () => {
    expect(STYLES).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*::before[^{]*\{[^}]*animation:\s*none/,
    );
  });

  it('draws the count badge from data-pending-count', () => {
    expect(STYLES).toMatch(/content:\s*attr\(data-pending-count\)/);
  });
});

describe('iOS focus zoom: text inputs are at least 16px (Task 4.5)', () => {
  it.each([
    '#dmna-popover-input',
    '#dmna-link-modal-input',
    '#dmna-ruby-modal-input',
    '#dmna-color-hex',
    '#dmna-stroke-hex',
    '.dmna-style-select',
  ])('%s', selector => {
    const m = ruleBody(selector).match(/font-size:\s*(\d+)px/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(16);
  });
});
