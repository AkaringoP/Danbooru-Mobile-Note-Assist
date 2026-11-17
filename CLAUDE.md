# MobileNoteAssist - Claude Instructions

## Overview
A userscript that provides a mobile-friendly note creation tool for Danbooru. TypeScript source under `src/`, bundled to a single `MobileNoteAssist.user.js` via vite-plugin-monkey. `@grant none`.

## How It Works
Adds a floating button to post pages. When enabled, users can tap/drag on the image to create note boxes, then submit notes via the Danbooru API. Includes translation tag management.

## Key Features
- Floating toggle button with drag-to-reposition (stored in localStorage)
- Tap to create default-sized note box, or drag to draw custom size
- Note box drag/resize with boundary constraints (stays within image)
- Translation tag toggles (translated, translation_request, check_translation, partially_translated)
- Visual Viewport API support for pinch-zoom scenarios
- Long-press button to toggle debug zones
- CSRF token handling for Danbooru API submissions
- **Force-quit / OS-kill recovery (v4.1+)** — in-progress notes snapshotted to `localStorage` on lifecycle events (`beforeunload` / `pagehide` / `visibilitychange→hidden`) and restored via two-button toast prompt on next entry to the same post. 24h TTL, per-post key, cleared on Confirm success or explicit idle-toggle
- **Markup-aware popover (v5.0+)** — style sub-popover with B/I/U/S/sub/sup/tn/code/`<a>`/ruby tag buttons, color/stroke/background pickers (Material swatches + HEX), Size/Font dropdowns, Preview mode (sanitizer round-trip via `/notes/preview.json`), History button (server version log), per-style undo via `'text'` ActionLogEntry + `TextSnapshot`
- **Danbooru native conflict guard (v5.0+)** — auto-hide floating button + gate `setMode('active')` while `body.mode-translation` or `.ui-dialog.note-edit-dialog` is up. Reverse direction blocks bare-N keydown / `#translate` clicks while our active mode is on (`interactions/native-block`)
- **Unsent-changes indicator (v5.1+)** — orange glow with a rippled, slowly turning edge (`::before` + SVG mask, transform-only animation) + count badge on the floating button and the same on the Confirm item while anything is pending, turning green (`body.dmna-send-success`) once a Confirm sent everything, until the reload (`interactions/pending-indicator`, count = what `classifyChanges` would send); popover action row uses native-style text buttons (Commit / Cancel / Delete / History) in Danbooru's `--form-button-*` colors
- **Send safety (v5.1+)** — Confirm always shows a send summary (`New · Edited · Moved · Deleted`) before anything goes out; every request has a 20 s deadline; a failed POST is checked against the server's live notes before Retry re-sends it; the draft keeps being saved until the first request leaves

## Architecture (Layer Structure)

Z5 layer rule — imports flow strictly downward and never sideways across layer-3 siblings:

```
main.ts                  Layer 5 — boot wire (init* calls)
   ↓
interactions/            Layer 4 — touch / pointer / keyboard handlers
   ↓
ui/    confirm/          Layer 3 — DOM modules / Confirm orchestration
                         (siblings — must NOT import each other)
   ↓
state/    api/           Layer 2 — module-level state / Danbooru API
   ↓
utils/                   Layer 1 — pure helpers (coords, dom,
                                                visual-viewport, style-attr,
                                                pointer-tap, popover-placement)

types.ts, config.ts, styles.ts, version.ts — Layer 0 (universal,
                                              importable from anywhere)
```

Layer 3 ui/ modules (v5.0): `note-box`, `popover`, `style-popover`, `color-picker`, `stroke-picker`, `link-popover`, `ruby-popover`, `tag-popover`, `floating-button`, `arc-menu`, `toast`. Layer 3 confirm/ modules: `classify`, `batch`, `reconcile`. Layer 2 state/ modules: `notes-store`, `image-state`, `draft`, `native-conflict`. Layer 4 interactions/ modules: `image-pointer`, `drag-resize`, `keyboard`, `native-block`, `lifecycle`, `pending-indicator`.

