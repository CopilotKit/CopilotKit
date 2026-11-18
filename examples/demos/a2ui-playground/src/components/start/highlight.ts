import { highlight } from "sugar-high";

export type Lang = "tsx" | "py" | "sh" | "md";

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const span = (kind: string, text: string) =>
  `<span style="color:var(--sh-${kind})">${escape(text)}</span>`;

/** Python: strings, comments and a few keywords, colored with the same `--sh-*` tokens as sugar-high. */
const PY =
  /("""[\s\S]*?"""|[fr]?"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|(#[^\n]*)|\b(import|from|def|return|for|in|if|else|None|True|False)\b/g;

function highlightPython(code: string) {
  let out = "";
  let last = 0;
  for (const m of code.matchAll(PY)) {
    out += escape(code.slice(last, m.index));
    out += m[1]
      ? span("string", m[1])
      : m[2]
        ? span("comment", m[2])
        : span("keyword", m[3]);
    last = m.index + m[0].length;
  }
  return out + escape(code.slice(last));
}

/** Shell: the command word of each line, `&&`, and trailing comments. */
function highlightShell(code: string) {
  return code
    .split("\n")
    .map((line) => {
      const hash = line.search(/(^|\s)#/);
      const body = hash === -1 ? line : line.slice(0, hash);
      const comment = hash === -1 ? "" : line.slice(hash);
      const parts = body.split(/(\s*&&\s*)/);
      const cmd = parts
        .map((p) =>
          /^\s*&&\s*$/.test(p)
            ? span("sign", p)
            : p.replace(
                /^(\s*)(\S+)(.*)$/,
                (_, ws: string, word: string, rest: string) =>
                  `${ws}${span("entity", word)}${escape(rest)}`,
              ),
        )
        .join("");
      return cmd + (comment ? span("comment", comment) : "");
    })
    .join("\n");
}

/** One line of Markdown prose: `inline code`, links, and a list or heading marker at its start. */
function highlightMarkdownLine(line: string) {
  const lead = line.match(/^(\s*(?:#{1,6}\s|[-*]\s|\d+\.\s))/)?.[0] ?? "";
  let out = lead ? span("keyword", lead) : "";
  let last = lead.length;
  for (const m of line
    .slice(lead.length)
    .matchAll(/(`[^`\n]+`)|(https?:\/\/[^\s)]+[^\s).,;:])/g)) {
    const at = lead.length + m.index;
    out += escape(line.slice(last, at));
    out += m[1] ? span("string", m[1]) : span("property", m[2]);
    last = at + m[0].length;
  }
  return out + escape(line.slice(last));
}

/** Markdown: prose with inline code, links and list markers; fenced blocks highlighted as their language. */
function highlightMarkdown(code: string): string {
  return code
    .split(/(```[a-z]*\n[\s\S]*?\n```)/g)
    .map((part) => {
      const fence = part.match(/^```([a-z]*)\n([\s\S]*?)\n```$/);
      if (!fence) return part.split("\n").map(highlightMarkdownLine).join("\n");
      const lang: Lang =
        fence[1] === "py" ? "py" : fence[1] === "sh" ? "sh" : "tsx";
      const ticks = (info: string) => span("comment", "```" + info);
      return `${ticks(fence[1])}\n${highlightCode(fence[2], lang)}\n${ticks("")}`;
    })
    .join("");
}

export function highlightCode(code: string, lang: Lang): string {
  if (lang === "py") return highlightPython(code);
  if (lang === "sh") return highlightShell(code);
  if (lang === "md") return highlightMarkdown(code);
  return highlight(code);
}
