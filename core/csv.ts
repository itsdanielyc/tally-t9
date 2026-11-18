// CSV as banks export it: RFC 4180 quoting, any of four delimiters, CRLF,
// LF or CR line ends, a byte-order mark, UTF-8 or Windows-1252 bytes.
// Every record keeps the line number it starts on, so a rejected row can be
// reported the way the person sees it in a text editor.

import type { Delimiter } from "../contracts/ledger.ts";

export const DELIMITERS: readonly Delimiter[] = [",", ";", "\t", "|"];

export type CsvRecord = {
  /** 1-based line on which the record starts */
  line: number;
  fields: string[];
  /** a quoted field ran to the end of the file without its closing quote */
  unterminated?: boolean;
};

/** Decodes file bytes: UTF-8 (with or without BOM), else Windows-1252. */
export function decodeCsvBytes(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder("windows-1252").decode(bytes);
  }
  return stripBom(text);
}

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Parses the text (up to `limit` records). Blank lines are skipped, not returned. */
export function parseCsv(input: string, delimiter: Delimiter, limit = Infinity): CsvRecord[] {
  const text = stripBom(input);
  const records: CsvRecord[] = [];
  let line = 1;
  let i = 0;
  const n = text.length;
  while (i < n && records.length < limit) {
    const start = line;
    const fields: string[] = [];
    let field = "";
    let quoted = false;
    let unterminated = false;
    let endOfRecord = false;
    let sawContent = false;
    while (i < n && !endOfRecord) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
          } else {
            quoted = false;
            i += 1;
          }
        } else {
          if (ch === "\n" || (ch === "\r" && text[i + 1] !== "\n")) line += 1;
          field += ch;
          i += 1;
        }
        continue;
      }
      if (ch === '"' && field.trim() === "") {
        quoted = true;
        field = "";
        sawContent = true;
        i += 1;
      } else if (ch === delimiter) {
        fields.push(field);
        field = "";
        sawContent = true;
        i += 1;
      } else if (ch === "\r" || ch === "\n") {
        i += ch === "\r" && text[i + 1] === "\n" ? 2 : 1;
        line += 1;
        endOfRecord = true;
      } else {
        field += ch;
        if (ch.trim() !== "") sawContent = true;
        i += 1;
      }
    }
    if (quoted) unterminated = true;
    fields.push(field);
    // Blank lines, and lines of nothing but delimiters, are not records.
    if (!unterminated && (!sawContent || fields.every((f) => f.trim() === ""))) continue;
    records.push(unterminated ? { line: start, fields, unterminated } : { line: start, fields });
  }
  return records;
}

/**
 * Picks the delimiter that splits the first records into the same number
 * of fields (more than one) most consistently.
 */
export function detectDelimiter(text: string): Delimiter {
  let best: { d: Delimiter; score: number } = { d: ",", score: -1 };
  for (const d of DELIMITERS) {
    const records = parseCsv(text, d, 30);
    if (records.length === 0) continue;
    const counts = new Map<number, number>();
    for (const r of records) counts.set(r.fields.length, (counts.get(r.fields.length) ?? 0) + 1);
    let mode = 1;
    let modeCount = 0;
    for (const [width, count] of counts) {
      if (count > modeCount || (count === modeCount && width > mode)) {
        mode = width;
        modeCount = count;
      }
    }
    if (mode < 2) continue;
    // Consistency first, then more columns.
    const score = (modeCount / records.length) * 1000 + Math.min(mode, 50);
    if (score > best.score) best = { d, score };
  }
  return best.d;
}
