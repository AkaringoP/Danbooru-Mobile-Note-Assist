// Touch / gesture scenarios (Tasks 2.5, 2.6, 3.1, 3.2, 4.1).
import assert from 'node:assert/strict';
import {
  COUNT_GBCR,
  center,
  createConfirmedNote,
  enterActive,
  gotoPost,
  touchDrag,
  withPage,
} from '../lib.mjs';

async function coveringNote(order) {
  const cover = {
    id: order === 'newest' ? 10 : 1,
    x: 0,
    y: 0,
    width: 2000,
    height: 2800,
    body: 'cover',
  };
  const small = {id: 5, x: 800, y: 800, width: 300, height: 300, body: 'small'};
  // Danbooru returns notes newest first (id desc).
  const serverNotes = [cover, small].sort((a, b) => b.id - a.id);
  return withPage({serverNotes}, async ({page}) => {
    await gotoPost(page);
    await enterActive(page);
    await page.waitForFunction(
      () => document.querySelectorAll('.dmna-note-box').length === 2,
    );
    const hit = await page.evaluate(() => {
      const el = document.querySelector('.dmna-note-box[data-note-id="5"]');
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(
        r.left + r.width / 2,
        r.top + r.height / 2,
      );
      return top?.closest('.dmna-note-box')?.dataset.noteId ?? null;
    });
    assert.equal(hit, '5', `tap on the small note (cover is ${order})`);
  });
}

export default [
  {
    name: 'touchstart-passive',
    task: '3.1',
    title: 'The image touchstart listener is passive',
    run: () =>
      withPage({}, async ({page}) => {
        await gotoPost(page);
        const cdp = await page.context().newCDPSession(page);
        const {result} = await cdp.send('Runtime.evaluate', {
          expression: 'document.getElementById("image")',
        });
        const {listeners} = await cdp.send('DOMDebugger.getEventListeners', {
          objectId: result.objectId,
        });
        const ts = listeners.filter(l => l.type === 'touchstart');
        assert.equal(ts.length, 1, 'touchstart listeners on #image');
        assert.equal(ts[0].passive, true, 'touchstart passive');
      }),
  },
  {
    name: 'touchcancel',
    task: '4.1',
    title: 'A cancelled touch on the floating button does not enter drag mode',
    run: () =>
      withPage({}, async ({page}) => {
        await gotoPost(page);
        const cdp = await page.context().newCDPSession(page);
        const c = await center(page, '#dmna-float-btn');
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [{x: c.x, y: c.y}],
        });
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchCancel',
          touchPoints: [],
        });
        await page.waitForTimeout(1300);
        const r = await page.evaluate(() => ({
          dragging: document
            .getElementById('dmna-float-btn')
            .classList.contains('dragging'),
          toast:
            document.querySelector('#dmna-toast.show .dmna-toast-msg')
              ?.textContent ?? null,
        }));
        assert.equal(r.dragging, false, '.dragging after touchcancel');
        assert.equal(r.toast, null, 'toast after touchcancel');
      }),
  },
  {
    name: 'scroll-swipe',
    task: '2.5',
    title: 'A vertical swipe that starts on an unselected box scrolls the page',
    run: () =>
      withPage(
        {
          serverNotes: [
            {id: 7, x: 500, y: 900, width: 900, height: 700, body: 'theirs'},
          ],
        },
        async ({page}) => {
          await gotoPost(page);
          await enterActive(page);
          await page.waitForSelector('.dmna-note-box');
          const c = await center(page, '.dmna-note-box');
          const before = await page.evaluate(() => ({
            y: window.scrollY,
            top: document.querySelector('.dmna-note-box').style.top,
          }));
          await touchDrag(page, c, {x: 0, y: -200});
          await page.waitForTimeout(400);
          const after = await page.evaluate(() => ({
            y: window.scrollY,
            top: document.querySelector('.dmna-note-box').style.top,
            cls: document.querySelector('.dmna-note-box').className,
          }));
          assert.ok(
            after.y - before.y > 100,
            `page scrolled by ${after.y - before.y}px`,
          );
          assert.equal(after.top, before.top, 'box top unchanged');
          assert.ok(!after.cls.includes('is-dirty'), `box classes: ${after.cls}`);
        },
      ),
  },
  {
    name: 'covering-note',
    task: '2.6',
    title: 'A note covering the image does not hide smaller notes',
    run: async () => {
      await coveringNote('newest');
      await coveringNote('oldest');
    },
  },
  {
    name: 'drag-layout-reads',
    task: '3.2',
    title: 'Dragging a selected box reads the image rect a constant number of times',
    run: () =>
      withPage({page: {preScript: COUNT_GBCR}}, async ({page}) => {
        await gotoPost(page);
        await enterActive(page);
        await createConfirmedNote(page, 'drag me', {x: 200, y: 300});
        const c = await center(page, '.dmna-note-box');
        await page.touchscreen.tap(c.x, c.y);
        await page.waitForSelector('#dmna-popover.show');
        await page.locator('#dmna-popover-input').blur();
        const leftBefore = await page.evaluate(
          () => document.querySelector('.dmna-note-box').style.left,
        );
        await page.evaluate(() => {
          window.__gbcr = 0;
        });
        await touchDrag(page, c, {x: 90, y: 60}, 30);
        await page.waitForTimeout(100);
        const r = await page.evaluate(() => ({
          gbcr: window.__gbcr,
          left: document.querySelector('.dmna-note-box').style.left,
        }));
        assert.notEqual(r.left, leftBefore, 'box moved');
        assert.ok(r.gbcr <= 3, `getBoundingClientRect calls: ${r.gbcr}`);
      }),
  },
];
