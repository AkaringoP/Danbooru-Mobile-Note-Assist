import {describe, expect, it} from 'vitest';

import {parseStyleAttr, serializeStyleAttr} from '../src/utils/style-attr';

describe('parseStyleAttr', () => {
  it('returns empty map for empty / whitespace input', () => {
    expect(parseStyleAttr('').size).toBe(0);
    expect(parseStyleAttr('   ').size).toBe(0);
  });

  it('parses a single property', () => {
    const m = parseStyleAttr('color: red');
    expect(m.size).toBe(1);
    expect(m.get('color')).toBe('red');
  });

  it('parses multiple properties', () => {
    const m = parseStyleAttr('color: red; font-size: 150%');
    expect(m.get('color')).toBe('red');
    expect(m.get('font-size')).toBe('150%');
  });

  it('tolerates trailing semicolon', () => {
    const m = parseStyleAttr('color: red;');
    expect(m.size).toBe(1);
    expect(m.get('color')).toBe('red');
  });

  it('tolerates loose spacing around colon and semicolon', () => {
    const m = parseStyleAttr('  color  :   red  ;  font-size : 100% ');
    expect(m.get('color')).toBe('red');
    expect(m.get('font-size')).toBe('100%');
  });

  it('lowercases property names', () => {
    const m = parseStyleAttr('COLOR: red; Font-Family: serif');
    expect(m.get('color')).toBe('red');
    expect(m.get('font-family')).toBe('serif');
  });

  it('preserves value case and units', () => {
    const m = parseStyleAttr(
      'color: #FF00CC; font-size: 150%; background-color: #FDD835',
    );
    expect(m.get('color')).toBe('#FF00CC');
    expect(m.get('font-size')).toBe('150%');
    expect(m.get('background-color')).toBe('#FDD835');
  });

  it('handles quoted font-family with internal spaces', () => {
    const m = parseStyleAttr('font-family: "slab sans"');
    expect(m.get('font-family')).toBe('"slab sans"');
  });

  it('handles quoted value with internal semicolon', () => {
    const m = parseStyleAttr('font-family: "weird;name"; color: red');
    expect(m.get('font-family')).toBe('"weird;name"');
    expect(m.get('color')).toBe('red');
  });

  it('handles parenthesized value with internal comma', () => {
    const m = parseStyleAttr('transform: scale(1, 2); color: red');
    expect(m.get('transform')).toBe('scale(1, 2)');
    expect(m.get('color')).toBe('red');
  });

  it('drops malformed declarations silently', () => {
    const m = parseStyleAttr('color; bogus; font-size: 100%');
    expect(m.size).toBe(1);
    expect(m.get('font-size')).toBe('100%');
  });

  it('drops empty name / empty value declarations', () => {
    expect(parseStyleAttr(': red').size).toBe(0);
    expect(parseStyleAttr('color:').size).toBe(0);
    expect(parseStyleAttr('color: ').size).toBe(0);
  });

  it('keeps last value when a property is repeated', () => {
    const m = parseStyleAttr('color: red; color: blue');
    expect(m.size).toBe(1);
    expect(m.get('color')).toBe('blue');
  });
});

describe('serializeStyleAttr', () => {
  it('returns empty string for empty map', () => {
    expect(serializeStyleAttr(new Map())).toBe('');
  });

  it('serializes a single property', () => {
    expect(serializeStyleAttr(new Map([['color', 'red']]))).toBe('color: red');
  });

  it('serializes multiple properties in insertion order', () => {
    const m = new Map<string, string>();
    m.set('color', 'red');
    m.set('font-size', '150%');
    expect(serializeStyleAttr(m)).toBe('color: red; font-size: 150%');
  });

  it('no trailing semicolon', () => {
    const out = serializeStyleAttr(new Map([['color', 'red']]));
    expect(out.endsWith(';')).toBe(false);
  });

  it('skips entries with empty value', () => {
    const m = new Map([
      ['color', 'red'],
      ['font-size', ''],
    ]);
    expect(serializeStyleAttr(m)).toBe('color: red');
  });
});

describe('parseStyleAttr → serializeStyleAttr round-trip', () => {
  it('round-trips a canonical multi-property style', () => {
    const input = 'color: #FF00CC; font-size: 150%; font-family: "slab sans"';
    expect(serializeStyleAttr(parseStyleAttr(input))).toBe(input);
  });

  it('normalizes loose input to canonical form', () => {
    const input = '  COLOR : red ;  font-size:150%; ';
    expect(serializeStyleAttr(parseStyleAttr(input))).toBe(
      'color: red; font-size: 150%',
    );
  });
});

describe('mutate / remove patterns (caller usage)', () => {
  it('adds a new property to an existing map', () => {
    const m = parseStyleAttr('color: red');
    m.set('font-size', '150%');
    expect(serializeStyleAttr(m)).toBe('color: red; font-size: 150%');
  });

  it('replaces an existing property value', () => {
    const m = parseStyleAttr('color: red; font-size: 150%');
    m.set('color', 'blue');
    expect(serializeStyleAttr(m)).toBe('color: blue; font-size: 150%');
  });

  it('removes a property leaving others intact', () => {
    const m = parseStyleAttr('color: red; font-size: 150%; font-family: serif');
    m.delete('font-size');
    expect(serializeStyleAttr(m)).toBe('color: red; font-family: serif');
  });

  it('removing the last property yields an empty serialized string', () => {
    const m = parseStyleAttr('color: red');
    m.delete('color');
    expect(m.size).toBe(0);
    expect(serializeStyleAttr(m)).toBe('');
  });
});
