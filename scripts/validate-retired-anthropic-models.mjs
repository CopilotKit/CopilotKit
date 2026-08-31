import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";

const model = (...segments) => segments.join("-");
const versionedModel = (family, version) =>
  `${model("claude", ...family)}-${version}`;

// Source: https://platform.claude.com/docs/en/about-claude/model-deprecations
// Keep the dated API IDs and commonly copied aliases together so runtime
// defaults, demos, documentation, and environment examples cannot regress.
export const RETIRED_ANTHROPIC_MODELS = [
  versionedModel(["opus", "4", "1"], "20250805"),
  versionedModel(["opus", "4"], "20250514"),
  versionedModel(["sonnet", "4"], "20250514"),
  versionedModel(["3", "7", "sonnet"], "20250219"),
  versionedModel(["3", "5", "haiku"], "20241022"),
  versionedModel(["3", "haiku"], "20240307"),
  versionedModel(["3", "5", "sonnet"], "20240620"),
  versionedModel(["3", "5", "sonnet"], "20241022"),
  versionedModel(["3", "opus"], "20240229"),
  `claude-${["2", "0"].join(".")}`,
  `claude-${["2", "1"].join(".")}`,
  versionedModel(["3", "sonnet"], "20240229"),
  `claude-${["1", "0"].join(".")}`,
  `claude-${["1", "1"].join(".")}`,
  `claude-${["1", "2"].join(".")}`,
  `claude-${["1", "3"].join(".")}`,
  `claude-${model("instant", "1")}.${0}`,
  `claude-${model("instant", "1")}.${1}`,
  `claude-${model("instant", "1")}.${2}`,
  model("claude", "3", "5", "sonnet", "latest"),
  model("claude", "3", "5", "haiku", "latest"),
  model("claude", "3", "opus", "latest"),
  model("claude", "opus", "4", "1"),
  `claude-${model("opus", "4")}.${1}`,
  model("claude", "opus", "4", "0"),
  model("claude", "opus", "4"),
  model("claude", "sonnet", "4", "0"),
  model("claude", "sonnet", "4"),
  model("claude", "3", "7", "sonnet"),
  `claude-${model("3", "7")}.sonnet`,
  model("claude", "3", "5", "haiku"),
  `claude-${model("3", "5")}.haiku`,
  model("claude", "3", "haiku"),
  model("claude", "3", "5", "sonnet"),
  `claude-${model("3", "5")}.sonnet`,
  model("claude", "3", "sonnet"),
  model("claude", "3", "opus"),
];

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const retiredModelPattern = new RegExp(
  `(?:${[...new Set(RETIRED_ANTHROPIC_MODELS)]
    .sort((left, right) => right.length - left.length)
    .map(escapeRegExp)
    .join("|")})(?![A-Za-z0-9._-])`,
  "g",
);

export function findRetiredAnthropicModels(file, source) {
  const violations = [];
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    for (const match of line.matchAll(retiredModelPattern)) {
      violations.push({ file, line: index + 1, model: match[0] });
    }
  }
  return violations;
}

export function scanRepository(cwd = process.cwd()) {
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  )
    .split("\0")
    .filter(Boolean);

  return files.flatMap((file) => {
    if (file === "scripts/validate-retired-anthropic-models.mjs") return [];

    const absolutePath = `${cwd}/${file}`;
    if (!existsSync(absolutePath)) return [];
    const stats = statSync(absolutePath);
    if (!stats.isFile() || stats.size > 2 * 1024 * 1024) return [];

    const buffer = readFileSync(absolutePath);
    if (buffer.includes(0)) return [];
    return findRetiredAnthropicModels(file, buffer.toString("utf8"));
  });
}

function main() {
  const violations = scanRepository();
  if (violations.length === 0) {
    console.log("No retired Anthropic model identifiers found.");
    return;
  }

  console.error("Retired Anthropic model identifiers found:\n");
  for (const violation of violations) {
    console.error(`  ${violation.file}:${violation.line}  ${violation.model}`);
  }
  console.error(
    "\nReplace these identifiers with an active model from Anthropic's model deprecation documentation.",
  );
  process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
