/**
 * Multi-note state store (Layer 2 — state).
 *
 * Owns the live note collection, the per-note action log, the high-
 * level mode flag, and the active-note pointer. Exposes:
 *   - data: `notes` Map (read), `actionLog` Map (read), `getMode()`,
 *           `getActiveNoteId()`, `getActiveModeGen()`
 *   - mutators: `setMode`, `setActiveNote`, `popover{Confirm, Cancel,
 *               Delete, Undo}`, `hardDeleteNote`, `addServerNote`,
 *               `createTempNote`, `discardAll`, `toggleEditMode`
 *   - lifecycle: `initNotesStore(hooks)`
 *   - helpers: `genNoteId`, `isDirty`, `pushAction`
 *
 * All UI side-effects (renderNoteBox, showPopover, showToast, …) are
 * delegated to `NotesStoreHooks` injected by `main.ts` at boot.
 * Cross-module reads from `confirm/classify` (`hasPendingChanges`)
 * also come via the hooks bag — preserves the Z5 layer rule
 * (state ← confirm, never state → confirm).
 */

import {
  ActionLogEntry,
  asServerNoteId,
  asTempNoteId,
  Mode,
  Note,
  NoteId,
  NoteState,
} from '../types';
import {fetchPostMeta} from '../api/posts';
import {fetchServerNotes, ServerNoteDescriptor} from '../api/notes';
import {DraftSnapshot, SerializedNote} from './draft';

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Side-effect hooks the store fires into. The store stays in Layer 2;
 * `main.ts` wires concrete implementations (from ui/, confirm/, …) at
 * boot via `initNotesStore`.
 *
 * Each callback documents who is expected to subscribe so the wire-up
 * in `main.ts` is mechanical.
 */
export interface NotesStoreHooks {
  /**
   * Active selection changed. Subscribers:
   *   - ui/note-box: `updateNoteVisuals(prev)` and `updateNoteVisuals(next)`
   *     (so the orange `is-active` class moves between boxes).
   *   - ui/popover: `next !== null ? showPopover(next) : hidePopover()`.
   */
  onActiveChanged: (prev: NoteId | null, next: NoteId | null) => void;

  /**
   * A single note's geometry/text changed → re-render its box.
   * Subscribers:
   *   - ui/note-box: `renderNoteBox(id)`
   *   - ui/popover: when `id === activeNoteId`, sync textarea from
   *     `notes.get(id).current.text`, then `updatePopoverForActiveNote()`
   *     (re-evaluates disabled state) and `updatePopoverPosition()`.
   */
  onNoteRenderRequested: (id: NoteId) => void;

  /**
   * A single note's metadata changed (e.g. `isDeleted` flag flipped)
   * without geometry change. Subscribers:
   *   - ui/note-box: `updateNoteVisuals(id)`
   */
  onNoteVisualsChanged: (id: NoteId) => void;

  /**
   * The note is being removed from the collection (DOM cleanup only —
   * the store handles the Map deletion itself). Subscribers:
   *   - ui/note-box: `removeNoteBoxDOM(id)`
   */
  onNoteRemoved: (id: NoteId) => void;

  /**
   * High-level mode transitioned. Subscribers:
   *   - ui/floating-button: swap the icon (📝 ↔ ✏️).
   *
   * The body classList toggles (`dmna-mode-active` and the defensive
   * `.note-container.hide-notes` reset) stay inline in `setMode`
   * since they're document-level globals, not bound to any one
   * UI module.
   */
  onModeChanged: (mode: Mode) => void;

  /** Status notification. Subscribers: ui/toast.showToast. */
  onToast: (
    message: string,
    level: 'info' | 'warning' | 'error',
    err?: unknown,
  ) => void;

  /**
   * Discard-confirm declined → reopen the arc menu so the user can
   * pick Confirm (or per-note ↶) instead. Subscribers:
   *   - ui/arc-menu: `openMenu()`.
   */
  onReopenMenuRequested: () => void;

