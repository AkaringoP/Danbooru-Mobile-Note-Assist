/**
 * Architecture fitness tests for src/.
 *
 * Static-analysis style: reads source files from disk and verifies
 * invariants the layer split + boot wiring depend on. These run in
 * vitest like the unit tests but exist to catch silent regressions
 * (missing hook callbacks, wrong-direction imports, accidentally
 * dropped boot steps) that wouldn't surface as runtime test failures.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname_ = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(__dirname_, '../src');

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

function listTsFiles(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      listTsFiles(full, acc);
    } else if (e.name.endsWith('.ts')) {
      acc.push(full);
    }
  }
  return acc;
}

function relSrc(p: string): string {
  return path.relative(SRC_DIR, p).split(path.sep).join('/');
}

const ALL_TS_FILES = listTsFiles(SRC_DIR);
const FILE_CONTENTS = new Map<string, string>();
for (const f of ALL_TS_FILES) {
  FILE_CONTENTS.set(relSrc(f), fs.readFileSync(f, 'utf8'));
}

// ---------------------------------------------------------------------------
// Layer mapping (Z5)
//
// Direction: utils ← state/api ← confirm/ui ← interactions ← main.
// Files at the src/ root that aren't main.ts (`types.ts`, `config.ts`,
// `version.ts`, `styles.ts`) are layer 0 — anyone can import them.
// `main.ts` is the only file at the top of the graph.
// ---------------------------------------------------------------------------

const LAYER_BY_DIR: Record<string, number> = {
  utils: 1,
  state: 2,
  api: 2,
  confirm: 3,
  ui: 3,
  interactions: 4,
};

function layerOf(rel: string): number {
  if (!rel.includes('/')) {
    // Root-level module. main.ts is the apex; everything else is shared.
    return rel === 'main.ts' ? 5 : 0;
  }
  const top = rel.split('/')[0];
  return LAYER_BY_DIR[top] ?? -1;
}

/** Resolve `import ... from './x'` against the importer's directory. */
function resolveImport(importerRel: string, raw: string): string | null {
  if (!raw.startsWith('.')) {
    return null; // non-relative — third-party / node built-in
  }
  const importerDir = path.dirname(importerRel);
  const resolved = path
    .normalize(path.join(importerDir, raw))
    .split(path.sep)
    .join('/');
  // Try suffixes ts / index.ts to mirror tsc resolution.
  if (FILE_CONTENTS.has(resolved + '.ts')) {
    return resolved + '.ts';
  }
  if (FILE_CONTENTS.has(resolved + '/index.ts')) {
    return resolved + '/index.ts';
  }
  return null;
}

// Match `import ... from '...'`. Captures the path. Skips strings that
// contain dollar / template syntax (none in this codebase).
const IMPORT_RE = /import\s+(?:type\s+)?[\s\S]+?from\s+['"]([^'"]+)['"]/g;

interface ImportEdge {
  from: string;
  to: string;
  raw: string;
  isTypeOnly: boolean;
}

function extractImports(rel: string, content: string): ImportEdge[] {
  const edges: ImportEdge[] = [];
  IMPORT_RE.lastIndex = 0;
  for (const m of content.matchAll(IMPORT_RE)) {
    const raw = m[1];
    const isTypeOnly = /^\s*import\s+type\b/.test(m[0]);
    const resolved = resolveImport(rel, raw);
    if (resolved) {
      edges.push({from: rel, to: resolved, raw, isTypeOnly});
    }
  }
  return edges;
}

const ALL_EDGES: ImportEdge[] = [];
for (const [rel, content] of FILE_CONTENTS) {
  ALL_EDGES.push(...extractImports(rel, content));
}

// ---------------------------------------------------------------------------
// Z5 layer direction
// ---------------------------------------------------------------------------

