/**
 * Note body length as Danbooru counts it (Layer 1 — pure).
 *
 * The server normalizes a body before validating its length
 * (`app/models/note.rb`: NFC, strip zero-width characters, turn
 * horizontal spaces into ' ', turn every line break into CRLF, strip),
 * then counts characters (code points). So a line break counts 2 and an
 * emoji counts 1 — `textarea.value.length` gets both wrong.
 */

export function serverNoteBodyLength(body: string): number {
  const normalized = body
    .normalize('NFC')
    .replace(/[\u180E\u200B\u200C\u2060\uFEFF]/g, '')
    .replace(/[\p{Zs}\t]/gu, ' ')
    .replace(/\r?\n|\r|\v|\f|\u0085|\u2028|\u2029/g, '\r\n')
    .replace(/^[\0\t\n\v\f\r ]+|[\0\t\n\v\f\r ]+$/g, '');
  return [...normalized].length;
}
