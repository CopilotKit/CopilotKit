/**
 * Codemod: remove-stylesheet-import
 *
 * CopilotKit 2.0 ships its styles with its components, so apps no longer
 * import a stylesheet. This removes the old imports:
 *
 *   - JS/TS: `import "@copilotkit/react-core/v2/styles.css";` and
 *     `require("@copilotkit/react-core/v2/styles.css");`
 *   - CSS/SCSS: `@import "@copilotkit/react-core/v2/styles.css";`, including
 *     `url(...)` and `layer(...)` forms.
 *
 * It also removes `@copilotkit/react-ui/v2/styles.css`, which only re-exported
 * the react-core stylesheet, the built path
 * `@copilotkit/react-core/dist/v2/index.css`, and the Vue and Angular
 * stylesheets, `@copilotkit/vue/styles.css` and `@copilotkit/angular/styles.css`:
 *
 *   - Vue single-file components: the same imports, in `<script>` and `<style>`.
 *   - angular.json: the stylesheet in a `styles` array.
 *
 * An import that binds a name (`import styles from ".../styles.css"`) is left in
 * place and reported, because removing it would break the code that uses it.
 *
 * Usage:
 *   npx jscodeshift --parser=tsx --extensions=tsx,ts,jsx,js,css,scss,vue,json \
 *     -t https://raw.githubusercontent.com/CopilotKit/CopilotKit/main/codemods/remove-stylesheet-import.ts \
 *     ./src
 */

import type { API, FileInfo, Node } from "jscodeshift";

const STYLESHEETS = new Set([
  "@copilotkit/react-core/v2/styles.css",
  "@copilotkit/react-core/dist/v2/index.css",
  "@copilotkit/react-ui/v2/styles.css",
  "@copilotkit/vue/styles.css",
  "@copilotkit/angular/styles.css",
]);

const STYLESHEET_PATTERN = [...STYLESHEETS]
  .map((specifier) => specifier.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"))
  .join("|");

// A whole `@import` line for one of the stylesheets: `@import "x";`,
// `@import 'x' layer(base);`, `@import url("x");`, `@import url(x) screen;`,
// and webpack's `@import "~x";`.
const CSS_IMPORT = new RegExp(
  String.raw`^[ \t]*@import\s+(?:url\(\s*)?["']?~?(?:${STYLESHEET_PATTERN})["']?\s*\)?[^;\n]*;[ \t]*(?:\r?\n|$)`,
  "gm",
);

// A whole `import "x";` line, for Vue files, which jscodeshift can't parse.
const JS_IMPORT = new RegExp(
  String.raw`^[ \t]*import\s+["'](?:${STYLESHEET_PATTERN})["'];?[ \t]*(?:\r?\n|$)`,
  "gm",
);

// An angular.json `styles` entry: "node_modules/@copilotkit/angular/styles.css",
// with or without `node_modules/`, or `{ "input": … }` with that path.
const ANGULAR_STYLESHEET =
  /^(?:\.\/)?(?:node_modules\/)?@copilotkit\/angular\/styles\.css$/;

/**
 * Removes the Angular stylesheet from every `styles` array in angular.json.
 * The file is printed again with two-space indents, as the Angular CLI writes
 * it, so it only changes when an entry is removed.
 */
function removeAngularStylesheet(source: string): string {
  const json: unknown = JSON.parse(source);
  let changed = false;
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      for (const [key, child] of Object.entries(record)) {
        if (key === "styles" && Array.isArray(child)) {
          const kept = child.filter((entry) => {
            const input =
              typeof entry === "string"
                ? entry
                : (entry as { input?: unknown } | null)?.input;
            return !(
              typeof input === "string" && ANGULAR_STYLESHEET.test(input)
            );
          });
          if (kept.length !== child.length) {
            record[key] = kept;
            changed = true;
          }
        }
        visit(record[key]);
      }
    }
  };
  visit(json);
  return changed ? `${JSON.stringify(json, null, 2)}\n` : source;
}

// jscodeshift treats an empty result as "skipped" and keeps the old file, so
// a file that held only the import becomes a single newline.
function result(source: string, next: string): string | undefined {
  if (next === source) return undefined;
  return next.trim() === "" ? "\n" : next;
}

/**
 * Cuts `[start, end)` out of `source`, with the rest of its line when nothing
 * else is on that line. Editing the text, not reprinting the AST, leaves the
 * rest of the file byte-for-byte as it was.
 */
function cut(source: string, ranges: Array<[number, number]>): string {
  let out = source;
  for (const [start, end] of [...ranges].sort((x, y) => y[0] - x[0])) {
    const lineStart = out.lastIndexOf("\n", start - 1) + 1;
    const newline = out.indexOf("\n", end);
    const lineEnd = newline === -1 ? out.length : newline + 1;
    const ownLine =
      out.slice(lineStart, start).trim() === "" &&
      out.slice(end, lineEnd).trim() === "";
    out = ownLine
      ? out.slice(0, lineStart) + out.slice(lineEnd)
      : out.slice(0, start) + out.slice(end);
  }
  return out;
}

export default function transform(file: FileInfo, api: API) {
  if (/\.(css|scss|sass|less)$/.test(file.path)) {
    return result(file.source, file.source.replace(CSS_IMPORT, ""));
  }
  if (file.path.endsWith(".vue")) {
    return result(
      file.source,
      file.source.replace(JS_IMPORT, "").replace(CSS_IMPORT, ""),
    );
  }
  if (file.path.endsWith(".json")) {
    if (!/(^|[\\/])angular\.json$/.test(file.path)) return undefined;
    try {
      return result(file.source, removeAngularStylesheet(file.source));
    } catch {
      // angular.json may hold comments, which JSON.parse rejects.
      if (file.source.includes("@copilotkit/angular/styles.css")) {
        api.report(
          `${file.path}: remove "@copilotkit/angular/styles.css" from "styles" by hand.`,
        );
      }
      return undefined;
    }
  }

  const j = api.jscodeshift;
  const root = j(file.source);
  const ranges: Array<[number, number]> = [];
  const add = (node: Node) => {
    const { start, end } = node as Node & { start?: number; end?: number };
    if (typeof start === "number" && typeof end === "number") {
      ranges.push([start, end]);
    }
  };

  root.find(j.ImportDeclaration).forEach((path) => {
    const source = path.node.source.value;
    if (typeof source !== "string" || !STYLESHEETS.has(source)) return;
    if (path.node.specifiers?.length) {
      api.report(
        `${file.path}: "${source}" is imported with a name; remove it by hand.`,
      );
      return;
    }
    add(path.node);
  });

  // `require("…/styles.css");` as a statement of its own.
  root
    .find(j.ExpressionStatement, {
      expression: {
        type: "CallExpression",
        callee: { type: "Identifier", name: "require" },
      },
    })
    .forEach((path) => {
      const call = path.node.expression as {
        arguments: Array<{ type: string; value?: unknown }>;
      };
      const [arg] = call.arguments;
      if (
        call.arguments.length === 1 &&
        (arg.type === "StringLiteral" || arg.type === "Literal") &&
        typeof arg.value === "string" &&
        STYLESHEETS.has(arg.value)
      ) {
        add(path.node);
      }
    });

  return result(file.source, cut(file.source, ranges));
}
