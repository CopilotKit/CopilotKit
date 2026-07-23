// Bundle setup content for shell-docs.
//
// Integration packages own small setup snippets at:
//
//   showcase/integrations/<slug>/docs/setup/<concept>.mdx
//
// shell-docs runs without integration package sources in production, so these
// snippets have to be expanded while the Docker builder still has
// showcase/integrations available. This script rewrites static <DemoCode />
// references into fenced code blocks and emits a JSON bundle that shell-docs
// can import at runtime.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "..");
const PACKAGES_DIR = path.join(ROOT, "integrations");
const OUTPUT_PATH = path.join(
  ROOT,
  "shell-docs",
  "src",
  "data",
  "setup-content.json",
);

interface SetupContentEntry {
  framework: string;
  concept: string;
  source: string;
}

interface SetupContentBundle {
  version: 1;
  concepts: Record<string, SetupContentEntry>;
}

function stripFrontmatter(source: string): string {
  const frontmatter = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(source);
  return frontmatter ? source.slice(frontmatter[0].length) : source;
}

function resolveWithinDir(baseDir: string, relative: string): string | null {
  const base = path.resolve(baseDir);
  const resolved = path.resolve(base, relative);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) return null;
  return resolved;
}

const COMMENT_BY_EXT: Record<string, "py" | "slash"> = {
  py: "py",
  ts: "slash",
  tsx: "slash",
  js: "slash",
  jsx: "slash",
  java: "slash",
  cs: "slash",
  go: "slash",
  kt: "slash",
  rs: "slash",
};

const LANG_BY_EXT: Record<string, string> = {
  py: "python",
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  java: "java",
  cs: "csharp",
  go: "go",
  kt: "kotlin",
  rs: "rust",
};

function inferLanguage(filePath: string): string {
  const ext = filePath.includes(".")
    ? filePath.slice(filePath.lastIndexOf(".") + 1).toLowerCase()
    : "";
  return LANG_BY_EXT[ext] ?? "plaintext";
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function markersFor(ext: string): {
  legacyStart: (region: string) => RegExp;
  namedStart: (region: string) => RegExp;
  legacyEnd: () => RegExp;
  namedEnd: (region: string) => RegExp;
} | null {
  const kind = COMMENT_BY_EXT[ext];
  if (!kind) return null;
  const prefix = kind === "py" ? "#" : "//";
  return {
    legacyStart: (region) => {
      const escaped = escapeRegex(region);
      return new RegExp(`^\\s*${prefix}\\s*region:\\s*${escaped}\\s*$`);
    },
    namedStart: (region) => {
      const escaped = escapeRegex(region);
      return new RegExp(`^\\s*${prefix}\\s*@region\\[${escaped}\\]\\s*$`);
    },
    legacyEnd: () => new RegExp(`^\\s*${prefix}\\s*endregion\\b`),
    namedEnd: (region) => {
      const escaped = escapeRegex(region);
      return new RegExp(`^\\s*${prefix}\\s*@endregion\\[${escaped}\\]\\s*$`);
    },
  };
}

function extractRegion(
  source: string,
  region: string,
  ext: string,
): string | null {
  const markers = markersFor(ext);
  if (!markers) return null;
  const lines = source.split("\n");
  const legacyStartRx = markers.legacyStart(region);
  const namedStartRx = markers.namedStart(region);
  const legacyEndRx = markers.legacyEnd();
  const namedEndRx = markers.namedEnd(region);

  const blocks: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const isNamedStart = namedStartRx.test(lines[i]);
    const isLegacyStart = legacyStartRx.test(lines[i]);
    if (!isNamedStart && !isLegacyStart) {
      i++;
      continue;
    }
    const startIdx = i;
    const endRx = isNamedStart ? namedEndRx : legacyEndRx;
    let endIdx = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (endRx.test(lines[j])) {
        endIdx = j;
        break;
      }
    }
    if (endIdx === -1) {
      throw new Error(
        `[demo-code] unterminated region "${region}" starting at line ${
          startIdx + 1
        }`,
      );
    }
    blocks.push(lines.slice(startIdx + 1, endIdx).join("\n"));
    i = endIdx + 1;
  }

  if (blocks.length === 0) return null;
  if (blocks.length > 1) {
    throw new Error(
      `[demo-code] duplicate region "${region}" appears ${blocks.length} times`,
    );
  }
  return blocks[0];
}

function matchAttr(attrs: string, name: string): string | undefined {
  const dq = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs);
  if (dq) return dq[1];
  const sq = new RegExp(`\\b${name}='([^']*)'`).exec(attrs);
  if (sq) return sq[1];
  return undefined;
}

function formatFenceTitle(title: string): string {
  return JSON.stringify(title);
}

const DEMO_CODE_TAG_RX = /<DemoCode\b((?:"[^"]*"|'[^']*'|[^'"<>])*)\/>/g;

