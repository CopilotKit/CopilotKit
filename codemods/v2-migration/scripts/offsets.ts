/**
 * ast-grep gives node positions (`range().start.index`) as UTF-8 byte offsets,
 * and `commitEdits` takes byte offsets too. A JavaScript string is indexed by
 * UTF-16 code unit. In a file with a non-ASCII character (an em dash in a
 * comment is enough), the two differ after that character. Code that reads
 * the source text at a node position must convert the position first, and
 * convert back before it builds an edit.
 */

let cachedSource: string | undefined;
let cachedTable: Int32Array | undefined;

/** The byte offset at each string index, plus one entry for the end. */
function byteTable(source: string): Int32Array {
  if (source === cachedSource && cachedTable) return cachedTable;
  const table = new Int32Array(source.length + 1);
  let bytes = 0;
  for (let i = 0; i < source.length; i++) {
    table[i] = bytes;
    const code = source.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < source.length) {
      // A surrogate pair is one 4-byte character: both units map to its
      // start, so a byte offset never resolves into the middle of it.
      table[i + 1] = bytes;
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  table[source.length] = bytes;
  cachedSource = source;
  cachedTable = table;
  return table;
}

/** The string index of a UTF-8 byte offset into `source`. */
export function charIndex(source: string, byte: number): number {
  const table = byteTable(source);
  let low = 0;
  let high = source.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (table[middle]! < byte) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** The UTF-8 byte offset of a string index into `source`. */
export function byteIndex(source: string, char: number): number {
  return byteTable(source)[char]!;
}
