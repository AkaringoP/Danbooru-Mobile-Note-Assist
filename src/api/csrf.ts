/**
 * CSRF token reader + generic mutating-fetch wrapper.
 *
 * Layer 2 (api). All mutating Danbooru calls (POST/PUT/DELETE) go
 * through `apiCall`, which reads the token at request time so a stale
 * token surfaces as a fresh-fetch 422 rather than baking the value at
 * module load.
 *
 * GET-only endpoints (`fetchPostMeta`, `fetchPostTagString`,
 * `fetchServerNotes`) skip this wrapper because Danbooru doesn't
 * require CSRF on idempotent reads — they go through bare `fetch`.
 */

/**
 * Reads Danbooru's CSRF token from the page <meta>. Returns `''`
 * when missing rather than throwing — the request still goes out and
 * the server's 422 carries a more actionable diagnostic than a
 * frontend preflight error.
 */
export function getCsrfToken(): string {
  const meta = document.querySelector('meta[name="csrf-token"]');
  return meta ? meta.getAttribute('content') || '' : '';
}

/**
 * Generic JSON fetch wrapper for mutating Danbooru calls (POST/PUT/
 * DELETE). Always includes credentials + the current CSRF token,
 * normalizes empty / non-JSON 204 responses to `null`, and surfaces
 * Danbooru's error body when the response is non-2xx.
 *
 * **4xx surfacing (v3.0 D11)**: 422s typically carry actionable
 * messages (e.g., "Box overlaps existing note", "tag_string can't
 * be blank") that "HTTP 422" alone hides. The error message is
 * built as `HTTP <status> <statusText> — <truncated body>` with the
 * body capped at 200 chars. JSON bodies prefer `message` / `error` /
 * `JSON.stringify(errors)` in that order; non-JSON bodies fall
 * through as raw text. Body-read or parse failures are swallowed
 * silently — the bare HTTP line is the floor diagnostic, never less.
 *
 * `body === null` is the no-payload signal (used by DELETE);
 * `undefined` is treated the same way for callers that omit the arg.
 */
export async function apiCall<T = unknown>(
  method: 'POST' | 'PUT' | 'DELETE',
  url: string,
  body: unknown,
): Promise<T | null> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-CSRF-Token': getCsrfToken(),
  };
  const opts: RequestInit = {method, credentials: 'same-origin', headers};
  if (body !== undefined && body !== null) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(url, opts);
  if (!r.ok) {
    let detail = '';
    try {
      const errText = await r.text();
      if (errText) {
        try {
          const errJson = JSON.parse(errText);
          detail =
            errJson.message ||
            errJson.error ||
            (errJson.errors ? JSON.stringify(errJson.errors) : '') ||
            errText;
        } catch (_parseErr) {
          detail = errText;
        }
      }
    } catch (_readErr) {
      // r.text() can throw on aborted/network errors — leave detail empty.
    }
    const head = `HTTP ${r.status} ${r.statusText}`.trim();
    const truncated =
      detail.length > 200 ? detail.slice(0, 197) + '...' : detail;
    throw new Error(truncated ? `${head} — ${truncated}` : head);
  }
  // Empty / 204 responses are fine; only parse when there's a body.
  const text = await r.text();
  return text ? (JSON.parse(text) as T) : null;
}
