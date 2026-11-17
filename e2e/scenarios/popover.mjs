// Popover scenarios (Tasks 2.1, 4.6).
import assert from 'node:assert/strict';
import {center, enterActive, gotoPost, withPage} from '../lib.mjs';

const HOSTILE =
  '<a href="https://example.com/" style="position:absolute;inset:-200px;z-index:9999">x</a>';

async function overflowCase(width, zoom, side) {
  return withPage(
    {contextOptions: {viewport: {width, height: 800}}},
    async ({page}) => {
      await gotoPost(page);
      await enterActive(page);
      await page.touchscreen.tap(side === 'left' ? 8 : width - 8, 300);
      await page.waitForSelector('#dmna-popover.show');
      await page.locator('#dmna-popover-input').blur();
      if (zoom !== 1) {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Emulation.setPageScaleFactor', {pageScaleFactor: zoom});
        await page.evaluate(
          s => window.scrollTo(s === 'left' ? 0 : 99999, window.scrollY),
          side,
        );
        await page.waitForTimeout(300);
      }
      await page.waitForTimeout(200);
      return page.evaluate(() => {
        const vv = window.visualViewport;
        const toVis = x => (x - vv.offsetLeft) * vv.scale;
        const pop = document.getElementById('dmna-popover').getBoundingClientRect();
        const arrow = document
          .getElementById('dmna-popover-arrow')
          .getBoundingClientRect();
        const box = document
          .querySelector('.dmna-note-box.is-active')
          .getBoundingClientRect();
        const vw = vv.width * vv.scale;
        const arrowX = toVis(arrow.left + arrow.width / 2);
        return {
          cutLeft: Math.max(0, Math.round(-toVis(pop.left))),
          cutRight: Math.max(0, Math.round(toVis(pop.right) - vw)),
          arrowOnBox:
            arrowX >= toVis(box.left) - 1 && arrowX <= toVis(box.right) + 1,
        };
      });
    },
  );
}

export default [
  {
    name: 'preview-overlay',
    task: '2.1',
    title: 'Positioned markup in a preview cannot cover the popover controls',
    run: () =>
      withPage(
        {
          serverNotes: [
            {id: 77, x: 300, y: 300, width: 300, height: 300, body: HOSTILE},
          ],
          api: {
            'POST /notes/preview.json': route =>
              route.fulfill({json: {sanitized_body: HOSTILE}}),
          },
        },
        async ({page}) => {
          await gotoPost(page);
          await enterActive(page);
          await page.waitForSelector('.dmna-note-box');
          const b = await center(page, '.dmna-note-box');
          await page.touchscreen.tap(b.x, b.y);
          await page.waitForSelector('#dmna-popover.show');
          await page.locator('#dmna-popover-mode-toggle').tap();
          await page.waitForFunction(
            () =>
              document.getElementById('dmna-popover-preview').style.display ===
              'block',
          );
          for (const sel of [
            '.dmna-popover-btn[data-action="confirm"]',
            '.dmna-popover-btn[data-action="cancel"]',
            '.dmna-popover-btn[data-action="delete"]',
            '#dmna-popover-mode-toggle',
          ]) {
            const c = await center(page, sel);
            const own = await page.evaluate(
              ({x, y, sel}) =>
                document.elementFromPoint(x, y) === document.querySelector(sel),
              {...c, sel},
            );
            assert.equal(own, true, `top element at ${sel}`);
          }
        },
      ),
  },
  {
    name: 'popover-overflow',
    task: '4.6',
    title: 'The note popover stays on screen and its arrow points at the box',
    run: async () => {
      const failures = [];
      for (const width of [360, 384, 393, 412]) {
        for (const zoom of [1, 1.5]) {
          for (const side of ['left', 'right']) {
            const r = await overflowCase(width, zoom, side);
            if (r.cutLeft || r.cutRight || !r.arrowOnBox) {
              failures.push(`${width}px zoom ${zoom} ${side}: ${JSON.stringify(r)}`);
            }
          }
        }
      }
      assert.deepEqual(failures, [], 'cases with overflow or a stray arrow');
    },
  },
];
