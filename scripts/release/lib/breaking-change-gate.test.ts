import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PUBLIC_API_MANIFEST_PATH,
  evaluateBreakingChangeGate,
  findPublicApiBreaks,
  isReleaseLineBranch,
} from "./breaking-change-gate";
import type { PublicApiManifest } from "./public-api-manifest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function committedManifest(): PublicApiManifest {
  return JSON.parse(
    readFileSync(resolve(root, PUBLIC_API_MANIFEST_PATH), "utf8"),
  ) as PublicApiManifest;
}

function gate(
  overrides: Partial<Parameters<typeof evaluateBreakingChangeGate>[0]>,
) {
  return evaluateBreakingChangeGate({
    title: "fix(react-core): keep focus after send",
    body: "",
    commitMessages: [],
    changedFiles: ["packages/react-core/src/index.ts"],
    apiBreaks: [],
    ...overrides,
  });
}

describe("isReleaseLineBranch", () => {
  it("matches X.Y.Z branches only", () => {
    expect(isReleaseLineBranch("2.0.0")).toBe(true);
    expect(isReleaseLineBranch("10.12.3")).toBe(true);
    expect(isReleaseLineBranch("main")).toBe(false);
    expect(isReleaseLineBranch("2.0.0-rc")).toBe(false);
    expect(isReleaseLineBranch("release/2.0.0")).toBe(false);
  });
});

describe("findPublicApiBreaks", () => {
  it("reports nothing for an unchanged manifest", () => {
    expect(
      findPublicApiBreaks(committedManifest(), committedManifest()),
    ).toEqual([]);
  });

  it("ignores additions, versions, and provenance", () => {
    const base = committedManifest();
    const head = committedManifest();
    head.packages[0].version = "9.9.9";
    head.packages[0].provenance.version.path = "elsewhere/package.json";
    head.packages.push({
      ...structuredClone(base.packages[0]),
      name: "@copilotkit/new",
    });
    head.runtime.serviceAdapters[0].configurationKeys.push("newOption");

    expect(findPublicApiBreaks(base, head)).toEqual([]);
  });

  it("reports a package that is no longer published", () => {
    const base = committedManifest();
    const head = committedManifest();
    const [removed] = head.packages.splice(0, 1);

    expect(findPublicApiBreaks(base, head)).toEqual([
      `\`${removed.name}\` is no longer published`,
    ]);
  });

  it("reports a removed entrypoint and a removed export condition", () => {
    const base = committedManifest();
    const head = committedManifest();
    const pkg = head.packages.find((candidate) =>
      candidate.entrypoints.some(
        (entry) =>
          entry.exportKey === "." &&
          typeof entry.conditions === "object" &&
          entry.conditions !== null &&
          "require" in entry.conditions,
      ),
    )!;
    const rootEntry = pkg.entrypoints.find((entry) => entry.exportKey === ".")!;
    delete (rootEntry.conditions as Record<string, unknown>).require;
    const [removed] = pkg.entrypoints.splice(
      pkg.entrypoints.findIndex((entry) => entry.exportKey !== "."),
      1,
    );

    const breaks = findPublicApiBreaks(base, head);
    expect(breaks).toContain(`\`${removed.importPath}\` was removed`);
    expect(breaks).toContain(
      `\`${rootEntry.importPath}\` lost the \`require.default\` export condition`,
    );
  });

  it("reports narrowed compatibility", () => {
    const base = committedManifest();
    const head = committedManifest();
    const basePkg = base.packages[0];
    const pkg = head.packages[0];
    pkg.compatibility.engines = { node: ">=24" };
    pkg.compatibility.peerDependencies = {
      ...pkg.compatibility.peerDependencies,
      "left-pad": "^1",
    };
    const [peer, range] = Object.entries(
      basePkg.compatibility.peerDependencies ?? {},
    )[0];
    pkg.compatibility.peerDependencies![peer] = `${String(range)} || ^99`;

    expect(findPublicApiBreaks(base, head)).toEqual([
      `\`${pkg.name}\` engine \`node\` changed from \`${String(basePkg.compatibility.engines?.node ?? "none")}\` to \`>=24\``,
      `\`${pkg.name}\` peer \`${peer}\` changed from \`${String(range)}\` to \`${String(range)} || ^99\``,
      `\`${pkg.name}\` gained the required peer \`left-pad\``,
    ]);
  });

  it("reports a peer that is no longer optional", () => {
    const base = committedManifest();
    const head = committedManifest();
    const index = base.packages.findIndex(
      (pkg) => (pkg.compatibility.optionalPeerDependencies ?? []).length > 0,
    );
    const pkg = head.packages[index];
    const [peer] = pkg.compatibility.optionalPeerDependencies!.splice(0, 1);

    expect(findPublicApiBreaks(base, head)).toEqual([
      `\`${pkg.name}\` peer \`${peer}\` is no longer optional`,
    ]);
  });

  it("reports removed runtime factories, options, and deprecated exports", () => {
    const base = committedManifest();
    const head = committedManifest();
    const [adapter] = head.runtime.serviceAdapters.splice(0, 1);
    const factory = head.runtime.hostFactories[0];
    const [option] = factory.configurationKeys.splice(0, 1);
    const [deprecated] = head.deprecations.splice(0, 1);

    expect(findPublicApiBreaks(base, head)).toEqual([
      `Service adapter \`${adapter.symbol}\` from \`${adapter.importPath}\` was removed`,
      `Host factory \`${factory.symbol}\` from \`${factory.importPath}\` lost the \`${option}\` option`,
      `Deprecated \`${deprecated.symbol}\` from \`${deprecated.importPath}\` was removed`,
    ]);
  });
});

