/**
 * Unit tests for src/api/posts.ts — tag update.
 * vitest globals: describe/it/expect/beforeEach/afterEach/vi.
 */

import {apiPatchPostTags} from '../src/api/posts';

describe('apiPatchPostTags — merge via old_tag_string (Task 4.4)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    window.history.pushState(null, '', '/posts/123');
    fetchMock = vi.fn(async () => Response.json({}));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends one PUT with the seen tags and the edited tags, no GET', async () => {
    await apiPatchPostTags({
      tagsToAdd: ['translated'],
      tagsToRemove: ['translation_request'],
      baseTagString: '1girl translation_request solo',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/posts/123.json');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).toEqual({
      post: {
        old_tag_string: '1girl translation_request solo',
        tag_string: '1girl solo translated',
      },
    });
  });
});
