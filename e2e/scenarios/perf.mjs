// Performance scenarios (Task 3.5).
import assert from 'node:assert/strict';
import {COUNT_GBCR, enterActive, gotoPost, withPage} from '../lib.mjs';

export default [
  {
    name: 'many-notes',
    task: '3.5',
    title: 'Entering edit mode on a 1000-note post reads layout a constant number of times',
    run: () => {
      const n = 1000;
      const serverNotes = Array.from({length: n}, (_, i) => ({
        id: 1000 + i,
        x: (i % 40) * 48,
        y: Math.floor(i / 40) * 90,
        width: 40,
        height: 60,
        body: 'n' + i,
      }));
      return withPage({serverNotes, page: {preScript: COUNT_GBCR}}, async ({page}) => {
        await gotoPost(page);
        await page.evaluate(() => {
          window.__gbcr = 0;
        });
        await enterActive(page);
        await page.waitForFunction(
          k => document.querySelectorAll('.dmna-note-box').length === k,
          n,
          {timeout: 60000},
        );
        const gbcr = await page.evaluate(() => window.__gbcr);
        assert.ok(gbcr <= 3, `getBoundingClientRect calls: ${gbcr}`);
      });
    },
  },
];
