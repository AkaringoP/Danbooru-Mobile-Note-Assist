/**
 * Unit tests for src/interactions/layout-watch.ts.
 * vitest globals: describe/it/expect/beforeEach/afterEach/vi — no explicit imports.
 */

type Callback = () => void;

let observed: Element[];
let fire: Callback;

class FakeResizeObserver {
  constructor(cb: Callback) {
    fire = cb;
  }
  observe(el: Element): void {
    observed.push(el);
  }
  unobserve(): void {}
  disconnect(): void {}
}

async function loadWatch(): Promise<
  typeof import('../src/interactions/layout-watch')
> {
  vi.resetModules();
  return import('../src/interactions/layout-watch');
}

const byId = (id: string): Element => document.getElementById(id)!;

beforeEach(() => {
  observed = [];
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  document.body.innerHTML = `
    <header id="top"><nav id="nav"><a id="link">x</a></nav></header>
    <div id="dmna-popover"></div>
    <div class="dmna-note-box" id="box"></div>
    <div id="page">
      <div id="notice"></div>
      <section id="image-container">
        <div id="native-notes"></div>
        <img id="image">
      </section>
      <ul id="tag-list"><li id="tag">t</li></ul>
    </div>
    <footer id="footer"></footer>`;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('bindLayoutWatch', () => {
  it('observes the image and the siblings of each of its ancestors', async () => {
    const {bindLayoutWatch} = await loadWatch();

    bindLayoutWatch(vi.fn());

    const ids = observed.map(el => el.id).sort();
    expect(ids).toEqual(
      [
        'footer',
        'image',
        'image-container',
        'native-notes',
        'notice',
        'page',
        'tag-list',
        'top',
      ].sort(),
    );
  });

  it('skips elements nested inside those siblings', async () => {
    const {bindLayoutWatch} = await loadWatch();

    bindLayoutWatch(vi.fn());

    expect(observed).not.toContain(byId('nav'));
    expect(observed).not.toContain(byId('tag'));
  });

  it("skips the script's own elements", async () => {
    const {bindLayoutWatch} = await loadWatch();

    bindLayoutWatch(vi.fn());

    expect(observed).not.toContain(byId('dmna-popover'));
    expect(observed).not.toContain(byId('box'));
  });

  it('calls back when an observed element changes size', async () => {
    const {bindLayoutWatch} = await loadWatch();
    const onChange = vi.fn();

    bindLayoutWatch(onChange);
    fire();

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('binds once', async () => {
    const {bindLayoutWatch} = await loadWatch();

    bindLayoutWatch(vi.fn());
    const count = observed.length;
    bindLayoutWatch(vi.fn());

    expect(observed.length).toBe(count);
  });

  it('waits for the image when it is not in the page yet', async () => {
    vi.useFakeTimers();
    const {bindLayoutWatch} = await loadWatch();
    const img = byId('image');
    const parent = img.parentElement!;
    img.remove();

    bindLayoutWatch(vi.fn());
    expect(observed).toEqual([]);

    parent.appendChild(img);
    vi.advanceTimersByTime(1000);

    expect(observed).toContain(img);
  });

  it('does nothing where ResizeObserver is missing', async () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const {bindLayoutWatch} = await loadWatch();

    expect(() => bindLayoutWatch(vi.fn())).not.toThrow();
    expect(observed).toEqual([]);
  });
});
