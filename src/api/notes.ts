/**
 * Danbooru `/notes` API surface (Layer 2 — api).
 *
 * Read path:
 *   - `fetchServerNotes` — GET the active notes for the current post.
 * Write path (called from `confirm/batch.sendBatch` in DELETE → PUT →
 * POST order; per-call 4xx body surfaced via `apiCall`):
 *   - `apiPostNote` — POST a new note (temp → server-side persist).
 *   - `apiPutNote` — PUT an updated server note.
 *   - `apiDeleteNote` — DELETE a server note.
 *
 * Float coordinates from `NoteState` are rounded to integers at send
 * time — Danbooru's notes table is integer-typed.
 */

import {NoteState} from '../types';
import {getPostId} from '../utils/coords';
import {apiCall, getJson} from './csrf';

/**
 * Server-note descriptor as returned by GET `/notes.json?post_id=…`.
 * The shape mirrors Danbooru's note record. `addServerNote` consumes
 * this and projects it into the in-memory `Note` (renaming `width`/
 * `height` → `w`/`h` and `body` → `text`).
 */
export interface ServerNoteDescriptor {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  body: string;
}

/**
 * Server response shape for POST `/notes.json`. All fields are
 * optional defensively — `applyServerStateToLocal` checks each before
 * trusting it as the new local baseline (Phase 6 audit C3).
 */
export interface ServerNoteResponse {
  id?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  body?: string;
}

/** Danbooru's page-size cap for /notes.json. */
const NOTES_PAGE_SIZE = 1000;
/** Posts allow up to 1200 active notes (`Note::MAX_NOTES_PER_POST`). */
const NOTES_MAX_PAGES = 5;

/**
 * Fetches the active (non-deleted) notes for the current post.
 *
 * Danbooru exposes notes via the global `/notes.json` endpoint with a
 * search filter — there is no `/posts/{id}/notes.json` route (404).
 * `is_active=true` skips server-side soft-deleted notes. A post can
 * hold up to 1200 notes but a page holds 1000, so a full page is
 * followed by the next one (`page=b<lowest id>`, stable while notes
 * change) — v5.2 Task 3.5.
 *
 * In-flight dedupe (Phase 5-h Task 5.32): a fast active-mode toggle
 * could otherwise fire two overlapping `enterActiveMode` runs and
 * stack two GETs. The cached promise short-circuits the second call
 * to share the first's response. Cleared on settle so a later toggle
 * (after the data drifted) gets a fresh request — same lifecycle as
 * `fetchPostMeta`'s dedupe.
 */
let serverNotesInFlight: Promise<ServerNoteDescriptor[]> | null = null;

export function fetchServerNotes(): Promise<ServerNoteDescriptor[]> {
  if (serverNotesInFlight) {
    return serverNotesInFlight;
  }
  const id = getPostId();
  if (!id) {
    return Promise.reject(new Error('No post id in URL'));
  }
  const p = fetchAllPages(id).finally(() => {
    serverNotesInFlight = null;
  });
  serverNotesInFlight = p;
  return p;
}

async function fetchAllPages(postId: string): Promise<ServerNoteDescriptor[]> {
  const base =
    `/notes.json?search%5Bpost_id%5D=${postId}` +
    `&search%5Bis_active%5D=true&limit=${NOTES_PAGE_SIZE}`;
  let all: ServerNoteDescriptor[] = [];
  let cursor = '';
  for (let i = 0; i < NOTES_MAX_PAGES; i++) {
    const page = await getJson<ServerNoteDescriptor[]>(base + cursor);
    all = all.concat(page);
    if (page.length < NOTES_PAGE_SIZE) {
      break;
    }
    cursor = `&page=b${Math.min(...page.map(n => n.id))}`;
  }
  return all;
}

/**
 * POST `/notes.json` — creates a new note. Coords/size are stored as
 * floats locally but the API wants integers, so round at send time.
 */
export async function apiPostNote(
  state: NoteState,
): Promise<ServerNoteResponse | null> {
  const postId = Number(getPostId());
  const payload = {
    note: {
      post_id: postId,
      x: Math.round(state.x),
      y: Math.round(state.y),
      width: Math.round(state.w),
      height: Math.round(state.h),
      body: state.text || '',
    },
  };
  return apiCall<ServerNoteResponse>('POST', '/notes.json', payload);
}

/**
 * The id lands in the request path; anything but digits (e.g. from a
 * tampered draft) would address some other endpoint.
 */
function assertServerNoteId(serverId: string): void {
  if (!/^\d+$/.test(serverId)) {
    throw new Error(
      `Refusing request: invalid server note id ${JSON.stringify(serverId)}`,
    );
  }
}

/** PUT `/notes/{id}.json` — updates an existing server note. */
export async function apiPutNote(
  serverId: string,
  state: NoteState,
): Promise<unknown> {
  assertServerNoteId(serverId);
  const payload = {
    note: {
      x: Math.round(state.x),
      y: Math.round(state.y),
      width: Math.round(state.w),
      height: Math.round(state.h),
      body: state.text || '',
    },
  };
  return apiCall('PUT', `/notes/${serverId}.json`, payload);
}

/** DELETE `/notes/{id}.json` — soft-deletes server-side. */
export async function apiDeleteNote(serverId: string): Promise<unknown> {
  assertServerNoteId(serverId);
  return apiCall('DELETE', `/notes/${serverId}.json`, null);
}

/**
 * Server response shape for POST `/notes/preview.json`. Rails returns
 * the full Note JSON plus the rendered `sanitized_body` HTML; we only
 * consume the rendered field, the rest is intentionally untyped.
 */
export interface PreviewNoteResponse {
  sanitized_body: string;
}

/**
 * POST `/notes/preview.json` — sanitizes a note body into the HTML
 * Danbooru would render, without persisting anything. Used by the
 * popover's Preview mode (Phase 3, v4.2) so the user can see how
 * `<b>` / `<tn>` / wiki markup will look before Confirm flushes it.
 *
 * Throws on:
 *   - empty response — `apiCall` only returns `null` for 204/empty
 *     bodies, and a 2xx from `preview` always carries a sanitized body.
 *   - missing or non-string `sanitized_body` — TS types claim it's
 *     present, but a future Danbooru API shape change could violate
 *     the contract and slam `undefined` into `innerHTML` at the
 *     sink. The runtime guard fails fast so the toast surfaces a
 *     meaningful error instead (Phase 5-h Task 5.25).
 */
export async function apiPreviewNote(
  body: string,
): Promise<PreviewNoteResponse> {
  const res = await apiCall<PreviewNoteResponse>(
    'POST',
    '/notes/preview.json',
    {body},
  );
  if (res === null) {
    throw new Error('Empty preview response');
  }
  if (typeof res.sanitized_body !== 'string') {
    throw new Error('Malformed preview response: sanitized_body missing');
  }
  return res;
}
