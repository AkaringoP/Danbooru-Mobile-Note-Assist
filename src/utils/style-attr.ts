/**
 * Parser + serializer for inline CSS `style="..."` attribute strings.
 *
 * Used by the style sub-popover's markup integration (Phase 5) to
 * detect, mutate, and serialize the property bag carried by inline
 * `<span style="...">` / `<div style="...">` wrappers. The model is a
 * `Map<string, string>` keyed by lowercased property name so callers
 * can do `set` / `get` / `delete` without re-parsing the source.
 *
 * Constraints from Danbooru `NoteSanitizer` (verified 2026-05-14):
 *  - property names are CSS-standard (lowercase, kebab-case)
 *  - values may contain colons, commas, quotes, parens (e.g.
 *    `font-family: "slab sans"`, `transform: scale(1, 2)`) — the parser
 *    must NOT split on `:` or `;` that sit inside quotes or parens
 *  - serialize output uses `key: value; key: value` (colon+space, no
 *    trailing semicolon) for consistency with the wiki's example markup
 */

/**
 * Parse an inline CSS style string into a Map keyed by lowercased
 * property name. Values are kept as-is so case (hex, `slab sans`) and
 * units (`%`, `px`) survive a parse-then-serialize round-trip.
 *
 * Tolerates trailing semicolons, multiple spaces around `:` / `;`,
 * quoted values with internal `;` or `:`, and parenthesized values
 * with internal `,`. Drops malformed declarations (no `:`, empty name,
 * empty value) silently — caller's UI gets a best-effort property bag
 * instead of a parse error.
 */
export function parseStyleAttr(s: string): Map<string, string> {
  const result = new Map<string, string>();
  if (!s) return result;

  for (const decl of splitDeclarations(s)) {
    const colonIdx = findFirstUnquoted(decl, ':');
    if (colonIdx === -1) continue;
    const name = decl.slice(0, colonIdx).trim().toLowerCase();
    const value = decl.slice(colonIdx + 1).trim();
    if (!name || !value) continue;
    result.set(name, value);
  }
  return result;
}

/**
 * Serialize a property Map back into a normalized style string.
 * Iteration order matches Map insertion order, so callers control the
 * output sequence by mutating in their preferred order. Empty-value
 * entries are skipped — mid-mutate callers can stage a removal by
 * setting `''` without producing `key: ; key2: value`.
 */
export function serializeStyleAttr(m: Map<string, string>): string {
  const parts: string[] = [];
  for (const [k, v] of m) {
    if (!k || !v) continue;
    parts.push(`${k}: ${v}`);
  }
  return parts.join('; ');
}

function splitDeclarations(s: string): string[] {
  const result: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote && s[i - 1] !== '\\') quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '(') {
      depth++;
    } else if (c === ')') {
      depth--;
    } else if (c === ';' && depth === 0) {
      const seg = s.slice(start, i).trim();
      if (seg) result.push(seg);
      start = i + 1;
    }
  }
  const last = s.slice(start).trim();
  if (last) result.push(last);
  return result;
}

function findFirstUnquoted(s: string, target: string): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote && s[i - 1] !== '\\') quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '(') {
      depth++;
    } else if (c === ')') {
      depth--;
    } else if (c === target && depth === 0) {
      return i;
    }
  }
  return -1;
}
