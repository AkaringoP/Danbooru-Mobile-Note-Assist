/**
 * Bootstrap orchestrator (entry point) — replaces v3.1.1's monolithic
 * IIFE. Three responsibilities:
 *
 *   1. Pre-build singleton DOM (floating button, arc menu, popover) so
 *      first interactions never race a layout pass.
 *   2. Inject the three Hook bags that resolve Z5 layer inversions
 *      (state→ui via NotesStoreHooks, confirm→ui via ConfirmFlowHooks,
 *      ui→interactions via NoteBoxHooks).
 *   3. Compose v3.1.1's monolithic `updateVisualViewportPositions` from
 *      each ui module's per-element helper (the Task 1.4 split's
 *      composition site), then bind the visualViewport / window
 *      listeners that drive it.
 *
 * Module-load runs `init()` synchronously — vite-plugin-monkey injects
 * us at document-end so `document.body` exists. Image-dependent paths
 * (note-box re-projection, image pointer handlers) self-defer via
 * `bindImageHandlers`'s setTimeout retry and the img.load listener.
 *
 * No `src/debug.ts` import yet — the v3.1.1 `__dmna3` debug surface
 * (Phase 1.1's `import.meta.env.DEV`-gated DEV affordance) is deferred
 * to a later Phase 1 task; this file leaves the slot open without
 * referencing a module that doesn't exist (which would break the build).
 */

import {APP_VERSION} from './version';
import {STYLES} from './styles';

import {clearDraft, saveDraft} from './state/draft';
import {
  getMode,
  hasContentToSave,
  initNotesStore,
  serializeForDraft,
  type NotesStoreHooks,
} from './state/notes-store';

import {hasPendingChanges} from './confirm/classify';
import {
  getIsSending,
  initConfirmFlow,
  type ConfirmFlowHooks,
} from './confirm/batch';

import {
  closeMenu,
  createArcMenu,
  openMenu,
  updateArcMenuPosition,
} from './ui/arc-menu';
import {
  createFloatingButton,
  setFloatingButtonIcon,
  setFloatingButtonIconForMode,
  updateFloatingButtonPosition,
} from './ui/floating-button';
import {
  initNoteBox,
  removeNoteBoxDOM,
  renderNoteBox,
  updateActiveHandleScales,
  updateAllNoteBoxPositions,
  updateNoteVisuals,
  type NoteBoxHooks,
} from './ui/note-box';
import {
  createPopover,
  hidePopover,
  refreshActivePopover,
  showPopover,
  updatePopoverPosition,
} from './ui/popover';
import {showTagPopover, updateTagPopoverPosition} from './ui/tag-popover';
import {showToast, updateToastPosition} from './ui/toast';

import {
  attachBodyDragListener,
  attachHandleListeners,
  consumeBoxClickSuppression,
} from './interactions/drag-resize';
import {bindImageHandlers} from './interactions/image-pointer';
import {bindGlobalHotkeys} from './interactions/keyboard';

import {scheduleVisualViewportUpdate} from './utils/visual-viewport';

// ---------------------------------------------------------------------------
// Hook bags (Z5 inversions wired here)
// ---------------------------------------------------------------------------

const notesStoreHooks: NotesStoreHooks = {
  onActiveChanged: (prev, next) => {
    // Toggle the orange `is-active` ring off the previous box and onto
    // the next one (whichever sides are non-null).
    if (prev !== null) {
      updateNoteVisuals(prev);
    }
    if (next !== null) {
      updateNoteVisuals(next);
      showPopover(next);
    } else {
      hidePopover();
    }
  },
  onNoteRenderRequested: id => {
    renderNoteBox(id);
    // refreshActivePopover internally checks `id === getActiveNoteId()`,
    // so calling it for a render of a non-active note is a safe no-op.
    refreshActivePopover();
  },
  onNoteVisualsChanged: id => updateNoteVisuals(id),
  onNoteRemoved: id => removeNoteBoxDOM(id),
  onModeChanged: mode => {
    setFloatingButtonIconForMode();
    // Entering idle is the user's explicit "I'm done with this
    // session" signal — discard the persisted draft so a future
    // page entry doesn't surface a misleading restore prompt
    // (PLAN D4, v4.1).
    if (mode === 'idle') {
      clearDraft();
    }
  },
  onToast: (msg, level, err) => showToast(msg, level, err),
  onReopenMenuRequested: () => openMenu(),
  hasPendingChanges: () => hasPendingChanges(),
};

const confirmFlowHooks: ConfirmFlowHooks = {
  onSendStart: () => {
    closeMenu();
    // Hourglass icon is the documented contract from
    // floating-button.ts's setFloatingButtonIcon doc — main.ts owns
    // the literal so the in-flight visual is configurable from the
    // boot site without touching the ui module.
    setFloatingButtonIcon('⏳');
  },
  onSendEnd: () => setFloatingButtonIconForMode(),
  onNoteRenderRequested: id => renderNoteBox(id),
  onNoteVisualsChanged: id => updateNoteVisuals(id),
  onToast: (msg, level, err) => showToast(msg, level, err),
  showTagPopover: () => showTagPopover(),
};

const noteBoxHooks: NoteBoxHooks = {
  attachBodyDrag: (el, noteId) => attachBodyDragListener(el, noteId),
  attachHandle: (el, corner, noteId) =>
    attachHandleListeners(el, corner, noteId),
  consumeBoxClickSuppression: () => consumeBoxClickSuppression(),
};

// ---------------------------------------------------------------------------
// Viewport update orchestrator (Task 1.4 composition site)
// ---------------------------------------------------------------------------

