/**
 * A2UI Express text as numbered lines, for the playground's live view: one
 * line per statement, and the component id each one defines, so a line and
 * the component it made can point at each other. Pure; runs in the browser
 * and on the server.
 */

/** Splits Express (with or without its `<a2ui>` tags) into statements: brackets closed, no open string, comments left out. */
export function splitStatements(text: string): string[] {
  const start = text.indexOf("<a2ui>");
  const body = (start >= 0 ? text.slice(start + 6) : text).split("</a2ui>")[0];
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let from = 0;
  const push = (s: string) => {
    const t = s.trim();
    if (t && !t.startsWith("#")) out.push(t);
  };
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (body.startsWith(quote, i)) {
        i += quote.length - 1;
        quote = null;
      }
      continue;
    }
    if (ch === '"') quote = body.startsWith('"""', i) ? '"""' : '"';
    else if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) depth--;
    else if (ch === "\n" && depth === 0) {
      push(body.slice(from, i));
      from = i + 1;
    }
  }
  push(body.slice(from));
  return out;
}

/** The component id an Express statement defines (`kpis = Grid(...)`), or the `id` of a component written as JSON. */
export function lineId(
  text: string,
  format: "express" | "json" = "express",
): string | undefined {
  if (format === "json") {
    try {
      const id = (JSON.parse(text) as { id?: unknown }).id;
      return typeof id === "string" ? id : undefined;
    } catch {
      return undefined;
    }
  }
  return /^\s*([A-Za-z_]\w*)\s*=\s*[A-Z]\w*\(/.exec(text)?.[1];
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Express names each component by its id, so an id must be an identifier.
 * JSON allows any string ("f-nonstop" in the flight template): each such id
 * gets an identifier instead (`f_nonstop`). Returns original id -> Express
 * name for the ids that change. `POST /api/express` renames with this, and the
 * playground reads it backwards to find the component of a decompiled line.
 */
export function identifierRenames(ids: Iterable<string>): Map<string, string> {
  const all = [...new Set(ids)];
  const taken = new Set(all.filter((id) => IDENTIFIER.test(id)));
  const rename = new Map<string, string>();
  // A name that is taken gets the next free `_2`, `_3`, ...; counting on per name keeps many collisions linear.
  const suffix = new Map<string, number>();
  for (const id of all) {
    if (IDENTIFIER.test(id)) continue;
    let base = id.replace(/\W/g, "_");
    if (!/^[A-Za-z_]/.test(base)) base = `_${base}`;
    let next = base;
    if (taken.has(next)) {
      let n = suffix.get(base) ?? 2;
      while (taken.has(`${base}_${n}`)) n++;
      suffix.set(base, n + 1);
      next = `${base}_${n}`;
    }
    taken.add(next);
    rename.set(id, next);
  }
  return rename;
}
