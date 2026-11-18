# Changelog

All notable changes to **Danbooru Mobile Note Assist** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [5.1.4] - 2026-11-18

Touch precision: taps that just miss a small box, taps between packed notes, and new boxes made while zoomed in.

### Changed
- **A tap that just misses a box selects it.** A box's touch area was exactly its outline, so on a narrow box (a vertical speech bubble can be about 10 px wide) a tap one pixel off dropped a new box on top of it. A touch tap within 24 px of a box (on screen, so less of the image as you zoom in) now selects the nearest one. In case you did mean a new box, a dashed outline with a **+** marks where it would have gone: tap the **+** and the new box is created there. The outline never gets in the way of other boxes, so on a post packed with small notes you can still tap any neighbour to select it.
- **New boxes keep their on-screen size when you zoom in.** The default box was sized against the page, so after pinch-zooming far in, a new box could fill the screen and bury the small notes you had zoomed in to reach. Its size is now divided by the zoom level: it looks the same size at any zoom, and covers less of the image the further you zoom in. It is also never smaller than the smallest size a resize allows (48 px on screen), so the first touch of a resize handle no longer makes a new box jump from 38 to 48 px on a phone, and the dashed outline is exactly the box you get.
- **A tap between boxes asks which note you meant.** When the two nearest boxes are about equally close to the tap (their distances differ by 8 px or less on screen), the script doesn't guess. A list of the nearby notes opens, nearest first, each with its text. Tap a row to see which box it is (the box is outlined in yellow), tap the same row again to open it for editing. The last row, **+ New note here**, creates the box the tap would otherwise have made; the dashed outline shows where that is while the list is open. A tap outside the list, or Esc, closes it. The list slides in from the edge of the screen it docks to and slides back out when it closes (just a short fade with reduced motion on). A tap farther from every box creates a box at once, as before; mouse clicks are unchanged.

### Security
- **Development dependencies updated** to clear the open advisories: happy-dom 21, vitest 4.1.12, and newer `tmp`, `postcss`, `js-yaml`, `brace-expansion`, `ws`, `nanoid`, `source-map-js` (the last ones through `overrides` and the lockfile). All of them are test, lint and build tools; none of their code is in the published script, and the bundle is byte-for-byte the same as 5.1.3. If `npm install` fails with `Cannot read properties of null (reading 'edgesOut')` while changing dependencies, use `npx npm@11 install`; `npm ci` is unaffected.

## [5.1.3] - 2026-11-17

Maintenance release: new build tooling and reorganized docs. The script behaves the same as 5.1.2.

### Changed
- **Docs: the user manual moved to the wiki.** The README is now the front page (install, quick start, highlights, privacy, development) and links to the wiki for the manual. Corrected along the way: a Danbooru account is required (the README said "no login"), the error examples are real Danbooru messages, and the Development section matches the current modules, commands and tests.
- **Build: vite 8 and vite-plugin-monkey 8** (replaces Dependabot PR #1). vite 8 bundles with rolldown, so esbuild is no longer installed; `tsconfig.json` moves to `moduleResolution: "bundler"`, which vite 8's export-only types need. The userscript header is unchanged and the bundle is about 8% smaller; no user-facing change.

## [5.1.2] - 2026-11-17

Hotfix: Preview works again after Danbooru's preview validation change.

### Fixed
- **Preview always failed.** Danbooru now validates a previewed note like a new one before sanitizing it (post, position, size, length), and the script sent only the body, so every Preview came back 422 (`⚠️ Preview failed`). It now sends the note's post, position and size too, the same way Danbooru's own editor does.
- **Server reasons are shown.** Danbooru's note errors (`reasons: [...]`) now appear in the message — a refused Preview says why (`⚠️ Preview failed — …`), and so does the send error list — instead of raw JSON.

## [5.1.1] - 2026-11-17

Follow-up polish to 5.1.0: clearer send state, and no way to commit or switch away from a note Danbooru would reject for length.

### Changed
- **Unsent changes are orange, sent is green.** The floating button's outline and badge and the arc menu's Confirm item are now orange while changes wait for ✓ Confirm — not on the server yet — and turn green once everything was sent, until the page reloads. The highlight is a soft glow, like the open-menu state, with a lightly rippled edge that slowly turns (held still under `prefers-reduced-motion`).
- **Commit is off past 5000 characters.** Danbooru rejects a longer note whole (it does not truncate), which used to surface only at Confirm. While the counter is red, Commit and Ctrl/Cmd+Enter do nothing and tapping another box keeps the current one selected (with a warning) — switching used to commit a new box as-is, or leave an edited note's text for Confirm to send. Shorten it and Commit, or Cancel (back to the last committed text) / Delete. Typing is not blocked, so a long paste can be trimmed. The limit counts the note's markup too (`<b>`, `<span style=…>`), as Danbooru does.

## [5.1.0] - 2026-11-17

Reliability, security and mobile-fit release from a mobile-focused audit: safer sending, clearer state at a glance, native-looking controls, and faster edit mode on note-heavy posts. Every fix below was reproduced first in a Playwright mobile-emulation harness that now ships as the opt-in `npm run e2e` suite.

### Added
- **Note length counter.** The popover header shows the body length as Danbooru counts it — `54 / 5000` — and turns red past the server's 5000-character limit. It follows the server's normalization (a line break is stored as CRLF and counts 2; an emoji counts 1), so it matches what Confirm will be judged on.
- **Unsent-changes indicator.** While anything is waiting for ✓ Confirm, the floating button gets a green outline and a badge with the number of changes, and the arc menu's Confirm item is outlined. The count is exactly what Confirm would send — a new box you never committed doesn't count, a deletion does.
- `npm run e2e` — opt-in Playwright scenarios against a mock post page (Pixel 7 emulation, all requests intercepted); each scenario names the task it guards.

### Changed
- **Confirm always shows a send summary.** The Confirm popover now opens with `New 3 · Edited 2 · Moved 1 · Deleted 4` (zero buckets omitted, deletions in red) before anything is sent. A batch that only moved or resized boxes used to go out with no prompt; it now shows the summary with Submit / Cancel (no tag fetch, no toggles).
- **On touch, select a box before dragging it.** A swipe that starts on a box you haven't selected now scrolls the page instead of moving that box (previously a 200 px swipe moved someone's note 185 px and Confirm sent it). Tap selects as before; mouse press-and-drag is unchanged.
- **Switching boxes keeps a new box's text.** Tapping another box while a never-✔'d new box was active left it green but Confirm silently dropped it. Typed text is now committed as if ✔ was pressed (↶ still undoes it); an empty new box is removed.
- **Smaller boxes stack above larger ones.** A note covering the whole image no longer swallows taps meant for the notes under it; the selected box sits on top.
- **Preview links are display-only.** Tapping a link inside the Preview no longer navigates away from unsaved work.
- **Popover buttons look like Danbooru's note dialog.** The action row is now text — **Commit** / **Cancel** / **Delete** / **History** — in the site's form-button colors (following your theme), instead of ✔ ✖ 🗑 📜 glyphs. It's "Commit", not "Save": the note is checkpointed locally and only sent on ✓ Confirm. The buttons stay 36 px tall (the native dialog's 24 px is too small for thumbs).
- **Tag changes merge with other editors'.** The tag update now sends the tag string you saw as `old_tag_string`, the same way Danbooru's own edit form does, so a tag someone else changed in the meantime is kept — and the extra re-fetch before the update is gone.
- **The touch-zone button has its own icon.** The side button you hold to see a box's touch zones was a plain 👁, easy to mistake for the note **Preview** toggle next to it. It is now a dashed box with a small eye on its top-right corner.
- **Undo has a drawn arrow.** The ↶ glyph rendered small and looked different per font; the undo button now draws its own arrow, curving over the top and ending pointed left.

