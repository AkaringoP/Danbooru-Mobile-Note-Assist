/**
 * Arc menu (v3.0 Phase 3 D2) — pre-Task-1.9 stub.
 *
 * Layer 3 (ui). Pre-Task-1.9 stub: only the function signatures
 * imported by `ui/floating-button.ts` are exposed; all bodies are
 * no-ops with a runtime warning. Task 1.9 will fill in the real DOM
 * + open/close/expand-fade + outside-tap/Esc dismiss + 4 menu items
 * (Edit / Confirm / etc., per v3.0 D2).
 *
 * Same stub-ahead-of-impl strategy as Task 1.5b's api/* stubs —
 * keeps notes-store typechecking standalone before Task 1.6 fills
 * in the real api modules.
 */

/** Opens the arc menu. **STUB**: no-op until Task 1.9. */
export function openMenu(): void {
  // Pending Task 1.9 — full implementation in src/ui/arc-menu.ts.
}

/**
 * Closes the arc menu. Idempotent — callers (e.g.,
 * `ui/floating-button` long-press → drag) invoke unconditionally.
 * **STUB**: no-op until Task 1.9.
 */
export function closeMenu(): void {
  // Pending Task 1.9.
}

/**
 * Toggles the arc menu open/closed. Wired to a single tap on the
 * floating button. **STUB**: no-op until Task 1.9.
 */
export function toggleMenu(): void {
  // Pending Task 1.9.
}
