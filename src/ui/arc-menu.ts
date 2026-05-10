/**
 * Arc menu (v3.0 D2) — the floating button's expanded action surface.
 *
 * Layer 3 (ui). Module-private state owns:
 *   - the cached menu DOM ref (`menuElement`)
 *   - the open/closed flag (`isMenuOpen`)
 *   - the bound-listeners flag (`outsideClickListenerBound`) — guards
 *     against double-bind when openMenu fires while the listeners are
 *     already attached (defensive; the open/close flow keeps them in
 *     sync, but stale state from a malformed transition shouldn't
 *     leak event listeners).
 *
 * Items (Wave 3.5+): 2 items, both on the LEFT half of the floating
 * button (per user feedback — the right side is the user's thumb's
 * resting area in mobile portrait).
 *   - Confirm at -100° (just before 12)  → `runConfirmFlow`
 *   - Edit    at -150° (10 o'clock)       → `toggleEditMode`
 *
 * Dismiss paths:
 *   - Click any menu item — closeMenu fires before dispatching the
 *     action, so the menu visibly collapses while the dispatch starts.
 *   - Tap outside menu + button — capture-phase handler closes and
 *     stops the click so the outside element doesn't also receive it.
 *   - Esc — keyboard convenience for PC.
 *   - Re-tap of the floating button — the floating button's tap path
 *     calls toggleMenu, which closes when already open.
 *
 * Position is updated by `updateArcMenuPosition` (Task 1.4 viewport-
 * split pattern): the menu is anchored to the same screen-edge point
 * as the floating button, sharing margins via
 * `floating-button.getButtonMargins`. main.ts's viewport-update
 * orchestrator calls this on pinch-zoom / scroll / resize.
 *
 * `openMenu` calls `updateArcMenuPosition` inline so the first
 * appearance lands at the correct anchor even when no prior viewport
 * tick has run — same pattern as showToast.
 */

import {ARC_CONFIRM_THETA, ARC_RADIUS, BTN_SIZE} from '../config';
import {toggleEditMode} from '../state/notes-store';
import {runConfirmFlow} from '../confirm/batch';
import {getButtonMargins} from './floating-button';

// ---------------------------------------------------------------------------
// Module-private state
// ---------------------------------------------------------------------------

let menuElement: HTMLElement | null = null;
let isMenuOpen = false;
let outsideClickListenerBound = false;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Creates the arc menu DOM (idempotent). Items are rendered as
 * absolutely-positioned divs around the button center; CSS handles
 * the expand/collapse transition off the `.open` class.
 *
 * Caller is `main.ts#init`. Must run after `createFloatingButton` so
 * the `.expanded` class has a target on first menu open (the menu
 * itself doesn't depend on the button DOM being present at create-
 * time, but openMenu does).
 */
export function createArcMenu(): void {
  if (document.getElementById('dmna-menu')) {
    return;
  }

  const m = document.createElement('div');
  m.id = 'dmna-menu';

  // Order matches arc traversal from arc-start (closest to top) down
  // to arc-end (closest to floating button). Read "from button outward
  // / bottom-up": Edit → Confirm.
  //
  // Phase 3 (Z10): create + edit modes were merged into a single
  // `active` mode driven by the Edit item, and the explicit Discard-
  // all item was removed (its role is absorbed by the Z11 off-flow's
  // dirty confirm dialog). Down from 5 items to 3.
  // Wave 3.5: global Undo dropped — undo is now per-note via the
  // popover ↶ button. Down to 2 items.
  const items: Array<{
    action: 'confirm' | 'edit';
    icon: string;
    label: string;
  }> = [
    {action: 'confirm', icon: '✅', label: 'Confirm'},
    {action: 'edit', icon: '✏️', label: 'Edit'},
  ];

  // Arc geometry: radius 70 → button-edge to item-edge gap ≈ 30 px.
  // Confirm at -100° ("just before 12"), Edit at -150° ("10 o'clock");
  // adjacent centers ≈ 60 px apart. Closed state is translate(0, 0)
  // so items animate out from the button on open.
  const r = ARC_RADIUS;
  const itemSize = BTN_SIZE;
  const half = itemSize / 2;
  const center = BTN_SIZE / 2;
  const angleStart = ARC_CONFIRM_THETA; // -100°
  const stepAngle = (-50 * Math.PI) / 180; // -50° clockwise per step

  items.forEach((item, i) => {
    const theta = angleStart + stepAngle * i;
    const cx = center + r * Math.cos(theta);
    const cy = center + r * Math.sin(theta);
    const tx = cx - half;
    const ty = cy - half;

    const el = document.createElement('div');
    el.className = 'dmna-menu-item';
    el.dataset.action = item.action;
    el.setAttribute('aria-label', item.label);
    el.textContent = item.icon;
    el.style.setProperty('--tx', `${tx}px`);
    el.style.setProperty('--ty', `${ty}px`);
    el.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
      handleMenuAction(item.action);
    });
    m.appendChild(el);
  });

  document.body.appendChild(m);
  menuElement = m;
}

