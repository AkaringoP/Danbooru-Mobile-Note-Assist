/**
 * Unit tests for src/utils/note-body.ts.
 * vitest globals: describe/it/expect.
 */

import {NOTE_BODY_MAX_LENGTH} from '../src/config';
import {serverNoteBodyLength} from '../src/utils/note-body';

describe('serverNoteBodyLength — counts like Danbooru validates', () => {
  it('limit is 5000 (Note: validates :body, length: {maximum: 5000})', () => {
    expect(NOTE_BODY_MAX_LENGTH).toBe(5000);
  });

  it('plain text counts characters', () => {
    expect(serverNoteBodyLength('Here she is!')).toBe(12);
    expect(serverNoteBodyLength('')).toBe(0);
  });

  it('every line break is stored as CRLF and counts 2', () => {
    expect(serverNoteBodyLength('a\nb')).toBe(4);
    expect(serverNoteBodyLength('a\r\nb')).toBe(4);
    expect(serverNoteBodyLength('a\rb c')).toBe(7);
  });

  it('leading / trailing whitespace is stripped', () => {
    expect(serverNoteBodyLength('  a b \n\n')).toBe(3);
    expect(serverNoteBodyLength(' x　')).toBe(1);
  });

  it('zero-width characters are removed, ZWJ is kept', () => {
    expect(serverNoteBodyLength('a​b﻿')).toBe(2);
    expect(serverNoteBodyLength('a‍b')).toBe(3);
  });

  it('counts code points after NFC, not UTF-16 units', () => {
    expect(serverNoteBodyLength('\u{1F600}')).toBe(1);
    expect(serverNoteBodyLength('가')).toBe(1);
  });
});