The cross-layer wires that the legacy IIFE expressed via shared closure are now hook bags injected by `main.ts` at boot:
- `NotesStoreHooks` (10 callbacks) — most state→ui side effects + `hasPendingChanges` reverse-pull from `confirm/classify` + `onTextUndo` for the `'text'` action-log restore + `onNotesAdded` for batch renders
- `ConfirmFlowHooks` (6 callbacks) — confirm→ui send-flow lifecycle + Confirm popover entry (`showTagPopover(summary, withTags)`)
- `NoteBoxHooks` (4 callbacks) — `ui/note-box` → `interactions/drag-resize` listener attach + box-click suppression + `onVisualsUpdated` (→ pending indicator)
- `ArcMenuHooks` (1 callback, `onConfirm`) — `ui/arc-menu` → `confirm/batch.runConfirmFlow` (replaces the prior direct sibling import; Phase 5-h Task 5.19)

The architecture invariants are mechanically enforced by `test/architecture.test.ts` (Z5 layer direction in both directions including the `ui/ → confirm/` sibling restriction, hook-bag completeness at boot, `STYLES` injection site, type-only re-export integrity).

## Build & Dev

```bash
npm install                # gts, vite, vitest, vite-plugin-monkey, happy-dom
npm run dev                # vite dev server (HMR userscript)
npm run build              # vitest + tsc --noEmit + vite build → dist/MobileNoteAssist.user.js
npm run test               # vitest run (unit + architecture fitness)
npm run lint               # gts lint (eslint + prettier)
npm run fix                # gts fix (auto-format)
npx tsc --noEmit           # type-check only (no emit)
npm run e2e                # build, then Playwright scenarios on a mock post page (opt-in, not in CI)
node e2e/run.mjs 1.4       # after a build: run scenarios by task or name
```

`e2e/` needs Chromium once per machine (`npx playwright install chromium`). Each scenario names the TASK it guards; see `e2e/README.md`.

`dist/` is `.gitignore`d on `main`. Release artifacts live on the orphan-style `build` branch (the `@updateURL` / `@downloadURL` target).

## Code Style

- **GTS** (Google TypeScript Style) — single quotes, 2-space indent, trailing commas, arrow functions OK. `gts fix` auto-formats; `gts lint` is the enforcer.
- **TypeScript strict** — `strict: true`, `noImplicitAny: true`, `noImplicitReturns: true`, `noUnusedLocals: true`, `noUnusedParameters: true`. No `any`. Use `unknown` + narrowing instead.
- **Branded types** — `NoteId` is `ServerNoteId | TempNoteId` (phantom-typed); construct via `asServerNoteId` / `asTempNoteId` factories at trust boundaries (server response, `genNoteId`). Plain `string` will not satisfy a `NoteId` parameter.
- **No comments unless the WHY is non-obvious** — well-named identifiers and types do the explaining. Reserve comments for invariants, hidden constraints, surprising behaviors, or workarounds for specific bugs.

## Working Principles
- **Search before reading**: Use Grep/Glob to locate targets before opening files. The codebase is partitioned across 20+ small modules under `src/` — targeted search beats reading the layer's entry file end-to-end.
- **Report before changing behavior**: Always confirm before making changes that affect user-facing behavior (note-creation flow, button gestures, debug zones, API submission shape).
- **Self-verify after editing**: After any non-trivial edit, run the Evaluator Rubric gates immediately, not only at task end. For UI / touch / coordinate work the mechanical gates are necessary but not sufficient — manual exercise in Tampermonkey on a real Danbooru post page is the floor.
- **Trust the harness, not self-judgment**: Do not declare "looks good" without running the Evaluator Rubric. Mechanical checks override intuition.
- **One task at a time**: Do not mix multiple tasks in a single session.
- **Preserve UserScript headers**: The `==UserScript==` block is generated by vite-plugin-monkey from `vite.config.ts` (`build.userscript.{name,namespace,match,grant,version,…}`) and `src/version.ts`. Edit the config, not the generated dist. Version bumps and metadata changes are deliberate, not incidental.
- **Report changed files after each task**: Clearly state which files were changed and how.