  /**
   * Pull from `confirm/classify`. Resolves the `state → confirm`
   * reverse-dependency that v3.1.1's monolithic IIFE hid via shared
   * closure. Subscribers:
   *   - confirm/classify: `hasPendingChanges()`.
   */
  hasPendingChanges: () => boolean;
}

let hooks: NotesStoreHooks | null = null;

/** Wire side-effect hooks; `main.ts` calls this once at boot. */
export function initNotesStore(h: NotesStoreHooks): void {
  hooks = h;
}

// ---------------------------------------------------------------------------
// State (closure → module-level)
// ---------------------------------------------------------------------------

let mode: Mode = 'idle';
let activeNoteId: NoteId | null = null;
let activeModeGen = 0;

/** Live note collection. ui/, confirm/, debug/ read entries directly. */
export const notes: Map<NoteId, Note> = new Map();

/**
 * Per-note action history. Each entry array is a stack: latest action
 * is at the end, `pop()` is the undo target. Wave 3.5 dropped global
 * Undo so all reads are per-note now — `Map<noteId, stack[]>` makes
 * `popoverUndo` / `hardDeleteNote` O(1) instead of an array reverse-
 * scan that grew with total session activity (Phase 6 audit).
 */
export const actionLog: Map<NoteId, ActionLogEntry[]> = new Map();

export function getMode(): Mode {
  return mode;
}

export function getActiveNoteId(): NoteId | null {
  return activeNoteId;
}

/**
 * Generation counter, incremented on every active-mode entry/exit.
 * Async fetches inside `enterActiveMode` capture the value at start
 * and bail out on return if it no longer matches — prevents stale
 * server notes from being injected after the user toggled off.
 */
export function getActiveModeGen(): number {
  return activeModeGen;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Generates a `temp-` prefixed unique id for a new (unsynced) note. */
export function genNoteId(): NoteId {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return asTempNoteId('temp-' + crypto.randomUUID());
  }
  return asTempNoteId(
    'temp-' + Math.random().toString(36).slice(2) + Date.now().toString(36),
  );
}

/**
 * Whether the note's current state diverges from its initial snapshot.
 * Drives the green ('is-dirty') visual.
 *
 * Split rule (per user feedback):
 *   - New (temp) notes are ALWAYS dirty — green is the "this isn't on
 *     the server yet" distinguisher, regardless of whether `current`
 *     happens to match `initialState`. The earlier scenario "edit,
 *     ✔, revert → blue" applies only to server notes (where the
 *     server's saved state is the natural clean baseline).
 *   - Server notes follow the universal `current ≠ initialState`
 *     rule, so an edit that's been reverted shows as clean blue.
 *
 * (Phase 4 Confirm POSTs every `!isServerNote` note regardless of
 * dirty status, so this is purely a display affordance.)
 */
export function isDirty(note: Note): boolean {
  if (!note.isServerNote) {
    return true;
  }
  const a = note.current;
  const b = note.initialState;
  return (
    a.x !== b.x ||
    a.y !== b.y ||
    a.w !== b.w ||
    a.h !== b.h ||
    a.text !== b.text
  );
}

/**
 * Pushes an action onto this note's per-note undo stack. Lazily
 * creates the stack on first push.
 *
 * The cast on the constructed entry is Phase 1's compromise — Phase 2
 * will replace this with overloads so the discriminated union narrows
 * correctly per `type`.
 */
export function pushAction(
  noteId: NoteId,
  type: 'create' | 'edit' | 'delete' | 'transform',
  prevState: NoteState | null,
): void {
  let stack = actionLog.get(noteId);
  if (!stack) {
    stack = [];
    actionLog.set(noteId, stack);
  }
  stack.push({noteId, type, prevState} as ActionLogEntry);
}

// ---------------------------------------------------------------------------
// Mode + active-note transitions
// ---------------------------------------------------------------------------

/**
 * Empties the collection + actionLog + clears active selection. Used
 * by `setMode('idle')` and the discard-confirm path; also exposed
 * for the debug surface.
 */
