#!/usr/bin/env node
/**
 * Static check: no published `@copilotkit/channels*` package may declare a
 * `zod` range that a consumer installs.
 *
 * WHY THIS EXISTS (PE-30, OSS-1173)
 * ---------------------------------
 * A `zod` range in a channels package is not a local decision. The
 * `@copilotkit/channels` umbrella depends on every platform adapter at an
 * exact version, and `@copilotkit/runtime` depends on
 * `@copilotkit/channels-intelligence`. A range declared in one adapter
 * therefore lands in the dependency tree of applications that never install
 * that adapter on purpose.
 *
 * `@microsoft/agents-hosting` and `@microsoft/agents-activity` pin `zod` at
 * exactly `3.25.75`, and every published version of them does. An adapter
 * asking for `^3.25.76` is a range that excludes that pin. Both constraints
 * then come from packages we publish, so nothing an application declares in
 * its own package.json can collapse them. That is not a duplicate-install
 * annoyance — it is an install a developer cannot repair.
 *
 * It has happened twice:
 *
 *   OSS-1173  `channels-slack` and `channels-teams` each declared
 *             `zod: ^3.25.76`. Slack used it for exactly one object literal;
 *             Teams imported it zero times. Fixed in `1913f80b94`.
 *
 *   PE-30     `channels-discord` and `channels-telegram` still declared the
 *             same range, so the conflict returned through the umbrella
 *             package. A `copilotkit onboard` run stopped at the dependency
 *             install step and left the runtime unwired.
 *
 * Both were visible in a committed manifest with no network access, so this
 * check is static and runs on every pull request.
 *
 * RULE
 * ----
 *   channels-zod-range   A `packages/channels*` package.json declares `zod`
 *                        in `dependencies`, `peerDependencies` or
 *                        `optionalDependencies`. Those are the three fields a
 *                        consumer's resolver acts on.
 *
 *                        `devDependencies` is fine and deliberately not
 *                        checked: consumers do not install them, and several
 *                        of these packages test against Zod on purpose.
 *
 * DELIBERATELY NOT CHECKED
 * ------------------------
 * A transitive zod range, for example the `zod` peer that
 * `zod-to-json-schema` declares and that `channels-core` therefore pulls in.
 * Today that peer is `^3.25.28 || ^4`, which admits `3.25.75` and so cannot
 * produce the conflict. Catching a future tightening of it needs a resolver
 * that compares every declared range against every exact pin in the tree,
 * which is a different and much larger check. The dynamic half that would
 * detect it is a clean install of the umbrella plus the Microsoft packages.
 *
 * To build a channel tool parameter without Zod, use
 * `singleStringParameterSchema` from `@copilotkit/channels-core`, or write
 * the Standard Schema object directly — `defineChannelTool` never required
 * Zod, only a `~standard` implementation.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/** The dependency fields a consumer's package manager resolves. */
export const CHECKED_FIELDS = [
  "dependencies",
  "peerDependencies",
  "optionalDependencies",
];

const RULE = "channels-zod-range";

/**
 * Find every `packages/channels*` directory that ships a package.json.
 * Sorted so output is stable between runs.
 */
export function channelsPackageDirs(packagesDir) {
  if (!fs.existsSync(packagesDir)) return [];
  return fs
    .readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("channels"))
    .map((entry) => path.join(packagesDir, entry.name))
    .filter((dir) => fs.existsSync(path.join(dir, "package.json")))
    .sort();
}

/**
 * Return one violation per (package, field) that declares `zod`.
 *
 * Pure apart from reading the manifests, so the test drives it with fixture
 * directories as well as with the real `packages/` tree.
 */
export function validateChannelsZod(packagesDir) {
  const violations = [];

  for (const dir of channelsPackageDirs(packagesDir)) {
    const manifestPath = path.join(dir, "package.json");
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch (error) {
      violations.push({
        package: path.basename(dir),
        manifest: manifestPath,
        rule: "unreadable-manifest",
        field: null,
        range: null,
        detail: `package.json could not be parsed: ${error.message}`,
        fix: "Repair the JSON.",
      });
      continue;
    }

    const name = manifest.name ?? path.basename(dir);
    // A package that is not published cannot put a range in a consumer's
    // tree, so it is exempt. This is the same reason devDependencies are.
    if (manifest.private === true) continue;

    for (const field of CHECKED_FIELDS) {
      const range = manifest[field]?.zod;
      if (range === undefined) continue;
      violations.push({
        package: name,
        manifest: manifestPath,
        rule: RULE,
        field,
        range,
        detail:
          `${field}.zod = "${range}" ships to every consumer of this package. ` +
          "A range here can exclude the exact zod version " +
          "@microsoft/agents-hosting and @microsoft/agents-activity pin " +
          "(3.25.75), which leaves an install no application can repair.",
        fix:
          "Drop the declaration. Build tool parameters with " +
          "`singleStringParameterSchema` from @copilotkit/channels-core, or " +
          "write the Standard Schema object directly. If zod is only needed " +
          "by tests, move it to devDependencies.",
      });
    }
  }

  return violations;
}

/** Render violations the way the CI annotation format wants them. */
export function formatViolations(violations) {
  const lines = [];
  for (const v of violations) {
    lines.push(
      `::error file=${v.manifest}::${v.package} declares a zod range in ${v.field ?? "package.json"}`,
    );
    lines.push(`  package:  ${v.package}`);
    lines.push(`  manifest: ${v.manifest}`);
    lines.push(
      `  rule:     ${v.rule}${v.field ? ` (${v.field}.zod = "${v.range}")` : ""}`,
    );
    lines.push(`  problem:  ${v.detail}`);
    lines.push(`  fix:      ${v.fix}`);
    lines.push("");
  }
  return lines.join("\n");
}

function main() {
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const packagesDir = path.join(repoRoot, "packages");
  const checked = channelsPackageDirs(packagesDir);

  if (checked.length === 0) {
    console.error(
      `::error::no packages/channels* directories found under ${packagesDir}`,
    );
    return 1;
  }

  const violations = validateChannelsZod(packagesDir);

  if (violations.length === 0) {
    console.log(
      `Channels zod declarations OK — ${checked.length} channels packages, none declares a zod range.`,
    );
    return 0;
  }

  console.error("");
  console.error("Channels zod declaration check FAILED.");
  console.error("");
  console.error(formatViolations(violations));
  console.error(
    "See scripts/validate-channels-zod.mjs for why this rule exists (PE-30, OSS-1173).",
  );
  return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