describe("evaluateBreakingChangeGate", () => {
  it("passes a PR that breaks nothing", () => {
    expect(gate({}).reasons).toEqual([]);
  });

  it("flags a `!` in the PR title", () => {
    expect(
      gate({ title: "feat(react-core)!: drop useCopilotAction" }).reasons,
    ).toEqual(["The PR title or description marks a breaking change."]);
  });

  it("flags a BREAKING CHANGE footer in the description", () => {
    expect(
      gate({
        body: "Removes the v1 hooks.\n\nBREAKING CHANGE: useCoAgent is gone",
      }).reasons,
    ).toEqual(["The PR title or description marks a breaking change."]);
  });

  it("flags breaking branch commits by subject or footer", () => {
    const { reasons } = gate({
      commitMessages: [
        "refactor(runtime)!: remove the GraphQL endpoint",
        "chore: tidy\n\nBREAKING-CHANGE: the cors option is gone",
        "fix: unrelated",
      ],
    });

    expect(reasons).toEqual([
      "Commit `refactor(runtime)!: remove the GraphQL endpoint` marks a breaking change.",
      "Commit `chore: tidy` marks a breaking change.",
    ]);
  });

  it("flags public API breaks even without a marker", () => {
    expect(
      gate({ apiBreaks: ["`@copilotkit/react-ui` is no longer published"] })
        .reasons,
    ).toEqual(["Public API: `@copilotkit/react-ui` is no longer published."]);
  });

  it("accepts a codemod or a migration-guide change as the migration path", () => {
    const changedFiles = [
      "packages/react-core/src/index.ts",
      "codemods/v2-migration/scripts/codemod.ts",
      "showcase/shell-docs/src/content/docs/migrate/v2.mdx",
      "showcase/shell-docs/src/content/docs/reference/hooks/useAgent.mdx",
    ];

    expect(gate({ title: "feat!: x", changedFiles }).migrationFiles).toEqual([
      "codemods/v2-migration/scripts/codemod.ts",
      "showcase/shell-docs/src/content/docs/migrate/v2.mdx",
    ]);
  });
});
