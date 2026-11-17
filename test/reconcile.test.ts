/**
 * Unit tests for src/confirm/reconcile.ts.
 * vitest globals: describe/it/expect — no explicit imports needed.
 */

import type {ServerNoteDescriptor} from '../src/api/notes';
import {matchCommittedPosts, normalizeNoteBody} from '../src/confirm/reconcile';
import {NoteState, asTempNoteId} from '../src/types';

function post(id: string, state: Partial<NoteState> = {}) {
  return {
    noteId: asTempNoteId(id),
    state: {x: 10, y: 20, w: 100, h: 50, text: 'hello', ...state},
  };
}

function server(
  id: number,
  over: Partial<ServerNoteDescriptor> = {},
): ServerNoteDescriptor {
  return {id, x: 10, y: 20, width: 100, height: 50, body: 'hello', ...over};
}

const NONE = new Set<string>();

describe('normalizeNoteBody', () => {
  it('folds CRLF / LF / runs of spaces into one space and trims', () => {
    expect(normalizeNoteBody('  a\r\nb\n\nc   d \t')).toBe('a b c d');
  });

  it('applies NFC', () => {
    // Decomposed Hangul jamo (U+1100 U+1161) composes to U+AC00.
    expect(normalizeNoteBody('\u1100\u1161')).toBe('\uAC00');
  });

  it('drops the zero-width characters the server strips, keeps ZWJ', () => {
    expect(normalizeNoteBody('a\u200Bb\u200Cc\u2060d\uFEFFe\u180Ef')).toBe(
      'abcdef',
    );
    expect(normalizeNoteBody('a\u200Db')).toBe('a\u200Db');
  });
});

describe('matchCommittedPosts', () => {
  it('matches an exact server note', () => {
    const p = post('temp-1');
    const pairs = matchCommittedPosts([p], [server(5)], NONE);
    expect(pairs).toEqual([{post: p, serverNote: server(5)}]);
  });

  it('compares geometry after rounding, like the POST payload', () => {
    const p = post('temp-1', {x: 9.6, y: 20.4, w: 99.5, h: 50.2});
    expect(matchCommittedPosts([p], [server(5)], NONE)).toHaveLength(1);
  });

  it('compares bodies after the server-side normalization', () => {
    const p = post('temp-1', {text: '  first line\nsecond\u200B line  '});
    const s = server(5, {body: 'first line\r\nsecond line'});
    expect(matchCommittedPosts([p], [s], NONE)).toHaveLength(1);
  });

  it('skips server notes that were already known locally', () => {
    const pairs = matchCommittedPosts(
      [post('temp-1')],
      [server(5)],
      new Set(['5']),
    );
    expect(pairs).toEqual([]);
  });

  it('pairs identical posts with distinct server notes, one each', () => {
    const a = post('temp-a');
    const b = post('temp-b');
    const pairs = matchCommittedPosts([a, b], [server(5)], NONE);
    expect(pairs).toEqual([{post: a, serverNote: server(5)}]);
    const both = matchCommittedPosts([a, b], [server(5), server(6)], NONE);
    expect(both.map(m => [m.post.noteId, m.serverNote.id])).toEqual([
      ['temp-a', 5],
      ['temp-b', 6],
    ]);
  });

  it('does not match when geometry or body differ', () => {
    const p = post('temp-1');
    expect(matchCommittedPosts([p], [server(5, {x: 11})], NONE)).toEqual([]);
    expect(matchCommittedPosts([p], [server(5, {height: 49})], NONE)).toEqual(
      [],
    );
    expect(
      matchCommittedPosts([p], [server(5, {body: 'hullo'})], NONE),
    ).toEqual([]);
  });
});