export function discardAll(): void {
  for (const id of [...notes.keys()]) {
    hooks!.onNoteRemoved(id);
  }
  notes.clear();
  actionLog.clear();
  setActiveNote(null);
}

/**
 * Switches the high-level mode. Idempotent on same-mode input.
 *
 * Side effects:
 *   - 'active': fires `onModeChanged` (the floating-button hook
 *     swaps the icon to ✏️), toggles the `dmna-mode-active` body
 *     class (which surfaces e.g. crosshair cursor on the image),
 *     bumps `activeModeGen`, and fires the async server-note fetch
 *     (`enterActiveMode`).
 *   - 'idle': bumps `activeModeGen` (implicitly cancels any in-flight
 *     `enterActiveMode`), runs `discardAll`, fires `onModeChanged`
 *     (the floating-button hook restores 📝), removes the body class,
 *     and defensively resets `.note-container.hide-notes` (see below).
 */
export function setMode(newMode: Mode): void {
  if (mode === newMode) {
    return;
  }
  mode = newMode;
  hooks!.onModeChanged(newMode);
  if (newMode === 'active') {
    document.body.classList.add('dmna-mode-active');
    activeModeGen++;
    // Fire-and-forget — setMode returns synchronously while the
    // post-meta + server-notes fetches run, gated by `activeModeGen`
    // so a fast off-toggle invalidates them on resolve.
    void enterActiveMode(activeModeGen);
  } else {
    activeModeGen++;
    discardAll();
    document.body.classList.remove('dmna-mode-active');
    // Defensive: Danbooru's notes.js binds a mousedown on
    // `#image-container` that, on a short tap, toggles `.hide-notes`
    // on `.note-container` (its own native show/hide flag). Even with
    // our capture-phase blocker, a stray prior interaction can have
    // left that class on. Without this reset, native notes stay
    // hidden after we go idle and the user has to refresh.
    const noteContainer = document.querySelector('.note-container');
    if (noteContainer) {
      noteContainer.classList.remove('hide-notes');
    }
  }
}

/**
 * Async tail of the active-mode transition: fetches post metadata (for
 * the image-space ↔ display-space scale) and then the existing notes,
 * populating the collection. Both steps gate on `gen === activeModeGen`
 * so a fast off-toggle (or another active entry) cleanly cancels
 * whatever's still in flight without leaving stale boxes around.
 */
async function enterActiveMode(gen: number): Promise<void> {
  try {
    await fetchPostMeta();
  } catch (err) {
    if (gen !== activeModeGen) {
      return;
    }
    hooks!.onToast('⚠️ Failed to load image info', 'error', err);
    return;
  }
  if (gen !== activeModeGen || mode !== 'active') {
    return;
  }

  let serverNotes: ServerNoteDescriptor[];
  try {
    serverNotes = await fetchServerNotes();
  } catch (err) {
    if (gen !== activeModeGen) {
      return;
    }
    hooks!.onToast('⚠️ Failed to load existing notes', 'error', err);
    return;
  }
  if (gen !== activeModeGen || mode !== 'active') {
    return;
  }

  for (const sn of serverNotes) {
    addServerNote(sn);
  }
}

/**
 * Single entry point for the three Edit-mode toggle paths (arc-menu
 * ✏️, floating-button double-tap, Shift+N hotkey). Decides direction
 * from the current mode, dispatches to `tryDeactivate` / `setMode`,
 * and emits the matching toast — only after `tryDeactivate` actually
 * succeeded (the dirty-confirm prompt can decline and leave us in
 * active mode, in which case no toast).
 */
export function toggleEditMode(): void {
  // Read via the getter so TS doesn't narrow `mode` across the
  // `tryDeactivate()` call (which can mutate it transitively via
  // `setMode`).
  if (getMode() === 'active') {
    tryDeactivate();
    if (getMode() === 'idle') {
      hooks!.onToast('Edit mode off', 'info');
    }
  } else {
    setMode('active');
    hooks!.onToast('Edit mode on', 'info');
  }
}