## Multi-Model Workflow

**Default**: the main session runs on **Opus 4.6/4.7**. Opus orchestrates, decides, reviews, and handles small-to-medium implementation directly. **Sonnet 4.6** is invoked as a subagent (via the `Agent` tool with `model="sonnet"`) only for work that fits the delegation criteria below.

Rationale: this is a Claude Code subscription environment, not metered API. Opus tokens come out of a rate-limit quota, not per-token billing — so keeping the strongest model in the main loop costs nothing extra unless the quota is at risk. Delegation exists to **save Opus quota** and **keep main context clean**, not to save dollars.

### When Opus (main) handles it directly
- Architecture, gesture/event design, and API-shape decisions
- Debugging (hypothesis → verify → revise loop), especially touch-event and coordinate-mapping bugs
- Code review after any change
- Edits affecting fewer than ~5 logical modules or requiring ongoing judgment
- Anything that must stay visible in main context for follow-up
- Discussions, planning, and updates to meta-docs (`CLAUDE.md`, `TASK.md`, `PLAN.md`)

### When to delegate to a Sonnet subagent
Delegate only if **all** of the following hold — otherwise just do it in Opus:
- The task is **mechanical** (bulk find/replace, applying a known pattern across many modules, dead-code removal, scaffolding from a clear spec — e.g. authoring a unit-test file with a fixed shape)
- The specification is **unambiguous** enough that no further judgment from the main session is needed mid-task
- The work spans **≥5 files** OR would dump **>100 lines of noisy output** into main context
- The result is a **diff or summary** that Opus can review in one pass

When delegating, write a **self-contained prompt**: the subagent does not see this conversation. Include the decision/spec, target files or patterns, constraints, and what to report back.

### Process per task
1. Opus reads the task entry and decides **direct** vs **delegate** using the criteria above.
2. **Direct path**: Opus implements → self-runs the relevant Evaluator Rubric gates → reports changed files.
3. **Delegate path**: Opus drafts a self-contained prompt → calls `Agent(model="sonnet", ...)` → reviews the returned diff → runs Evaluator Rubric gates → reports changed files.
4. Move to next task once review passes.

### Rate-limit fallback
If the Opus quota is at risk of exhaustion mid-session, switch the main session to Sonnet via `/model sonnet` and continue under the inverted pattern (Sonnet main, no delegation). Treat this as a recovery mode, not the default.

### Task-document rule
Whenever `TASK.md`, `PLAN.md`, or any task-list document is authored or updated, **every task entry MUST mark its execution path** as one of:
- `Direct (Opus)` — Opus main session implements directly
- `Delegate (Sonnet)` — Opus dispatches to a Sonnet subagent, then reviews

Record the rationale briefly when the choice is non-obvious. This keeps the pipeline reproducible across sessions.

## Git Branching Strategy
- `main` — Release branch. Source-only (no `dist/`). Always deployable. Direct commits not allowed.
- `develop` — Integration branch for ongoing development. Default merge target.
- `feature/*` — New features or improvements. Branch off from `develop`, merge back to `develop`. **Do not merge directly to `main`.** Multiple feature branches may be merged into `develop` together.
- `hotfix/*` — Urgent bug fixes.
  - **Default**: branch off from `develop`, merge back to `develop`.
  - **Direct-to-main path** (rare): allowed only when the fix touches very few files (e.g. a single-file change) AND **explicit user approval is obtained beforehand**. Without prior approval, hotfixes go to `develop`.
- `build` — Orphan-style branch carrying just the bundled `MobileNoteAssist.user.js`. Re-published from `dist/` at every release. The `@updateURL` / `@downloadURL` target.
- Branch naming: `feature/<short-description>` / `hotfix/<short-description>`

