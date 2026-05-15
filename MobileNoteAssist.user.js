// ==UserScript==
// @name         Danbooru Mobile Note Assist
// @namespace    http://tampermonkey.net/
// @version      5.0.3
// @author       AkaringoP with Claude Code
// @description  Touch-friendly translation note editor for Danbooru — multi-note batched Confirm.
// @icon         https://danbooru.donmai.us/favicon.ico
// @homepageURL  https://github.com/AkaringoP/Danbooru-Mobile-Note-Assist
// @downloadURL  https://github.com/AkaringoP/Danbooru-Mobile-Note-Assist/raw/build/MobileNoteAssist.user.js
// @updateURL    https://github.com/AkaringoP/Danbooru-Mobile-Note-Assist/raw/build/MobileNoteAssist.user.js
// @match        *://danbooru.donmai.us/posts/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const APP_VERSION = "5.0.3";
  const SCRIPT_NAME = "MobileNoteAssist";
  const SCRIPT_VERSION = APP_VERSION;
  const POS_KEY = "dmna_btn_margin_y";
  const POS_X_KEY = "dmna_btn_margin_x";
  const LEGACY_STATE_KEY = "dmna_enabled";
  const LONG_PRESS_DURATION = 1e3;
  const DOUBLE_TAP_THRESHOLD_MS = 300;
  const BTN_SIZE = 40;
  const DEFAULT_BTN_MARGIN_X = 20;
  const DEFAULT_BTN_MARGIN_Y = 80;
  const TOAST_MARGIN_BOTTOM = 20;
  const INITIAL_SIZE_RATIO = 0.1;
  const MIN_INITIAL_SIZE = 30;
  const MAX_INITIAL_SIZE = 150;
  const DRAG_THRESHOLD_PX = 5;
  const MIN_BOX_SIZE_IMG = 8;
  const MIN_BOX_SIZE_DISPLAY = 48;
  const MIN_DRAG_CREATE_SIZE_DISPLAY = 24;
  const POPOVER_WIDTH = 343;
  const POPOVER_OFFSET = 12;
  const POPOVER_VIEWPORT_PADDING = 10;
  const POPOVER_ARROW_HALF = 8;
  const ARC_RADIUS = 70;
  const ARC_CONFIRM_THETA = -100 * Math.PI / 180;
  const TAG_POPOVER_WIDTH = 240;
  const TAG_POPOVER_GAP = 6;
  const TAG_OPTIONS = [
    "translated",
    "translation_request",
    "check_translation",
    "partially_translated"
  ];
  const TAG_LABELS = {
    translated: "Translated",
    translation_request: "Translation request",
    check_translation: "Check translation",
    partially_translated: "Partially translated"
  };
  const STYLES = `
    .dmna-hidden { display: none !important; }

    #dmna-float-btn {
      position: absolute; left: 0; top: 0;
      width: 40px; height: 40px; border-radius: 50%;
      background: rgba(0, 0, 0, 0.6); color: white; font-size: 21px;
      border: 2px solid rgba(255, 255, 255, 0.3);
      display: flex; align-items: center; justify-content: center;
      z-index: 11000; cursor: pointer; backdrop-filter: blur(2px);
      user-select: none; box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
      transform-origin: 0 0; will-change: transform; touch-action: none;
      transition: opacity 0.2s, visibility 0.2s,
          background 0.15s, border-color 0.15s;
    }
    #dmna-float-btn.expanded {
      background: rgba(0, 115, 255, 0.85);
      border-color: white;
      box-shadow: 0 0 12px rgba(0, 115, 255, 0.6);
    }
    #dmna-float-btn.dragging { background: #ff9800 !important; border-color: #ffe0b2 !important; transform: scale(1.2); }

    /* Arc Menu */
    #dmna-menu {
      position: absolute; left: 0; top: 0;
      width: 40px; height: 40px;
      z-index: 10999;
      transform-origin: 0 0; will-change: transform;
      pointer-events: none;
    }
    .dmna-menu-item {
      --tx: 0px;
      --ty: 0px;
      position: absolute;
      left: 0; top: 0;
      width: 40px; height: 40px;
      border-radius: 50%;
      background: rgba(31, 35, 43, 0.92);
      border: 1.5px solid rgba(255, 255, 255, 0.25);
      display: flex; align-items: center; justify-content: center;
      font-size: 18px; color: white;
      cursor: pointer; user-select: none;
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
      pointer-events: none;
      opacity: 0;
      /* Closed state: stacked on the floating button at small scale. */
      transform: translate(0, 0) scale(0.4);
      transition: transform 0.2s ease-out, opacity 0.18s ease-out,
          background 0.15s;
      touch-action: manipulation;
    }
    #dmna-menu.open .dmna-menu-item {
      opacity: 1;
      /* Open state: slide out to per-item arc position (--tx, --ty). */
      transform: translate(var(--tx), var(--ty)) scale(1);
      pointer-events: auto;
    }
    #dmna-menu.open .dmna-menu-item:active {
      transform: translate(var(--tx), var(--ty)) scale(0.88);
      background: rgba(0, 115, 255, 0.85);
    }

    /* Note Boxes (v3.0 Phase 2) — color priority is encoded by source order:
       active (orange) > deleted (red dashed) > dirty (green) > default (blue).
       Multiple state classes can coexist on a box; later rules override
       earlier ones. */
    .dmna-note-box {
      position: absolute;
      border: 1.2px solid #0073ff;
      background-color: rgba(0, 115, 255, 0.15);
      z-index: 9990;
      box-sizing: border-box;
      box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.4);
      pointer-events: none;
      transition: border-color 0.15s, background-color 0.15s,
          border-style 0s;
    }
    .dmna-note-box.is-dirty {
      border-color: #43a047;
      background-color: rgba(67, 160, 71, 0.15);
    }
    .dmna-note-box.is-deleted {
      border-style: dashed;
      border-color: #e53935;
      background-color: rgba(229, 57, 53, 0.10);
    }
    .dmna-note-box.is-active {
      border-style: solid;
      border-color: #ff9800;
      background-color: rgba(255, 152, 0, 0.15);
    }
    /* When a deleted box is also active (re-tapped to reveal the undo
       affordance), keep the red-dashed visual — masking it as orange
       would hide the very state the popover is asking the user to act on. */
    .dmna-note-box.is-deleted.is-active {
      border-style: dashed;
      border-color: #e53935;
      background-color: rgba(229, 57, 53, 0.18);
    }

    /* Active-mode cursor cue: tapping the image creates a new note. */
    body.dmna-mode-active #image { cursor: crosshair; }

    /* In active mode boxes accept their own click (to swap active selection)
       and stop propagation, so the underlying image handler doesn't also
       fire and spawn a duplicate note over the existing box. The
       touch-action: none is necessary for the body's pointerdown drag —
       without it the browser hijacks short drags as pan/scroll on mobile
       and our pointermove never fires. */
    body.dmna-mode-active .dmna-note-box {
      pointer-events: auto;
      cursor: pointer;
      touch-action: none;
    }

    /* Drag-to-create ghost rect (PC mouse only). Shown while the user
       is dragging on the image; converted to a real note on pointerup.
       Dashed accent border + faint fill to read as "in progress". */
    #dmna-drag-ghost {
      position: absolute;
      border: 2px dashed rgba(255, 200, 0, 0.85);
      background: rgba(255, 200, 0, 0.12);
      pointer-events: none;
      z-index: 10500;
      box-sizing: border-box;
    }

    /* Hide Danbooru's native note overlay while our active mode is on.
       The script renders its own boxes on top of the same notes (loaded
       via fetchServerNotes) and clicking through to native popups would
       just be visual noise. The native UI returns when the user toggles
       back to idle (the body class drops).

       NB: do NOT hide .note-container — it is the wrapper that also
       contains the post image element itself, so hiding it nukes the
       image. Only the per-note overlays should disappear. */
    body.dmna-mode-active .note-box,
    body.dmna-mode-active .note-body { display: none !important; }

    /* Resize/Move handles (v3.0 Phase 3 Wave 3) — only shown on the
       active box. NW/SE are resize handles, NE/SW are move-only handles.
       Each handle is a 32×32 invisible touch zone, counter-scaled per
       active frame against visualViewport.scale via the
       --dmna-handle-scale CSS custom property set on the active note
       element by updateActiveHandleScales in JS. At vv.scale=1 the
       handle fills its full 32 CSS px footprint; at higher pinch zoom
       the inverse-scale transform shrinks the CSS bounding box (and
       pointer-event hit region) while the visual/device-px size stays
       constant — so boxes can shrink below 32 CSS px without handle
       collision.

       Per-corner transform-origin anchors each handle to the box's
       actual corner so scale() collapses the handle TOWARD that corner.
       The anchor must be the point on the handle's bounding box that
       coincides with the box corner — which is NOT a CSS keyword corner
       for SE/SW because those handles are shifted up by half (their
       y-center is the box's bottom edge):

         NW  top:-32 left:-32   → bottom right (100% 100%) → box top-left
         NE  top:-32 right:-32  → bottom left  (0% 100%)   → box top-right
         SE  bottom:-16 right:-32 → left center  (0% 50%)  → box bottom-right
         SW  bottom:-16 left:-32  → right center (100% 50%) → box bottom-left

       NW/NE (top): fully outside the box at vv.scale=1, never collide
       with the popover (which is below).

       SE/SW (bottom): shifted UP by half — bottom:-16 instead of -32.
       Matches v2.6's pattern (a 15px shift on a 30px touch-outer): with
       POPOVER_OFFSET=12, the bottom 16px outside still has 12px visible
       above the popover top (4px hidden behind the popover, accepted).
       The other 16px sits INSIDE the box at vv.scale=1; at higher pinch
       zoom the inside extent shrinks proportionally with the handle. */
    .dmna-handle {
      display: none;
      position: absolute;
      width: 32px; height: 32px;
      box-sizing: border-box;
      background-color: transparent;
      border: 1px dashed transparent;
      pointer-events: auto;
      z-index: 1;
      touch-action: none;
      transform: scale(var(--dmna-handle-scale, 1));
      /* Fade-in/out for the debug-zone overlay (v2.6 carry-over pattern).
         Baseline is fully transparent so toggling the debug-zones body
         class only flips colors — transition then animates the swap.
         The 1px dashed border is reserved at baseline (transparent) so
         border-color can transition smoothly; switching border-style
         mid-animation would snap instead of fade. */
      transition: background-color 0.3s ease, border-color 0.3s ease;
    }
    .dmna-note-box.is-active .dmna-handle { display: block; }
    .dmna-handle-nw { top: -32px; left: -32px; cursor: nwse-resize; transform-origin: 100% 100%; }
    .dmna-handle-ne { top: -32px; right: -32px; cursor: move; transform-origin: 0% 100%; }
    .dmna-handle-se { bottom: -16px; right: -32px; cursor: nwse-resize; transform-origin: 0% 50%; }
    .dmna-handle-sw { bottom: -16px; left: -32px; cursor: move; transform-origin: 100% 50%; }

    /* SE corner triangle: visual resize affordance on active box. Color
       tracks the active border (orange). Fades out during drag/resize
       (.is-interacting set in onInteractionMove) so the user's view of
       the underlying art isn't obscured by chrome they're not aiming at —
       v2.6 carry-over pattern.
       Border-width is driven by --dmna-triangle-size (CSS px), set on
       the active note element by renderNoteBox in JS (proportional to
       box display: min(width,height) / 6, capped at 8 CSS px to match
       the v3.0 / v3.1.1 baseline visual). Pinch zoom is
       NOT counter-scaled here — the triangle is a fraction of the
       box's CSS-px size, so its on-screen device-px size scales with
       the box itself (smaller box → smaller triangle, bigger box →
       bigger triangle), constant ratio across pinch zoom levels. v3.1.1
       attempted to counter-scale the triangle by vv.scale (constant 8
       device px on screen); v3.1.4 swaps to box-proportional per user
       request — at MIN_BOX_SIZE_DISPLAY=48 device px the triangle is
       8 device px, matching the v3.1.1 default visual. */
    .dmna-note-box.is-active::after {
      content: '';
      position: absolute;
      bottom: 0; right: 0;
      width: 0; height: 0;
      border-style: solid;
      border-width: 0 0 var(--dmna-triangle-size, 8px) var(--dmna-triangle-size, 8px);
      border-color: transparent transparent #ff9800 transparent;
      pointer-events: none;
      opacity: 1;
      transition: opacity 0.2s ease;
    }
    .dmna-note-box.is-active.is-interacting::after {
      opacity: 0;
    }

    /* Touch-zone debug overlay: while the user holds the popover's 👁
       button, paint each (otherwise invisible) corner handle in red so
       they can see exactly where the touch zones extend past the visible
       border. Only renders for the active box's handles since those are
       the only ones that actually receive input.

       The icon pseudo-element is always present (so its color can fade
       smoothly via transition); it just stays transparent until the
       debug-zones class flips on. The .dmna-handle baseline above
       handles the background/border fade. */
    .dmna-note-box.is-active .dmna-handle::before {
      content: attr(data-icon);
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      color: transparent;
      text-shadow: none;
      pointer-events: none;
      transition: color 0.3s ease, text-shadow 0.3s ease;
    }
    body.dmna-show-debug-zones .dmna-note-box.is-active .dmna-handle {
      background-color: rgba(229, 57, 53, 0.30);
      border-color: rgba(255, 120, 120, 0.95);
    }
    body.dmna-show-debug-zones .dmna-note-box.is-active .dmna-handle::before {
      color: white;
      text-shadow: 0 0 3px black;
    }

    /* Popover (v3.0 Phase 3 Wave 3) — anchored under the active box,
       pinch-counter-scaled for mobile readability. */
    #dmna-popover {
      position: absolute;
      left: 0; top: 0;
      width: ${POPOVER_WIDTH}px;
      background: rgba(30, 30, 30, 0.96);
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 10px;
      padding: 10px;
      z-index: 10995;
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45);
      display: none;
      transform-origin: 0 0;
      will-change: transform, opacity;
      box-sizing: border-box;
      transition: opacity 0.15s;
    }
    #dmna-popover.show { display: block; }
    #dmna-popover-arrow {
      position: absolute;
      top: -8px;
      left: ${POPOVER_WIDTH / 2 - POPOVER_ARROW_HALF}px;
      width: 0; height: 0;
      border-style: solid;
      border-width: 0 8px 8px 8px;
      border-color: transparent transparent rgba(30, 30, 30, 0.96) transparent;
      pointer-events: none;
    }
    /* Input row layout: 2-column grid — textarea soaks up the slack,
       sideStack pinned to a fixed width so its buttons stay roughly
       square (height 36 from .dmna-popover-side-btn min-height).
       Earlier this was a calc proportional to the popover width;
       Phase 4 polish widened the popover (POPOVER_WIDTH 260 → 343)
       to match action-row cell widths to the style sub-popover, and
       a proportional side stack would have ballooned into a wide
       rectangle. 40 px is just a hair above the 36 px button square
       so the buttons read as compact icons rather than stretched
       chips. */
    /* Header row (Phase 3, v4.2): hosts the Preview/Edit mode toggle
       on the left. justify-content keeps room for a future close /
       help affordance on the right. */
    #dmna-popover-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    /* Mode toggle + "view help" wiki link styled as inline text-links
       rather than chips — mirrors Danbooru's own Editing-note header
       (Preview affordance on the left, "view help" anchor on the
       right). Rest is a muted gray; hover/focus surfaces the blue
       accent + underline, matching Danbooru's native toolbar (icons
       read as recessive at rest, light up on intent).

       Scoped under #dmna-popover-header so the help <a>'s color isn't
       recoloured by Danbooru's own 'a { color: ... }' cascade — a bare
       .dmna-popover-help-link rule (0,1,0) loses to selectors like
       '#wrapper a' (0,1,1). Explicit transparent background +
       'outline: none' on the interactive states silence the UA button
       focus-fill / focus-ring that otherwise paints a white pill
       behind "Preview" once it's been clicked. The hover underline +
       color flip stays as the accessible focus indicator.

       The help link is an <a>, not a button, so :disabled handling is
       mode-toggle-only. */
    #dmna-popover-header .dmna-popover-mode-toggle,
    #dmna-popover-header .dmna-popover-help-link {
      background: transparent;
      border: none;
      outline: none;
      color: rgba(255, 255, 255, 0.55);
      font-size: 13px;
      font-family: inherit;
      padding: 2px 0;
      cursor: pointer;
      user-select: none;
      touch-action: manipulation;
      text-decoration: none;
    }
    #dmna-popover-header .dmna-popover-mode-toggle:hover,
    #dmna-popover-header .dmna-popover-mode-toggle:focus,
    #dmna-popover-header .dmna-popover-mode-toggle:active,
    #dmna-popover-header .dmna-popover-help-link:hover,
    #dmna-popover-header .dmna-popover-help-link:focus,
    #dmna-popover-header .dmna-popover-help-link:active {
      background: transparent;
      outline: none;
      color: #6bb6ff;
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    #dmna-popover-header .dmna-popover-mode-toggle:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    #dmna-popover-input-row {
      display: grid;
      grid-template-columns: 1fr 40px;
      gap: 8px;
      align-items: stretch;
    }
    #dmna-popover-input,
    #dmna-popover-preview {
      grid-column: 1;
      grid-row: 1;
    }
    #dmna-popover-input {
      min-width: 0;
      padding: 8px 10px;
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.18);
      background: rgba(0, 0, 0, 0.4);
      color: white;
      /* Matches Danbooru's note-edit-dialog inner font scale
         (notes.scss: div.note-edit-dialog { font-size: 0.8em }).
         13px ≈ 0.8 × 16px body default, putting our textarea in the
         same visual range as the native dialog's textarea so users
         coming from the native flow don't perceive a size jump. */
      font-size: 13px;
      font-family: inherit;
      line-height: 1.4;
      box-sizing: border-box;
      outline: none;
      resize: none;
    }
    /* Preview-mode read-only sibling of the textarea (Phase 3, v4.2).
       Matches the textarea's padding/border/font so the swap looks
       like a mode change rather than a layout shift. overflow-wrap
       guards against unbroken markup pushing the popover wider. */
    /* Inside-preview styling that Danbooru applies via its own
       notes.scss but that we'd otherwise miss — the sanitizer keeps
       <tn> as a raw element (NoteSanitizer ALLOWED_ELEMENTS includes
       "tn") and Danbooru styles it via .tn class. We cover both
       the bare-element form and the explicit class form because the
       sanitizer accepts either when the user types markup by hand.
       Color resolves through --note-tn-color → --muted-text-color →
       --grey-4 (#9192a7). */
    #dmna-popover-preview tn,
    #dmna-popover-preview .tn {
      font-size: 0.8em;
      color: #9192a7;
    }
    #dmna-popover-preview {
      min-width: 0;
      /* Matches Danbooru's div.note-body (notes.scss line 13-15) so
         the preview reads as a faithful screenshot of how the note
         will render on the post page: same beige background, black
         text + border, 14 px / 1.25 line-height, 4 px padding. The
         Edit textarea keeps the dark popover theme — only Preview
         crosses over. min-height keeps the cell a roughly textarea-
         sized rectangle so toggling Edit ↔ Preview doesn't visibly
         shift the popover height under the user. */
      min-height: calc(1.25em * 3 + 8px);
      max-height: 240px;
      padding: 4px;
      border: 1px solid #000;
      border-radius: 0;
      background: #ffffee;
      color: #000;
      font-size: 14px;
      font-family: inherit;
      line-height: 1.25;
      box-sizing: border-box;
      overflow-wrap: anywhere;
      overflow-y: auto;
    }
    #dmna-popover-input:focus { border-color: #0073ff; }
    #dmna-popover-side-stack {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .dmna-popover-side-btn {
      flex: 1;
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.15);
      background: rgba(255, 255, 255, 0.06);
      color: white;
      font-size: 18px;
      cursor: pointer;
      user-select: none;
      touch-action: manipulation;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      /* min-height anchors each side-stack button to its 2-button-era
         size so adding the 3rd button (Aa, v4.2 Phase 4) grows the
         input row vertically instead of shrinking the existing
         buttons. The textarea sits in the same grid row with
         align-items: stretch, so it follows the side stack's height
         and the user gets a taller writing area for free. */
      min-height: 36px;
    }
    /* Generic press feedback for side-stack buttons (covers Aa; the
       eye and undo IDs below override with their own variants).
       Uses the popover's blue accent rather than a white tint so the
       white "Aa" / "↶" glyphs stay legible at peak press. */
    .dmna-popover-side-btn:active {
      background: rgba(74, 158, 255, 0.26);
    }
    /* Hover / press text-color shift for the white-glyph side buttons
       (Aa / ↶). 👁 is an emoji and ignores color; undo's highlighted
       state has its own hue rule (specificity wins below). */
    .dmna-popover-side-btn:hover,
    .dmna-popover-side-btn:active {
      color: #1a1a1a;
    }
    /* Eye uses pointer events for press-and-hold, so it overrides
       touch-action to disable scroll/zoom while held. */
    #dmna-popover-eye { touch-action: none; }
    #dmna-popover-eye:active,
    #dmna-popover-eye.is-pressed {
      background: rgba(74, 158, 255, 0.30);
    }
    #dmna-popover-undo:active {
      background: rgba(74, 158, 255, 0.30);
    }
    /* Disabled state for the popover's interactive controls — used when
       the active note is soft-deleted, leaving only ↶ (highlighted) live. */
    #dmna-popover-input:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .dmna-popover-side-btn:disabled,
    .dmna-popover-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .dmna-popover-side-btn:disabled:active,
    .dmna-popover-btn:disabled:active {
      background: rgba(255, 255, 255, 0.06);
    }
    /* Highlighted ↶ on a soft-deleted note — accents the only live
       action so the user knows their next move is "undo to restore." */
    #dmna-popover-undo.is-highlighted {
      border-color: #ff9800;
      background: rgba(255, 152, 0, 0.22);
      color: #ffb74d;
    }
    #dmna-popover-undo.is-highlighted:active {
      background: rgba(255, 152, 0, 0.36);
    }
    #dmna-popover-buttons {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr 1fr;
      gap: 8px;
      margin-top: 10px;
    }
    .dmna-popover-btn {
      padding: 10px 0;
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.32);
      background: rgba(255, 255, 255, 0.13);
      color: white;
      font-size: 20px;
      cursor: pointer;
      user-select: none;
      touch-action: manipulation;
    }
    .dmna-popover-btn:active {
      background: rgba(74, 158, 255, 0.36);
    }
    /* Light/white character color for ✔ / ✖ (text-glyph presentation
       forced via VS-15 in createPopover). 🗑 ignores this — it renders
       as a system emoji with its own colors. */
    .dmna-popover-btn[data-action="confirm"],
    .dmna-popover-btn[data-action="cancel"] { color: #f0f0f0; }

    /* Footer credit line — script identity at popover bottom. 10px is
       intentionally below typical body-text minimums; this is glance-
       only "what is this?" info, not something we expect users to read
       during their typing flow. Right-aligned + muted so it sits out
       of the way of the action buttons just above. */
    .dmna-popover-credit {
      font-size: 10px;
      color: rgba(255, 255, 255, 0.4);
      text-align: right;
      margin-top: 6px;
      line-height: 1;
      user-select: none;
      pointer-events: none;
    }
    .dmna-popover-btn[data-action="delete"] { color: #ff8b8b; }
    /* Hover / press text-color shift for the all-white glyphs (✔ / ✖)
       so they stay legible when the background lifts. 🗑 / 📜 are
       emoji and ignore the color property; delete's red and undo's
       highlighted orange keep their per-state hues. */
    .dmna-popover-btn[data-action="confirm"]:hover,
    .dmna-popover-btn[data-action="confirm"]:active,
    .dmna-popover-btn[data-action="cancel"]:hover,
    .dmna-popover-btn[data-action="cancel"]:active {
      color: #1a1a1a;
    }

    /* Phase 4 (D11): Confirm in-flight UI lock. Pointer events off on
       boxes + popover + floating button so any stray tap/drag is a
       no-op while requests are in flight. The ⏳ icon stays visible
       (pointer-events: none doesn't hide). */
    body.dmna-sending .dmna-note-box,
    body.dmna-sending #dmna-popover,
    body.dmna-sending #dmna-float-btn {
      pointer-events: none !important;
    }

    /* Hide the floating button while a note popover is open so an
       accidental tap on the button (which on mobile sits at the same
       bottom-right region as the popover's lower-right buttons) can't
       open the arc menu and let the user fire ✓ Confirm prematurely.
       Reuses the existing opacity/visibility transition on the button. */
    body.dmna-note-popover-open #dmna-float-btn {
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
    }

    /* Phase 4 (D9): tag popover — anchored to the LEFT of the floating
       button with a rightward-pointing arrow. The earlier "above Confirm"
       anchor overflowed the right edge of the viewport when the floating
       button sat near the screen edge (which it does by default), so the
       anchor was moved to the floating button itself. Counter-scaled by
       visualViewport like the active-note popover so the visual size
       stays constant across pinch zoom. */
    #dmna-tag-popover {
      position: absolute;
      left: 0; top: 0;
      width: ${TAG_POPOVER_WIDTH}px;
      background: rgba(30, 30, 30, 0.96);
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 10px;
      padding: 12px;
      z-index: 11500;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
      color: white;
      display: none;
      box-sizing: border-box;
      font-size: 14px;
      transform-origin: 0 0;
      will-change: transform;
    }
    #dmna-tag-popover.show { display: block; }

    /* Right-pointing arrow at popover bottom-right, aligned with the
       floating button's vertical center. Offset 12px from popover
       bottom = (BTN_SIZE/2) − arrow_half = 20 − 8: when the popover's
       bottom edge sits at the floating button's bottom edge, this puts
       the arrow's vertical midpoint at the button's vertical midpoint. */
    #dmna-tag-popover-arrow {
      position: absolute;
      right: -8px;
      bottom: 12px;
      width: 0; height: 0;
      border-style: solid;
      border-width: 8px 0 8px 8px;
      border-color: transparent transparent transparent rgba(30, 30, 30, 0.96);
      pointer-events: none;
    }

    .dmna-tag-popover-header {
      font-size: 14px;
      font-weight: bold;
      margin-bottom: 10px;
      color: #ffffff;
    }

    #dmna-tag-popover-toggles {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-bottom: 12px;
    }

    /* Tag toggle row — label on the left, iOS-style pill switch on the
       right. The whole row is a <button>, so clicks anywhere on it flip
       the state. Inner spans use pointer-events: none so the click
       target is always the button itself. */
    /* Tag row container — non-interactive div, NOT a button. v3.1.9 +
       v3.1.10 tried to fight native <button> rendering on Android via
       appearance: none + tap-highlight + outline; some browsers still
       leaked a bright-white background on tap/focus that hid the white
       label text. v3.1.11 sidesteps the whole class of issues by
       moving the click target onto the inner pill button only — the
       row itself never receives :focus / :active / tap-highlight. */
    .dmna-tag-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      width: 100%;
      padding: 8px 12px;
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.18);
      background: rgba(255, 255, 255, 0.06);
      color: #ffffff;
      font-size: 13px;
      user-select: none;
      box-sizing: border-box;
    }
    /* Forced-on state: rule 3 (check_translation or partially_translated
       implies translation_request) locks translation_request ON. The
       inner switch button itself carries the disabled attr; this class on the
       row drives the visual cue (reduced opacity). */
    .dmna-tag-row.is-disabled {
      opacity: 0.7;
    }
    .dmna-tag-label {
      flex: 1;
      text-align: left;
    }
    /* Pill switch button — the actual click target. Padding expands the
       hit area beyond the 36x20 visual pill (final hit zone ~52x36);
       not quite the 44x44 mobile guideline but sized for a popover
       used briefly during the Confirm flow, not a primary action. */
    .dmna-tag-switch-btn {
      appearance: none;
      -webkit-appearance: none;
      -webkit-tap-highlight-color: transparent;
      outline: none;
      border: none;
      background: transparent;
      padding: 8px;
      margin: -8px -8px -8px 0;
      cursor: pointer;
      touch-action: manipulation;
      display: inline-flex;
      align-items: center;
      flex-shrink: 0;
    }
    .dmna-tag-switch-btn:disabled {
      cursor: not-allowed;
    }
    /* Pill switch: 36x20 track + 16x16 thumb. ON = green track + thumb
       slides to the right; OFF = neutral track + thumb on the left. */
    .dmna-tag-switch {
      position: relative;
      width: 36px;
      height: 20px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.22);
      transition: background 0.14s;
      pointer-events: none;
    }
    .dmna-tag-row.is-on .dmna-tag-switch {
      background: rgba(46, 204, 113, 0.85);
    }
    .dmna-tag-switch-thumb {
      position: absolute;
      top: 2px;
      left: 2px;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: #ffffff;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
      transition: transform 0.14s;
      pointer-events: none;
    }
    .dmna-tag-row.is-on .dmna-tag-switch-thumb {
      transform: translateX(16px);
    }

    #dmna-tag-popover-buttons {
      display: flex;
      gap: 6px;
      justify-content: flex-end;
    }
    .dmna-tag-popover-btn {
      padding: 6px 14px;
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.32);
      background: rgba(255, 255, 255, 0.13);
      color: white;
      font-size: 13px;
      cursor: pointer;
      user-select: none;
      touch-action: manipulation;
    }
    .dmna-tag-popover-btn:active {
      background: rgba(74, 158, 255, 0.36);
    }
    /* Primary action (Submit) — Danbooru convention: primary first. */
    .dmna-tag-popover-btn[data-action="submit"] {
      border-color: rgba(0, 115, 255, 0.6);
      background: rgba(0, 115, 255, 0.45);
    }
    .dmna-tag-popover-btn[data-action="submit"]:active {
      background: rgba(0, 115, 255, 0.65);
    }

    /* Phase 4 (D12): error modal — same backdrop/card pattern as tag
       modal. Shows failure summary + Retry / Cancel. */
    #dmna-error-modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 11500;
      display: none;
    }
    #dmna-error-modal-backdrop.show { display: block; }

    #dmna-error-modal {
      position: fixed;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      width: 360px;
      max-width: calc(100vw - 32px);
      max-height: calc(100vh - 64px);
      background: rgba(30, 30, 30, 0.96);
      border: 1px solid rgba(229, 57, 53, 0.4);
      border-radius: 10px;
      padding: 16px;
      z-index: 11501;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
      color: white;
      display: none;
      box-sizing: border-box;
      font-size: 13px;
      overflow-y: auto;
    }
    #dmna-error-modal.show { display: block; }

    .dmna-error-modal-header {
      font-size: 15px;
      font-weight: bold;
      color: #ff8b8b;
      margin-bottom: 8px;
    }
    .dmna-error-modal-summary {
      color: #cccccc;
      margin-bottom: 12px;
    }
    .dmna-error-modal-list {
      max-height: 240px;
      overflow-y: auto;
      margin-bottom: 16px;
      padding: 8px;
      background: rgba(0, 0, 0, 0.3);
      border-radius: 6px;
      font-family: ui-monospace, Menlo, Consolas, monospace;
      font-size: 12px;
      line-height: 1.5;
    }
    .dmna-error-modal-list-item {
      color: #f0c0c0;
      word-break: break-word;
    }
    .dmna-error-modal-list-item + .dmna-error-modal-list-item {
      margin-top: 4px;
    }
    #dmna-error-modal-buttons {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }
    .dmna-error-modal-btn {
      padding: 8px 18px;
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.32);
      background: rgba(255, 255, 255, 0.13);
      color: white;
      font-size: 14px;
      cursor: pointer;
      user-select: none;
      touch-action: manipulation;
    }
    .dmna-error-modal-btn:active {
      background: rgba(74, 158, 255, 0.36);
    }
    .dmna-error-modal-btn[data-action="retry"] {
      border-color: rgba(0, 115, 255, 0.6);
      background: rgba(0, 115, 255, 0.45);
    }
    .dmna-error-modal-btn[data-action="retry"]:active {
      background: rgba(0, 115, 255, 0.65);
    }

    #dmna-toast {
      visibility: hidden; min-width: 160px;
      background-color: rgba(30, 30, 30, 0.95); color: #fff;
      text-align: center; border-radius: 50px; padding: 12px 24px;
      position: absolute; left: 0; top: 0; z-index: 11000;
      font-size: 14px; opacity: 0;
      transition: opacity 0.4s ease-in-out, visibility 0.4s ease-in-out;
      pointer-events: none; transform-origin: 0 0;
      will-change: transform, opacity;
      border-left: 4px solid transparent;
    }
    #dmna-toast.show { visibility: visible; opacity: 1; }
    /* Type accents — color-coded left border so users can scan severity
       even without reading the text. Background tints stay subtle so the
       toast reads as the same UI element across types. */
    #dmna-toast.dmna-toast-success {
      border-left-color: rgba(46, 204, 113, 0.9);
    }
    #dmna-toast.dmna-toast-warning {
      border-left-color: rgba(240, 180, 50, 0.9);
    }
    #dmna-toast.dmna-toast-error {
      border-left-color: rgba(220, 70, 70, 0.95);
      background-color: rgba(60, 28, 28, 0.96);
    }
    /* Two-button variant (v4.1, restore-draft prompt). The has-actions
       modifier reshapes the alarm-pill into a left-aligned card so the
       button row reads naturally beneath the message, and re-enables
       pointer events so the buttons are tappable. */
    .dmna-toast-actions { display: none; }
    #dmna-toast.has-actions {
      border-radius: 12px; text-align: left; padding: 14px 16px;
      pointer-events: auto; min-width: 220px; max-width: 340px;
    }
    #dmna-toast.has-actions .dmna-toast-msg {
      margin-bottom: 12px; text-align: left;
      white-space: pre-line;
    }
    #dmna-toast.has-actions .dmna-toast-actions {
      display: flex; gap: 8px; justify-content: flex-end;
    }
    .dmna-toast-btn {
      background: rgba(255, 255, 255, 0.12); color: #fff;
      border: 1px solid rgba(255, 255, 255, 0.18);
      padding: 6px 14px; border-radius: 6px;
      font-size: 13px; font-family: inherit;
      cursor: pointer; touch-action: manipulation;
    }
    .dmna-toast-btn:hover, .dmna-toast-btn:focus {
      background: rgba(255, 255, 255, 0.2); outline: none;
    }
    .dmna-toast-btn.is-primary {
      background: rgba(46, 204, 113, 0.55);
      border-color: rgba(46, 204, 113, 0.7);
    }
    .dmna-toast-btn.is-primary:hover, .dmna-toast-btn.is-primary:focus {
      background: rgba(46, 204, 113, 0.75);
    }

    /* Style popover (Phase 4, v4.2) — sibling of the note popover,
       attached to its right (or left when overflowing). Same dark
       chrome / shadow / scale-from-origin as the note popover so the
       two look like one widget. Width is hard-coded in the TS module
       (STYLE_POPOVER_WIDTH = 224) to match the 7-column grid;
       changing one without the other will skew the right-overflow
       flip math. */
    /* Style popover (v4.2 Phase 4). Outer is always laid out so the
       attach math (transform: translate(x,y) scale(invScale)) can run
       even while the popover is invisible — we fade via opacity, not
       display. The inner wrapper handles the slide motion separately
       so it composes cleanly with the outer's pinch-zoom counter-
       scale (transforms don't fight).
       Width matches POPOVER_WIDTH in config (260) so flip-left math
       is a clean width subtraction; STYLE_POPOVER_WIDTH in
       style-popover.ts imports POPOVER_WIDTH for the same reason. */
    #dmna-style-popover {
      position: absolute;
      left: 0; top: 0;
      width: 260px;
      background: rgba(30, 30, 30, 0.96);
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 10px;
      padding: 10px;
      z-index: 10996;
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45);
      transform-origin: 0 0;
      will-change: transform, opacity;
      box-sizing: border-box;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.18s ease;
    }
    #dmna-style-popover.show {
      opacity: 1;
      pointer-events: auto;
    }
    /* Inner wrapper carries the slide motion. translateX in the
       closed state nudges it toward the note popover's right edge
       (the default attach side); the .show flip releases it to its
       computed position. */
    #dmna-style-popover-inner {
      display: flex;
      flex-direction: column;
      gap: 8px;
      transform: translateX(-12px);
      transition: transform 0.18s ease;
    }
    #dmna-style-popover.show #dmna-style-popover-inner {
      transform: translateX(0);
    }
    /* Narrow-viewport mode: popover stacks under the note popover with
       a slide-up animation instead of the desktop side-attach. Source
       order matters — these rules come AFTER the desktop .show rule so
       the .is-mobile.show pair (same specificity, written later) wins
       the cascade and swaps translateX for translateY. No max-height /
       overflow here: the popover keeps its natural size and the page
       scrolls to reveal any portion that lands under the keyboard, the
       same way the user already scrolls to reveal off-screen note
       boxes. */
    #dmna-style-popover.is-mobile #dmna-style-popover-inner {
      transform: translateY(20px);
    }
    #dmna-style-popover.is-mobile.show #dmna-style-popover-inner {
      transform: translateY(0);
    }
    .dmna-style-row {
      display: grid;
      gap: 8px;
    }
    .dmna-style-row-3 { grid-template-columns: 1fr 1fr 1fr; }
    .dmna-style-row-2 { grid-template-columns: 1fr 1fr; }
    .dmna-style-row-1 { grid-template-columns: 1fr; }
    /* Buttons share the action-button dimensions (padding/font/border/
       radius) from .dmna-popover-btn so the visual weight matches
       what's already on the note popover's bottom row. */
    .dmna-style-btn {
      padding: 10px 0;
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.32);
      background: rgba(255, 255, 255, 0.13);
      color: white;
      font-size: 20px;
      font-family: inherit;
      cursor: pointer;
      user-select: none;
      touch-action: manipulation;
      min-width: 0;
      box-sizing: border-box;
    }
    /* Hover / press feedback uses the popover's blue accent rather
       than a white tint. White text glyphs (B/I/U/S/sub/sup) wash out
       against a bright white-tint bg; the blue family keeps contrast
       intact AND ties the press feedback to the same accent color used
       for .is-active highlights, .dmna-popover-help-link, and the link
       button. */
    .dmna-style-btn:hover { background: rgba(74, 158, 255, 0.18); }
    .dmna-style-btn:active { background: rgba(74, 158, 255, 0.40); }
    .dmna-style-btn:disabled,
    .dmna-style-select:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .dmna-style-btn:disabled:hover {
      background: rgba(255, 255, 255, 0.13);
    }
    /* Active highlight = "this tag currently wraps the selection."
       Tap to unwrap that layer. The blue echoes the Preview-link
       color so the popover's active affordances read as one family. */
    .dmna-style-btn.is-active {
      background: rgba(74, 158, 255, 0.28);
      border-color: rgba(74, 158, 255, 0.70);
      box-shadow: inset 0 0 0 1px rgba(74, 158, 255, 0.45);
    }
    .dmna-style-btn.is-active:hover {
      background: rgba(74, 158, 255, 0.36);
    }
    /* Hover / press lift the background bright enough that the all-
       white glyph buttons (B / I / U / S / sub / sup) can wash out.
       Swap their text to dark on those transient states so the
       affordance stays legible across hover (PC) and press (mobile +
       PC). Colored siblings (tn / code / a / ruby) keep their hue
       because these rules don't touch the color property on them. */
    .dmna-style-btn-bold:hover,
    .dmna-style-btn-bold:active,
    .dmna-style-btn-italic:hover,
    .dmna-style-btn-italic:active,
    .dmna-style-btn-underline:hover,
    .dmna-style-btn-underline:active,
    .dmna-style-btn-strike:hover,
    .dmna-style-btn-strike:active,
    .dmna-style-btn-sub:hover,
    .dmna-style-btn-sub:active,
    .dmna-style-btn-sup:hover,
    .dmna-style-btn-sup:active,
    .dmna-style-color-text:hover,
    .dmna-style-color-text:active,
    .dmna-style-color-stroke:hover,
    .dmna-style-color-stroke:active,
    .dmna-style-color-bg:hover,
    .dmna-style-color-bg:active {
      color: #1a1a1a;
    }
    /* Per-tag preview rendering — each button styles its glyph the
       way the tag would render so the user knows the effect before
       tapping. */
    .dmna-style-btn-bold { font-weight: 700; }
    .dmna-style-btn-italic { font-style: italic; }
    .dmna-style-btn-underline { text-decoration: underline; }
    .dmna-style-btn-strike { text-decoration: line-through; }
    /* tn / link / code / ruby — semantic-tag labels share a single
       16px size so the four colored chips read as one weight class,
       with hue / underline / monospace doing the per-tag distinction. */
    .dmna-style-btn-tn {
      font-size: 16px;
      color: rgba(150, 200, 255, 0.95);
    }
    .dmna-style-btn-link {
      font-size: 16px;
      color: #4a9eff;
      text-decoration: underline;
    }
    /* sub / sup — Phase 5 v4.2 additions. The label text itself
       ("sub" / "sup") is shrunk and shifted via asymmetric padding so
       it lands low (sub) or high (sup) inside the same-row S button
       as the centered reference, mirroring the tag's actual rendering. */
    .dmna-style-btn-sub,
    .dmna-style-btn-sup {
      font-size: 11px;
    }
    .dmna-style-btn-sub { padding: 16px 0 4px; }
    .dmna-style-btn-sup { padding: 4px 0 16px; }
    .dmna-style-btn-code {
      font-family: ui-monospace, Menlo, Consolas, monospace;
      font-size: 16px;
      color: rgba(255, 200, 130, 0.95);
    }
    .dmna-style-btn-ruby {
      font-size: 16px;
      color: rgba(180, 220, 180, 0.95);
    }
    /* Color row: button is a label + swatch pair in inline-flex.
       Padding tightens vertically vs tag buttons since two pieces of
       content share the same row. */
    .dmna-style-color-text,
    .dmna-style-color-stroke,
    .dmna-style-color-bg {
      display: inline-flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 10px;
      font-size: 13px;
      gap: 8px;
    }
    .dmna-style-color-label {
      font-weight: 500;
    }
    .dmna-style-color-swatch {
      display: inline-block;
      width: 22px;
      height: 22px;
      border-radius: 4px;
      border: 1px solid rgba(255, 255, 255, 0.32);
      box-sizing: border-box;
    }
    /* Transparent swatch = the page's background showing through, with
       a diagonal slash so the user can tell at a glance it's not just
       black. */
    .dmna-style-color-transparent {
      background:
        linear-gradient(
          to top right,
          transparent 47%,
          rgba(255, 80, 80, 0.85) 47%,
          rgba(255, 80, 80, 0.85) 53%,
          transparent 53%
        );
    }
    /* Native select kept simple — Phase 4 ships dropdown shells with
       placeholder option only; option list lands in follow-up cycle
       per user. */
    .dmna-style-select {
      width: 100%;
      padding: 10px 10px;
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.32);
      background: rgba(255, 255, 255, 0.13);
      color: white;
      font-size: 14px;
      font-family: inherit;
      cursor: pointer;
      box-sizing: border-box;
      appearance: none;
      -webkit-appearance: none;
      background-image:
        linear-gradient(45deg, transparent 50%, rgba(255,255,255,0.7) 50%),
        linear-gradient(135deg, rgba(255,255,255,0.7) 50%, transparent 50%);
      background-position:
        calc(100% - 16px) 50%,
        calc(100% - 10px) 50%;
      background-size: 6px 6px;
      background-repeat: no-repeat;
    }
    .dmna-style-select:hover { background-color: rgba(255, 255, 255, 0.20); }
    /* Labeled select row — small inline label on the left ("Size" /
       "Font") plus the dropdown on the right. The dropdown now
       reflects the currently applied value rather than a placeholder,
       so the label is the only persistent cue for what the menu is. */
    .dmna-style-labeled-select-row {
      display: grid;
      grid-template-columns: 56px 1fr;
      gap: 8px;
      align-items: center;
    }
    .dmna-style-select-label {
      font-size: 13px;
      color: rgba(255, 255, 255, 0.7);
      font-weight: 500;
      user-select: none;
    }

    /* Link sub-popover (Phase 5, v4.2) — inline modal mounted as a
       child of #dmna-popover so it inherits the popover's transform/
       scale automatically. Triggered from the style popover's <a>
       button to collect a URL for wrapping the textarea selection.
       The dim overlay covers the note popover area only, not the
       full viewport — the user's focus stays on the note they were
       editing rather than the whole page being dimmed for a single
       link prompt. */
    #dmna-link-overlay {
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.4);
      border-radius: 9px;
      z-index: 1;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.08s ease;
    }
    #dmna-link-overlay.show {
      opacity: 1;
      pointer-events: auto;
    }
    #dmna-link-modal {
      position: absolute;
      left: 16px;
      right: 16px;
      top: 50%;
      transform: translateY(-50%);
      display: grid;
      grid-template-columns: 1fr 40px;
      gap: 8px;
      align-items: stretch;
      background: rgba(40, 40, 40, 0.98);
      border: 1px solid rgba(255, 255, 255, 0.28);
      border-radius: 8px;
      padding: 10px;
      z-index: 2;
      box-sizing: border-box;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.08s ease;
    }
    #dmna-link-modal.show {
      opacity: 1;
      pointer-events: auto;
    }
    #dmna-link-modal-input {
      padding: 8px 10px;
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.18);
      background: rgba(0, 0, 0, 0.4);
      color: white;
      font-size: 13px;
      font-family: inherit;
      line-height: 1.4;
      box-sizing: border-box;
      outline: none;
      width: 100%;
      min-width: 0;
    }
    #dmna-link-modal-input:focus {
      border-color: #0073ff;
    }
    #dmna-link-modal-confirm {
      padding: 10px 0;
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.32);
      background: rgba(255, 255, 255, 0.13);
      color: #f0f0f0;
      font-size: 20px;
      font-family: inherit;
      cursor: pointer;
      user-select: none;
      touch-action: manipulation;
      min-height: 36px;
      box-sizing: border-box;
    }
    #dmna-link-modal-confirm:active {
      background: rgba(74, 158, 255, 0.36);
    }

    /* Color picker (Phase 5, v4.2) — inline modal mounted as a child
       of #dmna-popover, mirroring the link-popover pattern. 14-swatch
       grid (7×2) + HEX input row. z-index above the link modal so the
       two layer cleanly when both are wired (in practice only one is
       shown at a time — the user picks color OR enters a link, not
       both in the same gesture). */
    #dmna-color-overlay {
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.4);
      border-radius: 9px;
      z-index: 3;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.08s ease;
    }
    #dmna-color-overlay.show {
      opacity: 1;
      pointer-events: auto;
    }
    #dmna-color-modal {
      position: absolute;
      left: 16px;
      right: 16px;
      top: 50%;
      transform: translateY(-50%);
      background: rgba(40, 40, 40, 0.98);
      border: 1px solid rgba(255, 255, 255, 0.28);
      border-radius: 8px;
      padding: 12px;
      z-index: 4;
      box-sizing: border-box;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.08s ease;
    }
    #dmna-color-modal.show {
      opacity: 1;
      pointer-events: auto;
    }
    #dmna-color-swatches {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 6px;
      margin-bottom: 10px;
    }
    .dmna-color-swatch {
      width: 100%;
      aspect-ratio: 1;
      border-radius: 4px;
      border: 1px solid rgba(255, 255, 255, 0.32);
      cursor: pointer;
      padding: 0;
      box-sizing: border-box;
      transition: transform 0.08s ease;
    }
    .dmna-color-swatch:hover {
      transform: scale(1.08);
      border-color: rgba(255, 255, 255, 0.6);
    }
    .dmna-color-swatch:active {
      transform: scale(0.92);
    }
    /* Transparent swatch — diagonal red slash on a transparent ground,
       matching the style popover's color-row button. Used as the
       "remove this property" swatch in the BG and Stroke pickers. */
    .dmna-color-swatch-transparent {
      background:
        linear-gradient(
          to top right,
          transparent 47%,
          rgba(255, 80, 80, 0.85) 47%,
          rgba(255, 80, 80, 0.85) 53%,
          transparent 53%
        ) !important;
    }
    #dmna-color-input-row {
      display: grid;
      grid-template-columns: 1fr 40px;
      gap: 8px;
      align-items: stretch;
    }
    #dmna-color-hex {
      padding: 8px 10px;
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.18);
      background: rgba(0, 0, 0, 0.4);
      color: white;
      font-family: ui-monospace, Menlo, Consolas, monospace;
      font-size: 13px;
      line-height: 1.4;
      box-sizing: border-box;
      outline: none;
      width: 100%;
      min-width: 0;
    }
    #dmna-color-hex:focus {
      border-color: #0073ff;
    }
    #dmna-color-hex.is-invalid {
      border-color: #e53935;
    }
    #dmna-color-apply {
      padding: 10px 0;
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.32);
      background: rgba(255, 255, 255, 0.13);
      color: #f0f0f0;
      font-size: 20px;
      font-family: inherit;
      cursor: pointer;
      user-select: none;
      touch-action: manipulation;
      min-height: 36px;
      box-sizing: border-box;
    }
    #dmna-color-apply:active {
      background: rgba(74, 158, 255, 0.36);
    }
    #dmna-color-apply:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    /* Stroke picker (Phase 5, v4.2 D19) — same overlay/modal pattern
       as color-picker plus a collapsible Advanced section for thickness
       and per-side controls. Swatch tiles reuse .dmna-color-swatch so
       the two pickers share visual rhythm. */
    #dmna-stroke-overlay {
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.4);
      border-radius: 9px;
      z-index: 3;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.08s ease;
    }
    #dmna-stroke-overlay.show {
      opacity: 1;
      pointer-events: auto;
    }
    #dmna-stroke-modal {
      position: absolute;
      left: 16px;
      right: 16px;
      top: 50%;
      transform: translateY(-50%);
      background: rgba(40, 40, 40, 0.98);
      border: 1px solid rgba(255, 255, 255, 0.28);
      border-radius: 8px;
      padding: 12px;
      z-index: 4;
      box-sizing: border-box;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.08s ease;
      max-height: calc(100% - 32px);
      overflow-y: auto;
    }
    #dmna-stroke-modal.show {
      opacity: 1;
      pointer-events: auto;
    }
    #dmna-stroke-swatches {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 6px;
      margin-bottom: 10px;
    }
    #dmna-stroke-input-row {
      display: grid;
      grid-template-columns: 1fr 40px;
      gap: 8px;
      align-items: stretch;
      margin-bottom: 8px;
    }
    #dmna-stroke-hex {
      padding: 8px 10px;
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.18);
      background: rgba(0, 0, 0, 0.4);
      color: white;
      font-family: ui-monospace, Menlo, Consolas, monospace;
      font-size: 13px;
      line-height: 1.4;
      box-sizing: border-box;
      outline: none;
      width: 100%;
      min-width: 0;
    }
    #dmna-stroke-hex:focus {
      border-color: #0073ff;
    }
    #dmna-stroke-hex.is-invalid {
      border-color: #e53935;
    }
    #dmna-stroke-apply {
      padding: 10px 0;
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.32);
      background: rgba(255, 255, 255, 0.13);
      color: #f0f0f0;
      font-size: 20px;
      font-family: inherit;
      cursor: pointer;
      user-select: none;
      touch-action: manipulation;
      min-height: 36px;
      box-sizing: border-box;
    }
    #dmna-stroke-apply:active {
      background: rgba(74, 158, 255, 0.36);
    }
    #dmna-stroke-apply:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    #dmna-stroke-advanced-toggle {
      background: transparent;
      border: none;
      color: #4a9eff;
      font-size: 13px;
      font-family: inherit;
      padding: 4px 0;
      cursor: pointer;
      user-select: none;
      touch-action: manipulation;
      text-decoration: none;
      width: 100%;
      text-align: left;
    }
    #dmna-stroke-advanced-toggle:hover {
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    #dmna-stroke-advanced {
      display: none;
      margin-top: 4px;
      padding-top: 8px;
      border-top: 1px solid rgba(255, 255, 255, 0.12);
    }
    #dmna-stroke-advanced.is-open {
      display: block;
    }
    .dmna-stroke-advanced-row {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
    }
    .dmna-stroke-advanced-row:last-child {
      margin-bottom: 0;
    }
    .dmna-stroke-advanced-label {
      flex: 0 0 70px;
      font-size: 13px;
      color: rgba(255, 255, 255, 0.7);
    }
    .dmna-stroke-thickness-group {
      display: flex;
      gap: 4px;
    }
    .dmna-stroke-thickness-btn {
      padding: 6px 12px;
      border-radius: 4px;
      border: 1px solid rgba(255, 255, 255, 0.24);
      background: rgba(255, 255, 255, 0.06);
      color: rgba(255, 255, 255, 0.85);
      font-size: 12px;
      font-family: inherit;
      cursor: pointer;
      touch-action: manipulation;
    }
    .dmna-stroke-thickness-btn.is-active {
      background: rgba(74, 158, 255, 0.28);
      border-color: rgba(74, 158, 255, 0.7);
      color: white;
    }
    .dmna-stroke-sides-group {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 4px 12px;
      flex: 1;
    }
    .dmna-stroke-side-label {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: rgba(255, 255, 255, 0.85);
      cursor: pointer;
      user-select: none;
    }
    .dmna-stroke-side-label input[type="checkbox"] {
      cursor: pointer;
      margin: 0;
    }

    /* Ruby modal (Phase 5, v4.2) — inline modal mounted as a child of
       #dmna-popover, mirroring link-popover layout (single-line input
       + ✔ Apply button). Collects the reading text (furigana /
       pronunciation gloss) used inside the <rt> annotation. z-index
       5/6 places it above stroke (3/4) and color (3/4); pickers are
       mutually exclusive in practice so the stacking just keeps the
       ordering unambiguous. */
    #dmna-ruby-overlay {
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.4);
      border-radius: 9px;
      z-index: 5;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.08s ease;
    }
    #dmna-ruby-overlay.show {
      opacity: 1;
      pointer-events: auto;
    }
    #dmna-ruby-modal {
      position: absolute;
      left: 16px;
      right: 16px;
      top: 50%;
      transform: translateY(-50%);
      display: grid;
      grid-template-columns: 1fr 40px;
      gap: 8px;
      align-items: stretch;
      background: rgba(40, 40, 40, 0.98);
      border: 1px solid rgba(255, 255, 255, 0.28);
      border-radius: 8px;
      padding: 10px;
      z-index: 6;
      box-sizing: border-box;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.08s ease;
    }
    #dmna-ruby-modal.show {
      opacity: 1;
      pointer-events: auto;
    }
    #dmna-ruby-modal-input {
      padding: 8px 10px;
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.18);
      background: rgba(0, 0, 0, 0.4);
      color: white;
      font-size: 13px;
      font-family: inherit;
      line-height: 1.4;
      box-sizing: border-box;
      outline: none;
      width: 100%;
      min-width: 0;
    }
    #dmna-ruby-modal-input:focus {
      border-color: #0073ff;
    }
    #dmna-ruby-modal-confirm {
      padding: 10px 0;
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.32);
      background: rgba(255, 255, 255, 0.13);
      color: #f0f0f0;
      font-size: 20px;
      font-family: inherit;
      cursor: pointer;
      user-select: none;
      touch-action: manipulation;
      min-height: 36px;
      box-sizing: border-box;
    }
    #dmna-ruby-modal-confirm:active {
      background: rgba(74, 158, 255, 0.36);
    }
  `;
  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }
  function getPostId() {
    const m = window.location.pathname.match(/^\/posts\/(\d+)/);
    return m ? m[1] : null;
  }
  function getImageDisplayRect(img) {
    const r = img.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) {
      return null;
    }
    return {
      left: r.left + window.pageXOffset,
      top: r.top + window.pageYOffset,
      width: r.width,
      height: r.height
    };
  }
  function imageToScreenRect(state, displayRect, originalWidth) {
    const scale = originalWidth ? displayRect.width / originalWidth : 1;
    return {
      left: displayRect.left + state.x * scale,
      top: displayRect.top + state.y * scale,
      width: state.w * scale,
      height: state.h * scale
    };
  }
  function screenToImageRect(r, displayRect, originalWidth) {
    if (!originalWidth) {
      return null;
    }
    const scale = displayRect.width / originalWidth;
    return {
      x: (r.left - displayRect.left) / scale,
      y: (r.top - displayRect.top) / scale,
      w: r.width / scale,
      h: r.height / scale
    };
  }
  const MAX_DRAFT_AGE_MS = 24 * 60 * 60 * 1e3;
  const DRAFT_SCHEMA_VERSION = 1;
  const DRAFT_KEY_PREFIX = "dmna_draft_";
  function draftKey() {
    const id = getPostId();
    return id ? DRAFT_KEY_PREFIX + id : null;
  }
  function safeSetItem(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (err) {
      console.warn(
        `[MobileNoteAssist] localStorage.setItem("${key}") failed`,
        err
      );
      return false;
    }
  }
  function safeGetItem(key) {
    try {
      return localStorage.getItem(key);
    } catch (err) {
      console.warn(
        `[MobileNoteAssist] localStorage.getItem("${key}") failed`,
        err
      );
      return null;
    }
  }
  function safeRemoveItem(key) {
    try {
      localStorage.removeItem(key);
    } catch (err) {
      console.warn(
        `[MobileNoteAssist] localStorage.removeItem("${key}") failed`,
        err
      );
    }
  }
  function saveDraft(snapshot) {
    const key = draftKey();
    if (!key) {
      return;
    }
    const payload = {
      schemaVersion: DRAFT_SCHEMA_VERSION,
      savedAt: Date.now(),
      ...snapshot
    };
    safeSetItem(key, JSON.stringify(payload));
  }
  function loadDraft() {
    const key = draftKey();
    if (!key) {
      return null;
    }
    const raw = safeGetItem(key);
    if (!raw) {
      return null;
    }
    let parsed;
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
    return {
      mode: parsed.mode,
      activeNoteId: parsed.activeNoteId,
      notes: parsed.notes,
      actionLog: parsed.actionLog
    };
  }
  function clearDraft() {
    const key = draftKey();
    if (key) {
      safeRemoveItem(key);
    }
  }
  function isPersistedDraftV1(v) {
    if (typeof v !== "object" || v === null) {
      return false;
    }
    const o = v;
    if (o.schemaVersion !== DRAFT_SCHEMA_VERSION) {
      return false;
    }
    if (typeof o.savedAt !== "number") {
      return false;
    }
    if (o.mode !== "idle" && o.mode !== "active") {
      return false;
    }
    if (o.activeNoteId !== null && typeof o.activeNoteId !== "string") {
      return false;
    }
    if (!Array.isArray(o.notes) || !Array.isArray(o.actionLog)) {
      return false;
    }
    if (!o.notes.every(isNotesEntry)) {
      return false;
    }
    if (!o.actionLog.every(isActionLogStackEntry)) {
      return false;
    }
    return true;
  }
  function isFiniteNumber(v) {
    return typeof v === "number" && Number.isFinite(v);
  }
  function isNoteState(v) {
    if (typeof v !== "object" || v === null) {
      return false;
    }
    const o = v;
    return isFiniteNumber(o.x) && isFiniteNumber(o.y) && isFiniteNumber(o.w) && isFiniteNumber(o.h) && typeof o.text === "string";
  }
  function isSerializedNote(v) {
    if (typeof v !== "object" || v === null) {
      return false;
    }
    const o = v;
    return isNoteState(o.current) && isNoteState(o.initialState) && isNoteState(o.confirmedState) && typeof o.isDeleted === "boolean" && typeof o.isServerNote === "boolean" && typeof o.everConfirmed === "boolean";
  }
  function isNotesEntry(v) {
    if (!Array.isArray(v) || v.length !== 2) {
      return false;
    }
    return typeof v[0] === "string" && isSerializedNote(v[1]);
  }
  function isTextSnapshot(v) {
    if (typeof v !== "object" || v === null) {
      return false;
    }
    const o = v;
    return typeof o.text === "string" && isFiniteNumber(o.selectionStart) && isFiniteNumber(o.selectionEnd);
  }
  function isActionLogEntry(v) {
    if (typeof v !== "object" || v === null) {
      return false;
    }
    const o = v;
    if (typeof o.noteId !== "string") {
      return false;
    }
    switch (o.type) {
      case "create":
        return o.prevState === null;
      case "edit":
      case "delete":
      case "transform":
        return isNoteState(o.prevState);
      case "text":
        return isTextSnapshot(o.prevState);
      default:
        return false;
    }
  }
  function isActionLogStackEntry(v) {
    if (!Array.isArray(v) || v.length !== 2) {
      return false;
    }
    if (typeof v[0] !== "string" || !Array.isArray(v[1])) {
      return false;
    }
    return v[1].every(isActionLogEntry);
  }
  function asServerNoteId(id) {
    return String(id);
  }
  function asTempNoteId(s) {
    return s;
  }
  function isServerNoteId(id) {
    return !id.startsWith("temp-");
  }
  function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.getAttribute("content") || "" : "";
  }
  async function apiCall(method, url, body) {
    const headers = {
      Accept: "application/json",
      "X-CSRF-Token": getCsrfToken()
    };
    const opts = { method, credentials: "same-origin", headers };
    if (body !== void 0 && body !== null) {
      headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    const r = await fetch(url, opts);
    if (!r.ok) {
      let detail = "";
      try {
        const errText = await r.text();
        if (errText) {
          try {
            const errJson = JSON.parse(errText);
            detail = errJson.message || errJson.error || (errJson.errors ? JSON.stringify(errJson.errors) : "") || errText;
          } catch (_parseErr) {
            detail = errText;
          }
        }
      } catch (_readErr) {
      }
      const head = `HTTP ${r.status} ${r.statusText}`.trim();
      const truncated = detail.length > 200 ? detail.slice(0, 197) + "..." : detail;
      throw new Error(truncated ? `${head} — ${truncated}` : head);
    }
    const text = await r.text();
    return text ? JSON.parse(text) : null;
  }
  let postOriginalWidth = 0;
  let postOriginalHeight = 0;
  let postMetaPromise = null;
  function getOriginalWidth() {
    return postOriginalWidth;
  }
  function getOriginalHeight() {
    return postOriginalHeight;
  }
  function setPostMeta(width, height) {
    postOriginalWidth = width;
    postOriginalHeight = height;
  }
  function getPostMetaPromise() {
    return postMetaPromise;
  }
  function setPostMetaPromise(p) {
    postMetaPromise = p;
  }
  function fetchPostMeta() {
    const cachedW = getOriginalWidth();
    const cachedH = getOriginalHeight();
    if (cachedW && cachedH) {
      return Promise.resolve({ width: cachedW, height: cachedH });
    }
    const inFlight = getPostMetaPromise();
    if (inFlight) {
      return inFlight;
    }
    const id = getPostId();
    if (!id) {
      return Promise.reject(new Error("No post id in URL"));
    }
    const p = fetch(`/posts/${id}.json?only=image_width,image_height`, {
      credentials: "same-origin"
    }).then((r) => {
      if (!r.ok) {
        throw new Error(`HTTP ${r.status}`);
      }
      return r.json();
    }).then((data) => {
      const w = Number(data.image_width) || 0;
      const h = Number(data.image_height) || 0;
      if (!w || !h) {
        throw new Error("Image dimensions missing in response");
      }
      setPostMeta(w, h);
      return { width: w, height: h };
    }).catch((err) => {
      setPostMetaPromise(null);
      throw err;
    });
    setPostMetaPromise(p);
    return p;
  }
  function fetchPostTagString() {
    const id = getPostId();
    if (!id) {
      return Promise.reject(new Error("No post id in URL"));
    }
    return fetch(`/posts/${id}.json?only=tag_string`, {
      credentials: "same-origin"
    }).then((r) => {
      if (!r.ok) {
        throw new Error(`HTTP ${r.status}`);
      }
      return r.json();
    }).then((data) => String(data.tag_string || ""));
  }
  async function apiPatchPostTags(tagsToAdd, tagsToRemove) {
    const current = await fetchPostTagString();
    const tags = new Set(current.split(/\s+/).filter(Boolean));
    tagsToAdd.forEach((t) => tags.add(t));
    tagsToRemove.forEach((t) => tags.delete(t));
    const newTagString = [...tags].join(" ");
    return apiCall("PUT", `/posts/${getPostId()}.json`, {
      post: { tag_string: newTagString }
    });
  }
  let serverNotesInFlight = null;
  function fetchServerNotes() {
    if (serverNotesInFlight) {
      return serverNotesInFlight;
    }
    const id = getPostId();
    if (!id) {
      return Promise.reject(new Error("No post id in URL"));
    }
    const url = `/notes.json?search%5Bpost_id%5D=${id}&search%5Bis_active%5D=true&limit=1000`;
    const p = fetch(url, { credentials: "same-origin" }).then((r) => {
      if (!r.ok) {
        throw new Error(`HTTP ${r.status}`);
      }
      return r.json();
    }).finally(() => {
      serverNotesInFlight = null;
    });
    serverNotesInFlight = p;
    return p;
  }
  async function apiPostNote(state) {
    const postId = Number(getPostId());
    const payload = {
      note: {
        post_id: postId,
        x: Math.round(state.x),
        y: Math.round(state.y),
        width: Math.round(state.w),
        height: Math.round(state.h),
        body: state.text || ""
      }
    };
    return apiCall("POST", "/notes.json", payload);
  }
  async function apiPutNote(serverId, state) {
    const payload = {
      note: {
        x: Math.round(state.x),
        y: Math.round(state.y),
        width: Math.round(state.w),
        height: Math.round(state.h),
        body: state.text || ""
      }
    };
    return apiCall("PUT", `/notes/${serverId}.json`, payload);
  }
  async function apiDeleteNote(serverId) {
    return apiCall("DELETE", `/notes/${serverId}.json`, null);
  }
  async function apiPreviewNote(body) {
    const res = await apiCall(
      "POST",
      "/notes/preview.json",
      { body }
    );
    if (res === null) {
      throw new Error("Empty preview response");
    }
    if (typeof res.sanitized_body !== "string") {
      throw new Error("Malformed preview response: sanitized_body missing");
    }
    return res;
  }
  const NATIVE_TRANSLATION_CLASS = "mode-translation";
  const NATIVE_EDITING_BOX_SELECTOR = ".note-box.editing";
  const NATIVE_EDIT_DIALOG_SELECTOR = ".ui-dialog.note-edit-dialog";
  let isNativeActive = false;
  let observer = null;
  const subscribers = new Set();
  function detectEditDialog() {
    if (document.querySelector(NATIVE_EDITING_BOX_SELECTOR) !== null) {
      return true;
    }
    const dialog = document.querySelector(NATIVE_EDIT_DIALOG_SELECTOR);
    return dialog instanceof HTMLElement && dialog.style.display !== "none";
  }
  function detect() {
    return document.body.classList.contains(NATIVE_TRANSLATION_CLASS) || detectEditDialog();
  }
  function recompute() {
    const next = detect();
    if (next === isNativeActive) {
      return;
    }
    isNativeActive = next;
    for (const cb of subscribers) {
      cb(next);
    }
  }
  function getIsNativeActive() {
    return isNativeActive;
  }
  function onNativeStateChanged(callback) {
    subscribers.add(callback);
    return () => {
      subscribers.delete(callback);
    };
  }
  function initNativeConflictWatch() {
    if (observer !== null) {
      return;
    }
    isNativeActive = detect();
    observer = new MutationObserver(recompute);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
      childList: true,
      subtree: true
    });
  }
  let hooks$3 = null;
  function initNotesStore(h) {
    hooks$3 = h;
  }
  let mode = "idle";
  let activeNoteId = null;
  let activeModeGen = 0;
  const notes = new Map();
  const actionLog = new Map();
  function getMode() {
    return mode;
  }
  function getActiveNoteId() {
    return activeNoteId;
  }
  function genNoteId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return asTempNoteId("temp-" + crypto.randomUUID());
    }
    return asTempNoteId(
      "temp-" + Math.random().toString(36).slice(2) + Date.now().toString(36)
    );
  }
  function isDirty(note) {
    if (!note.isServerNote) {
      return true;
    }
    const a = note.current;
    const b = note.initialState;
    return a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h || a.text !== b.text;
  }
  function pushAction(noteId, type, prevState) {
    let stack = actionLog.get(noteId);
    if (!stack) {
      stack = [];
      actionLog.set(noteId, stack);
    }
    if (type === "create") {
      stack.push({ noteId, type, prevState: null });
    } else if (prevState !== null) {
      stack.push({ noteId, type, prevState });
    }
  }
  function pushTextAction(noteId, prevState) {
    let stack = actionLog.get(noteId);
    if (!stack) {
      stack = [];
      actionLog.set(noteId, stack);
    }
    stack.push({ noteId, type: "text", prevState });
  }
  function clearTextActionsForNote(noteId) {
    const stack = actionLog.get(noteId);
    if (!stack) {
      return;
    }
    const filtered = stack.filter((e) => e.type !== "text");
    if (filtered.length === 0) {
      actionLog.delete(noteId);
    } else {
      actionLog.set(noteId, filtered);
    }
  }
  function discardAll() {
    for (const id of [...notes.keys()]) {
      hooks$3.onNoteRemoved(id);
    }
    notes.clear();
    actionLog.clear();
    setActiveNote(null);
  }
  function setMode(newMode) {
    if (mode === newMode) {
      return;
    }
    if (newMode === "active" && getIsNativeActive()) {
      hooks$3.onToast(
        "Danbooru's native note UI is active — close it first",
        "info"
      );
      return;
    }
    mode = newMode;
    hooks$3.onModeChanged(newMode);
    if (newMode === "active") {
      document.body.classList.add("dmna-mode-active");
      activeModeGen++;
      void enterActiveMode(activeModeGen);
    } else {
      activeModeGen++;
      discardAll();
      document.body.classList.remove("dmna-mode-active");
      const noteContainer = document.querySelector(".note-container");
      if (noteContainer) {
        noteContainer.classList.remove("hide-notes");
      }
    }
  }
  async function enterActiveMode(gen) {
    try {
      await fetchPostMeta();
    } catch (err) {
      if (gen !== activeModeGen) {
        return;
      }
      hooks$3.onToast("⚠️ Failed to load image info", "error", err);
      return;
    }
    if (gen !== activeModeGen || mode !== "active") {
      return;
    }
    let serverNotes;
    try {
      serverNotes = await fetchServerNotes();
    } catch (err) {
      if (gen !== activeModeGen) {
        return;
      }
      hooks$3.onToast("⚠️ Failed to load existing notes", "error", err);
      return;
    }
    if (gen !== activeModeGen || mode !== "active") {
      return;
    }
    for (const sn of serverNotes) {
      addServerNote(sn);
    }
  }
  function toggleEditMode() {
    if (getMode() === "active") {
      tryDeactivate();
      if (getMode() === "idle") {
        hooks$3.onToast("Edit mode off", "info");
      }
    } else {
      setMode("active");
      if (getMode() === "active") {
        hooks$3.onToast("Edit mode on", "info");
      }
    }
  }
  function tryDeactivate() {
    if (hooks$3.hasPendingChanges()) {
      const ok = window.confirm("Discard all changes and turn off?");
      if (ok) {
        setMode("idle");
      } else {
        hooks$3.onReopenMenuRequested();
      }
    } else {
      setMode("idle");
    }
  }
  function setActiveNote(noteId) {
    if (activeNoteId === noteId) {
      return;
    }
    const prev = activeNoteId;
    activeNoteId = noteId;
    hooks$3.onActiveChanged(prev, noteId);
  }
  function popoverUndo(noteId) {
    const stack = actionLog.get(noteId);
    if (!stack || stack.length === 0) {
      hooks$3.onToast("Nothing to undo for this note", "info");
      return;
    }
    const entry = stack.pop();
    if (stack.length === 0) {
      actionLog.delete(noteId);
    }
    if (entry.type === "create") {
      hardDeleteNote(noteId);
      return;
    }
    const note = notes.get(noteId);
    if (!note) {
      return;
    }
    if (entry.type === "edit") {
      note.current = { ...entry.prevState };
      note.confirmedState = { ...entry.prevState };
      hooks$3.onNoteRenderRequested(noteId);
    } else if (entry.type === "delete") {
      note.isDeleted = false;
      note.current = { ...entry.prevState };
      hooks$3.onNoteRenderRequested(noteId);
    } else if (entry.type === "transform") {
      note.current.x = entry.prevState.x;
      note.current.y = entry.prevState.y;
      note.current.w = entry.prevState.w;
      note.current.h = entry.prevState.h;
      hooks$3.onNoteRenderRequested(noteId);
    } else if (entry.type === "text") {
      note.current.text = entry.prevState.text;
      hooks$3.onTextUndo(noteId, entry.prevState);
    }
  }
  function popoverConfirm(noteId) {
    const note = notes.get(noteId);
    if (!note) {
      return;
    }
    pushAction(noteId, "edit", { ...note.confirmedState });
    note.confirmedState = { ...note.current };
    note.everConfirmed = true;
    setActiveNote(null);
  }
  function popoverCancel(noteId) {
    const note = notes.get(noteId);
    if (!note) {
      return;
    }
    const isFreshNew = !note.isServerNote && !note.everConfirmed;
    if (isFreshNew) {
      hardDeleteNote(noteId);
      return;
    }
    note.current = { ...note.confirmedState };
    clearTextActionsForNote(noteId);
    hooks$3.onNoteRenderRequested(noteId);
    setActiveNote(null);
  }
  function popoverDelete(noteId) {
    const note = notes.get(noteId);
    if (!note) {
      return;
    }
    const isFreshNew = !note.isServerNote && !note.everConfirmed;
    if (isFreshNew) {
      hardDeleteNote(noteId);
    } else {
      pushAction(noteId, "delete", { ...note.current });
      note.isDeleted = true;
      setActiveNote(null);
    }
  }
  function hardDeleteNote(id) {
    if (activeNoteId === id) {
      setActiveNote(null);
    }
    hooks$3.onNoteRemoved(id);
    notes.delete(id);
    actionLog.delete(id);
  }
  function addServerNote(sn) {
    const id = asServerNoteId(sn.id);
    if (notes.has(id)) {
      return;
    }
    const state = {
      x: sn.x,
      y: sn.y,
      w: sn.width,
      h: sn.height,
      text: sn.body || ""
    };
    const note = {
      current: { ...state },
      initialState: { ...state },
      confirmedState: { ...state },
      isDeleted: false,
      isServerNote: true,
      everConfirmed: false,
      domElement: null
    };
    notes.set(id, note);
    hooks$3.onNoteRenderRequested(id);
  }
  function createTempNote(state) {
    const id = genNoteId();
    const note = {
      current: { ...state },
      initialState: { ...state },
      confirmedState: { ...state },
      isDeleted: false,
      isServerNote: false,
      everConfirmed: false,
      domElement: null
    };
    notes.set(id, note);
    pushAction(id, "create", null);
    hooks$3.onNoteRenderRequested(id);
    return id;
  }
  function hasContentToSave() {
    if (mode !== "active") return false;
    if (notes.size === 0) return false;
    if (hooks$3.hasPendingChanges()) return true;
    for (const note of notes.values()) {
      if (!note.isServerNote && !note.everConfirmed && !note.isDeleted && note.current.text.trim()) {
        return true;
      }
    }
    return false;
  }
  function serializeForDraft() {
    const serializedNotes = [];
    for (const [id, note] of notes.entries()) {
      serializedNotes.push([
        id,
        {
          current: { ...note.current },
          initialState: { ...note.initialState },
          confirmedState: { ...note.confirmedState },
          isDeleted: note.isDeleted,
          isServerNote: note.isServerNote,
          everConfirmed: note.everConfirmed
        }
      ]);
    }
    const serializedActionLog = [];
    for (const [id, stack] of actionLog.entries()) {
      serializedActionLog.push([id, stack.map((e) => ({ ...e }))]);
    }
    return {
      mode,
      activeNoteId,
      notes: serializedNotes,
      actionLog: serializedActionLog
    };
  }
  async function applyDraftSnapshot(snapshot) {
    for (const id of [...notes.keys()]) {
      hooks$3.onNoteRemoved(id);
    }
    notes.clear();
    actionLog.clear();
    if (activeNoteId !== null) {
      const prev = activeNoteId;
      activeNoteId = null;
      hooks$3.onActiveChanged(prev, null);
    }
    for (const [rawId, snote] of snapshot.notes) {
      const noteId = rebrandNoteId(rawId);
      const note = {
        current: { ...snote.current },
        initialState: { ...snote.initialState },
        confirmedState: { ...snote.confirmedState },
        isDeleted: snote.isDeleted,
        isServerNote: snote.isServerNote,
        everConfirmed: snote.everConfirmed,
        domElement: null
      };
      notes.set(noteId, note);
    }
    for (const [rawId, entries] of snapshot.actionLog) {
      const noteId = rebrandNoteId(rawId);
      const rebranded = entries.map((e) => {
        switch (e.type) {
          case "create":
            return { noteId, type: "create", prevState: null };
          case "edit":
            return { noteId, type: "edit", prevState: e.prevState };
          case "delete":
            return { noteId, type: "delete", prevState: e.prevState };
          case "transform":
            return { noteId, type: "transform", prevState: e.prevState };
          case "text":
            return { noteId, type: "text", prevState: e.prevState };
        }
      });
      actionLog.set(noteId, rebranded);
    }
    if (snapshot.mode === "active") {
      try {
        await fetchPostMeta();
      } catch (err) {
        hooks$3.onToast("⚠️ Failed to load image info", "error", err);
      }
    }
    setMode(snapshot.mode);
    for (const id of notes.keys()) {
      hooks$3.onNoteRenderRequested(id);
    }
    if (snapshot.activeNoteId !== null) {
      const activeId = rebrandNoteId(snapshot.activeNoteId);
      if (notes.has(activeId)) {
        setActiveNote(activeId);
      }
    }
  }
  function rebrandNoteId(rawId) {
    return rawId.startsWith("temp-") ? asTempNoteId(rawId) : asServerNoteId(rawId);
  }
  function hasPendingChanges() {
    for (const note of notes.values()) {
      if (note.isServerNote) {
        if (note.isDeleted) {
          return true;
        }
        const a = note.current;
        const b = note.initialState;
        if (a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h || a.text !== b.text) {
          return true;
        }
      } else {
        if (note.everConfirmed && !note.isDeleted) {
          return true;
        }
      }
    }
    return false;
  }
  function classifyChanges() {
    const posts = [];
    const puts = [];
    const deletes = [];
    const dropped = {
      uncommittedTemps: [],
      softDeletedTemps: [],
      unchangedServer: []
    };
    for (const [noteId, note] of notes.entries()) {
      if (note.isServerNote) {
        if (!isServerNoteId(noteId)) {
          continue;
        }
        if (note.isDeleted) {
          deletes.push({ noteId, serverId: noteId });
          continue;
        }
        const a = note.current;
        const b = note.initialState;
        const geomChanged = a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h;
        const textChanged = a.text !== b.text;
        if (geomChanged || textChanged) {
          puts.push({
            noteId,
            serverId: noteId,
            state: { ...a },
            textChanged
          });
        } else {
          dropped.unchangedServer.push(noteId);
        }
      } else {
        if (note.isDeleted) {
          dropped.softDeletedTemps.push(noteId);
        } else if (!note.everConfirmed) {
          dropped.uncommittedTemps.push(noteId);
        } else {
          posts.push({ noteId, state: { ...note.current } });
        }
      }
    }
    const hasChanges = posts.length > 0 || puts.length > 0 || deletes.length > 0;
    return { posts, puts, deletes, dropped, hasChanges };
  }
  function needsTagPopover(c) {
    if (c.posts.length > 0) {
      return true;
    }
    if (c.deletes.length > 0) {
      return true;
    }
    return c.puts.some((p) => p.textChanged);
  }
  let hooks$2 = null;
  function initConfirmFlow(h) {
    hooks$2 = h;
  }
  let isSending = false;
  let isInConfirmPipeline = false;
  let errorModalElement = null;
  let errorModalBackdropElement = null;
  let pendingErrorModalResolver = null;
  function getIsSending() {
    return isSending;
  }
  function getIsInConfirmPipeline() {
    return isInConfirmPipeline;
  }
  function errMessage(err) {
    return String(err?.message || err);
  }
  function startSendingUI() {
    isSending = true;
    document.body.classList.add("dmna-sending");
    hooks$2.onSendStart();
  }
  function endSendingUI() {
    isSending = false;
    document.body.classList.remove("dmna-sending");
    hooks$2.onSendEnd();
  }
  async function sendBatch(classified, tagDelta) {
    const result = {
      successful: { posts: [], puts: [], deletes: [] },
      failed: { posts: [], puts: [], deletes: [], tagPatch: null }
    };
    startSendingUI();
    try {
      for (const item of classified.deletes) {
        try {
          await apiDeleteNote(item.serverId);
          result.successful.deletes.push(item);
        } catch (err) {
          console.error(
            `[${SCRIPT_NAME}] DELETE note ${item.serverId} failed`,
            err
          );
          result.failed.deletes.push({ ...item, error: errMessage(err) });
        }
      }
      for (const item of classified.puts) {
        try {
          await apiPutNote(item.serverId, item.state);
          result.successful.puts.push(item);
        } catch (err) {
          console.error(`[${SCRIPT_NAME}] PUT note ${item.serverId} failed`, err);
          result.failed.puts.push({ ...item, error: errMessage(err) });
        }
      }
      for (const item of classified.posts) {
        try {
          const serverResponse = await apiPostNote(item.state);
          result.successful.posts.push({ ...item, serverResponse });
        } catch (err) {
          console.error(`[${SCRIPT_NAME}] POST temp ${item.noteId} failed`, err);
          result.failed.posts.push({ ...item, error: errMessage(err) });
        }
      }
      if (tagDelta && (tagDelta.tagsToAdd.length > 0 || tagDelta.tagsToRemove.length > 0)) {
        try {
          await apiPatchPostTags(tagDelta.tagsToAdd, tagDelta.tagsToRemove);
        } catch (err) {
          console.error(`[${SCRIPT_NAME}] tag PATCH failed`, err);
          result.failed.tagPatch = errMessage(err);
        }
      }
    } finally {
      endSendingUI();
    }
    return result;
  }
  function applyServerStateToLocal(result) {
    for (const item of result.successful.posts) {
      const sr = item.serverResponse;
      if (!sr || typeof sr.id !== "number") {
        continue;
      }
      const serverId = asServerNoteId(sr.id);
      const baselineState = {
        x: typeof sr.x === "number" ? sr.x : Math.round(item.state.x),
        y: typeof sr.y === "number" ? sr.y : Math.round(item.state.y),
        w: typeof sr.width === "number" ? sr.width : Math.round(item.state.w),
        h: typeof sr.height === "number" ? sr.height : Math.round(item.state.h),
        text: typeof sr.body === "string" ? sr.body : item.state.text || ""
      };
      hardDeleteNote(item.noteId);
      const newNote = {
        current: { ...baselineState },
        initialState: { ...baselineState },
        confirmedState: { ...baselineState },
        isDeleted: false,
        isServerNote: true,
        everConfirmed: true,
        domElement: null
      };
      notes.set(serverId, newNote);
      hooks$2.onNoteRenderRequested(serverId);
    }
    for (const item of result.successful.puts) {
      const note = notes.get(item.noteId);
      if (!note) {
        continue;
      }
      note.initialState = { ...note.current };
      note.confirmedState = { ...note.current };
      actionLog.delete(item.noteId);
      hooks$2.onNoteVisualsChanged(item.noteId);
    }
    for (const item of result.successful.deletes) {
      hardDeleteNote(item.noteId);
    }
  }
  function buildFailureLines(result) {
    const lines = [];
    for (const f of result.failed.deletes) {
      lines.push(`DELETE note ${f.serverId}: ${f.error}`);
    }
    for (const f of result.failed.puts) {
      lines.push(`PUT note ${f.serverId}: ${f.error}`);
    }
    for (const f of result.failed.posts) {
      lines.push(`POST new note: ${f.error}`);
    }
    if (result.failed.tagPatch) {
      lines.push(`Tag PATCH: ${result.failed.tagPatch}`);
    }
    return lines;
  }
  function countSendResult(result) {
    const s = result.successful;
    const f = result.failed;
    const successCount = s.posts.length + s.puts.length + s.deletes.length;
    const failureCount = f.posts.length + f.puts.length + f.deletes.length + (f.tagPatch ? 1 : 0);
    return { successCount, failureCount };
  }
  async function handleSendResult(result, tagDelta) {
    applyServerStateToLocal(result);
    const hasFailures = result.failed.posts.length > 0 || result.failed.puts.length > 0 || result.failed.deletes.length > 0 || result.failed.tagPatch !== null;
    if (!hasFailures) {
      actionLog.clear();
      clearDraft();
      hooks$2.onToast("✓ Saved", "success");
      setTimeout(() => {
        setMode("idle");
        window.location.reload();
      }, 1e3);
      return;
    }
    const choice = await showErrorModal(result);
    if (choice !== "retry") {
      return;
    }
    const newClassified = classifyChanges();
    const retryTagDelta = result.failed.tagPatch ? tagDelta : null;
    if (!newClassified.hasChanges && !retryTagDelta) {
      hooks$2.onToast("Nothing left to retry", "info");
      return;
    }
    const retryResult = await sendBatch(newClassified, retryTagDelta);
    await handleSendResult(retryResult, retryTagDelta);
  }
  function createErrorModal() {
    if (errorModalElement) {
      return;
    }
    errorModalBackdropElement = document.createElement("div");
    errorModalBackdropElement.id = "dmna-error-modal-backdrop";
    errorModalBackdropElement.addEventListener("click", () => {
      submitErrorModal("cancel");
    });
    errorModalElement = document.createElement("div");
    errorModalElement.id = "dmna-error-modal";
    errorModalElement.addEventListener("click", (e) => e.stopPropagation());
    const header = document.createElement("div");
    header.className = "dmna-error-modal-header";
    header.textContent = "Confirm — partial failure";
    errorModalElement.appendChild(header);
    const summary = document.createElement("div");
    summary.className = "dmna-error-modal-summary";
    summary.id = "dmna-error-modal-summary";
    errorModalElement.appendChild(summary);
    const list = document.createElement("div");
    list.className = "dmna-error-modal-list";
    list.id = "dmna-error-modal-list";
    errorModalElement.appendChild(list);
    const buttons = document.createElement("div");
    buttons.id = "dmna-error-modal-buttons";
    const retryBtn = document.createElement("button");
    retryBtn.type = "button";
    retryBtn.className = "dmna-error-modal-btn";
    retryBtn.dataset.action = "retry";
    retryBtn.textContent = "Retry";
    retryBtn.addEventListener("click", () => submitErrorModal("retry"));
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "dmna-error-modal-btn";
    cancelBtn.dataset.action = "cancel";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => submitErrorModal("cancel"));
    buttons.appendChild(retryBtn);
    buttons.appendChild(cancelBtn);
    errorModalElement.appendChild(buttons);
    document.body.appendChild(errorModalBackdropElement);
    document.body.appendChild(errorModalElement);
  }
  function openErrorModal(result) {
    createErrorModal();
    const { successCount, failureCount } = countSendResult(result);
    const total = successCount + failureCount;
    const summaryEl = errorModalElement.querySelector(
      "#dmna-error-modal-summary"
    );
    if (summaryEl) {
      summaryEl.textContent = `${successCount} of ${total} operation(s) succeeded; ${failureCount} failed.`;
    }
    const listEl = errorModalElement.querySelector("#dmna-error-modal-list");
    if (listEl) {
      listEl.textContent = "";
      buildFailureLines(result).forEach((line) => {
        const div = document.createElement("div");
        div.className = "dmna-error-modal-list-item";
        div.textContent = line;
        listEl.appendChild(div);
      });
    }
    document.body.classList.add("dmna-error-modal-open");
    errorModalBackdropElement.classList.add("show");
    errorModalElement.classList.add("show");
    document.addEventListener("keydown", errorModalKeyHandler, true);
  }
  function closeErrorModal() {
    document.body.classList.remove("dmna-error-modal-open");
    if (errorModalBackdropElement) {
      errorModalBackdropElement.classList.remove("show");
    }
    if (errorModalElement) {
      errorModalElement.classList.remove("show");
    }
    document.removeEventListener("keydown", errorModalKeyHandler, true);
  }
  function submitErrorModal(choice) {
    const resolver = pendingErrorModalResolver;
    if (!resolver) {
      return;
    }
    pendingErrorModalResolver = null;
    closeErrorModal();
    resolver(choice);
  }
  function errorModalKeyHandler(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      submitErrorModal("cancel");
    } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      submitErrorModal("retry");
    }
  }
  function showErrorModal(result) {
    return new Promise((resolve) => {
      if (pendingErrorModalResolver) {
        const stale = pendingErrorModalResolver;
        pendingErrorModalResolver = null;
        stale("cancel");
      }
      pendingErrorModalResolver = resolve;
      openErrorModal(result);
    });
  }
  async function runConfirmFlow() {
    if (isSending || isInConfirmPipeline) {
      return;
    }
    isInConfirmPipeline = true;
    try {
      clearDraft();
      setActiveNote(null);
      const classified = classifyChanges();
      if (!classified.hasChanges) {
        hooks$2.onToast("No changes to confirm", "info");
        return;
      }
      let tagDelta = null;
      if (needsTagPopover(classified)) {
        tagDelta = await hooks$2.showTagPopover();
        if (tagDelta === null) {
          return;
        }
      }
      const result = await sendBatch(classified, tagDelta);
      await handleSendResult(result, tagDelta);
    } finally {
      isInConfirmPipeline = false;
    }
  }
  function isTextInputElement(el) {
    if (!el) {
      return false;
    }
    if (el.isContentEditable === true) {
      return true;
    }
    return el.tagName === "TEXTAREA" || el.tagName === "INPUT" && ![
      "checkbox",
      "radio",
      "button",
      "submit",
      "image",
      "file",
      "range",
      "color"
    ].includes(el.type);
  }
  function getImageElement() {
    return document.getElementById("image");
  }
  const TOAST_PRESETS = {
    info: { className: "", duration: 2500 },
    success: { className: "dmna-toast-success", duration: 1800 },
    warning: { className: "dmna-toast-warning", duration: 3e3 },
    error: { className: "dmna-toast-error", duration: 4500 }
  };
  let toastElement = null;
  let toastMsgElement = null;
  let toastActionsElement = null;
  let toastTimer = null;
  function ensureToastDOM() {
    if (toastElement) {
      return;
    }
    toastElement = document.createElement("div");
    toastElement.id = "dmna-toast";
    toastMsgElement = document.createElement("div");
    toastMsgElement.className = "dmna-toast-msg";
    toastActionsElement = document.createElement("div");
    toastActionsElement.className = "dmna-toast-actions";
    toastElement.appendChild(toastMsgElement);
    toastElement.appendChild(toastActionsElement);
    document.body.appendChild(toastElement);
  }
  function showToast(msg, type = "info", err) {
    const preset = TOAST_PRESETS[type] || TOAST_PRESETS.info;
    ensureToastDOM();
    updateToastPosition();
    toastMsgElement.textContent = msg;
    toastActionsElement.textContent = "";
    toastElement.className = "";
    void toastElement.offsetWidth;
    toastElement.className = `show ${preset.className}`.trim();
    if (toastTimer) {
      clearTimeout(toastTimer);
    }
    toastTimer = setTimeout(() => {
      if (toastElement) {
        toastElement.className = "";
      }
    }, preset.duration);
    if (type === "error" || type === "warning") {
      const logFn = type === "error" ? console.error : console.warn;
      const tag = `[${SCRIPT_NAME}]`;
      if (err !== void 0) {
        logFn(tag, msg, err);
      } else {
        logFn(tag, msg);
      }
    }
  }
  function showToastWithActions(msg, actions) {
    ensureToastDOM();
    updateToastPosition();
    toastMsgElement.textContent = msg;
    toastActionsElement.textContent = "";
    for (const action of actions) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `dmna-toast-btn${action.primary ? " is-primary" : ""}`;
      btn.textContent = action.label;
      btn.addEventListener("click", () => {
        hideToast();
        action.onClick();
      });
      toastActionsElement.appendChild(btn);
    }
    toastElement.className = "";
    void toastElement.offsetWidth;
    toastElement.className = "show has-actions";
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
  }
  function hideToast() {
    if (toastElement) {
      toastElement.className = "";
    }
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
  }
  function updateToastPosition() {
    if (!toastElement) {
      return;
    }
    const vv = window.visualViewport;
    if (!vv) {
      const scrollX = window.pageXOffset;
      const scrollY = window.pageYOffset;
      toastElement.style.transform = `translate(${scrollX + window.innerWidth / 2}px, ${scrollY + window.innerHeight - TOAST_MARGIN_BOTTOM}px) translate(-50%, 0)`;
      return;
    }
    const invScale = 1 / vv.scale;
    const tx = vv.pageLeft + vv.width / 2;
    const ty = vv.pageTop + vv.height - TOAST_MARGIN_BOTTOM * invScale;
    toastElement.style.transform = `translate(${tx}px, ${ty}px) scale(${invScale}) translate(-50%, -100%)`;
  }
  const ICON_IDLE = "📝";
  const ICON_ACTIVE = "✏️";
  let floatBtnElement = null;
  const initialStoredX = parseInt(safeGetItem(POS_X_KEY) ?? "", 10);
  let userBtnMarginX = Number.isFinite(initialStoredX) ? initialStoredX : DEFAULT_BTN_MARGIN_X;
  const initialStoredY = parseInt(safeGetItem(POS_KEY) ?? "", 10);
  let userBtnMarginY = Number.isFinite(initialStoredY) ? initialStoredY : DEFAULT_BTN_MARGIN_Y;
  localStorage.removeItem(LEGACY_STATE_KEY);
  let nativeActiveHide = false;
  let isDraggingBtn = false;
  let isPressing = false;
  let longPressTimer = null;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragStartMarginX = 0;
  let dragStartMarginY = 0;
  let lastBtnTapTime = 0;
  function getButtonMargins() {
    return { marginX: userBtnMarginX, marginY: userBtnMarginY };
  }
  function setFloatingButtonIcon(icon) {
    if (floatBtnElement) {
      floatBtnElement.textContent = icon;
    }
  }
  function setFloatingButtonIconForMode() {
    setFloatingButtonIcon(getMode() === "active" ? ICON_ACTIVE : ICON_IDLE);
  }
  function createFloatingButton() {
    if (document.getElementById("dmna-float-btn")) {
      return;
    }
    const btn = document.createElement("div");
    btn.id = "dmna-float-btn";
    btn.textContent = ICON_IDLE;
    setupButtonInteractions(btn);
    document.body.appendChild(btn);
    floatBtnElement = btn;
    document.addEventListener("focus", () => updateHiddenState(), true);
    document.addEventListener(
      "blur",
      () => {
        setTimeout(updateHiddenState, 100);
      },
      true
    );
  }
  function updateHiddenState() {
    if (!floatBtnElement) {
      return;
    }
    const hide = isTextInputElement(document.activeElement) || nativeActiveHide;
    if (hide) {
      floatBtnElement.classList.add("dmna-hidden");
    } else {
      floatBtnElement.classList.remove("dmna-hidden");
    }
  }
  function setNativeActiveHide(active) {
    nativeActiveHide = active;
    updateHiddenState();
  }
  function updateFloatingButtonPosition() {
    if (!floatBtnElement) {
      return;
    }
    const vv = window.visualViewport;
    if (!vv) {
      const scrollX = window.pageXOffset;
      const scrollY = window.pageYOffset;
      const bx2 = scrollX + window.innerWidth - userBtnMarginX - BTN_SIZE;
      const by2 = scrollY + window.innerHeight - userBtnMarginY - BTN_SIZE;
      floatBtnElement.style.transform = `translate(${bx2}px, ${by2}px)`;
      return;
    }
    const invScale = 1 / vv.scale;
    const bx = vv.pageLeft + vv.width - (userBtnMarginX + BTN_SIZE) * invScale;
    const by = vv.pageTop + vv.height - (userBtnMarginY + BTN_SIZE) * invScale;
    floatBtnElement.style.transform = `translate(${bx}px, ${by}px) scale(${invScale})`;
  }
  function setupButtonInteractions(btn) {
    const handleStart = (e) => {
      if (e.type === "touchstart") {
        e.preventDefault();
      }
      isDraggingBtn = false;
      isPressing = true;
      const isTouch = e.type.startsWith("touch");
      const clientX = isTouch ? e.touches[0].clientX : e.clientX;
      const clientY = isTouch ? e.touches[0].clientY : e.clientY;
      dragStartX = clientX;
      dragStartY = clientY;
      dragStartMarginX = userBtnMarginX;
      dragStartMarginY = userBtnMarginY;
      longPressTimer = setTimeout(() => {
        if (isPressing) {
          isDraggingBtn = true;
          closeMenu();
          btn.classList.add("dragging");
          if (navigator.vibrate) {
            navigator.vibrate(50);
          }
          showToast("✥ Drag to reposition", "info");
        }
      }, LONG_PRESS_DURATION);
    };
    const handleMove = (e) => {
      if (e.type === "touchmove") {
        e.preventDefault();
        e.stopPropagation();
      }
      if (!isPressing) {
        return;
      }
      const isTouch = e.type.startsWith("touch");
      const clientX = isTouch ? e.touches[0].clientX : e.clientX;
      const clientY = isTouch ? e.touches[0].clientY : e.clientY;
      if (isDraggingBtn) {
        const dx2 = clientX - dragStartX;
        const dy2 = clientY - dragStartY;
        const screenW = window.innerWidth;
        const screenH = window.innerHeight;
        let newMarginX = dragStartMarginX - dx2;
        let newMarginY = dragStartMarginY - dy2;
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
    const handleEnd = (e) => {
      if (e.type === "touchend") {
        e.preventDefault();
      }
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
      isPressing = false;
      if (isDraggingBtn) {
        isDraggingBtn = false;
        btn.classList.remove("dragging");
        safeSetItem(POS_X_KEY, String(userBtnMarginX));
        safeSetItem(POS_KEY, String(userBtnMarginY));
      } else {
        const isTouch = e.type.startsWith("touch");
        const endX = isTouch ? e.changedTouches[0].clientX : e.clientX;
        const endY = isTouch ? e.changedTouches[0].clientY : e.clientY;
        const dx = endX - dragStartX;
        const dy = endY - dragStartY;
        if (Math.hypot(dx, dy) < 10) {
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
    btn.addEventListener("touchstart", handleStart, { passive: false });
    btn.addEventListener("touchmove", handleMove, { passive: false });
    btn.addEventListener("touchend", handleEnd);
    btn.addEventListener("mousedown", handleStart);
    document.addEventListener("mousemove", (e) => {
      if (isPressing) {
        handleMove(e);
      }
    });
    btn.addEventListener("mouseup", handleEnd);
  }
  let hooks$1 = null;
  function initArcMenu(h) {
    hooks$1 = h;
  }
  let menuElement = null;
  let isMenuOpen = false;
  let outsideClickListenerBound = false;
  function createArcMenu() {
    if (document.getElementById("dmna-menu")) {
      return;
    }
    const m = document.createElement("div");
    m.id = "dmna-menu";
    const items = [
      { action: "confirm", icon: "✅", label: "Confirm" },
      { action: "edit", icon: "✏️", label: "Edit" }
    ];
    const r = ARC_RADIUS;
    const itemSize = BTN_SIZE;
    const half = itemSize / 2;
    const center = BTN_SIZE / 2;
    const angleStart = ARC_CONFIRM_THETA;
    const stepAngle = -50 * Math.PI / 180;
    items.forEach((item, i) => {
      const theta = angleStart + stepAngle * i;
      const cx = center + r * Math.cos(theta);
      const cy = center + r * Math.sin(theta);
      const tx = cx - half;
      const ty = cy - half;
      const el = document.createElement("div");
      el.className = "dmna-menu-item";
      el.dataset.action = item.action;
      el.setAttribute("aria-label", item.label);
      el.textContent = item.icon;
      el.style.setProperty("--tx", `${tx}px`);
      el.style.setProperty("--ty", `${ty}px`);
      el.addEventListener("click", (e) => {
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
  function openMenu() {
    if (isMenuOpen || !menuElement) {
      return;
    }
    updateArcMenuPosition();
    isMenuOpen = true;
    menuElement.classList.add("open");
    const btn = document.getElementById("dmna-float-btn");
    if (btn) {
      btn.classList.add("expanded");
    }
    if (!outsideClickListenerBound) {
      document.addEventListener("click", outsideClickHandler, true);
      document.addEventListener("keydown", escHandler);
      outsideClickListenerBound = true;
    }
  }
  function closeMenu() {
    if (!isMenuOpen) {
      return;
    }
    isMenuOpen = false;
    if (menuElement) {
      menuElement.classList.remove("open");
    }
    const btn = document.getElementById("dmna-float-btn");
    if (btn) {
      btn.classList.remove("expanded");
    }
    if (outsideClickListenerBound) {
      document.removeEventListener("click", outsideClickHandler, true);
      document.removeEventListener("keydown", escHandler);
      outsideClickListenerBound = false;
    }
  }
  function toggleMenu() {
    if (isMenuOpen) {
      closeMenu();
    } else {
      openMenu();
    }
  }
  function updateArcMenuPosition() {
    if (!menuElement) {
      return;
    }
    const { marginX, marginY } = getButtonMargins();
    const vv = window.visualViewport;
    if (!vv) {
      const scrollX = window.pageXOffset;
      const scrollY = window.pageYOffset;
      const bx2 = scrollX + window.innerWidth - marginX - BTN_SIZE;
      const by2 = scrollY + window.innerHeight - marginY - BTN_SIZE;
      menuElement.style.transform = `translate(${bx2}px, ${by2}px)`;
      return;
    }
    const invScale = 1 / vv.scale;
    const bx = vv.pageLeft + vv.width - (marginX + BTN_SIZE) * invScale;
    const by = vv.pageTop + vv.height - (marginY + BTN_SIZE) * invScale;
    menuElement.style.transform = `translate(${bx}px, ${by}px) scale(${invScale})`;
  }
  function handleMenuAction(action) {
    switch (action) {
      case "edit":
        toggleEditMode();
        break;
      case "confirm":
        hooks$1.onConfirm();
        break;
    }
  }
  function outsideClickHandler(e) {
    const target = e.target;
    if (target instanceof Element && (target.closest("#dmna-menu") || target.closest("#dmna-float-btn"))) {
      return;
    }
    e.stopPropagation();
    closeMenu();
  }
  function escHandler(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeMenu();
    }
  }
  let viewportRaf = null;
  let pendingFn = null;
  function getInvScale() {
    return window.visualViewport ? 1 / window.visualViewport.scale : 1;
  }
  function scheduleVisualViewportUpdate(fn) {
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
  let hooks = null;
  function initNoteBox(h) {
    hooks = h;
  }
  function renderNoteBox(noteId, cachedRect) {
    const note = notes.get(noteId);
    if (!note) {
      return;
    }
    let el = note.domElement;
    if (!el) {
      el = createNoteBoxDOM(noteId);
      note.domElement = el;
    }
    let rect;
    if (cachedRect === void 0) {
      const img = getImageElement();
      rect = img ? getImageDisplayRect(img) : null;
    } else {
      rect = cachedRect;
    }
    if (rect) {
      const screen = imageToScreenRect(note.current, rect, getOriginalWidth());
      el.style.display = "";
      el.style.left = `${screen.left}px`;
      el.style.top = `${screen.top}px`;
      el.style.width = `${screen.width}px`;
      el.style.height = `${screen.height}px`;
      const triSize = Math.min(Math.min(screen.width, screen.height) / 6, 8);
      el.style.setProperty("--dmna-triangle-size", `${triSize}px`);
    } else {
      el.style.display = "none";
    }
    updateNoteVisuals(noteId);
  }
  function updateAllNoteBoxPositions() {
    const img = getImageElement();
    const rect = img ? getImageDisplayRect(img) : null;
    for (const id of notes.keys()) {
      renderNoteBox(id, rect);
    }
  }
  function removeNoteBoxDOM(noteId) {
    const note = notes.get(noteId);
    if (note && note.domElement) {
      note.domElement.remove();
      note.domElement = null;
    }
  }
  function updateNoteVisuals(noteId) {
    const note = notes.get(noteId);
    if (!note || !note.domElement) {
      return;
    }
    const el = note.domElement;
    el.classList.toggle("is-active", getActiveNoteId() === noteId);
    el.classList.toggle("is-deleted", note.isDeleted);
    el.classList.toggle("is-dirty", isDirty(note));
  }
  function updateActiveHandleScales() {
    const activeId = getActiveNoteId();
    if (activeId === null) {
      return;
    }
    const note = notes.get(activeId);
    if (!note || !note.domElement) {
      return;
    }
    note.domElement.style.setProperty(
      "--dmna-handle-scale",
      String(getInvScale())
    );
  }
  function createNoteBoxDOM(noteId) {
    const el = document.createElement("div");
    el.className = "dmna-note-box";
    el.dataset.noteId = noteId;
    el.addEventListener("click", (e) => {
      if (getMode() !== "active") {
        return;
      }
      e.stopPropagation();
      if (hooks.consumeBoxClickSuppression()) {
        return;
      }
      setActiveNote(noteId);
    });
    hooks.attachBodyDrag(el, noteId);
    const handleIcons = {
      nw: "↖",
      ne: "✥",
      sw: "✥",
      se: "↘"
    };
    ["nw", "ne", "sw", "se"].forEach((corner) => {
      const h = document.createElement("div");
      h.className = `dmna-handle dmna-handle-${corner}`;
      h.dataset.corner = corner;
      h.dataset.icon = handleIcons[corner];
      hooks.attachHandle(h, corner, noteId);
      el.appendChild(h);
    });
    document.body.appendChild(el);
    return el;
  }
  function parseStyleAttr(s) {
    const result = new Map();
    if (!s) return result;
    for (const decl of splitDeclarations(s)) {
      const colonIdx = findFirstUnquoted(decl, ":");
      if (colonIdx === -1) continue;
      const name = decl.slice(0, colonIdx).trim().toLowerCase();
      const value = decl.slice(colonIdx + 1).trim();
      if (!name || !value) continue;
      result.set(name, value);
    }
    return result;
  }
  function serializeStyleAttr(m) {
    const parts = [];
    for (const [k, v] of m) {
      if (!k || !v) continue;
      parts.push(`${k}: ${v}`);
    }
    return parts.join("; ");
  }
  function splitDeclarations(s) {
    const result = [];
    let depth = 0;
    let quote = null;
    let start = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (quote) {
        if (c === quote && s[i - 1] !== "\\") quote = null;
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === "(") {
        depth++;
      } else if (c === ")") {
        depth--;
      } else if (c === ";" && depth === 0) {
        const seg = s.slice(start, i).trim();
        if (seg) result.push(seg);
        start = i + 1;
      }
    }
    const last = s.slice(start).trim();
    if (last) result.push(last);
    return result;
  }
  function findFirstUnquoted(s, target) {
    let depth = 0;
    let quote = null;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (quote) {
        if (c === quote && s[i - 1] !== "\\") quote = null;
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === "(") {
        depth++;
      } else if (c === ")") {
        depth--;
      } else if (c === target && depth === 0) {
        return i;
      }
    }
    return -1;
  }
  function listenDocumentTap(onTap) {
    let startX = 0;
    let startY = 0;
    let tracking = false;
    let dragged = false;
    const onPointerDown = (e) => {
      startX = e.clientX;
      startY = e.clientY;
      tracking = true;
      dragged = false;
    };
    const onPointerMove = (e) => {
      if (!tracking || dragged) return;
      const vv = window.visualViewport;
      const visScale = vv ? vv.scale : 1;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.hypot(dx, dy) * visScale > DRAG_THRESHOLD_PX) {
        dragged = true;
      }
    };
    const onPointerUp = (e) => {
      if (tracking && !dragged) {
        onTap(e);
      }
      tracking = false;
      dragged = false;
    };
    const onPointerCancel = () => {
      tracking = false;
      dragged = false;
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointermove", onPointerMove, true);
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("pointercancel", onPointerCancel, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointermove", onPointerMove, true);
      document.removeEventListener("pointerup", onPointerUp, true);
      document.removeEventListener("pointercancel", onPointerCancel, true);
    };
  }
  const SWATCHES$1 = [
    "#000000",
    "#FFFFFF",
    "#E53935",
    "#EC407A",
    "#AB47BC",
    "#5C6BC0",
    "#1E88E5",
    "#00ACC1",
    "#43A047",
    "#9CCC65",
    "#FDD835",
    "#FB8C00",
    "#8D6E63",
    "#757575"
  ];
  const HEX_RE$1 = /^#?[0-9a-fA-F]{6}$/;
  const THICKNESS_OPTIONS = [1, 2, 3];
  const SIDES = ["top", "right", "bottom", "left"];
  let modalElement$3 = null;
  let overlayElement$3 = null;
  let hexInput$1 = null;
  let applyButton$1 = null;
  let advancedSection = null;
  let advancedToggle = null;
  const thicknessButtons = new Map();
  const sideCheckboxes = new Map();
  let onConfirmCallback$3 = null;
  let isShown$4 = false;
  let isAdvancedOpen = false;
  let selectedThickness = 1;
  let suppressNextClick$3 = false;
  function normalizeHex$1(input) {
    const trimmed = input.trim();
    if (!HEX_RE$1.test(trimmed)) return null;
    return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  }
  function buildTextShadow(color) {
    const t = selectedThickness;
    const activeSides = [];
    for (const s of SIDES) {
      if (sideCheckboxes.get(s)?.checked) activeSides.push(s);
    }
    if (activeSides.length === 0) return "";
    const shadows = activeSides.map((side) => {
      switch (side) {
        case "top":
          return `0 -${t}px 0 ${color}`;
        case "right":
          return `${t}px 0 0 ${color}`;
        case "bottom":
          return `0 ${t}px 0 ${color}`;
        case "left":
          return `-${t}px 0 0 ${color}`;
      }
    });
    return shadows.join(", ");
  }
  function refreshApplyState$1() {
    if (!applyButton$1 || !hexInput$1) return;
    const valid = normalizeHex$1(hexInput$1.value) !== null;
    applyButton$1.disabled = !valid;
    hexInput$1.classList.toggle("is-invalid", !valid && hexInput$1.value !== "");
  }
  function setAdvancedOpen(open) {
    isAdvancedOpen = open;
    if (advancedSection) {
      advancedSection.classList.toggle("is-open", open);
    }
    if (advancedToggle) {
      advancedToggle.textContent = open ? "Advanced ▴" : "Advanced ▾";
    }
  }
  function setThickness(t) {
    selectedThickness = t;
    for (const [thickness, btn] of thicknessButtons) {
      btn.classList.toggle("is-active", thickness === t);
    }
  }
  function resetState() {
    if (!hexInput$1 || !applyButton$1) return;
    hexInput$1.value = "";
    hexInput$1.classList.remove("is-invalid");
    applyButton$1.disabled = true;
    setAdvancedOpen(false);
    setThickness(1);
    for (const cb of sideCheckboxes.values()) {
      cb.checked = true;
    }
  }
  function hideStrokePicker() {
    if (!modalElement$3 || !overlayElement$3) return;
    modalElement$3.classList.remove("show");
    overlayElement$3.classList.remove("show");
    isShown$4 = false;
    onConfirmCallback$3 = null;
  }
  function commitStroke(color) {
    const shadow = buildTextShadow(color);
    const callback = onConfirmCallback$3;
    hideStrokePicker();
    if (callback && shadow) {
      callback(shadow);
    } else {
      restoreTextareaSelection$3();
    }
  }
  function commitRemove() {
    const callback = onConfirmCallback$3;
    hideStrokePicker();
    if (callback) {
      callback("");
    } else {
      restoreTextareaSelection$3();
    }
  }
  function restoreTextareaSelection$3() {
    const ta = getPopoverInputElement();
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(ta.selectionStart, ta.selectionEnd);
  }
  function handleCancel$3() {
    hideStrokePicker();
    restoreTextareaSelection$3();
  }
  function onOutsideTap$3(e) {
    if (!isShown$4 || !modalElement$3) return;
    const target = e.target;
    if (!target) return;
    if (modalElement$3.contains(target)) return;
    if (target.closest(
      ".dmna-style-color-text, .dmna-style-color-stroke, .dmna-style-color-bg"
    )) {
      return;
    }
    hideStrokePicker();
    restoreTextareaSelection$3();
    const notePop = document.getElementById("dmna-popover");
    const stylePop = document.getElementById("dmna-style-popover");
    const inNote = !!notePop?.contains(target);
    const inStyle = !!stylePop?.contains(target);
    if (!inNote && !inStyle) {
      e.preventDefault();
      e.stopPropagation();
      suppressNextClick$3 = true;
      window.setTimeout(() => {
        suppressNextClick$3 = false;
      }, 500);
    }
  }
  function onOutsideClick$3(e) {
    if (!suppressNextClick$3) return;
    suppressNextClick$3 = false;
    e.preventDefault();
    e.stopPropagation();
  }
  function handleHexApply$1() {
    if (!hexInput$1) return;
    const color = normalizeHex$1(hexInput$1.value);
    if (!color) return;
    commitStroke(color);
  }
  function createStrokePicker() {
    if (modalElement$3 && overlayElement$3) return;
    const host = document.getElementById("dmna-popover");
    if (!host) return;
    const overlay = document.createElement("div");
    overlay.id = "dmna-stroke-overlay";
    overlay.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    overlay.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleCancel$3();
    });
    const modal = document.createElement("div");
    modal.id = "dmna-stroke-modal";
    const grid = document.createElement("div");
    grid.id = "dmna-stroke-swatches";
    const transparent = document.createElement("button");
    transparent.type = "button";
    transparent.className = "dmna-color-swatch dmna-color-swatch-transparent";
    transparent.dataset.color = "transparent";
    transparent.setAttribute("aria-label", "Remove stroke");
    transparent.addEventListener("mousedown", (e) => e.preventDefault());
    transparent.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      commitRemove();
    });
    grid.appendChild(transparent);
    for (const hex of SWATCHES$1) {
      const sw = document.createElement("button");
      sw.type = "button";
      sw.className = "dmna-color-swatch";
      sw.style.background = hex;
      sw.dataset.color = hex;
      sw.setAttribute("aria-label", `Pick ${hex} stroke`);
      sw.addEventListener("mousedown", (e) => e.preventDefault());
      sw.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        commitStroke(hex);
      });
      grid.appendChild(sw);
    }
    modal.appendChild(grid);
    const inputRow = document.createElement("div");
    inputRow.id = "dmna-stroke-input-row";
    const input = document.createElement("input");
    input.type = "text";
    input.id = "dmna-stroke-hex";
    input.placeholder = "#RRGGBB";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.maxLength = 7;
    input.addEventListener("input", refreshApplyState$1);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing) {
        e.preventDefault();
        e.stopPropagation();
        handleHexApply$1();
      }
    });
    inputRow.appendChild(input);
    const apply = document.createElement("button");
    apply.type = "button";
    apply.id = "dmna-stroke-apply";
    apply.textContent = "✔";
    apply.setAttribute("aria-label", "Apply HEX stroke color");
    apply.disabled = true;
    apply.addEventListener("mousedown", (e) => e.preventDefault());
    apply.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleHexApply$1();
    });
    inputRow.appendChild(apply);
    modal.appendChild(inputRow);
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.id = "dmna-stroke-advanced-toggle";
    toggle.addEventListener("mousedown", (e) => e.preventDefault());
    toggle.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      setAdvancedOpen(!isAdvancedOpen);
    });
    modal.appendChild(toggle);
    const advanced = document.createElement("div");
    advanced.id = "dmna-stroke-advanced";
    const thicknessRow = document.createElement("div");
    thicknessRow.className = "dmna-stroke-advanced-row";
    const thicknessLabel = document.createElement("span");
    thicknessLabel.className = "dmna-stroke-advanced-label";
    thicknessLabel.textContent = "Thickness";
    thicknessRow.appendChild(thicknessLabel);
    const thicknessGroup = document.createElement("div");
    thicknessGroup.className = "dmna-stroke-thickness-group";
    for (const t of THICKNESS_OPTIONS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "dmna-stroke-thickness-btn";
      btn.textContent = `${t}px`;
      btn.dataset.thickness = String(t);
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        setThickness(t);
      });
      thicknessButtons.set(t, btn);
      thicknessGroup.appendChild(btn);
    }
    thicknessRow.appendChild(thicknessGroup);
    advanced.appendChild(thicknessRow);
    const sidesRow = document.createElement("div");
    sidesRow.className = "dmna-stroke-advanced-row";
    const sidesLabel = document.createElement("span");
    sidesLabel.className = "dmna-stroke-advanced-label";
    sidesLabel.textContent = "Sides";
    sidesRow.appendChild(sidesLabel);
    const sidesGroup = document.createElement("div");
    sidesGroup.className = "dmna-stroke-sides-group";
    for (const side of SIDES) {
      const lbl = document.createElement("label");
      lbl.className = "dmna-stroke-side-label";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = true;
      cb.dataset.side = side;
      cb.addEventListener("mousedown", (e) => e.preventDefault());
      sideCheckboxes.set(side, cb);
      lbl.appendChild(cb);
      const txt = document.createElement("span");
      txt.textContent = side;
      lbl.appendChild(txt);
      sidesGroup.appendChild(lbl);
    }
    sidesRow.appendChild(sidesGroup);
    advanced.appendChild(sidesRow);
    modal.appendChild(advanced);
    host.appendChild(overlay);
    host.appendChild(modal);
    overlayElement$3 = overlay;
    modalElement$3 = modal;
    hexInput$1 = input;
    applyButton$1 = apply;
    advancedSection = advanced;
    advancedToggle = toggle;
    setThickness(1);
    setAdvancedOpen(false);
    listenDocumentTap(onOutsideTap$3);
    document.addEventListener("click", onOutsideClick$3, true);
  }
  function showStrokePicker(onConfirm) {
    hideColorPicker();
    hideLinkPopover();
    hideRubyPopover();
    createStrokePicker();
    if (!modalElement$3 || !overlayElement$3 || !hexInput$1) return;
    resetState();
    onConfirmCallback$3 = onConfirm;
    overlayElement$3.classList.add("show");
    modalElement$3.classList.add("show");
    isShown$4 = true;
    hexInput$1.focus();
  }
  function isStrokePickerShown() {
    return isShown$4;
  }
  let modalElement$2 = null;
  let overlayElement$2 = null;
  let readingInput = null;
  let onConfirmCallback$2 = null;
  let isShown$3 = false;
  let suppressNextClick$2 = false;
  function hideRubyPopover() {
    if (!modalElement$2 || !overlayElement$2) return;
    modalElement$2.classList.remove("show");
    overlayElement$2.classList.remove("show");
    isShown$3 = false;
    onConfirmCallback$2 = null;
  }
  function restoreTextareaSelection$2() {
    const ta = getPopoverInputElement();
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(ta.selectionStart, ta.selectionEnd);
  }
  function handleConfirm$1() {
    if (!readingInput) return;
    const reading = readingInput.value.trim();
    const callback = onConfirmCallback$2;
    hideRubyPopover();
    if (reading && callback) {
      callback(reading);
    } else {
      restoreTextareaSelection$2();
    }
  }
  function handleCancel$2() {
    hideRubyPopover();
    restoreTextareaSelection$2();
  }
  function onOutsideTap$2(e) {
    if (!isShown$3 || !modalElement$2) return;
    const target = e.target;
    if (!target) return;
    if (modalElement$2.contains(target)) return;
    if (target.closest(".dmna-style-btn-ruby")) {
      return;
    }
    hideRubyPopover();
    restoreTextareaSelection$2();
    const notePop = document.getElementById("dmna-popover");
    const stylePop = document.getElementById("dmna-style-popover");
    const inNote = !!notePop?.contains(target);
    const inStyle = !!stylePop?.contains(target);
    if (!inNote && !inStyle) {
      e.preventDefault();
      e.stopPropagation();
      suppressNextClick$2 = true;
      window.setTimeout(() => {
        suppressNextClick$2 = false;
      }, 500);
    }
  }
  function onOutsideClick$2(e) {
    if (!suppressNextClick$2) return;
    suppressNextClick$2 = false;
    e.preventDefault();
    e.stopPropagation();
  }
  function createRubyPopover() {
    if (modalElement$2 && overlayElement$2) {
      return;
    }
    const host = document.getElementById("dmna-popover");
    if (!host) {
      return;
    }
    const overlay = document.createElement("div");
    overlay.id = "dmna-ruby-overlay";
    overlay.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    overlay.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleCancel$2();
    });
    const modal = document.createElement("div");
    modal.id = "dmna-ruby-modal";
    const input = document.createElement("input");
    input.type = "text";
    input.id = "dmna-ruby-modal-input";
    input.placeholder = "Reading (furigana)";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing) {
        e.preventDefault();
        e.stopPropagation();
        handleConfirm$1();
      }
    });
    modal.appendChild(input);
    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.id = "dmna-ruby-modal-confirm";
    confirmBtn.textContent = "✔";
    confirmBtn.setAttribute("aria-label", "Confirm reading");
    confirmBtn.addEventListener("mousedown", (e) => e.preventDefault());
    confirmBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleConfirm$1();
    });
    modal.appendChild(confirmBtn);
    host.appendChild(overlay);
    host.appendChild(modal);
    overlayElement$2 = overlay;
    modalElement$2 = modal;
    readingInput = input;
    listenDocumentTap(onOutsideTap$2);
    document.addEventListener("click", onOutsideClick$2, true);
  }
  function showRubyPopover(onConfirm) {
    hideColorPicker();
    hideLinkPopover();
    hideStrokePicker();
    createRubyPopover();
    if (!modalElement$2 || !overlayElement$2 || !readingInput) return;
    readingInput.value = "";
    onConfirmCallback$2 = onConfirm;
    overlayElement$2.classList.add("show");
    modalElement$2.classList.add("show");
    isShown$3 = true;
    readingInput.focus();
  }
  function isRubyPopoverShown() {
    return isShown$3;
  }
  const STYLE_POPOVER_WIDTH = 260;
  const STYLE_POPOVER_GAP = 8;
  const STYLE_POPOVER_MOBILE_BREAKPOINT = 600;
  const ROW_1_BUTTONS = [
    { tag: "b", label: "B", className: "dmna-style-btn-bold", tooltip: "Bold" },
    { tag: "i", label: "I", className: "dmna-style-btn-italic", tooltip: "Italic" },
    {
      tag: "u",
      label: "U",
      className: "dmna-style-btn-underline",
      tooltip: "Underline"
    }
  ];
  const ROW_2_BUTTONS = [
    {
      tag: "s",
      label: "S",
      className: "dmna-style-btn-strike",
      tooltip: "Strikethrough"
    },
    {
      tag: "sub",
      label: "sub",
      className: "dmna-style-btn-sub",
      tooltip: "Subscript"
    },
    {
      tag: "sup",
      label: "sup",
      className: "dmna-style-btn-sup",
      tooltip: "Superscript"
    }
  ];
  const ROW_3_BUTTONS = [
    {
      tag: "tn",
      label: "TL note",
      className: "dmna-style-btn-tn",
      tooltip: "Translator note"
    },
    {
      tag: "code",
      label: "code",
      className: "dmna-style-btn-code",
      tooltip: "Code"
    }
  ];
  const ROW_4_BUTTONS = [
    { tag: "a", label: "link", className: "dmna-style-btn-link", tooltip: "Link" },
    {
      tag: "ruby",
      label: "ruby",
      className: "dmna-style-btn-ruby",
      tooltip: "Ruby (furigana)"
    }
  ];
  const SIZE_OPTIONS = [
    { label: "−2", value: "70%" },
    { label: "−1", value: "85%" },
    { label: "Default", value: "normal" },
    { label: "+1", value: "125%" },
    { label: "+2", value: "150%" },
    { label: "+3", value: "200%" }
  ];
  const FONT_OPTIONS = [


{ label: "Default", value: "" },
    { label: "comic", value: "comic", preview: "comic" },
    { label: "narrow", value: "narrow", preview: "narrow" },
    { label: "mono", value: "mono", preview: "mono" },
    { label: "slab sans", value: '"slab sans"', preview: '"slab sans"' },
    { label: "slab serif", value: '"slab serif"', preview: '"slab serif"' },
    {
      label: "formal serif",
      value: '"formal serif"',
      preview: '"formal serif"'
    },
    {
      label: "formal cursive",
      value: '"formal cursive"',
      preview: '"formal cursive"'
    },
    { label: "print", value: "print", preview: "print" },
    { label: "hand", value: "hand", preview: "hand" },
    { label: "childlike", value: "childlike", preview: "childlike" },
    { label: "blackletter", value: "blackletter", preview: "blackletter" },
    { label: "scary", value: "scary", preview: "scary" }
  ];
  let stylePopoverElement = null;
  let isShown$2 = false;
  function detectOuterLayers(before, after) {
    const layers = [];
    let bLen = before.length;
    let consumedAfter = 0;
    while (true) {
      const slice = before.slice(0, bLen);
      const openMatch = slice.match(/<([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^<>]*)?)>$/);
      if (!openMatch) {
        break;
      }
      const tag = openMatch[1].toLowerCase();
      const attrs = openMatch[2];
      const expectedClose = `</${tag}>`;
      if (!after.startsWith(expectedClose, consumedAfter)) {
        break;
      }
      const openStart = bLen - openMatch[0].length;
      const layer = {
        tag,
        attrs,
        openStart,
        openLen: openMatch[0].length,
        closeStart: consumedAfter,
        closeLen: expectedClose.length
      };
      const styleStr = extractStyleAttr(attrs);
      if (styleStr !== null) {
        layer.styleProps = parseStyleAttr(styleStr);
      }
      layers.push(layer);
      bLen = openStart;
      consumedAfter += expectedClose.length;
    }
    return layers;
  }
  function extractStyleAttr(attrs) {
    const dq = attrs.match(/\bstyle\s*=\s*"([^"]*)"/i);
    if (dq) return dq[1];
    const sq = attrs.match(/\bstyle\s*=\s*'([^']*)'/i);
    if (sq) return sq[1];
    return null;
  }
  function getActiveStyleSnapshot() {
    const spanProps = new Map();
    const divProps = new Map();
    const ta = getPopoverInputElement();
    if (!ta || ta.selectionStart === ta.selectionEnd) {
      return { spanProps, divProps };
    }
    const before = ta.value.slice(0, ta.selectionStart);
    const after = ta.value.slice(ta.selectionEnd);
    const layers = detectOuterLayers(before, after);
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i];
      if (!layer.styleProps) continue;
      let target;
      if (layer.tag === "span") {
        target = spanProps;
      } else if (layer.tag === "div") {
        target = divProps;
      } else {
        target = null;
      }
      if (!target) continue;
      for (const [k, v] of layer.styleProps) {
        target.set(k, v);
      }
    }
    return { spanProps, divProps };
  }
  function stripStyleAttr(attrs) {
    return attrs.replace(/\s*\bstyle\s*=\s*"[^"]*"/i, "").replace(/\s*\bstyle\s*=\s*'[^']*'/i, "");
  }
  function buildOpenTag(tag, attrs, styleMap) {
    const cleaned = stripStyleAttr(attrs);
    const styleStr = serializeStyleAttr(styleMap);
    if (!styleStr) {
      return `<${tag}${cleaned}>`;
    }
    return `<${tag}${cleaned} style="${styleStr}">`;
  }
  function captureUndoSnapshot(ta) {
    const noteId = getActiveNoteId();
    if (!noteId) return;
    pushTextAction(noteId, {
      text: ta.value,
      selectionStart: ta.selectionStart,
      selectionEnd: ta.selectionEnd
    });
  }
  function applySpanStyle(prop, value) {
    const ta = getPopoverInputElement();
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    if (start === end) return;
    captureUndoSnapshot(ta);
    const before = ta.value.slice(0, start);
    const after = ta.value.slice(end);
    const layers = detectOuterLayers(before, after);
    const innerSpan = layers.find((l) => l.tag === "span");
    if (innerSpan) {
      const newProps = new Map(innerSpan.styleProps ?? []);
      newProps.set(prop, value);
      const newOpen = buildOpenTag("span", innerSpan.attrs, newProps);
      const openEnd = innerSpan.openStart + innerSpan.openLen;
      ta.value = ta.value.slice(0, innerSpan.openStart) + newOpen + ta.value.slice(openEnd);
      const lenDelta = newOpen.length - innerSpan.openLen;
      ta.setSelectionRange(start + lenDelta, end + lenDelta);
    } else {
      const selected = ta.value.slice(start, end);
      const open = `<span style="${prop}: ${value}">`;
      const close = "</span>";
      ta.value = before + open + selected + close + after;
      ta.setSelectionRange(start + open.length, end + open.length);
    }
    ta.focus();
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    refreshStylePopoverState();
  }
  function removeSpanStyle(prop) {
    const ta = getPopoverInputElement();
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    if (start === end) return;
    const before = ta.value.slice(0, start);
    const after = ta.value.slice(end);
    const layers = detectOuterLayers(before, after);
    const target = layers.find((l) => l.tag === "span" && l.styleProps?.has(prop));
    if (!target) return;
    captureUndoSnapshot(ta);
    const newProps = new Map(target.styleProps);
    newProps.delete(prop);
    const closeAbsStart = end + target.closeStart;
    const closeAbsEnd = closeAbsStart + target.closeLen;
    const openEnd = target.openStart + target.openLen;
    if (newProps.size === 0 && stripStyleAttr(target.attrs).trim() === "") {
      ta.value = ta.value.slice(0, target.openStart) + ta.value.slice(openEnd, closeAbsStart) + ta.value.slice(closeAbsEnd);
      ta.setSelectionRange(start - target.openLen, end - target.openLen);
    } else {
      const newOpen = buildOpenTag("span", target.attrs, newProps);
      ta.value = ta.value.slice(0, target.openStart) + newOpen + ta.value.slice(openEnd);
      const lenDelta = newOpen.length - target.openLen;
      ta.setSelectionRange(start + lenDelta, end + lenDelta);
    }
    ta.focus();
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    refreshStylePopoverState();
  }
  function applyWrap(tag) {
    const ta = getPopoverInputElement();
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    if (start === end) return;
    captureUndoSnapshot(ta);
    const open = `<${tag}>`;
    const close = `</${tag}>`;
    const before = ta.value.slice(0, start);
    const selected = ta.value.slice(start, end);
    const after = ta.value.slice(end);
    ta.value = before + open + selected + close + after;
    ta.setSelectionRange(start + open.length, end + open.length);
    ta.focus();
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    refreshStylePopoverState();
  }
  function applyUnwrap(tag) {
    const ta = getPopoverInputElement();
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    if (start === end) return;
    const before = ta.value.slice(0, start);
    const selected = ta.value.slice(start, end);
    const after = ta.value.slice(end);
    const layers = detectOuterLayers(before, after);
    const found = layers.find((l) => l.tag === tag);
    if (!found) return;
    captureUndoSnapshot(ta);
    const newBefore = before.slice(0, found.openStart) + before.slice(found.openStart + found.openLen);
    const newAfter = after.slice(0, found.closeStart) + after.slice(found.closeStart + found.closeLen);
    ta.value = newBefore + selected + newAfter;
    ta.setSelectionRange(newBefore.length, newBefore.length + selected.length);
    ta.focus();
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    refreshStylePopoverState();
  }
  function handleLinkClick() {
    const ta = getPopoverInputElement();
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    if (start === end) return;
    showLinkPopover((url) => applyLinkWrap(start, end, url));
  }
  function handleRubyClick() {
    const ta = getPopoverInputElement();
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    if (start === end) return;
    showRubyPopover((reading) => applyRubyWrap(start, end, reading));
  }
  function applyRubyWrap(start, end, reading) {
    const ta = getPopoverInputElement();
    if (!ta) return;
    const safeReading = reading.replace(/[<>"]/g, "");
    captureUndoSnapshot(ta);
    const open = "<ruby>";
    const close = "</ruby>";
    const rt = `<rt>${safeReading}</rt>`;
    const before = ta.value.slice(0, start);
    const selected = ta.value.slice(start, end);
    const after = ta.value.slice(end);
    const inner = selected + rt;
    ta.value = before + open + inner + close + after;
    ta.setSelectionRange(start + open.length, start + open.length + inner.length);
    ta.focus();
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    refreshStylePopoverState();
  }
  function applyRubyUnwrap() {
    const ta = getPopoverInputElement();
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    if (start === end) return;
    const before = ta.value.slice(0, start);
    const selected = ta.value.slice(start, end);
    const after = ta.value.slice(end);
    const layers = detectOuterLayers(before, after);
    const found = layers.find((l) => l.tag === "ruby");
    if (!found) return;
    captureUndoSnapshot(ta);
    const base = selected.replace(/<rt\b[^>]*>[\s\S]*?<\/rt>/gi, "");
    const newBefore = before.slice(0, found.openStart) + before.slice(found.openStart + found.openLen);
    const newAfter = after.slice(0, found.closeStart) + after.slice(found.closeStart + found.closeLen);
    ta.value = newBefore + base + newAfter;
    ta.setSelectionRange(newBefore.length, newBefore.length + base.length);
    ta.focus();
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    refreshStylePopoverState();
  }
  function applyLinkWrap(start, end, url) {
    const ta = getPopoverInputElement();
    if (!ta) return;
    captureUndoSnapshot(ta);
    const open = `<a href="${url}">`;
    const close = "</a>";
    const before = ta.value.slice(0, start);
    const selected = ta.value.slice(start, end);
    const after = ta.value.slice(end);
    ta.value = before + open + selected + close + after;
    ta.setSelectionRange(start + open.length, end + open.length);
    ta.focus();
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    refreshStylePopoverState();
  }
  function buildTagRow(buttons) {
    const row = document.createElement("div");
    row.className = `dmna-style-row dmna-style-row-${buttons.length}`;
    for (const btn of buttons) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `dmna-style-btn ${btn.className}`;
      b.textContent = btn.label;
      b.dataset.tag = btn.tag;
      b.setAttribute("aria-label", `Wrap selection with <${btn.tag}>`);
      b.title = btn.tooltip;
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (b.classList.contains("is-active")) {
          if (btn.tag === "ruby") {
            applyRubyUnwrap();
          } else {
            applyUnwrap(btn.tag);
          }
        } else if (btn.tag === "a") {
          if (isLinkPopoverShown()) {
            hideLinkPopover();
          } else {
            handleLinkClick();
          }
        } else if (btn.tag === "ruby") {
          if (isRubyPopoverShown()) {
            hideRubyPopover();
          } else {
            handleRubyClick();
          }
        } else {
          applyWrap(btn.tag);
        }
      });
      row.appendChild(b);
    }
    return row;
  }
  function buildColorRow() {
    const row = document.createElement("div");
    row.className = "dmna-style-row dmna-style-row-3";
    const text = document.createElement("button");
    text.type = "button";
    text.className = "dmna-style-btn dmna-style-color-text";
    text.dataset.control = "color-text";
    text.setAttribute("aria-label", "Pick text color");
    text.title = "Text color";
    const textLabel = document.createElement("span");
    textLabel.className = "dmna-style-color-label";
    textLabel.textContent = "Text";
    const textSwatch = document.createElement("span");
    textSwatch.className = "dmna-style-color-swatch";
    textSwatch.style.background = "#000";
    text.appendChild(textLabel);
    text.appendChild(textSwatch);
    text.addEventListener("mousedown", (e) => e.preventDefault());
    text.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (isColorPickerShown() && getColorPickerTarget() === "text") {
        hideColorPicker();
        return;
      }
      showColorPicker("text", (color) => {
        if (color) {
          applySpanStyle("color", color);
        } else {
          removeSpanStyle("color");
        }
      });
    });
    const stroke = document.createElement("button");
    stroke.type = "button";
    stroke.className = "dmna-style-btn dmna-style-color-stroke";
    stroke.dataset.control = "color-stroke";
    stroke.setAttribute("aria-label", "Pick stroke (outline) color");
    stroke.title = "Stroke color";
    const strokeLabel = document.createElement("span");
    strokeLabel.className = "dmna-style-color-label";
    strokeLabel.textContent = "Strk";
    const strokeSwatch = document.createElement("span");
    strokeSwatch.className = "dmna-style-color-swatch dmna-style-color-transparent";
    stroke.appendChild(strokeLabel);
    stroke.appendChild(strokeSwatch);
    stroke.addEventListener("mousedown", (e) => e.preventDefault());
    stroke.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (isStrokePickerShown()) {
        hideStrokePicker();
        return;
      }
      showStrokePicker((textShadow) => {
        if (textShadow) {
          applySpanStyle("text-shadow", textShadow);
        } else {
          removeSpanStyle("text-shadow");
        }
      });
    });
    const bg = document.createElement("button");
    bg.type = "button";
    bg.className = "dmna-style-btn dmna-style-color-bg";
    bg.dataset.control = "color-bg";
    bg.setAttribute("aria-label", "Pick background color");
    bg.title = "Background color";
    const bgLabel = document.createElement("span");
    bgLabel.className = "dmna-style-color-label";
    bgLabel.textContent = "BG";
    const bgSwatch = document.createElement("span");
    bgSwatch.className = "dmna-style-color-swatch dmna-style-color-transparent";
    bg.appendChild(bgLabel);
    bg.appendChild(bgSwatch);
    bg.addEventListener("mousedown", (e) => e.preventDefault());
    bg.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (isColorPickerShown() && getColorPickerTarget() === "bg") {
        hideColorPicker();
        return;
      }
      showColorPicker("bg", (color) => {
        if (color) {
          applySpanStyle("background-color", color);
        } else {
          removeSpanStyle("background-color");
        }
      });
    });
    row.appendChild(text);
    row.appendChild(stroke);
    row.appendChild(bg);
    return row;
  }
  function buildSelectControl(control, options) {
    const select = document.createElement("select");
    select.className = "dmna-style-select";
    select.dataset.control = control;
    for (const opt of options) {
      const o = document.createElement("option");
      o.textContent = opt.label;
      o.value = opt.value;
      if (opt.preview) {
        o.style.fontFamily = opt.preview;
      }
      select.appendChild(o);
    }
    select.addEventListener("change", () => {
      handleSelectChange(control, select.value);
      refreshStylePopoverState();
    });
    select.addEventListener("blur", () => {
      const ta = getPopoverInputElement();
      if (ta) {
        ta.focus();
        ta.setSelectionRange(ta.selectionStart, ta.selectionEnd);
      }
    });
    return select;
  }
  function handleSelectChange(control, value) {
    if (control === "size") {
      if (value === "normal") {
        removeSpanStyle("font-size");
      } else if (value) {
        applySpanStyle("font-size", value);
      }
    } else if (control === "font") {
      if (value) {
        applySpanStyle("font-family", value);
      } else {
        removeSpanStyle("font-family");
      }
    }
  }
  function buildLabeledSelectRow(label, control) {
    const row = document.createElement("div");
    row.className = "dmna-style-labeled-select-row";
    const lab = document.createElement("span");
    lab.className = "dmna-style-select-label";
    lab.textContent = label;
    row.appendChild(lab);
    row.appendChild(control);
    return row;
  }
  function createStylePopover() {
    if (stylePopoverElement) {
      return;
    }
    const root = document.createElement("div");
    root.id = "dmna-style-popover";
    const inner = document.createElement("div");
    inner.id = "dmna-style-popover-inner";
    inner.appendChild(buildTagRow(ROW_1_BUTTONS));
    inner.appendChild(buildTagRow(ROW_2_BUTTONS));
    inner.appendChild(buildTagRow(ROW_3_BUTTONS));
    inner.appendChild(buildTagRow(ROW_4_BUTTONS));
    inner.appendChild(buildColorRow());
    inner.appendChild(
      buildLabeledSelectRow("Size", buildSelectControl("size", SIZE_OPTIONS))
    );
    inner.appendChild(
      buildLabeledSelectRow("Font", buildSelectControl("font", FONT_OPTIONS))
    );
    root.appendChild(inner);
    document.body.appendChild(root);
    stylePopoverElement = root;
    refreshStylePopoverState();
  }
  function refreshStylePopoverState() {
    if (!stylePopoverElement) return;
    if (getIsPreviewMode()) {
      stylePopoverElement.querySelectorAll(".dmna-style-btn, .dmna-style-select").forEach((el) => {
        el.disabled = true;
      });
      stylePopoverElement.querySelectorAll(".is-active").forEach((el) => el.classList.remove("is-active"));
      return;
    }
    const ta = getPopoverInputElement();
    const hasSelection = !!ta && ta.selectionStart !== ta.selectionEnd && !ta.disabled;
    stylePopoverElement.querySelectorAll(".dmna-style-btn, .dmna-style-select").forEach((el) => {
      el.disabled = !hasSelection;
    });
    if (!hasSelection || !ta) {
      stylePopoverElement.querySelectorAll(".is-active").forEach((el) => el.classList.remove("is-active"));
      if (!isColorPickerShown() && !isStrokePickerShown() && !isLinkPopoverShown() && !isRubyPopoverShown()) {
        hideStylePopover();
      }
      return;
    }
    const before = ta.value.slice(0, ta.selectionStart);
    const after = ta.value.slice(ta.selectionEnd);
    const activeTags = new Set(detectOuterLayers(before, after).map((l) => l.tag));
    stylePopoverElement.querySelectorAll(".dmna-style-btn[data-tag]").forEach((el) => {
      const tag = el.dataset.tag;
      el.classList.toggle("is-active", !!tag && activeTags.has(tag));
    });
    const { spanProps } = getActiveStyleSnapshot();
    const textSwatch = stylePopoverElement.querySelector(
      ".dmna-style-color-text .dmna-style-color-swatch"
    );
    if (textSwatch) {
      const color = spanProps.get("color");
      textSwatch.style.background = color ?? "#000";
    }
    const bgSwatch = stylePopoverElement.querySelector(
      ".dmna-style-color-bg .dmna-style-color-swatch"
    );
    if (bgSwatch) {
      const bg = spanProps.get("background-color");
      if (bg) {
        bgSwatch.style.background = bg;
        bgSwatch.classList.remove("dmna-style-color-transparent");
      } else {
        bgSwatch.style.background = "";
        bgSwatch.classList.add("dmna-style-color-transparent");
      }
    }
    const strokeSwatch = stylePopoverElement.querySelector(
      ".dmna-style-color-stroke .dmna-style-color-swatch"
    );
    if (strokeSwatch) {
      const ts = spanProps.get("text-shadow");
      const match = ts?.match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/);
      if (match) {
        strokeSwatch.style.background = match[0];
        strokeSwatch.classList.remove("dmna-style-color-transparent");
      } else {
        strokeSwatch.style.background = "";
        strokeSwatch.classList.add("dmna-style-color-transparent");
      }
    }
    stylePopoverElement.querySelector(".dmna-style-color-text")?.classList.toggle("is-active", spanProps.has("color"));
    stylePopoverElement.querySelector(".dmna-style-color-stroke")?.classList.toggle("is-active", spanProps.has("text-shadow"));
    stylePopoverElement.querySelector(".dmna-style-color-bg")?.classList.toggle("is-active", spanProps.has("background-color"));
    const sizeSelect = stylePopoverElement.querySelector(
      '.dmna-style-select[data-control="size"]'
    );
    if (sizeSelect) {
      const fontSize = spanProps.get("font-size");
      const match = fontSize ? SIZE_OPTIONS.find((o) => o.value === fontSize) : void 0;
      sizeSelect.value = match ? match.value : "normal";
    }
    const fontSelect = stylePopoverElement.querySelector(
      '.dmna-style-select[data-control="font"]'
    );
    if (fontSelect) {
      const fontFamily = spanProps.get("font-family");
      const match = fontFamily ? FONT_OPTIONS.find((o) => o.value === fontFamily) : void 0;
      fontSelect.value = match ? match.value : "";
    }
  }
  function showStylePopover() {
    createStylePopover();
    if (!stylePopoverElement) {
      return;
    }
    isShown$2 = true;
    updateStylePopoverPosition();
    refreshStylePopoverState();
    stylePopoverElement.classList.add("show");
  }
  function hideStylePopover() {
    if (!stylePopoverElement) {
      return;
    }
    stylePopoverElement.classList.remove("show");
    isShown$2 = false;
  }
  function toggleStylePopover() {
    if (isShown$2) {
      hideStylePopover();
    } else {
      showStylePopover();
    }
  }
  function updateStylePopoverPosition() {
    if (!stylePopoverElement || !isShown$2) {
      return;
    }
    const activeId = getActiveNoteId();
    if (!activeId) {
      return;
    }
    const note = notes.get(activeId);
    if (!note) {
      return;
    }
    const img = document.getElementById("image");
    if (!img) {
      return;
    }
    const displayRect = getImageDisplayRect(img);
    if (!displayRect) {
      return;
    }
    const boxRectPage = imageToScreenRect(
      note.current,
      displayRect,
      getOriginalWidth()
    );
    const vv = window.visualViewport;
    const scale = vv ? vv.scale : 1;
    const invScale = 1 / scale;
    const vvPageLeft = vv ? vv.pageLeft : window.pageXOffset;
    const vvPageTop = vv ? vv.pageTop : window.pageYOffset;
    const vvWidth = vv ? vv.width : window.innerWidth;
    const boxVisualLeft = (boxRectPage.left - vvPageLeft) * scale;
    const boxVisualTop = (boxRectPage.top - vvPageTop) * scale;
    const boxVisualWidth = boxRectPage.width * scale;
    const boxVisualHeight = boxRectPage.height * scale;
    const boxCenterVisualX = boxVisualLeft + boxVisualWidth / 2;
    const boxBottomVisualY = boxVisualTop + boxVisualHeight;
    let notePopVisualLeft = boxCenterVisualX - POPOVER_WIDTH / 2;
    if (POPOVER_WIDTH + POPOVER_VIEWPORT_PADDING * 2 <= vvWidth) {
      const minLeft = POPOVER_VIEWPORT_PADDING;
      const maxLeft = vvWidth - POPOVER_WIDTH - POPOVER_VIEWPORT_PADDING;
      notePopVisualLeft = Math.max(minLeft, Math.min(notePopVisualLeft, maxLeft));
    }
    const notePopVisualTop = boxBottomVisualY + POPOVER_OFFSET;
    const notePopVisualRight = notePopVisualLeft + POPOVER_WIDTH;
    const isMobile = window.innerWidth < STYLE_POPOVER_MOBILE_BREAKPOINT;
    stylePopoverElement.classList.toggle("is-mobile", isMobile);
    let styleVisualLeft;
    let styleVisualTop;
    if (isMobile) {
      const notePopEl = document.getElementById("dmna-popover");
      const notePopHeight = notePopEl ? notePopEl.offsetHeight : 0;
      styleVisualLeft = notePopVisualLeft + (POPOVER_WIDTH - STYLE_POPOVER_WIDTH) / 2;
      styleVisualTop = notePopVisualTop + notePopHeight + STYLE_POPOVER_GAP;
    } else {
      styleVisualLeft = notePopVisualRight + STYLE_POPOVER_GAP;
      if (styleVisualLeft + STYLE_POPOVER_WIDTH > vvWidth) {
        styleVisualLeft = notePopVisualLeft - STYLE_POPOVER_GAP - STYLE_POPOVER_WIDTH;
      }
      styleVisualTop = notePopVisualTop;
    }
    const tx = vvPageLeft + styleVisualLeft / scale;
    const ty = vvPageTop + styleVisualTop / scale;
    stylePopoverElement.style.transform = `translate(${tx}px, ${ty}px) scale(${invScale})`;
  }
  let popoverElement = null;
  let popoverInputElement = null;
  let popoverPreviewElement = null;
  let popoverModeToggleElement = null;
  let popoverStyleToggleElement = null;
  let isPreviewMode = false;
  function getIsPreviewMode() {
    return isPreviewMode;
  }
  let previewRequestId = 0;
  function getPopoverInputElement() {
    return popoverInputElement;
  }
  function onTextareaSelectionChanged() {
    if (popoverInputElement && popoverStyleToggleElement) {
      const collapsed = popoverInputElement.selectionStart === popoverInputElement.selectionEnd;
      popoverStyleToggleElement.disabled = collapsed;
    }
    refreshStylePopoverState();
  }
  function selectionChangeHandler() {
    if (document.activeElement === popoverInputElement) {
      onTextareaSelectionChanged();
    }
  }
  function createPopover() {
    if (popoverElement) {
      return;
    }
    const root = document.createElement("div");
    root.id = "dmna-popover";
    const arrow = document.createElement("div");
    arrow.id = "dmna-popover-arrow";
    root.appendChild(arrow);
    const header = document.createElement("div");
    header.id = "dmna-popover-header";
    const modeToggle = document.createElement("button");
    modeToggle.type = "button";
    modeToggle.id = "dmna-popover-mode-toggle";
    modeToggle.className = "dmna-popover-mode-toggle";
    modeToggle.textContent = "👁 Preview";
    modeToggle.setAttribute("aria-label", "Toggle Preview / Edit");
    modeToggle.title = "Toggle preview / edit";
    modeToggle.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void handleModeToggle();
    });
    header.appendChild(modeToggle);
    const helpLink = document.createElement("a");
    helpLink.id = "dmna-popover-help-link";
    helpLink.className = "dmna-popover-help-link";
    helpLink.href = "https://danbooru.donmai.us/wiki_pages/help:notes";
    helpLink.target = "_blank";
    helpLink.rel = "noopener noreferrer";
    helpLink.textContent = "view help";
    header.appendChild(helpLink);
    root.appendChild(header);
    popoverModeToggleElement = modeToggle;
    const inputRow = document.createElement("div");
    inputRow.id = "dmna-popover-input-row";
    const input = document.createElement("textarea");
    input.id = "dmna-popover-input";
    input.rows = 4;
    input.placeholder = "Note...";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.addEventListener("input", () => {
      const activeId = getActiveNoteId();
      if (!activeId) {
        return;
      }
      const note = notes.get(activeId);
      if (note) {
        note.current.text = input.value;
        updateNoteVisuals(activeId);
      }
    });
    input.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        if (e.isComposing || e.keyCode === 229) {
          return;
        }
        e.preventDefault();
        handlePopoverAction("confirm");
      }
    });
    inputRow.appendChild(input);
    const preview = document.createElement("div");
    preview.id = "dmna-popover-preview";
    preview.style.display = "none";
    inputRow.appendChild(preview);
    popoverPreviewElement = preview;
    const sideStack = document.createElement("div");
    sideStack.id = "dmna-popover-side-stack";
    const eyeBtn = document.createElement("button");
    eyeBtn.type = "button";
    eyeBtn.id = "dmna-popover-eye";
    eyeBtn.className = "dmna-popover-side-btn";
    eyeBtn.textContent = "👁";
    eyeBtn.setAttribute("aria-label", "Show touch zones (press and hold)");
    eyeBtn.title = "Show touch zones (hold)";
    eyeBtn.addEventListener("pointerdown", (e) => {
      if (eyeBtn.disabled) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      try {
        eyeBtn.setPointerCapture(e.pointerId);
      } catch (_err) {
      }
      document.body.classList.add("dmna-show-debug-zones");
      eyeBtn.classList.add("is-pressed");
    });
    const releaseEye = (e) => {
      document.body.classList.remove("dmna-show-debug-zones");
      eyeBtn.classList.remove("is-pressed");
      try {
        eyeBtn.releasePointerCapture(e.pointerId);
      } catch (_err) {
      }
    };
    eyeBtn.addEventListener("pointerup", releaseEye);
    eyeBtn.addEventListener("pointercancel", releaseEye);
    sideStack.appendChild(eyeBtn);
    const undoBtn = document.createElement("button");
    undoBtn.type = "button";
    undoBtn.id = "dmna-popover-undo";
    undoBtn.className = "dmna-popover-side-btn";
    undoBtn.textContent = "↶";
    undoBtn.setAttribute("aria-label", "Undo last change to this note");
    undoBtn.title = "Undo last change";
    undoBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const activeId = getActiveNoteId();
      if (activeId) {
        popoverUndo(activeId);
      }
    });
    sideStack.appendChild(undoBtn);
    const styleBtn = document.createElement("button");
    styleBtn.type = "button";
    styleBtn.id = "dmna-popover-style-toggle";
    styleBtn.className = "dmna-popover-side-btn";
    styleBtn.textContent = "Aa";
    styleBtn.disabled = true;
    styleBtn.setAttribute("aria-label", "Toggle style markup popover");
    styleBtn.title = "Markup styles";
    styleBtn.addEventListener("mousedown", (e) => e.preventDefault());
    styleBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleStylePopover();
    });
    sideStack.appendChild(styleBtn);
    popoverStyleToggleElement = styleBtn;
    inputRow.appendChild(sideStack);
    root.appendChild(inputRow);
    const buttons = document.createElement("div");
    buttons.id = "dmna-popover-buttons";
    const actions = [
      { action: "confirm", icon: "✔︎", label: "Confirm" },
      { action: "cancel", icon: "✖︎", label: "Cancel" },
      { action: "delete", icon: "🗑", label: "Delete" },
      { action: "history", icon: "📜", label: "History" }
    ];
    actions.forEach(({ action, icon, label }) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "dmna-popover-btn";
      b.dataset.action = action;
      b.setAttribute("aria-label", label);
      b.title = label;
      b.textContent = icon;
      b.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        handlePopoverAction(action);
      });
      buttons.appendChild(b);
    });
    root.appendChild(buttons);
    const credit = document.createElement("div");
    credit.className = "dmna-popover-credit";
    credit.textContent = `${SCRIPT_NAME} v${SCRIPT_VERSION}`;
    root.appendChild(credit);
    document.body.appendChild(root);
    popoverElement = root;
    popoverInputElement = input;
  }
  function showPopover(noteId) {
    createPopover();
    const note = notes.get(noteId);
    if (!note || !popoverElement || !popoverInputElement) {
      return;
    }
    if (popoverInputElement.dataset.boundNoteId !== noteId) {
      popoverInputElement.value = note.current.text || "";
      popoverInputElement.dataset.boundNoteId = noteId;
      resetPreviewMode();
      hideStylePopover();
    }
    updatePopoverForActiveNote();
    updatePopoverPosition();
    updateActiveHandleScales();
    popoverElement.classList.add("show");
    document.body.classList.add("dmna-note-popover-open");
    document.addEventListener("selectionchange", selectionChangeHandler);
  }
  function hidePopover() {
    if (popoverElement) {
      popoverElement.classList.remove("show");
    }
    if (popoverInputElement) {
      delete popoverInputElement.dataset.boundNoteId;
    }
    document.body.classList.remove("dmna-note-popover-open");
    document.removeEventListener("selectionchange", selectionChangeHandler);
    resetPreviewMode();
    hideStylePopover();
  }
  function updatePopoverForActiveNote() {
    if (!popoverElement || !popoverInputElement) {
      return;
    }
    const activeId = getActiveNoteId();
    if (!activeId) {
      return;
    }
    const note = notes.get(activeId);
    if (!note) {
      return;
    }
    const isDeleted = !!note.isDeleted;
    popoverInputElement.disabled = isDeleted;
    popoverElement.querySelectorAll(".dmna-popover-btn").forEach((b) => {
      const btn = b;
      btn.disabled = btn.dataset.action === "history" ? !note.isServerNote : isDeleted;
    });
    const eyeBtn = popoverElement.querySelector("#dmna-popover-eye");
    if (eyeBtn instanceof HTMLButtonElement) {
      eyeBtn.disabled = isDeleted;
    }
    const undoBtn = popoverElement.querySelector("#dmna-popover-undo");
    if (undoBtn) {
      undoBtn.classList.toggle("is-highlighted", isDeleted);
    }
  }
  function updatePopoverPosition() {
    if (!popoverElement) {
      return;
    }
    const activeId = getActiveNoteId();
    if (!activeId) {
      return;
    }
    const note = notes.get(activeId);
    if (!note) {
      return;
    }
    const img = document.getElementById("image");
    if (!img) {
      return;
    }
    const displayRect = getImageDisplayRect(img);
    if (!displayRect) {
      return;
    }
    const boxRectPage = imageToScreenRect(
      note.current,
      displayRect,
      getOriginalWidth()
    );
    const vv = window.visualViewport;
    const scale = vv ? vv.scale : 1;
    const invScale = 1 / scale;
    const vvPageLeft = vv ? vv.pageLeft : window.pageXOffset;
    const vvPageTop = vv ? vv.pageTop : window.pageYOffset;
    const vvWidth = vv ? vv.width : window.innerWidth;
    const boxVisualLeft = (boxRectPage.left - vvPageLeft) * scale;
    const boxVisualTop = (boxRectPage.top - vvPageTop) * scale;
    const boxVisualWidth = boxRectPage.width * scale;
    const boxVisualHeight = boxRectPage.height * scale;
    const boxCenterVisualX = boxVisualLeft + boxVisualWidth / 2;
    const boxBottomVisualY = boxVisualTop + boxVisualHeight;
    let popVisualLeft = boxCenterVisualX - POPOVER_WIDTH / 2;
    const popVisualTop = boxBottomVisualY + POPOVER_OFFSET;
    if (POPOVER_WIDTH + POPOVER_VIEWPORT_PADDING * 2 <= vvWidth) {
      const minLeft = POPOVER_VIEWPORT_PADDING;
      const maxLeft = vvWidth - POPOVER_WIDTH - POPOVER_VIEWPORT_PADDING;
      popVisualLeft = Math.max(minLeft, Math.min(popVisualLeft, maxLeft));
    }
    const tx = vvPageLeft + popVisualLeft / scale;
    const ty = vvPageTop + popVisualTop / scale;
    popoverElement.style.transform = `translate(${tx}px, ${ty}px) scale(${invScale})`;
  }
  function refreshActivePopover() {
    if (!popoverElement || !popoverInputElement) {
      return;
    }
    const activeId = getActiveNoteId();
    if (!activeId) {
      return;
    }
    const note = notes.get(activeId);
    if (!note) {
      return;
    }
    if (popoverInputElement.dataset.boundNoteId === activeId) {
      popoverInputElement.value = note.current.text || "";
    }
    updatePopoverForActiveNote();
    updatePopoverPosition();
  }
  function isPopoverInput(el) {
    return el !== null && el === popoverInputElement;
  }
  function applyTextUndoSnapshot(noteId, snapshot) {
    if (!popoverInputElement) return;
    if (popoverInputElement.dataset.boundNoteId !== noteId) return;
    popoverInputElement.value = snapshot.text;
    popoverInputElement.focus();
    popoverInputElement.setSelectionRange(
      snapshot.selectionStart,
      snapshot.selectionEnd
    );
    popoverInputElement.dispatchEvent(new Event("input", { bubbles: true }));
  }
  function setPopoverInteracting(interacting) {
    if (popoverElement) {
      popoverElement.style.opacity = interacting ? "0.25" : "";
    }
  }
  function focusActiveNoteInput(expectedId) {
    if (popoverInputElement && getActiveNoteId() === expectedId) {
      popoverInputElement.focus();
    }
  }
  function dismissActivePopover() {
    const activeId = getActiveNoteId();
    if (activeId === null) {
      return;
    }
    const note = notes.get(activeId);
    if (!note) {
      setActiveNote(null);
      return;
    }
    const isFreshNew = !note.isServerNote && !note.everConfirmed;
    if (isFreshNew) {
      hardDeleteNote(activeId);
    } else {
      note.current = { ...note.confirmedState };
      clearTextActionsForNote(activeId);
      renderNoteBox(activeId);
      setActiveNote(null);
    }
  }
  async function handleModeToggle() {
    if (!popoverPreviewElement || !popoverInputElement || !popoverModeToggleElement) {
      return;
    }
    if (isPreviewMode) {
      enterEditMode();
      return;
    }
    const myReq = ++previewRequestId;
    popoverModeToggleElement.disabled = true;
    popoverModeToggleElement.textContent = "…";
    try {
      const res = await apiPreviewNote(popoverInputElement.value);
      if (myReq !== previewRequestId) {
        return;
      }
      if (typeof res.sanitized_body !== "string") {
        throw new Error("Malformed preview response");
      }
      popoverPreviewElement.innerHTML = res.sanitized_body;
      popoverInputElement.style.display = "none";
      popoverPreviewElement.style.display = "block";
      isPreviewMode = true;
      popoverModeToggleElement.textContent = "✎ Edit";
      refreshStylePopoverState();
    } catch (err) {
      if (myReq === previewRequestId) {
        showToast("⚠️ Preview failed", "error", err);
        popoverModeToggleElement.textContent = "👁 Preview";
      }
    } finally {
      if (myReq === previewRequestId) {
        popoverModeToggleElement.disabled = false;
      }
    }
  }
  function enterEditMode() {
    if (!popoverPreviewElement || !popoverInputElement || !popoverModeToggleElement) {
      return;
    }
    popoverPreviewElement.style.display = "none";
    popoverInputElement.style.display = "";
    popoverPreviewElement.innerHTML = "";
    popoverModeToggleElement.textContent = "👁 Preview";
    popoverModeToggleElement.disabled = false;
    isPreviewMode = false;
    refreshStylePopoverState();
  }
  function resetPreviewMode() {
    previewRequestId++;
    enterEditMode();
  }
  function handlePopoverAction(action) {
    const activeId = getActiveNoteId();
    if (!activeId) {
      return;
    }
    if (action === "confirm") {
      popoverConfirm(activeId);
    } else if (action === "cancel") {
      popoverCancel(activeId);
    } else if (action === "delete") {
      popoverDelete(activeId);
    } else if (action === "history") {
      if (isServerNoteId(activeId)) {
        window.open(
          `https://danbooru.donmai.us/note_versions?search[note_id]=${activeId}`,
          "_blank"
        );
      }
    }
  }
  let modalElement$1 = null;
  let overlayElement$1 = null;
  let urlInput = null;
  let onConfirmCallback$1 = null;
  let isShown$1 = false;
  let suppressNextClick$1 = false;
  const DANBOORU_HOST_RE = /^https?:\/\/danbooru\.donmai\.us/i;
  const DANGEROUS_SCHEME_RE = /^\s*(javascript|data|vbscript|file):/i;
  function normalizeUrl(input) {
    const trimmed = input.trim().replace(DANBOORU_HOST_RE, "");
    if (DANGEROUS_SCHEME_RE.test(trimmed)) {
      return "";
    }
    return trimmed.replace(/[<>"]/g, "");
  }
  function hideLinkPopover() {
    if (!modalElement$1 || !overlayElement$1) return;
    modalElement$1.classList.remove("show");
    overlayElement$1.classList.remove("show");
    isShown$1 = false;
    onConfirmCallback$1 = null;
  }
  function restoreTextareaSelection$1() {
    const ta = getPopoverInputElement();
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(ta.selectionStart, ta.selectionEnd);
  }
  function handleConfirm() {
    if (!urlInput) return;
    const url = normalizeUrl(urlInput.value);
    const callback = onConfirmCallback$1;
    hideLinkPopover();
    if (url && callback) {
      callback(url);
    } else {
      restoreTextareaSelection$1();
    }
  }
  function handleCancel$1() {
    hideLinkPopover();
    restoreTextareaSelection$1();
  }
  function onOutsideTap$1(e) {
    if (!isShown$1 || !modalElement$1) return;
    const target = e.target;
    if (!target) return;
    if (modalElement$1.contains(target)) return;
    if (target.closest(".dmna-style-btn-link")) {
      return;
    }
    hideLinkPopover();
    restoreTextareaSelection$1();
    const notePop = document.getElementById("dmna-popover");
    const stylePop = document.getElementById("dmna-style-popover");
    const inNote = !!notePop?.contains(target);
    const inStyle = !!stylePop?.contains(target);
    if (!inNote && !inStyle) {
      e.preventDefault();
      e.stopPropagation();
      suppressNextClick$1 = true;
      window.setTimeout(() => {
        suppressNextClick$1 = false;
      }, 500);
    }
  }
  function onOutsideClick$1(e) {
    if (!suppressNextClick$1) return;
    suppressNextClick$1 = false;
    e.preventDefault();
    e.stopPropagation();
  }
  function createLinkPopover() {
    if (modalElement$1 && overlayElement$1) {
      return;
    }
    const host = document.getElementById("dmna-popover");
    if (!host) {
      return;
    }
    const overlay = document.createElement("div");
    overlay.id = "dmna-link-overlay";
    overlay.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    overlay.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleCancel$1();
    });
    const modal = document.createElement("div");
    modal.id = "dmna-link-modal";
    const input = document.createElement("input");
    input.type = "url";
    input.id = "dmna-link-modal-input";
    input.placeholder = "Paste link URL";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing) {
        e.preventDefault();
        e.stopPropagation();
        handleConfirm();
      }
    });
    modal.appendChild(input);
    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.id = "dmna-link-modal-confirm";
    confirmBtn.textContent = "✔";
    confirmBtn.setAttribute("aria-label", "Confirm link");
    confirmBtn.addEventListener("mousedown", (e) => e.preventDefault());
    confirmBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleConfirm();
    });
    modal.appendChild(confirmBtn);
    host.appendChild(overlay);
    host.appendChild(modal);
    overlayElement$1 = overlay;
    modalElement$1 = modal;
    urlInput = input;
    listenDocumentTap(onOutsideTap$1);
    document.addEventListener("click", onOutsideClick$1, true);
  }
  function showLinkPopover(onConfirm) {
    hideColorPicker();
    hideStrokePicker();
    hideRubyPopover();
    createLinkPopover();
    if (!modalElement$1 || !overlayElement$1 || !urlInput) return;
    urlInput.value = "";
    onConfirmCallback$1 = onConfirm;
    overlayElement$1.classList.add("show");
    modalElement$1.classList.add("show");
    isShown$1 = true;
    urlInput.focus();
  }
  function isLinkPopoverShown() {
    return isShown$1;
  }
  const SWATCHES = [
    "#000000",
    "#FFFFFF",
    "#E53935",
    "#EC407A",
    "#AB47BC",
    "#5C6BC0",
    "#1E88E5",
    "#00ACC1",
    "#43A047",
    "#9CCC65",
    "#FDD835",
    "#FB8C00",
    "#8D6E63",
    "#757575"
  ];
  const HEX_RE = /^#?[0-9a-fA-F]{6}$/;
  let modalElement = null;
  let overlayElement = null;
  let hexInput = null;
  let applyButton = null;
  let transparentSwatch = null;
  let onConfirmCallback = null;
  let isShown = false;
  let currentTarget = null;
  let suppressNextClick = false;
  function normalizeHex(input) {
    const trimmed = input.trim();
    if (!HEX_RE.test(trimmed)) return null;
    return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  }
  function refreshApplyState() {
    if (!applyButton || !hexInput) return;
    const valid = normalizeHex(hexInput.value) !== null;
    applyButton.disabled = !valid;
    hexInput.classList.toggle("is-invalid", !valid && hexInput.value !== "");
  }
  function hideColorPicker() {
    if (!modalElement || !overlayElement) return;
    modalElement.classList.remove("show");
    overlayElement.classList.remove("show");
    isShown = false;
    currentTarget = null;
    onConfirmCallback = null;
  }
  function commitColor(color) {
    const callback = onConfirmCallback;
    hideColorPicker();
    if (callback) {
      callback(color);
    } else {
      restoreTextareaSelection();
    }
  }
  function restoreTextareaSelection() {
    const ta = getPopoverInputElement();
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(ta.selectionStart, ta.selectionEnd);
  }
  function handleCancel() {
    hideColorPicker();
    restoreTextareaSelection();
  }
  function handleHexApply() {
    if (!hexInput) return;
    const color = normalizeHex(hexInput.value);
    if (!color) return;
    if (currentTarget === "text" && color.toLowerCase() === "#000000") {
      commitColor("");
    } else {
      commitColor(color);
    }
  }
  function onOutsideTap(e) {
    if (!isShown || !modalElement) return;
    const target = e.target;
    if (!target) return;
    if (modalElement.contains(target)) return;
    if (target.closest(
      ".dmna-style-color-text, .dmna-style-color-stroke, .dmna-style-color-bg"
    )) {
      return;
    }
    hideColorPicker();
    restoreTextareaSelection();
    const notePop = document.getElementById("dmna-popover");
    const stylePop = document.getElementById("dmna-style-popover");
    const inNote = !!notePop?.contains(target);
    const inStyle = !!stylePop?.contains(target);
    if (!inNote && !inStyle) {
      e.preventDefault();
      e.stopPropagation();
      suppressNextClick = true;
      window.setTimeout(() => {
        suppressNextClick = false;
      }, 500);
    }
  }
  function onOutsideClick(e) {
    if (!suppressNextClick) return;
    suppressNextClick = false;
    e.preventDefault();
    e.stopPropagation();
  }
  function createColorPicker() {
    if (modalElement && overlayElement) return;
    const host = document.getElementById("dmna-popover");
    if (!host) return;
    const overlay = document.createElement("div");
    overlay.id = "dmna-color-overlay";
    overlay.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    overlay.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleCancel();
    });
    const modal = document.createElement("div");
    modal.id = "dmna-color-modal";
    const grid = document.createElement("div");
    grid.id = "dmna-color-swatches";
    const transparent = document.createElement("button");
    transparent.type = "button";
    transparent.className = "dmna-color-swatch dmna-color-swatch-transparent";
    transparent.dataset.color = "transparent";
    transparent.setAttribute("aria-label", "Remove color");
    transparent.addEventListener("mousedown", (e) => e.preventDefault());
    transparent.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      commitColor("");
    });
    grid.appendChild(transparent);
    transparentSwatch = transparent;
    for (const hex of SWATCHES) {
      const sw = document.createElement("button");
      sw.type = "button";
      sw.className = "dmna-color-swatch";
      sw.style.background = hex;
      sw.dataset.color = hex;
      sw.setAttribute("aria-label", `Pick ${hex}`);
      sw.addEventListener("mousedown", (e) => e.preventDefault());
      sw.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (currentTarget === "text" && hex === "#000000") {
          commitColor("");
        } else {
          commitColor(hex);
        }
      });
      grid.appendChild(sw);
    }
    modal.appendChild(grid);
    const inputRow = document.createElement("div");
    inputRow.id = "dmna-color-input-row";
    const input = document.createElement("input");
    input.type = "text";
    input.id = "dmna-color-hex";
    input.placeholder = "#RRGGBB";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.maxLength = 7;
    input.addEventListener("input", refreshApplyState);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing) {
        e.preventDefault();
        e.stopPropagation();
        handleHexApply();
      }
    });
    inputRow.appendChild(input);
    const apply = document.createElement("button");
    apply.type = "button";
    apply.id = "dmna-color-apply";
    apply.textContent = "✔";
    apply.setAttribute("aria-label", "Apply HEX color");
    apply.disabled = true;
    apply.addEventListener("mousedown", (e) => e.preventDefault());
    apply.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleHexApply();
    });
    inputRow.appendChild(apply);
    modal.appendChild(inputRow);
    host.appendChild(overlay);
    host.appendChild(modal);
    overlayElement = overlay;
    modalElement = modal;
    hexInput = input;
    applyButton = apply;
    listenDocumentTap(onOutsideTap);
    document.addEventListener("click", onOutsideClick, true);
  }
  function showColorPicker(target, onConfirm) {
    hideLinkPopover();
    hideStrokePicker();
    hideRubyPopover();
    createColorPicker();
    if (!modalElement || !overlayElement || !hexInput || !applyButton) return;
    currentTarget = target;
    modalElement.dataset.target = target;
    if (transparentSwatch) {
      transparentSwatch.style.display = target === "bg" ? "" : "none";
    }
    hexInput.value = "";
    hexInput.classList.remove("is-invalid");
    applyButton.disabled = true;
    onConfirmCallback = onConfirm;
    overlayElement.classList.add("show");
    modalElement.classList.add("show");
    isShown = true;
    hexInput.focus();
  }
  function isColorPickerShown() {
    return isShown;
  }
  function getColorPickerTarget() {
    return isShown ? currentTarget : null;
  }
  let tagPopoverElement = null;
  let tagPopoverInitialTags = null;
  let tagPopoverState = null;
  let pendingTagPopoverResolver = null;
  async function showTagPopover() {
    let tagString;
    try {
      tagString = await fetchPostTagString();
    } catch (err) {
      showToast("⚠️ Failed to load post tags", "error", err);
      return null;
    }
    const initialTags = new Set(
      tagString.split(/\s+/).filter((t) => TAG_OPTIONS.includes(t))
    );
    return new Promise((resolve) => {
      if (pendingTagPopoverResolver) {
        const stale = pendingTagPopoverResolver;
        pendingTagPopoverResolver = null;
        stale(null);
      }
      pendingTagPopoverResolver = resolve;
      openTagPopover(initialTags);
    });
  }
  function updateTagPopoverPosition() {
    if (!tagPopoverElement) {
      return;
    }
    const vv = window.visualViewport;
    const scale = vv ? vv.scale : 1;
    const invScale = 1 / scale;
    const vvWidth = vv ? vv.width : window.innerWidth;
    const vvHeight = vv ? vv.height : window.innerHeight;
    const vvPageLeft = vv ? vv.pageLeft : window.pageXOffset;
    const vvPageTop = vv ? vv.pageTop : window.pageYOffset;
    const { marginX, marginY } = getButtonMargins();
    const btnCenterX = vvWidth - (marginX + BTN_SIZE / 2) * invScale;
    const btnCenterY = vvHeight - (marginY + BTN_SIZE / 2) * invScale;
    const btnVisualHalf = BTN_SIZE / 2 * invScale;
    const arrowW = 8;
    const popW = TAG_POPOVER_WIDTH;
    const popH = tagPopoverElement.offsetHeight;
    const arrowTipX = btnCenterX - btnVisualHalf - TAG_POPOVER_GAP * invScale;
    const popoverRightX = arrowTipX - arrowW * invScale;
    const popoverLeftX = popoverRightX - popW * invScale;
    const popoverBottomY = btnCenterY + btnVisualHalf;
    const popoverTopY = popoverBottomY - popH * invScale;
    const tx = vvPageLeft + popoverLeftX;
    const ty = vvPageTop + popoverTopY;
    tagPopoverElement.style.transform = `translate(${tx}px, ${ty}px) scale(${invScale})`;
  }
  function applyTagConstraints(state, changedTag, newValue) {
    const next = { ...state };
    next[changedTag] = newValue;
    if (newValue) {
      if (changedTag === "translated") {
        next.translation_request = false;
        next.check_translation = false;
        next.partially_translated = false;
      } else {
        next.translated = false;
        if (changedTag === "check_translation" || changedTag === "partially_translated") {
          next.translation_request = true;
        }
      }
    } else {
      if (changedTag === "translation_request" && (next.check_translation || next.partially_translated)) {
        next.translation_request = true;
      }
    }
    return next;
  }
  function isTagToggleDisabled(state, tag) {
    if (tag === "translation_request") {
      return state.check_translation || state.partially_translated;
    }
    return false;
  }
  function renderTagToggles() {
    if (!tagPopoverElement || !tagPopoverState) {
      return;
    }
    const state = tagPopoverState;
    TAG_OPTIONS.forEach((tag) => {
      const row = tagPopoverElement.querySelector(
        `.dmna-tag-row[data-tag="${tag}"]`
      );
      if (!(row instanceof HTMLElement)) {
        return;
      }
      const switchBtn = row.querySelector(".dmna-tag-switch-btn");
      const disabled = isTagToggleDisabled(state, tag);
      row.classList.toggle("is-on", !!state[tag]);
      row.classList.toggle("is-disabled", disabled);
      if (switchBtn instanceof HTMLButtonElement) {
        switchBtn.disabled = disabled;
      }
    });
  }
  function createTagPopover() {
    if (tagPopoverElement) {
      return;
    }
    const root = document.createElement("div");
    root.id = "dmna-tag-popover";
    root.addEventListener("click", (e) => {
      e.stopPropagation();
    });
    const arrow = document.createElement("div");
    arrow.id = "dmna-tag-popover-arrow";
    root.appendChild(arrow);
    const header = document.createElement("div");
    header.className = "dmna-tag-popover-header";
    header.textContent = "Translation tags";
    root.appendChild(header);
    const list = document.createElement("div");
    list.id = "dmna-tag-popover-toggles";
    TAG_OPTIONS.forEach((tag) => {
      const row = document.createElement("div");
      row.className = "dmna-tag-row";
      row.dataset.tag = tag;
      const label = document.createElement("span");
      label.className = "dmna-tag-label";
      label.textContent = TAG_LABELS[tag];
      row.appendChild(label);
      const switchBtn = document.createElement("button");
      switchBtn.type = "button";
      switchBtn.className = "dmna-tag-switch-btn";
      switchBtn.dataset.tag = tag;
      const sw = document.createElement("span");
      sw.className = "dmna-tag-switch";
      const thumb = document.createElement("span");
      thumb.className = "dmna-tag-switch-thumb";
      sw.appendChild(thumb);
      switchBtn.appendChild(sw);
      row.appendChild(switchBtn);
      switchBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (switchBtn.disabled || !tagPopoverState) {
          return;
        }
        const currentlyOn = !!tagPopoverState[tag];
        tagPopoverState = applyTagConstraints(tagPopoverState, tag, !currentlyOn);
        renderTagToggles();
      });
      list.appendChild(row);
    });
    root.appendChild(list);
    const buttons = document.createElement("div");
    buttons.id = "dmna-tag-popover-buttons";
    const submitBtn = document.createElement("button");
    submitBtn.type = "button";
    submitBtn.className = "dmna-tag-popover-btn";
    submitBtn.dataset.action = "submit";
    submitBtn.textContent = "Submit";
    submitBtn.addEventListener("click", () => submitTagPopover(false));
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "dmna-tag-popover-btn";
    cancelBtn.dataset.action = "cancel";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => submitTagPopover(true));
    buttons.appendChild(submitBtn);
    buttons.appendChild(cancelBtn);
    root.appendChild(buttons);
    document.body.appendChild(root);
    tagPopoverElement = root;
  }
  function openTagPopover(initialTags) {
    createTagPopover();
    if (!tagPopoverElement) {
      return;
    }
    tagPopoverInitialTags = initialTags;
    const initState = {};
    TAG_OPTIONS.forEach((t) => {
      initState[t] = initialTags.has(t);
    });
    if (initState.check_translation || initState.partially_translated) {
      initState.translation_request = true;
    }
    tagPopoverState = initState;
    renderTagToggles();
    document.body.classList.add("dmna-tag-popover-open");
    tagPopoverElement.style.visibility = "hidden";
    tagPopoverElement.classList.add("show");
    updateTagPopoverPosition();
    tagPopoverElement.style.visibility = "";
    document.addEventListener("keydown", tagPopoverKeyHandler, true);
  }
  function closeTagPopover() {
    document.body.classList.remove("dmna-tag-popover-open");
    if (tagPopoverElement) {
      tagPopoverElement.classList.remove("show");
    }
    document.removeEventListener("keydown", tagPopoverKeyHandler, true);
    tagPopoverInitialTags = null;
    tagPopoverState = null;
  }
  function submitTagPopover(canceled) {
    const resolver = pendingTagPopoverResolver;
    if (!resolver) {
      return;
    }
    if (canceled) {
      pendingTagPopoverResolver = null;
      closeTagPopover();
      resolver(null);
      return;
    }
    const initial = tagPopoverInitialTags || new Set();
    const state = tagPopoverState || {};
    const tagsToAdd = [];
    const tagsToRemove = [];
    TAG_OPTIONS.forEach((tag) => {
      const wasOn = initial.has(tag);
      const isOn = !!state[tag];
      if (isOn && !wasOn) {
        tagsToAdd.push(tag);
      } else if (!isOn && wasOn) {
        tagsToRemove.push(tag);
      }
    });
    pendingTagPopoverResolver = null;
    closeTagPopover();
    resolver({ tagsToAdd, tagsToRemove });
  }
  function tagPopoverKeyHandler(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      submitTagPopover(true);
    } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      submitTagPopover(false);
    }
  }
  let dragState = null;
  let suppressNextBoxClick = false;
  function attachHandleListeners(handle, corner, noteId) {
    handle.addEventListener("pointerdown", (e) => {
      if (getMode() !== "active") {
        return;
      }
      const note = notes.get(noteId);
      if (note && note.isDeleted) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (getActiveNoteId() !== noteId) {
        setActiveNote(noteId);
      }
      const isResize = corner === "nw" || corner === "se";
      const kind = isResize ? `resize-${corner}` : "drag";
      startInteraction(noteId, kind, e, handle);
    });
  }
  function attachBodyDragListener(bodyEl, noteId) {
    bodyEl.addEventListener("pointerdown", (e) => {
      if (getMode() !== "active") {
        return;
      }
      const note = notes.get(noteId);
      if (note && note.isDeleted) {
        if (getActiveNoteId() !== noteId) {
          setActiveNote(noteId);
        }
        return;
      }
      if (getActiveNoteId() !== noteId) {
        setActiveNote(noteId);
      }
      e.preventDefault();
      startInteraction(noteId, "drag", e, bodyEl);
    });
  }
  function consumeBoxClickSuppression() {
    if (suppressNextBoxClick) {
      suppressNextBoxClick = false;
      return true;
    }
    return false;
  }
  function startInteraction(noteId, kind, e, captureTarget) {
    const note = notes.get(noteId);
    if (!note) {
      return;
    }
    dragState = {
      kind,
      noteId,
      pointerId: e.pointerId,
      startScreenX: e.clientX,
      startScreenY: e.clientY,
      startState: { ...note.current },
      captureTarget,
      moved: false
    };
    try {
      captureTarget.setPointerCapture(e.pointerId);
    } catch (_err) {
    }
    captureTarget.addEventListener("pointermove", onInteractionMove);
    captureTarget.addEventListener("pointerup", onInteractionEnd);
    captureTarget.addEventListener("pointercancel", onInteractionEnd);
  }
  function onInteractionMove(e) {
    if (!dragState || e.pointerId !== dragState.pointerId) {
      return;
    }
    const note = notes.get(dragState.noteId);
    if (!note) {
      return;
    }
    const dx = e.clientX - dragState.startScreenX;
    const dy = e.clientY - dragState.startScreenY;
    if (!dragState.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
      dragState.moved = true;
      setPopoverInteracting(true);
      if (note.domElement) {
        note.domElement.classList.add("is-interacting");
      }
    }
    const img = getImageElement();
    if (!img) {
      return;
    }
    const rect = getImageDisplayRect(img);
    const originalWidth = getOriginalWidth();
    const originalHeight = getOriginalHeight();
    if (!rect || !originalWidth) {
      return;
    }
    const scale = rect.width / originalWidth;
    const dxImg = dx / scale;
    const dyImg = dy / scale;
    const vv = window.visualViewport;
    const vvScale = vv ? vv.scale : 1;
    const minImg = Math.max(
      MIN_BOX_SIZE_IMG,
      MIN_BOX_SIZE_DISPLAY / vvScale / scale
    );
    const start = dragState.startState;
    let nx = start.x;
    let ny = start.y;
    let nw = start.w;
    let nh = start.h;
    if (dragState.kind === "drag") {
      nx = start.x + dxImg;
      ny = start.y + dyImg;
    } else if (dragState.kind === "resize-se") {
      nw = Math.max(minImg, start.w + dxImg);
      nh = Math.max(minImg, start.h + dyImg);
    } else if (dragState.kind === "resize-nw") {
      const seX = start.x + start.w;
      const seY = start.y + start.h;
      let candX = start.x + dxImg;
      let candY = start.y + dyImg;
      if (seX - candX < minImg) {
        candX = seX - minImg;
      }
      if (seY - candY < minImg) {
        candY = seY - minImg;
      }
      nx = candX;
      ny = candY;
      nw = seX - candX;
      nh = seY - candY;
    }
    nx = Math.max(0, Math.min(originalWidth - nw, nx));
    ny = Math.max(0, Math.min(originalHeight - nh, ny));
    note.current = { x: nx, y: ny, w: nw, h: nh, text: note.current.text };
    renderNoteBox(dragState.noteId);
    updatePopoverPosition();
  }
  function onInteractionEnd(e) {
    if (!dragState || e.pointerId !== dragState.pointerId) {
      return;
    }
    const target = dragState.captureTarget;
    try {
      target.releasePointerCapture(e.pointerId);
    } catch (_err) {
    }
    target.removeEventListener("pointermove", onInteractionMove);
    target.removeEventListener("pointerup", onInteractionEnd);
    target.removeEventListener("pointercancel", onInteractionEnd);
    if (dragState.moved) {
      pushAction(dragState.noteId, "transform", { ...dragState.startState });
      setPopoverInteracting(false);
      const note = notes.get(dragState.noteId);
      if (note && note.domElement) {
        note.domElement.classList.remove("is-interacting");
      }
      suppressNextBoxClick = true;
      setTimeout(() => {
        suppressNextBoxClick = false;
      }, 500);
    }
    dragState = null;
  }
  let imageHandlersBound = false;
  let dragCreate = null;
  let suppressNextImageClick = false;
  function bindImageHandlers() {
    if (imageHandlersBound) {
      return;
    }
    const img = getImageElement();
    if (!img) {
      setTimeout(bindImageHandlers, 1e3);
      return;
    }
    img.addEventListener("click", handleImageClick);
    img.addEventListener("load", updateAllNoteBoxPositions);
    img.addEventListener("pointerdown", onImageDragPointerDown);
    const blockNativeIfActive = (e) => {
      if (getMode() !== "active") {
        return;
      }
      e.stopPropagation();
    };
    img.addEventListener("mousedown", blockNativeIfActive, true);
    img.addEventListener("touchstart", blockNativeIfActive, true);
    imageHandlersBound = true;
  }
  function handleImageClick(e) {
    if (getMode() !== "active") {
      return;
    }
    if (suppressNextImageClick) {
      suppressNextImageClick = false;
      return;
    }
    if (getActiveNoteId() !== null) {
      dismissActivePopover();
      return;
    }
    void spawnDefaultBoxAtClient(e.clientX, e.clientY);
  }
  async function spawnDefaultBoxAtClient(clientX, clientY) {
    if (!getOriginalWidth() || !getOriginalHeight()) {
      const promise = getPostMetaPromise();
      if (promise) {
        try {
          await promise;
        } catch (err) {
          showToast("⚠️ Failed to load image info", "error", err);
          return null;
        }
        if (getMode() !== "active" || getActiveNoteId() !== null) {
          return null;
        }
      }
      if (!getOriginalWidth() || !getOriginalHeight()) {
        showToast("⚠️ Image info unavailable — refresh the page", "error");
        return null;
      }
    }
    const img = getImageElement();
    const rect = img ? getImageDisplayRect(img) : null;
    if (!rect) {
      showToast("⚠️ Image not on screen", "warning");
      return null;
    }
    const shortSide = Math.min(rect.width, rect.height);
    const sizeDisplay = Math.max(
      MIN_INITIAL_SIZE,
      Math.min(MAX_INITIAL_SIZE, shortSide * INITIAL_SIZE_RATIO)
    );
    const pageX = clientX + window.pageXOffset;
    const pageY = clientY + window.pageYOffset;
    let leftDisplay = pageX - sizeDisplay / 2;
    let topDisplay = pageY - sizeDisplay / 2;
    const maxLeft = rect.left + rect.width - sizeDisplay;
    const maxTop = rect.top + rect.height - sizeDisplay;
    leftDisplay = Math.max(rect.left, Math.min(maxLeft, leftDisplay));
    topDisplay = Math.max(rect.top, Math.min(maxTop, topDisplay));
    const imgState = screenToImageRect(
      {
        left: leftDisplay,
        top: topDisplay,
        width: sizeDisplay,
        height: sizeDisplay
      },
      rect,
      getOriginalWidth()
    );
    if (!imgState) {
      showToast("⚠️ Image not on screen", "warning");
      return null;
    }
    const id = createTempNote({
      x: imgState.x,
      y: imgState.y,
      w: imgState.w,
      h: imgState.h,
      text: ""
    });
    setActiveNote(id);
    requestAnimationFrame(() => focusActiveNoteInput(id));
    return id;
  }
  function computeDragRect(curX, curY) {
    if (!dragCreate) {
      return null;
    }
    const r = dragCreate.imageRect;
    const x1 = clamp(dragCreate.startX, r.left, r.left + r.width);
    const y1 = clamp(dragCreate.startY, r.top, r.top + r.height);
    const x2 = clamp(curX, r.left, r.left + r.width);
    const y2 = clamp(curY, r.top, r.top + r.height);
    return {
      left: Math.min(x1, x2),
      top: Math.min(y1, y2),
      width: Math.abs(x2 - x1),
      height: Math.abs(y2 - y1)
    };
  }
  function onImageDragPointerDown(e) {
    if (e.pointerType !== "mouse" || e.button !== 0) {
      return;
    }
    if (getMode() !== "active" || getActiveNoteId() !== null) {
      return;
    }
    if (!getOriginalWidth() || !getOriginalHeight()) {
      return;
    }
    const img = getImageElement();
    if (!img) {
      return;
    }
    const rect = getImageDisplayRect(img);
    if (!rect) {
      return;
    }
    e.preventDefault();
    dragCreate = {
      startX: e.clientX + window.pageXOffset,
      startY: e.clientY + window.pageYOffset,
      imageRect: rect,
      ghostEl: null,
      moved: false
    };
    document.addEventListener("pointermove", onImageDragPointerMove);
    document.addEventListener("pointerup", onImageDragPointerUp);
    document.addEventListener("pointercancel", onImageDragPointerCancel);
  }
  function onImageDragPointerMove(e) {
    if (!dragCreate) {
      return;
    }
    const x = e.clientX + window.pageXOffset;
    const y = e.clientY + window.pageYOffset;
    if (!dragCreate.moved) {
      const dist = Math.hypot(x - dragCreate.startX, y - dragCreate.startY);
      if (dist < DRAG_THRESHOLD_PX) {
        return;
      }
      dragCreate.moved = true;
      const ghost = document.createElement("div");
      ghost.id = "dmna-drag-ghost";
      document.body.appendChild(ghost);
      dragCreate.ghostEl = ghost;
    }
    const rect = computeDragRect(x, y);
    if (rect && dragCreate.ghostEl) {
      dragCreate.ghostEl.style.left = `${rect.left}px`;
      dragCreate.ghostEl.style.top = `${rect.top}px`;
      dragCreate.ghostEl.style.width = `${rect.width}px`;
      dragCreate.ghostEl.style.height = `${rect.height}px`;
    }
  }
  function onImageDragPointerUp(e) {
    if (!dragCreate) {
      return;
    }
    const moved = dragCreate.moved;
    let finalRect = null;
    if (moved) {
      const x = e.clientX + window.pageXOffset;
      const y = e.clientY + window.pageYOffset;
      finalRect = computeDragRect(x, y);
    }
    const imageRect = dragCreate.imageRect;
    cleanupDragCreate();
    suppressNextImageClick = true;
    const usableDrag = moved && finalRect && finalRect.width >= MIN_DRAG_CREATE_SIZE_DISPLAY && finalRect.height >= MIN_DRAG_CREATE_SIZE_DISPLAY;
    if (usableDrag && finalRect) {
      const imgState = screenToImageRect(
        finalRect,
        imageRect,
        getOriginalWidth()
      );
      if (!imgState) {
        return;
      }
      const id = createTempNote({
        x: imgState.x,
        y: imgState.y,
        w: imgState.w,
        h: imgState.h,
        text: ""
      });
      setActiveNote(id);
      requestAnimationFrame(() => focusActiveNoteInput(id));
      return;
    }
    void spawnDefaultBoxAtClient(e.clientX, e.clientY);
  }
  function onImageDragPointerCancel() {
    cleanupDragCreate();
  }
  function cleanupDragCreate() {
    if (dragCreate && dragCreate.ghostEl) {
      dragCreate.ghostEl.remove();
    }
    dragCreate = null;
    document.removeEventListener("pointermove", onImageDragPointerMove);
    document.removeEventListener("pointerup", onImageDragPointerUp);
    document.removeEventListener("pointercancel", onImageDragPointerCancel);
  }
  let hotkeysBound = false;
  function bindGlobalHotkeys() {
    if (hotkeysBound) {
      return;
    }
    document.addEventListener("keydown", handleGlobalHotkeys);
    hotkeysBound = true;
  }
  function handleGlobalHotkeys(e) {
    if (getIsSending()) {
      return;
    }
    if (document.body.classList.contains("dmna-tag-popover-open") || document.body.classList.contains("dmna-error-modal-open")) {
      return;
    }
    if (e.key === "Escape" && getActiveNoteId() !== null) {
      const ae = document.activeElement;
      if (isTextInputElement(ae) && !isPopoverInput(ae)) {
        return;
      }
      if (e.isComposing || e.keyCode === 229) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      dismissActivePopover();
      return;
    }
    if (e.shiftKey && e.code === "KeyN" && !e.ctrlKey && !e.metaKey && !e.altKey && getActiveNoteId() === null && !isTextInputElement(document.activeElement)) {
      e.preventDefault();
      if (getIsNativeActive()) {
        showToast("Danbooru's native note UI is active — close it first", "info");
      } else {
        toggleEditMode();
      }
      return;
    }
    if (e.shiftKey && e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.altKey && getMode() === "active" && getActiveNoteId() === null && !isTextInputElement(document.activeElement)) {
      e.preventDefault();
      void runConfirmFlow();
    }
  }
  let bound = false;
  const BLOCK_TOAST_COOLDOWN_MS = 2500;
  const BLOCK_TOAST_MESSAGE = "Edit mode is on — turn it off first";
  let lastBlockToastAt = 0;
  function maybeShowBlockToast() {
    const now = Date.now();
    if (now - lastBlockToastAt > BLOCK_TOAST_COOLDOWN_MS) {
      lastBlockToastAt = now;
      showToast(BLOCK_TOAST_MESSAGE, "info");
    }
  }
  function bindNativeBlockers() {
    if (bound) {
      return;
    }
    document.addEventListener("keydown", handleKeydown, true);
    document.addEventListener("click", handleClick, true);
    bound = true;
  }
  function handleKeydown(e) {
    if (getMode() !== "active") {
      return;
    }
    if (e.code === "KeyN" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && !isTextInputElement(e.target)) {
      e.preventDefault();
      e.stopPropagation();
      maybeShowBlockToast();
    }
  }
  function handleClick(e) {
    if (getMode() !== "active") {
      return;
    }
    const target = e.target;
    if (target && typeof target.closest === "function") {
      if (target.closest("#translate")) {
        e.preventDefault();
        e.stopPropagation();
        maybeShowBlockToast();
      }
    }
  }
  const notesStoreHooks = {
    onActiveChanged: (prev, next) => {
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
    onNoteRenderRequested: (id) => {
      renderNoteBox(id);
      refreshActivePopover();
    },
    onNoteVisualsChanged: (id) => updateNoteVisuals(id),
    onNoteRemoved: (id) => removeNoteBoxDOM(id),
    onModeChanged: (mode2) => {
      setFloatingButtonIconForMode();
      if (mode2 === "idle") {
        clearDraft();
      }
    },
    onToast: (msg, level, err) => showToast(msg, level, err),
    onReopenMenuRequested: () => openMenu(),
    hasPendingChanges: () => hasPendingChanges(),
    onTextUndo: (id, snapshot) => applyTextUndoSnapshot(id, snapshot)
  };
  const confirmFlowHooks = {
    onSendStart: () => {
      closeMenu();
      setFloatingButtonIcon("⏳");
    },
    onSendEnd: () => setFloatingButtonIconForMode(),
    onNoteRenderRequested: (id) => renderNoteBox(id),
    onNoteVisualsChanged: (id) => updateNoteVisuals(id),
    onToast: (msg, level, err) => showToast(msg, level, err),
    showTagPopover: () => showTagPopover()
  };
  const noteBoxHooks = {
    attachBodyDrag: (el, noteId) => attachBodyDragListener(el, noteId),
    attachHandle: (el, corner, noteId) => attachHandleListeners(el, corner, noteId),
    consumeBoxClickSuppression: () => consumeBoxClickSuppression()
  };
  const arcMenuHooks = {
    onConfirm: () => void runConfirmFlow()
  };
  function runViewportUpdate() {
    updateFloatingButtonPosition();
    updateArcMenuPosition();
    updateToastPosition();
    updatePopoverPosition();
    updateStylePopoverPosition();
    updateActiveHandleScales();
    updateTagPopoverPosition();
  }
  function scheduleViewportUpdate() {
    scheduleVisualViewportUpdate(runViewportUpdate);
  }
  function saveDraftIfNeeded() {
    if (getIsSending() || getIsInConfirmPipeline()) {
      return;
    }
    if (!hasContentToSave()) {
      return;
    }
    saveDraft(serializeForDraft());
  }
  let promptedDiscardOnLeave = false;
  function checkAndPromptRestore() {
    const draft = loadDraft();
    if (!draft) {
      return;
    }
    if (draft.mode !== "active" || draft.notes.length === 0) {
      return;
    }
    const n = draft.notes.length;
    const message = `Saved draft found (${n} note${n === 1 ? "" : "s"}).
Restore your work?`;
    showToastWithActions(message, [
      {
        label: "Restore",
        primary: true,
        onClick: () => {
          void applyDraftSnapshot(draft);
        }
      },
      {
        label: "Discard",
        onClick: () => clearDraft()
      }
    ]);
  }
  let initialized = false;
  function init() {
    if (initialized) {
      return;
    }
    initialized = true;
    const styleElement = document.createElement("style");
    styleElement.textContent = STYLES;
    document.head.appendChild(styleElement);
    createFloatingButton();
    createArcMenu();
    createPopover();
    createStylePopover();
    createLinkPopover();
    createColorPicker();
    createStrokePicker();
    createRubyPopover();
    initNotesStore(notesStoreHooks);
    initConfirmFlow(confirmFlowHooks);
    initNoteBox(noteBoxHooks);
    initArcMenu(arcMenuHooks);
    bindImageHandlers();
    bindGlobalHotkeys();
    bindNativeBlockers();
    initNativeConflictWatch();
    onNativeStateChanged(setNativeActiveHide);
    setNativeActiveHide(getIsNativeActive());
    runViewportUpdate();
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", scheduleViewportUpdate);
      window.visualViewport.addEventListener("scroll", scheduleViewportUpdate);
      window.addEventListener("scroll", scheduleViewportUpdate);
    }
    window.addEventListener("resize", updateAllNoteBoxPositions);
    window.addEventListener("orientationchange", updateAllNoteBoxPositions);
    window.addEventListener("beforeunload", (e) => {
      promptedDiscardOnLeave = false;
      if (getMode() === "active" && hasPendingChanges()) {
        promptedDiscardOnLeave = true;
        e.preventDefault();
        e.returnValue = "";
        return;
      }
      saveDraftIfNeeded();
    });
    window.addEventListener("pagehide", () => {
      if (promptedDiscardOnLeave) {
        clearDraft();
        return;
      }
      saveDraftIfNeeded();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        saveDraftIfNeeded();
      }
    });
    checkAndPromptRestore();
  }
  console.log(`[MobileNoteAssist v${APP_VERSION}] loaded`);
  init();

})();