/**
 * The Z11 off-attempt: if there are any pending changes (notes that
 * Confirm would actually send), prompts the user with
 * `window.confirm('Discard all changes and turn off?')`. Acceptance
 * runs `setMode('idle')`; cancellation re-opens the arc menu (via
 * hook) so the user can pick Confirm instead (or per-note ↶ from
 * the popover). With no pending changes, off happens immediately.
 *
 * The "pending" check (vs. a naive `isDirty` count) excludes fresh-
 * new uncommitted temps and soft-deleted ✔'d temps — both are silent-
 * drop at Confirm time, so deactivating in their presence is a server
 * no-op and shouldn't pop a dialog.
 *
 * `hasPendingChanges` lives in `confirm/classify`; the hook bag
 * surfaces it back into the store so the Z5 dependency direction
 * stays state ← confirm.
 */
function tryDeactivate(): void {
  if (hooks!.hasPendingChanges()) {
    // window.confirm is a deliberately simple Phase 3 choice (the v3.1
    // backlog has a custom-modal upgrade). It blocks the page until
    // dismissed, which is fine for a destructive action.
    const ok = window.confirm('Discard all changes and turn off?');
    if (ok) {
      setMode('idle');
    } else {
      hooks!.onReopenMenuRequested();
    }
  } else {
    setMode('idle');
  }
}

/**
 * Sets the active note (the one currently being worked on). Pass null
 * to clear. Fires `onActiveChanged` with both the previous and new id
 * so subscribers can update visuals on each side and show/hide the
 * popover in one step.
 */
export function setActiveNote(noteId: NoteId | null): void {
  if (activeNoteId === noteId) {
    return;
  }
  const prev = activeNoteId;
  activeNoteId = noteId;
  hooks!.onActiveChanged(prev, noteId);
}

// ---------------------------------------------------------------------------
// Per-note popover commands
// ---------------------------------------------------------------------------

/**
 * Per-note Undo (popover ↶). Pops the latest entry from this note's
 * stack and reverses it.
 *
 * - 'create'    — hard-delete (cancel creation). `hardDeleteNote` also
 *                 wipes this note's stack via `actionLog.delete`, which
 *                 is a no-op now that the create entry was popped + the
 *                 empty stack was cleaned above. Either way idempotent.
 * - 'edit'      — restore both `current` AND `confirmedState` to the
 *                 prior snapshot (✔ commits both, so undo reverts both).
 * - 'delete'    — flip `isDeleted=false`, restore `current` defensively,
 *                 then re-render: the popover may currently be open and
 *                 bound to this note (the user re-tapped the red-dashed
 *                 box, then pressed ↶), so the disabled/highlighted
 *                 state needs to flip back to "live."
 * - 'transform' — geometry-only revert (drag/resize gesture). Restoring
 *                 `text` or `confirmedState` would clobber unrelated
 *                 typing or a prior ✔ that happened before the drag.
 *
 * Replaces the global Undo arc-menu item that was a Phase 5 stub
 * (Wave 3.5 simplified v3.0 scope to per-note only).
 */
export function popoverUndo(noteId: NoteId): void {
  const stack = actionLog.get(noteId);
  if (!stack || stack.length === 0) {
    hooks!.onToast('Nothing to undo for this note', 'info');
    return;
  }
  const entry = stack.pop()!;
  if (stack.length === 0) {
    actionLog.delete(noteId);
  }
  if (entry.type === 'create') {
    hardDeleteNote(noteId);
    return;
  }
  const note = notes.get(noteId);
  if (!note) {
    return;
  }
  if (entry.type === 'edit') {
    note.current = {...entry.prevState};
    note.confirmedState = {...entry.prevState};
    hooks!.onNoteRenderRequested(noteId);
  } else if (entry.type === 'delete') {
    note.isDeleted = false;
    // Restore current to the state at delete-time. Defensive: with
    // drag/resize disabled on soft-deleted boxes (and the popover's
    // editing controls all disabled), current shouldn't have drifted
    // — but if a future change ever lets it, this keeps undo
    // deterministic.
    note.current = {...entry.prevState};
    hooks!.onNoteRenderRequested(noteId);
  } else if (entry.type === 'transform') {
    // Geometry-only revert: restoring text or confirmedState here
    // would also undo unrelated typing / clobber a prior ✔ that
    // happened before the drag.
    note.current.x = entry.prevState.x;
    note.current.y = entry.prevState.y;
    note.current.w = entry.prevState.w;
    note.current.h = entry.prevState.h;
    hooks!.onNoteRenderRequested(noteId);
  }
}

