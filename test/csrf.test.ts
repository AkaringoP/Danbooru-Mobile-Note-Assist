/**
 * Unit tests for src/api/csrf.ts.
 * vitest globals: describe/it/expect/beforeEach/afterEach/vi — no explicit imports needed.
 */

import {ApiError, apiCall, getCsrfToken, getJson} from '../src/api/csrf';
import {REQUEST_TIMEOUT_MS} from '../src/config';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResponse(
  status: number,
  body: string | object | null,
  init: {statusText?: string} = {},
): Response {
  const text =
    body === null ? '' : typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(text, {
    status,
    statusText: init.statusText ?? '',
  });
}

function setMeta(content: string | null): void {
  const meta = document.createElement('meta');
  meta.setAttribute('name', 'csrf-token');
  if (content !== null) {
    meta.setAttribute('content', content);
  }
  document.head.appendChild(meta);
}

// ---------------------------------------------------------------------------
// getCsrfToken
// ---------------------------------------------------------------------------

describe('getCsrfToken', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
  });

  afterEach(() => {
    document.head.innerHTML = '';
  });

  it('returns token when meta has content', () => {
    setMeta('abc123');
    expect(getCsrfToken()).toBe('abc123');
  });

  it('returns empty string when meta has no content attribute', () => {
    setMeta(null);
    expect(getCsrfToken()).toBe('');
  });

  it('returns empty string when meta has content=""', () => {
    setMeta('');
    expect(getCsrfToken()).toBe('');
  });

  it('returns empty string when no meta tag exists — does not throw', () => {
    expect(getCsrfToken()).toBe('');
  });
});

// ---------------------------------------------------------------------------
// apiCall — request shape
// ---------------------------------------------------------------------------

describe('apiCall — request shape', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    setMeta('fixture-token');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(makeResponse(200, {ok: true})),
    );
  });

  afterEach(() => {
    document.head.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('POST with body — passes URL, method, credentials, and headers', async () => {
    await apiCall('POST', '/notes.json', {foo: 'bar'});
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit & {headers: Record<string, string>},
    ];
    expect(url).toBe('/notes.json');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('same-origin');
    expect(init.headers['Accept']).toBe('application/json');
    expect(init.headers['X-CSRF-Token']).toBe('fixture-token');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({foo: 'bar'}));
  });

  it('DELETE with null body — no Content-Type, no body', async () => {
    await apiCall('DELETE', '/notes/1.json', null);
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit & {headers: Record<string, string>},
    ];
    expect(init.method).toBe('DELETE');
    expect(init.credentials).toBe('same-origin');
    expect(init.headers['Content-Type']).toBeUndefined();
    expect(init.body).toBeUndefined();
  });

  it('PUT with undefined body — no Content-Type, no body', async () => {
    await apiCall('PUT', '/notes/2.json', undefined);
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit & {headers: Record<string, string>},
    ];
    expect(init.method).toBe('PUT');
    expect(init.headers['Content-Type']).toBeUndefined();
    expect(init.body).toBeUndefined();
  });

  it('reads CSRF token at call time — not cached at module load', async () => {
    // First call with 'fixture-token' already set in beforeEach
    await apiCall('POST', '/notes.json', {a: 1});

    // Update the meta token between calls
    document.head.innerHTML = '';
    setMeta('token-B');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(makeResponse(200, {ok: true})),
    );

    await apiCall('POST', '/notes.json', {a: 2});
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit & {headers: Record<string, string>},
    ];
    expect(init.headers['X-CSRF-Token']).toBe('token-B');
  });
});

// ---------------------------------------------------------------------------
// apiCall — success responses
// ---------------------------------------------------------------------------

describe('apiCall — success responses', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    setMeta('tok');
  });

  afterEach(() => {
    document.head.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('returns parsed JSON on 200', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(makeResponse(200, {ok: true, id: 5})),
    );
    const result = await apiCall('POST', '/notes.json', {});
    expect(result).toEqual({ok: true, id: 5});
  });

  it('returns null on 204 with empty body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse(204, null)));
    const result = await apiCall('DELETE', '/notes/1.json', null);
    expect(result).toBeNull();
  });

  it('returns null on 200 with empty body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse(200, null)));
    const result = await apiCall('POST', '/notes.json', {});
    expect(result).toBeNull();
  });

  it('returns parsed JSON on 201', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(makeResponse(201, {id: 42})),
    );
    const result = await apiCall('POST', '/notes.json', {});
    expect(result).toEqual({id: 42});
  });
});

// ---------------------------------------------------------------------------
// apiCall — error responses (4xx/5xx body surface, v3.0 D11)
// ---------------------------------------------------------------------------

