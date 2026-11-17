/**
 * Unit tests for src/api/notes.ts — request path guards.
 * vitest globals: describe/it/expect/beforeEach/afterEach/vi.
 */

import {apiDeleteNote, apiPutNote, fetchServerNotes} from '../src/api/notes';
import {asServerNoteId} from '../src/types';

const STATE = {x: 1, y: 2, w: 3, h: 4, text: 't'};

describe('apiPutNote / apiDeleteNote — server id guard (Task 2.2)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response(null, {status: 204}));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(['../favorites/5', '5.json', '5?x=1', 'temp-abc', ''])(
    'refuses %j without sending anything',
    async id => {
      await expect(apiPutNote(asServerNoteId(id), STATE)).rejects.toThrow(
        /server note id/,
      );
      await expect(apiDeleteNote(asServerNoteId(id))).rejects.toThrow(
        /server note id/,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('sends for a numeric id', async () => {
    await apiPutNote(asServerNoteId('4535572'), STATE);
    await apiDeleteNote(asServerNoteId('4535572'));
    expect(fetchMock.mock.calls.map(c => c[0])).toEqual([
      '/notes/4535572.json',
      '/notes/4535572.json',
    ]);
  });
});

describe('fetchServerNotes — pagination (Task 3.5)', () => {
  function page(from: number, count: number) {
    return Array.from({length: count}, (_, i) => ({
      id: from - i,
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      body: '',
    }));
  }

  beforeEach(() => {
    window.history.pushState(null, '', '/posts/123');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('a full page of 1000 fetches the next page before the lowest id', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => Response.json(page(5000, 1000)))
      .mockImplementationOnce(async () => Response.json(page(4000, 200)));
    vi.stubGlobal('fetch', fetchMock);

    const notes = await fetchServerNotes();

    expect(notes).toHaveLength(1200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain('page=b4001');
  });

  it('a short page is the last one', async () => {
    const fetchMock = vi.fn(async () => Response.json(page(10, 3)));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchServerNotes()).resolves.toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
