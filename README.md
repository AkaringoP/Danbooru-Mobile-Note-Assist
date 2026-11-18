# Danbooru Mobile Note Assist

**Mobile Note Assist** is a UserScript that adds a touch-friendly note editor to [Danbooru](https://danbooru.donmai.us/) post pages. It lets you draw, edit, and submit translation notes on a phone with one thumb, and adds keyboard + drag-to-create on PC.

> Danbooru's built-in note tool was designed for a mouse on a wide screen, and it saves each note to the server the moment you press Save. On a phone — drawing a precise rectangle, picking tags, then waiting for the page to round-trip for every speech bubble — that flow falls apart. This script collapses translating a whole page into: enter Edit mode, drop boxes for every bubble at once, type each translation, then commit them all in a single ✓ Confirm.

---

## Install

1. Install a UserScript manager:
   - **[Tampermonkey](https://www.tampermonkey.net/)** — recommended. Works on Chrome, Edge, Firefox, and Safari (including iOS Safari).
   - **[Violentmonkey](https://violentmonkey.github.io/)** — also supported.
2. **[Click here to install the script](https://github.com/AkaringoP/Danbooru-Mobile-Note-Assist/raw/refs/heads/build/MobileNoteAssist.user.js)**.
3. Confirm the installation in your manager when prompted.
4. Open any post page (`https://danbooru.donmai.us/posts/{id}`). You should see a 📝 floating button in the bottom-right corner.

The script uses your existing Danbooru login — you need an account that can edit notes — and asks for no extra permissions. It makes no remote calls outside Danbooru itself.

> **Official source.** The install link above — the `build` branch of this repository — is the only official copy. A script with the same name hosted anywhere else is not published by this project; it runs with your Danbooru session, so don't install it. The `testbuild` branch carries work-in-progress builds that are published automatically before review; use it only if you are testing a change on purpose.

---

## Quick Start — translate one speech bubble

The fastest way to learn the workflow. Open any post you want to translate and follow along:

1. **Double-tap** the **📝** floating button. Its icon flips to **✏️** — you're now in **Edit mode**.
2. Tap directly on the speech bubble. A green box drops onto the bubble and a popover opens with the textarea focused.
3. Type your translation.
4. Tap **Commit** in the popover. The popover closes and the box stays green — committed locally, not sent to the server yet.
5. Tap the floating button **once** to open the arc menu, then tap **✓ Confirm**.
6. The Confirm popover appears with a summary of what will be sent. Toggle the appropriate translation tags (most often `Translated`).
7. Tap **Submit**. The page reloads with the note saved.

That's the full loop. The [wiki](https://github.com/AkaringoP/Danbooru-Mobile-Note-Assist/wiki) covers each piece in detail.

---

## What it does

- **Batch, then send.** Boxes you create, edit, move or delete stay on your device (green) until ✓ Confirm, which first shows a summary of what will be sent.
- **Clear send state.** The floating button glows orange with a count while changes are unsent, and turns green once they are saved.
- **Built for thumbs.** Tap to create, large invisible corner zones for moving and resizing, and controls that keep their size under pinch zoom.
- **Markup tools.** Bold, color, size, font, links and ruby from a style panel, with a server-rendered Preview and a length counter against Danbooru's 5000-character limit.
- **Safe sending.** Requests time out instead of hanging, a retry checks the server first so a note isn't created twice, and a batch stops at Danbooru's rate limit.
- **Recovery.** If the browser closes the tab, unsent work on the post is offered back the next time you open it (kept 24 hours).
- **Desktop too.** Keyboard shortcuts and drag-to-create with a mouse.

## Documentation

The user manual lives in the [wiki](https://github.com/AkaringoP/Danbooru-Mobile-Note-Assist/wiki):

| Page | What's in it |
|---|---|
| [The Interface](https://github.com/AkaringoP/Danbooru-Mobile-Note-Assist/wiki/The-Interface) | The floating button and its gestures, the arc menu, Idle vs Edit mode. |
| [Working with Notes](https://github.com/AkaringoP/Danbooru-Mobile-Note-Assist/wiki/Working-with-Notes) | Creating boxes, the note popover, the 5000-character limit, style markup, moving and resizing, box colors. |
| [Confirm and Sending](https://github.com/AkaringoP/Danbooru-Mobile-Note-Assist/wiki/Confirm-and-Sending) | The send summary, translation tags, failures, Retry, rate limits. |
| [Drafts and Recovery](https://github.com/AkaringoP/Danbooru-Mobile-Note-Assist/wiki/Drafts-and-Recovery) | What is kept if the tab is closed, and how to restore it. |
| [Desktop and Mobile Tips](https://github.com/AkaringoP/Danbooru-Mobile-Note-Assist/wiki/Desktop-and-Mobile-Tips) | Keyboard shortcuts, drag-to-create, pinch zoom, Danbooru's own note tool. |
| [Troubleshooting and FAQ](https://github.com/AkaringoP/Danbooru-Mobile-Note-Assist/wiki/Troubleshooting-and-FAQ) | What each message means; common questions. |
| [Installing and Updating](https://github.com/AkaringoP/Danbooru-Mobile-Note-Assist/wiki/Installing-and-Updating) | Updates, the `build` and `testbuild` channels, checking your version. |

---

## Storage & Privacy

The script writes three `localStorage` keys, scoped to `danbooru.donmai.us`:

| Key | Value | Purpose |
|---|---|---|
| `dmna_btn_margin_x` | integer (px) | Saved horizontal position of the floating button |
| `dmna_btn_margin_y` | integer (px) | Saved vertical position of the floating button |
| `dmna_draft_{postId}` | JSON | In-progress note draft for force-quit / OS-kill recovery (per post, 24h TTL, cleared on Confirm success or explicit idle-toggle) |

Nothing else is persisted. The script makes no remote calls beyond Danbooru's own API, sends no analytics, and does not require any GM_* APIs (`@grant none`).

---

## Compatibility

- Tested with Tampermonkey on iOS Safari, desktop Safari, and Chrome.
- Requires `visualViewport` (used for zoom-aware UI sizing). Falls back gracefully on older browsers.
- Requires `fetch`, Pointer Events, and ES2020 syntax (optional chaining, `??`).

---

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for the full version history.

The current release is **v5.1.3** (2026-11-17), a maintenance release with no change in behavior. The 5.1 series came from a mobile-focused audit: safer sending, clearer send state, a length counter, and a Preview fix after a change on Danbooru's side. The script ships from the `build` branch as a single bundled UserScript; `main` carries source only.

---

## Development

The script is authored in TypeScript across `src/` and bundled to a single `.user.js` via vite-plugin-monkey. The repository layout:

```
src/
├── main.ts            Boot wire — calls init* on every layer at module load.
├── types.ts           Domain types (NoteState, Note, NoteId, ActionLogEntry, …).
├── config.ts          Constants (sizes, timings, limits, TAG_OPTIONS, …).
├── styles.ts          The single STYLES string injected into <head> at boot.
├── version.ts         APP_VERSION, the source of the userscript @version.
├── utils/             Layer 1 — pure helpers (coords, dom, visual-viewport,
│                      style-attr, pointer-tap, popover-placement, note-body).
├── api/               Layer 2 — Danbooru API (csrf, posts, notes).
├── state/             Layer 2 — module state (image-state, notes-store, draft,
│                      native-conflict).
├── confirm/           Layer 3 — Confirm orchestration (classify, batch, reconcile).
├── ui/                Layer 3 — DOM modules (note-box, popover, style-popover,
│                      color-picker, stroke-picker, link-popover, ruby-popover,
│                      tag-popover, floating-button, arc-menu, toast,
│                      create-hint).
└── interactions/      Layer 4 — touch / pointer / keyboard / lifecycle handlers
                       (image-pointer, drag-resize, keyboard, native-block,
                       lifecycle, pending-indicator).
test/                  Vitest unit tests + architecture fitness tests.
e2e/                   Opt-in Playwright scenarios on a mock post page.
```

Z5 layer rule: imports flow `utils ← state/api ← confirm/ui ← interactions ← main` only. `confirm/` and `ui/` are siblings and must not import each other; they are wired through hook bags in `main.ts`. The layer graph is enforced by `test/architecture.test.ts`. [CLAUDE.md](./CLAUDE.md) holds the full set of invariants.

### Local commands

```bash
npm install         # install dependencies
npm run dev         # vite dev server (HMR-served userscript at vite-plugin-monkey's local URL)
npm run build       # full pipeline: vitest + tsc --noEmit + vite build → dist/MobileNoteAssist.user.js
npm run test        # vitest run (unit + architecture fitness)
npm run lint        # gts lint (eslint + prettier)
npm run fix         # gts fix (auto-format)
npm run e2e         # build, then Playwright scenarios (once: npx playwright install chromium)
```

The `dist/` directory is `.gitignore`d on `main`; release artifacts live on the `build` branch.

### Branching strategy

- `main` — source only (this branch). Direct commits not allowed; merges from `develop` only at release time.
- `develop` — integration. Default merge target for feature work.
- `feature/*`, `hotfix/*` — local-only working branches.
- `build` — orphan-style branch carrying just the bundled `MobileNoteAssist.user.js` (the `@updateURL` / `@downloadURL` target). CI publishes it on every push to `main`.
- `testbuild` — the same, built from `develop` and working branches as "(dev)".

### Testing

- **Unit and architecture tests** (`npm run test`, Vitest + happy-dom). The architecture tests verify the layer direction, hook-bag completeness at boot, and that type-only re-exports stay type-only.
- **End-to-end scenarios** (`npm run e2e`, Playwright, opt-in and not part of CI). They load the built userscript into a mock post page with phone emulation and cover what happy-dom can't: real touch input, page lifecycle events, layout under pinch zoom. See [e2e/README.md](./e2e/README.md).
- **Manual check.** For UI, touch and coordinate changes, trying the change in a userscript manager on a real Danbooru post page is still the floor.

---

## License

MIT. See the repository [LICENSE](https://github.com/AkaringoP/Danbooru-Mobile-Note-Assist/blob/main/LICENSE) for details.