describe('apiCall — error responses (4xx/5xx body surface, v3.0 D11)', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    setMeta('tok');
  });

  afterEach(() => {
    document.head.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('surfaces 422 message field', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          makeResponse(
            422,
            {message: 'Box overlaps existing note'},
            {statusText: 'Unprocessable Entity'},
          ),
        ),
    );
    await expect(apiCall('POST', '/notes.json', {})).rejects.toThrow(
      /^HTTP 422.*Box overlaps existing note$/,
    );
  });

  it('surfaces error field when message is absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          makeResponse(
            422,
            {error: 'Bad request'},
            {statusText: 'Unprocessable Entity'},
          ),
        ),
    );
    await expect(apiCall('POST', '/notes.json', {})).rejects.toThrow(
      /Bad request/,
    );
  });

  it('surfaces JSON.stringify(errors) when message and error are absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          makeResponse(
            422,
            {errors: {body: ["can't be blank"]}},
            {statusText: 'Unprocessable Entity'},
          ),
        ),
    );
    await expect(apiCall('POST', '/notes.json', {})).rejects.toThrow(
      /can't be blank/,
    );
  });

  it('falls through to raw text for non-JSON error body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        makeResponse(422, '<html>boom</html>', {
          statusText: 'Unprocessable Entity',
        }),
      ),
    );
    await expect(apiCall('POST', '/notes.json', {})).rejects.toThrow(
      /<html>boom<\/html>/,
    );
  });

  it('throws bare HTTP head on 500 with empty body — no trailing dash', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          makeResponse(500, null, {statusText: 'Internal Server Error'}),
        ),
    );
    await expect(apiCall('POST', '/notes.json', {})).rejects.toThrow(
      /^HTTP 500 Internal Server Error$/,
    );
  });

  it('truncates long error detail to 197 chars + "..."', async () => {
    const longMessage = 'x'.repeat(250);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          makeResponse(
            422,
            {message: longMessage},
            {statusText: 'Unprocessable Entity'},
          ),
        ),
    );
    let caughtErr: Error | undefined;
    try {
      await apiCall('POST', '/notes.json', {});
    } catch (e) {
      caughtErr = e as Error;
    }
    expect(caughtErr).toBeDefined();
    // Head is "HTTP 422 Unprocessable Entity — " then truncated detail
    const detail = caughtErr!.message.split(' — ')[1];
    expect(detail).toBeDefined();
    expect(detail.endsWith('...')).toBe(true);
    expect(detail.length).toBe(200);
  });

  it('propagates network errors without wrapping', async () => {
    const networkErr = new TypeError('Failed to fetch');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(networkErr));
    await expect(apiCall('POST', '/notes.json', {})).rejects.toThrow(
      'Failed to fetch',
    );
  });

  it('throws bare HTTP head when r.text() throws — body-read failure swallowed', async () => {
    const badResponse = {
      ok: false,
      status: 422,
      statusText: 'Unprocessable Entity',
      text: () => Promise.reject(new Error('stream error')),
    } as unknown as Response;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(badResponse));
    await expect(apiCall('POST', '/notes.json', {})).rejects.toThrow(
      /^HTTP 422 Unprocessable Entity$/,
    );
  });
});

// ---------------------------------------------------------------------------
// Timeout + ApiError (v5.1 Task 1.3)
// ---------------------------------------------------------------------------

/** A fetch mock that never settles until its signal aborts. */
function hangingFetch(): ReturnType<typeof vi.fn> {
  return vi.fn(
    (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(new DOMException('The operation was aborted.', 'AbortError')),
        );
      }),
  );
}

async function caughtApiError(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError) {
      return e;
    }
    throw e;
  }
  throw new Error('expected an ApiError rejection');
}

describe('request timeout + ApiError', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    setMeta('fixture-token');
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('REQUEST_TIMEOUT_MS is 20 s', () => {
    expect(REQUEST_TIMEOUT_MS).toBe(20_000);
  });

  it('apiCall: a request that never answers rejects with kind "timeout"', async () => {
    const fetchMock = hangingFetch();
    vi.stubGlobal('fetch', fetchMock);
    const p = apiCall('POST', '/notes.json', {a: 1});
    const assertion = expect(p).rejects.toMatchObject({
      name: 'ApiError',
      kind: 'timeout',
      status: null,
    });
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1);
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(
      false,
    );
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(
      true,
    );
  });

  it('apiCall: a body that never finishes reading also times out', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: () =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            );
          }),
      })),
    );
    const p = apiCall('PUT', '/notes/1.json', {a: 1});
    const assertion = expect(p).rejects.toMatchObject({kind: 'timeout'});
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    await assertion;
  });

  it('apiCall: success leaves no timer behind', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(makeResponse(200, {ok: true})),
    );
    await apiCall('POST', '/notes.json', {a: 1});
    expect(vi.getTimerCount()).toBe(0);
  });

  it('apiCall: HTTP errors carry kind "http" and the status, message unchanged', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          makeResponse(429, 'slow down', {statusText: 'Too Many Requests'}),
        ),
    );
    const err = await caughtApiError(apiCall('POST', '/notes.json', {}));
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({kind: 'http', status: 429});
    expect(err.message).toBe('HTTP 429 Too Many Requests — slow down');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('apiCall: a fetch TypeError becomes kind "network"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    );
    const err = await caughtApiError(apiCall('POST', '/notes.json', {}));
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({kind: 'network', status: null});
    expect(err.message).toBe('Failed to fetch');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('getJson: parses JSON, sends credentials and a signal', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse(200, {x: 1}));
    vi.stubGlobal('fetch', fetchMock);
    await expect(getJson('/posts/1.json')).resolves.toEqual({x: 1});
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.credentials).toBe('same-origin');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('getJson: non-2xx rejects with kind "http"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse(404, '')));
    await expect(getJson('/posts/1.json')).rejects.toMatchObject({
      kind: 'http',
      status: 404,
      message: 'HTTP 404',
    });
  });

  it('getJson: times out like apiCall', async () => {
    vi.stubGlobal('fetch', hangingFetch());
    const p = getJson('/notes.json');
    const assertion = expect(p).rejects.toMatchObject({kind: 'timeout'});
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    await assertion;
  });
});

describe('timedFetch — only fetch() failures count as network errors (review #6)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('a TypeError while handling the response is not relabelled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: () => Promise.reject(new TypeError('body stream broke')),
      })),
    );
    const err = await apiCall('POST', '/notes.json', {}).catch(e => e);
    expect(err).toBeInstanceOf(TypeError);
    expect(err).not.toBeInstanceOf(ApiError);
  });
});
