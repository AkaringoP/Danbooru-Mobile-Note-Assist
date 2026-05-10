/**
 * Unit tests for src/api/csrf.ts.
 * vitest globals: describe/it/expect/beforeEach/afterEach/vi — no explicit imports needed.
 */

import {getCsrfToken, apiCall} from '../src/api/csrf';

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
