/**
 * Unit tests for detectOuterLayers (style-popover, Phase 5-h Task 5.33).
 *
 * Pure function operating on `before` / `after` slices of a textarea
 * value — no DOM needed, but vitest already runs in happy-dom for
 * other tests. Walks outward from the selection and returns matched
 * `<tag>...</tag>` wrappers in inner-to-outer order.
 */

import {describe, expect, it} from 'vitest';

import {detectOuterLayers} from '../src/ui/style-popover';

describe('detectOuterLayers', () => {
  it('returns empty array when there is no wrap around the selection', () => {
    expect(detectOuterLayers('plain ', ' text')).toEqual([]);
  });

  it('detects a single bare wrap', () => {
    const layers = detectOuterLayers('<b>', '</b>');
    expect(layers.length).toBe(1);
    expect(layers[0].tag).toBe('b');
    expect(layers[0].attrs).toBe('');
    expect(layers[0].openLen).toBe(3);
    expect(layers[0].closeLen).toBe(4);
  });

  it('returns inner-to-outer order for nested wraps', () => {
    const layers = detectOuterLayers('<i><b>', '</b></i>');
    expect(layers.map(l => l.tag)).toEqual(['b', 'i']);
  });

  it('lowercases the matched tag name', () => {
    const layers = detectOuterLayers('<B>', '</b>');
    expect(layers.length).toBe(1);
    expect(layers[0].tag).toBe('b');
  });

  it('preserves the attribute run verbatim on tags with attrs', () => {
    const layers = detectOuterLayers('<a href="https://example.com">', '</a>');
    expect(layers.length).toBe(1);
    expect(layers[0].tag).toBe('a');
    expect(layers[0].attrs).toBe(' href="https://example.com"');
    expect(layers[0].openLen).toBe('<a href="https://example.com">'.length);
  });

  it('parses style="..." into a styleProps map on span', () => {
    const layers = detectOuterLayers(
      '<span style="color: red; font-size: 150%">',
      '</span>',
    );
    expect(layers.length).toBe(1);
    expect(layers[0].tag).toBe('span');
    expect(layers[0].styleProps?.get('color')).toBe('red');
    expect(layers[0].styleProps?.get('font-size')).toBe('150%');
  });

  it('parses single-quoted style attributes too', () => {
    const layers = detectOuterLayers("<span style='color: blue'>", '</span>');
    expect(layers.length).toBe(1);
    expect(layers[0].styleProps?.get('color')).toBe('blue');
  });

  it('leaves styleProps undefined when the tag carries no style attr', () => {
    const layers = detectOuterLayers('<b>', '</b>');
    expect(layers[0].styleProps).toBeUndefined();
  });

  it('stops walking on the first non-matching layer (mismatched close)', () => {
    // before ends with `<i><b>`, after starts with `</b></u>` — outer
    // close is `</u>` but outer open is `<i>`, so detection halts after
    // the inner b/b match.
    const layers = detectOuterLayers('<i><b>', '</b></u>');
    expect(layers.map(l => l.tag)).toEqual(['b']);
  });

  it('returns empty when before ends in a wrap but after has no matching close', () => {
    expect(detectOuterLayers('<b>', 'plain')).toEqual([]);
  });

  it('returns empty when after starts with a close that has no matching open', () => {
    expect(detectOuterLayers('plain', '</b>')).toEqual([]);
  });

  it('does not match when wrap is not adjacent to the selection (text between)', () => {
    // The slice anchoring is strict — `<b>` must be the very last
    // characters of `before`, and `</b>` the very first of `after`.
    expect(detectOuterLayers('<b>nearby ', '</b>')).toEqual([]);
  });

  it('records correct openStart / closeStart offsets for nested wraps', () => {
    const before = '<i><b>';
    const after = '</b></i>';
    const layers = detectOuterLayers(before, after);
    expect(layers.length).toBe(2);
    // Inner b: starts at index 3 in `before`, closeStart 0 in `after`
    expect(layers[0].tag).toBe('b');
    expect(layers[0].openStart).toBe(3);
    expect(layers[0].closeStart).toBe(0);
    expect(layers[0].openLen).toBe(3);
    expect(layers[0].closeLen).toBe(4);
    // Outer i: starts at index 0 in `before`, closeStart 4 in `after`
    expect(layers[1].tag).toBe('i');
    expect(layers[1].openStart).toBe(0);
    expect(layers[1].closeStart).toBe(4);
    expect(layers[1].openLen).toBe(3);
    expect(layers[1].closeLen).toBe(4);
  });

  it('handles ruby + nested span (a real Phase 5-d case)', () => {
    const before = '<ruby><span style="color: red">';
    const after = '</span><rt>reading</rt></ruby>';
    const layers = detectOuterLayers(before, after);
    // Outer <ruby> close is preceded by `<rt>...</rt>`, so the strict
    // close matcher does NOT recognize it as the immediate close —
    // detection stops after the inner span.
    expect(layers.map(l => l.tag)).toEqual(['span']);
    expect(layers[0].styleProps?.get('color')).toBe('red');
  });

  it('multi-attr open tag preserves the full attribute run', () => {
    const before = '<span class="hl" style="color: red" title="note">';
    const after = '</span>';
    const layers = detectOuterLayers(before, after);
    expect(layers.length).toBe(1);
    expect(layers[0].attrs).toBe(' class="hl" style="color: red" title="note"');
    expect(layers[0].styleProps?.get('color')).toBe('red');
  });
});