/**
 * ✔ — Commit the current geometry and text as the new checkpoint
 * (`confirmedState`). Push an 'edit' action to the log so the popover
 * ↶ button can roll back to the previous checkpoint.
 *
 * `setActiveNote(null)` already triggers `onActiveChanged(prev=noteId,
 * null)` whose subscriber updates visuals on `prev`. The trailing
 * `onNoteVisualsChanged` mirrors v3.1.1's redundant-but-defensive
 * second call (preserved for behavior parity in Phase 1; Phase 2 may
 * collapse).
 */
export function popoverConfirm(noteId: NoteId): void {
  const note = notes.get(noteId);
  if (!note) {
    return;
  }
  pushAction(noteId, 'edit', {...note.confirmedState});
  note.confirmedState = {...note.current};
  note.everConfirmed = true;
  setActiveNote(null);
  hooks!.onNoteVisualsChanged(noteId);
}

/**
 * ✖ — Two cases:
 *   1. Fresh-new note (`!isServerNote && !everConfirmed`): no prior
 *      checkpoint to revert to, so ✖ behaves like 🗑 next to it —
 *      hard-delete (cancel the creation entirely). Mirrors Esc and
 *      outside-tap dismissal.
 *   2. Confirmed temp / server note: revert `current` to the latest
 *      `confirmedState`. The note stays in the collection — ✖ here
 *      is "discard pending edits," not "delete the note." Use 🗑 to
 *      delete (which on a confirmed note soft-deletes for undo).
 */
export function popoverCancel(noteId: NoteId): void {
  const note = notes.get(noteId);
  if (!note) {
    return;
  }
  const isFreshNew = !note.isServerNote && !note.everConfirmed;
  if (isFreshNew) {
    hardDeleteNote(noteId);
    return;
  }
  note.current = {...note.confirmedState};
  hooks!.onNoteRenderRequested(noteId);
  setActiveNote(null);
}

/**
 * 🗑 — Routing depends on whether the note has a state worth keeping
 * around for undo:
 *   - Fresh-new (`!isServerNote && !everConfirmed`): no committed state
 *     exists — hard-delete (DOM + Map gone, actionLog stripped).
 *   - Confirmed temp OR server note: soft-delete (red dashed, kept in
 *     the collection so the popover ↶ can restore it). Pushes a
 *     'delete' action with the prior `current` as the prevState.
 *     Phase 4 Confirm-time will route soft-deleted server notes to
 *     DELETE and silently drop soft-deleted temps (never persisted).
 */
export function popoverDelete(noteId: NoteId): void {
  const note = notes.get(noteId);
  if (!note) {
    return;
  }
  const isFreshNew = !note.isServerNote && !note.everConfirmed;
  if (isFreshNew) {
    hardDeleteNote(noteId);
  } else {
    pushAction(noteId, 'delete', {...note.current});
    note.isDeleted = true;
    setActiveNote(null);
    hooks!.onNoteVisualsChanged(noteId);
  }
}

/**
 * Removes a note from existence: clears active selection (if it was
 * the active one), drops the DOM (via hook), deletes the Map entry,
 * and strips any actionLog entries that reference this id. Used by
 * `popoverDelete` (for fresh-new notes), `popoverCancel`, and
 * `dismissActivePopover` (cancel-creation path for fresh-new notes).
 *
 * The actionLog cleanup is best-effort: for fresh-new notes there's
 * only ever a single 'create' tail entry, so this just trims it. For
 * temp notes that were ✔'d before being 🗑'd, both 'create' and any
 * 'edit' entries are dropped — Wave 5 (undo) will revisit whether
 * that's the right call.
 */
