# e2e (opt-in)

Playwright scenarios that load the built userscript into a mock Danbooru post
page (Pixel 7 emulation, every request intercepted — nothing reaches the
network). Not part of `npm run build` or CI.

```bash
npx playwright install chromium   # once per machine
npm run e2e                       # build, then run every scenario
node e2e/run.mjs 1.4 leave-discard  # after a build: filter by task or name
```

`DMNA_DIST=<path>` runs the scenarios against another bundle. Each scenario
lists the TASK it guards; the runner exits 1 if any scenario fails.
