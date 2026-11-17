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
        // Pan the visual viewport so the box is on screen, as a user who
        // pinched in on it would see it.
        await page.evaluate(() =>
          document
            .querySelector('.dmna-note-box.is-active')
            .scrollIntoView({block: 'center', inline: 'nearest'}),
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
          boxOnScreen: toVis(box.left) >= -1 && toVis(box.right) <= vw + 1,
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
    name: 'preview-full-note',
    task: '5.1.2',
    title: 'Preview sends the whole note, which Danbooru now validates',
    run: () =>
      withPage(
        {
          api: {
            // Mirrors notes#preview since Danbooru validates the note
            // before sanitizing: a body alone is a 422.
            'POST /notes/preview.json': (route, req) => {
              const note = JSON.parse(req.postData() || '{}').note || {};
              const missing = ['post_id', 'x', 'y', 'width', 'height'].filter(
                k => typeof note[k] !== 'number',
              );
              return missing.length
                ? route.fulfill({
                    status: 422,
                    json: {
                      success: false,
                      reasons: missing.map(k => `${k} can't be blank`),
                    },
                  })
                : route.fulfill({json: {sanitized_body: `<b>${note.body}</b>`}});
            },
          },
        },
        async ({page}) => {
          await gotoPost(page);
          await enterActive(page);
          await page.touchscreen.tap(200, 300);
          await page.waitForSelector('#dmna-popover.show');
          await page.locator('#dmna-popover-input').fill('hello');
          await page.locator('#dmna-popover-mode-toggle').tap();
          await page.waitForFunction(
            () =>
              document.getElementById('dmna-popover-preview').style.display ===
              'block',
            null,
            {timeout: 5000},
          );
          const html = await page
            .locator('#dmna-popover-preview')
            .evaluate(el => el.innerHTML);
          assert.equal(html, '<b>hello</b>');
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
            if (!r.boxOnScreen || r.cutLeft || r.cutRight || !r.arrowOnBox) {
              failures.push(`${width}px zoom ${zoom} ${side}: ${JSON.stringify(r)}`);
            }
          }
        }
      }
      assert.deepEqual(failures, [], 'cases with overflow or a stray arrow');
    },
  },
];
