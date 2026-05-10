/**
 * Visual Viewport helpers — pure utilities that read from the
 * VisualViewport API and schedule RAF-batched callbacks.
 *
 * Layer 1 (utils): no imports from state/, api/, ui/, interactions/,
 * confirm/, or main.ts.
 */

/** Module-private rAF handle used by scheduleVisualViewportUpdate. */
let viewportRaf: number | null = null;

/** Module-private latest queued callback. */
let pendingFn: (() => void) | null = null;

/**
 * Returns 1 / visualViewport.scale, or 1 when the API is unavailable
 * (older browsers, or visualViewport hasn't been bound yet). Used by
 * counter-scaling helpers — UI elements that should keep a constant
 * on-screen device-px size as the user pinch-zooms.
 */
export function getInvScale(): number {
  return window.visualViewport ? 1 / window.visualViewport.scale : 1;
}

/**
 * Coalesces successive viewport-update requests into a single
 * requestAnimationFrame callback. Repeated calls within the same
 * frame queue the callback once; the next paint runs `fn` and resets
 * the queue. The legacy IIFE inlined this batcher inside `init()`;
 * extracting here so main.ts can dispatch viewport listeners through
 * a named helper.
 *
 * Semantics: if a frame is already queued, the latest `fn` replaces
 * the previously queued one (last-write-wins). In practice every
 * caller in main.ts passes the same viewport-orchestrator function,
 * so the distinction never matters.
 */
export function scheduleVisualViewportUpdate(fn: () => void): void {
  pendingFn = fn;
  if (!viewportRaf) {
    viewportRaf = requestAnimationFrame(() => {
      const f = pendingFn;
      viewportRaf = null;
      pendingFn = null;
      if (f) f();
    });
  }
}
