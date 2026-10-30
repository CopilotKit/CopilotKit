"use client";

import { useMemo } from "react";

/**
 * Tiny JSON syntax highlighter (no dependency): keys, strings, numbers,
 * literals, `{ "@path" }` bindings and `{ "@call" }` functions, as escaped
 * HTML for a `.pg-json` block. Works on any text, valid JSON or not, so the
 * JSON editor can colour what is being typed.
 */
export function highlightJson(text: string): string {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc.replace(/("(?:\\.|[^"\\\n])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g, (m, str, colon, lit, num) => {
    if (str) {
      if (colon) {
        const cls = str === '"@path"' || str === '"@call"' ? "j-bind" : str === '"component"' || str === '"id"' ? "j-key-strong" : "j-key";
        return `<span class="${cls}">${str}</span>${colon}`;
      }
      return `<span class="j-str">${str}</span>`;
    }
    if (lit) return `<span class="j-lit">${lit}</span>`;
    if (num) return `<span class="j-num">${num}</span>`;
    return m;
  });
}

export function JsonView({ value }: { value: unknown }) {
  const html = useMemo(() => highlightJson(JSON.stringify(value, null, 2) ?? ""), [value]);
  return <pre className="pg-json font-mono text-[11.5px] leading-[1.6]" dangerouslySetInnerHTML={{ __html: html }} />;
}

/**
 * The same colours for A2UI Express: the id each line defines, component
 * calls and keyword arguments, strings, numbers, literals and `$/path`
 * bindings.
 */
export function highlightExpress(text: string): string {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc.replace(
    /("""[\s\S]*?"""|"(?:\\.|[^"\\\n])*")|(\$\/[^\s,)\]}]*)|^([ \t]*)([A-Za-z_]\w*)(?=\s*=(?!=))|\b([A-Z]\w*)(?=\()|\b([a-z_]\w*)(?==(?!=))|\b(true|false|null|_)\b|(?<![\w.])(-?\d+(?:\.\d+)?)\b/gm,
    (m, str, bind, indent, id, call, kw, lit, num) => {
      if (str) return `<span class="j-str">${str}</span>`;
      if (bind) return `<span class="j-bind">${bind}</span>`;
      if (id) return `${indent}<span class="j-key-strong">${id}</span>`;
      if (call || kw) return `<span class="j-key">${call ?? kw}</span>`;
      if (lit) return `<span class="j-lit">${lit}</span>`;
      if (num) return `<span class="j-num">${num}</span>`;
      return m;
    },
  );
}

/** One statement per line, wrapped with a hanging indent so a long component call stays readable. */
export function ExpressView({ text }: { text: string }) {
  const lines = useMemo(() => text.split("\n").map((line) => highlightExpress(line) || " "), [text]);
  return (
    <div className="pg-json font-mono text-[11.5px] leading-[1.6]" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
      {lines.map((html, i) => (
        <div key={i} className="pl-[2ch] -indent-[2ch]" dangerouslySetInnerHTML={{ __html: html }} />
      ))}
    </div>
  );
}
