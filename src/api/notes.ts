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
import {apiCall} from './csrf';

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

/**
 * Fetches the active (non-deleted) notes for the current post.
 *
 * Danbooru exposes notes via the global `/notes.json` endpoint with a
 * search filter — there is no `/posts/{id}/notes.json` route (404).
 * `is_active=true` skips server-side soft-deleted notes; `limit=1000`
 * is well above any sane post's note count.
 */
export function fetchServerNotes(): Promise<ServerNoteDescriptor[]> {
  const id = getPostId();
  if (!id) {
    return Promise.reject(new Error('No post id in URL'));
  }
  const url =
    `/notes.json?search%5Bpost_id%5D=${id}` +
    '&search%5Bis_active%5D=true&limit=1000';
  return fetch(url, {credentials: 'same-origin'}).then(r => {
    if (!r.ok) {
      throw new Error(`HTTP ${r.status}`);
    }
    return r.json() as Promise<ServerNoteDescriptor[]>;
  });
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

/** PUT `/notes/{id}.json` — updates an existing server note. */
export async function apiPutNote(
  serverId: string,
  state: NoteState,
): Promise<unknown> {
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
  return apiCall('DELETE', `/notes/${serverId}.json`, null);
}
