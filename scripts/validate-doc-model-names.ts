import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Allowlist {
  _comment?: string;
  [provider: string]: string[] | string | undefined;
}

interface Violation {
  file: string;
  line: number;
  model: string;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DOCS_DIR = path.resolve(__dirname, "../docs");
const ALLOWLIST_PATH = path.join(DOCS_DIR, "model-allowlist.json");

// Provider prefixes stripped before matching (e.g. "openai/gpt-4o" -> "gpt-4o")
const PROVIDER_PREFIXES = [
  "openai/",
  "anthropic/",
  "google/",
  "cohere/",
  "meta/",
  "mistral/",
  "azure/",
  "bedrock/",
  "vertex/",
  "fireworks/",
  "groq/",
  "together/",
  "deepseek/",
  "perplexity/",
];

// Patterns that look like model names we care about
const MODEL_PREFIXES = [
  "gpt-",
  "claude-",
  "gemini-",
  "o1-",
  "o3-",
  "o4-",
  "command-r",
  "command-a",
  "mistral-",
  "llama-",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function loadAllowlist(filePath: string): Set<string> {
  const raw: Allowlist = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  const allowed = new Set<string>();
  for (const [key, value] of Object.entries(raw)) {
    if (key === "_comment") continue;
    if (Array.isArray(value)) {
      for (const name of value) {
        allowed.add(name);
      }
    }
  }
  return allowed;
}

export function stripProviderPrefix(name: string): string {
  for (const prefix of PROVIDER_PREFIXES) {
    if (name.startsWith(prefix)) {
      return name.slice(prefix.length);
    }
  }
  return name;
}

const EXACT_MODEL_NAMES = new Set(["o1", "o3", "o4"]);

/**
 * Returns true if the string looks like a model name we should validate.
 */
export function looksLikeModelName(s: string): boolean {
  const lower = s.toLowerCase();
  if (EXACT_MODEL_NAMES.has(lower)) return true;
  return MODEL_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

/**
 * Extract code blocks (fenced and inline) from MDX content, preserving
 * line numbers so violations can be reported accurately.
 */
function extractCodeRegions(
  content: string,
): Array<{ text: string; lineOffset: number }> {
  const regions: Array<{ text: string; lineOffset: number }> = [];
  const lines = content.split("\n");

  let inFencedBlock = false;
  let blockStart = 0;
  let blockLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trimStart().startsWith("```")) {
      if (inFencedBlock) {
        // End of fenced block
        regions.push({ text: blockLines.join("\n"), lineOffset: blockStart });
        blockLines = [];
        inFencedBlock = false;
      } else {
        // Start of fenced block
        inFencedBlock = true;
        blockStart = i + 1; // content starts on next line
        blockLines = [];
      }
      continue;
    }

    if (inFencedBlock) {
      blockLines.push(line);
      continue;
    }

    // Inline code: extract `...` segments
    const inlineRegex = /`([^`]+)`/g;
    let match: RegExpExecArray | null;
    while ((match = inlineRegex.exec(line)) !== null) {
      regions.push({ text: match[1], lineOffset: i });
    }
  }

  return regions;
}

/**
 * Regex to extract model name strings from code.
 *
 * Matches patterns like:
 *   model="gpt-5.4-mini"
 *   model: "gpt-5.4"
 *   model='gemini-2.5-flash'
 *   "model": "claude-sonnet-4"
 *   ChatOpenAI(model="gpt-5.4")
 *   openai/gpt-5.4-mini  (bare provider-prefixed)
 */
const MODEL_ATTR_REGEX =
  /(?:model\s*[=:]\s*["']|"model"\s*:\s*["'])([\w./-]+)["']/g;

const BARE_PROVIDER_REGEX = new RegExp(
  `(?:${PROVIDER_PREFIXES.map((p) => p.replace("/", "\\/")).join("|")})([\\w.-]+)`,
  "g",
);

export function extractModelNames(
  content: string,
): Array<{ model: string; line: number }> {
  const results: Array<{ model: string; line: number }> = [];
  const seen = new Set<string>();

  const regions = extractCodeRegions(content);

  for (const region of regions) {
    const regionLines = region.text.split("\n");

    for (let i = 0; i < regionLines.length; i++) {
      const lineText = regionLines[i];
      const lineNumber = region.lineOffset + i + 1; // 1-indexed

      // Match model="..." / model: "..." / "model": "..."
      let match: RegExpExecArray | null;
      MODEL_ATTR_REGEX.lastIndex = 0;
      while ((match = MODEL_ATTR_REGEX.exec(lineText)) !== null) {
        const raw = match[1];
        const stripped = stripProviderPrefix(raw);
        if (stripped && looksLikeModelName(stripped)) {
          const key = `${stripped}:${lineNumber}`;
          if (!seen.has(key)) {
            seen.add(key);
            results.push({ model: stripped, line: lineNumber });
          }
        }
      }

      // Match bare provider-prefixed names (e.g. openai/gpt-5.4-mini)
      BARE_PROVIDER_REGEX.lastIndex = 0;
      while ((match = BARE_PROVIDER_REGEX.exec(lineText)) !== null) {
        const stripped = match[1];
        if (stripped && looksLikeModelName(stripped)) {
          const key = `${stripped}:${lineNumber}`;
          if (!seen.has(key)) {
            seen.add(key);
            results.push({ model: stripped, line: lineNumber });
          }
        }
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// File scanning
// ---------------------------------------------------------------------------

function findMdxFiles(dir: string): string[] {
  const results: string[] = [];

  function walk(current: string) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        // Skip node_modules and hidden dirs
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

export function validateFiles(
  docsDir: string,
  allowlistPath: string,
): Violation[] {
  const allowed = loadAllowlist(allowlistPath);
  const files = findMdxFiles(docsDir);
  const violations: Violation[] = [];

  for (const file of files) {
    const content = fs.readFileSync(file, "utf-8");
    const models = extractModelNames(content);

    for (const { model, line } of models) {
      if (!allowed.has(model)) {
        violations.push({
          file: path.relative(docsDir, file),
          line,
          model,
        });
      }
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const fixMode = args.includes("--fix");

  if (!fs.existsSync(ALLOWLIST_PATH)) {
    console.error(`Allowlist not found: ${ALLOWLIST_PATH}`);
    process.exit(1);
  }

  const violations = validateFiles(DOCS_DIR, ALLOWLIST_PATH);

  if (violations.length === 0) {
    console.log("All model names in docs are valid.");
    process.exit(0);
  }

  console.log(
    `Found ${violations.length} model name${violations.length === 1 ? "" : "s"} not in allowlist:\n`,
  );

  for (const v of violations) {
    console.log(`  ${v.file}:${v.line}  ${v.model}`);
  }

  console.log(
    `\nTo fix: add valid names to docs/model-allowlist.json, or update the docs.`,
  );

  if (fixMode) {
    // --fix mode: report but don't fail (for local dev)
    process.exit(0);
  }

  process.exit(1);
}

// Only run main when executed directly (not imported for tests)
const isDirectRun = typeof require !== "undefined" && require.main === module;

if (isDirectRun) {
  main();
}
