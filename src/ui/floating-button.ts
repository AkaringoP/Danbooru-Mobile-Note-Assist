/**
 * Floating action button — the script's entry-point UI element.
 *
 * Layer 3 (ui). Module-private state owns:
 *   - the cached button DOM ref (`floatBtnElement`)
 *   - persisted screen-edge margins (`userBtnMarginX/Y`, mirrored to
 *     localStorage on drag-end)
 *   - the gesture state machine (long-press timer, drag flag,
 *     last-tap timestamp for double-tap detection)
 *
 * Gestures (preserved from v3.1.1):
 *   - **Tap** → `toggleMenu()` (arc-menu).
 *   - **Double-tap** (within `DOUBLE_TAP_THRESHOLD_MS`) → close menu
 *     if open, then `toggleEditMode()` (Z11 path #1).
 *   - **Long-press** (`LONG_PRESS_DURATION` ms) → close menu, enter
 *     drag mode (`.dragging` class, vibrate, "Drag to reposition"
 *     toast). Drag-end persists margins to localStorage.
 *
 * Position is recomputed by `updateFloatingButtonPosition()` —
 * called inline during drag and by main.ts's viewport-update
 * orchestrator (composed from each ui module's per-element helper,
 * the Task 1.4 split-out of v3.1.1's monolithic
 * `updateVisualViewportPositions`).
 *
 * Auto-hide: the button gains `.dmna-hidden` when either signal is
 * active — a focused text input (so we don't cover the on-screen
 * keyboard) OR Danbooru's native translation mode / edit dialog
 * (Phase 1, v4.2). The two signals OR-combine through
 * `updateHiddenState`; native flag flips via `setNativeActiveHide`
 * from main.ts's native-conflict subscription.
 */

import type {Mode} from '../types';
import {
  BTN_SIZE,
  DEFAULT_BTN_MARGIN_X,
  DEFAULT_BTN_MARGIN_Y,
  DOUBLE_TAP_THRESHOLD_MS,
  LEGACY_STATE_KEY,
  LONG_PRESS_DURATION,
  POS_KEY,
  POS_X_KEY,
} from '../config';
import {isTextInputElement} from '../utils/dom';
import {safeGetItem, safeSetItem} from '../state/draft';
import {getMode, toggleEditMode} from '../state/notes-store';
import {closeMenu, toggleMenu} from './arc-menu';
import {showToast} from './toast';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ICON_IDLE = '📝';
const ICON_ACTIVE = '✏️';

// ---------------------------------------------------------------------------
// Module-private state
// ---------------------------------------------------------------------------

let floatBtnElement: HTMLElement | null = null;

// Position margins from the right/bottom screen edges. Persisted
// across reloads via localStorage; reseeded from defaults on first run.
// safeGetItem returns null on private-mode SecurityError as well as
// on absent keys — both collapse to the default via the NaN/Finite check.
const initialStoredX = parseInt(safeGetItem(POS_X_KEY) ?? '', 10);
let userBtnMarginX = Number.isFinite(initialStoredX)
  ? initialStoredX
  : DEFAULT_BTN_MARGIN_X;
const initialStoredY = parseInt(safeGetItem(POS_KEY) ?? '', 10);
let userBtnMarginY = Number.isFinite(initialStoredY)
  ? initialStoredY
  : DEFAULT_BTN_MARGIN_Y;

// One-shot cleanup of the v2.x ON/OFF flag — v3.0 has no global
// enabled state; mode is per-session and lives only in the menu state
// machine.
localStorage.removeItem(LEGACY_STATE_KEY);

// Auto-hide signal: `true` while Danbooru's native translation mode
// or edit dialog is active. Flipped via `setNativeActiveHide` from
// main.ts's native-conflict subscription (Phase 1, v4.2). OR-combined
// with focused-text-input check in `updateHiddenState`.
let nativeActiveHide = false;

// Gesture state machine (long-press / drag / double-tap).
let isDraggingBtn = false;
let isPressing = false;
let longPressTimer: ReturnType<typeof setTimeout> | null = null;
let dragStartX = 0;
let dragStartY = 0;
let dragStartMarginX = 0;
let dragStartMarginY = 0;
let lastBtnTapTime = 0;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the persisted button margins, in CSS pixels from the
 * right/bottom viewport edges. Read by `ui/arc-menu.ts` (Task 1.9)
 * to anchor the menu transform to the same point as the button.
 */
export function getButtonMargins(): {marginX: number; marginY: number} {
  return {marginX: userBtnMarginX, marginY: userBtnMarginY};
}

/**
 * Sets the button's icon. Used by:
 *   - main.ts's `onSendStart` subscriber → '⏳' (in-flight lock)
 *   - main.ts's `onSendEnd` / `onModeChanged` subscribers, via
 *     `setFloatingButtonIconForMode` for the mode-driven swap.
 */
export function setFloatingButtonIcon(icon: string): void {
  if (floatBtnElement) {
    floatBtnElement.textContent = icon;
  }
}

