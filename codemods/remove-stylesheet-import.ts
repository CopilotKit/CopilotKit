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
 * the react-core stylesheet, and the built path
 * `@copilotkit/react-core/dist/v2/index.css`.
 *
 * An import that binds a name (`import styles from ".../styles.css"`) is left in
 * place and reported, because removing it would break the code that uses it.
 *
 * Usage:
 *   npx jscodeshift --parser=tsx --extensions=tsx,ts,jsx,js,css,scss \
 *     -t https://raw.githubusercontent.com/CopilotKit/CopilotKit/main/codemods/remove-stylesheet-import.ts \
 *     ./src
 */

import type { API, FileInfo, Node } from "jscodeshift";

const STYLESHEETS = new Set([
  "@copilotkit/react-core/v2/styles.css",
  "@copilotkit/react-core/dist/v2/index.css",
  "@copilotkit/react-ui/v2/styles.css",
]);

const STYLESHEET_PATTERN = [...STYLESHEETS]
  .map((specifier) => specifier.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"))
  .join("|");

// A whole `@import` line for one of the stylesheets: `@import "x";`,
// `@import 'x' layer(base);`, `@import url("x");`, `@import url(x) screen;`.
const CSS_IMPORT = new RegExp(
  String.raw`^[ \t]*@import\s+(?:url\(\s*)?["']?(?:${STYLESHEET_PATTERN})["']?\s*\)?[^;\n]*;[ \t]*(?:\r?\n|$)`,
  "gm",
);

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