/**
 * Opens the arc menu. Idempotent — already-open is a no-op. Re-pins
 * the position before flipping the open class so the first
 * appearance lands at the correct anchor (no prior viewport tick
 * required).
 */
export function openMenu(): void {
  if (isMenuOpen || !menuElement) {
    return;
  }
  updateArcMenuPosition();
  isMenuOpen = true;
  menuElement.classList.add('open');
  const btn = document.getElementById('dmna-float-btn');
  if (btn) {
    btn.classList.add('expanded');
  }
  if (!outsideClickListenerBound) {
    document.addEventListener('click', outsideClickHandler, true);
    document.addEventListener('keydown', escHandler);
    outsideClickListenerBound = true;
  }
}

/**
 * Closes the arc menu. Idempotent — already-closed is a no-op
 * (callers like `floating-button` long-press and `confirm/batch.
 * onSendStart` invoke unconditionally, relying on this property).
 */
export function closeMenu(): void {
  if (!isMenuOpen) {
    return;
  }
  isMenuOpen = false;
  if (menuElement) {
    menuElement.classList.remove('open');
  }
  const btn = document.getElementById('dmna-float-btn');
  if (btn) {
    btn.classList.remove('expanded');
  }
  if (outsideClickListenerBound) {
    document.removeEventListener('click', outsideClickHandler, true);
    document.removeEventListener('keydown', escHandler);
    outsideClickListenerBound = false;
  }
}

/**
 * Toggles the arc menu. Wired to a single tap on the floating button
 * and to the (rare) `getIsMenuOpen` external read paths.
 */
export function toggleMenu(): void {
  if (isMenuOpen) {
    closeMenu();
  } else {
    openMenu();
  }
}

/**
 * Re-pins the menu to the same screen-edge anchor as the floating
 * button. Reads margins via `floating-button.getButtonMargins` so the
 * two stay in sync without a shared mutable state. Counter-scales by
 * `1 / visualViewport.scale` matching the button.
 *
 * Called by main.ts's viewport-update orchestrator and inline from
 * `openMenu` (first-appearance correctness).
 */
export function updateArcMenuPosition(): void {
  if (!menuElement) {
    return;
  }
  const {marginX, marginY} = getButtonMargins();
  const vv = window.visualViewport;
  if (!vv) {
    const scrollX = window.pageXOffset;
    const scrollY = window.pageYOffset;
    const bx = scrollX + window.innerWidth - marginX - BTN_SIZE;
    const by = scrollY + window.innerHeight - marginY - BTN_SIZE;
    menuElement.style.transform = `translate(${bx}px, ${by}px)`;
    return;
  }
  const invScale = 1 / vv.scale;
  const bx = vv.pageLeft + vv.width - (marginX + BTN_SIZE) * invScale;
  const by = vv.pageTop + vv.height - (marginY + BTN_SIZE) * invScale;
  menuElement.style.transform = `translate(${bx}px, ${by}px) scale(${invScale})`;
}

// ---------------------------------------------------------------------------
// Private dispatchers / handlers
// ---------------------------------------------------------------------------

/**
 * Routes a menu item's action to its handler. Internal — only the
 * createArcMenu click handler invokes it.
 */
function handleMenuAction(action: 'edit' | 'confirm'): void {
  switch (action) {
    case 'edit':
      // Z11 path #2: re-tap while active routes through tryDeactivate
      // (dirty-confirm prompt). Common entry-point shared with the
      // double-tap and Shift+N paths.
      toggleEditMode();
      break;
    case 'confirm':
      // Fire-and-forget — runConfirmFlow is async but the menu click
      // handler doesn't need to wait. Re-entrancy guarded inside.
      void runConfirmFlow();
      break;
  }
}

/**
 * Capture-phase click handler: closes the menu on taps outside the
 * menu and the floating button. Stops the click so the outside
 * element doesn't also receive it.
 */
function outsideClickHandler(e: MouseEvent): void {
  const target = e.target;
  if (
    target instanceof Element &&
    (target.closest('#dmna-menu') || target.closest('#dmna-float-btn'))
  ) {
    return;
  }
  e.stopPropagation();
  closeMenu();
}

/** Esc key handler: closes the menu (PC convenience). */
function escHandler(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault();
    closeMenu();
  }
}
