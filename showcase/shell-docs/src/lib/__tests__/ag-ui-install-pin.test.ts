import fs from "node:fs";
import path from "node:path";

import { expect, test } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../../..");
const CONTENT_ROOT = "showcase/shell-docs/src/content";
const RUNTIME_PACKAGE_JSON = "packages/runtime/package.json";

// @copilotkit/runtime depends on these. A docs install outside that range
// gives the app a second copy with its own HttpAgent class.
const PINNED_PACKAGES = ["@ag-ui/client", "@ag-ui/core"] as const;

// Agent-side installs that pair @ag-ui/core with an adapter's own encoder,
// in a separate process from the runtime.
const AGENT_SIDE_INSTALL = /@ag-ui\/claude-agent-sdk/;

// A line that pins its own @copilotkit/runtime version pins a matching
// @ag-ui set with it, so the workspace runtime does not apply.
const VERSIONED_RUNTIME_INSTALL = /@copilotkit\/runtime@\d/;

const INSTALL_COMMAND = /\b(?:npm (?:install|i)|pnpm add|yarn add|bun add)\b/;

function listMarkdownFiles(relativeDirectory: string): string[] {
  const absoluteDirectory = path.join(REPO_ROOT, relativeDirectory);

  return fs
    .readdirSync(absoluteDirectory, { withFileTypes: true })
    .flatMap((entry) => {
      const relativePath = path.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) {
        return listMarkdownFiles(relativePath);
      }
      return entry.isFile() && entry.name.endsWith(".mdx")
        ? [relativePath]
        : [];
    })
    .sort();
}

const VERSION = /^\d+\.\d+\.\d+$/;

function compareVersions(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

// Supports an exact version or space-separated comparators such as
// ">=0.0.59 <0.1.0". Any other range syntax fails, so a new form gets
// a deliberate update here instead of a silent pass.
function satisfies(version: string, range: string): boolean {
  return range.split(/\s+/).every((comparator) => {
    const match = /^(>=|<=|>|<|=)?(\d+\.\d+\.\d+)$/.exec(comparator);
    if (!match) throw new Error(`Unsupported range comparator: ${comparator}`);
    const order = compareVersions(version, match[2]);
    switch (match[1]) {
      case ">=":
        return order >= 0;
      case ">":
        return order > 0;
      case "<=":
        return order <= 0;
      case "<":
        return order < 0;
      default:
        return order === 0;
    }
  });
}

// Joins shell lines that end in a backslash, so a package on a continuation
// line is checked with its install command. Keeps the first line's number.
function shellCommands(source: string): { line: number; text: string }[] {
  const commands: { line: number; text: string }[] = [];
  let pending: { line: number; text: string } | null = null;
  for (const [index, raw] of source.split("\n").entries()) {
    const continues = /\\\s*$/.test(raw);
    const text = raw.replace(/\\\s*$/, " ");
    if (pending) {
      pending.text += ` ${text}`;
    } else {
      pending = { line: index + 1, text };
    }
    if (!continues) {
      commands.push(pending);
      pending = null;
    }
  }
  if (pending) commands.push(pending);
  return commands;
}

function runtimeRange(name: string): string {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, RUNTIME_PACKAGE_JSON), "utf8"),
  ) as {
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
  const range =
    manifest.dependencies?.[name] ?? manifest.peerDependencies?.[name];
  if (!range) {
    throw new Error(`${RUNTIME_PACKAGE_JSON} does not declare ${name}`);
  }
  return range;
}

test("docs install @ag-ui/client and @ag-ui/core at a version the runtime accepts", () => {
  const expected = Object.fromEntries(
    PINNED_PACKAGES.map((name) => [name, runtimeRange(name)]),
  );

  const violations: string[] = [];
  for (const file of listMarkdownFiles(CONTENT_ROOT)) {
    const source = fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
    for (const { line: lineNumber, text: line } of shellCommands(source)) {
      if (
        !INSTALL_COMMAND.test(line) ||
        AGENT_SIDE_INSTALL.test(line) ||
        VERSIONED_RUNTIME_INSTALL.test(line)
      ) {
        continue;
      }
      for (const name of PINNED_PACKAGES) {
        const spec = new RegExp(`${name}(?:@(\\S+))?(?=\\s|$)`, "g");
        for (const match of line.matchAll(spec)) {
          const version = match[1];
          if (
            !version ||
            !VERSION.test(version) ||
            !satisfies(version, expected[name])
          ) {
            violations.push(
              `${file}:${lineNumber} installs ${match[0]}, expected an exact ${name} version in "${expected[name]}"`,
            );
          }
        }
      }
    }
  }

  expect(violations).toEqual([]);
});
