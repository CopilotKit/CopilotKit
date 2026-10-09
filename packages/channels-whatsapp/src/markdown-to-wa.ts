/**
 * Translate GFM Markdown into WhatsApp's formatting subset:
 *   **bold** / __bold__   → *bold*
 *   *italic* / _italic_   → _italic_
 *   ~~strike~~            → ~strike~
 *   [text](url)           → text (url)
 *   # / ## / ### Heading  → *Heading*
 * Fenced (```) and inline (`) code are preserved verbatim — no transforms
 * run inside them.
 *
 * Implementation is a single forward scan that copies code spans/fences
 * untouched and applies the substitutions only to the prose between them.
 */
export function markdownToWhatsApp(input: string): string {
  const segments = splitOnCode(input);
  return segments
    .map((seg) => (seg.code ? seg.text : transformProse(seg.text)))
    .join("");
}

interface Segment {
  text: string;
  code: boolean;
}

/** Split into prose vs code segments (fenced ```...``` and inline `...`). */
function splitOnCode(input: string): Segment[] {
  const out: Segment[] = [];
  const re = /(```[\s\S]*?```|`[^`\n]*`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    if (m.index > last)
      out.push({ text: input.slice(last, m.index), code: false });
    out.push({ text: m[0], code: true });
    last = m.index + m[0].length;
  }
  if (last < input.length) out.push({ text: input.slice(last), code: false });
  return out;
}

function transformProse(text: string): string {
  let s = text;
  // Links: [text](url) → text (url)
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, "$1 ($2)");
  // Single *italic* → _italic_ — run BEFORE bold so **x** double-stars guard
  // against this regex (the leading [^*] or ^ followed immediately by ** won't
  // match a lone * that is part of **bold**).
  s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1_$2_");
  // Single _italic_ (underscore form) — if not already handled as bold __x__.
  // Run before __bold__ so double-underscore guards similarly.
  s = s.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, "$1_$2_");
  // ATX headers at line start → bold line.  Must run after italic so the
  // produced *X* isn't re-processed by the italic regex above.
  s = s.replace(/^[ \t]*#{1,6}[ \t]+(.+?)[ \t]*$/gm, "*$1*");
  // Bold: **x** or __x__ → *x*
  s = s.replace(/\*\*([^*]+)\*\*/g, "*$1*");
  s = s.replace(/__([^_]+)__/g, "*$1*");
  // Strike: ~~x~~ → ~x~
  s = s.replace(/~~([^~]+)~~/g, "~$1~");
  return s;
}