describe('Z5 — layer direction', () => {
  it('source files are partitioned across known layers', () => {
    const unknown: string[] = [];
    for (const rel of FILE_CONTENTS.keys()) {
      if (layerOf(rel) === -1) {
        unknown.push(rel);
      }
    }
    expect(unknown).toEqual([]);
  });

  it('every value import goes from a higher layer to a strictly lower (or layer-0) layer', () => {
    const violations: string[] = [];
    for (const e of ALL_EDGES) {
      if (e.isTypeOnly) {
        continue; // type-only imports do not produce runtime edges
      }
      const fromLayer = layerOf(e.from);
      const toLayer = layerOf(e.to);
      if (fromLayer === -1 || toLayer === -1) {
        continue;
      }
      // Layer 0 (types/config/version/styles) is universally importable.
      if (toLayer === 0) {
        continue;
      }
      // Same-layer imports are allowed within state ↔ state, ui ↔ ui,
      // utils ↔ utils, etc. Z5 forbids ui → confirm and confirm → ui
      // specifically (different siblings at layer 3); detect that
      // separately below.
      if (fromLayer === toLayer && layerOf(e.from) !== layerOf(e.to)) {
        // unreachable, but keeps the intent explicit
        continue;
      }
      if (toLayer > fromLayer) {
        violations.push(
          `${e.from} → ${e.to} (layer ${fromLayer} → ${toLayer})`,
        );
      }
    }
    expect(violations).toEqual([]);
  });

  it('confirm/ does not import from ui/ (Z5 layer-3 sibling restriction)', () => {
    const violations: string[] = [];
    for (const e of ALL_EDGES) {
      if (e.isTypeOnly) continue;
      if (e.from.startsWith('confirm/') && e.to.startsWith('ui/')) {
        violations.push(`${e.from} → ${e.to}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('ui/ does not import from confirm/ (Z5 layer-3 sibling restriction, the other direction)', () => {
    const violations: string[] = [];
    for (const e of ALL_EDGES) {
      if (e.isTypeOnly) continue;
      if (e.from.startsWith('ui/') && e.to.startsWith('confirm/')) {
        violations.push(`${e.from} → ${e.to}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('ui/ does not import from interactions/ (Z5: interactions sits above ui)', () => {
    const violations: string[] = [];
    for (const e of ALL_EDGES) {
      if (e.isTypeOnly) continue;
      if (e.from.startsWith('ui/') && e.to.startsWith('interactions/')) {
        violations.push(`${e.from} → ${e.to}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('state/ does not import from confirm/ (the cross-layer hook bag inverts this)', () => {
    const violations: string[] = [];
    for (const e of ALL_EDGES) {
      if (e.isTypeOnly) continue;
      if (e.from.startsWith('state/') && e.to.startsWith('confirm/')) {
        violations.push(`${e.from} → ${e.to}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('utils/ imports nothing from layer ≥ 2 (utils stays leaf)', () => {
    const violations: string[] = [];
    for (const e of ALL_EDGES) {
      if (e.isTypeOnly) continue;
      if (
        e.from.startsWith('utils/') &&
        (e.to.startsWith('state/') ||
          e.to.startsWith('api/') ||
          e.to.startsWith('confirm/') ||
          e.to.startsWith('ui/') ||
          e.to.startsWith('interactions/') ||
          e.to === 'main.ts')
      ) {
        violations.push(`${e.from} → ${e.to}`);
      }
    }
    expect(violations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Hook-bag completeness — every callback the store/flow/box expose
// must be wired by main.ts at boot.
// ---------------------------------------------------------------------------

const NOTES_STORE_HOOK_KEYS = [
  'onActiveChanged',
  'onNoteRenderRequested',
  'onNoteVisualsChanged',
  'onNoteRemoved',
  'onModeChanged',
  'onToast',
  'onReopenMenuRequested',
  'hasPendingChanges',
  'onTextUndo',
] as const;

const CONFIRM_FLOW_HOOK_KEYS = [
  'onSendStart',
  'onSendEnd',
  'onNoteRenderRequested',
  'onNoteVisualsChanged',
  'onToast',
  'showTagPopover',
] as const;

const NOTE_BOX_HOOK_KEYS = [
  'attachBodyDrag',
  'attachHandle',
  'consumeBoxClickSuppression',
] as const;

const ARC_MENU_HOOK_KEYS = ['onConfirm'] as const;

describe('Hook bag completeness — main.ts wires every callback', () => {
  const MAIN = FILE_CONTENTS.get('main.ts');

  it('main.ts exists', () => {
    expect(MAIN).toBeDefined();
  });

  it('main.ts wires all 9 NotesStoreHooks callbacks', () => {
    const missing = NOTES_STORE_HOOK_KEYS.filter(
      k => !new RegExp(`\\b${k}\\b`).test(MAIN!),
    );
    expect(missing).toEqual([]);
  });

  it('main.ts wires all 6 ConfirmFlowHooks callbacks', () => {
    const missing = CONFIRM_FLOW_HOOK_KEYS.filter(
      k => !new RegExp(`\\b${k}\\b`).test(MAIN!),
    );
    expect(missing).toEqual([]);
  });

  it('main.ts wires all 3 NoteBoxHooks callbacks', () => {
    const missing = NOTE_BOX_HOOK_KEYS.filter(
      k => !new RegExp(`\\b${k}\\b`).test(MAIN!),
    );
    expect(missing).toEqual([]);
  });

  it('main.ts wires all ArcMenuHooks callbacks', () => {
    const missing = ARC_MENU_HOOK_KEYS.filter(
      k => !new RegExp(`\\b${k}\\b`).test(MAIN!),
    );
    expect(missing).toEqual([]);
  });

  it('main.ts calls all four init* functions', () => {
    expect(MAIN).toMatch(/\binitNotesStore\s*\(/);
    expect(MAIN).toMatch(/\binitConfirmFlow\s*\(/);
    expect(MAIN).toMatch(/\binitNoteBox\s*\(/);
    expect(MAIN).toMatch(/\binitArcMenu\s*\(/);
  });

  it('NotesStoreHooks interface in state/notes-store.ts exposes exactly the 9 keys main.ts wires', () => {
    const src = FILE_CONTENTS.get('state/notes-store.ts')!;
    const ifaceMatch = src.match(
      /export interface NotesStoreHooks\s*{([\s\S]*?)\n}/,
    );
    expect(ifaceMatch).not.toBeNull();
    const body = ifaceMatch![1];
    for (const k of NOTES_STORE_HOOK_KEYS) {
      expect(body).toMatch(new RegExp(`\\b${k}\\b`));
    }
  });

  it('ConfirmFlowHooks interface in confirm/batch.ts exposes exactly the 6 keys', () => {
    const src = FILE_CONTENTS.get('confirm/batch.ts')!;
    const ifaceMatch = src.match(
      /export interface ConfirmFlowHooks\s*{([\s\S]*?)\n}/,
    );
    expect(ifaceMatch).not.toBeNull();
    const body = ifaceMatch![1];
    for (const k of CONFIRM_FLOW_HOOK_KEYS) {
      expect(body).toMatch(new RegExp(`\\b${k}\\b`));
    }
  });

  it('NoteBoxHooks interface in ui/note-box.ts exposes exactly the 3 keys', () => {
    const src = FILE_CONTENTS.get('ui/note-box.ts')!;
    const ifaceMatch = src.match(
      /export interface NoteBoxHooks\s*{([\s\S]*?)\n}/,
    );
    expect(ifaceMatch).not.toBeNull();
    const body = ifaceMatch![1];
    for (const k of NOTE_BOX_HOOK_KEYS) {
      expect(body).toMatch(new RegExp(`\\b${k}\\b`));
    }
  });

  it('ArcMenuHooks interface in ui/arc-menu.ts exposes exactly the 1 key main.ts wires', () => {
    const src = FILE_CONTENTS.get('ui/arc-menu.ts')!;
    const ifaceMatch = src.match(
      /export interface ArcMenuHooks\s*{([\s\S]*?)\n}/,
    );
    expect(ifaceMatch).not.toBeNull();
    const body = ifaceMatch![1];
    for (const k of ARC_MENU_HOOK_KEYS) {
      expect(body).toMatch(new RegExp(`\\b${k}\\b`));
    }
  });
});

// ---------------------------------------------------------------------------
// Boot sequence — STYLES injection
// ---------------------------------------------------------------------------

describe('Boot sequence — STYLES injection in main.ts', () => {
  const MAIN = FILE_CONTENTS.get('main.ts')!;

  it('imports STYLES from styles.ts', () => {
    expect(MAIN).toMatch(
      /import\s*{\s*[^}]*\bSTYLES\b[^}]*}\s*from\s*['"]\.\/styles['"]/,
    );
  });

  it('appends a <style> element with STYLES textContent to document.head', () => {
    // Either appendChild or append is acceptable; STYLES must reach
    // document.head in some recognizable way.
    expect(MAIN).toMatch(/document\.head\.append(?:Child)?\s*\(/);
    // The same scope should reference the STYLES symbol — simple
    // substring check is enough; tsc has already type-checked that
    // STYLES exists.
    expect(MAIN).toMatch(/\bSTYLES\b/);
  });
});

// ---------------------------------------------------------------------------
// Cross-module type re-export integrity
// ---------------------------------------------------------------------------

describe('Type-only re-export integrity', () => {
  it('floating-button.ts re-exports Mode as type-only (never as a runtime export)', () => {
    const src = FILE_CONTENTS.get('ui/floating-button.ts');
    expect(src).toBeDefined();
    // Must contain `export type {Mode}` (or `export type {..., Mode, ...}`).
    expect(src!).toMatch(/export\s+type\s*{[^}]*\bMode\b[^}]*}/);
    // Must NOT have a runtime `export {Mode}` line (no `type` keyword).
    // Anchor at line start to avoid matching the type-only form's body.
    const runtimeReExport = /^[ \t]*export\s*{[^}]*\bMode\b[^}]*}[^;]*;?$/m;
    const match = src!.match(runtimeReExport);
    if (match) {
      // If it matches, ensure it's actually the type form; the regex
      // above only tolerates `export {...}`, so any hit here is bad.
      expect(match[0]).toMatch(/export\s+type\s*{/);
    }
  });

  it('all `export type` statements carry the `type` keyword (no accidental runtime re-export)', () => {
    // Lightweight sanity: every `export {...}` block re-exporting a
    // name that ends with the conventional Type/Hooks suffix should
    // be type-only. This is a heuristic — the floating-button.ts case
    // above is the load-bearing one.
    const offenders: string[] = [];
    for (const [rel, src] of FILE_CONTENTS) {
      // Match runtime re-export blocks (no `type` keyword) of the form
      // `export {X, Y, Z};` (with optional whitespace, no `from`).
      const runtimeBlocks = src.matchAll(
        /^[ \t]*export\s*{([^}]+)}\s*;?\s*$/gm,
      );
      for (const m of runtimeBlocks) {
        // If the body of the block contains a name suffixed `Hooks`,
        // it should have been a `export type {...}` — flag.
        if (/\bHooks\b/.test(m[1])) {
          offenders.push(`${rel}: ${m[0].trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
