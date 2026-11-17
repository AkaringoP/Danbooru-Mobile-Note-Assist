// e2e runner: `node e2e/run.mjs [name-or-task ...]`.
// Runs against dist/MobileNoteAssist.user.js (or $DMNA_DIST); build first.
import {closeBrowser} from './lib.mjs';
import confirm from './scenarios/confirm.mjs';
import draft from './scenarios/draft.mjs';
import perf from './scenarios/perf.mjs';
import popover from './scenarios/popover.mjs';
import touch from './scenarios/touch.mjs';

const ALL = [...draft, ...confirm, ...popover, ...touch, ...perf].sort(
  (a, b) => a.task.localeCompare(b.task, undefined, {numeric: true}),
);
const filters = process.argv.slice(2);
const selected = filters.length
  ? ALL.filter(s => filters.some(f => f === s.name || f === s.task))
  : ALL;
if (selected.length === 0) {
  console.error(`No scenario matches: ${filters.join(' ')}`);
  console.error(`Known: ${ALL.map(s => `${s.name} (${s.task})`).join(', ')}`);
  process.exit(2);
}

const TIMEOUT_MS = 180_000;
let failed = 0;
for (const s of selected) {
  const started = Date.now();
  try {
    await Promise.race([
      s.run(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('scenario timed out')), TIMEOUT_MS),
      ),
    ]);
    console.log(`PASS  ${s.task.padEnd(4)} ${s.name}  (${Date.now() - started} ms)`);
  } catch (err) {
    failed++;
    const msg = String(err && err.message ? err.message : err)
      .split('\n')
      .slice(0, 40)
      .join('\n      ');
    console.log(`FAIL  ${s.task.padEnd(4)} ${s.name}: ${s.title}\n      ${msg}`);
  }
}
await closeBrowser();
console.log(`\n${selected.length - failed}/${selected.length} passed`);
process.exit(failed ? 1 : 0);
