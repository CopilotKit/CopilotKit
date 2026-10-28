import { readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "fumadocs-mdx/config";
import { rehypeCodeDefaultOptions } from "fumadocs-core/mdx-plugins";
import type { Processor } from "unified";

/**
 * MDX options for every page and snippet. Collections are declared with
 * `fumadocs-mdx/macro` in `src/lib/*source.ts`; this file only sets the
 * global options, which also reach snippet files a page imports (they belong
 * to no collection).
 */
export default defineConfig({
  mdxOptions: {
    rehypeCodeOptions: {
      ...rehypeCodeDefaultOptions,
      // Code in a language Shiki doesn't ship (`gitignore`, ...) renders as
      // plain text instead of failing the page.
      fallbackLanguage: "plaintext",
      // `language-xxx` on each block, so the code stage can size itself.
      addLanguageClass: true,
    },
    // First, so the inlined snippets' headings reach the page's TOC.
    remarkPlugins: (plugins) => [
      remarkInlineSnippets,
      remarkTitleHeadings,
      ...plugins,
    ],
    // A snippet gets the page's components without being passed them, as
    // shell-docs' inlining gave it (`src/components/docs-mdx/provider.tsx`).
    providerImportSource: "@/components/docs-mdx/provider",
  },
});

const SNIPPETS_DIR = path.resolve("content/live/snippets");

// Just the mdast shapes this plugin touches.
type Node = { type: string; name?: string | null; children?: Node[] };
type EsmNode = Node & {
  data?: { estree?: { body: EsmStatement[] } };
};
type EsmStatement = {
  type: string;
  source?: { value?: unknown };
  specifiers?: { type: string; local: { name: string } }[];
};

/**
 * Splices an imported snippet's content in place of its tag
 * (`import X from "@/snippets/x.mdx"` + `<X />`), as shell-docs'
 * `inlineSnippets` did, so its headings join the page's table of contents
 * and its text the page's search index and markdown. Nested snippets inline
 * too; a snippet used with children or inside a paragraph stays a component.
 */
function remarkInlineSnippets(this: Processor) {
  const processor = this;

  function inline(tree: Node, file: string, seen: Set<string>) {
    const imports = new Map<string, string>();
    for (const node of tree.children ?? []) {
      if (node.type !== "mdxjsEsm") continue;
      for (const s of (node as EsmNode).data?.estree?.body ?? []) {
        const from = s.source?.value;
        const local = s.specifiers?.find(
          (sp) => sp.type === "ImportDefaultSpecifier",
        )?.local.name;
        if (s.type !== "ImportDeclaration" || !local) continue;
        if (typeof from !== "string" || !/\.mdx?$/.test(from)) continue;
        imports.set(
          local,
          from.startsWith("@/snippets/")
            ? path.join(SNIPPETS_DIR, from.slice("@/snippets/".length))
            : path.resolve(path.dirname(file), from),
        );
      }
    }
    if (!imports.size) return;

    const kept = new Set<string>();
    const walk = (parent: Node) => {
      if (!parent.children) return;
      parent.children = parent.children.flatMap((child) => {
        const target = child.name ? imports.get(child.name) : undefined;
        if (!target) {
          if (child.type === "mdxJsxTextElement" && child.name)
            kept.add(child.name);
          walk(child);
          return [child];
        }
        if (
          child.type !== "mdxJsxFlowElement" ||
          child.children?.length ||
          seen.has(target)
        ) {
          kept.add(child.name!);
          walk(child);
          return [child];
        }
        return snippetContent(target, seen);
      });
    };
    walk(tree);

    // Drop the imports whose every use was inlined.
    for (const node of tree.children ?? []) {
      if (node.type !== "mdxjsEsm") continue;
      const estree = (node as EsmNode).data?.estree;
      if (!estree) continue;
      estree.body = estree.body.filter(
        (s) =>
          !(
            s.type === "ImportDeclaration" &&
            s.specifiers?.some(
              (sp) => imports.has(sp.local.name) && !kept.has(sp.local.name),
            )
          ),
      );
    }
    tree.children = tree.children?.filter(
      (n) =>
        n.type !== "mdxjsEsm" ||
        ((n as EsmNode).data?.estree?.body.length ?? 1) > 0,
    );
  }

  function snippetContent(file: string, seen: Set<string>): Node[] {
    let source: string;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      return [];
    }
    const body = source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
    const tree = processor.parse({ path: file, value: body }) as Node;
    inline(tree, file, new Set([...seen, file]));
    return tree.children ?? [];
  }

  return (tree: Node, file: { path?: string }) => {
    if (file.path) inline(tree, file.path, new Set([file.path]));
  };
}

type Heading = Node & { depth?: number; value?: string };

/** A heading's plain text. */
function textOf(node: Heading): string {
  if (typeof node.value === "string") return node.value;
  return (node.children ?? []).map((c) => textOf(c as Heading)).join("");
}

const same = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The page layout sets the title as the page's only H1, so a body H1 would
 * be a second one. A leading H1 that repeats the title is dropped; if the
 * body still uses H1s (some pages section themselves with them), every
 * heading moves down a level, which keeps their hierarchy.
 */
function remarkTitleHeadings() {
  return (tree: Node, file: { data: object }) => {
    const { frontmatter } = file.data as { frontmatter?: { title?: unknown } };
    const title = frontmatter?.title;
    const children = tree.children ?? [];
    const first = children.findIndex(
      (n) => n.type !== "mdxjsEsm" && n.type !== "mdxFlowExpression",
    );
    const lead = children[first] as Heading | undefined;
    if (
      lead?.type === "heading" &&
      lead.depth === 1 &&
      typeof title === "string" &&
      same(textOf(lead), title)
    ) {
      children.splice(first, 1);
    }

    const headings: Heading[] = [];
    const collect = (node: Node) => {
      if (node.type === "heading") headings.push(node as Heading);
      node.children?.forEach(collect);
    };
    collect(tree);
    if (!headings.some((h) => h.depth === 1)) return;
    for (const h of headings) h.depth = Math.min((h.depth ?? 1) + 1, 6);
  };
}