export function hardDeleteNote(id: NoteId): void {
  if (activeNoteId === id) {
    setActiveNote(null);
  }
  hooks!.onNoteRemoved(id);
  notes.delete(id);
  actionLog.delete(id);
}

// ---------------------------------------------------------------------------
// Server / temp note creation
// ---------------------------------------------------------------------------

/**
 * Adds a server-loaded note to the collection (idempotent on duplicate
 * id) and renders its DOM. Called by `enterActiveMode` after
 * `fetchServerNotes` resolves.
 */
export function addServerNote(sn: ServerNoteDescriptor): void {
  const id = asServerNoteId(sn.id);
  if (notes.has(id)) {
    return;
  }
  const state: NoteState = {
    x: sn.x,
    y: sn.y,
    w: sn.width,
    h: sn.height,
    text: sn.body || '',
  };
  const note: Note = {
    current: {...state},
    initialState: {...state},
    confirmedState: {...state},
    isDeleted: false,
    isServerNote: true,
    everConfirmed: false,
    domElement: null,
  };
  notes.set(id, note);
  hooks!.onNoteRenderRequested(id);
}

/**
 * Creates a new temp note with the given image-space state and renders
 * it. Pushes a 'create' entry to actionLog so per-note Undo (popover ↶)
 * can roll it back. Returns the generated noteId.
 */
export function createTempNote(state: NoteState): NoteId {
  const id = genNoteId();
  const note: Note = {
    current: {...state},
    initialState: {...state},
    confirmedState: {...state},
    isDeleted: false,
    isServerNote: false,
    everConfirmed: false,
    domElement: null,
  };
  notes.set(id, note);
  pushAction(id, 'create', null);
  hooks!.onNoteRenderRequested(id);
  return id;
}

// ---------------------------------------------------------------------------
// Draft serialization (v4.1 — force-quit / OS-kill recovery)
//
// `state/draft.ts` owns localStorage I/O + schema; this module owns the
// snapshot ↔ live-collection conversion. Split is per PLAN D7 (Z5 layer
// preserved — draft.ts has no notes-store dependency, only types).
// ---------------------------------------------------------------------------

/**
 * Whether the current state is worth persisting as a draft. PLAN D4
 * gate: active mode with at least one note. An empty active mode
 * round-trips to the same state on next entry via setMode('active')
 * alone, so lifecycle handlers skip those.
 *
 * Server-only notes (no edits, no temps) also pass this gate — they
 * cost ~200 bytes per note to persist and the next `addServerNote`
 * during enterActiveMode would no-op duplicates anyway. Erring on
 * the side of "save more" trades a tiny localStorage footprint for
 * a cleaner mental model ("if I was editing, my draft will be there").
 */
export function hasContentToSave(): boolean {
  return mode === 'active' && notes.size > 0;
}

/**
 * Produces a JSON-serializable snapshot of the live collection +
 * mode + active selection. Spreads each top-level value so the
 * snapshot is decoupled from subsequent live mutations — caller
 * (typically a lifecycle handler in main.ts) doesn't have to worry
 * about saveDraft running concurrently with state writes.
 *
 * `Note.domElement` is stripped — DOM refs can't be JSON-serialized
 * meaningfully and the first post-restore render produces fresh
 * boxes anyway. Branded NoteIds appear as plain strings post-
 * serialize; `applyDraftSnapshot` re-brands at the load boundary.
 */