/**
 * Sets the icon based on the current high-level mode. Used after the
 * sending lock releases (`onSendEnd`) and on mode toggle
 * (`onModeChanged`). Exists so callers don't need to know the icon
 * literals — the UI module owns the visual mapping.
 */
export function setFloatingButtonIconForMode(): void {
  setFloatingButtonIcon(getMode() === 'active' ? ICON_ACTIVE : ICON_IDLE);
}

/**
 * Creates the floating button DOM (idempotent), wires its gesture
 * handlers, and binds the document-level focus/blur listeners that
 * auto-hide it while the on-screen keyboard is up. Caller is
 * `main.ts#init`.
 */
export function createFloatingButton(): void {
  if (document.getElementById('dmna-float-btn')) {
    return;
  }
  const btn = document.createElement('div');
  btn.id = 'dmna-float-btn';
  btn.textContent = ICON_IDLE;
  setupButtonInteractions(btn);
  document.body.appendChild(btn);
  floatBtnElement = btn;

  // Auto-hide listeners — focus/blur each route through
  // `updateHiddenState`, which OR-combines the focused-text-input
  // check with `nativeActiveHide`. blur waits 100 ms because
  // document.activeElement is transiently `body` between blur and
  // the next focus, and we want to read the stable post-transition
  // value.
  document.addEventListener('focus', () => updateHiddenState(), true);
  document.addEventListener(
    'blur',
    () => {
      setTimeout(updateHiddenState, 100);
    },
    true,
  );
}

/**
 * Applies the OR'd hidden state to the button. Called by:
 *   - focus/blur listeners (text-input auto-hide)
 *   - `setNativeActiveHide` (Danbooru native conflict subscription)
 *
 * Safe to call before `createFloatingButton` — guards on
 * `floatBtnElement`. The classList check is intentionally absent;
 * `add`/`remove` are idempotent so a redundant call is cheap.
 */
function updateHiddenState(): void {
  if (!floatBtnElement) {
    return;
  }
  const hide = isTextInputElement(document.activeElement) || nativeActiveHide;
  if (hide) {
    floatBtnElement.classList.add('dmna-hidden');
  } else {
    floatBtnElement.classList.remove('dmna-hidden');
  }
}

/**
 * Flips the native-active auto-hide flag and refreshes the button's
 * visibility. Called by main.ts's `onNativeStateChanged` subscriber
 * (Phase 1, v4.2). Idempotent under same-state calls — the OR with
 * the focused-text-input branch is recomputed every time.
 */
export function setNativeActiveHide(active: boolean): void {
  nativeActiveHide = active;
  updateHiddenState();
}

/**
 * Re-pins the button to the persisted margin distance from the
 * right/bottom viewport edges. Counter-scaled by `1 /
 * visualViewport.scale` so the on-screen footprint stays constant
 * under pinch zoom. Called by main.ts's viewport-update orchestrator
 * and inline during drag-move.
 */
export function updateFloatingButtonPosition(): void {
  if (!floatBtnElement) {
    return;
  }
  const vv = window.visualViewport;
  if (!vv) {
    const scrollX = window.pageXOffset;
    const scrollY = window.pageYOffset;
    const bx = scrollX + window.innerWidth - userBtnMarginX - BTN_SIZE;
    const by = scrollY + window.innerHeight - userBtnMarginY - BTN_SIZE;
    floatBtnElement.style.transform = `translate(${bx}px, ${by}px)`;
    return;
  }
  const invScale = 1 / vv.scale;
  const bx = vv.pageLeft + vv.width - (userBtnMarginX + BTN_SIZE) * invScale;
  const by = vv.pageTop + vv.height - (userBtnMarginY + BTN_SIZE) * invScale;
  floatBtnElement.style.transform = `translate(${bx}px, ${by}px) scale(${invScale})`;
}

// ---------------------------------------------------------------------------
// Gesture wiring (private)
// ---------------------------------------------------------------------------

/**
 * Wires touch + mouse events to the button. Single handler per phase
 * (start / move / end) shared between touch and mouse — `e.type`
 * narrows the union and feeds the gesture state machine.
 */
