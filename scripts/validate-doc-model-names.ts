import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Models a provider offers, in two tiers.
 *
 * `ship` is what a starter may pin. `recognize` is every other real name, which
 * documentation may legitimately mention -- a migration note, a comparison, a
 * model a reader already uses. Both are real; only one is current.
 *
 * A bare array means the provider has not been split yet, and every name in it
 * counts as both. That keeps a partially split file valid and lets the split
 * land provider by provider.
 */
type ProviderModels = string[] | { ship?: string[]; recognize?: string[] };

interface Allowlist {
  _comment?: string;
  [provider: string]: ProviderModels | string | undefined;
}

/**
 * Which question the caller is asking of the list.
 *
 * `ship` asks whether we would put this model in a starter today. `all` asks
 * only whether the name is real, which is what documentation needs (PE-70).
 */
export type AllowlistTier = "ship" | "all";

interface Violation {
  file: string;
  line: number;
  model: string;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DOCS_DIR = path.resolve(__dirname, "../showcase/shell-docs/src/content");

/**
 * Trees whose files a developer clones and runs.
 *
 * Documentation may name an old model. These may not: whatever they pin is what
 * a new application is built on, and an older model handles tool calling,
 * structured output, and streamed generative UI differently from the one we
 * meant to show (PE-70). Until this list existed the check read the docs alone,
 * so the 150-odd starter files were the one place it never looked.
 */
const SHIPPED_DIRS = [
  path.resolve(__dirname, "../showcase/integrations"),
  path.resolve(__dirname, "../examples"),
];

/** Starter file kinds worth reading. Fixtures and lockfiles are not here. */
const SHIPPED_EXTENSIONS = [
  ".py",
  ".ts",
  ".tsx",
  ".cs",
  ".java",
  ".mdx",
  ".md",
];
const ALLOWLIST_PATH = path.resolve(
  __dirname,
  "../showcase/shell-docs/model-allowlist.json",
);

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

export function loadAllowlist(
  filePath: string,
  tier: AllowlistTier = "all",
): Set<string> {
  const raw: Allowlist = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  const allowed = new Set<string>();
  for (const [key, value] of Object.entries(raw)) {
    if (key === "_comment") continue;
    if (Array.isArray(value)) {
      // Not split yet: every name counts as current.
      for (const name of value) allowed.add(name);
      continue;
    }
    if (typeof value !== "object" || value === null) continue;
    for (const name of value.ship ?? []) allowed.add(name);
    if (tier === "all") {
      for (const name of value.recognize ?? []) allowed.add(name);
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
  // `google/gemini-2.5-*` names a family in prose. The match stops at the
  // wildcard and leaves a trailing separator, which no real version carries.
  if (/[-.]$/u.test(lower)) return false;
  return MODEL_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

/**
 * Extract code blocks (fenced and inline) from MDX content, preserving
 * line numbers so violations can be reported accurately.
 */
function extractCodeRegions(
  content: string,
  wholeFileIsCode = false,
): Array<{ text: string; lineOffset: number }> {
  // A starter's `.py`, `.ts`, or `.cs` file is code end to end. Running the
  // fence parser over it finds nothing, because there are no fences (PE-70).
  if (wholeFileIsCode) return [{ text: content, lineOffset: 0 }];

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
 *   "model": "claude-sonnet-4-6"
 *   ChatOpenAI(model="gpt-5.4")
 *   openai/gpt-5.4-mini  (bare provider-prefixed)
 */
const MODEL_ATTR_REGEX =
  /(?:model\s*[=:]\s*["']|"model"\s*:\s*["'])([\w./-]+)["']/g;

/**
 * A model named as the sole string argument of a call.
 *
 * `GetChatClient("gpt-4o-mini")` is the .NET starter's form, and the line that
 * produced PE-70. Nothing in the `model=` family matches it. Applied to source
 * files only: in prose a quoted name inside parentheses is as often a mention
 * as a pin, and `looksLikeModelName` is the only thing standing between this
 * pattern and every other quoted string in the repository.
 */
const CALL_ARGUMENT_REGEX = /\(\s*["']([\w./-]+)["']\s*\)/g;

const BARE_PROVIDER_REGEX = new RegExp(
  `(?:${PROVIDER_PREFIXES.map((p) => p.replace("/", "\\/")).join("|")})([\\w.-]+)`,
  "g",
);

export function extractModelNames(
  content: string,
  wholeFileIsCode = false,
): Array<{ model: string; line: number }> {
  const results: Array<{ model: string; line: number }> = [];
  const seen = new Set<string>();

  const regions = extractCodeRegions(content, wholeFileIsCode);
  const patterns = wholeFileIsCode
    ? [MODEL_ATTR_REGEX, BARE_PROVIDER_REGEX, CALL_ARGUMENT_REGEX]
    : [MODEL_ATTR_REGEX, BARE_PROVIDER_REGEX];

  for (const region of regions) {
    const regionLines = region.text.split("\n");

    for (let i = 0; i < regionLines.length; i++) {
      const lineText = regionLines[i];
      const lineNumber = region.lineOffset + i + 1; // 1-indexed

      for (const pattern of patterns) {
        let match: RegExpExecArray | null;
        pattern.lastIndex = 0;
        while ((match = pattern.exec(lineText)) !== null) {
          const stripped = stripProviderPrefix(match[1]);
          if (!stripped || !looksLikeModelName(stripped)) continue;
          if (lineText.includes(IGNORE_MARKER)) continue;
          const key = `${stripped}:${lineNumber}`;
          if (seen.has(key)) continue;
          seen.add(key);
          results.push({ model: stripped, line: lineNumber });
        }
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// File scanning
// ---------------------------------------------------------------------------

/**
 * Marker that says a line names an old model deliberately.
 *
 * The Claude adapter normalizes a legacy spelling, so it has to contain one.
 * Silencing it at the line keeps the reason next to the code, rather than in a
 * list of exceptions somewhere else that nobody revisits.
 */
const IGNORE_MARKER = "model-allowlist-ignore";

/** Extensions whose whole content is code rather than prose around fences. */
const SOURCE_EXTENSIONS = [".py", ".ts", ".tsx", ".cs", ".java"];

/** A test names a model because a test needs one. It ships nothing. */
function isTestFile(file: string): boolean {
  return (
    /\.(test|spec)\.[^.]+$/u.test(file) ||
    /(^|\/)(tests?|__tests__)\//u.test(file)
  );
}

function findMdxFiles(dir: string, extensions: readonly string[]): string[] {
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
      } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
        results.push(full);
      }
    }
  }

  walk(dir);
  return results.sort();
}

/** How a tree is scanned: which question to ask, and which files to read. */
export interface ValidateOptions {
  /** Defaults to `all`, which is what the documentation tree needs. */
  readonly tier?: AllowlistTier;
  /** Defaults to `.mdx`. A starter tree passes its own source extensions. */
  readonly extensions?: readonly string[];
}

export function validateFiles(
  docsDir: string,
  allowlistPath: string,
  options: ValidateOptions = {},
): Violation[] {
  const tier = options.tier ?? "all";
  const extensions = options.extensions ?? [".mdx"];
  const allowed = loadAllowlist(allowlistPath, tier);
  const files = findMdxFiles(docsDir, extensions);
  const violations: Violation[] = [];

  for (const file of files) {
    if (tier === "ship" && isTestFile(file)) continue;
    const content = fs.readFileSync(file, "utf-8");
    const wholeFileIsCode = SOURCE_EXTENSIONS.some((ext) => file.endsWith(ext));
    const models = extractModelNames(content, wholeFileIsCode);

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

  // The docs ask only whether a name is real. A starter asks whether it is one
  // we would ship today, which is the stricter of the two.
  const violations = validateFiles(DOCS_DIR, ALLOWLIST_PATH).map((v) => ({
    ...v,
    file: path.join("showcase/shell-docs/src/content", v.file),
    tier: "all" as const,
  }));

  for (const dir of SHIPPED_DIRS) {
    if (!fs.existsSync(dir)) continue;
    violations.push(
      ...validateFiles(dir, ALLOWLIST_PATH, {
        tier: "ship",
        extensions: SHIPPED_EXTENSIONS,
      }).map((v) => ({
        ...v,
        file: path.join(
          path.relative(path.resolve(__dirname, ".."), dir),
          v.file,
        ),
        tier: "ship" as const,
      })),
    );
  }

  if (violations.length === 0) {
    console.log("All model names are valid.");
    process.exit(0);
  }

  console.log(
    `Found ${violations.length} model name${violations.length === 1 ? "" : "s"} to fix:\n`,
  );

  for (const v of violations) {
    const why = v.tier === "ship" ? "not a model we ship" : "not a known model";
    console.log(`  ${v.file}:${v.line}  ${v.model}  (${why})`);
  }

  console.log(
    `\nA starter may only pin a model listed under "ship". Documentation may also name` +
      `\none listed under "recognize". Both lists are showcase/shell-docs/model-allowlist.json.`,
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
