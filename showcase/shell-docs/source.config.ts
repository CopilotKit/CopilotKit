import { readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "fumadocs-mdx/config";
import { rehypeCodeDefaultOptions } from "fumadocs-core/mdx-plugins";
import {
  embedSource,
  replaceSource,
} from "fumadocs-core/mdx-plugins/stringifier";
import type { Processor } from "unified";
import { brandDark, brandLight } from "./src/proto/code-theme";
import { NAMED_SNIPPETS } from "./src/lib/named-snippets";
import { remarkFrameworkOverview } from "./src/lib/llms/remark-framework-overview";

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
      // The brand palette (lilac keywords, mint strings), as every other code
      // block on the site uses, not Shiki's GitHub themes.
      themes: { light: brandLight, dark: brandDark },
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
      remarkPropertyGroups,
      remarkFrameworkOverview,
      ...plugins,
    ],
    // A snippet gets the page's components without being passed them, as
    // shell-docs' inlining gave it (`src/components/docs-mdx/provider.tsx`).
    providerImportSource: "@/components/docs-mdx/provider",
  },
});

const SNIPPETS_DIR = path.resolve("src/content/snippets");

// Just the mdast shapes this plugin touches.
type Node = {
  type: string;
  name?: string | null;
  value?: string;
  children?: Node[];
};
type JsxNode = Node & { attributes?: { name?: string }[] };
type EsmNode = Node & {
  data?: { estree?: { body: EsmStatement[] } };
};
type EsmStatement = {
  type: string;
  source?: { value?: unknown };
  specifiers?: { type: string; local: { name: string } }[];
};
type VFile = Parameters<typeof embedSource>[0];
type MdastNode = Parameters<typeof embedSource>[1];

/**
 * Splices an imported snippet's content in place of its tag
 * (`import X from "@/snippets/x.mdx"` + `<X />`), as shell-docs'
 * `inlineSnippets` did, so its headings join the page's table of contents
 * and its text the page's search index and markdown. Nested snippets inline
 * too; a snippet used with children or inside a paragraph stays a component.
 *
 * The page's processed Markdown (`getText("processed")`) is its source with
 * each plugin's edits, so the snippet's source is embedded too
 * (`embedSource`): its text replaces the tag there, and edits to its nodes,
 * like heading IDs, land in it rather than at the same offsets of the page.
 */
function remarkInlineSnippets(this: Processor) {
  const processor = this;

  function inline(tree: Node, file: string, seen: Set<string>, page: VFile) {
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
    // Snippets pages use by name without importing them (`<CopilotRuntime />`)
    // inline the same way.
    const named = (name: string) =>
      Object.hasOwn(NAMED_SNIPPETS, name)
        ? path.join(SNIPPETS_DIR, NAMED_SNIPPETS[name])
        : undefined;

    const kept = new Set<string>();
    const walk = (parent: Node) => {
      if (!parent.children) return;
      parent.children = parent.children.flatMap((child) => {
        // A named snippet given attributes (`framework="mastra"`) stays a
        // component: inlined, its `props` would no longer carry them.
        const bare = !(child as JsxNode).attributes?.some(
          (a) => a.name !== "components",
        );
        const target = child.name
          ? (imports.get(child.name) ?? (bare ? named(child.name) : undefined))
          : undefined;
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
        return snippetContent(target, seen, child, page);
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
    tree.children = tree.children?.filter((n) => {
      if (n.type !== "mdxjsEsm") return true;
      if (((n as EsmNode).data?.estree?.body.length ?? 1) > 0) return true;
      // Out of the tree, so out of the processed Markdown too.
      replaceSource(page, n as MdastNode, "");
      return false;
    });
  }

  function snippetContent(
    file: string,
    seen: Set<string>,
    host: Node,
    page: VFile,
  ): Node[] {
    let source: string;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      // Inlined as nothing, a typo'd import would ship a blank section and
      // still build. Show it instead, as <Snippet> shows a missing region,
      // and warn: check-live-mdx fails on the warning.
      const name = path.relative(process.cwd(), file);
      page.message(`Missing snippet: ${name} doesn't exist`, {
        ruleId: MISSING_SNIPPET,
      });
      return [missingSnippet(name)];
    }
    const body = source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
    const tree = processor.parse({ path: file, value: body }) as Node;
    // Before nesting: a nested snippet's tag is placed by this embed.
    embedSource(
      page,
      host as MdastNode,
      body,
      (tree.children ?? []) as MdastNode[],
    );
    inline(tree, file, new Set([...seen, file]), page);
    return tree.children ?? [];
  }

  return (tree: Node, file: VFile) => {
    if (file.path) inline(tree, file.path, new Set([file.path]), file);
  };
}

/** The warning's rule id; scripts/check-live-mdx.mjs looks for it. */
const MISSING_SNIPPET = "missing-snippet";

/** A warn callout naming the missing file (`MissingSnippet` in showcase/snippet.tsx). */
function missingSnippet(name: string): Node {
  return {
    type: "mdxJsxFlowElement",
    name: "Callout",
    attributes: [
      { type: "mdxJsxAttribute", name: "type", value: "warn" },
      { type: "mdxJsxAttribute", name: "title", value: "Missing snippet" },
      { type: "mdxJsxAttribute", name: "role", value: "alert" },
    ],
    children: [
      {
        type: "paragraph",
        children: [
          { type: "inlineCode", value: name },
          { type: "text", value: " doesn't exist." },
        ],
      },
    ],
  } as Node;
}

/**
 * Wraps every run of `<PropertyReference>` tags in a
 * `<PropertyReferenceGroup>`, which renders them as one Fumadocs type table
 * (`src/components/docs-mdx/basics.tsx`). Without it, each prop is a table
 * of its own.
 */
function remarkPropertyGroups() {
  const group = (parent: Node) => {
    if (!parent.children) return;
    const out: Node[] = [];
    for (const child of parent.children) {
      group(child);
      const last = out.at(-1);
      if (
        child.type !== "mdxJsxFlowElement" ||
        child.name !== "PropertyReference"
      )
        out.push(child);
      else if (last?.name === "PropertyReferenceGroup")
        last.children!.push(child);
      else
        out.push({
          type: "mdxJsxFlowElement",
          name: "PropertyReferenceGroup",
          attributes: [],
          children: [child],
        } as Node);
    }
    parent.children = out;
  };
  return (tree: Node) => group(tree);
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
