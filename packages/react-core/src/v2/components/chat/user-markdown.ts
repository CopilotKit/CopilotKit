const FENCE = /^\s*(```|~~~)/;
const ATX_HEADING = /^(\s{0,3})(#{1,6})(\s|$)/;
const INLINE_CODE = /(`+[^`]*`+)/;

/** Show `<` literally (users paste raw HTML/JSX) except inside inline code. */
function escapeHtml(line: string): string {
  return line
    .split(INLINE_CODE)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(/</g, "&lt;")))
    .join("");
}

/**
 * Prepares text a user typed for markdown rendering the way chat apps show it:
 * code blocks, lists, emphasis, links and tables render, while line breaks stay
 * where the user put them, `#` lines stay literal instead of becoming headings,
 * and pasted HTML shows as text rather than being parsed.
 */
export function prepareUserMarkdown(text: string): string {
  const lines = text.split("\n");
  let inFence = false;

  return lines
    .map((line, index) => {
      if (FENCE.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;

      const escaped = escapeHtml(line.replace(ATX_HEADING, "$1\\$2$3"));
      const next = lines[index + 1];
      // Markdown folds single newlines into spaces; a trailing double space
      // keeps them as typed. Blank lines already separate paragraphs.
      const keepBreak =
        next !== undefined &&
        escaped.trim() !== "" &&
        next.trim() !== "" &&
        !FENCE.test(next);
      return keepBreak ? `${escaped}  ` : escaped;
    })
    .join("\n");
}