function parseLineRange(input: string): [number, number] | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  const openEnded = trimmed.match(/^(\d+)\s*[-\u2013]\s*$/);
  if (openEnded) {
    const start = parseInt(openEnded[1], 10);
    if (start > 0) return [start, Number.POSITIVE_INFINITY];
    return null;
  }
  const dash = trimmed.match(/^(\d+)\s*[-\u2013]\s*(\d+)$/);
  if (dash) {
    const start = parseInt(dash[1], 10);
    const end = parseInt(dash[2], 10);
    if (start > 0 && end >= start) return [start, end];
    return null;
  }
  const single = trimmed.match(/^(\d+)$/);
  if (single) {
    const n = parseInt(single[1], 10);
    if (n > 0) return [n, n];
  }
  return null;
}

function notationComment(language: string): string {
  return ["bash", "sh", "python", "py", "yaml", "yml"].includes(language)
    ? "#"
    : "//";
}

function applyHighlightMarkers(
  body: string,
  language: string,
  highlight: string | undefined,
): string {
  if (!highlight) return body;
  const lines = body.split("\n");
  const ranges: Array<[number, number]> = [];
  for (const part of highlight.split(",")) {
    const range = parseLineRange(part);
    if (!range) return body;
    const [start, end] = range;
    const effectiveEnd = Math.min(
      end === Number.POSITIVE_INFINITY ? lines.length : end,
      lines.length,
    );
    if (start <= effectiveEnd) ranges.push([start, effectiveEnd]);
  }
  if (ranges.length === 0) return body;

  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1] + 1) {
      last[1] = Math.max(last[1], range[1]);
    } else {
      merged.push([...range]);
    }
  }

  const marker = notationComment(language);
  let offset = 0;
  for (const [start, end] of merged) {
    const count = end - start + 1;
    lines.splice(start - 1 + offset, 0, `${marker} [!code highlight:${count}]`);
    offset++;
  }
  return lines.join("\n");
}

function rewriteDemoCode(source: string, packageRoot: string): string {
  return source.replace(DEMO_CODE_TAG_RX, (match, attrs: string) => {
    const file = matchAttr(attrs, "file");
    const region = matchAttr(attrs, "region");
    if (!file || !region) {
      throw new Error(
        `[demo-code] DemoCode references must use static file and region props: ${match}`,
      );
    }

    const resolved = resolveWithinDir(packageRoot, file);
    if (!resolved || !fs.existsSync(resolved)) {
      throw new Error(
        `[demo-code] file not found ${file} in package root ${packageRoot}`,
      );
    }

    const raw = fs.readFileSync(resolved, "utf-8");
    const ext = file.includes(".")
      ? file.slice(file.lastIndexOf(".") + 1).toLowerCase()
      : "";
    const body = extractRegion(raw, region, ext);
    if (body === null) {
      throw new Error(`[demo-code] region not found ${region} in ${file}`);
    }

    const language = matchAttr(attrs, "language") ?? inferLanguage(file);
    const title = matchAttr(attrs, "title") ?? path.basename(file);
    const highlight = matchAttr(attrs, "highlight");
    const highlightedBody = applyHighlightMarkers(body, language, highlight);
    return [
      "",
      `~~~~${language} title=${formatFenceTitle(title)}`,
      highlightedBody,
      "~~~~",
      "",
    ].join("\n");
  });
}

function readSetupConcepts(): SetupContentBundle {
  const bundle: SetupContentBundle = {
    version: 1,
    concepts: {},
  };
  const errors: string[] = [];

  if (!fs.existsSync(PACKAGES_DIR)) {
    throw new Error(`Integrations directory not found: ${PACKAGES_DIR}`);
  }

  const integrationDirs = fs
    .readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const framework of integrationDirs) {
    const packageRoot = path.join(PACKAGES_DIR, framework);
    const setupDir = path.join(packageRoot, "docs", "setup");
    if (!fs.existsSync(setupDir)) continue;

    const conceptFiles = fs
      .readdirSync(setupDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".mdx"))
      .map((entry) => entry.name)
      .sort();

    for (const filename of conceptFiles) {
      const concept = filename.slice(0, -".mdx".length);
      const conceptPath = path.join(setupDir, filename);
      const relativeConceptPath = path.relative(ROOT, conceptPath);
      const raw = fs.readFileSync(conceptPath, "utf-8");
      if (raw.trim().length === 0) continue;

      try {
        const source = rewriteDemoCode(stripFrontmatter(raw), packageRoot);
        if (/<DemoCode\b/.test(source)) {
          throw new Error("contains an unresolved <DemoCode> reference");
        }
        bundle.concepts[`${framework}::${concept}`] = {
          framework,
          concept,
          source,
        };
      } catch (err) {
        errors.push(`${relativeConceptPath}: ${(err as Error).message}`);
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Failed to bundle setup content:\n${errors
        .map((error) => `  - ${error}`)
        .join("\n")}`,
    );
  }

  return bundle;
}

function main(): void {
  const bundle = readSetupConcepts();
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(bundle, null, 2)}\n`);
  console.log(
    `Wrote ${Object.keys(bundle.concepts).length} setup concepts to ${path.relative(
      ROOT,
      OUTPUT_PATH,
    )}`,
  );
}

main();
