/**
 * Draft persistence (Layer 2 — state).
 *
 * v4.1 PLAN Phase 1: force-quit / OS-kill recovery infrastructure.
 * Owns localStorage I/O + schema versioning + TTL gate. Pure I/O —
 * does NOT touch notes-store's collection. The serialization /
 * restoration of the actual notes Map + actionLog (Task 1.2) lives
 * in state/notes-store: `serializeForDraft` builds the snapshot
 * this module persists, and `applyDraftSnapshot` consumes a loaded
 * snapshot back into the live collection.
 *
 * Z5 layer: state (layer 2). Depends on types (layer 0) and
 * utils/coords (layer 1, for getPostId). No imports from ui/,
 * confirm/, interactions/, or notes-store (cross-state import would
 * be allowed but is unnecessary — orchestration lives in main.ts).
 *
 * Public surface:
 *   - DraftSnapshot          — wire shape exchanged with notes-store
 *   - SerializedNote         — Note minus domElement
 *   - MAX_DRAFT_AGE_MS       — TTL (24h, Q4 resolved 2026-05-11)
 *   - DRAFT_SCHEMA_VERSION   — bump on snapshot-shape change
 *   - saveDraft(snapshot)    — write under the current post's key
 *   - loadDraft()            — read + validate + TTL gate, or null
 *   - clearDraft()           — remove the current post's draft
 *   - safeSetItem/safeGetItem — shared localStorage guards (F5,
 *                               used by ui/floating-button in Task 1.4)
 *
 * Per-post key scheme: `dmna_draft_{postId}`. Non-post pages are
 * no-ops for all operations (getPostId returns null).
 */

import {ActionLogEntry, Mode, Note} from '../types';
import {getPostId} from '../utils/coords';

/**
 * Drafts older than this are silently discarded on load (key
 * removed). Q4 resolved 2026-05-11: 24h covers "yesterday's work"
 * recovery while keeping localStorage accumulation negligible
 * (~10KB/draft × per-post key → 100 abandoned drafts ≈ 1MB,
 * well under the 5MB origin limit).
 */
export const MAX_DRAFT_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Bumped on incompatible DraftSnapshot shape change. Mismatched
 * entries are silently discarded on load — there is no migration
 * path between versions (a half-finished draft from a much older
 * script version is not expected to remain relevant after upgrade).
 */
export const DRAFT_SCHEMA_VERSION = 1;

const DRAFT_KEY_PREFIX = 'dmna_draft_';

/**
 * Note minus `domElement` — DOM refs don't survive a page reload
 * (HTMLElement isn't JSON-serializable in any useful way) and the
 * first post-restore render produces them fresh anyway. Exported
 * so notes-store.serializeForDraft can construct values of this
 * shape without re-declaring the field list.
 */
export type SerializedNote = Omit<Note, 'domElement'>;

/**
 * In-memory shape exchanged between notes-store and this module.
 * The on-disk envelope (schemaVersion + savedAt) is added inside
 * saveDraft and stripped inside loadDraft so callers never see it.
 *
 * NoteId keys appear as plain `string` here because JSON drops the
 * brand. notes-store.applyDraftSnapshot re-asserts via
 * `asTempNoteId` / `asServerNoteId` at the boundary based on the
 * `temp-` prefix convention. The same applies to noteId fields
 * nested inside ActionLogEntry — typed as branded at the type
 * level, but plain strings at runtime post-JSON.
 */
export interface DraftSnapshot {
  mode: Mode;
  activeNoteId: string | null;
  /** notes Map entries, with Note.domElement stripped. */
  notes: Array<[string, SerializedNote]>;
  /** actionLog Map entries. */
  actionLog: Array<[string, ActionLogEntry[]]>;
}

interface PersistedDraftV1 extends DraftSnapshot {
  schemaVersion: typeof DRAFT_SCHEMA_VERSION;
  savedAt: number;
}

/**
 * Resolves the post-specific key, or null on non-post pages.
 * Non-post pages bail out of every operation in this module.
 */
function draftKey(): string | null {
  const id = getPostId();
  return id ? DRAFT_KEY_PREFIX + id : null;
}

/**
 * localStorage.setItem with QuotaExceededError / SecurityError
 * (private mode) / storage-disabled guard. Returns true on success,
 * false on failure (caller decides — draft saves give up silently;
 * the floating-button position save also accepts the loss, since
 * the next drag-end will retry).
 *
 * Exported because ui/floating-button routes its position saves
 * through here under Task 1.4 (F5 — concentrate the catch logic
 * so we don't repeat the try/catch in every call site).
 */