export function serializeForDraft(): DraftSnapshot {
  const serializedNotes: Array<[string, SerializedNote]> = [];
  for (const [id, note] of notes.entries()) {
    serializedNotes.push([
      id,
      {
        current: {...note.current},
        initialState: {...note.initialState},
        confirmedState: {...note.confirmedState},
        isDeleted: note.isDeleted,
        isServerNote: note.isServerNote,
        everConfirmed: note.everConfirmed,
      },
    ]);
  }
  const serializedActionLog: Array<[string, ActionLogEntry[]]> = [];
  for (const [id, stack] of actionLog.entries()) {
    serializedActionLog.push([id, stack.map(e => ({...e}))]);
  }
  return {
    mode,
    activeNoteId,
    notes: serializedNotes,
    actionLog: serializedActionLog,
  };
}

/**
 * Restores a draft snapshot into the live collection. The trust
 * boundary for rebranding JSON-stripped NoteIds — every `string` id
 * coming out of the snapshot is routed through `rebrandNoteId`
 * before it touches the typed Map keys.
 *
 * Caller (main.ts boot path, Task 3.2) decides when this is safe.
 * Typical flow: idle mode at boot → user taps "Restore" on the
 * prompt → applyDraftSnapshot. Less-typical (mode already active):
 * tear-down still runs cleanly, setMode is a no-op, populate +
 * render proceed.
 *
 * Order:
 *   1. Tear down current state (clear Map / log / active). Fires
 *      `onNoteRemoved` per existing box for DOM cleanup, then a
 *      single `onActiveChanged(prev, null)` if needed.
 *   2. Populate Map + actionLog from snapshot.
 *   3. setMode(snapshot.mode). For 'active' from 'idle' (the
 *      restore-at-boot case), this fires enterActiveMode's async
 *      fetch — fetchServerNotes → addServerNote, which no-ops for
 *      ids already in the Map. Net effect: draft wins for shared
 *      ids, server-side additions since the save get picked up.
 *   4. Render every restored box, then re-establish active
 *      selection if the snapshot had one (and the note survived).
 */
export function applyDraftSnapshot(snapshot: DraftSnapshot): void {
  // 1. Tear down
  for (const id of [...notes.keys()]) {
    hooks!.onNoteRemoved(id);
  }
  notes.clear();
  actionLog.clear();
  if (activeNoteId !== null) {
    const prev = activeNoteId;
    activeNoteId = null;
    hooks!.onActiveChanged(prev, null);
  }

  // 2. Populate. Re-brand at the load boundary.
  for (const [rawId, snote] of snapshot.notes) {
    const noteId = rebrandNoteId(rawId);
    const note: Note = {
      current: {...snote.current},
      initialState: {...snote.initialState},
      confirmedState: {...snote.confirmedState},
      isDeleted: snote.isDeleted,
      isServerNote: snote.isServerNote,
      everConfirmed: snote.everConfirmed,
      domElement: null,
    };
    notes.set(noteId, note);
  }
  for (const [rawId, entries] of snapshot.actionLog) {
    const noteId = rebrandNoteId(rawId);
    // Each entry carries its own noteId field too — rebrand both
    // the Map key and the inner reference for consistency.
    const rebranded = entries.map(e => ({...e, noteId}) as ActionLogEntry);
    actionLog.set(noteId, rebranded);
  }

  // 3. Mode transition. setMode handles body class / activeModeGen /
  //    onModeChanged hook itself.
  setMode(snapshot.mode);

  // 4. Render restored boxes + re-establish active selection.
  for (const id of notes.keys()) {
    hooks!.onNoteRenderRequested(id);
  }
  if (snapshot.activeNoteId !== null) {
    const activeId = rebrandNoteId(snapshot.activeNoteId);
    if (notes.has(activeId)) {
      setActiveNote(activeId);
    }
  }
}

/**
 * Rebrands a stringified NoteId at the draft-load boundary. The
 * `temp-` prefix is the runtime tell — `genNoteId` is the sole
 * producer of temp ids, and server ids are numeric (never start
 * with `temp-`). Plain `string` → branded `NoteId`.
 */
function rebrandNoteId(rawId: string): NoteId {
  return rawId.startsWith('temp-')
    ? asTempNoteId(rawId)
    : asServerNoteId(rawId);
}
