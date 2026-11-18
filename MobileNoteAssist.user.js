// ==UserScript==
// @name         Danbooru Mobile Note Assist
// @namespace    http://tampermonkey.net/
// @version      5.1.4
// @author       AkaringoP with Claude Code
// @description  Touch-friendly translation note editor for Danbooru — multi-note batched Confirm.
// @icon         https://danbooru.donmai.us/favicon.ico
// @homepageURL  https://github.com/AkaringoP/Danbooru-Mobile-Note-Assist
// @downloadURL  https://github.com/AkaringoP/Danbooru-Mobile-Note-Assist/raw/build/MobileNoteAssist.user.js
// @updateURL    https://github.com/AkaringoP/Danbooru-Mobile-Note-Assist/raw/build/MobileNoteAssist.user.js
// @match        *://danbooru.donmai.us/posts/*
// @grant        none
// ==/UserScript==

(function() {
	"use strict";
	var APP_VERSION = "5.1.4";
	var SCRIPT_NAME = "MobileNoteAssist";
	var SCRIPT_VERSION = APP_VERSION;
	var REQUEST_TIMEOUT_MS = 2e4;
	var NOTE_BODY_MAX_LENGTH = 5e3;
	var POS_KEY = "dmna_btn_margin_y";
	var POS_X_KEY = "dmna_btn_margin_x";
	var LEGACY_STATE_KEY = "dmna_enabled";
	var LONG_PRESS_DURATION = 1e3;
	var INITIAL_SIZE_RATIO = .1;
	var ARC_CONFIRM_THETA = -100 * Math.PI / 180;
	var TAG_OPTIONS = [
		"translated",
		"translation_request",
		"check_translation",
		"partially_translated"
	];
	var TAG_LABELS = {
		translated: "Translated",
		translation_request: "Translation request",
		check_translation: "Check translation",
		partially_translated: "Partially translated"
	};
	function rippledRingMask() {
		const steps = 160;
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="#000" fill-rule="evenodd" d="M${Array.from({ length: steps }, (_, i) => {
			const angle = i / steps * 2 * Math.PI;
			const radius = 45.3 + 1.8 * Math.sin(angle * 16);
			const x = 50 + radius * Math.cos(angle);
			const y = 50 + radius * Math.sin(angle);
			return `${x.toFixed(1)} ${y.toFixed(1)}`;
		}).join("L")}Z M12 50A38 38 0 1 0 88 50A38 38 0 1 0 12 50Z"/></svg>`;
		return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
	}
	var STYLES = `
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
    /* Unsent changes (v5.1): orange glow — not on the server yet.
       Glows like the menu-open state. Menu-open (blue), reposition
       (orange fill) and sending (⏳) win. */
    body.dmna-has-pending:not(.dmna-sending) #dmna-float-btn:not(.expanded):not(.dragging) {
      --dmna-highlight: #ff9800;
      border-color: #ff9800;
      box-shadow: 0 0 12px rgba(255, 152, 0, 0.75), 0 4px 8px rgba(0, 0, 0, 0.3);
    }
    /* Everything was sent: green until the page reloads. Same
       specificity as the pending rule, later in source. */
    body.dmna-send-success:not(.dmna-sending) #dmna-float-btn:not(.expanded):not(.dragging) {
      --dmna-highlight: #43a047;
      border-color: #43a047;
      box-shadow: 0 0 12px rgba(67, 160, 71, 0.85), 0 4px 8px rgba(0, 0, 0, 0.3);
    }
    /* Count of requests Confirm would send. */
    body:not(.dmna-sending) #dmna-float-btn[data-pending-count]:not(.dragging)::after {
      content: attr(data-pending-count);
      position: absolute;
      top: -6px;
      right: -6px;
      min-width: 18px;
      height: 18px;
      padding: 0 4px;
      border-radius: 9px;
      box-sizing: border-box;
      background: #ff9800;
      color: #1a1a1a;
      font-size: 11px;
      font-weight: bold;
      line-height: 18px;
      text-align: center;
      pointer-events: none;
    }

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
    body.dmna-has-pending .dmna-menu-item[data-action="confirm"] {
      --dmna-highlight: #ff9800;
      border-color: #ff9800;
      box-shadow: 0 0 12px rgba(255, 152, 0, 0.75), 0 4px 8px rgba(0, 0, 0, 0.3);
    }
    body.dmna-send-success .dmna-menu-item[data-action="confirm"] {
      --dmna-highlight: #43a047;
      border-color: #43a047;
      box-shadow: 0 0 12px rgba(67, 160, 71, 0.85), 0 4px 8px rgba(0, 0, 0, 0.3);
    }
    /* Rippled ring around the highlighted button. Only transform is
       animated, so the turn stays on the compositor. */
    body.dmna-has-pending:not(.dmna-sending) #dmna-float-btn:not(.expanded):not(.dragging)::before,
    body.dmna-send-success:not(.dmna-sending) #dmna-float-btn:not(.expanded):not(.dragging)::before,
    body.dmna-has-pending .dmna-menu-item[data-action="confirm"]::before,
    body.dmna-send-success .dmna-menu-item[data-action="confirm"]::before {
      content: '';
      position: absolute;
      /* Sits on the button's own border, so the edge itself ripples. */
      inset: -5px;
      background: var(--dmna-highlight);
      -webkit-mask: ${rippledRingMask()} center / 100% 100% no-repeat;
      mask: ${rippledRingMask()} center / 100% 100% no-repeat;
      pointer-events: none;
      animation: dmna-ripple 8.6s linear infinite;
    }
    /* The menu item's border is 0.5px thinner than the button's. */
    body.dmna-has-pending .dmna-menu-item[data-action="confirm"]::before,
    body.dmna-send-success .dmna-menu-item[data-action="confirm"]::before {
      inset: -4.5px;
    }
    @keyframes dmna-ripple {
      0% { transform: rotate(0deg) scale(1); }
      50% { transform: rotate(180deg) scale(1.05); }
      100% { transform: rotate(360deg) scale(1); }
    }
    @media (prefers-reduced-motion: reduce) {
      #dmna-float-btn::before,
      .dmna-menu-item::before {
        animation: none !important;
      }
      #dmna-note-chooser .dmna-chooser-card {
        transform: none;
        transition: opacity 0.12s linear;
      }
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
      /* Per-box, set by renderNoteBox: smaller boxes stack higher. */
      z-index: var(--dmna-box-z, 9990);
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
      z-index: 10495;
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
       fire and spawn a duplicate note over the existing box.
       touch-action: only the selected box takes touch drags (none —
       otherwise the browser turns them into pan/scroll and pointermove
       never fires); on every other box a swipe scrolls the page and a
       tap selects it (v5.1). */
    body.dmna-mode-active .dmna-note-box {
      pointer-events: auto;
      cursor: pointer;
      touch-action: manipulation;
    }
    body.dmna-mode-active .dmna-note-box.is-active {
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

    /* "Create here" hint, left where a tap just missed a box. The
       outline takes no taps and sits below every box (9990 and up), so
       a box it overlaps is still selected by tapping it. Only the "+"
       is a target; --dmna-hint-scale (1 / pinch scale) keeps it and the
       dashes a constant size on screen. */
    #dmna-create-hint {
      position: absolute;
      z-index: 9985;
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      border: calc(2px * var(--dmna-hint-scale, 1)) dashed rgba(255, 200, 0, 0.9);
      background: rgba(255, 200, 0, 0.12);
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
    }
    #dmna-create-hint .dmna-create-hint-target {
      width: min(100%, calc(44px * var(--dmna-hint-scale, 1)));
      height: min(100%, calc(44px * var(--dmna-hint-scale, 1)));
      display: flex;
      align-items: center;
      justify-content: center;
      color: rgba(255, 200, 0, 0.95);
      font-size: calc(24px * var(--dmna-hint-scale, 1));
      font-weight: bold;
      line-height: 1;
      text-shadow: 0 0 calc(2px * var(--dmna-hint-scale, 1)) rgba(0, 0, 0, 0.9);
      pointer-events: auto;
      cursor: pointer;
      user-select: none;
      touch-action: manipulation;
    }
    #dmna-create-hint[hidden],
    body:not(.dmna-mode-active) #dmna-create-hint {
      display: none;
    }

    /* Note chooser: lists the notes near an ambiguous tap. Docked and
       counter-scaled by JS (transform), like the toast. */
    #dmna-note-chooser {
      position: absolute;
      left: 0;
      top: 0;
      z-index: 11001;
      transform-origin: 0 0;
      will-change: transform;
      /* Taps go through while it slides out. */
      pointer-events: none;
    }
    #dmna-note-chooser.is-open {
      pointer-events: auto;
    }
    #dmna-note-chooser.is-dock-top {
      --dmna-chooser-from: -24px;
    }
    /* Slides in from the screen edge it docks to. The card moves inside
       the counter-scaled panel, so the slide is 24 px on screen at any
       zoom. Closing reverses it (image-pointer waits for it before
       setting [hidden]). */
    #dmna-note-chooser .dmna-chooser-card {
      opacity: 0;
      transform: translateY(var(--dmna-chooser-from, 24px));
      transition: opacity 0.18s ease, transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
      box-sizing: border-box;
      width: 320px;
      max-width: calc(100vw - 24px);
      padding: 8px;
      border-radius: 12px;
      /* Opaque: it can sit over the toast and the floating button. */
      background: #1e1e1e;
      border: 1px solid rgba(255, 255, 255, 0.15);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
      color: #fff;
      font-size: 14px;
      line-height: 1.35;
      text-align: left;
      user-select: none;
    }
    #dmna-note-chooser.is-open .dmna-chooser-card {
      opacity: 1;
      transform: none;
    }
    #dmna-note-chooser[hidden],
    body:not(.dmna-mode-active) #dmna-note-chooser {
      display: none;
    }
    #dmna-note-chooser .dmna-chooser-title {
      padding: 4px 8px 8px;
      color: rgba(255, 255, 255, 0.55);
      font-size: 12px;
    }
    #dmna-note-chooser .dmna-chooser-item {
      display: flex;
      align-items: center;
      gap: 10px;
      min-height: 44px;
      box-sizing: border-box;
      padding: 8px 10px;
      border-radius: 8px;
      border: 1px solid transparent;
      cursor: pointer;
      touch-action: manipulation;
    }
    #dmna-note-chooser .dmna-chooser-item + .dmna-chooser-item {
      margin-top: 2px;
    }
    #dmna-note-chooser .dmna-chooser-item:active {
      background: rgba(255, 255, 255, 0.08);
    }
    #dmna-note-chooser .dmna-chooser-item.is-picked {
      background: rgba(255, 200, 0, 0.16);
      border-color: rgba(255, 200, 0, 0.9);
    }
    /* Same colors as the boxes: blue on the server, green new, red deleted. */
    #dmna-note-chooser .dmna-chooser-dot {
      flex: none;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #0073ff;
    }
    #dmna-note-chooser .dmna-chooser-dot.is-new { background: #43a047; }
    #dmna-note-chooser .dmna-chooser-dot.is-deleted { background: #e53935; }
    #dmna-note-chooser .dmna-chooser-text {
      flex: 1;
      min-width: 0;
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      overflow: hidden;
      overflow-wrap: anywhere;
    }
    #dmna-note-chooser .dmna-chooser-again {
      display: none;
      flex: none;
      color: rgba(255, 200, 0, 0.95);
      font-size: 12px;
    }
    #dmna-note-chooser .dmna-chooser-item.is-picked .dmna-chooser-again {
      display: block;
    }
    #dmna-note-chooser .dmna-chooser-new {
      margin-top: 6px;
      border-top: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 0 0 8px 8px;
      color: rgba(255, 200, 0, 0.95);
      font-weight: bold;
    }
    /* The box whose row is picked in the chooser. Above the other
       boxes so a covering neighbour can't hide it. */
    body.dmna-mode-active .dmna-note-box.is-chooser-pick {
      z-index: 10494;
      outline: 3px solid rgba(255, 200, 0, 0.95);
      outline-offset: 2px;
      box-shadow: 0 0 10px 4px rgba(255, 200, 0, 0.75);
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

    /* Touch-zone debug overlay: while the user holds the popover's zone
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
      width: 343px;
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
      left: ${343 / 2 - 8}px;
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
      gap: 12px;
      margin-bottom: 8px;
    }
    /* Body length vs Danbooru's 5000 limit, left of "view help". */
    #dmna-popover-header .dmna-popover-count {
      margin-left: auto;
      color: rgba(255, 255, 255, 0.4);
      font-size: 12px;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      user-select: none;
    }
    #dmna-popover-header .dmna-popover-count.is-over {
      color: #ff8b8b;
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
      /* 16px: iOS Safari zooms the page when a focused field is
         smaller. Applies to every text field and select (v5.1). */
      font-size: 16px;
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
      /* Containment: note markup may carry position / inset / z-index
         (NoteSanitizer allows them). Without a positioned, paint-
         contained box a previewed note could cover the popover's own
         buttons (v5.1). */
      position: relative;
      isolation: isolate;
      contain: paint;
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
    /* Preview is display-only: a tap on a rendered link must not
       navigate away from unsaved work. */
    #dmna-popover-preview a { pointer-events: none; }
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
       white "Aa" / undo icons stay legible at peak press. */
    .dmna-popover-side-btn:active {
      background: rgba(74, 158, 255, 0.26);
    }
    /* Hover / press text-color shift for the white-glyph side buttons
       (Aa / undo / touch zones). Undo's highlighted
       state has its own hue rule (specificity wins below). */
    .dmna-popover-side-btn:hover,
    .dmna-popover-side-btn:active {
      color: #1a1a1a;
    }
    /* Eye uses pointer events for press-and-hold, so it overrides
       touch-action to disable scroll/zoom while held. */
    #dmna-popover-eye { touch-action: none; }
    #dmna-popover-eye .dmna-zone-icon,
    #dmna-popover-undo .dmna-undo-icon {
      display: block;
      margin: 0 auto;
      pointer-events: none;
    }
    #dmna-popover-eye:active,
    #dmna-popover-eye.is-pressed {
      background: rgba(74, 158, 255, 0.30);
    }
    #dmna-popover-undo:active {
      background: rgba(74, 158, 255, 0.30);
    }
    /* Disabled state for the popover's interactive controls — used when
       the active note is soft-deleted, leaving only undo (highlighted) live. */
    #dmna-popover-input:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .dmna-popover-side-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .dmna-popover-side-btn:disabled:active {
      background: rgba(255, 255, 255, 0.06);
    }
    /* Overrides Danbooru's global button:disabled (cursor: wait + hover
       background), which would read as "busy" rather than "unavailable". */
    .dmna-popover-btn:disabled,
    .dmna-popover-btn:disabled:active {
      background: var(--form-button-background, #e8e8ec);
      color: var(--form-button-disabled-text-color, #777892);
      opacity: 0.6;
      cursor: not-allowed;
      box-shadow: none;
    }
    /* Highlighted undo on a soft-deleted note — accents the only live
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
    /* Text buttons in Danbooru's form-button colors (follow the site
       theme; fallbacks are the light-theme values) so the popover reads
       like the native note dialog. Height stays a touch target — the
       native 24 px buttons are too small for thumbs (v5.1). */
    .dmna-popover-btn {
      min-height: 36px;
      padding: 0;
      border-radius: 3px;
      border: 1px solid var(--form-button-border-color, #d1d1da);
      background: var(--form-button-background, #e8e8ec);
      color: var(--form-button-text-color, #1e1e2c);
      font-size: 13px;
      font-family: inherit;
      white-space: nowrap;
      cursor: pointer;
      user-select: none;
      touch-action: manipulation;
    }
    .dmna-popover-btn:active {
      background: var(--form-button-active-background, #d1d1da);
    }

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
    /* Delete sits next to Cancel; a dark red label (≥ 4.5:1 on both
       theme button greys) marks the destructive one. */
    .dmna-popover-btn[data-action="delete"]:not(:disabled) {
      color: #b71c1c;
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
      width: 240px;
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

    /* Send summary (v5.1): what Confirm is about to do, above the tags. */
    .dmna-tag-popover-summary {
      font-size: 13px;
      color: #dddddd;
      margin-bottom: 10px;
    }
    .dmna-tag-popover-summary-deleted {
      color: #ff8b8b;
      font-weight: bold;
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
      font-size: 16px;
      /* Height pinned so the 16px text (iOS zoom fix) doesn't grow
         the style popover. */
      height: 38px;
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
      font-size: 16px;
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
      font-size: 16px;
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
      font-size: 16px;
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
      font-size: 16px;
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
	function distanceToRect(x, y, rect) {
		const dx = Math.max(rect.left - x, 0, x - (rect.left + rect.width));
		const dy = Math.max(rect.top - y, 0, y - (rect.top + rect.height));
		return Math.hypot(dx, dy);
	}
	function clamp(v, lo, hi) {
		return Math.max(lo, Math.min(hi, v));
	}
	function getPostId() {
		const m = window.location.pathname.match(/^\/posts\/(\d+)/);
		return m ? m[1] : null;
	}
	function getImageDisplayRect(img) {
		const r = img.getBoundingClientRect();
		if (r.width === 0 || r.height === 0) return null;
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
		if (!originalWidth) return null;
		const scale = displayRect.width / originalWidth;
		return {
			x: (r.left - displayRect.left) / scale,
			y: (r.top - displayRect.top) / scale,
			w: r.width / scale,
			h: r.height / scale
		};
	}
	var DRAFT_KEY_PREFIX = "dmna_draft_";
	var NOTE_ID_RE = /^(?:\d+|temp-[A-Za-z0-9-]+)$/;
	var SERVER_NOTE_ID_RE = /^\d+$/;
	function isNoteIdString(v) {
		return typeof v === "string" && NOTE_ID_RE.test(v);
	}
	function draftKey() {
		const id = getPostId();
		return id ? DRAFT_KEY_PREFIX + id : null;
	}
	function safeSetItem(key, value) {
		try {
			localStorage.setItem(key, value);
			return true;
		} catch (err) {
			console.warn(`[MobileNoteAssist] localStorage.setItem("${key}") failed`, err);
			return false;
		}
	}
	function safeGetItem(key) {
		try {
			return localStorage.getItem(key);
		} catch (err) {
			console.warn(`[MobileNoteAssist] localStorage.getItem("${key}") failed`, err);
			return null;
		}
	}
	function safeRemoveItem(key) {
		try {
			localStorage.removeItem(key);
		} catch (err) {
			console.warn(`[MobileNoteAssist] localStorage.removeItem("${key}") failed`, err);
		}
	}
	function saveDraft(snapshot) {
		const key = draftKey();
		if (!key) return;
		const payload = {
			schemaVersion: 1,
			savedAt: Date.now(),
			...snapshot
		};
		safeSetItem(key, JSON.stringify(payload));
	}
	function loadDraft() {
		const key = draftKey();
		if (!key) return null;
		const raw = safeGetItem(key);
		if (!raw) return null;
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
		if (Date.now() - parsed.savedAt > 864e5) {
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
	function sweepExpiredDrafts(now = Date.now()) {
		try {
			const stale = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter((k) => !!k && k.startsWith(DRAFT_KEY_PREFIX)).filter((k) => !isLiveDraft(localStorage.getItem(k), now));
			stale.forEach((k) => localStorage.removeItem(k));
			return stale.length;
		} catch (err) {
			console.warn("[MobileNoteAssist] draft sweep skipped", err);
			return 0;
		}
	}
	function isLiveDraft(raw, now) {
		if (!raw) return false;
		try {
			const parsed = JSON.parse(raw);
			return isPersistedDraftV1(parsed) && now - parsed.savedAt <= 864e5;
		} catch {
			return false;
		}
	}
	function clearDraft() {
		const key = draftKey();
		if (key) safeRemoveItem(key);
	}
	function isPersistedDraftV1(v) {
		if (typeof v !== "object" || v === null) return false;
		const o = v;
		if (o.schemaVersion !== 1) return false;
		if (typeof o.savedAt !== "number") return false;
		if (o.mode !== "idle" && o.mode !== "active") return false;
		if (o.activeNoteId !== null && !isNoteIdString(o.activeNoteId)) return false;
		if (!Array.isArray(o.notes) || !Array.isArray(o.actionLog)) return false;
		if (!o.notes.every(isNotesEntry)) return false;
		if (!o.actionLog.every(isActionLogStackEntry)) return false;
		return true;
	}
	function isFiniteNumber(v) {
		return typeof v === "number" && Number.isFinite(v);
	}
	function isNoteState(v) {
		if (typeof v !== "object" || v === null) return false;
		const o = v;
		return isFiniteNumber(o.x) && isFiniteNumber(o.y) && isFiniteNumber(o.w) && isFiniteNumber(o.h) && typeof o.text === "string";
	}
	function isSerializedNote(v) {
		if (typeof v !== "object" || v === null) return false;
		const o = v;
		return isNoteState(o.current) && isNoteState(o.initialState) && isNoteState(o.confirmedState) && typeof o.isDeleted === "boolean" && typeof o.isServerNote === "boolean" && typeof o.everConfirmed === "boolean" && (o.uncertainPosts === void 0 || Array.isArray(o.uncertainPosts) && o.uncertainPosts.every(isNoteState));
	}
	function isNotesEntry(v) {
		if (!Array.isArray(v) || v.length !== 2) return false;
		const [id, note] = v;
		return isNoteIdString(id) && isSerializedNote(note) && note.isServerNote === SERVER_NOTE_ID_RE.test(id);
	}
	function isTextSnapshot(v) {
		if (typeof v !== "object" || v === null) return false;
		const o = v;
		return typeof o.text === "string" && isFiniteNumber(o.selectionStart) && isFiniteNumber(o.selectionEnd);
	}
	function isActionLogEntry(v) {
		if (typeof v !== "object" || v === null) return false;
		const o = v;
		if (!isNoteIdString(o.noteId)) return false;
		switch (o.type) {
			case "create": return o.prevState === null;
			case "edit":
			case "delete":
			case "transform": return isNoteState(o.prevState);
			case "text": return isTextSnapshot(o.prevState);
			default: return false;
		}
	}
	function isActionLogStackEntry(v) {
		if (!Array.isArray(v) || v.length !== 2) return false;
		if (!isNoteIdString(v[0]) || !Array.isArray(v[1])) return false;
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
	var ApiError = class extends Error {
		kind;
		status;
		detail;
		constructor(message, kind, status, detail = "") {
			super(message);
			this.kind = kind;
			this.status = status;
			this.detail = detail;
			this.name = "ApiError";
		}
	};
	async function timedFetch(url, init, read) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
		const timedOut = () => new ApiError(`Request timed out after ${REQUEST_TIMEOUT_MS / 1e3} s`, "timeout", null);
		try {
			let r;
			try {
				r = await fetch(url, {
					...init,
					signal: controller.signal
				});
			} catch (err) {
				if (controller.signal.aborted) throw timedOut();
				if (err instanceof TypeError) throw new ApiError(err.message || "Network error", "network", null);
				throw err;
			}
			try {
				return await read(r);
			} catch (err) {
				if (!(err instanceof ApiError) && controller.signal.aborted) throw timedOut();
				throw err;
			}
		} finally {
			clearTimeout(timer);
		}
	}
	function getJson(url) {
		return timedFetch(url, { credentials: "same-origin" }, (r) => {
			if (!r.ok) throw new ApiError(`HTTP ${r.status}`, "http", r.status);
			return r.json();
		});
	}
	function getCsrfToken() {
		const meta = document.querySelector("meta[name=\"csrf-token\"]");
		return meta ? meta.getAttribute("content") || "" : "";
	}
	async function apiCall(method, url, body) {
		const headers = {
			Accept: "application/json",
			"X-CSRF-Token": getCsrfToken()
		};
		const opts = {
			method,
			credentials: "same-origin",
			headers
		};
		if (body !== void 0 && body !== null) {
			headers["Content-Type"] = "application/json";
			opts.body = JSON.stringify(body);
		}
		return timedFetch(url, opts, async (r) => {
			if (!r.ok) {
				let detail = "";
				try {
					const errText = await r.text();
					if (errText) try {
						const errJson = JSON.parse(errText);
						detail = errJson.message || errJson.error || (Array.isArray(errJson.reasons) ? errJson.reasons.join("; ") : "") || (errJson.errors ? JSON.stringify(errJson.errors) : "") || errText;
					} catch (_parseErr) {
						detail = errText;
					}
				} catch (_readErr) {}
				const head = `HTTP ${r.status} ${r.statusText}`.trim();
				const truncated = detail.length > 200 ? detail.slice(0, 197) + "..." : detail;
				throw new ApiError(truncated ? `${head} — ${truncated}` : head, "http", r.status, truncated);
			}
			const text = await r.text();
			return text ? JSON.parse(text) : null;
		});
	}
	var postOriginalWidth = 0;
	var postOriginalHeight = 0;
	var postMetaPromise = null;
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
		if (cachedW && cachedH) return Promise.resolve({
			width: cachedW,
			height: cachedH
		});
		const inFlight = getPostMetaPromise();
		if (inFlight) return inFlight;
		const id = getPostId();
		if (!id) return Promise.reject(new Error("No post id in URL"));
		const p = getJson(`/posts/${id}.json?only=image_width,image_height`).then((data) => {
			const w = Number(data.image_width) || 0;
			const h = Number(data.image_height) || 0;
			if (!w || !h) throw new Error("Image dimensions missing in response");
			setPostMeta(w, h);
			return {
				width: w,
				height: h
			};
		}).catch((err) => {
			setPostMetaPromise(null);
			throw err;
		});
		setPostMetaPromise(p);
		return p;
	}
	function fetchPostTagString() {
		const id = getPostId();
		if (!id) return Promise.reject(new Error("No post id in URL"));
		return getJson(`/posts/${id}.json?only=tag_string`).then((data) => String(data.tag_string || ""));
	}
	async function apiPatchPostTags({ tagsToAdd, tagsToRemove, baseTagString }) {
		const tags = new Set(baseTagString.split(/\s+/).filter(Boolean));
		tagsToAdd.forEach((t) => tags.add(t));
		tagsToRemove.forEach((t) => tags.delete(t));
		return apiCall("PUT", `/posts/${getPostId()}.json`, { post: {
			old_tag_string: baseTagString,
			tag_string: [...tags].join(" ")
		} });
	}
	var NOTES_PAGE_SIZE = 1e3;
	var NOTES_MAX_PAGES = 5;
	var serverNotesInFlight = null;
	function fetchServerNotes() {
		if (serverNotesInFlight) return serverNotesInFlight;
		const id = getPostId();
		if (!id) return Promise.reject(new Error("No post id in URL"));
		const p = fetchAllPages(id).finally(() => {
			serverNotesInFlight = null;
		});
		serverNotesInFlight = p;
		return p;
	}
	async function fetchAllPages(postId) {
		const base = `/notes.json?search%5Bpost_id%5D=${postId}&search%5Bis_active%5D=true&limit=${NOTES_PAGE_SIZE}`;
		let all = [];
		let cursor = "";
		for (let i = 0; i < NOTES_MAX_PAGES; i++) {
			const page = await getJson(base + cursor);
			all = all.concat(page);
			if (page.length < NOTES_PAGE_SIZE) break;
			cursor = `&page=b${Math.min(...page.map((n) => n.id))}`;
		}
		return all;
	}
	async function apiPostNote(state) {
		return apiCall("POST", "/notes.json", newNoteParams(state));
	}
	function newNoteParams(state) {
		return { note: {
			post_id: Number(getPostId()),
			x: Math.round(state.x),
			y: Math.round(state.y),
			width: Math.round(state.w),
			height: Math.round(state.h),
			body: state.text || ""
		} };
	}
	function assertServerNoteId(serverId) {
		if (!/^\d+$/.test(serverId)) throw new Error(`Refusing request: invalid server note id ${JSON.stringify(serverId)}`);
	}
	async function apiPutNote(serverId, state) {
		assertServerNoteId(serverId);
		const payload = { note: {
			x: Math.round(state.x),
			y: Math.round(state.y),
			width: Math.round(state.w),
			height: Math.round(state.h),
			body: state.text || ""
		} };
		return apiCall("PUT", `/notes/${serverId}.json`, payload);
	}
	async function apiDeleteNote(serverId) {
		assertServerNoteId(serverId);
		return apiCall("DELETE", `/notes/${serverId}.json`, null);
	}
	async function apiPreviewNote(state) {
		const res = await apiCall("POST", "/notes/preview.json", newNoteParams(state));
		if (res === null) throw new Error("Empty preview response");
		if (typeof res.sanitized_body !== "string") throw new Error("Malformed preview response: sanitized_body missing");
		return res;
	}
	var NATIVE_TRANSLATION_CLASS = "mode-translation";
	var NATIVE_EDITING_BOX_SELECTOR = ".note-box.editing";
	var NATIVE_EDIT_DIALOG_SELECTOR = ".ui-dialog.note-edit-dialog";
	var isNativeActive = false;
	var observer = null;
	var subscribers = new Set();
	function detectEditDialog() {
		if (document.querySelector(NATIVE_EDITING_BOX_SELECTOR) !== null) return true;
		const dialog = document.querySelector(NATIVE_EDIT_DIALOG_SELECTOR);
		return dialog instanceof HTMLElement && dialog.style.display !== "none";
	}
	function detect() {
		return document.body.classList.contains(NATIVE_TRANSLATION_CLASS) || detectEditDialog();
	}
	function recompute() {
		const next = detect();
		if (next === isNativeActive) return;
		isNativeActive = next;
		for (const cb of subscribers) cb(next);
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
		if (observer !== null) return;
		isNativeActive = detect();
		observer = new MutationObserver(recompute);
		observer.observe(document.body, {
			attributes: true,
			attributeFilter: ["class"],
			childList: true,
			subtree: true
		});
	}
	function serverNoteBodyLength(body) {
		return [...body.normalize("NFC").replace(/[\u180E\u200B\u200C\u2060\uFEFF]/g, "").replace(/[\p{Zs}\t]/gu, " ").replace(/\r?\n|\r|\v|\f|\u0085|\u2028|\u2029/g, "\r\n").replace(/^[\0\t\n\v\f\r ]+|[\0\t\n\v\f\r ]+$/g, "")].length;
	}
	var hooks$3 = null;
	function initNotesStore(h) {
		hooks$3 = h;
	}
	var mode = "idle";
	var activeNoteId = null;
	var activeModeGen = 0;
	var notes = new Map();
	var actionLog = new Map();
	function getMode() {
		return mode;
	}
	function getActiveNoteId() {
		return activeNoteId;
	}
	function genNoteId() {
		if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return asTempNoteId("temp-" + crypto.randomUUID());
		return asTempNoteId("temp-" + Math.random().toString(36).slice(2) + Date.now().toString(36));
	}
	function isDirty(note) {
		if (!note.isServerNote) return true;
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
		if (type === "create") stack.push({
			noteId,
			type,
			prevState: null
		});
		else if (prevState !== null) stack.push({
			noteId,
			type,
			prevState
		});
	}
	function pushTextAction(noteId, prevState) {
		let stack = actionLog.get(noteId);
		if (!stack) {
			stack = [];
			actionLog.set(noteId, stack);
		}
		stack.push({
			noteId,
			type: "text",
			prevState
		});
	}
	function clearTextActionsForNote(noteId) {
		const stack = actionLog.get(noteId);
		if (!stack) return;
		const filtered = stack.filter((e) => e.type !== "text");
		if (filtered.length === 0) actionLog.delete(noteId);
		else actionLog.set(noteId, filtered);
	}
	function discardAll() {
		for (const id of [...notes.keys()]) hooks$3.onNoteRemoved(id);
		notes.clear();
		actionLog.clear();
		setActiveNote(null);
	}
	function setMode(newMode) {
		if (mode === newMode) return;
		if (newMode === "active" && getIsNativeActive()) {
			hooks$3.onToast("Danbooru's native note UI is active — close it first", "info");
			return;
		}
		mode = newMode;
		hooks$3.onModeChanged(newMode);
		if (newMode === "active") {
			document.body.classList.add("dmna-mode-active");
			activeModeGen++;
			enterActiveMode(activeModeGen);
		} else {
			activeModeGen++;
			discardAll();
			document.body.classList.remove("dmna-mode-active");
			const noteContainer = document.querySelector(".note-container");
			if (noteContainer) noteContainer.classList.remove("hide-notes");
		}
	}
	async function enterActiveMode(gen) {
		try {
			await fetchPostMeta();
		} catch (err) {
			if (gen !== activeModeGen) return;
			hooks$3.onToast("⚠️ Failed to load image info", "error", err);
			return;
		}
		if (gen !== activeModeGen || mode !== "active") return;
		let serverNotes;
		try {
			serverNotes = await fetchServerNotes();
		} catch (err) {
			if (gen !== activeModeGen) return;
			hooks$3.onToast("⚠️ Failed to load existing notes", "error", err);
			return;
		}
		if (gen !== activeModeGen || mode !== "active") return;
		const added = serverNotes.flatMap((sn) => {
			const id = insertServerNote(sn);
			return id ? [id] : [];
		});
		if (added.length > 0) hooks$3.onNotesAdded(added);
	}
	function toggleEditMode() {
		if (getMode() === "active") {
			tryDeactivate();
			if (getMode() === "idle") hooks$3.onToast("Edit mode off", "info");
		} else {
			setMode("active");
			if (getMode() === "active") hooks$3.onToast("Edit mode on", "info");
		}
	}
	function tryDeactivate() {
		if (hooks$3.hasPendingChanges()) {
			if (window.confirm("Discard all changes and turn off?")) setMode("idle");
			else hooks$3.onReopenMenuRequested();
		} else setMode("idle");
	}
	function setActiveNote(noteId) {
		if (activeNoteId === noteId) return;
		if (activeNoteId !== null && noteId !== null) {
			if (isOverLengthLimit(activeNoteId)) {
				hooks$3.onToast(`⚠️ Over ${NOTE_BODY_MAX_LENGTH} characters — shorten and Commit, or Cancel / Delete`, "warning");
				return;
			}
			settleFreshNoteOnSwitch(activeNoteId);
		}
		const prev = activeNoteId;
		activeNoteId = noteId;
		hooks$3.onActiveChanged(prev, noteId);
	}
	function isOverLengthLimit(id) {
		const note = notes.get(id);
		return !!note && !note.isDeleted && serverNoteBodyLength(note.current.text) > 5e3;
	}
	function settleFreshNoteOnSwitch(id) {
		const note = notes.get(id);
		if (!note || note.isServerNote || note.everConfirmed) return;
		if (note.current.text.trim()) commitCheckpoint(id, note);
		else hardDeleteNote(id);
	}
	function commitCheckpoint(noteId, note) {
		pushAction(noteId, "edit", { ...note.confirmedState });
		note.confirmedState = { ...note.current };
		note.everConfirmed = true;
	}
	function popoverUndo(noteId) {
		const stack = actionLog.get(noteId);
		if (!stack || stack.length === 0) {
			hooks$3.onToast("Nothing to undo for this note", "info");
			return;
		}
		const entry = stack.pop();
		if (stack.length === 0) actionLog.delete(noteId);
		if (entry.type === "create") {
			hardDeleteNote(noteId);
			return;
		}
		const note = notes.get(noteId);
		if (!note) return;
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
		if (!note) return;
		commitCheckpoint(noteId, note);
		setActiveNote(null);
	}
	function popoverCancel(noteId) {
		const note = notes.get(noteId);
		if (!note) return;
		if (!note.isServerNote && !note.everConfirmed) {
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
		if (!note) return;
		if (!note.isServerNote && !note.everConfirmed) hardDeleteNote(noteId);
		else {
			pushAction(noteId, "delete", { ...note.current });
			note.isDeleted = true;
			setActiveNote(null);
		}
	}
	function hardDeleteNote(id) {
		if (activeNoteId === id) setActiveNote(null);
		hooks$3.onNoteRemoved(id);
		notes.delete(id);
		actionLog.delete(id);
	}
	function insertServerNote(sn) {
		const id = asServerNoteId(sn.id);
		if (notes.has(id)) return null;
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
		return id;
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
		for (const note of notes.values()) if (!note.isServerNote && !note.everConfirmed && !note.isDeleted && note.current.text.trim()) return true;
		return false;
	}
	function serializeForDraft() {
		const serializedNotes = [];
		for (const [id, note] of notes.entries()) serializedNotes.push([id, {
			current: { ...note.current },
			initialState: { ...note.initialState },
			confirmedState: { ...note.confirmedState },
			isDeleted: note.isDeleted,
			isServerNote: note.isServerNote,
			everConfirmed: note.everConfirmed,
			...note.uncertainPosts?.length ? { uncertainPosts: note.uncertainPosts.map((s) => ({ ...s })) } : {}
		}]);
		const serializedActionLog = [];
		for (const [id, stack] of actionLog.entries()) serializedActionLog.push([id, stack.map((e) => ({ ...e }))]);
		return {
			mode,
			activeNoteId,
			notes: serializedNotes,
			actionLog: serializedActionLog
		};
	}
	async function applyDraftSnapshot(snapshot) {
		for (const id of [...notes.keys()]) hooks$3.onNoteRemoved(id);
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
				...snote.uncertainPosts?.length ? { uncertainPosts: snote.uncertainPosts.map((s) => ({ ...s })) } : {},
				domElement: null
			};
			notes.set(noteId, note);
		}
		for (const [rawId, entries] of snapshot.actionLog) {
			const noteId = rebrandNoteId(rawId);
			const rebranded = entries.map((e) => {
				switch (e.type) {
					case "create": return {
						noteId,
						type: "create",
						prevState: null
					};
					case "edit": return {
						noteId,
						type: "edit",
						prevState: e.prevState
					};
					case "delete": return {
						noteId,
						type: "delete",
						prevState: e.prevState
					};
					case "transform": return {
						noteId,
						type: "transform",
						prevState: e.prevState
					};
					case "text": return {
						noteId,
						type: "text",
						prevState: e.prevState
					};
				}
			});
			actionLog.set(noteId, rebranded);
		}
		if (snapshot.mode === "active") try {
			await fetchPostMeta();
		} catch (err) {
			hooks$3.onToast("⚠️ Failed to load image info", "error", err);
		}
		setMode(snapshot.mode);
		if (notes.size > 0) hooks$3.onNotesAdded([...notes.keys()]);
		if (snapshot.activeNoteId !== null) {
			const activeId = rebrandNoteId(snapshot.activeNoteId);
			if (notes.has(activeId)) setActiveNote(activeId);
		}
	}
	function rebrandNoteId(rawId) {
		return rawId.startsWith("temp-") ? asTempNoteId(rawId) : asServerNoteId(rawId);
	}
	function hasPendingChanges() {
		for (const note of notes.values()) if (note.isServerNote) {
			if (note.isDeleted) return true;
			const a = note.current;
			const b = note.initialState;
			if (a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h || a.text !== b.text) return true;
		} else if (note.everConfirmed && !note.isDeleted) return true;
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
		for (const [noteId, note] of notes.entries()) if (note.isServerNote) {
			if (!isServerNoteId(noteId)) continue;
			if (note.isDeleted) {
				deletes.push({
					noteId,
					serverId: noteId
				});
				continue;
			}
			const a = note.current;
			const b = note.initialState;
			const geomChanged = a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h;
			const textChanged = a.text !== b.text;
			if (geomChanged || textChanged) puts.push({
				noteId,
				serverId: noteId,
				state: { ...a },
				textChanged
			});
			else dropped.unchangedServer.push(noteId);
		} else if (note.isDeleted) dropped.softDeletedTemps.push(noteId);
		else if (!note.everConfirmed) dropped.uncommittedTemps.push(noteId);
		else posts.push({
			noteId,
			state: { ...note.current }
		});
		return {
			posts,
			puts,
			deletes,
			dropped,
			hasChanges: posts.length > 0 || puts.length > 0 || deletes.length > 0
		};
	}
	function summarizeChanges(c) {
		const textEdited = c.puts.filter((p) => p.textChanged).length;
		return {
			created: c.posts.length,
			textEdited,
			movedOnly: c.puts.length - textEdited,
			deleted: c.deletes.length
		};
	}
	function needsTagPopover(c) {
		if (c.posts.length > 0) return true;
		if (c.deletes.length > 0) return true;
		return c.puts.some((p) => p.textChanged);
	}
	function normalizeNoteBody(body) {
		return body.normalize("NFC").replace(/[\u180E\u200B\u200C\u2060\uFEFF]/g, "").replace(/[\s\u0085]+/g, " ").trim();
	}
	function sameNote(state, sn) {
		return Math.round(state.x) === sn.x && Math.round(state.y) === sn.y && Math.round(state.w) === sn.width && Math.round(state.h) === sn.height && normalizeNoteBody(state.text || "") === normalizeNoteBody(sn.body || "");
	}
	function matchCommittedPosts(failedPosts, serverNotes, knownServerIds) {
		const candidates = serverNotes.filter((sn) => !knownServerIds.has(String(sn.id)));
		const used = new Set();
		return failedPosts.flatMap((post) => {
			const serverNote = candidates.find((sn) => !used.has(sn) && sameNote(post.state, sn));
			if (!serverNote) return [];
			used.add(serverNote);
			return [{
				post,
				serverNote
			}];
		});
	}
	var hooks$2 = null;
	function initConfirmFlow(h) {
		hooks$2 = h;
	}
	var isSending = false;
	var isInConfirmPipeline = false;
	var draftSaveBlocked = false;
	var errorModalElement = null;
	var errorModalBackdropElement = null;
	var pendingErrorModalResolver = null;
	function getIsSending() {
		return isSending;
	}
	function getIsDraftSaveBlocked() {
		return draftSaveBlocked;
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
		const result = emptyResult();
		let rateLimited = false;
		const noteFailure = (label, err) => {
			console.error(`[${SCRIPT_NAME}] ${label} failed`, err);
			if (err instanceof ApiError && err.status === 429) rateLimited = true;
			return errMessage(err);
		};
		startSendingUI();
		try {
			for (const item of classified.deletes) {
				if (rateLimited) {
					result.failed.deletes.push({
						...item,
						error: RATE_LIMIT_SKIP,
						skipped: true
					});
					continue;
				}
				try {
					await apiDeleteNote(item.serverId);
					result.successful.deletes.push(item);
				} catch (err) {
					const error = noteFailure(`DELETE note ${item.serverId}`, err);
					result.failed.deletes.push({
						...item,
						error
					});
				}
			}
			for (const item of classified.puts) {
				if (rateLimited) {
					result.failed.puts.push({
						...item,
						error: RATE_LIMIT_SKIP,
						skipped: true
					});
					continue;
				}
				try {
					await apiPutNote(item.serverId, item.state);
					result.successful.puts.push(item);
				} catch (err) {
					const error = noteFailure(`PUT note ${item.serverId}`, err);
					result.failed.puts.push({
						...item,
						error
					});
				}
			}
			for (const item of classified.posts) {
				if (rateLimited) {
					result.failed.posts.push({
						...item,
						error: RATE_LIMIT_SKIP,
						skipped: true
					});
					continue;
				}
				try {
					const serverResponse = await apiPostNote(item.state);
					result.successful.posts.push({
						...item,
						serverResponse
					});
				} catch (err) {
					const error = noteFailure(`POST temp ${item.noteId}`, err);
					result.failed.posts.push({
						...item,
						error,
						unverified: !isRefusal(err)
					});
				}
			}
			if (tagDelta && (tagDelta.tagsToAdd.length > 0 || tagDelta.tagsToRemove.length > 0)) {
				if (rateLimited) result.failed.tagPatch = RATE_LIMIT_SKIP;
				else try {
					await apiPatchPostTags(tagDelta);
				} catch (err) {
					result.failed.tagPatch = noteFailure("tag PATCH", err);
				}
			}
			result.rateLimited = rateLimited;
		} finally {
			endSendingUI();
		}
		return result;
	}
	function applyServerStateToLocal(result) {
		for (const item of result.successful.posts) {
			const sr = item.serverResponse;
			if (!sr || typeof sr.id !== "number") continue;
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
			if (!note) continue;
			note.initialState = { ...note.current };
			note.confirmedState = { ...note.current };
			actionLog.delete(item.noteId);
			hooks$2.onNoteVisualsChanged(item.noteId);
		}
		for (const item of result.successful.deletes) hardDeleteNote(item.noteId);
	}
	function buildFailureLines(result) {
		const lines = [];
		for (const f of result.failed.deletes) lines.push(`DELETE note ${f.serverId}: ${f.error}`);
		for (const f of result.failed.puts) lines.push(`PUT note ${f.serverId}: ${f.error}`);
		for (const f of result.failed.posts) {
			const suffix = f.unverified ? " (server state unverified)" : "";
			lines.push(`POST new note: ${f.error}${suffix}`);
		}
		if (result.failed.tagPatch) lines.push(`Tag PATCH: ${result.failed.tagPatch}`);
		return lines;
	}
	function countSendResult(result) {
		const s = result.successful;
		const f = result.failed;
		return {
			successCount: s.posts.length + s.puts.length + s.deletes.length,
			failureCount: f.posts.length + f.puts.length + f.deletes.length + (f.tagPatch ? 1 : 0)
		};
	}
	function emptyResult() {
		return {
			successful: {
				posts: [],
				puts: [],
				deletes: []
			},
			failed: {
				posts: [],
				puts: [],
				deletes: [],
				tagPatch: null
			}
		};
	}
	function isRefusal(err) {
		return err instanceof ApiError && err.kind === "http" && err.status !== null && err.status < 500;
	}
	var RATE_LIMIT_SKIP = "Skipped — rate limited";
	var NOT_RESENT = "not re-sent — the server could not be checked";
	var RATE_LIMIT_NOTE = "Rate limited by Danbooru — wait about a minute, then Retry.";
	var UNVERIFIED_TOAST = "Can't verify what the server saved — check your connection and retry";
	async function findCommittedPosts(posts, extraKnownIds) {
		let serverNotes;
		try {
			serverNotes = await fetchServerNotes();
		} catch (err) {
			console.warn(`[${SCRIPT_NAME}] could not verify failed POSTs`, err);
			return null;
		}
		const known = new Set([...[...notes.keys()].filter(isServerNoteId), ...extraKnownIds.map(String)]);
		const pairs = matchCommittedPosts(posts, serverNotes, known);
		const matched = new Set(pairs.map((p) => p.post));
		return {
			committed: pairs.map(({ post, serverNote }) => ({
				noteId: post.noteId,
				state: post.state,
				serverResponse: serverNote
			})),
			rest: posts.filter((p) => !matched.has(p))
		};
	}
	async function reconcileFailedPosts(result) {
		const uncertain = result.failed.posts.filter((p) => p.unverified && !p.skipped);
		if (uncertain.length === 0) return result;
		const found = await findCommittedPosts(uncertain, result.successful.posts.flatMap((p) => typeof p.serverResponse?.id === "number" ? [p.serverResponse.id] : []));
		if (!found || found.committed.length === 0) return result;
		const adopted = new Set(found.committed.map((c) => c.noteId));
		return {
			...result,
			successful: {
				...result.successful,
				posts: [...result.successful.posts, ...found.committed]
			},
			failed: {
				...result.failed,
				posts: result.failed.posts.filter((p) => !adopted.has(p.noteId))
			}
		};
	}
	function sameState(a, b) {
		return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h && a.text === b.text;
	}
	async function findStoredPosts(flagged) {
		let serverNotes;
		try {
			serverNotes = await fetchServerNotes();
		} catch (err) {
			console.warn(`[${SCRIPT_NAME}] could not check unverified POSTs`, err);
			return null;
		}
		const excluded = new Set([...notes.entries()].filter(([id, n]) => isServerNoteId(id) && (n.isDeleted || isDirty(n))).map(([id]) => id));
		const pairs = matchCommittedPosts(flagged.flatMap((p) => (notes.get(p.noteId)?.uncertainPosts ?? []).map((state) => ({
			noteId: p.noteId,
			state
		}))), serverNotes, excluded);
		return pairs.filter((m, i) => pairs.findIndex((o) => o.post.noteId === m.post.noteId) === i).map(({ post, serverNote }) => ({
			noteId: post.noteId,
			sent: post.state,
			serverNote
		}));
	}
	function adoptStoredPost({ noteId, sent, serverNote: sn }) {
		const temp = notes.get(noteId);
		if (!temp) return;
		const serverId = asServerNoteId(sn.id);
		const stored = {
			x: sn.x,
			y: sn.y,
			w: sn.width,
			h: sn.height,
			text: sn.body ?? ""
		};
		const edited = !sameState(temp.current, sent);
		const note = notes.get(serverId) ?? {
			current: { ...stored },
			initialState: { ...stored },
			confirmedState: { ...stored },
			isDeleted: false,
			isServerNote: true,
			everConfirmed: true,
			domElement: null
		};
		if (edited) {
			note.current = { ...temp.current };
			note.confirmedState = { ...temp.current };
			note.everConfirmed = true;
		}
		hardDeleteNote(noteId);
		notes.set(serverId, note);
		hooks$2.onNoteRenderRequested(serverId);
	}
	async function sendChecked(classified, tagDelta) {
		const flagged = classified.posts.filter((p) => notes.get(p.noteId)?.uncertainPosts?.length);
		let batch = classified;
		let heldBack = [];
		if (flagged.length > 0) {
			startSendingUI();
			let found;
			try {
				found = await findStoredPosts(flagged);
			} finally {
				endSendingUI();
			}
			if (!found) {
				hooks$2.onToast(UNVERIFIED_TOAST, "warning");
				heldBack = flagged.map((p) => ({
					...p,
					error: NOT_RESENT,
					unverified: true,
					skipped: true
				}));
				batch = {
					...classified,
					posts: classified.posts.filter((p) => !flagged.includes(p))
				};
			} else if (found.length > 0) {
				found.forEach(adoptStoredPost);
				batch = classifyChanges();
			}
		}
		const hasTagChange = !!tagDelta && (tagDelta.tagsToAdd.length > 0 || tagDelta.tagsToRemove.length > 0);
		const result = batch.posts.length > 0 || batch.puts.length > 0 || batch.deletes.length > 0 || hasTagChange ? await sendBatch(batch, tagDelta) : emptyResult();
		result.failed.posts.push(...heldBack);
		return result;
	}
	async function handleSendResult(sent, tagDelta) {
		const result = await reconcileFailedPosts(sent);
		applyServerStateToLocal(result);
		for (const p of result.failed.posts) {
			const note = notes.get(p.noteId);
			if (note && p.unverified && !p.skipped) {
				const known = note.uncertainPosts ?? [];
				if (!known.some((s) => sameState(s, p.state))) note.uncertainPosts = [...known, { ...p.state }];
			}
		}
		if (!(result.failed.posts.length > 0 || result.failed.puts.length > 0 || result.failed.deletes.length > 0 || result.failed.tagPatch !== null)) {
			actionLog.clear();
			clearDraft();
			document.body.classList.add("dmna-send-success");
			hooks$2.onToast("✓ Saved", "success");
			setTimeout(() => {
				setMode("idle");
				window.location.reload();
			}, 1e3);
			return;
		}
		if (await showErrorModal(result) !== "retry") return;
		const classified = classifyChanges();
		const retryTagDelta = result.failed.tagPatch ? tagDelta : null;
		if (!classified.hasChanges && !retryTagDelta) {
			hooks$2.onToast("Nothing left to retry", "info");
			return;
		}
		await handleSendResult(await sendChecked(classified, retryTagDelta), retryTagDelta);
	}
	function createErrorModal() {
		if (errorModalElement) return;
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
		const summaryEl = errorModalElement.querySelector("#dmna-error-modal-summary");
		if (summaryEl) summaryEl.textContent = `${successCount} of ${total} operation(s) succeeded; ${failureCount} failed.` + (result.rateLimited ? ` ${RATE_LIMIT_NOTE}` : "");
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
		if (errorModalBackdropElement) errorModalBackdropElement.classList.remove("show");
		if (errorModalElement) errorModalElement.classList.remove("show");
		document.removeEventListener("keydown", errorModalKeyHandler, true);
	}
	function submitErrorModal(choice) {
		const resolver = pendingErrorModalResolver;
		if (!resolver) return;
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
		if (isSending || isInConfirmPipeline) return;
		isInConfirmPipeline = true;
		try {
			setActiveNote(null);
			const classified = classifyChanges();
			if (!classified.hasChanges) {
				hooks$2.onToast("No changes to confirm", "info");
				return;
			}
			const tagDelta = await hooks$2.showTagPopover(summarizeChanges(classified), needsTagPopover(classified));
			if (tagDelta === null) return;
			clearDraft();
			draftSaveBlocked = true;
			await handleSendResult(await sendChecked(classified, tagDelta), tagDelta);
		} finally {
			isInConfirmPipeline = false;
			draftSaveBlocked = false;
		}
	}
	function isTextInputElement(el) {
		if (!el) return false;
		if (el.isContentEditable === true) return true;
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
	var TOAST_PRESETS = {
		info: {
			className: "",
			duration: 2500
		},
		success: {
			className: "dmna-toast-success",
			duration: 1800
		},
		warning: {
			className: "dmna-toast-warning",
			duration: 3e3
		},
		error: {
			className: "dmna-toast-error",
			duration: 4500
		}
	};
	var toastElement = null;
	var toastMsgElement = null;
	var toastActionsElement = null;
	var toastTimer = null;
	function ensureToastDOM() {
		if (toastElement) return;
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
		toastElement.offsetWidth;
		toastElement.className = `show ${preset.className}`.trim();
		if (toastTimer) clearTimeout(toastTimer);
		toastTimer = setTimeout(() => {
			if (toastElement) toastElement.className = "";
		}, preset.duration);
		if (type === "error" || type === "warning") {
			const logFn = type === "error" ? console.error : console.warn;
			const tag = `[${SCRIPT_NAME}]`;
			if (err !== void 0) logFn(tag, msg, err);
			else logFn(tag, msg);
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
		toastElement.offsetWidth;
		toastElement.className = "show has-actions";
		if (toastTimer) {
			clearTimeout(toastTimer);
			toastTimer = null;
		}
	}
	function hideToast() {
		if (toastElement) toastElement.className = "";
		if (toastTimer) {
			clearTimeout(toastTimer);
			toastTimer = null;
		}
	}
	function updateToastPosition() {
		if (!toastElement) return;
		const vv = window.visualViewport;
		if (!vv) {
			const scrollX = window.pageXOffset;
			const scrollY = window.pageYOffset;
			toastElement.style.transform = `translate(${scrollX + window.innerWidth / 2}px, ${scrollY + window.innerHeight - 20}px) translate(-50%, 0)`;
			return;
		}
		const invScale = 1 / vv.scale;
		const tx = vv.pageLeft + vv.width / 2;
		const ty = vv.pageTop + vv.height - 20 * invScale;
		toastElement.style.transform = `translate(${tx}px, ${ty}px) scale(${invScale}) translate(-50%, -100%)`;
	}
	var ICON_IDLE = "📝";
	var ICON_ACTIVE = "✏️";
	var floatBtnElement = null;
	var initialStoredX = parseInt(safeGetItem("dmna_btn_margin_x") ?? "", 10);
	var userBtnMarginX = Number.isFinite(initialStoredX) ? initialStoredX : 20;
	var initialStoredY = parseInt(safeGetItem("dmna_btn_margin_y") ?? "", 10);
	var userBtnMarginY = Number.isFinite(initialStoredY) ? initialStoredY : 80;
	safeRemoveItem(LEGACY_STATE_KEY);
	var nativeActiveHide = false;
	var isDraggingBtn = false;
	var isPressing = false;
	var longPressTimer = null;
	var dragStartX = 0;
	var dragStartY = 0;
	var dragStartMarginX = 0;
	var dragStartMarginY = 0;
	var lastBtnTapTime = 0;
	function getButtonMargins() {
		return {
			marginX: userBtnMarginX,
			marginY: userBtnMarginY
		};
	}
	function setFloatingButtonIcon(icon) {
		if (floatBtnElement) floatBtnElement.textContent = icon;
	}
	function setFloatingButtonIconForMode() {
		setFloatingButtonIcon(getMode() === "active" ? ICON_ACTIVE : ICON_IDLE);
	}
	function setFloatingButtonPendingCount(count) {
		if (!floatBtnElement) return;
		if (count > 0) floatBtnElement.dataset.pendingCount = count > 99 ? "99+" : String(count);
		else delete floatBtnElement.dataset.pendingCount;
	}
	function createFloatingButton() {
		if (document.getElementById("dmna-float-btn")) return;
		const btn = document.createElement("div");
		btn.id = "dmna-float-btn";
		btn.textContent = ICON_IDLE;
		setupButtonInteractions(btn);
		document.body.appendChild(btn);
		floatBtnElement = btn;
		document.addEventListener("focus", () => updateHiddenState(), true);
		document.addEventListener("blur", () => {
			setTimeout(updateHiddenState, 100);
		}, true);
	}
	function updateHiddenState() {
		if (!floatBtnElement) return;
		if (isTextInputElement(document.activeElement) || nativeActiveHide) floatBtnElement.classList.add("dmna-hidden");
		else floatBtnElement.classList.remove("dmna-hidden");
	}
	function setNativeActiveHide(active) {
		nativeActiveHide = active;
		updateHiddenState();
	}
	function updateFloatingButtonPosition() {
		if (!floatBtnElement) return;
		const vv = window.visualViewport;
		if (!vv) {
			const scrollX = window.pageXOffset;
			const scrollY = window.pageYOffset;
			const bx = scrollX + window.innerWidth - userBtnMarginX - 40;
			const by = scrollY + window.innerHeight - userBtnMarginY - 40;
			floatBtnElement.style.transform = `translate(${bx}px, ${by}px)`;
			return;
		}
		const invScale = 1 / vv.scale;
		const bx = vv.pageLeft + vv.width - (userBtnMarginX + 40) * invScale;
		const by = vv.pageTop + vv.height - (userBtnMarginY + 40) * invScale;
		floatBtnElement.style.transform = `translate(${bx}px, ${by}px) scale(${invScale})`;
	}
	function setupButtonInteractions(btn) {
		const handleStart = (e) => {
			if (e.type === "touchstart") e.preventDefault();
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
					if (navigator.vibrate) navigator.vibrate(50);
					showToast("✥ Drag to reposition", "info");
				}
			}, LONG_PRESS_DURATION);
		};
		const handleMove = (e) => {
			if (e.type === "touchmove") {
				e.preventDefault();
				e.stopPropagation();
			}
			if (!isPressing) return;
			const isTouch = e.type.startsWith("touch");
			const clientX = isTouch ? e.touches[0].clientX : e.clientX;
			const clientY = isTouch ? e.touches[0].clientY : e.clientY;
			if (isDraggingBtn) {
				const dx = clientX - dragStartX;
				const dy = clientY - dragStartY;
				const screenW = window.innerWidth;
				const screenH = window.innerHeight;
				let newMarginX = dragStartMarginX - dx;
				let newMarginY = dragStartMarginY - dy;
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
		const releasePress = () => {
			if (longPressTimer) {
				clearTimeout(longPressTimer);
				longPressTimer = null;
			}
			isPressing = false;
			if (!isDraggingBtn) return false;
			isDraggingBtn = false;
			btn.classList.remove("dragging");
			safeSetItem(POS_X_KEY, String(userBtnMarginX));
			safeSetItem(POS_KEY, String(userBtnMarginY));
			return true;
		};
		const handleEnd = (e) => {
			if (e.type === "touchend") e.preventDefault();
			if (!releasePress()) {
				const isTouch = e.type.startsWith("touch");
				const endX = isTouch ? e.changedTouches[0].clientX : e.clientX;
				const endY = isTouch ? e.changedTouches[0].clientY : e.clientY;
				const dx = endX - dragStartX;
				const dy = endY - dragStartY;
				if (Math.hypot(dx, dy) < 10) {
					const now = Date.now();
					if (now - lastBtnTapTime < 300) {
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
		btn.addEventListener("touchcancel", () => {
			releasePress();
		});
		btn.addEventListener("mousedown", handleStart);
		document.addEventListener("mousemove", (e) => {
			if (isPressing) handleMove(e);
		});
		btn.addEventListener("mouseup", handleEnd);
	}
	var hooks$1 = null;
	function initArcMenu(h) {
		hooks$1 = h;
	}
	var menuElement = null;
	var isMenuOpen = false;
	var outsideClickListenerBound = false;
	function createArcMenu() {
		if (document.getElementById("dmna-menu")) return;
		const m = document.createElement("div");
		m.id = "dmna-menu";
		const items = [{
			action: "confirm",
			icon: "✅",
			label: "Confirm"
		}, {
			action: "edit",
			icon: "✏️",
			label: "Edit"
		}];
		const r = 70;
		const half = 20;
		const center = 20;
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
		if (isMenuOpen || !menuElement) return;
		updateArcMenuPosition();
		isMenuOpen = true;
		menuElement.classList.add("open");
		const btn = document.getElementById("dmna-float-btn");
		if (btn) btn.classList.add("expanded");
		if (!outsideClickListenerBound) {
			document.addEventListener("click", outsideClickHandler, true);
			document.addEventListener("keydown", escHandler);
			outsideClickListenerBound = true;
		}
	}
	function closeMenu() {
		if (!isMenuOpen) return;
		isMenuOpen = false;
		if (menuElement) menuElement.classList.remove("open");
		const btn = document.getElementById("dmna-float-btn");
		if (btn) btn.classList.remove("expanded");
		if (outsideClickListenerBound) {
			document.removeEventListener("click", outsideClickHandler, true);
			document.removeEventListener("keydown", escHandler);
			outsideClickListenerBound = false;
		}
	}
	function toggleMenu() {
		if (isMenuOpen) closeMenu();
		else openMenu();
	}
	function updateArcMenuPosition() {
		if (!menuElement) return;
		const { marginX, marginY } = getButtonMargins();
		const vv = window.visualViewport;
		if (!vv) {
			const scrollX = window.pageXOffset;
			const scrollY = window.pageYOffset;
			const bx = scrollX + window.innerWidth - marginX - 40;
			const by = scrollY + window.innerHeight - marginY - 40;
			menuElement.style.transform = `translate(${bx}px, ${by}px)`;
			return;
		}
		const invScale = 1 / vv.scale;
		const bx = vv.pageLeft + vv.width - (marginX + 40) * invScale;
		const by = vv.pageTop + vv.height - (marginY + 40) * invScale;
		menuElement.style.transform = `translate(${bx}px, ${by}px) scale(${invScale})`;
	}
	function handleMenuAction(action) {
		switch (action) {
			case "edit":
				toggleEditMode();
				break;
			case "confirm": hooks$1.onConfirm();
		}
	}
	function outsideClickHandler(e) {
		const target = e.target;
		if (target instanceof Element && (target.closest("#dmna-menu") || target.closest("#dmna-float-btn"))) return;
		e.stopPropagation();
		closeMenu();
	}
	function escHandler(e) {
		if (e.key === "Escape") {
			e.preventDefault();
			closeMenu();
		}
	}
	var viewportRaf = null;
	var pendingFn = null;
	function getInvScale() {
		return window.visualViewport ? 1 / window.visualViewport.scale : 1;
	}
	function scheduleVisualViewportUpdate(fn) {
		pendingFn = fn;
		if (!viewportRaf) viewportRaf = requestAnimationFrame(() => {
			const f = pendingFn;
			viewportRaf = null;
			pendingFn = null;
			if (f) f();
		});
	}
	function computePopoverPlacement({ boxCenterX, visW }) {
		const fit = clamp((visW - 20) / 343, .25, 1);
		const popW = 343 * fit;
		const left = Math.max(10, Math.min(boxCenterX - popW / 2, visW - popW - 10));
		return {
			left,
			fit,
			arrowLeft: clamp((boxCenterX - left) / fit - 8, 10, 317)
		};
	}
	var hooks = null;
	function initNoteBox(h) {
		hooks = h;
	}
	function renderNoteBox(noteId, cachedRect) {
		const note = notes.get(noteId);
		if (!note) return;
		let el = note.domElement;
		if (!el) {
			el = createNoteBoxDOM(noteId);
			note.domElement = el;
		}
		let rect;
		if (cachedRect === void 0) {
			const img = getImageElement();
			rect = img ? getImageDisplayRect(img) : null;
		} else rect = cachedRect;
		if (rect) {
			const screen = imageToScreenRect(note.current, rect, getOriginalWidth());
			el.style.display = "";
			el.style.left = `${screen.left}px`;
			el.style.top = `${screen.top}px`;
			el.style.width = `${screen.width}px`;
			el.style.height = `${screen.height}px`;
			const triSize = Math.min(Math.min(screen.width, screen.height) / 6, 8);
			el.style.setProperty("--dmna-triangle-size", `${triSize}px`);
			const areaRatio = Math.min(1, screen.width * screen.height / (rect.width * rect.height));
			el.style.setProperty("--dmna-box-z", String(9990 + Math.round(500 * (1 - areaRatio))));
		} else el.style.display = "none";
		updateNoteVisuals(noteId);
	}
	function updateAllNoteBoxPositions() {
		const img = getImageElement();
		const rect = img ? getImageDisplayRect(img) : null;
		for (const id of notes.keys()) renderNoteBox(id, rect);
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
		if (!note || !note.domElement) return;
		const el = note.domElement;
		el.classList.toggle("is-active", getActiveNoteId() === noteId);
		el.classList.toggle("is-deleted", note.isDeleted);
		el.classList.toggle("is-dirty", isDirty(note));
		hooks.onVisualsUpdated();
	}
	function updateActiveHandleScales() {
		const activeId = getActiveNoteId();
		if (activeId === null) return;
		const note = notes.get(activeId);
		if (!note || !note.domElement) return;
		note.domElement.style.setProperty("--dmna-handle-scale", String(getInvScale()));
	}
	function createNoteBoxDOM(noteId) {
		const el = document.createElement("div");
		el.className = "dmna-note-box";
		el.dataset.noteId = noteId;
		el.addEventListener("click", (e) => {
			if (getMode() !== "active") return;
			e.stopPropagation();
			if (hooks.consumeBoxClickSuppression()) return;
			setActiveNote(noteId);
		});
		hooks.attachBodyDrag(el, noteId);
		const handleIcons = {
			nw: "↖",
			ne: "✥",
			sw: "✥",
			se: "↘"
		};
		[
			"nw",
			"ne",
			"sw",
			"se"
		].forEach((corner) => {
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
			} else if (c === "\"" || c === "'") quote = c;
			else if (c === "(") depth++;
			else if (c === ")") depth--;
			else if (c === ";" && depth === 0) {
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
			} else if (c === "\"" || c === "'") quote = c;
			else if (c === "(") depth++;
			else if (c === ")") depth--;
			else if (c === target && depth === 0) return i;
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
			if (Math.hypot(dx, dy) * visScale > 5) dragged = true;
		};
		const onPointerUp = (e) => {
			if (tracking && !dragged) onTap(e);
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
	var SWATCHES$1 = [
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
	var HEX_RE$1 = /^#?[0-9a-fA-F]{6}$/;
	var THICKNESS_OPTIONS = [
		1,
		2,
		3
	];
	var SIDES = [
		"top",
		"right",
		"bottom",
		"left"
	];
	var modalElement$3 = null;
	var overlayElement$3 = null;
	var hexInput$1 = null;
	var applyButton$1 = null;
	var advancedSection = null;
	var advancedToggle = null;
	var thicknessButtons = new Map();
	var sideCheckboxes = new Map();
	var onConfirmCallback$3 = null;
	var isShown$4 = false;
	var isAdvancedOpen = false;
	var selectedThickness = 1;
	var suppressNextClick$3 = false;
	function normalizeHex$1(input) {
		const trimmed = input.trim();
		if (!HEX_RE$1.test(trimmed)) return null;
		return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
	}
	function buildTextShadow(color) {
		const t = selectedThickness;
		const activeSides = [];
		for (const s of SIDES) if (sideCheckboxes.get(s)?.checked) activeSides.push(s);
		if (activeSides.length === 0) return "";
		return activeSides.map((side) => {
			switch (side) {
				case "top": return `0 -${t}px 0 ${color}`;
				case "right": return `${t}px 0 0 ${color}`;
				case "bottom": return `0 ${t}px 0 ${color}`;
				case "left": return `-${t}px 0 0 ${color}`;
			}
		}).join(", ");
	}
	function refreshApplyState$1() {
		if (!applyButton$1 || !hexInput$1) return;
		const valid = normalizeHex$1(hexInput$1.value) !== null;
		applyButton$1.disabled = !valid;
		hexInput$1.classList.toggle("is-invalid", !valid && hexInput$1.value !== "");
	}
	function setAdvancedOpen(open) {
		isAdvancedOpen = open;
		if (advancedSection) advancedSection.classList.toggle("is-open", open);
		if (advancedToggle) advancedToggle.textContent = open ? "Advanced ▴" : "Advanced ▾";
	}
	function setThickness(t) {
		selectedThickness = t;
		for (const [thickness, btn] of thicknessButtons) btn.classList.toggle("is-active", thickness === t);
	}
	function resetState() {
		if (!hexInput$1 || !applyButton$1) return;
		hexInput$1.value = "";
		hexInput$1.classList.remove("is-invalid");
		applyButton$1.disabled = true;
		setAdvancedOpen(false);
		setThickness(1);
		for (const cb of sideCheckboxes.values()) cb.checked = true;
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
		if (callback && shadow) callback(shadow);
		else restoreTextareaSelection$3();
	}
	function commitRemove() {
		const callback = onConfirmCallback$3;
		hideStrokePicker();
		if (callback) callback("");
		else restoreTextareaSelection$3();
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
		if (target.closest(".dmna-style-color-text, .dmna-style-color-stroke, .dmna-style-color-bg")) return;
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
	var modalElement$2 = null;
	var overlayElement$2 = null;
	var readingInput = null;
	var onConfirmCallback$2 = null;
	var isShown$3 = false;
	var suppressNextClick$2 = false;
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
		if (reading && callback) callback(reading);
		else restoreTextareaSelection$2();
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
		if (target.closest(".dmna-style-btn-ruby")) return;
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
		if (modalElement$2 && overlayElement$2) return;
		const host = document.getElementById("dmna-popover");
		if (!host) return;
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
	var modalElement$1 = null;
	var overlayElement$1 = null;
	var urlInput = null;
	var onConfirmCallback$1 = null;
	var isShown$2 = false;
	var suppressNextClick$1 = false;
	var DANBOORU_HOST_RE = /^https?:\/\/danbooru\.donmai\.us/i;
	var DANGEROUS_SCHEME_RE = /^\s*(javascript|data|vbscript|file):/i;
	function normalizeUrl(input) {
		const trimmed = input.trim().replace(DANBOORU_HOST_RE, "");
		if (DANGEROUS_SCHEME_RE.test(trimmed)) return "";
		return trimmed.replace(/[<>"]/g, "");
	}
	function hideLinkPopover() {
		if (!modalElement$1 || !overlayElement$1) return;
		modalElement$1.classList.remove("show");
		overlayElement$1.classList.remove("show");
		isShown$2 = false;
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
		if (url && callback) callback(url);
		else restoreTextareaSelection$1();
	}
	function handleCancel$1() {
		hideLinkPopover();
		restoreTextareaSelection$1();
	}
	function onOutsideTap$1(e) {
		if (!isShown$2 || !modalElement$1) return;
		const target = e.target;
		if (!target) return;
		if (modalElement$1.contains(target)) return;
		if (target.closest(".dmna-style-btn-link")) return;
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
		if (modalElement$1 && overlayElement$1) return;
		const host = document.getElementById("dmna-popover");
		if (!host) return;
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
		isShown$2 = true;
		urlInput.focus();
	}
	function isLinkPopoverShown() {
		return isShown$2;
	}
	var SWATCHES = [
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
	var HEX_RE = /^#?[0-9a-fA-F]{6}$/;
	var modalElement = null;
	var overlayElement = null;
	var hexInput = null;
	var applyButton = null;
	var transparentSwatch = null;
	var onConfirmCallback = null;
	var isShown$1 = false;
	var currentTarget = null;
	var suppressNextClick = false;
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
		isShown$1 = false;
		currentTarget = null;
		onConfirmCallback = null;
	}
	function commitColor(color) {
		const callback = onConfirmCallback;
		hideColorPicker();
		if (callback) callback(color);
		else restoreTextareaSelection();
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
		if (currentTarget === "text" && color.toLowerCase() === "#000000") commitColor("");
		else commitColor(color);
	}
	function onOutsideTap(e) {
		if (!isShown$1 || !modalElement) return;
		const target = e.target;
		if (!target) return;
		if (modalElement.contains(target)) return;
		if (target.closest(".dmna-style-color-text, .dmna-style-color-stroke, .dmna-style-color-bg")) return;
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
				if (currentTarget === "text" && hex === "#000000") commitColor("");
				else commitColor(hex);
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
		if (transparentSwatch) transparentSwatch.style.display = target === "bg" ? "" : "none";
		hexInput.value = "";
		hexInput.classList.remove("is-invalid");
		applyButton.disabled = true;
		onConfirmCallback = onConfirm;
		overlayElement.classList.add("show");
		modalElement.classList.add("show");
		isShown$1 = true;
		hexInput.focus();
	}
	function isColorPickerShown() {
		return isShown$1;
	}
	function getColorPickerTarget() {
		return isShown$1 ? currentTarget : null;
	}
	var STYLE_POPOVER_WIDTH = 260;
	var STYLE_POPOVER_GAP = 8;
	var STYLE_POPOVER_MOBILE_BREAKPOINT = 600;
	var ROW_1_BUTTONS = [
		{
			tag: "b",
			label: "B",
			className: "dmna-style-btn-bold",
			tooltip: "Bold"
		},
		{
			tag: "i",
			label: "I",
			className: "dmna-style-btn-italic",
			tooltip: "Italic"
		},
		{
			tag: "u",
			label: "U",
			className: "dmna-style-btn-underline",
			tooltip: "Underline"
		}
	];
	var ROW_2_BUTTONS = [
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
	var ROW_3_BUTTONS = [{
		tag: "tn",
		label: "TL note",
		className: "dmna-style-btn-tn",
		tooltip: "Translator note"
	}, {
		tag: "code",
		label: "code",
		className: "dmna-style-btn-code",
		tooltip: "Code"
	}];
	var ROW_4_BUTTONS = [{
		tag: "a",
		label: "link",
		className: "dmna-style-btn-link",
		tooltip: "Link"
	}, {
		tag: "ruby",
		label: "ruby",
		className: "dmna-style-btn-ruby",
		tooltip: "Ruby (furigana)"
	}];
	var SIZE_OPTIONS = [
		{
			label: "−2",
			value: "70%"
		},
		{
			label: "−1",
			value: "85%"
		},
		{
			label: "Default",
			value: "normal"
		},
		{
			label: "+1",
			value: "125%"
		},
		{
			label: "+2",
			value: "150%"
		},
		{
			label: "+3",
			value: "200%"
		}
	];
	var FONT_OPTIONS = [
		{
			label: "Default",
			value: ""
		},
		{
			label: "comic",
			value: "comic",
			preview: "comic"
		},
		{
			label: "narrow",
			value: "narrow",
			preview: "narrow"
		},
		{
			label: "mono",
			value: "mono",
			preview: "mono"
		},
		{
			label: "slab sans",
			value: "\"slab sans\"",
			preview: "\"slab sans\""
		},
		{
			label: "slab serif",
			value: "\"slab serif\"",
			preview: "\"slab serif\""
		},
		{
			label: "formal serif",
			value: "\"formal serif\"",
			preview: "\"formal serif\""
		},
		{
			label: "formal cursive",
			value: "\"formal cursive\"",
			preview: "\"formal cursive\""
		},
		{
			label: "print",
			value: "print",
			preview: "print"
		},
		{
			label: "hand",
			value: "hand",
			preview: "hand"
		},
		{
			label: "childlike",
			value: "childlike",
			preview: "childlike"
		},
		{
			label: "blackletter",
			value: "blackletter",
			preview: "blackletter"
		},
		{
			label: "scary",
			value: "scary",
			preview: "scary"
		}
	];
	var stylePopoverElement = null;
	var isShown = false;
	function detectOuterLayers(before, after) {
		const layers = [];
		let bLen = before.length;
		let consumedAfter = 0;
		while (true) {
			const openMatch = before.slice(0, bLen).match(/<([a-zA-Z][a-zA-Z0-9]*)((?:\s[^<>]*)?)>$/);
			if (!openMatch) break;
			const tag = openMatch[1].toLowerCase();
			const attrs = openMatch[2];
			const expectedClose = `</${tag}>`;
			if (!after.startsWith(expectedClose, consumedAfter)) break;
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
			if (styleStr !== null) layer.styleProps = parseStyleAttr(styleStr);
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
		if (!ta || ta.selectionStart === ta.selectionEnd) return {
			spanProps,
			divProps
		};
		const layers = detectOuterLayers(ta.value.slice(0, ta.selectionStart), ta.value.slice(ta.selectionEnd));
		for (let i = layers.length - 1; i >= 0; i--) {
			const layer = layers[i];
			if (!layer.styleProps) continue;
			let target;
			if (layer.tag === "span") target = spanProps;
			else if (layer.tag === "div") target = divProps;
			else target = null;
			if (!target) continue;
			for (const [k, v] of layer.styleProps) target.set(k, v);
		}
		return {
			spanProps,
			divProps
		};
	}
	function stripStyleAttr(attrs) {
		return attrs.replace(/\s*\bstyle\s*=\s*"[^"]*"/i, "").replace(/\s*\bstyle\s*=\s*'[^']*'/i, "");
	}
	function buildOpenTag(tag, attrs, styleMap) {
		const cleaned = stripStyleAttr(attrs);
		const styleStr = serializeStyleAttr(styleMap);
		if (!styleStr) return `<${tag}${cleaned}>`;
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
		const innerSpan = detectOuterLayers(before, after).find((l) => l.tag === "span");
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
			ta.value = before + open + selected + "</span>" + after;
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
		const target = detectOuterLayers(ta.value.slice(0, start), ta.value.slice(end)).find((l) => l.tag === "span" && l.styleProps?.has(prop));
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
		const found = detectOuterLayers(before, after).find((l) => l.tag === tag);
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
		ta.setSelectionRange(start + 6, start + 6 + inner.length);
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
		const found = detectOuterLayers(before, after).find((l) => l.tag === "ruby");
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
					if (btn.tag === "ruby") applyRubyUnwrap();
					else applyUnwrap(btn.tag);
				} else if (btn.tag === "a") {
					if (isLinkPopoverShown()) hideLinkPopover();
					else handleLinkClick();
				} else if (btn.tag === "ruby") {
					if (isRubyPopoverShown()) hideRubyPopover();
					else handleRubyClick();
				} else applyWrap(btn.tag);
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
				if (color) applySpanStyle("color", color);
				else removeSpanStyle("color");
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
				if (textShadow) applySpanStyle("text-shadow", textShadow);
				else removeSpanStyle("text-shadow");
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
				if (color) applySpanStyle("background-color", color);
				else removeSpanStyle("background-color");
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
			if (opt.preview) o.style.fontFamily = opt.preview;
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
			if (value === "normal") removeSpanStyle("font-size");
			else if (value) applySpanStyle("font-size", value);
		} else if (control === "font") {
			if (value) applySpanStyle("font-family", value);
			else removeSpanStyle("font-family");
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
		if (stylePopoverElement) return;
		const root = document.createElement("div");
		root.id = "dmna-style-popover";
		const inner = document.createElement("div");
		inner.id = "dmna-style-popover-inner";
		inner.appendChild(buildTagRow(ROW_1_BUTTONS));
		inner.appendChild(buildTagRow(ROW_2_BUTTONS));
		inner.appendChild(buildTagRow(ROW_3_BUTTONS));
		inner.appendChild(buildTagRow(ROW_4_BUTTONS));
		inner.appendChild(buildColorRow());
		inner.appendChild(buildLabeledSelectRow("Size", buildSelectControl("size", SIZE_OPTIONS)));
		inner.appendChild(buildLabeledSelectRow("Font", buildSelectControl("font", FONT_OPTIONS)));
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
			if (!isColorPickerShown() && !isStrokePickerShown() && !isLinkPopoverShown() && !isRubyPopoverShown()) hideStylePopover();
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
		const textSwatch = stylePopoverElement.querySelector(".dmna-style-color-text .dmna-style-color-swatch");
		if (textSwatch) {
			const color = spanProps.get("color");
			textSwatch.style.background = color ?? "#000";
		}
		const bgSwatch = stylePopoverElement.querySelector(".dmna-style-color-bg .dmna-style-color-swatch");
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
		const strokeSwatch = stylePopoverElement.querySelector(".dmna-style-color-stroke .dmna-style-color-swatch");
		if (strokeSwatch) {
			const match = spanProps.get("text-shadow")?.match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/);
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
		const sizeSelect = stylePopoverElement.querySelector(".dmna-style-select[data-control=\"size\"]");
		if (sizeSelect) {
			const fontSize = spanProps.get("font-size");
			const match = fontSize ? SIZE_OPTIONS.find((o) => o.value === fontSize) : void 0;
			sizeSelect.value = match ? match.value : "normal";
		}
		const fontSelect = stylePopoverElement.querySelector(".dmna-style-select[data-control=\"font\"]");
		if (fontSelect) {
			const fontFamily = spanProps.get("font-family");
			const match = fontFamily ? FONT_OPTIONS.find((o) => o.value === fontFamily) : void 0;
			fontSelect.value = match ? match.value : "";
		}
	}
	function showStylePopover() {
		createStylePopover();
		if (!stylePopoverElement) return;
		isShown = true;
		updateStylePopoverPosition();
		refreshStylePopoverState();
		stylePopoverElement.classList.add("show");
	}
	function hideStylePopover() {
		if (!stylePopoverElement) return;
		stylePopoverElement.classList.remove("show");
		isShown = false;
	}
	function toggleStylePopover() {
		if (isShown) hideStylePopover();
		else showStylePopover();
	}
	function updateStylePopoverPosition() {
		if (!stylePopoverElement || !isShown) return;
		const activeId = getActiveNoteId();
		if (!activeId) return;
		const note = notes.get(activeId);
		if (!note) return;
		const img = document.getElementById("image");
		if (!img) return;
		const displayRect = getImageDisplayRect(img);
		if (!displayRect) return;
		const boxRectPage = imageToScreenRect(note.current, displayRect, getOriginalWidth());
		const vv = window.visualViewport;
		const scale = vv ? vv.scale : 1;
		const vvPageLeft = vv ? vv.pageLeft : window.pageXOffset;
		const vvPageTop = vv ? vv.pageTop : window.pageYOffset;
		const visW = (vv ? vv.width : window.innerWidth) * scale;
		const boxVisualLeft = (boxRectPage.left - vvPageLeft) * scale;
		const boxVisualTop = (boxRectPage.top - vvPageTop) * scale;
		const boxVisualWidth = boxRectPage.width * scale;
		const boxVisualHeight = boxRectPage.height * scale;
		const boxCenterVisualX = boxVisualLeft + boxVisualWidth / 2;
		const boxBottomVisualY = boxVisualTop + boxVisualHeight;
		const { left: notePopVisualLeft, fit } = computePopoverPlacement({
			boxCenterX: boxCenterVisualX,
			visW
		});
		const notePopVisualWidth = 343 * fit;
		const notePopVisualTop = boxBottomVisualY + 12;
		const notePopVisualRight = notePopVisualLeft + notePopVisualWidth;
		const isMobile = window.innerWidth < STYLE_POPOVER_MOBILE_BREAKPOINT;
		stylePopoverElement.classList.toggle("is-mobile", isMobile);
		let styleVisualLeft;
		let styleVisualTop;
		if (isMobile) {
			const notePopEl = document.getElementById("dmna-popover");
			const notePopHeight = notePopEl ? notePopEl.offsetHeight * fit : 0;
			styleVisualLeft = notePopVisualLeft + (notePopVisualWidth - STYLE_POPOVER_WIDTH) / 2;
			styleVisualTop = notePopVisualTop + notePopHeight + STYLE_POPOVER_GAP;
		} else {
			styleVisualLeft = notePopVisualRight + STYLE_POPOVER_GAP;
			if (styleVisualLeft + STYLE_POPOVER_WIDTH > visW) styleVisualLeft = notePopVisualLeft - STYLE_POPOVER_GAP - STYLE_POPOVER_WIDTH;
			styleVisualTop = notePopVisualTop;
		}
		const tx = vvPageLeft + styleVisualLeft / scale;
		const ty = vvPageTop + styleVisualTop / scale;
		stylePopoverElement.style.transform = `translate(${tx}px, ${ty}px) scale(${1 / scale})`;
	}
	var popoverElement = null;
	var popoverInputElement = null;
	var popoverArrowElement = null;
	var popoverPreviewElement = null;
	var popoverModeToggleElement = null;
	var popoverStyleToggleElement = null;
	var popoverCountElement = null;
	var isPreviewMode = false;
	function getIsPreviewMode() {
		return isPreviewMode;
	}
	var previewRequestId = 0;
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
		if (document.activeElement === popoverInputElement) onTextareaSelectionChanged();
	}
	function createPopover() {
		if (popoverElement) return;
		const root = document.createElement("div");
		root.id = "dmna-popover";
		const arrow = document.createElement("div");
		arrow.id = "dmna-popover-arrow";
		root.appendChild(arrow);
		popoverArrowElement = arrow;
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
			handleModeToggle();
		});
		header.appendChild(modeToggle);
		const count = document.createElement("span");
		count.className = "dmna-popover-count";
		count.setAttribute("aria-live", "polite");
		header.appendChild(count);
		popoverCountElement = count;
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
			if (!activeId) return;
			const note = notes.get(activeId);
			if (note) {
				note.current.text = input.value;
				updateNoteVisuals(activeId);
			}
			updateCharCount();
		});
		input.addEventListener("keydown", (e) => {
			if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
				if (e.isComposing || e.keyCode === 229) return;
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
		eyeBtn.appendChild(createZoneIcon());
		eyeBtn.setAttribute("aria-label", "Show touch zones (press and hold)");
		eyeBtn.title = "Show touch zones (hold)";
		eyeBtn.addEventListener("pointerdown", (e) => {
			if (eyeBtn.disabled) return;
			e.preventDefault();
			e.stopPropagation();
			try {
				eyeBtn.setPointerCapture(e.pointerId);
			} catch (_err) {}
			document.body.classList.add("dmna-show-debug-zones");
			eyeBtn.classList.add("is-pressed");
		});
		const releaseEye = (e) => {
			document.body.classList.remove("dmna-show-debug-zones");
			eyeBtn.classList.remove("is-pressed");
			try {
				eyeBtn.releasePointerCapture(e.pointerId);
			} catch (_err) {}
		};
		eyeBtn.addEventListener("pointerup", releaseEye);
		eyeBtn.addEventListener("pointercancel", releaseEye);
		sideStack.appendChild(eyeBtn);
		const undoBtn = document.createElement("button");
		undoBtn.type = "button";
		undoBtn.id = "dmna-popover-undo";
		undoBtn.className = "dmna-popover-side-btn";
		undoBtn.appendChild(createUndoIcon());
		undoBtn.setAttribute("aria-label", "Undo last change to this note");
		undoBtn.title = "Undo last change";
		undoBtn.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			const activeId = getActiveNoteId();
			if (activeId) popoverUndo(activeId);
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
		[
			{
				action: "confirm",
				label: "Commit",
				title: COMMIT_TITLE
			},
			{
				action: "cancel",
				label: "Cancel",
				title: "Discard uncommitted edits"
			},
			{
				action: "delete",
				label: "Delete",
				title: "Delete this note"
			},
			{
				action: "history",
				label: "History",
				title: "Open the version history"
			}
		].forEach(({ action, label, title }) => {
			const b = document.createElement("button");
			b.type = "button";
			b.className = "dmna-popover-btn";
			b.dataset.action = action;
			b.setAttribute("aria-label", label);
			b.title = title;
			b.textContent = label;
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
		if (!note || !popoverElement || !popoverInputElement) return;
		if (popoverInputElement.dataset.boundNoteId !== noteId) {
			popoverInputElement.value = note.current.text || "";
			popoverInputElement.dataset.boundNoteId = noteId;
			updateCharCount();
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
		if (popoverElement) popoverElement.classList.remove("show");
		if (popoverInputElement) delete popoverInputElement.dataset.boundNoteId;
		document.body.classList.remove("dmna-note-popover-open");
		document.removeEventListener("selectionchange", selectionChangeHandler);
		resetPreviewMode();
		hideStylePopover();
	}
	function updatePopoverForActiveNote() {
		if (!popoverElement || !popoverInputElement) return;
		const activeId = getActiveNoteId();
		if (!activeId) return;
		const note = notes.get(activeId);
		if (!note) return;
		const isDeleted = !!note.isDeleted;
		popoverInputElement.disabled = isDeleted;
		popoverElement.querySelectorAll(".dmna-popover-btn").forEach((b) => {
			const btn = b;
			btn.disabled = btn.dataset.action === "history" ? !note.isServerNote : isDeleted;
		});
		const eyeBtn = popoverElement.querySelector("#dmna-popover-eye");
		if (eyeBtn instanceof HTMLButtonElement) eyeBtn.disabled = isDeleted;
		refreshCommitButton();
		const undoBtn = popoverElement.querySelector("#dmna-popover-undo");
		if (undoBtn) undoBtn.classList.toggle("is-highlighted", isDeleted);
	}
	function updatePopoverPosition(cachedRect) {
		if (!popoverElement) return;
		const activeId = getActiveNoteId();
		if (!activeId) return;
		const note = notes.get(activeId);
		if (!note) return;
		let displayRect = cachedRect ?? null;
		if (!displayRect) {
			const img = document.getElementById("image");
			displayRect = img ? getImageDisplayRect(img) : null;
		}
		if (!displayRect) return;
		const boxRectPage = imageToScreenRect(note.current, displayRect, getOriginalWidth());
		const vv = window.visualViewport;
		const scale = vv ? vv.scale : 1;
		const vvPageLeft = vv ? vv.pageLeft : window.pageXOffset;
		const vvPageTop = vv ? vv.pageTop : window.pageYOffset;
		const visW = (vv ? vv.width : window.innerWidth) * scale;
		const boxVisualLeft = (boxRectPage.left - vvPageLeft) * scale;
		const boxVisualTop = (boxRectPage.top - vvPageTop) * scale;
		const boxCenterVisualX = boxVisualLeft + boxRectPage.width * scale / 2;
		const boxBottomVisualY = boxVisualTop + boxRectPage.height * scale;
		const { left, fit, arrowLeft } = computePopoverPlacement({
			boxCenterX: boxCenterVisualX,
			visW
		});
		const popVisualTop = boxBottomVisualY + 12;
		const tx = vvPageLeft + left / scale;
		const ty = vvPageTop + popVisualTop / scale;
		popoverElement.style.transform = `translate(${tx}px, ${ty}px) scale(${fit / scale})`;
		if (popoverArrowElement) popoverArrowElement.style.left = `${arrowLeft}px`;
	}
	function refreshActivePopover() {
		if (!popoverElement || !popoverInputElement) return;
		const activeId = getActiveNoteId();
		if (!activeId) return;
		const note = notes.get(activeId);
		if (!note) return;
		if (popoverInputElement.dataset.boundNoteId === activeId) {
			popoverInputElement.value = note.current.text || "";
			updateCharCount();
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
		popoverInputElement.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
		popoverInputElement.dispatchEvent(new Event("input", { bubbles: true }));
	}
	var SVG_NS = "http://www.w3.org/2000/svg";
	function svgEl(tag, attrs) {
		const el = document.createElementNS(SVG_NS, tag);
		for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
		return el;
	}
	function createUndoIcon() {
		const svg = svgEl("svg", {
			class: "dmna-undo-icon",
			viewBox: "0 0 24 24",
			width: 22,
			height: 22,
			"aria-hidden": "true",
			focusable: "false",
			fill: "none",
			stroke: "currentColor",
			"stroke-width": 2,
			"stroke-linecap": "round",
			"stroke-linejoin": "round"
		});
		svg.appendChild(svgEl("path", { d: "M4.5 8 H11 A8 8 0 0 1 19 16 V19.5" }));
		svg.appendChild(svgEl("path", { d: "M8.5 4 L4.5 8 L8.5 12" }));
		return svg;
	}
	function createZoneIcon() {
		const svg = svgEl("svg", {
			class: "dmna-zone-icon",
			viewBox: "0 0 24 24",
			width: 22,
			height: 22,
			"aria-hidden": "true",
			focusable: "false"
		});
		svg.appendChild(svgEl("path", {
			d: "M9.5 7.5 H2.5 V21.5 H16.5 V14",
			fill: "none",
			stroke: "currentColor",
			"stroke-width": 1.6,
			"stroke-dasharray": "2.6 2"
		}));
		svg.appendChild(svgEl("path", {
			d: "M10.5 6.5 Q16.5 0.8 22.5 6.5 Q16.5 12.2 10.5 6.5 Z",
			fill: "none",
			stroke: "currentColor",
			"stroke-width": 1.5,
			"stroke-linejoin": "round"
		}));
		svg.appendChild(svgEl("circle", {
			cx: 16.5,
			cy: 6.5,
			r: 2.1,
			fill: "currentColor"
		}));
		return svg;
	}
	function updateCharCount() {
		if (!popoverCountElement || !popoverInputElement) return;
		const length = serverNoteBodyLength(popoverInputElement.value);
		popoverCountElement.textContent = `${length} / ${NOTE_BODY_MAX_LENGTH}`;
		popoverCountElement.classList.toggle("is-over", length > NOTE_BODY_MAX_LENGTH);
		refreshCommitButton();
	}
	var COMMIT_TITLE = "Commit this note locally (sent on ✓ Confirm)";
	var COMMIT_OVER_TITLE = `Over Danbooru's ${NOTE_BODY_MAX_LENGTH}-character limit — shorten the note to commit`;
	function isBodyOverLimit() {
		return !!popoverInputElement && serverNoteBodyLength(popoverInputElement.value) > 5e3;
	}
	function refreshCommitButton() {
		const btn = popoverElement?.querySelector(".dmna-popover-btn[data-action=\"confirm\"]");
		if (!btn) return;
		const activeId = getActiveNoteId();
		const over = isBodyOverLimit();
		btn.disabled = over || !!(activeId && notes.get(activeId)?.isDeleted);
		btn.title = over ? COMMIT_OVER_TITLE : COMMIT_TITLE;
	}
	function setPopoverInteracting(interacting) {
		if (popoverElement) popoverElement.style.opacity = interacting ? "0.25" : "";
	}
	function focusActiveNoteInput(expectedId) {
		if (popoverInputElement && getActiveNoteId() === expectedId) popoverInputElement.focus();
	}
	function dismissActivePopover() {
		const activeId = getActiveNoteId();
		if (activeId === null) return;
		const note = notes.get(activeId);
		if (!note) {
			setActiveNote(null);
			return;
		}
		if (!note.isServerNote && !note.everConfirmed) hardDeleteNote(activeId);
		else {
			note.current = { ...note.confirmedState };
			clearTextActionsForNote(activeId);
			renderNoteBox(activeId);
			setActiveNote(null);
		}
	}
	async function handleModeToggle() {
		if (!popoverPreviewElement || !popoverInputElement || !popoverModeToggleElement) return;
		if (isPreviewMode) {
			enterEditMode();
			return;
		}
		const myReq = ++previewRequestId;
		popoverModeToggleElement.disabled = true;
		popoverModeToggleElement.textContent = "…";
		try {
			const activeId = getActiveNoteId();
			const note = activeId ? notes.get(activeId) : void 0;
			if (!note) throw new Error("No active note to preview");
			const res = await apiPreviewNote({
				...note.current,
				text: popoverInputElement.value
			});
			if (myReq !== previewRequestId) return;
			if (typeof res.sanitized_body !== "string") throw new Error("Malformed preview response");
			popoverPreviewElement.innerHTML = res.sanitized_body;
			popoverInputElement.style.display = "none";
			popoverPreviewElement.style.display = "block";
			isPreviewMode = true;
			popoverModeToggleElement.textContent = "✎ Edit";
			refreshStylePopoverState();
		} catch (err) {
			if (myReq === previewRequestId) {
				const reason = err instanceof ApiError ? err.detail : "";
				showToast(reason ? `⚠️ Preview failed — ${reason}` : "⚠️ Preview failed", "error", err);
				popoverModeToggleElement.textContent = "👁 Preview";
			}
		} finally {
			if (myReq === previewRequestId) popoverModeToggleElement.disabled = false;
		}
	}
	function enterEditMode() {
		if (!popoverPreviewElement || !popoverInputElement || !popoverModeToggleElement) return;
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
		if (!activeId) return;
		if (action === "confirm") {
			if (isBodyOverLimit()) return;
			popoverConfirm(activeId);
		} else if (action === "cancel") popoverCancel(activeId);
		else if (action === "delete") popoverDelete(activeId);
		else if (action === "history") {
			if (isServerNoteId(activeId)) window.open(`https://danbooru.donmai.us/note_versions?search[note_id]=${activeId}`, "_blank");
		}
	}
	var hintElement = null;
	var hintRect = null;
	function showCreateHint(rect) {
		hintRect = rect;
		if (!hintElement) {
			const el = document.createElement("div");
			el.id = "dmna-create-hint";
			const target = document.createElement("div");
			target.className = "dmna-create-hint-target";
			target.setAttribute("role", "button");
			target.setAttribute("aria-label", "Create a new note here");
			target.title = "Create a new note here";
			target.textContent = "+";
			target.addEventListener("click", (e) => {
				e.preventDefault();
				e.stopPropagation();
				createFromHint();
			});
			el.appendChild(target);
			document.body.appendChild(el);
			hintElement = el;
		}
		hintElement.hidden = false;
		updateCreateHintPosition();
	}
	function hideCreateHint() {
		hintRect = null;
		if (hintElement) hintElement.hidden = true;
	}
	function updateCreateHintPosition() {
		if (!hintElement || !hintRect) return;
		const img = getImageElement();
		const imageRect = img ? getImageDisplayRect(img) : null;
		if (!imageRect) {
			hideCreateHint();
			return;
		}
		const r = imageToScreenRect({
			...hintRect,
			text: ""
		}, imageRect, getOriginalWidth());
		hintElement.style.left = `${r.left}px`;
		hintElement.style.top = `${r.top}px`;
		hintElement.style.width = `${r.width}px`;
		hintElement.style.height = `${r.height}px`;
		hintElement.style.setProperty("--dmna-hint-scale", String(getInvScale()));
	}
	function createFromHint() {
		if (hintRect) createNoteAt(hintRect);
	}
	function createNoteAt(rect) {
		const id = createTempNote({
			...rect,
			text: ""
		});
		setActiveNote(id);
		if (getActiveNoteId() !== id) {
			hardDeleteNote(id);
			return;
		}
		requestAnimationFrame(() => focusActiveNoteInput(id));
	}
	var MARGIN = 16;
	var SLIDE_OUT_MS = 260;
	var panel = null;
	var hideTimer = null;
	var listElement = null;
	var shown = false;
	var dockTop = false;
	var pickedId = null;
	var createRect = null;
	function isNoteChooserShown() {
		return shown;
	}
	function noteSnippet(text) {
		return text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() || "(empty)";
	}
	function showNoteChooser(candidates, rect, tapClientY) {
		ensurePanel();
		setPicked(null);
		createRect = rect;
		const vv = window.visualViewport;
		dockTop = vv ? tapClientY - vv.offsetTop > vv.height / 2 : tapClientY > window.innerHeight / 2;
		listElement.replaceChildren(...candidates.map(buildNoteRow), buildNewRow());
		if (hideTimer !== null) {
			clearTimeout(hideTimer);
			hideTimer = null;
		}
		const wasOnScreen = !panel.hidden;
		panel.hidden = false;
		panel.classList.toggle("is-dock-top", dockTop);
		shown = true;
		updateNoteChooserPosition();
		if (!wasOnScreen) panel.offsetWidth;
		panel.classList.add("is-open");
		showCreateHint(rect);
	}
	function hideNoteChooser() {
		if (!shown) return;
		setPicked(null);
		createRect = null;
		shown = false;
		panel.classList.remove("is-open");
		hideCreateHint();
		hideTimer = setTimeout(() => {
			hideTimer = null;
			panel.hidden = true;
		}, SLIDE_OUT_MS);
	}
	function updateNoteChooserPosition() {
		if (!panel || !shown) return;
		const vv = window.visualViewport;
		const inv = vv ? 1 / vv.scale : 1;
		const left = vv ? vv.pageLeft : window.pageXOffset;
		const top = vv ? vv.pageTop : window.pageYOffset;
		const width = vv ? vv.width : window.innerWidth;
		const height = vv ? vv.height : window.innerHeight;
		const x = left + width / 2;
		const y = dockTop ? top + MARGIN * inv : top + height - MARGIN * inv;
		panel.style.transform = `translate(${x}px, ${y}px) scale(${inv}) translate(-50%, ${dockTop ? "0" : "-100%"})`;
	}
	function ensurePanel() {
		if (panel) return;
		panel = document.createElement("div");
		panel.id = "dmna-note-chooser";
		panel.hidden = true;
		const card = document.createElement("div");
		card.className = "dmna-chooser-card";
		const title = document.createElement("div");
		title.className = "dmna-chooser-title";
		title.textContent = "Which note? Tap one to see it, again to edit";
		listElement = document.createElement("div");
		listElement.className = "dmna-chooser-list";
		card.append(title, listElement);
		panel.appendChild(card);
		document.body.appendChild(panel);
		document.addEventListener("click", onDocumentClick, true);
	}
	function onDocumentClick(e) {
		if (!shown || !(e.target instanceof Node) || panel.contains(e.target)) return;
		if (e.target instanceof Element && e.target.closest("#dmna-create-hint")) return;
		const onBox = e.target instanceof Element && e.target.closest(".dmna-note-box");
		hideNoteChooser();
		if (!onBox) {
			e.preventDefault();
			e.stopPropagation();
		}
	}
	function buildRow(className) {
		const row = document.createElement("div");
		row.className = className;
		row.setAttribute("role", "button");
		return row;
	}
	function buildNoteRow(id) {
		const note = notes.get(id);
		const row = buildRow("dmna-chooser-item");
		const dot = document.createElement("span");
		dot.className = "dmna-chooser-dot";
		if (note?.isDeleted) dot.classList.add("is-deleted");
		else if (!note?.isServerNote) dot.classList.add("is-new");
		const text = document.createElement("span");
		text.className = "dmna-chooser-text";
		text.textContent = noteSnippet(note?.current.text ?? "");
		const again = document.createElement("span");
		again.className = "dmna-chooser-again";
		again.textContent = "Tap again to edit";
		row.append(dot, text, again);
		row.addEventListener("click", () => {
			if (pickedId !== id) {
				setPicked(id, row);
				return;
			}
			hideNoteChooser();
			setActiveNote(id);
		});
		return row;
	}
	function buildNewRow() {
		const row = buildRow("dmna-chooser-item dmna-chooser-new");
		row.textContent = "+ New note here";
		row.addEventListener("click", () => {
			const rect = createRect;
			hideNoteChooser();
			if (rect) createNoteAt(rect);
		});
		return row;
	}
	function setPicked(id, row) {
		if (pickedId !== null) notes.get(pickedId)?.domElement?.classList.remove("is-chooser-pick");
		listElement?.querySelectorAll(".is-picked").forEach((el) => el.classList.remove("is-picked"));
		pickedId = id;
		if (id !== null) {
			notes.get(id)?.domElement?.classList.add("is-chooser-pick");
			row?.classList.add("is-picked");
		}
	}
	var tagPopoverElement = null;
	var tagPopoverSummaryElement = null;
	var tagPopoverTagsSection = [];
	var tagPopoverInitialTags = null;
	var tagPopoverBaseTagString = "";
	var tagPopoverState = null;
	var pendingTagPopoverResolver = null;
	async function showTagPopover(summary, withTags) {
		let tagString = "";
		if (withTags) try {
			tagString = await fetchPostTagString();
		} catch (err) {
			showToast("⚠️ Failed to load post tags", "error", err);
			return null;
		}
		const initialTags = new Set(tagString.split(/\s+/).filter((t) => TAG_OPTIONS.includes(t)));
		return new Promise((resolve) => {
			if (pendingTagPopoverResolver) {
				const stale = pendingTagPopoverResolver;
				pendingTagPopoverResolver = null;
				stale(null);
			}
			pendingTagPopoverResolver = resolve;
			tagPopoverBaseTagString = tagString;
			openTagPopover(initialTags, summary, withTags);
		});
	}
	function updateTagPopoverPosition() {
		if (!tagPopoverElement) return;
		const vv = window.visualViewport;
		const invScale = 1 / (vv ? vv.scale : 1);
		const vvWidth = vv ? vv.width : window.innerWidth;
		const vvHeight = vv ? vv.height : window.innerHeight;
		const vvPageLeft = vv ? vv.pageLeft : window.pageXOffset;
		const vvPageTop = vv ? vv.pageTop : window.pageYOffset;
		const { marginX, marginY } = getButtonMargins();
		const btnCenterX = vvWidth - (marginX + 20) * invScale;
		const btnCenterY = vvHeight - (marginY + 20) * invScale;
		const btnVisualHalf = 20 * invScale;
		const arrowW = 8;
		const popW = 240;
		const popH = tagPopoverElement.offsetHeight;
		const popoverLeftX = btnCenterX - btnVisualHalf - 6 * invScale - arrowW * invScale - popW * invScale;
		const popoverTopY = btnCenterY + btnVisualHalf - popH * invScale;
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
				if (changedTag === "check_translation" || changedTag === "partially_translated") next.translation_request = true;
			}
		} else if (changedTag === "translation_request" && (next.check_translation || next.partially_translated)) next.translation_request = true;
		return next;
	}
	function isTagToggleDisabled(state, tag) {
		if (tag === "translation_request") return state.check_translation || state.partially_translated;
		return false;
	}
	function renderTagToggles() {
		if (!tagPopoverElement || !tagPopoverState) return;
		const state = tagPopoverState;
		TAG_OPTIONS.forEach((tag) => {
			const row = tagPopoverElement.querySelector(`.dmna-tag-row[data-tag="${tag}"]`);
			if (!(row instanceof HTMLElement)) return;
			const switchBtn = row.querySelector(".dmna-tag-switch-btn");
			const disabled = isTagToggleDisabled(state, tag);
			row.classList.toggle("is-on", !!state[tag]);
			row.classList.toggle("is-disabled", disabled);
			if (switchBtn instanceof HTMLButtonElement) switchBtn.disabled = disabled;
		});
	}
	function createTagPopover() {
		if (tagPopoverElement) return;
		const root = document.createElement("div");
		root.id = "dmna-tag-popover";
		root.addEventListener("click", (e) => {
			e.stopPropagation();
		});
		const arrow = document.createElement("div");
		arrow.id = "dmna-tag-popover-arrow";
		root.appendChild(arrow);
		const summary = document.createElement("div");
		summary.className = "dmna-tag-popover-summary";
		root.appendChild(summary);
		tagPopoverSummaryElement = summary;
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
				if (switchBtn.disabled || !tagPopoverState) return;
				const currentlyOn = !!tagPopoverState[tag];
				tagPopoverState = applyTagConstraints(tagPopoverState, tag, !currentlyOn);
				renderTagToggles();
			});
			list.appendChild(row);
		});
		root.appendChild(list);
		tagPopoverTagsSection = [header, list];
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
	function openTagPopover(initialTags, summary, withTags) {
		createTagPopover();
		if (!tagPopoverElement) return;
		renderSummary(summary);
		for (const el of tagPopoverTagsSection) el.style.display = withTags ? "" : "none";
		tagPopoverInitialTags = initialTags;
		const initState = {};
		TAG_OPTIONS.forEach((t) => {
			initState[t] = initialTags.has(t);
		});
		if (initState.check_translation || initState.partially_translated) initState.translation_request = true;
		tagPopoverState = initState;
		renderTagToggles();
		document.body.classList.add("dmna-tag-popover-open");
		tagPopoverElement.style.visibility = "hidden";
		tagPopoverElement.classList.add("show");
		updateTagPopoverPosition();
		tagPopoverElement.style.visibility = "";
		document.addEventListener("keydown", tagPopoverKeyHandler, true);
	}
	function renderSummary(summary) {
		const el = tagPopoverSummaryElement;
		if (!el) return;
		const parts = [
			[
				"New",
				summary.created,
				false
			],
			[
				"Edited",
				summary.textEdited,
				false
			],
			[
				"Moved",
				summary.movedOnly,
				false
			],
			[
				"Deleted",
				summary.deleted,
				true
			]
		];
		el.textContent = "";
		parts.filter(([, n]) => n > 0).forEach(([label, n, isDelete], i) => {
			if (i > 0) el.append(" · ");
			const span = document.createElement("span");
			span.textContent = `${label} ${n}`;
			if (isDelete) span.className = "dmna-tag-popover-summary-deleted";
			el.append(span);
		});
	}
	function closeTagPopover() {
		document.body.classList.remove("dmna-tag-popover-open");
		if (tagPopoverElement) tagPopoverElement.classList.remove("show");
		document.removeEventListener("keydown", tagPopoverKeyHandler, true);
		tagPopoverInitialTags = null;
		tagPopoverState = null;
	}
	function submitTagPopover(canceled) {
		const resolver = pendingTagPopoverResolver;
		if (!resolver) return;
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
			if (isOn && !wasOn) tagsToAdd.push(tag);
			else if (!isOn && wasOn) tagsToRemove.push(tag);
		});
		pendingTagPopoverResolver = null;
		closeTagPopover();
		resolver({
			tagsToAdd,
			tagsToRemove,
			baseTagString: tagPopoverBaseTagString
		});
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
	var dragState = null;
	var suppressNextBoxClick = false;
	function attachHandleListeners(handle, corner, noteId) {
		handle.addEventListener("pointerdown", (e) => {
			if (getMode() !== "active") return;
			const note = notes.get(noteId);
			if (note && note.isDeleted) return;
			e.preventDefault();
			e.stopPropagation();
			if (getActiveNoteId() !== noteId) {
				setActiveNote(noteId);
				if (getActiveNoteId() !== noteId) return;
			}
			startInteraction(noteId, corner === "nw" || corner === "se" ? `resize-${corner}` : "drag", e, handle);
		});
	}
	function attachBodyDragListener(bodyEl, noteId) {
		bodyEl.addEventListener("pointerdown", (e) => {
			if (getMode() !== "active") return;
			if (e.pointerType !== "mouse" && getActiveNoteId() !== noteId) return;
			const note = notes.get(noteId);
			if (note && note.isDeleted) {
				if (getActiveNoteId() !== noteId) setActiveNote(noteId);
				return;
			}
			if (getActiveNoteId() !== noteId) {
				setActiveNote(noteId);
				if (getActiveNoteId() !== noteId) return;
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
		if (!note) return;
		const img = getImageElement();
		const imageRect = img ? getImageDisplayRect(img) : null;
		if (!imageRect) return;
		dragState = {
			kind,
			noteId,
			pointerId: e.pointerId,
			startScreenX: e.clientX,
			startScreenY: e.clientY,
			startState: { ...note.current },
			captureTarget,
			moved: false,
			imageRect
		};
		try {
			captureTarget.setPointerCapture(e.pointerId);
		} catch (_err) {}
		captureTarget.addEventListener("pointermove", onInteractionMove);
		captureTarget.addEventListener("pointerup", onInteractionEnd);
		captureTarget.addEventListener("pointercancel", onInteractionEnd);
	}
	function onInteractionMove(e) {
		if (!dragState || e.pointerId !== dragState.pointerId) return;
		const note = notes.get(dragState.noteId);
		if (!note) return;
		const dx = e.clientX - dragState.startScreenX;
		const dy = e.clientY - dragState.startScreenY;
		if (!dragState.moved && Math.hypot(dx, dy) > 5) {
			dragState.moved = true;
			setPopoverInteracting(true);
			if (note.domElement) note.domElement.classList.add("is-interacting");
		}
		const rect = dragState.imageRect;
		const originalWidth = getOriginalWidth();
		const originalHeight = getOriginalHeight();
		if (!originalWidth) return;
		const scale = rect.width / originalWidth;
		const dxImg = dx / scale;
		const dyImg = dy / scale;
		const vv = window.visualViewport;
		const vvScale = vv ? vv.scale : 1;
		const minImg = Math.max(8, 48 / vvScale / scale);
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
			if (seX - candX < minImg) candX = seX - minImg;
			if (seY - candY < minImg) candY = seY - minImg;
			nx = candX;
			ny = candY;
			nw = seX - candX;
			nh = seY - candY;
		}
		nx = Math.max(0, Math.min(originalWidth - nw, nx));
		ny = Math.max(0, Math.min(originalHeight - nh, ny));
		note.current = {
			x: nx,
			y: ny,
			w: nw,
			h: nh,
			text: note.current.text
		};
		renderNoteBox(dragState.noteId, rect);
		updatePopoverPosition(rect);
	}
	function onInteractionEnd(e) {
		if (!dragState || e.pointerId !== dragState.pointerId) return;
		const target = dragState.captureTarget;
		try {
			target.releasePointerCapture(e.pointerId);
		} catch (_err) {}
		target.removeEventListener("pointermove", onInteractionMove);
		target.removeEventListener("pointerup", onInteractionEnd);
		target.removeEventListener("pointercancel", onInteractionEnd);
		if (dragState.moved) {
			const moved = notes.get(dragState.noteId);
			if (e.type === "pointercancel") {
				if (moved) {
					const { x, y, w, h } = dragState.startState;
					moved.current = {
						...moved.current,
						x,
						y,
						w,
						h
					};
					renderNoteBox(dragState.noteId, dragState.imageRect);
					updatePopoverPosition(dragState.imageRect);
				}
			} else pushAction(dragState.noteId, "transform", { ...dragState.startState });
			setPopoverInteracting(false);
			if (moved && moved.domElement) moved.domElement.classList.remove("is-interacting");
			suppressNextBoxClick = true;
			setTimeout(() => {
				suppressNextBoxClick = false;
			}, 500);
		}
		dragState = null;
	}
	var imageHandlersBound = false;
	var dragCreate = null;
	var suppressNextImageClick = false;
	function bindImageHandlers() {
		if (imageHandlersBound) return;
		const img = getImageElement();
		if (!img) {
			setTimeout(bindImageHandlers, 1e3);
			return;
		}
		img.addEventListener("click", handleImageClick);
		img.addEventListener("load", updateAllNoteBoxPositions);
		img.addEventListener("pointerdown", onImageDragPointerDown);
		const blockNativeIfActive = (e) => {
			if (getMode() !== "active") return;
			e.stopPropagation();
		};
		img.addEventListener("mousedown", blockNativeIfActive, true);
		img.addEventListener("touchstart", blockNativeIfActive, {
			capture: true,
			passive: true
		});
		imageHandlersBound = true;
	}
	function handleImageClick(e) {
		if (getMode() !== "active") return;
		if (suppressNextImageClick) {
			suppressNextImageClick = false;
			return;
		}
		if (getActiveNoteId() !== null) {
			dismissActivePopover();
			return;
		}
		if (selectBoxNearTap(e.clientX, e.clientY)) return;
		spawnDefaultBoxAtClient(e.clientX, e.clientY);
	}
	function selectBoxNearTap(clientX, clientY) {
		const img = getImageElement();
		const rect = img ? getImageDisplayRect(img) : null;
		const originalWidth = getOriginalWidth();
		if (!rect || !originalWidth) return false;
		const x = clientX + window.pageXOffset;
		const y = clientY + window.pageYOffset;
		const inv = getInvScale();
		const inRange = [...notes].map(([id, note]) => ({
			id,
			distance: distanceToRect(x, y, imageToScreenRect(note.current, rect, originalWidth))
		})).filter((c) => c.distance <= 24 * inv).sort((a, b) => a.distance - b.distance);
		if (inRange.length === 0) return false;
		const newBoxRect = screenToImageRect(defaultBoxRectAt(clientX, clientY, rect), rect, originalWidth);
		if (!newBoxRect) return false;
		if (inRange.length > 1 && inRange[1].distance - inRange[0].distance <= 8 * inv) showNoteChooser(inRange.slice(0, 6).map((c) => c.id), newBoxRect, clientY);
		else {
			setActiveNote(inRange[0].id);
			showCreateHint(newBoxRect);
		}
		return true;
	}
	function defaultBoxRectAt(clientX, clientY, rect) {
		const unzoomed = clamp(Math.min(rect.width, rect.height) * INITIAL_SIZE_RATIO, 48, 150);
		const originalWidth = getOriginalWidth();
		const floor = originalWidth ? 8 * (rect.width / originalWidth) : 0;
		const size = Math.max(unzoomed * getInvScale(), floor);
		return {
			left: clamp(clientX + window.pageXOffset - size / 2, rect.left, rect.left + rect.width - size),
			top: clamp(clientY + window.pageYOffset - size / 2, rect.top, rect.top + rect.height - size),
			width: size,
			height: size
		};
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
				if (getMode() !== "active" || getActiveNoteId() !== null) return null;
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
		const imgState = screenToImageRect(defaultBoxRectAt(clientX, clientY, rect), rect, getOriginalWidth());
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
		if (!dragCreate) return null;
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
		if (e.pointerType !== "mouse" || e.button !== 0) return;
		if (getMode() !== "active" || getActiveNoteId() !== null) return;
		if (isNoteChooserShown()) return;
		if (!getOriginalWidth() || !getOriginalHeight()) return;
		const img = getImageElement();
		if (!img) return;
		const rect = getImageDisplayRect(img);
		if (!rect) return;
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
		if (!dragCreate) return;
		const x = e.clientX + window.pageXOffset;
		const y = e.clientY + window.pageYOffset;
		if (!dragCreate.moved) {
			if (Math.hypot(x - dragCreate.startX, y - dragCreate.startY) < 5) return;
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
		if (!dragCreate) return;
		const moved = dragCreate.moved;
		let finalRect = null;
		if (moved) finalRect = computeDragRect(e.clientX + window.pageXOffset, e.clientY + window.pageYOffset);
		const imageRect = dragCreate.imageRect;
		cleanupDragCreate();
		suppressNextImageClick = true;
		if (moved && finalRect && finalRect.width >= 24 && finalRect.height >= 24 && finalRect) {
			const imgState = screenToImageRect(finalRect, imageRect, getOriginalWidth());
			if (!imgState) return;
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
		spawnDefaultBoxAtClient(e.clientX, e.clientY);
	}
	function onImageDragPointerCancel() {
		cleanupDragCreate();
	}
	function cleanupDragCreate() {
		if (dragCreate && dragCreate.ghostEl) dragCreate.ghostEl.remove();
		dragCreate = null;
		document.removeEventListener("pointermove", onImageDragPointerMove);
		document.removeEventListener("pointerup", onImageDragPointerUp);
		document.removeEventListener("pointercancel", onImageDragPointerCancel);
	}
	var bound$1 = false;
	var promptedDiscardOnLeave = false;
	var discardedOnLeave = false;
	function saveDraftIfNeeded() {
		if (getIsSending() || getIsDraftSaveBlocked()) return;
		if (!hasContentToSave()) return;
		saveDraft(serializeForDraft());
	}
	function disarmPrompt() {
		promptedDiscardOnLeave = false;
	}
	function onBeforeUnload(e) {
		promptedDiscardOnLeave = false;
		if (getMode() === "active" && hasPendingChanges()) {
			promptedDiscardOnLeave = true;
			document.addEventListener("pointerdown", disarmPrompt, {
				capture: true,
				once: true
			});
			document.addEventListener("keydown", disarmPrompt, {
				capture: true,
				once: true
			});
			e.preventDefault();
			e.returnValue = "";
			return;
		}
		saveDraftIfNeeded();
	}
	function onPageHide() {
		if (promptedDiscardOnLeave) {
			promptedDiscardOnLeave = false;
			discardedOnLeave = true;
			clearDraft();
			return;
		}
		saveDraftIfNeeded();
	}
	function onVisibilityChange() {
		if (document.visibilityState !== "hidden" || discardedOnLeave) return;
		saveDraftIfNeeded();
	}
	function onPageShow(e) {
		if (e.persisted) {
			promptedDiscardOnLeave = false;
			discardedOnLeave = false;
		}
	}
	function bindLifecycleSave() {
		if (bound$1) return;
		window.addEventListener("beforeunload", onBeforeUnload);
		window.addEventListener("pagehide", onPageHide);
		window.addEventListener("pageshow", onPageShow);
		document.addEventListener("visibilitychange", onVisibilityChange);
		bound$1 = true;
	}
	var scheduled = false;
	function refreshPendingIndicator() {
		let count = 0;
		if (getMode() === "active") {
			const c = classifyChanges();
			count = c.posts.length + c.puts.length + c.deletes.length;
		}
		document.body.classList.toggle("dmna-has-pending", count > 0);
		setFloatingButtonPendingCount(count);
	}
	function schedulePendingRefresh() {
		if (scheduled) return;
		scheduled = true;
		queueMicrotask(() => {
			scheduled = false;
			refreshPendingIndicator();
		});
	}
	var hotkeysBound = false;
	function bindGlobalHotkeys() {
		if (hotkeysBound) return;
		document.addEventListener("keydown", handleGlobalHotkeys);
		hotkeysBound = true;
	}
	function handleGlobalHotkeys(e) {
		if (getIsSending()) return;
		if (document.body.classList.contains("dmna-tag-popover-open") || document.body.classList.contains("dmna-error-modal-open")) return;
		if (e.key === "Escape" && isNoteChooserShown()) {
			e.preventDefault();
			hideNoteChooser();
			return;
		}
		if (e.key === "Escape" && getActiveNoteId() !== null) {
			const ae = document.activeElement;
			if (isTextInputElement(ae) && !isPopoverInput(ae)) return;
			if (e.isComposing || e.keyCode === 229) return;
			e.preventDefault();
			e.stopPropagation();
			dismissActivePopover();
			return;
		}
		if (e.shiftKey && e.code === "KeyN" && !e.ctrlKey && !e.metaKey && !e.altKey && getActiveNoteId() === null && !isTextInputElement(document.activeElement)) {
			e.preventDefault();
			if (getIsNativeActive()) showToast("Danbooru's native note UI is active — close it first", "info");
			else toggleEditMode();
			return;
		}
		if (e.shiftKey && e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.altKey && getMode() === "active" && getActiveNoteId() === null && !isTextInputElement(document.activeElement)) {
			e.preventDefault();
			runConfirmFlow();
		}
	}
	var bound = false;
	var BLOCK_TOAST_COOLDOWN_MS = 2500;
	var BLOCK_TOAST_MESSAGE = "Edit mode is on — turn it off first";
	var lastBlockToastAt = 0;
	function maybeShowBlockToast() {
		const now = Date.now();
		if (now - lastBlockToastAt > BLOCK_TOAST_COOLDOWN_MS) {
			lastBlockToastAt = now;
			showToast(BLOCK_TOAST_MESSAGE, "info");
		}
	}
	function bindNativeBlockers() {
		if (bound) return;
		document.addEventListener("keydown", handleKeydown, true);
		document.addEventListener("click", handleClick, true);
		bound = true;
	}
	function handleKeydown(e) {
		if (getMode() !== "active") return;
		if (e.code === "KeyN" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && !isTextInputElement(e.target)) {
			e.preventDefault();
			e.stopPropagation();
			maybeShowBlockToast();
		}
	}
	function handleClick(e) {
		if (getMode() !== "active") return;
		const target = e.target;
		if (target && typeof target.closest === "function") {
			if (target.closest("#translate")) {
				e.preventDefault();
				e.stopPropagation();
				maybeShowBlockToast();
			}
		}
	}
	var notesStoreHooks = {
		onActiveChanged: (prev, next) => {
			hideCreateHint();
			hideNoteChooser();
			if (prev !== null) updateNoteVisuals(prev);
			if (next !== null) {
				updateNoteVisuals(next);
				showPopover(next);
			} else hidePopover();
		},
		onNoteRenderRequested: (id) => {
			renderNoteBox(id);
			refreshActivePopover();
		},
		onNoteVisualsChanged: (id) => updateNoteVisuals(id),
		onNoteRemoved: (id) => {
			removeNoteBoxDOM(id);
			schedulePendingRefresh();
		},
		onModeChanged: (mode) => {
			hideNoteChooser();
			setFloatingButtonIconForMode();
			schedulePendingRefresh();
			if (mode === "idle") clearDraft();
		},
		onToast: (msg, level, err) => showToast(msg, level, err),
		onReopenMenuRequested: () => openMenu(),
		hasPendingChanges: () => hasPendingChanges(),
		onTextUndo: (id, snapshot) => applyTextUndoSnapshot(id, snapshot),
		onNotesAdded: () => {
			updateAllNoteBoxPositions();
			refreshActivePopover();
		}
	};
	var confirmFlowHooks = {
		onSendStart: () => {
			closeMenu();
			hideNoteChooser();
			setFloatingButtonIcon("⏳");
		},
		onSendEnd: () => {
			setFloatingButtonIconForMode();
			schedulePendingRefresh();
		},
		onNoteRenderRequested: (id) => renderNoteBox(id),
		onNoteVisualsChanged: (id) => updateNoteVisuals(id),
		onToast: (msg, level, err) => showToast(msg, level, err),
		showTagPopover: (summary, withTags) => showTagPopover(summary, withTags)
	};
	var noteBoxHooks = {
		attachBodyDrag: (el, noteId) => attachBodyDragListener(el, noteId),
		attachHandle: (el, corner, noteId) => attachHandleListeners(el, corner, noteId),
		consumeBoxClickSuppression: () => consumeBoxClickSuppression(),
		onVisualsUpdated: () => schedulePendingRefresh()
	};
	var arcMenuHooks = { onConfirm: () => void runConfirmFlow() };
	function runViewportUpdate() {
		updateFloatingButtonPosition();
		updateArcMenuPosition();
		updateToastPosition();
		updatePopoverPosition();
		updateStylePopoverPosition();
		updateActiveHandleScales();
		updateTagPopoverPosition();
		updateCreateHintPosition();
		updateNoteChooserPosition();
	}
	function scheduleViewportUpdate() {
		scheduleVisualViewportUpdate(runViewportUpdate);
	}
	function checkAndPromptRestore() {
		const draft = loadDraft();
		if (!draft) return;
		if (draft.mode !== "active" || draft.notes.length === 0) return;
		const n = draft.notes.length;
		showToastWithActions(`Saved draft found (${n} note${n === 1 ? "" : "s"}).\nRestore your work?`, [{
			label: "Restore",
			primary: true,
			onClick: () => {
				applyDraftSnapshot(draft);
			}
		}, {
			label: "Discard",
			onClick: () => clearDraft()
		}]);
	}
	var initialized = false;
	function init() {
		if (initialized) return;
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
		window.addEventListener("resize", updateCreateHintPosition);
		window.addEventListener("orientationchange", updateCreateHintPosition);
		bindLifecycleSave();
		checkAndPromptRestore();
		if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(() => sweepExpiredDrafts());
		else setTimeout(() => sweepExpiredDrafts(), 2e3);
	}
	console.log(`[MobileNoteAssist v${APP_VERSION}] loaded`);
	init();
})();
