// Draft persistence scenarios (Tasks 1.1, 1.2, 2.2, 3.3, 4.2).
import assert from 'node:assert/strict';
import {
  DRAFT_KEY,
  createConfirmedNote,
  enterActive,
  goHidden,
  gotoPost,
  tapArcConfirm,
  withPage,
} from '../lib.mjs';

const hasDraft = page => page.evaluate(k => !!localStorage.getItem(k), DRAFT_KEY);

export default [
  {
    name: 'leave-discard',
    task: '1.1',
    title: 'Answering "Leave" on the reload prompt discards the draft',
    run: () =>
      withPage({}, async ({page}) => {
        await gotoPost(page);
        await enterActive(page);
        await createConfirmedNote(page, 'hello');
        let dialogType = null;
        page.on('dialog', async d => {
          dialogType = d.type();
          await d.accept();
        });
        await page.reload();
        await page.waitForSelector('#dmna-float-btn');
        await page.waitForTimeout(500);
        assert.equal(dialogType, 'beforeunload', 'reload prompt was shown');
        assert.equal(await hasDraft(page), false, 'draft key after Leave');
        const toast = await page
          .locator('#dmna-toast.show.has-actions')
          .count();
        assert.equal(toast, 0, 'restore toast after Leave');
      }),
  },
  {
    name: 'tag-popover-window',
    task: '1.2',
    title: 'Draft survives while the Confirm popover is open and nothing was sent',
    run: () =>
      withPage({}, async ({page, log}) => {
        await gotoPost(page);
        await enterActive(page);
        await createConfirmedNote(page, 'unsent work');
        await goHidden(page);
        assert.equal(await hasDraft(page), true, 'draft saved on hidden');
        await tapArcConfirm(page);
        await page.waitForSelector('#dmna-tag-popover.show');
        assert.equal(await hasDraft(page), true, 'draft while popover open');
        await goHidden(page);
        assert.equal(
          await hasDraft(page),
          true,
          'draft after backgrounding with popover open',
        );
        const writes = log.filter(l => l.method !== 'GET').length;
        assert.equal(writes, 0, 'write requests before Submit');
      }),
  },
  {
    name: 'draft-id',
    task: '2.2',
    title: 'A draft with a path-like note id is rejected',
    run: () =>
      withPage({}, async ({page, log}) => {
        await gotoPost(page);
        await page.evaluate(k => {
          const st = {x: 10, y: 10, w: 100, h: 100, text: 'x'};
          localStorage.setItem(
            k,
            JSON.stringify({
              schemaVersion: 1,
              savedAt: Date.now(),
              mode: 'active',
              activeNoteId: null,
              notes: [
                [
                  '../favorites/5',
                  {
                    current: st,
                    initialState: st,
                    confirmedState: st,
                    isDeleted: true,
                    isServerNote: true,
                    everConfirmed: true,
                  },
                ],
              ],
              actionLog: [],
            }),
          );
        }, DRAFT_KEY);
        await page.reload();
        await page.waitForSelector('#dmna-float-btn');
        await page.waitForTimeout(800);
        const toast = await page
          .locator('#dmna-toast.show.has-actions')
          .count();
        assert.equal(toast, 0, 'restore toast for a tampered draft');
        const writes = log.filter(l => l.method !== 'GET');
        assert.deepEqual(writes, [], 'write requests');
      }),
  },
  {
    name: 'stale-drafts',
    task: '3.3',
    title: 'Expired drafts of other posts are swept at boot',
    run: () =>
      withPage({}, async ({page}) => {
        await gotoPost(page);
        await page.evaluate(() => {
          const env = savedAt => ({
            schemaVersion: 1,
            savedAt,
            mode: 'active',
            activeNoteId: null,
            notes: [],
            actionLog: [],
          });
          const old = JSON.stringify(env(Date.now() - 30 * 24 * 3600 * 1000));
          for (let i = 0; i < 5; i++) {
            localStorage.setItem('dmna_draft_' + (900 + i), old);
          }
          localStorage.setItem('dmna_draft_950', JSON.stringify(env(Date.now())));
          localStorage.setItem('unrelated_key', 'keep');
        });
        await page.reload();
        await page.waitForSelector('#dmna-float-btn');
        await page
          .waitForFunction(
            () => !localStorage.getItem('dmna_draft_900'),
            null,
            {timeout: 4000},
          )
          .catch(() => {});
        const keys = await page.evaluate(() => Object.keys(localStorage).sort());
        assert.deepEqual(
          keys.filter(k => /^dmna_draft_9\d\d$/.test(k)),
          ['dmna_draft_950'],
          'draft keys left after the sweep',
        );
        assert.ok(keys.includes('unrelated_key'), 'unrelated key kept');
      }),
  },
  {
    name: 'storage-blocked',
    task: '4.2',
    title: 'The script boots when localStorage throws',
    run: () =>
      withPage(
        {
          page: {
            preScript: `Object.defineProperty(window, 'localStorage', {
              get() { throw new DOMException('The operation is insecure.', 'SecurityError'); },
            });`,
          },
        },
        async ({page, errors}) => {
          await page.goto('https://danbooru.donmai.us/posts/123');
          await page.waitForTimeout(500);
          assert.equal(
            await page.locator('#dmna-float-btn').count(),
            1,
            'floating button exists',
          );
          assert.deepEqual(errors, [], 'page errors');
        },
      ),
  },
];
