// Confirm pipeline scenarios (Tasks 1.3, 1.4, 1.6).
import assert from 'node:assert/strict';
import {
  center,
  createConfirmedNote,
  enterActive,
  gotoPost,
  submitConfirmPopover,
  tapArcConfirm,
  withPage,
} from '../lib.mjs';

const posts = log =>
  log.filter(l => l.method === 'POST' && l.path === '/notes.json');

export default [
  {
    name: 'hanging-request',
    task: '1.3',
    title: 'A request that never answers times out into the error modal',
    run: () =>
      withPage(
        {api: {'POST /notes.json': async () => {/* never respond */}}},
        async ({page}) => {
          await page.clock.install();
          await gotoPost(page);
          await enterActive(page);
          await createConfirmedNote(page, 'hang');
          await tapArcConfirm(page);
          await submitConfirmPopover(page);
          await page.waitForFunction(() =>
            document.body.classList.contains('dmna-sending'),
          );
          await page.clock.fastForward('00:25');
          const modal = await page
            .waitForSelector('#dmna-error-modal.show', {timeout: 3000})
            .then(() => true)
            .catch(() => false);
          assert.equal(modal, true, 'error modal after the timeout');
          const locked = await page.evaluate(() =>
            document.body.classList.contains('dmna-sending'),
          );
          assert.equal(locked, false, 'body.dmna-sending after the timeout');
        },
      ),
  },
  {
    name: 'lost-response',
    task: '1.4',
    title: 'A POST stored server-side but whose response was lost is not resent',
    run: () => {
      let count = 0;
      const stored = [];
      return withPage(
        {
          api: {
            'GET /notes.json': route => route.fulfill({json: stored}),
            'POST /notes.json': async (route, req) => {
              count++;
              const n = JSON.parse(req.postData()).note;
              const saved = {
                id: 9000 + count,
                x: n.x,
                y: n.y,
                width: n.width,
                height: n.height,
                body: n.body,
              };
              stored.push(saved);
              if (count === 1) {
                return route.abort('connectionreset');
              }
              return route.fulfill({status: 201, json: saved});
            },
          },
        },
        async ({page, log}) => {
          await gotoPost(page);
          await enterActive(page);
          await createConfirmedNote(page, 'dup?');
          await tapArcConfirm(page);
          await submitConfirmPopover(page);
          const modal = await page
            .waitForSelector('#dmna-error-modal.show', {timeout: 2500})
            .then(() => true)
            .catch(() => false);
          assert.equal(modal, false, 'error modal for a POST the server has');
          assert.equal(posts(log).length, 1, 'POST requests for one note');
        },
      );
    },
  },
  {
    name: 'unverified-cancel',
    task: '1.4',
    title: 'Cancel, then Confirm again: an unverified POST is not re-sent',
    run: () => {
      let count = 0;
      const stored = [];
      let getOk = true;
      return withPage(
        {
          api: {
            'GET /notes.json': route =>
              getOk
                ? route.fulfill({json: stored})
                : route.abort('connectionreset'),
            'POST /notes.json': async (route, req) => {
              count++;
              const n = JSON.parse(req.postData()).note;
              const saved = {
                id: 9000 + count,
                x: n.x,
                y: n.y,
                width: n.width,
                height: n.height,
                body: n.body,
              };
              stored.push(saved);
              if (count === 1) {
                return route.abort('connectionreset');
              }
              return route.fulfill({status: 201, json: saved});
            },
          },
        },
        async ({page, log}) => {
          await gotoPost(page);
          await enterActive(page);
          await createConfirmedNote(page, 'dup?');
          getOk = false;
          await tapArcConfirm(page);
          await submitConfirmPopover(page);
          await page.waitForSelector('#dmna-error-modal.show', {timeout: 4000});
          await page.locator('.dmna-error-modal-btn[data-action="cancel"]').tap();
          await page.waitForTimeout(300);
          getOk = true;
          await tapArcConfirm(page);
          await submitConfirmPopover(page);
          await page.waitForTimeout(1500);
          assert.equal(posts(log).length, 1, 'POST requests for one note');
          assert.equal(stored.length, 1, 'notes stored server-side');
        },
      );
    },
  },
  {
    name: 'late-commit',
    task: '1.4',
    title: 'A timed-out POST the server stores late is found on Retry',
    run: () => {
      let count = 0;
      const stored = [];
      let late = null;
      return withPage(
        {
          api: {
            'GET /notes.json': route => route.fulfill({json: stored}),
            'POST /notes.json': async (route, req) => {
              count++;
              const n = JSON.parse(req.postData()).note;
              const saved = {
                id: 9000 + count,
                x: n.x,
                y: n.y,
                width: n.width,
                height: n.height,
                body: n.body,
              };
              if (count === 1) {
                late = saved; // never answered; stored after the check
                return;
              }
              stored.push(saved);
              return route.fulfill({status: 201, json: saved});
            },
          },
        },
        async ({page, log}) => {
          await page.clock.install();
          await gotoPost(page);
          await enterActive(page);
          await createConfirmedNote(page, 'slow');
          await tapArcConfirm(page);
          await submitConfirmPopover(page);
          await page.waitForFunction(() =>
            document.body.classList.contains('dmna-sending'),
          );
          await page.clock.fastForward('00:25');
          await page.waitForSelector('#dmna-error-modal.show', {timeout: 4000});
          stored.push(late);
          await page.locator('.dmna-error-modal-btn[data-action="retry"]').tap();
          await page.clock.fastForward('00:02');
          await page.waitForTimeout(800);
          assert.equal(posts(log).length, 1, 'POST requests for one note');
        },
      );
    },
  },
  {
    name: 'focus-switch',
    task: '1.6',
    title: 'Switching boxes keeps typed text of an un-committed new box',
    run: async () => {
      await withPage({}, async ({page, log}) => {
        await gotoPost(page);
        await enterActive(page);
        await createConfirmedNote(page, 'B committed', {x: 100, y: 200});
        await page.touchscreen.tap(300, 500);
        await page.waitForSelector('#dmna-popover.show');
        await page.locator('#dmna-popover-input').fill('A typed, no commit');
        await page.touchscreen.tap(100, 200);
        await page.waitForTimeout(300);
        await page.locator('.dmna-popover-btn[data-action="cancel"]').tap();
        await page.waitForTimeout(200);
        await tapArcConfirm(page);
        await submitConfirmPopover(page);
        await page.waitForTimeout(600);
        const bodies = posts(log)
          .map(l => JSON.parse(l.body).note.body)
          .sort();
        assert.deepEqual(
          bodies,
          ['A typed, no commit', 'B committed'],
          'POSTed bodies',
        );
      });
      await withPage({}, async ({page}) => {
        await gotoPost(page);
        await enterActive(page);
        await createConfirmedNote(page, 'B committed', {x: 100, y: 200});
        await page.touchscreen.tap(300, 500);
        await page.waitForSelector('#dmna-popover.show');
        const b = await center(page, '.dmna-note-box:not(.is-active)');
        await page.touchscreen.tap(b.x, b.y);
        await page.waitForTimeout(300);
        assert.equal(
          await page.locator('.dmna-note-box').count(),
          1,
          'empty new box removed on switch',
        );
      });
    },
  },
];
