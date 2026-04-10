import * as fs from "node:fs";
import * as path from "node:path";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkMdx from "remark-mdx";
import { visit } from "unist-util-visit";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CodeBlock {
  lang: string;
  title: string;
  doctest: string;
  code: string;
  line: number;
  sourceFile: string;
}

interface ManifestEntry {
  id: string;
  file: string;
  lang: string;
  category: string;
  source: string;
}

interface DoctestConfig {
  python?: { deps: string[] };
  typescript?: { deps: string[] };
  node?: { deps: string[] };
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DOCS_DIR = path.resolve(__dirname, "../../docs");
const OUTPUT_DIR = path.resolve(__dirname, "../../.doctest-output");

// ---------------------------------------------------------------------------
// AST Extraction
// ---------------------------------------------------------------------------

const parser = unified().use(remarkParse).use(remarkMdx);

/**
 * Strip common leading whitespace from all lines of a code block.
 * Handles indented code blocks inside JSX (Tabs, If, etc.) that
 * preserve the JSX indentation in the extracted code.
 */
function stripCommonIndent(code: string): string {
  const lines = code.split("\n");
  const nonEmptyLines = lines.filter((l) => l.trim().length > 0);
  if (nonEmptyLines.length === 0) return code;

  const minIndent = Math.min(
    ...nonEmptyLines.map((l) => l.match(/^(\s*)/)![1].length),
  );
  if (minIndent === 0) return code;

  return lines.map((l) => l.slice(minIndent)).join("\n");
}

/**
 * Parse the meta string from a code fence to extract key-value attributes.
 *
 * Handles formats like:
 *   python title="main.py" doctest="server"
 *   typescript title="server.ts" doctest="component"
 */
export function parseMeta(meta: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  // Match key="value" or key='value'
  const regex = /(\w+)=["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(meta)) !== null) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

/**
 * Extract all code blocks with a doctest attribute from an MDX file.
 */
export function extractFromMdx(
  content: string,
  sourceFile: string,
): CodeBlock[] {
  const blocks: CodeBlock[] = [];

  let tree: ReturnType<typeof parser.parse>;
  try {
    tree = parser.parse(content);
  } catch {
    // Some MDX files have JSX constructs that trip the parser.
    // Fall back to a regex-based extraction for resilience.
    return extractFromMdxFallback(content, sourceFile);
  }

  visit(tree, "code", (node: any) => {
    const lang = node.lang || "";
    const meta = node.meta || "";
    const attrs = parseMeta(meta);

    if (!attrs.doctest) return;

    const line =
      node.position && node.position.start ? node.position.start.line : 0;

    blocks.push({
      lang,
      title: attrs.title || `snippet.${langToExt(lang)}`,
      doctest: attrs.doctest,
      code: stripCommonIndent(node.value),
      line,
      sourceFile,
    });
  });

  return blocks;
}

/**
 * Regex-based fallback for MDX files that trip the remark-mdx parser.
 * Only extracts code blocks with doctest attributes — less precise on
 * position, but sufficient for our purposes.
 */
function extractFromMdxFallback(
  content: string,
  sourceFile: string,
): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const lines = content.split("\n");

  let inBlock = false;
  let blockLang = "";
  let blockMeta = "";
  let blockLines: string[] = [];
  let blockStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();

    if (!inBlock && /^```(\w+)(.*)$/.test(trimmed)) {
      const match = trimmed.match(/^```(\w+)(.*)$/);
      if (match) {
        blockLang = match[1];
        blockMeta = match[2];
        blockLines = [];
        blockStart = i + 1;
        inBlock = true;
      }
    } else if (inBlock && /^```\s*$/.test(trimmed)) {
      const attrs = parseMeta(blockMeta);
      if (attrs.doctest) {
        blocks.push({
          lang: blockLang,
          title: attrs.title || `snippet.${langToExt(blockLang)}`,
          doctest: attrs.doctest,
          code: stripCommonIndent(blockLines.join("\n")),
          line: blockStart,
          sourceFile,
        });
      }
      inBlock = false;
    } else if (inBlock) {
      blockLines.push(lines[i]);
    }
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function langToExt(lang: string): string {
  switch (lang) {
    case "python":
      return "py";
    case "typescript":
    case "tsx":
      return "ts";
    case "javascript":
    case "jsx":
      return "js";
    default:
      return lang || "txt";
  }
}

function slugify(filePath: string): string {
  return filePath
    .replace(/\.mdx$/, "")
    .replace(/[/\\]/g, "-")
    .replace(/[^a-zA-Z0-9-]/g, "");
}

/**
 * Walk a directory tree and return all .mdx files.
 */
function findMdxFiles(dir: string): string[] {
  const results: string[] = [];

  function walk(current: string) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") || entry.name === "node_modules")
          continue;
        walk(full);
      } else if (entry.name.endsWith(".mdx")) {
        results.push(full);
      }
    }
  }

  walk(dir);
  return results.sort();
}

// ---------------------------------------------------------------------------
// Output generation
// ---------------------------------------------------------------------------

/**
 * Group extracted blocks by page slug and title, then write to output dir.
 * Blocks sharing the same title within a page are concatenated into one file.
 */
export function writeExtractedBlocks(
  blocks: CodeBlock[],
  outputDir: string,
  docsDir: string,
): ManifestEntry[] {
  const manifest: ManifestEntry[] = [];

  // Group by (page slug, title)
  const grouped = new Map<string, CodeBlock[]>();
  for (const block of blocks) {
    const rel = path.relative(docsDir, block.sourceFile);
    const slug = slugify(rel);
    const key = `${slug}/${block.title}`;
    const existing = grouped.get(key) || [];
    existing.push(block);
    grouped.set(key, existing);
  }

  for (const [key, groupBlocks] of grouped) {
    const slug = key.split("/")[0];
    const title = groupBlocks[0].title;
    const dir = path.join(outputDir, slug);

    fs.mkdirSync(dir, { recursive: true });

    // Concatenate code from all blocks sharing this title
    const code = groupBlocks.map((b) => b.code).join("\n\n");
    const filePath = path.join(dir, title);
    fs.writeFileSync(filePath, code, "utf-8");

    // Copy doctest.json sidecar if it exists
    const sidecarPath = path.join(
      path.dirname(groupBlocks[0].sourceFile),
      "doctest.json",
    );
    const destSidecar = path.join(dir, "doctest.json");
    if (fs.existsSync(sidecarPath) && !fs.existsSync(destSidecar)) {
      fs.copyFileSync(sidecarPath, destSidecar);
    }

    const firstBlock = groupBlocks[0];
    const relSource = path.relative(
      path.resolve(docsDir, ".."),
      firstBlock.sourceFile,
    );

    const id = `${slug}-${title.replace(/[^a-zA-Z0-9]/g, "-")}`;

    manifest.push({
      id,
      file: `${slug}/${title}`,
      lang: firstBlock.lang,
      category: firstBlock.doctest,
      source: `${relSource}:${firstBlock.line}`,
    });
  }

  return manifest;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function extract(
  docsDir: string = DOCS_DIR,
  outputDir: string = OUTPUT_DIR,
): ManifestEntry[] {
  // Clean output dir
  if (fs.existsSync(outputDir)) {
    fs.rmSync(outputDir, { recursive: true });
  }
  fs.mkdirSync(outputDir, { recursive: true });

  const files = findMdxFiles(docsDir);
  const allBlocks: CodeBlock[] = [];

  for (const file of files) {
    const content = fs.readFileSync(file, "utf-8");
    const blocks = extractFromMdx(content, file);
    allBlocks.push(...blocks);
  }

  const manifest = writeExtractedBlocks(allBlocks, outputDir, docsDir);

  // Write manifest
  const manifestPath = path.join(outputDir, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");

  console.log(`Extracted ${manifest.length} doctest snippet(s):`);
  for (const entry of manifest) {
    console.log(`  ${entry.id} [${entry.category}] ${entry.source}`);
  }

  return manifest;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

const isDirectRun = typeof require !== "undefined" && require.main === module;

if (isDirectRun) {
  extract();
}
