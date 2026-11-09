// Keeps the Vue generative UI docs in step with the code they describe: the
// reference prop names, the props of the chat slot, the camelCase binding of
// `generativeUI`, and the names that the examples import from
// `@copilotkit/vue/v2/generative-ui*`.
import fs from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");
const CONTENT = "showcase/shell-docs/src/content";
const REFERENCE = `${CONTENT}/reference/vue`;
const VUE_GENUI = "packages/vue/src/v2/generative-ui";
const README = "packages/vue/README.md";
const DEMO = "examples/v2/vue/demo";

function read(file: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
}

/** The files under `dir` with one of `extensions`, without build output. */
function walk(dir: string, extensions: readonly string[]): string[] {
  const skip = new Set(["node_modules", ".nuxt", ".output", "dist"]);
  const result: string[] = [];
  const visit = (relative: string) => {
    for (const entry of fs.readdirSync(path.join(REPO_ROOT, relative), {
      withFileTypes: true,
    })) {
      const child = `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!skip.has(entry.name)) visit(child);
      } else if (
        extensions.some((extension) => entry.name.endsWith(extension))
      ) {
        result.push(child);
      }
    }
  };
  visit(dir);
  return result;
}

/** The docs pages, the package README and the demo sources. */
function vueDocsAndExamples(): string[] {
  return [
    ...walk(CONTENT, [".mdx", ".md"]),
    README,
    ...walk(DEMO, [".vue", ".ts", ".md"]),
  ];
}

/** Names of the top-level and nested `<PropertyReference name>` tags. */
function documentedProps(file: string): {
  top: string[];
  nested: Map<string, string[]>;
} {
  const top: string[] = [];
  const nested = new Map<string, string[]>();
  const stack: string[] = [];
  const tag = /<PropertyReference\s+name="([^"]+)"|<\/PropertyReference>/g;
  for (const match of read(file).matchAll(tag)) {
    if (match[1] === undefined) {
      stack.pop();
      continue;
    }
    const parent = stack.at(-1);
    if (parent === undefined) top.push(match[1]);
    else nested.set(parent, [...(nested.get(parent) ?? []), match[1]]);
    stack.push(match[1]);
  }
  return { top, nested };
}

/**
 * The property names of a type or interface of a source file, from its
 * declaration to the first line that is a lone `}`. Comments are dropped.
 */
function declaredProps(file: string, declarationStart: string): Set<string> {
  const source = read(file);
  const start = source.indexOf(declarationStart);
  expect(start, `${file}: ${declarationStart}`).toBeGreaterThanOrEqual(0);
  const end = source.indexOf("\n}", start);
  const text = source
    .slice(start, end)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  return new Set(
    [...text.matchAll(/^ {2}(?:readonly\s+)?([A-Za-z_]\w*)\??:/gm)].map(
      (match) => match[1],
    ),
  );
}

/** The names that a barrel file exports, from its `export` statements. */
function exportedNames(file: string): Set<string> {
  const source = read(file).replace(/\/\*[\s\S]*?\*\//g, "");
  expect(source, `${file} has no export *`).not.toMatch(/^export \*/m);
  const names = new Set<string>();
  for (const [, list] of source.matchAll(/^export (?:type )?\{([^}]*)\}/gm)) {
    for (const item of list.split(",")) {
      const name = item
        .replace(/^\s*type\s+/, "")
        .split(/\s+as\s+/)
        .at(-1)
        ?.trim();
      if (name) names.add(name);
    }
  }
  for (const [, name] of source.matchAll(
    /^export (?:declare )?(?:const|function|class|interface|type|enum) (\w+)/gm,
  )) {
    names.add(name);
  }
  return names;
}

const ENTRIES: Record<string, string> = {
  "@copilotkit/vue/v2/generative-ui": `${VUE_GENUI}/index.ts`,
  "@copilotkit/vue/v2/generative-ui/chart":
    "packages/vue/src/v2/generative-ui-chart/index.ts",
  "@copilotkit/vue/v2/generative-ui/map":
    "packages/vue/src/v2/generative-ui-map/index.ts",
};

describe("Vue generative UI docs", () => {
  test("GenerativeUISurface reference documents exactly its props, and its default slot", () => {
    const documented = documentedProps(
      `${REFERENCE}/components/GenerativeUISurface.mdx`,
    ).top;
    const declared = declaredProps(
      `${VUE_GENUI}/GenerativeUISurface.vue`,
      "export interface GenerativeUISurfaceProps",
    );
    expect(declared).toContain("id");
    expect(new Set(documented)).toEqual(new Set([...declared, "default"]));
  });

  test("CopilotKitProvider reference names only keys of the generativeUI config", () => {
    const runtimeContext = `${VUE_GENUI}/runtime-context.ts`;
    const declared = new Set([
      ...declaredProps(runtimeContext, "interface GenerativeUIBaseConfig"),
      ...declaredProps(
        runtimeContext,
        "export interface GenerativeUIToolConfig",
      ),
      ...declaredProps(
        runtimeContext,
        "export interface GenerativeUIMarkdownConfig",
      ),
    ]);
    const { nested } = documentedProps(
      `${REFERENCE}/components/CopilotKitProvider.mdx`,
    );
    const documented = nested.get("generativeUI") ?? [];
    expect(documented).toContain("ui");
    for (const name of documented) expect(declared).toContain(name);
  });

  test("the #generative-ui-surface slot props of CopilotChat are the slot type's", () => {
    const chat = `${VUE_GENUI}/chat.ts`;
    const declared = new Set([
      ...declaredProps(chat, "export interface GenerativeUIChatSurfaceProps"),
      ...declaredProps(
        chat,
        "export interface GenerativeUIChatSurfaceSlotProps",
      ),
    ]);
    const page = read(`${REFERENCE}/components/CopilotChat.mdx`);
    const start = page.indexOf(
      '<PropertyReference name="generative-ui-surface"',
    );
    expect(start).toBeGreaterThanOrEqual(0);
    const section = page.slice(
      start,
      page.indexOf("</PropertyReference>", start),
    );
    const documented = [...section.matchAll(/^- `(\w+)` \(/gm)].map(
      (match) => match[1],
    );
    expect(documented).toContain("children");
    expect(new Set(documented)).toEqual(declared);
  });

  test("no page, README or demo file binds the kebab-case :generative-ui", () => {
    // Vue reads `:generative-ui` as the prop `generativeUi`, so the config
    // never reaches the provider. The prose that warns about it is in
    // backticks with no `=`.
    const offenders = vueDocsAndExamples().filter((file) =>
      /:generative-ui=/.test(read(file)),
    );
    expect(offenders).toEqual([]);
  });

  test("every name imported from @copilotkit/vue/v2/generative-ui* is exported", () => {
    const exported = new Map(
      Object.entries(ENTRIES).map(([specifier, file]) => [
        specifier,
        exportedNames(file),
      ]),
    );
    const importStatement =
      /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"(@copilotkit\/vue\/v2\/generative-ui[^"]*)"/g;
    const missing: string[] = [];
    let imports = 0;
    for (const file of vueDocsAndExamples()) {
      for (const [, list, specifier] of read(file).matchAll(importStatement)) {
        const names = exported.get(specifier);
        if (!names) {
          missing.push(`${file}: unknown entry ${specifier}`);
          continue;
        }
        for (const item of list.split(",")) {
          const name = item
            .replace(/^\s*type\s+/, "")
            .split(/\s+as\s+/)[0]
            ?.trim();
          if (!name) continue;
          imports += 1;
          if (!names.has(name))
            missing.push(`${file}: ${name} from ${specifier}`);
        }
      }
    }
    expect(missing).toEqual([]);
    expect(imports).toBeGreaterThanOrEqual(30);
  });
});