/**
 * Composition replacing v3.1.1's monolithic
 * `updateVisualViewportPositions`. Called for every visualViewport
 * resize / scroll (RAF-batched via `scheduleVisualViewportUpdate`) and
 * once synchronously at boot for the initial paint.
 *
 * Each helper is responsible for its own "is this element relevant?"
 * guard — toast/popover/tag-popover return early when their element
 * hasn't been built yet, popover/handle-scale also gate on activeNoteId.
 *
 * `updateAllNoteBoxPositions` is intentionally absent. Pinch-zoom does
 * NOT change document layout (note boxes are in page coords anchored
 * to the image's page-coord rect, which only moves under window resize
 * / orientation change). Those two events have their own dedicated
 * listeners in `init`.
 */
function runViewportUpdate(): void {
  updateFloatingButtonPosition();
  updateArcMenuPosition();
  updateToastPosition();
  updatePopoverPosition();
  updateActiveHandleScales();
  updateTagPopoverPosition();
}

function scheduleViewportUpdate(): void {
  scheduleVisualViewportUpdate(runViewportUpdate);
}

// ---------------------------------------------------------------------------
// Lifecycle save (Phase 2, v4.1 force-quit guard)
// ---------------------------------------------------------------------------

/**
 * Persists the current collection as a draft if there's something
 * worth saving and a send isn't in flight. The `isSending` gate is
 * critical: during runConfirmFlow's PUT/POST/DELETE sequence, a
 * partial-server-commit snapshot would mix local and server truth
 * in confusing ways. The Confirm flow itself clears the draft on
 * entry and on success (confirm/batch.ts), so a force-quit mid-send
 * falls back to fetchServerNotes on next page entry rather than to
 * the draft (PLAN D6).
 *
 * Called from three lifecycle handlers — beforeunload (PC),
 * pagehide (mobile-friendly), and visibilitychange→hidden (most
 * reliable on iOS/Android background-into). Idempotent under
 * double-fire: the same snapshot is just re-written under the same
 * key.
 */
function saveDraftIfNeeded(): void {
  if (getIsSending()) {
    return;
  }
  if (!hasContentToSave()) {
    return;
  }
  saveDraft(serializeForDraft());
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

let initialized = false;

function init(): void {
  if (initialized) {
    return;
  }
  initialized = true;

  // 1. Inject the stylesheet. Must run before `create*` so the first
  //    paint applies the rules (otherwise the button DOM appears
  //    invisible — width:0/height:0/no positioning). v3.1.1 did this
  //    inline at IIFE entry, before init().
  const styleElement = document.createElement('style');
  styleElement.textContent = STYLES;
  document.head.appendChild(styleElement);

  // 2. Pre-build singleton DOM. Each `create*` is idempotent (checks
  //    for an existing element first), so a stray re-call is safe.
  createFloatingButton();
  createArcMenu();
  createPopover();

  // 3. Wire the three Hook bags. Must happen before any state mutation
  //    or send-flow trigger — the `hooks!` non-null asserts inside
  //    notes-store / confirm-batch / note-box rely on this ordering.
  initNotesStore(notesStoreHooks);
  initConfirmFlow(confirmFlowHooks);
  initNoteBox(noteBoxHooks);

  // 4. Bind document-level interactions. `bindImageHandlers` self-
  //    retries on a 1 s timer if the post image isn't in the DOM yet.
  bindImageHandlers();
  bindGlobalHotkeys();

  // 5. Initial position pass — pins the floating button / menu to
  //    their persisted edges before the first frame paints.
  runViewportUpdate();

  // 6. visualViewport pinch-zoom / scroll. RAF-batched so multiple
  //    events in one frame coalesce into one DOM-write pass.
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', scheduleViewportUpdate);
    window.visualViewport.addEventListener('scroll', scheduleViewportUpdate);
    window.addEventListener('scroll', scheduleViewportUpdate);
  }

  // 7. Re-project note boxes whenever document layout could shift (the
  //    rendered image's page-coord rect changes). Pinch-zoom is NOT in
  //    this pair — see `runViewportUpdate` doc.
  window.addEventListener('resize', updateAllNoteBoxPositions);
  window.addEventListener('orientationchange', updateAllNoteBoxPositions);

  // 8. Reload / navigate-away guard + draft persist. Three handlers
  //    cover the union of "page is going away":
  //      - beforeunload: PC refresh / tab close. Also triggers the
  //        browser's generic "Leave site?" prompt when there are
  //        pending changes (browsers ignore custom messages, so
  //        empty-string assignment is the documented opt-in).
  //        `tryDeactivate`'s `window.confirm` covers in-script
  //        off-paths (Z11); this handler covers the out-of-band
  //        ones (refresh button, tab close, Cmd+R, etc).
  //      - pagehide: mobile-friendly counterpart. iOS Safari is
  //        unreliable about firing beforeunload before kill — pagehide
  //        is the documented mobile equivalent.
  //      - visibilitychange → hidden: most reliable mobile signal
  //        that the OS is about to suspend or kill us (Android home
  //        button, iOS app switcher, tab backgrounding).
  //    All three call saveDraftIfNeeded; only beforeunload gets the
  //    extra prompt branch (the prompt itself doesn't work on mobile).
  window.addEventListener('beforeunload', e => {
    saveDraftIfNeeded();
    if (getMode() === 'active' && hasPendingChanges()) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  window.addEventListener('pagehide', () => {
    saveDraftIfNeeded();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      saveDraftIfNeeded();
    }
  });
}

console.log(`[MobileNoteAssist v${APP_VERSION}] loaded`);
init();
