import {APP_VERSION} from './version';

/** Display name shown in the popover footer credit line. */
export const SCRIPT_NAME = 'MobileNoteAssist';

/**
 * Version string shown in the popover footer. Re-exports APP_VERSION
 * from version.ts so vite-plugin-monkey's @version header and the
 * runtime credit line are single-sourced.
 */
export const SCRIPT_VERSION = APP_VERSION;

/** Key for local storage button vertical position. */
export const POS_KEY = 'dmna_btn_margin_y';

/** Key for local storage button horizontal position. */
export const POS_X_KEY = 'dmna_btn_margin_x';

/** Legacy v2.x localStorage key, removed once on upgrade. */
export const LEGACY_STATE_KEY = 'dmna_enabled';

/** Duration in ms to trigger long-press actions. */
export const LONG_PRESS_DURATION = 1500;

/** Max gap between two taps to be treated as a double-tap. */
export const DOUBLE_TAP_THRESHOLD_MS = 300;

/** Floating button size in pixels. */
export const BTN_SIZE = 40;

/** Default horizontal margin (from right edge) for the floating button. */
export const DEFAULT_BTN_MARGIN_X = 20;

/** Default vertical margin (from bottom edge) for the floating button. */
export const DEFAULT_BTN_MARGIN_Y = 80;

/** Bottom margin for the toast message. */
export const TOAST_MARGIN_BOTTOM = 20;

/**
 * Default new-box size as a fraction of the shorter
 * rendered image dimension. v2.6 carry-over.
 */
export const INITIAL_SIZE_RATIO = 0.1;

/** Lower clamp for the default new-box display size (px). */
export const MIN_INITIAL_SIZE = 30;

/** Upper clamp for the default new-box display size (px). */
export const MAX_INITIAL_SIZE = 150;

/**
 * Minimum hypot distance (px) between mousedown and
 * mouseup on the image to count as a "drag-to-create" rather than a
 * click. Phase 3 Wave 3 (drag/resize) wires PC-only drag-to-create.
 */
export const DRAG_THRESHOLD_PX = 5;

/**
 * Absolute minimum box width/height in original-image
 * pixels. The display-space floor (`MIN_BOX_SIZE_DISPLAY`) is the
 * binding constraint at most zoom levels; this is just a safety
 * net so we never store an effectively-zero rect.
 */
export const MIN_BOX_SIZE_IMG = 8;

/**
 * Minimum box width/height in DEVICE pixels (on-
 * screen, constant across pinch-zoom levels). The clamp expression
 * `(MIN_BOX_SIZE_DISPLAY / vvScale) / scale` projects this through
 * vv.scale and image-display scale to image px — at vv.scale=1 the
 * CSS-px and device-px values coincide, at higher pinch the CSS-px
 * floor shrinks proportionally so the box's on-screen device-px
 * footprint stays at this constant.
 *
 * Geometric collision threshold: with handles counter-scaled per
 * `updateActiveHandleScales`, the top and bottom touch zones meet
 * at box.height_device = 16 device px (top handle's bottom edge
 * vs SE/SW handle's top edge, which sits 16/vv.scale CSS px above
 * the box's bottom = 16 device px regardless of pinch). 16 is just
 * the no-overlap floor; visually the box still looks like a sliver
 * between the 32-device-px handles. We set the floor to 48 = 1.5×
 * the handle's device-px size, so the box is the visually dominant
 * element of the active-box assembly rather than a thin strip
 * squeezed between the four handles. v3.1.2 used 24 (= collision
 * threshold + 8 px buffer + matched v3.0's CSS-px baseline at
 * vv.scale=1) but user feedback was that 24 device px on a high-
 * DPR phone (~1.5mm) was still dot-like.
 *
 * Pre-3.1.0: 24 CSS px (which became 24 device px at vv=1 but grew
 * to 72 device px at vv=3 — preventing small-feature marking even
 * with pinch zoom). v3.1 introduces device-px semantics: on-screen
 * size stays consistent, but IMAGE-space floor shrinks with pinch
 * (e.g., display:image scale 0.4 → at vv=3, image floor is
 * 48/3/0.4 = 40 image px instead of 120 at vv=1). This is the
 * small-feature-marking workflow: pinch in over a small glyph →
 * resize handles → pinch out, box stays small in image space.
 *
 * `MIN_BOX_SIZE_IMG` is the absolute safety floor in image space.
 */
export const MIN_BOX_SIZE_DISPLAY = 48;

/**
 * PC-only drag-to-create threshold in CSS pixels.
 * Distinguishes a deliberate drag-rect from an accidental tiny mouse
 * jitter. Decoupled from `MIN_BOX_SIZE_DISPLAY` (the runtime resize
 * floor) because the create gesture has no pinch-zoom context to
 * scale against — drag-to-create is desktop-only, where vv.scale=1
 * in practice and CSS px ≡ device px. Once a box exists the user
 * can pinch+resize down to MIN_BOX_SIZE_DISPLAY device px.
 */
export const MIN_DRAG_CREATE_SIZE_DISPLAY = 24;

/**
 * Popover CSS width in display pixels (counter-scaled
 * by visualViewport so the visual width stays constant under pinch).
 */
export const POPOVER_WIDTH = 260;

/**
 * Vertical gap (display px) between the active box's
 * bottom edge and the popover's top edge.
 */
export const POPOVER_OFFSET = 12;

/**
 * Min visual padding from the viewport edge when the
 * popover would otherwise clip.
 */
export const POPOVER_VIEWPORT_PADDING = 10;

/**
 * Half-width (px) of the popover's pointer arrow.
 * Used to clamp the arrow's horizontal slide so it never overhangs
 * the popover's rounded corners.
 */
export const POPOVER_ARROW_HALF = 8;

/**
 * Arc menu radius (px). Shared by createArcMenu and
 * the tag popover positioning so the popover anchors correctly to
 * whatever spot the Confirm item occupies.
 */
export const ARC_RADIUS = 70;

/**
 * Confirm item arc angle (radians, math convention).
 * Used for both menu rendering and tag-popover anchoring.
 */
export const ARC_CONFIRM_THETA = (-100 * Math.PI) / 180;

/** CSS-px width of the tag popover. */
export const TAG_POPOVER_WIDTH = 240;

/**
 * Visual gap (CSS px) between the tag popover's
 * arrow tip and the top edge of the Confirm button.
 */
export const TAG_POPOVER_GAP = 6;

/**
 * The four translation-status tags v3.0 surfaces
 * in the Confirm-time tag popover (Phase 4 D9). Order = display order.
 */
export const TAG_OPTIONS: string[] = [
  'translated',
  'translation_request',
  'check_translation',
  'partially_translated',
];

/**
 * Display labels for TAG_OPTIONS.
 * Capitalized + spaced for readability; the raw tag (the key) is
 * what gets sent to the server.
 */
export const TAG_LABELS: Record<string, string> = {
  translated: 'Translated',
  translation_request: 'Translation request',
  check_translation: 'Check translation',
  partially_translated: 'Partially translated',
};
