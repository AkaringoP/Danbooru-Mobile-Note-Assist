/**
 * Shared e2e harness. Serves a mock Danbooru post page on the real
 * origin via route interception, injects the built userscript at
 * document-end, and mocks the JSON endpoints the script calls.
 *
 * Nothing here reaches the network: every request to
 * danbooru.donmai.us is fulfilled by `context.route`.
 */

import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {chromium, devices} from 'playwright';

const DIST =
  process.env.DMNA_DIST ||
  fileURLToPath(new URL('../dist/MobileNoteAssist.user.js', import.meta.url));

export const ORIGIN = 'https://danbooru.donmai.us';
export const POST_URL = `${ORIGIN}/posts/123`;
export const DRAFT_KEY = 'dmna_draft_123';
export const IMAGE_WIDTH = 2000;
export const IMAGE_HEIGHT = 2800;

let userscript = null;
function loadUserscript() {
  if (userscript === null) {
    userscript = readFileSync(DIST, 'utf8');
  }
  return userscript;
}

function pageHtml({fillerNodes = 2500, preScript = ''} = {}) {
  const svg = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1400">` +
      '<rect width="1000" height="1400" fill="#789"/></svg>',
  );
  let filler = '';
  for (let i = 0; i < fillerNodes / 5; i++) {
    filler +=
      '<li class="tag-type-0"><a href="#">?</a> ' +
      `<a class="search-tag" href="#">tag_${i}</a> ` +
      `<span class="post-count">${i}</span><span></span></li>`;
  }
  const script = loadUserscript().replace(/<\/script>/g, '<\\/script>');
  return `<!doctype html><html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="csrf-token" content="test-token">
<style>body{margin:0;font-family:sans-serif} #image{display:block;width:100%;height:auto}</style>
<script>${preScript}</script>
</head><body>
<header style="height:60px">Danbooru (mock)</header>
<a id="translate" href="#">Add notes</a>
<section id="image-container"><div class="note-container"></div>
<img id="image" src="data:image/svg+xml,${svg}"></section>
<ul id="tag-list">${filler}</ul>
<div style="height:2000px"></div>
<script>${script}</script>
</body></html>`;
}

let sharedBrowser = null;

export async function getBrowser() {
  if (!sharedBrowser) {
    sharedBrowser = await chromium.launch();
  }
  return sharedBrowser;
}

export async function closeBrowser() {
  if (sharedBrowser) {
    await sharedBrowser.close();
    sharedBrowser = null;
  }
}

/**
 * Opens a fresh Pixel 7 context on the shared browser.
 *
 * opts.api: overrides keyed by `${METHOD} ${pathname}` →
 *   (route, request, log) => Promise
 * opts.serverNotes: array returned by GET /notes.json
 * opts.page: {fillerNodes, preScript}
 * opts.contextOptions: merged over the device descriptor
 *
 * Returns {context, page, log, errors, close}. `log` collects every
 * non-page request the script made.
 */