export function safeSetItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (err) {
    console.warn(
      `[MobileNoteAssist] localStorage.setItem("${key}") failed`,
      err,
    );
    return false;
  }
}

/**
 * localStorage.getItem with the same guard. Returns null both for
 * "key absent" and "storage unavailable" — neither case is
 * actionable for the caller, and conflating them keeps the boot
 * path simple.
 */
export function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch (err) {
    console.warn(
      `[MobileNoteAssist] localStorage.getItem("${key}") failed`,
      err,
    );
    return null;
  }
}

function safeRemoveItem(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch (err) {
    console.warn(
      `[MobileNoteAssist] localStorage.removeItem("${key}") failed`,
      err,
    );
  }
}

/**
 * Writes the draft for the current post id. No-op on non-post
 * pages or on setItem failure. Caller decides whether to call this
 * — the gate (`notes-store.hasContentToSave`) lives outside this
 * module so saveDraft itself doesn't filter empty snapshots; that
 * keeps the function honest about "what you pass in is what gets
 * persisted, modulo storage availability".
 */
export function saveDraft(snapshot: DraftSnapshot): void {
  const key = draftKey();
  if (!key) {
    return;
  }
  const payload: PersistedDraftV1 = {
    schemaVersion: DRAFT_SCHEMA_VERSION,
    savedAt: Date.now(),
    ...snapshot,
  };
  safeSetItem(key, JSON.stringify(payload));
}

/**
 * Reads + validates the draft for the current post id. Returns null
 * (silently removing the key as a side effect) for any of:
 *   - non-post page (no key to look up)
 *   - missing key / storage unavailable
 *   - JSON parse error
 *   - structural validation failure (`isPersistedDraftV1`)
 *   - schemaVersion mismatch (handled inside the guard)
 *   - savedAt older than MAX_DRAFT_AGE_MS
 *
 * Eager key removal on bad-shape costs nothing if the draft was
 * actually corrupted, and the alternative (leaving the bad entry)
 * means every subsequent entry to this post quietly fails the same
 * validation — worse UX with no upside. The risk of dropping a
 * legitimate future schemaVersion=2 entry on a downgraded v4.1
 * install is accepted (downgrade recovery is not in scope).
 */
export function loadDraft(): DraftSnapshot | null {
  const key = draftKey();
  if (!key) {
    return null;
  }
  const raw = safeGetItem(key);
  if (!raw) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    safeRemoveItem(key);
    return null;
  }
  if (!isPersistedDraftV1(parsed)) {
    safeRemoveItem(key);
    return null;
  }
  if (Date.now() - parsed.savedAt > MAX_DRAFT_AGE_MS) {
    safeRemoveItem(key);
    return null;
  }
  // Strip the envelope so callers see only the wire shape — the
  // schemaVersion / savedAt fields are this module's concern.
  return {
    mode: parsed.mode,
    activeNoteId: parsed.activeNoteId,
    notes: parsed.notes,
    actionLog: parsed.actionLog,
  };
}

/** Removes the draft for the current post id. Idempotent — no-op
 *  on non-post pages and on missing key. */
export function clearDraft(): void {
  const key = draftKey();
  if (key) {
    safeRemoveItem(key);
  }
}

/**
 * Structural type guard. Validates only the skeleton — per-entry
 * `NoteState` / `ActionLogEntry` shape is trusted once schemaVersion
 * matches, since the data came out of our own serialize at v=1.
 * A hand-edited localStorage entry that passes this skeleton check
 * but has garbage inner fields could still crash
 * applyDraftSnapshot, but hand-editing localStorage is outside the
 * v4.1 threat model.
 */
function isPersistedDraftV1(v: unknown): v is PersistedDraftV1 {
  if (typeof v !== 'object' || v === null) {
    return false;
  }
  const o = v as Record<string, unknown>;
  if (o.schemaVersion !== DRAFT_SCHEMA_VERSION) {
    return false;
  }
  if (typeof o.savedAt !== 'number') {
    return false;
  }
  if (o.mode !== 'idle' && o.mode !== 'active') {
    return false;
  }
  if (o.activeNoteId !== null && typeof o.activeNoteId !== 'string') {
    return false;
  }
  if (!Array.isArray(o.notes) || !Array.isArray(o.actionLog)) {
    return false;
  }
  return true;
}