### Fixed
- **Note popover ran off screen.** On 360 px phones the 343 px popover never met the clamp threshold, and under pinch zoom the clamp compared on-screen px with layout px and switched itself off — both popovers could lose their side buttons off either edge. Placement now works in visual px: always clamped, shrunk slightly when the screen is narrower than popover + padding, and the arrow slides to keep pointing at the box. This replaces v5.0.2's "let it overflow under extreme pinch zoom" behavior.
- **"Leave" on the reload prompt didn't discard the draft.** Chromium fires `visibilitychange` after `pagehide`, which wrote the discarded draft straight back and produced a misleading Restore prompt. Saving after an explicit Leave is now off until a bfcache return; any input after the prompt counts as "Stay".
- **Draft lost while the Confirm popover was open.** Confirm cleared the draft on entry and blocked saves, so backgrounding the tab at the tag popover and losing it to an OS kill threw the work away. The draft is now kept and saved until the first request actually goes out.
- **A stalled request locked the UI for good.** Every request now times out after 20 s (response and body), which lands in the error modal with Retry.
- **Retry and re-sends duplicated notes.** A POST whose response was lost may have been stored, and Retry — or Cancel → Confirm, a draft restore, a timeout the server finished late, or editing the note afterwards — sent it again. A temp note now remembers every state it sent without getting a refusal (network, timeout, 5xx), kept across Cancel and in drafts, and every Confirm or Retry first looks those states up among the post's notes (same rounded geometry, same body after Danbooru's normalization, NEL included), including an unedited copy already loaded locally. A match is adopted and any later edit goes out as a PUT; if the server can't be asked, the POSTs are held back under the ⏳ lock while PUT / DELETE / tags still go out. A refused POST (4xx) is re-sent without a check.
- **Previewed note markup could cover the popover.** Danbooru allows `position` / `inset` / `z-index` in notes; the Preview box now contains them.
- **Floating button stuck in drag mode** after the OS cancelled a touch (notification shade, back gesture).
- **Script failed to boot where `localStorage` is blocked** (legacy-key cleanup ran unguarded at import).
- **Tag detection slowed on hostile note bodies.** The style popover's open-tag regex backtracked quadratically on long unterminated tags (~8 ms per call at the 5000-char body limit, twice per selection change); it is now linear.
- **Entering edit mode on note-heavy posts.** Notes were rendered one by one with a layout read each; on a throttled phone 1000 notes took about 9 s. They now render in one pass (about 0.35 s in the same test). Posts with more than 1000 notes (Danbooru allows 1200) now load all of them.
- **Rate limits.** A batch now stops at the first 429 instead of firing every remaining request (which lengthens Danbooru's lockout); the rest are listed as `Skipped — rate limited` and the error modal says to wait about a minute before Retry.
- **Old drafts piled up.** Drafts for posts you never reopened stayed in `localStorage` forever; expired and invalid ones are now swept once per page load.
- **Dragging a box** read the image position three times per frame; it now reads it once per gesture.
- **Scrolling that starts on the image** no longer waits on the script (its touch listener is now passive).
- **iOS Safari zoomed in when a field got focus.** Safari zooms the page for any focused field under 16px; the note textarea, the link / ruby / HEX inputs and the Size / Font selects are now 16px. The popovers keep their size. (Not yet checked on an iPhone.)
- **Pen input** now behaves like touch on boxes (tap to select, then drag): with a stylus the browser could take over a drag that started on an unselected box mid-gesture. A drag cancelled by the browser or OS now puts the box back instead of keeping a partial move.

### Security
- Draft note ids are validated (`digits` or `temp-<uuid>`, consistent with `isServerNote`) and PUT / DELETE refuse a non-numeric id, so a tampered `localStorage` draft can't point Confirm at another endpoint.
- CI: the build job runs with a read-only token, no npm install scripts and no persisted git credentials; only the publish job (which installs nothing) holds the token that can push to `build`. A compromised dependency could still alter the bundle it builds, so branch protection on `main` and `build` (repository settings) remains necessary. Third-party actions are pinned to commit SHAs.
- README names the `build` branch link as the only official copy and flags `testbuild` as unreviewed work in progress.

## [5.0.3] - 2026-05-15

Patch release for popover header cascade and mode-toggle appearance regressions surfaced post-v5.0.2.

### Fixed
- **Help link color overridden by Danbooru's cascade.** The bare `.dmna-popover-help-link` rule (specificity 0,1,0) lost to Danbooru selectors like `#wrapper a` (0,1,1), keeping the help link blue at rest regardless of the intended muted-gray color. Both `.dmna-popover-mode-toggle` and `.dmna-popover-help-link` are now scoped under `#dmna-popover-header` (raising specificity to 1,1,0) to win that cascade race.
- **UA focus-ring painted a white pill behind the mode toggle after click.** `background: transparent` and `outline: none` on `:hover` / `:focus` / `:active` states suppress the browser's default button focus-fill; the color-flip + underline on hover/focus remain as the accessible focus indicator.

### Changed
- **Mode-toggle and help link rest color** shifted from `#4a9eff` (the same blue as the hover accent) to `rgba(255,255,255,0.55)` — recessive at rest, lit on hover/focus, matching Danbooru's own icon-at-rest toolbar pattern.
- **`:focus` and `:active` states added** to both header controls for keyboard and touch parity with the existing `:hover`.
- **Mode-toggle label glyphs**: `Preview` → `👁 Preview`, `Edit` → `✎ Edit` for visual affordance at rest.

## [5.0.2] - 2026-05-14

Patch release for one mobile-only UX bug surfaced during post-v5.0.1 testing.

### Fixed
- **Note popover clipped at viewport edge.** When a note box sat near the left or right edge of a narrow screen, the box-centered popover (343 px wide) ran off the side and the leftmost / rightmost toolbar buttons (✖ / 📜) became unreachable. `updatePopoverPosition` now clamps `popVisualLeft` to `[POPOVER_VIEWPORT_PADDING, vvWidth − POPOVER_WIDTH − POPOVER_VIEWPORT_PADDING]` whenever the popover actually fits in the visual viewport. The clamp is intentionally skipped at extreme pinch-zoom (`vvWidth < POPOVER_WIDTH + 2 × PADDING`) — there pinning to the viewport edge would break the box-anchoring illusion entirely, so the v5.0.1 "let it overflow under pinch" behavior is preserved. The mobile-stacked style popover mirrors the same clamp so the two popovers slide together as one column.

## [5.0.1] - 2026-05-15

Patch release for two mobile-only UX regressions surfaced during post-v5.0.0 testing on real phones, plus a CI tooling change that lets future WIP branches publish to `testbuild` automatically.

### Fixed
- **Style popover unreachable on narrow viewports.** The v5.0 right-of-note-popover attach (with left-flip fallback) couldn't seat the 260 px style popover anywhere on screen once the viewport dropped below ~600 px wide — the 343 px note popover already claimed the center column, so both placements ran off the side and the user just saw nothing happen when they tapped Aa. On `window.innerWidth < 600` the popover now stacks under the note popover with a slide-up animation, horizontally centered on the same box anchor so the two read as one column. No clamp against the visual viewport bottom (the keyboard region IS where this popover is meant to land); a page swipe re-pins the whole column together since both popovers track the same visualViewport-scroll pipeline.
- **Sub-pickers dismissing on scroll.** Color / Stroke / Link / Ruby modals registered a document-level pointerdown capture listener for outside-tap dismiss. On mobile the first pointerdown of any scroll gesture landed outside both popovers, so the picker closed immediately AND the scroll itself was blocked by the handler's `preventDefault`. New `utils/pointer-tap.ts` wraps pointerdown → move → up into a single tap-event abstraction that fires only when the cumulative movement (scaled by `visualViewport.scale` so the threshold tracks visible pixels under pinch zoom) stays within `DRAG_THRESHOLD_PX` = 5. Scrolling now leaves the picker open with the browser's native scroll uninterrupted; a deliberate tap still dismisses.

### Changed
- **CI publish workflow.** `publish-build.yml` triggers widened from `main` / `develop` to also include `claude/**`, `feature/**`, `fix/**`, `hotfix/**`, and the publish-target router flipped to `main → build` / anything-else-matched `→ testbuild`. Any WIP branch push now refreshes the `testbuild` raw URL automatically — reviewers can Tampermonkey-refresh to pick up the latest in-progress build without bumping the production `@updateURL`. Same routing pattern as the sister project Danbooru-Insights uses.

## [5.0.0] - 2026-05-15

**The popover becomes a markup-aware editor.** v4.x's popover was a textarea + ✔/✖/🗑 surface; v5 turns it into the full inline-style editor Danbooru's own note dialog has on desktop, but rebuilt for mobile gestures. Style sub-popover with Bold / Italic / Underline / Strike / sub / sup / tn / code / link / ruby buttons; color / stroke / background pickers (Material-tone swatches + HEX); Size dropdown (6-stop %-based) and Font dropdown (12 wiki fonts with in-option preview); inline `<a href>` and `<ruby><rt>` modals for the two markup forms that need a second value. Layered on top: a Preview mode that round-trips through Danbooru's own sanitizer so the user sees the real rendered result before Confirm; a History button that opens the server-side note version log; a native-conflict guard that hides our floating button while Danbooru's translation mode or edit dialog is up (and gates `Shift+N` symmetrically); per-style undo so the popover ↶ rewinds individual style toggles; and a force-quit recovery hotfix that closes three regressions surfaced during this cycle's manual checks.

Major version bump (4 → 5) reflects the user-facing surface area, not a breaking change — every prior keyboard / gesture / API contract is preserved, and v4 installs auto-update through the `build` branch.

### Added — Popover scaffold (Phases 1-4)
- **Native conflict detection** (`state/native-conflict`). Single `MutationObserver` on `document.body` watches `body.mode-translation` and `.ui-dialog.note-edit-dialog`. While either is active our floating button auto-hides (OR-combined with the existing text-input-focus branch) and `setMode('active')` is gated with an explanatory toast. The reverse direction (`interactions/native-block`) swallows bare-N keydown and `#translate` sidebar clicks in the capture phase while our active mode is on, with a shared-cooldown toast so the user gets feedback instead of a silently broken trigger. `Shift+N` gains the symmetric guard.
- **History button (📜)** as the 4th popover action. Enabled for server-side notes (including soft-deleted ones — their version history is still meaningful); opens `/note_versions?search[note_id]=<id>` in a new tab so the main editing flow is preserved.
- **Preview mode.** Header row above the textarea hosts a Preview / Edit toggle. Tapping Preview POSTs the current body to `/notes/preview.json`, then renders the server's `sanitized_body` HTML in a read-only sibling of the textarea (same grid cell, only one displayed at a time). Loading state uses a `…` glyph on the toggle button; API failures surface a toast and bounce back to Edit with the typed text intact. `previewRequestId` invalidates in-flight calls on note swap / popover close so a late response can't slam stale HTML into the now-Edit slot. The preview container styles `<tn>` / `<div.note-body>` to match Danbooru's own sanitizer output, so a tag-only test renders identically.
- **Style sub-popover** (`ui/style-popover`). Sibling popover attached to the right of the note popover (flips to the left when right placement would overflow the viewport), pinch-zoom invariant via the same `1/scale` counter as the note popover. Wraps the textarea selection on tap, pulls active-tag highlights from a regex-walk of the surrounding markup so the user can see what's already applied, and re-selects the wrapped text after each mutation so a follow-up tap nests inward.
- **`view help` link** in the popover header (right of the Preview toggle), pointing at Danbooru's own `wiki_pages/help:notes`. Underlined-on-hover only, matching native link styling.

### Added — Markup integration (Phase 5)
- **Inline-style span model.** Color / Stroke / Background / Size / Font controls share a single unified `<span style="…">` per selection (option-A model, D17). Repeated changes mutate the existing span's style attribute in place rather than nesting; removing the last property unwraps the span entirely. `utils/style-attr.ts` parses + serializes the `style="…"` value with quote / paren tolerance.
- **Color picker** (`ui/color-picker`) for Text and Background. 14 Material-Design-toned swatches (`#000000` / `#FFFFFF` / `#E53935` / `#EC407A` / `#AB47BC` / `#5C6BC0` / `#1E88E5` / `#00ACC1` / `#43A047` / `#9CCC65` / `#FDD835` / `#FB8C00` / `#8D6E63` / `#757575`) in a 7-column grid + a HEX input (`#RRGGBB`, 6-digit only this cycle). BG also gets a leading transparent swatch that maps to property removal; Text collapses `#000000` to "remove color" since black is the textarea's default ink.
- **Stroke picker** (`ui/stroke-picker`). Same 14 swatches + HEX, plus an Advanced collapsible section with thickness (1 / 2 / 3 px) and per-side checkboxes (top / right / bottom / left). Output is a `text-shadow: …` value with one shadow per checked side, matching Danbooru's own stroke pattern.
- **Size dropdown** (6 stops). `−2 / −1 / Default / +1 / +2 / +3` map to `70% / 85% / normal / 125% / 150% / 200%` respectively. The "Default" sentinel removes the `font-size` property; current-applied size syncs back into the dropdown on selection change so the user always sees what's active.
- **Font dropdown** (12 wiki fonts). The full Danbooru `fonts` wiki list — `comic / narrow / mono / slab sans / slab serif / formal serif / formal cursive / print / hand / childlike / blackletter / scary` — with each `<option>` styled in its own font-family for in-dropdown preview. A leading empty option doubles as "no font set."
- **`sub` / `sup` / `code` tag buttons** alongside B / I / U / S in row 1-2. `tn` (translator note) and `code` get their own row. Active highlights flag any wrapping layer regardless of how it was authored — handwritten markup pulled in from a server note still lights up the matching button.
- **`<a href>` link sub-popover** (`ui/link-popover`). Inline modal layered above the note popover, mounted as a child of `#dmna-popover` so it inherits the popover's transform/scale. URL input normalizes its value (trim → strip `https://danbooru.donmai.us` host prefix so internal links become relative). Re-tapping the `<a>` button while the modal is open closes it (same-button toggle, parity with ruby).
- **`<ruby><rt>` modal** (`ui/ruby-popover`). Sibling pattern to the link modal but for kanji + reading wrapping. On confirm the selection becomes `<ruby>{base}<rt>{reading}</rt></ruby>` and the post-wrap selection covers the entire ruby content (`{base}<rt>{reading}</rt>`) so detection lights up the outer `<ruby>` and the user can stack other style tags on top. Unwrap path strips both the `<ruby>` wrapper AND every `<rt>` child (handles server multi-rt markup).
- **Per-style-action undo via popover ↶**. New `'text'` action log entry type with a `TextSnapshot` payload (textarea value + caret range). Every style mutation pushes a snapshot before rewriting the textarea, so a single ↶ tap rolls back exactly one style toggle while preserving raw keystrokes' native textarea undo history. `state/notes-store` calls into `ui/popover.applyTextUndoSnapshot` via the new `onTextUndo` hook (Z5 layer 2 → 3 inversion preserved).

### Changed
- **Popover layout.** Bottom actions move from `1fr×3` to `1fr×4` to make room for History; a header row is added above the input row (Preview/Edit toggle + view help link); the side stack grows from 2 to 3 buttons (eye / undo / style toggle) and the textarea grows `rows 3 → 4` so grid `align-items: stretch` resolves cleanly against the taller side stack. POPOVER_WIDTH 260 → 343 to keep action-row cell widths in sync with the new style-popover row.
- **Color row layout.** Phase 5 expanded the color row from 2-col (Text / BG) to 3-col (Text / Stroke / BG) to host the new Stroke picker. Stroke uses `Strk` (4-char abbrev) rather than `Stroke` so the swatch fits.
- **Hover/press contrast.** Hover/press feedback on every popover button shifts from a near-white tint to the popover's blue accent + dark text on white-glyph buttons (B / I / U / S / sub / sup, color row labels, ✔ / ✖, Aa / ↶). Colored buttons (tn / code / a / ruby / delete) keep their own hue. Avoids the v4.x glitch where white glyphs disappeared into the white hover background.
- **Stroke picker close affordance.** The redundant "Remove stroke" text button (which duplicated the leading transparent swatch) was removed; transparent swatch is the single way to clear the property, matching the BG color-picker pattern.

### Fixed — v4.1 force-quit recovery polish (Phases 1-3 manual checks)
- **`hasContentToSave` over-eager save.** The v4.1.0 gate (`mode==='active' && notes.size>0`) saved on no-op states — server-only collections with no local edits, fresh-new temp boxes the user opened but never typed into — and surfaced a misleading Restore toast on the next entry. Tightened to `hooks.hasPendingChanges()` OR any fresh-new temp with non-empty text (keystrokes that haven't been ✔'d yet are still user work we want to preserve).
- **`applyDraftSnapshot` render race.** At first page entry `originalWidth` is 0 until `enterActiveMode`'s async meta fetch resolves, but v4.1.0 rendered boxes immediately after `setMode`, plotting them with a zero denominator in the coord transform — visible as one giant misplaced box with neighbors apparently dropped. The function is now `async` and awaits `fetchPostMeta` before rendering.
- **`beforeunload` prompt + draft conflict.** v4.1.0 saved the draft unconditionally before showing the "Leave site?" prompt, so even when the user chose Leave (an explicit discard signal) the draft survived and prompted a misleading Restore on the next entry. A `promptedDiscardOnLeave` flag now coordinates `beforeunload` ↔ `pagehide`: prompted-leave clears the draft, otherwise the normal save path runs. Force-quit / OS-kill skips `beforeunload` entirely so the flag stays false and the normal save still fires.

### Fixed — Phase 5-h pre-release audit
Critical findings (release blockers) from a 3-area audit (security / runtime + race / architecture):
- **Z5 sibling rule violation.** `ui/arc-menu` was directly importing `runConfirmFlow` from `confirm/batch` — a layer-3 sibling import the architecture fitness test wasn't checking. Replaced with an `ArcMenuHooks` bag wired by `main.ts`; `test/architecture.test.ts` gains a `ui/ → confirm/` direction check.
- **`NotesStoreHooks` key count.** Architecture test expected 8 keys but the interface gained `onTextUndo` (9). Sync the constant + assertion so a future hook addition that bypasses `main.ts` wiring fails the test.
- **`isSending` lock leak.** `confirm/batch.isSending` unlatched at `sendBatch`'s try/finally, leaving a window in `handleSendResult` (after `applyServerStateToLocal`, during the error-modal Retry/Cancel wait) where local state mirrors partial server commits. A force-quit save in that window would persist a half-applied snapshot and double-send already-PUT items on the next entry. Added `isInConfirmPipeline` broader guard spanning `runConfirmFlow`'s full try/finally; lifecycle save handlers gate on both flags.
- **`dismissActivePopover` / `popoverCancel` text snapshot leftover.** Both paths roll `current` back to `confirmedState` but left `'text'` action-log entries in place — a later popover ↶ would resurrect the markup the user just canceled. New `clearTextActionsForNote` helper called from both paths.
- **IME composition guard.** Textarea `Ctrl/Cmd+Enter` Confirm shortcut and global `Esc` dismissal both gate on `!e.isComposing` (with the Safari `keyCode === 229` fallback). Prevents IME-commit Enter / composition-cancel Esc from routing to ✔ / dismiss with half-typed Hangul / Kana / Pinyin.

Major findings (release-window fixes):
- **Defense-in-depth client-side escape.** Link `normalizeUrl` rejects `javascript:` / `data:` / `vbscript:` / `file:` schemes and strips `<>"`; ruby `applyRubyWrap` strips `<>"` from the user-supplied reading before splicing into `<rt>`. Danbooru's `NoteSanitizer` is the authoritative backstop, but the client filter keeps the request payload always well-formed.
- **Preview innerHTML response shape.** `apiPreviewNote` throws on a missing or non-string `sanitized_body`; the popover sink also gates the assignment so a future API shape change fails closed.
- **Draft per-entry schema validation.** `isPersistedDraftV1` now walks each `notes[]` / `actionLog[]` entry, gating `NoteState` x/y/w/h via `Number.isFinite` + `text` as string + the discriminated `ActionLogEntry` union. Tampered or partially-corrupt localStorage entries no longer propagate `NaN` coords or non-string text into `applyDraftSnapshot`.
- **4-picker `suppressNextClick` TTL.** Color / stroke / link / ruby pickers' outside-tap suppress flag gets a 500 ms safety reset matching `drag-resize`'s pattern. An outside-tap that latches the flag without a matching click can no longer silently eat the next unrelated click.
- **`applyRubyUnwrap` multi-rt.** Regex gains the `/g` flag so server notes with per-character furigana (multi-rt markup) don't leave orphan `<rt>` after unwrap.
- **`selectionchange` global listener lifecycle.** Bound only while the popover is open (was: bound at boot for the page lifetime). The narrow narrow-the-callback condition still ran on every page-wide selection change in v4.x.
- **Style popover auto-hide race during sub-modals.** `refreshStylePopoverState` skips `hideStylePopover` while a sub-modal (color / stroke / link / ruby) is up. Sub-modal focus steals the textarea selection, which fires `selectionchange` with no live selection — the prior auto-hide raced the picker's own close path and tore the style popover out from under the user mid-pick.
- **Unsafe type-cast removal.** `confirm/classify.ts` narrows `noteId` via `isServerNoteId` guard instead of `as ServerNoteId`. `state/notes-store.pushAction` becomes overloaded so the `'create'` arm requires `prevState: null` and the geometry-bearing arms require a non-null `NoteState`. `applyDraftSnapshot` rebuild uses a discriminated-union switch instead of a spread cast.
- **`fetchServerNotes` in-flight dedupe.** A fast active-mode toggle no longer fans out two GETs; the cached promise short-circuits the second call.
- **`detectOuterLayers` test coverage.** The style-popover's regex-driven outer-layer parser was untested. New `test/detect-outer-layers.test.ts` covers nested wraps, attribute preservation, single/double-quoted style attrs, mismatched-close termination, and the Phase 5-d ruby+span composition case (15 cases total).

### Internal
- **New modules**: `state/native-conflict.ts`, `interactions/native-block.ts`, `ui/style-popover.ts`, `ui/color-picker.ts`, `ui/stroke-picker.ts`, `ui/link-popover.ts`, `ui/ruby-popover.ts`, `utils/style-attr.ts`. Layer assignments respect the Z5 split (state=2, interactions=4, ui=3, utils=1).
- **New hook bag**: `ArcMenuHooks` (`onConfirm`) wired by `main.ts`, replacing the prior direct `arc-menu → confirm/batch` import.
- **New cross-layer hook**: `NotesStoreHooks.onTextUndo` so `popoverUndo`'s `'text'` branch can route the textarea+selection restore through `ui/popover.applyTextUndoSnapshot` without state→ui inversion.
- **New action-log type**: `'text'` with a `TextSnapshot` payload (text + selectionStart/selectionEnd). `pushTextAction` is the dedicated push helper.
- **Architecture fitness gains**: `ui/ → confirm/` direction check, `NotesStoreHooks` key count synced (8 → 9), `ArcMenuHooks` interface check.
- **Lifecycle handlers reorganized**. `main.ts` `beforeunload` no longer saves directly; the new flag-and-defer pattern keeps save decisions in `pagehide` where the user's prompt response is known. `visibilitychange→hidden` stays as the OS-kill / background-into safety net.
- **`api/notes`**: `apiPreviewNote(body)` and per-call dedupe on `fetchServerNotes` added. Both gate response shape with explicit runtime checks before returning.
- **Build**: `dist/MobileNoteAssist.user.js` ~111 kB → ~206 kB across the cycle (~+95 kB raw / ~+18 kB gzip), reflecting the markup-editor surface area.
- **Tests**: 11 files / 298 cases (was 10 files / 283 cases). New: `test/detect-outer-layers.test.ts` (15 cases).

### Notes
- `@grant none` preserved.
- `@updateURL` / `@downloadURL` unchanged (still the `build` branch); v4.0+ installs auto-update.
- Preview mode treats Danbooru's `sanitized_body` as already-safe HTML and assigns it via `innerHTML`. XSS responsibility stays server-side; the client adds defense-in-depth shape gates as a backstop.
- No backwards-incompatible changes — every prior keyboard shortcut, gesture, and API contract works as in v4.x. Major version bump reflects the user-facing surface area only.

## [4.1.0] - 2026-05-13

**Force-quit / OS-kill recovery + structural cleanup.** Adds a `localStorage`-backed draft for in-progress note edits so mobile force-quits and OS background-kills no longer silently lose work. Bundled with mechanical type / structure cleanups (B3/B4/B6/B7/F2/F5) deferred from v4.0.

### Added
- **Draft persistence + restore prompt.** Three lifecycle handlers (`beforeunload`, `pagehide`, `visibilitychange→hidden`) snapshot the current notes Map + actionLog + mode + activeNoteId into `localStorage` under a per-post key (`dmna_draft_{postId}`, 24h TTL, `schemaVersion=1`). Boot path detects the draft and surfaces a two-button toast: **Restore** applies the snapshot via `applyDraftSnapshot`, **Discard** drops the key. The follow-up server fetch supplements with any newly added server-side notes; for shared ids, the `notes.has` guard means the draft's local edits win.
- **`safeSetItem` / `safeGetItem` helpers.** Shared `localStorage` wrapper with QuotaExceededError / SecurityError (private-mode) guard. `ui/floating-button` position saves now route through these so the floating-button persistence and the draft persistence share a single private-mode-safe code path.
- **`showToastWithActions(msg, actions[])`.** Two-button toast variant with auto-dismiss disabled, used by the restore prompt. The same `#dmna-toast` element reshapes from alarm-pill to left-aligned card via a `.has-actions` modifier; primary action gets a green accent.

### Changed
- **Single-source `ToastLevel`** (`B3`). `src/types.ts` now exports the canonical 4-variant union (`info | success | warning | error`); `ui/toast` re-exports it, `state/notes-store` and `confirm/batch` import directly. `NotesStoreHooks.onToast` widens from 3-variant to 4-variant (gains `success`).
- **`popoverConfirm` / `popoverDelete` collapse** (`B4`). The redundant `onNoteVisualsChanged(noteId)` call after `setActiveNote(null)` is removed — the `onActiveChanged(prev=noteId, null)` path already refreshes the prev box's visuals via main.ts's hook wiring. v3.1.1's double-firing was preserved through v4.0 for behavior parity; v4.1 collapses to a single hook.
- **`updatePopoverPosition` DRY** (`F2`). `ui/popover` now calls `utils/coords.getImageDisplayRect(img)` instead of inlining the equivalent `getBoundingClientRect + pageXOffset/Y + 0×0-guard` block.

### Internal
- **`imageToScreenRect` return type narrowed to `DisplayRect`** (`B6`). The `null` branch was unreachable — `originalWidth=0` always falls back to `scale=1` and returns an object. Callers in `ui/note-box` and `ui/popover` drop their defensive null guards. The JSDoc documents the intentional asymmetry with `screenToImageRect` (which does return `null` in that case as a "do not create a note" signal).
- **`PendingPut.serverId` / `PendingDelete.serverId` branded as `ServerNoteId`** (`B7`). Consistent with the same interfaces' branded `noteId` field. `classifyChanges` uses a compile-time `as ServerNoteId` cast inside the `isServerNote` branch (the value is already a branded string at runtime, so no factory call needed).
- **Test coverage**: +43 cases (213 → 256). New `test/draft.test.ts` (28) covers save/load round-trip, TTL expiry, schema mismatch, structural validation, `QuotaExceededError` catch, per-post key isolation, and the `safe{Get,Set}Item` helpers. `test/notes-store.test.ts` gains 15 cases for `hasContentToSave`, `serializeForDraft`, and `applyDraftSnapshot` (including the rebrand-at-load-boundary invariant).
- **F1 retracted.** Initial backlog flagged `getActiveModeGen` as a dead export; re-examination found 4 test callers verifying the `setMode → activeModeGen` bump invariant (which underwrites the async `enterActiveMode` stale-token bail-out). Export retained.
- **Build**: `dist/MobileNoteAssist.user.js` 103.99 kB → 111.73 kB across the cycle (+7.74 kB raw / ~+1.2 kB gzip), reflecting the new draft module and the toast/popover wiring.

### Notes
- `@grant none` preserved. No GM_* API introduced.
- `@updateURL` / `@downloadURL` target the `build` branch unchanged; v4.0 installs auto-update.
- The draft persistence and floating-button position are the only data the script writes to `localStorage`. Both are scoped to `danbooru.donmai.us` and never leave the browser.

## [4.0.0] - 2026-05-11

**TypeScript migration release.** No user-facing functional change relative to v3.1.1; the entire codebase was re-authored from a single ~3,700-line `MobileNoteAssist.user.js` IIFE into a typed, layered `src/` tree, then bundled to the same single `.user.js` artifact via `vite-plugin-monkey`. The `MAJOR` bump follows DI v6.5.2 → v7.0.0 convention — internal restructuring at this scale (source layout, debug surface paths, build/install URL) is treated as breaking even when behavior is preserved.

### Changed (minor UX deviations from v3.1.1)
- **Floating-button long-press shortened** from 1500ms to 1000ms (config constant `LONG_PRESS_DURATION`). User feedback during V1-7 manual verification: 1.5s felt unresponsive on mobile. The 1.0s value still clears the click vs. long-press boundary used elsewhere on the page (Tampermonkey's own context-menu trigger ≥ 500ms).
- **Tag-fetch failure now aborts the Confirm flow.** v3.1.1's `showTagPopover` opened with all four toggles OFF and a toast on `fetchPostTagString` rejection — misleading because the toggles didn't reflect the post's actual tag state and any downstream PATCH would also fail (the PATCH re-fetches tags before sending). v4.0 resolves the popover to `null` instead, which `runConfirmFlow` already treats as cancel, leaving the user in active mode with state intact.

### Infrastructure
- **Source layout**: 20+ modules under `src/` partitioned into 5 layers (`utils`, `state`/`api`, `confirm`/`ui`, `interactions`, `main`). Cross-layer dependencies inverted via hook bags injected at boot (`NotesStoreHooks`, `ConfirmFlowHooks`, `NoteBoxHooks`).
- **Branded `NoteId`**: `ServerNoteId | TempNoteId` phantom types with `asServerNoteId` / `asTempNoteId` factories at trust boundaries. Plain `string` no longer satisfies a `NoteId` parameter at compile time.
- **Build pipeline**: vite + vite-plugin-monkey for the userscript bundle, `vitest` + `happy-dom` for tests, `gts` for lint/format, TypeScript strict mode (`strict`, `noUnusedLocals`, `noUnusedParameters`). `npm run build` chains test + tsc + vite build.
- **Test coverage**: 213 vitest cases across 8 files — unit tests for `coords`, `classify`, `csrf`, `tag-popover`, `notes-store`, `note-box`, `confirm/batch`, plus an architecture-fitness suite that mechanically verifies the layer rule, hook-bag completeness at boot, the STYLES injection site, and type-only re-export integrity.
- **Install URL changed** from `JavaScripts/raw/main/MobileNoteAssist/MobileNoteAssist.user.js` (legacy mono-repo) to `Danbooru-Mobile-Note-Assist/raw/refs/heads/build/MobileNoteAssist.user.js` (the new orphan-style `build` branch carrying just the bundled artifact). v3.1.1 installs that pointed at the legacy URL are **not auto-migrated** — users need to reinstall once from the new URL.
- **`main` branch is source-only.** No root userscript file lives on `main`; the bundled artifact lives on `build`, and `dist/` is `.gitignore`d.

## [3.1.1] - 2026-05-07

### Changed
- **Repository migration.** Development moved to its own dedicated repository at `https://github.com/AkaringoP/Danbooru-Mobile-Note-Assist`. Full git history preserved via `git subtree split`. This release embeds `@updateURL` / `@downloadURL` pointing to the new repository, so existing installations fetched from the legacy `JavaScripts/raw/main/MobileNoteAssist/MobileNoteAssist.user.js` URL will self-migrate to the new endpoint on the next Tampermonkey update check. No functional changes; the file body is byte-for-byte identical to v3.1.0 outside the metadata block + `SCRIPT_VERSION` constant.

## [3.1.0] - 2026-05-05

### Added
- **Pinch-zoom counter-scaled corner handles.** Each of the 4 resize/move handles is now scaled by `1 / visualViewport.scale` per active frame, so each handle's visual footprint stays a constant ~32 device-px across pinch-zoom levels. Per-corner `transform-origin` anchors each handle's box-touching point to the box's actual corner, so `scale()` collapses the handle TOWARD the box rather than away from it; the CSS bounding box (and pointer-event hit region) shrinks proportionally, which is what unlocks the device-px floor below. NW = `100% 100%`, NE = `0% 100%`, SE = `0% 50%`, SW = `100% 50%` — SE/SW are vertical-center anchors because those handles are shifted up by half (`bottom: -16px`), placing the box's bottom edge at their vertical middle. Driven by `updateActiveHandleScales`, which writes a single `--dmna-handle-scale` CSS custom property on the active note element (one property write per frame instead of four inline transforms) and is read by all four `.dmna-handle` elements. Called from `updateVisualViewportPositions`'s RAF batch and pre-reveal in `showPopover` (same flicker-avoidance pattern as the popover).
- **`MIN_DRAG_CREATE_SIZE_DISPLAY = 24px`** constant for PC drag-to-create's "this drag was deliberate" threshold. Decoupled from `MIN_BOX_SIZE_DISPLAY` so lowering the runtime resize floor doesn't make accidental tiny mouse jitters spawn boxes.

### Changed
- **`MIN_BOX_SIZE_DISPLAY` semantics changed: 24 CSS px → 48 device px.** User report: small features like single hiragana glyphs in tight word balloons (e.g. post #11304460's lower-right "ちょ") couldn't be marked because the pre-3.1 24-CSS-px floor grew to 72 device px at vv.scale=3 — pinch-zoom didn't help. The constant is now interpreted as a **device-px** floor (constant on-screen footprint across pinch zoom) via the new clamp expression `(MIN_BOX_SIZE_DISPLAY / vvScale) / scale`; the CSS-px floor and image-space floor both shrink with pinch zoom, so users can pinch in over a tiny feature, resize down, and pinch back out with the box staying small in image space. The chosen 48 device px is 1.5× the handle's device-px size — large enough that the box stays the visually dominant element of the active assembly rather than a sliver between four 32-device-px handles. Image-space floor at vv=3, scale=0.4 is 40 image px (vs 120 pre-3.1).
- **Resize clamp accounts for `visualViewport.scale`.** `onInteractionMove`'s `minImg` formula is now `Math.max(MIN_BOX_SIZE_IMG, (MIN_BOX_SIZE_DISPLAY / vvScale) / scale)`. The image-space safety floor (`MIN_BOX_SIZE_IMG = 8`) is unchanged.
- **SE corner triangle now scales with box display size.** The 8×8 CSS px `::after` resize-affordance was magnified by the visual viewport at high pinch zoom (e.g., 24 device px at vv.scale=3) and could fully cover a small box. Now `renderNoteBox` writes a `--dmna-triangle-size` CSS custom property = `min(width, height) / 6` (CSS px) on the active note element, capped at 8 CSS px — so the triangle stays an ~8-device-px affordance for any normal-size box (cap kicks in at box ≥ 48 CSS px = MIN_BOX_SIZE_DISPLAY at vv=1), and shrinks proportionally for sub-MIN states. The visual viewport magnifies both the box and the triangle by the same factor, keeping the on-screen ratio constant across zoom levels.
- **Popover layout switched from flex to CSS grid** for clean column alignment between the input row (textarea + 👁/↶ side-stack) and the button row (✔/✖/🗑). Button row uses `grid-template-columns: 1fr 1fr 1fr`. Input row uses `1fr calc((100% - 16px) / 6)` — the side-stack column is half a bottom-row button width, right-aligned with the delete button's right edge; the textarea takes the remainder. (Earlier iterations during development tried a full-button-column side-stack but it ate too much textarea width; the half-column layout keeps the visual right-edge gridline while preserving textarea space.)
- **Tag toggle row restructured to sidestep Android `<button>` rendering issues.** Some Android browsers (Chrome / Samsung Internet) paint a bright-white background on `<button>` tap/focus that overrode our CSS `background` and hid the white "Translated" label text — and unlike the per-note popover's ✓/✗/🗑 row, tag toggles don't close the popover on tap, so the focus state persisted. The row is now a non-interactive `<div class="dmna-tag-row">`; the click target is the inner pill switch only (`<button class="dmna-tag-switch-btn">` wrapping the existing 36×20 pill visual). The row never receives `:focus` / `:active` / tap-highlight. Hit area is ~52×36 around the pill — smaller than the row but acceptable for a popover used briefly during the Confirm flow. `is-on` / `is-disabled` classes moved to the row div; descendant selectors (e.g. `.dmna-tag-row.is-on .dmna-tag-switch`) updated accordingly.

## [3.0.1] - 2026-05-05

### Changed
- **Floating button hides while a note popover is open.** The button used to remain visible at the bottom-right while a per-note popover was up, which on mobile sits in the same screen region as the popover's ✔/✖/🗑 row. An accidental thumb-tap on the button could open the arc menu and let the user fire ✓ Confirm prematurely. Now `body.dmna-note-popover-open` is toggled in `showPopover` / `hidePopover` and a CSS rule fades the floating button out (`opacity: 0; visibility: hidden; pointer-events: none`) for the duration of the popover. Reuses the existing 0.2s opacity transition.

### Fixed
- **Toasts now flash on every `showToast` call, not just the first.** Previously, calling `showToast` while a previous toast was still on screen replaced the text but left the `.show` class unchanged — same className meant CSS transitions never re-fired. Pressing Shift+Enter for "No changes to confirm" right after another toast (e.g., Shift+N's "Edit mode on") looked like the second event did nothing, because the only visible cue was the silently-replaced text. Fixed by clearing the className + forcing a reflow before re-adding it, so each call runs the opacity / visibility transitions fresh.

## [3.0.0] - 2026-05-05

### Changed (BREAKING)
- **Workflow paradigm shift**: single-note immediate-save replaced with multi-note batched Confirm. Users now create/edit/delete several boxes in active mode and commit them all at once via the arc menu's ✓ Confirm — instead of each box round-tripping to the server on its own ✔. Rationale: bulk translation work was the dominant use case and per-note saves were 90% network-waiting.
- **Sidebar link removed**. The script entry point is now solely the floating button (and the new `Shift+N` shortcut). The Note Assist: ON/OFF link in the post sidebar is gone — its state was always redundant with the floating button.
- **Tag toggles moved**: translation tag toggles (translated / translation_request / check_translation / partially_translated) are no longer part of the per-note popover. They appear once per Confirm flow in a dedicated tag popover anchored to the Confirm button. Per-note popover only carries the textarea + ✔/✖/🗑/👁 + ↶.
- **`@version` now follows MAJOR.MINOR.PATCH**: `2.6` → `3.0.0`. Previous releases used `MAJOR.MINOR` only.

### Added
- **Arc menu UI**: long-press / tap-and-hold on the floating button opens a 2-item arc (✓ Confirm at -100°, ✏️ Edit at -150°). Replaces the v2.6 single button + sidebar combo.
- **Multi-note active mode**: `notes` Map indexed by id holds both temp (`temp-…`) and server-loaded notes. Boxes color-code by state (green = uncommitted, blue = ✔'d, red dashed = soft-deleted, etc.).
- **Per-note undo (↶)**: each note's popover has its own ↶ button, backed by a `Map<noteId, ActionLogEntry[]>` per-note stack. Undoes 4 action types: `create` (hard-delete), `edit` (revert ✔), `delete` (un-soft-delete), `transform` (geometry only — text/checkpoint preserved).
- **PC drag-to-create**: mouse-only. Drag on the image to draw a custom-size rectangle (with dashed yellow ghost preview); tap stays as default-size spawn. Touch tap behavior unchanged.
- **PC keyboard shortcuts**: `Ctrl/Cmd+Enter` from the textarea = ✔ Confirm box; `Esc` (when popover open) = dismiss with fresh-new=hard-delete / confirmed=revert routing; `Shift+N` (no popover, no input focus) = toggle Edit on/off.
- **iOS-style pill toggle switches** in the tag popover (label + 36×20 track + 16×16 thumb, ON = green track + thumb slides right). Restores v2.6's 4-rule interaction (translated exclusivity, c_t/p_t imply t_r).
- **Per-note popover side-stack**: 👁 (hold to show debug zones) above ↶ (per-note undo).
- **API error body surface**: `apiCall` now extracts `message` / `error` / `errors` from Danbooru's 4xx JSON bodies (or falls back to raw text, truncated to 200 chars). Previously a 422 from "Box overlaps existing note" or "tag_string can't be blank" showed only `HTTP 422` — now shows the actionable detail.
- **Per-type toast messages**: `showToast(msg, type)` accepts `'info' | 'success' | 'warning' | 'error'`. Each type has its own accent border color and auto-dismiss duration (success 1.8s, info 2.5s, warning 3s, error 4.5s). Existing call sites updated with appropriate types.
- **Confirm batch flow**: `classifyChanges` → tag popover (if needed) → `sendBatch` (DELETE → PUT → POST → tag PATCH) → `handleSendResult` (success: clear log + reload; failure: error modal with retry).
- **`Edit mode on/off` toast** on Shift+N keyboard toggle (mode change is otherwise only signaled by the floating button icon flip — the toast is for keyboard-only users).
- **MIN_BOX_SIZE_DISPLAY = 24px** (down from 40px). Allows marking small details like eyes / glyphs.

### Fixed
- **Race fix**: tapping the image during the `setMode('active')` → metadata-fetch window no longer surfaces an "Image dimensions unknown" toast. `spawnDefaultBoxAtClient` now awaits `postMetaPromise` and proceeds when ready (or bails silently if the user changed their mind during the await).
- **POST success local state**: `applyServerStateToLocal` builds the new server-note baseline from the server's normalized response (`x/y/width/height/body`) instead of the locally-rounded values we sent. Prevents phantom-dirty classification on the Retry path after partial sends.
- **Tap-creates-then-cancels regression**: PC drag-to-create's `pointerdown` now `preventDefault()`s, suppressing the entire compatibility mouse event chain (mousedown/mousemove/mouseup/click). This kills Danbooru's native `#image-container` mousedown handler regardless of which propagation phase it's bound on — the previous capture-phase blocker on `<img>` could be bypassed if Danbooru registered in capture phase too. The tap path is then simulated in `pointerup` so click-to-create still works.

### Performance
- `actionLog` data structure: `Array<ActionLogEntry>` → `Map<noteId, ActionLogEntry[]>`. Per-note stack means `popoverUndo` and `hardDeleteNote` are O(1) instead of an O(n) reverse-scan. Wave 3.5's drop of global Undo made the per-note shape natural.
- `updateAllNoteBoxPositions` reads the image rect once and passes it to each `renderNoteBox` call, instead of N notes each calling `getBoundingClientRect()` interleaved with N style writes (which forced N reflows under orientation change at large note counts).

### Removed
- **Single-note infrastructure**: old `boxElement`, single popover DOM, `setupCreationInteraction`, `setupDragAndResize`, `submitNote`, `hideBox`, sidebar link, `STATE_KEY` localStorage, `loadTagsFromDOM`, immediate-save on ✔. All replaced by the multi-note `notes` Map + popover-per-note rendering pipeline.
- **Global Undo (originally planned for Phase 5)**: Wave 3.5 simplified v3.0's scope to per-note ↶ only. The arc menu's third Undo slot was dropped, leaving 2 items (Confirm + Edit). Bulk discard still possible via page refresh.
- **Touch drag-to-create**: was never enabled in v3.0 (would conflict with mobile pinch/pan). Touch users tap to spawn default-size, drag handles to resize. PC drag-to-create is mouse-only.

## [2.6] - 2026-05-03

### Fixed
- `init()` re-binding bug. The `setTimeout(init, 1000)` fallback used to be a no-op even when the first `init()` ran but `#image` wasn't yet in the DOM, leaving image click/drag handlers permanently unbound. The completion flag is now set only after the image binding succeeds, so the fallback can re-attempt.
- Out-of-bounds check now also rejects boxes whose right/bottom edge exceeds the original image size — previously only top-left negative coordinates were caught, so a box dragged past the image edge could be submitted with invalid coordinates.
- Partial save failure handling. `Promise.all` results are now branched per-endpoint: note OK + tag fail, note fail + tag OK, and full failure each get distinct toasts (`⚠️ Note saved, tags failed` / `❌ Note save failed (tags updated)` / `❌ Save failed`). Previously all non-success cases collapsed into a single opaque `Error: Server returned error`.
- `touchcancel` now triggers the same cleanup path as `touchend` in box drag/resize, so an interrupted touch (incoming call, system gesture) no longer leaves global listeners attached.
- `suppressNextClick` flag now auto-releases after 500ms. Previously, if the trailing emulated click never arrived (e.g. focus shift right after drag), the flag would stay set and consume the next valid user click.

### Added
- `contenteditable` element support in `isTextInputElement` — the floating button now also auto-hides while focus is on a contenteditable region (e.g. rich-text editors), matching its behavior for `<input>` / `<textarea>`.
- Image dimension guards in `submitNote` — explicit `⚠️ Image dimensions unknown` / `⚠️ Image not visible` toasts when the original image size or rendered rect is zero, preventing `NaN` coordinates from being POSTed.

### Removed
- Two unreachable `e.target.closest('#dmna-box' | '#dmna-popover' | '#dmna-float-btn')` guards in the image `mousedown` / `click` handlers. Those elements are `<body>` siblings of `#image`, not descendants, so events on them never bubble to the image and the guards never fired.
- Unnecessary inner `const floatBtn = document.getElementById('dmna-float-btn')` shadowing the outer `floatBtn` reference inside `createUI`.

### Changed
- `parseInt(localStorage.getItem(POS_KEY), 10) || DEFAULT_BTN_MARGIN_Y` replaced with an explicit `Number.isFinite` branch. Hardens against a future change to the position clamp that could make `0` a legal saved value (currently impossible due to `Math.max(20, ...)`).

## [2.5] - 2026-04-20

### Fixed
- Tap-creates-then-cancels regression on mobile. A regression introduced in v2.3 (when PC drag support was added) caused the `mousedown` + `mouseup` + emulated `click` sequence to dual-fire: the box was created on `mouseup` and immediately toggled off by the trailing emulated `click`. Symptoms varied by browser (WebKit reproduced it; Chromium hid it). Reported by Fhtagn (Danbooru forum #405141).
- Restored v2.2's simpler responsibility split: `click` owns tap-to-create and tap-to-toggle (both touch and mouse), `mousedown`/`mouseup` handle drag-to-create only, and a new `suppressNextClick` flag consumes the emulated click that trails a successful drag.

### Added
- `DRAG_THRESHOLD_PX` constant (5px) — pointer movement above this counts as a drag, anything below is a tap. Replaces the previously-inline magic number.

### Changed
- GJS style cleanup in the touched call sites (drag/click handlers, eye-button event binding).

## [2.4] - 2026-03-23

### Changed
- Maintenance release. **No user-visible behavior change.**

### Fixed
- Initialization guard prevents the `setTimeout(init, 1000)` fallback from registering duplicate global event listeners when the first `init()` already ran.
- Null check for the floating button in `updateStateUI` (defensive — guards against the button being absent when the sidebar link triggers a state update).

### Added
- `POPOVER_WIDTH` constant — unifies the previously hard-coded popover width into a single source of truth.
- `isTextInputElement` helper — eliminates duplicated tag/type-check logic across the focus/blur auto-hide handlers.

### Removed
- Dead `GM_addStyle` branch (never reachable: `@grant none` makes it unavailable). CSS injection now uses `style.textContent` directly.
- Stray `console.log` left over from development.

### Changed (style)
- Braces on every single-statement `if`/`else` block (GJS 5.4.1 conformance).
- Multi-statement single-line blocks split into separate lines.

## [2.3] - prior to this repo

### Added
- PC drag-to-create support (click and drag on the image to draw a custom-size rectangle, in addition to the existing tap-to-create flow).

> Note: v2.3 and earlier predate this repository's commit history for `MobileNoteAssist/`. The v2.3 entry is reconstructed from the regression context documented in the v2.5 commit message.

## [2.2] - prior to this repo

The last release before PC drag support. Touch tap-to-create was the sole creation gesture; the click-to-toggle invariant was simple and unbroken. v2.5 restores this invariant on top of v2.4's structural cleanups.

[5.1.4]: https://github.com/AkaringoP/Danbooru-Mobile-Note-Assist/commits/main
[5.1.3]: https://github.com/AkaringoP/Danbooru-Mobile-Note-Assist/commits/main
[5.1.2]: https://github.com/AkaringoP/Danbooru-Mobile-Note-Assist/commits/main
[5.1.1]: https://github.com/AkaringoP/Danbooru-Mobile-Note-Assist/commits/main
[5.1.0]: https://github.com/AkaringoP/Danbooru-Mobile-Note-Assist/commits/main
[5.0.3]: https://github.com/AkaringoP/Danbooru-Mobile-Note-Assist/commits/main
[5.0.2]: https://github.com/AkaringoP/Danbooru-Mobile-Note-Assist/commits/main
[5.0.1]: https://github.com/AkaringoP/Danbooru-Mobile-Note-Assist/commits/main
[5.0.0]: https://github.com/AkaringoP/Danbooru-Mobile-Note-Assist/commits/main
[4.1.0]: https://github.com/AkaringoP/Danbooru-Mobile-Note-Assist/commits/main
[4.0.0]: https://github.com/AkaringoP/Danbooru-Mobile-Note-Assist/commits/main
[3.1.1]: https://github.com/AkaringoP/Danbooru-Mobile-Note-Assist/commits/main
[3.1.0]: https://github.com/AkaringoP/JavaScripts/commits/main/MobileNoteAssist
[3.0.1]: https://github.com/AkaringoP/JavaScripts/commits/main/MobileNoteAssist
[3.0.0]: https://github.com/AkaringoP/JavaScripts/commits/main/MobileNoteAssist
[2.6]: https://github.com/AkaringoP/JavaScripts/commits/main/MobileNoteAssist
[2.5]: https://github.com/AkaringoP/JavaScripts/commits/main/MobileNoteAssist
[2.4]: https://github.com/AkaringoP/JavaScripts/commits/main/MobileNoteAssist
[2.3]: https://github.com/AkaringoP/JavaScripts/commits/main/MobileNoteAssist
[2.2]: https://github.com/AkaringoP/JavaScripts/commits/main/MobileNoteAssist
