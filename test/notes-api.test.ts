/**
 * Unit tests for src/api/notes.ts — request path guards.
 * vitest globals: describe/it/expect/beforeEach/afterEach/vi.
 */

import {apiDeleteNote, apiPutNote} from '../src/api/notes';
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