function setupButtonInteractions(btn: HTMLElement): void {
  const handleStart = (e: TouchEvent | MouseEvent): void => {
    if (e.type === 'touchstart') {
      e.preventDefault();
    }
    isDraggingBtn = false;
    isPressing = true;
    const isTouch = e.type.startsWith('touch');
    const clientX = isTouch
      ? (e as TouchEvent).touches[0].clientX
      : (e as MouseEvent).clientX;
    const clientY = isTouch
      ? (e as TouchEvent).touches[0].clientY
      : (e as MouseEvent).clientY;
    dragStartX = clientX;
    dragStartY = clientY;
    dragStartMarginX = userBtnMarginX;
    dragStartMarginY = userBtnMarginY;

    longPressTimer = setTimeout(() => {
      if (isPressing) {
        isDraggingBtn = true;
        // Close menu before entering reposition mode to avoid visual
        // conflict between `.expanded` and `.dragging` button states.
        // closeMenu is idempotent, so no `isMenuOpen` check needed.
        closeMenu();
        btn.classList.add('dragging');
        if (navigator.vibrate) {
          navigator.vibrate(50);
        }
        showToast('✥ Drag to reposition', 'info');
      }
    }, LONG_PRESS_DURATION);
  };

  const handleMove = (e: TouchEvent | MouseEvent): void => {
    if (e.type === 'touchmove') {
      e.preventDefault();
      e.stopPropagation();
    }
    if (!isPressing) {
      return;
    }

    const isTouch = e.type.startsWith('touch');
    const clientX = isTouch
      ? (e as TouchEvent).touches[0].clientX
      : (e as MouseEvent).clientX;
    const clientY = isTouch
      ? (e as TouchEvent).touches[0].clientY
      : (e as MouseEvent).clientY;
    if (isDraggingBtn) {
      const dx = clientX - dragStartX;
      const dy = clientY - dragStartY;
      const screenW = window.innerWidth;
      const screenH = window.innerHeight;
      let newMarginX = dragStartMarginX - dx;
      let newMarginY = dragStartMarginY - dy;
      // Clamps derived from arc menu geometry (r=70, 2 items at -100°,
      // -150°) so the entire menu stays on-screen at any button
      // position. With both items now on the left half (Phase 4 tag
      // popover anchored above Confirm), the leftward overhang grows.
      //   • Right limit (min X = 25): items don't extend right of
      //     button (cos < 0 for both), so the constraint is just
      //     "button visible." Use 25 for a small margin from edge.
      //   • Left limit (max X = screenW − 110): r·|cos(-150°)| +
      //     item_half + btn_half ≈ 61 + 20 + 20 = 101 → 110. Item 1
      //     (Edit, -150°) is the leftmost.
      //   • Top limit (max Y = screenH − 110): r·|sin(-100°)| +
      //     item_half + btn_half ≈ 69 + 20 + 20 = 109 → 110. Item 0
      //     (Confirm, -100°) is the highest.
      //   • Bottom limit (min Y = 20): only the button itself extends
      //     below button-center; all items sit at or above it.
      newMarginX = Math.max(25, Math.min(screenW - 110, newMarginX));
      newMarginY = Math.max(20, Math.min(screenH - 110, newMarginY));
      userBtnMarginX = newMarginX;
      userBtnMarginY = newMarginY;
      updateFloatingButtonPosition();
      return;
    }
    const dx = clientX - dragStartX;
    const dy = clientY - dragStartY;
    if (Math.hypot(dx, dy) > 10) {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
      isPressing = false;
    }
  };

  const handleEnd = (e: TouchEvent | MouseEvent): void => {
    if (e.type === 'touchend') {
      e.preventDefault();
    }
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    isPressing = false;
    if (isDraggingBtn) {
      isDraggingBtn = false;
      btn.classList.remove('dragging');
      safeSetItem(POS_X_KEY, String(userBtnMarginX));
      safeSetItem(POS_KEY, String(userBtnMarginY));
    } else {
      const isTouch = e.type.startsWith('touch');
      const endX = isTouch
        ? (e as TouchEvent).changedTouches[0].clientX
        : (e as MouseEvent).clientX;
      const endY = isTouch
        ? (e as TouchEvent).changedTouches[0].clientY
        : (e as MouseEvent).clientY;
      const dx = endX - dragStartX;
      const dy = endY - dragStartY;
      if (Math.hypot(dx, dy) < 10) {
        // Z11 path #1 (bidirectional): a fast second tap toggles the
        // active mode. From idle it turns the script on; from active
        // it routes to tryDeactivate (with a dirty confirm if needed).
        // Option A (immediate-and-cancel): the first tap already ran
        // toggleMenu, so the menu may be visibly opening; we close it
        // here and dispatch the mode change. The brief flicker is
        // accepted in exchange for zero latency on single-tap.
        const now = Date.now();
        const elapsed = now - lastBtnTapTime;
        if (elapsed < DOUBLE_TAP_THRESHOLD_MS) {
          closeMenu();
          lastBtnTapTime = 0;
          toggleEditMode();
        } else {
          lastBtnTapTime = now;
          toggleMenu();
        }
      }
    }
  };

  btn.addEventListener('touchstart', handleStart, {passive: false});
  btn.addEventListener('touchmove', handleMove, {passive: false});
  btn.addEventListener('touchend', handleEnd);
  btn.addEventListener('mousedown', handleStart);
  document.addEventListener('mousemove', e => {
    if (isPressing) {
      handleMove(e);
    }
  });
  btn.addEventListener('mouseup', handleEnd);
}

// Re-export Mode for convenience — main.ts's onModeChanged subscriber
// can `import {setFloatingButtonIconForMode} from './ui/floating-button'`
// without also pulling Mode separately. `export type` (not `export`)
// because Mode is a type alias with no runtime value — rollup needs
// the type-only marker to elide the re-export at bundle time.
export type {Mode};
