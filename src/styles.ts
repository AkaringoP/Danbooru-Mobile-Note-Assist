import {POPOVER_ARROW_HALF, POPOVER_WIDTH, TAG_POPOVER_WIDTH} from './config';

/**
 * Inlined CSS for all MobileNoteAssist UI surfaces. Injected into a
 * <style> element by main.ts at boot.
 */
export const STYLES = `
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
      justify-content: flex-start;
      align-items: center;
      margin-bottom: 8px;
    }
    /* Mode toggle styled as an inline link rather than a chip — mirrors
       Danbooru's own Edit Comment header where "Preview" is a textual
       affordance with an icon, not a button. (v4.2 Phase 4 visual.) */
    .dmna-popover-mode-toggle {
      background: transparent;
      border: none;
      color: #4a9eff;
      font-size: 13px;
      font-family: inherit;
      padding: 2px 0;
      cursor: pointer;
      user-select: none;
      touch-action: manipulation;
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    .dmna-popover-mode-toggle:hover {
      color: #6bb6ff;
    }
    .dmna-popover-mode-toggle:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      text-decoration: none;
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
    /* Eye uses pointer events for press-and-hold, so it overrides
       touch-action to disable scroll/zoom while held. */
    #dmna-popover-eye { touch-action: none; }
    #dmna-popover-eye:active,
    #dmna-popover-eye.is-pressed {
      background: rgba(255, 255, 255, 0.22);
    }
    #dmna-popover-undo:active {
      background: rgba(255, 255, 255, 0.22);
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
      background: rgba(255, 255, 255, 0.28);
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
      background: rgba(255, 255, 255, 0.28);
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
      background: rgba(255, 255, 255, 0.28);
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
    .dmna-style-btn:hover { background: rgba(255, 255, 255, 0.20); }
    .dmna-style-btn:active { background: rgba(255, 255, 255, 0.28); }
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
    /* Per-tag preview rendering — each button styles its glyph the
       way the tag would render so the user knows the effect before
       tapping. */
    .dmna-style-btn-bold { font-weight: 700; }
    .dmna-style-btn-italic { font-style: italic; }
    .dmna-style-btn-underline { text-decoration: underline; }
    .dmna-style-btn-strike { text-decoration: line-through; }
    .dmna-style-btn-tn {
      font-size: 15px;
      color: rgba(150, 200, 255, 0.95);
      letter-spacing: 0.5px;
    }
    .dmna-style-btn-link {
      color: #4a9eff;
      text-decoration: underline;
    }
    /* Color row: button is a label + swatch pair in inline-flex.
       Padding tightens vertically vs tag buttons since two pieces of
       content share the same row. */
    .dmna-style-color-text,
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
      background: rgba(255, 255, 255, 0.28);
    }
  `;