export async function openPage(opts = {}) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    ...devices['Pixel 7'],
    ...(opts.contextOptions || {}),
  });
  const log = [];
  let nextNoteId = 9000;
  const serverNotes = opts.serverNotes || [];
  await context.route(`${ORIGIN}/**`, async (route, req) => {
    const url = new URL(req.url());
    const key = `${req.method()} ${url.pathname}`;
    if (url.pathname === '/posts/123' && req.method() === 'GET') {
      return route.fulfill({
        contentType: 'text/html',
        body: pageHtml(opts.page || {}),
      });
    }
    log.push({
      method: req.method(),
      path: url.pathname + url.search,
      body: req.postData(),
    });
    if (opts.api && opts.api[key]) {
      return opts.api[key](route, req, log);
    }
    if (key === 'GET /posts/123.json') {
      if (url.search.includes('tag_string')) {
        return route.fulfill({json: {tag_string: '1girl translation_request'}});
      }
      return route.fulfill({
        json: {image_width: IMAGE_WIDTH, image_height: IMAGE_HEIGHT},
      });
    }
    if (key === 'GET /notes.json') {
      return route.fulfill({json: serverNotes});
    }
    if (key === 'POST /notes.json') {
      const b = JSON.parse(req.postData()).note;
      return route.fulfill({
        status: 201,
        json: {
          id: nextNoteId++,
          x: b.x,
          y: b.y,
          width: b.width,
          height: b.height,
          body: b.body,
        },
      });
    }
    if (key === 'PUT /posts/123.json') {
      return route.fulfill({json: {}});
    }
    if (req.method() === 'PUT' || req.method() === 'DELETE') {
      return route.fulfill({status: 204, body: ''});
    }
    if (key === 'GET /favicon.ico') {
      return route.fulfill({status: 204, body: ''});
    }
    return route.fulfill({status: 404, body: 'not mocked'});
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  return {context, page, log, errors, close: () => context.close()};
}

/** Runs `fn` with a fresh page and always closes its context. */
export async function withPage(opts, fn) {
  const handle = await openPage(opts);
  try {
    return await fn(handle);
  } finally {
    await handle.close();
  }
}

export async function center(page, selector) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) {
    throw new Error(`no bounding box for ${selector}`);
  }
  return {x: box.x + box.width / 2, y: box.y + box.height / 2};
}

export async function gotoPost(page) {
  await page.goto(POST_URL);
  await page.waitForSelector('#dmna-float-btn');
}

/** Double-tap the floating button → active mode. */
export async function enterActive(page) {
  const c = await center(page, '#dmna-float-btn');
  await page.touchscreen.tap(c.x, c.y);
  await page.waitForTimeout(80);
  await page.touchscreen.tap(c.x, c.y);
  await page.waitForFunction(() =>
    document.body.classList.contains('dmna-mode-active'),
  );
  await page.waitForTimeout(300);
}

/** Tap the image → new box, type text, press the popover's confirm. */
export async function createConfirmedNote(page, text, at = {x: 200, y: 300}) {
  await page.touchscreen.tap(at.x, at.y);
  await page.waitForSelector('#dmna-popover.show');
  await page.locator('#dmna-popover-input').fill(text);
  const c = await center(page, '.dmna-popover-btn[data-action="confirm"]');
  await page.touchscreen.tap(c.x, c.y);
  await page.waitForFunction(
    () => !document.querySelector('#dmna-popover.show'),
  );
}

/** Open the arc menu and tap its Confirm item. */
export async function tapArcConfirm(page) {
  const c = await center(page, '#dmna-float-btn');
  await page.touchscreen.tap(c.x, c.y);
  await page.waitForSelector('#dmna-menu.open');
  await page.waitForTimeout(350);
  const m = await center(page, '.dmna-menu-item[data-action="confirm"]');
  await page.touchscreen.tap(m.x, m.y);
}

/** Tap Submit on the Confirm-time popover. */
export async function submitConfirmPopover(page) {
  await page.waitForSelector('#dmna-tag-popover.show');
  await page.locator('.dmna-tag-popover-btn[data-action="submit"]').tap();
}

/** Fakes `document.visibilityState = 'hidden'` and fires the event. */
export async function goHidden(page) {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      get: () => 'hidden',
      configurable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
    delete document.visibilityState;
  });
}

/** Single-finger touch drag through CDP (generates real pointer events). */
export async function touchDrag(page, from, delta, steps = 20) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{x: from.x, y: from.y}],
  });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        {
          x: from.x + (delta.x * i) / steps,
          y: from.y + (delta.y * i) / steps,
        },
      ],
    });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  await cdp.detach();
}

/** Pre-script that counts Element#getBoundingClientRect calls. */
export const COUNT_GBCR = `
  window.__gbcr = 0;
  const __g = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function () {
    window.__gbcr++;
    return __g.call(this);
  };
`;