### Remote push policy
- **Only `develop`, `main`, and `build` are pushed to `origin`.** `feature/*` and `hotfix/*` branches stay local — intermediate commits remain local-only, and changes reach `origin` only via merges into `develop` (or `main` for releases) and the corresponding `build` re-publish.
- Do not push feature/hotfix branches "for backup" or "for multi-device sync". If multi-device continuity of in-progress feature work is genuinely required, surface the constraint and ask before deviating.
- PR-based remote review is not part of this workflow — review happens at merge time on the local machine.

## Evaluator Rubric (use for self-evaluation before declaring done)

| # | Gate | Command | Enforced by |
|---|---|---|---|
| 1 | Type safety | `npx tsc --noEmit` | TypeScript strict mode (`tsconfig.json`) |
| 2 | Lint/style | `npm run lint` | GTS (eslint + prettier) |
| 3 | Tests pass | `npm run test` | Vitest |
| 4 | Architecture invariants | (covered by #3 — `test/architecture.test.ts`) | Z5 layer direction, hook bag completeness, boot sequence, type-only re-export |
| 5 | Build succeeds | `npm run build` | vitest + tsc + vite build chain |

When a gate fails, fix the root cause — do not whitelist, suppress, or work around. The whole point of mechanical gates is that LLM judgment cannot be trusted for these checks ("Never send an LLM to do a linter's job").

For lifecycle, touch, popover-placement or Confirm-flow changes also run `npm run e2e` (opt-in gate): browser event order and real pointer/touch input are what happy-dom can't reproduce.

**Mechanical gates are necessary but not sufficient for UI / touch / coordinate work.** Manual verification in Tampermonkey on a real Danbooru post page — exercising the changed code path on mobile or with mobile-emulation devtools, including pinch-zoom and the long-press debug-zone toggle when relevant — is still the floor for those areas.

## Critical Rules

- **`@grant none`**: do not introduce GM_* APIs. Anything stored across reloads goes through plain `localStorage` scoped to `danbooru.donmai.us`.
- **UserScript header is generated, not authored**: the `==UserScript==` block at the top of `dist/MobileNoteAssist.user.js` comes from `vite.config.ts`'s `vite-plugin-monkey` config + `src/version.ts`. Editing the dist directly is wasted work — vite regenerates the header on every build. To change `@version`, `@match`, `@grant`, `@require`, etc., change the config.
- **`@updateURL` / `@downloadURL` target the `build` branch**, not `main`. The current install URL is `https://github.com/AkaringoP/Danbooru-Mobile-Note-Assist/raw/refs/heads/build/MobileNoteAssist.user.js`. `main` carries source only — no root userscript file lives here. v3.1.1 installs that pointed at the legacy `main/MobileNoteAssist.user.js` URL are **not auto-migrated**; users need to reinstall once from the build-branch URL above (Q6 = (d), Phase 4).
- **All CSS lives in `src/styles.ts`** as a single `STYLES` template string injected at boot from `main.ts`. CSS files (`.css`) are not loaded by the userscript runtime; do not introduce them.
- **Touch events use `{passive: false}`** — the userscript intentionally cancels default scrolling/pinch in specific paths (image-pointer create/drag, drag-resize). Preserve this when modifying any touch handler. A touch handler that never calls `preventDefault` must be registered `passive: true` (e.g. the `#image` touchstart blocker, v5.1) so it doesn't hold up scrolling.
- **Touch drags only the selected box (v5.1)**: `attachBodyDragListener` ignores a non-mouse pointerdown on an unselected box, and only `.dmna-note-box.is-active` (plus the handles) has `touch-action: none`; every other box is `manipulation`. A swipe starting on someone's note must scroll the page, not move the note. Only the mouse keeps activate-and-drag. A `pointercancel` mid-drag restores the start geometry instead of committing.
- **Coordinate space**: `NoteState` (`x/y/w/h`) is **always** in original-image pixel space. Display-space numbers go through `imageToScreenRect` / `screenToImageRect` (`utils/coords.ts`). Do not store display-space values in `Note.current` / `initialState` / `confirmedState`.
- **Branded `NoteId`**: never cast a plain `string` to `NoteId`. Use `asTempNoteId` / `asServerNoteId` at the trust boundary, then forward the typed value. `pushAction` is overloaded so the `'create'` arm requires `prevState: null` and the geometry-bearing arms require non-null `NoteState` — don't reintroduce the v4.x `as ActionLogEntry` cast.
- **Confirm pipeline locks (v5.1)**: three flags in `confirm/batch.ts`. `isSending` is the narrow UI lock around `sendBatch`'s try/finally (HTTP requests + `dmna-sending` body class). `isInConfirmPipeline` is the re-entrancy guard spanning `runConfirmFlow`'s full try/finally. `draftSaveBlocked` turns on just before the first request (where `clearDraft()` now runs) and stays on through `applyServerStateToLocal`, the error-modal wait and retry recursion. `interactions/lifecycle#saveDraftIfNeeded` gates on `getIsSending() || getIsDraftSaveBlocked()` — **not** on the pipeline guard: while the Confirm popover waits nothing has been sent, so the draft must keep being saved.
- **Draft discard on Leave (v5.1)**: Chromium fires `visibilitychange(hidden)` *after* `pagehide`. Once `pagehide` honors a "Leave" answer (`discardedOnLeave`), the trailing visibilitychange must not save; only a bfcache `pageshow` (`persisted`) re-arms saving. The next pointerdown/keydown after the prompt means "Stay".
- **Batch renders (v5.1)**: code that adds many notes at once (edit-mode entry, draft restore) inserts them without rendering and fires `NotesStoreHooks.onNotesAdded` once; `main.ts` renders them through `updateAllNoteBoxPositions` (one image-rect read). Never render per note inside such a loop — 1000 notes took 9 s of layout that way. Gestures likewise read the image rect once (`DragState.imageRect`) and pass it to `renderNoteBox` / `updatePopoverPosition`. `fetchServerNotes` pages past 1000 notes (`page=b<lowest id>`).
- **Requests (v5.1)**: never call `fetch` directly — mutating calls go through `api/csrf.apiCall`, GETs through `getJson`. Both enforce `REQUEST_TIMEOUT_MS` (response + body read) and reject with `ApiError {kind: 'http' | 'network' | 'timeout', status}`.
- **Tag updates merge (v5.1)**: `apiPatchPostTags` sends `post[old_tag_string]` (the tag string the Confirm popover showed, carried as `TagDelta.baseTagString`) with the edited string, like Danbooru's own edit form — never re-fetch and overwrite.
- **Drafts are swept (v5.1)**: `sweepExpiredDrafts` removes expired / invalid `dmna_draft_*` entries for every post once per boot (idle callback).
- **POST is not idempotent (v5.1)**: a POST that failed without a refusal (network, timeout, 5xx — not 4xx) may have been stored. `handleSendResult` matches such failures against the live notes (`confirm/reconcile.matchCommittedPosts`) and adopts matches; the rest add their *sent* state to `Note.uncertainPosts` (persisted in drafts, never cleared until the note is adopted or posted). Every send — Confirm and Retry — goes through `sendChecked`: it looks those sent states up (clean local server notes count as candidates, since a draft restore loads the stored copy), adopts matches with later edits kept as a PUT, re-classifies, and holds POSTs back under the send lock if the server can't be asked. Never call `sendBatch` directly from a flow. PUT/DELETE/tag PATCH are safe to repeat.
- **New boxes never linger un-committed (v5.1)**: `setActiveNote(other)` settles a fresh new box first (typed text → ✔ checkpoint, blank → removed). Paths that clear the selection already route fresh boxes. Confirm silently drops never-✔'d temps, so none may survive without its popover.
- **`'text'` action log + `clearTextActionsForNote`**: style-popover mutate helpers push a `TextSnapshot` (`{text, selectionStart, selectionEnd}`) before rewriting the textarea. The `popoverCancel` and `dismissActivePopover` revert paths MUST call `clearTextActionsForNote(noteId)` after rolling `current` back to `confirmedState` — otherwise a later popover ↶ resurrects markup the user just canceled (Phase 5-h Task 5.22).
- **IME composition guard**: any keyboard handler routing Enter/Esc to a destructive action (Confirm, dismiss) must gate on `!e.isComposing` (with the Safari `keyCode === 229` fallback). Applies to popover textarea Ctrl/Cmd+Enter, global Esc dismissal, and the 4 picker modals' Enter-to-confirm. Half-typed Hangul/Kana/Pinyin must not commit (Phase 5-h Task 5.23).
- **Sub-modal outside-tap pattern**: color/stroke/link/ruby pickers all share a `suppressNextClick` flag paired with a 500 ms `setTimeout` reset. Without the TTL the flag can latch indefinitely if no matching click arrives, silently eating the next unrelated tap. Mirrors `drag-resize`'s suppression pattern (Phase 5-h Task 5.27).
- **Style popover auto-hide gate**: `refreshStylePopoverState`'s "no selection → hide" branch must skip while any sub-modal is up (`isColorPickerShown() || isStrokePickerShown() || isLinkPopoverShown() || isRubyPopoverShown()`). Sub-modal focus steals the textarea selection, which fires `selectionchange` with no live selection — the prior auto-hide raced the picker's close path (Phase 5-h Task 5.31).
- **Preview innerHTML sink**: `apiPreviewNote` validates `sanitized_body` is a string before returning, AND the `popover.ts` sink re-validates before assigning to `innerHTML`. This is the only `innerHTML` write in the codebase; double gate is intentional defense in depth. Third layer (v5.1): `#dmna-popover-preview` is `position: relative; isolation: isolate; contain: paint` and its links are `pointer-events: none` — NoteSanitizer allows `position`/`inset`/`z-index`, so without containment a previewed note could cover the popover's buttons.
- **Server data is untrusted input (v5.1)**: note bodies and geometry come from other users. Draft note ids are validated (`^(\d+|temp-[A-Za-z0-9-]+)$`, `isServerNote` ⇔ numeric) and `apiPutNote`/`apiDeleteNote` refuse a non-numeric id, because ids land in request paths. Regexes that run on note text must stay linear (see `detectOuterLayers`).
- **Text fields are ≥ 16px (v5.1)**: iOS Safari zooms the page when a focused `input` / `textarea` / `select` is under 16px. Keep every field the script focuses at 16px or more (guarded by `test/styles.test.ts`); keep popover sizes by pinning heights, not by shrinking the font or scaling the field.
- **Note length counts like the server (v5.1)**: `utils/note-body.serverNoteBodyLength` mirrors Danbooru's body normalization (NFC, zero-width strip, CRLF line breaks, strip) and counts code points; `NOTE_BODY_MAX_LENGTH` is 5000. Don't use `value.length`. Past the limit the counter is red, Commit is off (button and Ctrl/Cmd+Enter) and `setActiveNote` refuses to switch to another note (it would auto-commit a fresh box or leave the text for Confirm, which sends `current`) — the server rejects such a note whole, it does not truncate. Cancel, Delete, outside tap and Esc stay available: they revert to a committed (≤ limit) state or remove the box. Callers that start a gesture after `setActiveNote(other)` must check the switch happened.
- **Popover placement is in visual px (v5.1)**: the note popover is counter-scaled, so its on-screen width is constant; clamp it against `visualViewport.width × scale`, never `visualViewport.width` alone. `utils/popover-placement.computePopoverPlacement` is the single source for the note and style popovers.
- **Don't make abuse easier than the native UI**: no feature that makes destructive work cheaper than Danbooru's own note editor (bulk delete, multi-post automation, sending without a user action). Send requests sequentially and stop the batch at the first 429 (`sendBatch` marks the rest `Skipped — rate limited`); always show the send summary before Confirm sends. Client-side caps are not a control (they are bypassed by editing the script) — the server's rate limits and note history are.
- **Defense-in-depth user input escape**: `link-popover.normalizeUrl` rejects `javascript:` / `data:` / `vbscript:` / `file:` schemes and strips `<>"`; `style-popover.applyRubyWrap` strips `<>"` from the reading. Danbooru's `NoteSanitizer` is the authoritative backstop, but the client filter ensures the request payload is always well-formed.
