# MobileNoteAssist - Claude Instructions

## Overview
A userscript that provides a mobile-friendly note creation tool for Danbooru.
Single file (`MobileNoteAssist.user.js`). `@grant none`.

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

## Key Constraints
- All touch events use `{ passive: false }` to prevent default scrolling
- Coordinates are converted from display to original image dimensions for API submission
- The script handles both `#image` container and `visualViewport` for mobile zoom
- All CSS in a single `STYLES` constant, injected via JS

## Working Principles
- **Search before reading**: Use Grep/Glob to locate targets before opening files. Avoid reading the whole `MobileNoteAssist.user.js` (large single file) when a targeted search suffices.
- **Report before changing behavior**: Always confirm before making changes that affect user-facing behavior (note-creation flow, button gestures, debug zones, API submission shape).
- **Self-verify after editing**: After any non-trivial edit, manually exercise the affected path in Tampermonkey on a real Danbooru post page. Once mechanical gates exist (post TS migration), run them immediately, not only at task end.
- **Trust the harness, not self-judgment**: Do not declare "looks good" without running the Evaluator Rubric below. Mechanical checks override intuition.
- **One task at a time**: Do not mix multiple tasks in a single session.
- **Preserve UserScript headers**: Do not arbitrarily modify the `==UserScript==` metadata block (`@version`, `@match`, `@grant`, `@require`, etc.) at the top of `MobileNoteAssist.user.js`. Version bumps and metadata changes are deliberate, not incidental.
- **Report changed files after each task**: Clearly state which files were changed and how.

## Multi-Model Workflow

**Default**: the main session runs on **Opus 4.6/4.7**. Opus orchestrates, decides, reviews, and handles small-to-medium implementation directly. **Sonnet 4.6** is invoked as a subagent (via the `Agent` tool with `model="sonnet"`) only for work that fits the delegation criteria below.

Rationale: this is a Claude Code subscription environment, not metered API. Opus tokens come out of a rate-limit quota, not per-token billing — so keeping the strongest model in the main loop costs nothing extra unless the quota is at risk. Delegation exists to **save Opus quota** and **keep main context clean**, not to save dollars.

### When Opus (main) handles it directly
- Architecture, gesture/event design, and API-shape decisions
- Debugging (hypothesis → verify → revise loop), especially touch-event and coordinate-mapping bugs
- Code review after any change
- Edits affecting fewer than ~5 logical sections of the userscript or requiring ongoing judgment
- Anything that must stay visible in main context for follow-up
- Discussions, planning, and updates to meta-docs (`CLAUDE.md`, `TASK.md`, `PLAN.md`)

### When to delegate to a Sonnet subagent
Delegate only if **all** of the following hold — otherwise just do it in Opus:
- The task is **mechanical** (bulk find/replace, applying a known pattern across many sections, dead-code removal, scaffolding from a clear spec — e.g. extracting a section into a TS module during migration)
- The specification is **unambiguous** enough that no further judgment from the main session is needed mid-task
- The work spans **≥5 files** (post-TS-migration) OR would dump **>100 lines of noisy output** into main context
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
- `main` — Release branch. Always deployable. Direct commits not allowed.
- `develop` — Integration branch for ongoing development. Default merge target.
- `feature/*` — New features or improvements. Branch off from `develop`, merge back to `develop`. **Do not merge directly to `main`.** Multiple feature branches may be merged into `develop` together.
- `hotfix/*` — Urgent bug fixes.
  - **Default**: branch off from `develop`, merge back to `develop`.
  - **Direct-to-main path** (rare): allowed only when the fix touches very few files (e.g. a single-file change) AND **explicit user approval is obtained beforehand**. Without prior approval, hotfixes go to `develop`.
- Branch naming: `feature/<short-description>` / `hotfix/<short-description>`

## Evaluator Rubric (use for self-evaluation before declaring done)

> **Status: TBD — to be populated during the TypeScript migration.**
> The project is currently a single `.user.js` with no build/lint/test infrastructure, so no mechanical gates exist yet. Once TS tooling lands (tsc, ESLint, Vitest, build), this section will be filled in with the same shape used in Danbooru-Insights:
>
> | # | Gate | Command | Enforced by |
> |---|---|---|---|
> | 1 | Type safety | `tsc --noEmit` (or `npm run build`) | TypeScript strict mode |
> | 2 | Lint/style | `npm run lint` | (TBD: GTS or project-specific) |
> | 3 | Tests pass | `npx vitest run` | Vitest |
> | 4 | Architecture invariants | (TBD if/when layered) | architecture test |
> | 5 | Build succeeds | `npm run build` | Pre-commit hook |
>
> When a gate fails, fix the root cause — do not whitelist, suppress, or work around. The whole point of mechanical gates is that LLM judgment cannot be trusted for these checks ("Never send an LLM to do a linter's job").

**Until then**, the only gate is **manual verification in Tampermonkey on a real Danbooru post page** — exercise the changed code path on mobile or with mobile-emulation devtools, including pinch-zoom and the long-press debug-zone toggle when relevant.
