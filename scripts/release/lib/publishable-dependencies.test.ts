import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import type { ReleaseScope } from "./config.js";
import {
  buildScopeIndex,
  collectCopilotKitDependencyEdges,
  collectCrossScopeReleaseRequirements,
  findCrossScopeDependencyEdges,
  findMultiplyEnrolledPackages,
  findUnenrolledPublishablePackages,
  findUnpublishableDependencyEdges,
  findUnsatisfiedCrossScopeRequirements,
  formatUnsatisfiedCrossScopeRequirements,
  loadWorkspacePackages,
} from "./publishable-dependencies.js";
import type {
  CopilotKitDependencyEdge,
  WorkspacePackage,
} from "./publishable-dependencies.js";

const workspacePackages = loadWorkspacePackages();
const scopeIndex = buildScopeIndex();
const edges = collectCopilotKitDependencyEdges(workspacePackages, scopeIndex);

function describeEdge(edge: CopilotKitDependencyEdge): string {
  return `${edge.dependent} [${edge.dependentScope}] ${edge.field} -> ${edge.dependency} "${edge.range}"`;
}

/**
 * The regression guard for the `@copilotkit/intelligence` P0: `@copilotkit/runtime`
 * shipped `"@copilotkit/intelligence": "workspace:^"` in `dependencies` while no
 * release scope could publish that package, so every `npm install
 * @copilotkit/runtime` after the next monorepo release would have failed with
 * `404 Not Found - GET https://registry.npmjs.org/@copilotkit%2fintelligence`.
 *
 * Nothing checked this: verify-runtime-package.ts packs the whole workspace
 * dependency closure into local tarballs and installs from disk (so it never
 * consults the registry), and verify-release-scope-dropdowns.sh only compares
 * scope NAMES against the workflow dropdowns.
 */
describe("release scope enrollment", () => {
  it("enrolls every publishable packages/* package in a release scope", () => {
    const unenrolled = findUnenrolledPublishablePackages(
      workspacePackages,
      scopeIndex,
    );
    expect(
      unenrolled.map(
        (violation) => `${violation.name} (${violation.directory})`,
      ),
    ).toEqual([]);
  });

  it("never enrolls a package in more than one scope", () => {
    const multiple = findMultiplyEnrolledPackages(
      workspacePackages,
      scopeIndex,
    );
    expect(
      multiple.map(
        (violation) => `${violation.name} -> ${violation.scopes.join(", ")}`,
      ),
    ).toEqual([]);
  });

  it("only enumerates existing packages/* packages in each scope", () => {
    const known = new Set(workspacePackages.map((pkg) => pkg.name));
    const missing = [...scopeIndex.keys()].filter((name) => !known.has(name));
    expect(missing).toEqual([]);
  });
});

describe("publishable @copilotkit dependencies", () => {
  it("resolves every @copilotkit dependency of a scoped package to a publisher", () => {
    const unpublishable = findUnpublishableDependencyEdges(edges);
    expect(unpublishable.map(describeEdge)).toEqual([]);
  });

  it("covers the runtime's Intelligence dependency", () => {
    const runtimeEdge = edges.find(
      (edge) =>
        edge.dependent === "@copilotkit/runtime" &&
        edge.dependency === "@copilotkit/intelligence",
    );
    expect(runtimeEdge).toMatchObject({
      field: "dependencies",
      dependentScope: "monorepo",
      dependencyScope: "intelligence",
    });
  });

  it("covers the LangGraph adapter's Intelligence peer dependency", () => {
    const peerEdge = edges.find(
      (edge) =>
        edge.dependent === "@copilotkit/intelligence-langgraph" &&
        edge.dependency === "@copilotkit/intelligence",
    );
    expect(peerEdge).toMatchObject({
      field: "peerDependencies",
      dependencyScope: "intelligence",
    });
  });

  it("treats registry-only @copilotkit packages as already published", () => {
    // @copilotkit/license-verifier is not a workspace member; it is an ordinary
    // registry dependency pinned by a plain semver range.
    const external = edges.filter(
      (edge) => edge.dependency === "@copilotkit/license-verifier",
    );
    expect(external.length).toBeGreaterThan(0);
    for (const edge of external) {
      expect(edge.workspaceVersion).toBeNull();
      expect(edge.range.startsWith("workspace:")).toBe(false);
    }
    expect(findUnpublishableDependencyEdges(external)).toEqual([]);
  });
});

/**
 * Cross-scope edges carry a publish-ORDER hazard: independently versioned
 * scopes ship on their own cadence, so the depended-on scope must already be on
 * npm at the version pnpm's `workspace:` rewrite will name. This inventory
 * makes new cross-scope edges visible at review time instead of at install time.
 */
describe("cross-scope dependency inventory", () => {
  it("matches the reviewed set of cross-scope edges", () => {
    const inventory = findCrossScopeDependencyEdges(edges)
      .map(
        (edge) =>
          `${edge.dependentScope}:${edge.dependent} -> ${edge.dependencyScope}:${edge.dependency}`,
      )
      .sort();

    expect(inventory).toEqual([
      "angular:@copilotkit/angular -> monorepo:@copilotkit/a2ui-renderer",
      "angular:@copilotkit/angular -> monorepo:@copilotkit/core",
      "angular:@copilotkit/angular -> monorepo:@copilotkit/shared",
      "angular:@copilotkit/angular -> monorepo:@copilotkit/web-components",
      "channels:@copilotkit/channels-core -> monorepo:@copilotkit/core",
      "channels:@copilotkit/channels-core -> monorepo:@copilotkit/shared",
      "channels:@copilotkit/channels-slack -> monorepo:@copilotkit/core",
      "channels:@copilotkit/channels-slack -> monorepo:@copilotkit/shared",
      "channels:@copilotkit/channels-teams -> monorepo:@copilotkit/core",
      "channels:@copilotkit/channels-teams -> monorepo:@copilotkit/shared",
      "channels:@copilotkit/channels-ui -> monorepo:@copilotkit/shared",
      "intelligence-langgraph:@copilotkit/intelligence-langgraph -> intelligence:@copilotkit/intelligence",
      "monorepo:@copilotkit/runtime -> channels:@copilotkit/channels-core",
      "monorepo:@copilotkit/runtime -> channels:@copilotkit/channels-intelligence",
      "monorepo:@copilotkit/runtime -> intelligence:@copilotkit/intelligence",
    ]);
  });

  it("requires the intelligence scope on npm before a monorepo release", () => {
    const requirements = collectCrossScopeReleaseRequirements(
      "monorepo",
      edges,
    );
    expect(requirements.map((requirement) => requirement.dependency)).toContain(
      "@copilotkit/intelligence",
    );
    const intelligence = requirements.find(
      (requirement) => requirement.dependency === "@copilotkit/intelligence",
    );
    expect(intelligence).toMatchObject({
      dependencyScope: "intelligence",
      dependents: ["@copilotkit/runtime"],
    });
  });

  it("derives one requirement per scope declared in release.config.json", () => {
    for (const scope of Object.keys(loadConfig().scopes) as ReleaseScope[]) {
      // No scope may require itself, and every requirement must name a real
      // workspace version.
      for (const requirement of collectCrossScopeReleaseRequirements(
        scope,
        edges,
      )) {
        expect(requirement.dependencyScope).not.toBe(scope);
        expect(requirement.requiredVersion).toMatch(/^\d+\.\d+\.\d+/);
      }
    }
  });
});

function fixture(overrides: Partial<WorkspacePackage>): WorkspacePackage {
  return {
    name: "@copilotkit/example",
    directory: "packages/example",
    version: "1.0.0",
    isPrivate: false,
    dependencies: {},
    peerDependencies: {},
    ...overrides,
  };
}

describe("publishability primitives", () => {
  const fixturePackages: WorkspacePackage[] = [
    fixture({
      name: "@copilotkit/dependent",
      directory: "packages/dependent",
      version: "2.0.0",
      dependencies: {
        "@copilotkit/same-scope": "workspace:*",
        "@copilotkit/other-scope": "workspace:^",
        "@copilotkit/orphan": "workspace:^",
        "@copilotkit/registry-only": "~0.5.0",
        rxjs: "7.8.1",
      },
      peerDependencies: { "@copilotkit/orphan-peer": ">=0.1.0 <1.0.0" },
    }),
    fixture({
      name: "@copilotkit/same-scope",
      directory: "packages/same-scope",
      version: "2.0.0",
    }),
    fixture({
      name: "@copilotkit/other-scope",
      directory: "packages/other-scope",
      version: "0.3.1",
    }),
    fixture({
      name: "@copilotkit/orphan",
      directory: "packages/orphan",
      version: "0.1.0",
    }),
    fixture({
      name: "@copilotkit/orphan-peer",
      directory: "packages/orphan-peer",
      version: "0.1.0",
    }),
    fixture({
      name: "@copilotkit/internal",
      directory: "packages/internal",
      isPrivate: true,
    }),
  ];

  const fixtureIndex = new Map<string, ReleaseScope[]>([
    ["@copilotkit/dependent", ["monorepo"]],
    ["@copilotkit/same-scope", ["monorepo"]],
    ["@copilotkit/other-scope", ["channels"]],
  ]);
  const fixtureEdges = collectCopilotKitDependencyEdges(
    fixturePackages,
    fixtureIndex,
  );

  it("flags unenrolled publishable packages and ignores private ones", () => {
    expect(
      findUnenrolledPublishablePackages(fixturePackages, fixtureIndex).map(
        (violation) => violation.name,
      ),
    ).toEqual(["@copilotkit/orphan", "@copilotkit/orphan-peer"]);
  });

  it("flags packages enrolled in two scopes", () => {
    const doubled = new Map(fixtureIndex);
    doubled.set("@copilotkit/same-scope", ["monorepo", "channels"]);
    expect(
      findMultiplyEnrolledPackages(fixturePackages, doubled).map(
        (violation) => `${violation.name}:${violation.scopes.join("+")}`,
      ),
    ).toEqual(["@copilotkit/same-scope:monorepo+channels"]);
  });

  it("skips devDependencies and non-@copilotkit dependencies", () => {
    expect(
      fixtureEdges.every((edge) => edge.dependency.startsWith("@copilotkit/")),
    ).toBe(true);
    expect(fixtureEdges.map((edge) => edge.dependency)).not.toContain("rxjs");
  });

  it("reports both dependency and peerDependency orphans as unpublishable", () => {
    expect(
      findUnpublishableDependencyEdges(fixtureEdges).map(describeEdge),
    ).toEqual([
      '@copilotkit/dependent [monorepo] dependencies -> @copilotkit/orphan "workspace:^"',
      '@copilotkit/dependent [monorepo] peerDependencies -> @copilotkit/orphan-peer ">=0.1.0 <1.0.0"',
    ]);
  });

  it("does not flag a registry-only @copilotkit dependency", () => {
    const registryOnly = fixtureEdges.filter(
      (edge) => edge.dependency === "@copilotkit/registry-only",
    );
    expect(registryOnly).toHaveLength(1);
    expect(findUnpublishableDependencyEdges(registryOnly)).toEqual([]);
  });

  it("flags a workspace: range on a package outside packages/", () => {
    const [phantom] = collectCopilotKitDependencyEdges(
      [
        fixture({
          name: "@copilotkit/dependent",
          dependencies: { "@copilotkit/phantom": "workspace:*" },
        }),
      ],
      new Map([["@copilotkit/dependent", ["monorepo"]]]),
    );
    expect(phantom.workspaceVersion).toBeNull();
    expect(findUnpublishableDependencyEdges([phantom])).toHaveLength(1);
  });

  it("requires the cross-scope dependency's exact workspace version", () => {
    expect(
      collectCrossScopeReleaseRequirements("monorepo", fixtureEdges),
    ).toEqual([
      {
        dependency: "@copilotkit/other-scope",
        dependencyScope: "channels",
        requiredVersion: "0.3.1",
        dependents: ["@copilotkit/dependent"],
      },
    ]);
  });

  it("ignores same-scope, peer, and plain-range edges when collecting requirements", () => {
    const requirements = collectCrossScopeReleaseRequirements(
      "monorepo",
      fixtureEdges,
    );
    expect(requirements.map((requirement) => requirement.dependency)).toEqual([
      "@copilotkit/other-scope",
    ]);
  });

  it("groups multiple dependents of one cross-scope dependency", () => {
    const packages = [
      ...fixturePackages,
      fixture({
        name: "@copilotkit/second",
        directory: "packages/second",
        dependencies: { "@copilotkit/other-scope": "workspace:*" },
      }),
    ];
    const index = new Map(fixtureIndex);
    index.set("@copilotkit/second", ["monorepo"]);
    const requirements = collectCrossScopeReleaseRequirements(
      "monorepo",
      collectCopilotKitDependencyEdges(packages, index),
    );
    expect(requirements).toHaveLength(1);
    expect(requirements[0].dependents).toEqual([
      "@copilotkit/dependent",
      "@copilotkit/second",
    ]);
  });

  it("treats a missing registry entry as unsatisfied", () => {
    const requirements = collectCrossScopeReleaseRequirements(
      "monorepo",
      fixtureEdges,
    );
    expect(
      findUnsatisfiedCrossScopeRequirements(requirements, new Map()),
    ).toEqual(requirements);
  });

  it("treats a published-but-different version as unsatisfied", () => {
    const requirements = collectCrossScopeReleaseRequirements(
      "monorepo",
      fixtureEdges,
    );
    expect(
      findUnsatisfiedCrossScopeRequirements(
        requirements,
        new Map([["@copilotkit/other-scope", ["0.3.0", "0.4.0"]]]),
      ),
    ).toEqual(requirements);
  });

  it("passes once the exact version is on the registry", () => {
    const requirements = collectCrossScopeReleaseRequirements(
      "monorepo",
      fixtureEdges,
    );
    expect(
      findUnsatisfiedCrossScopeRequirements(
        requirements,
        new Map([["@copilotkit/other-scope", ["0.3.0", "0.3.1"]]]),
      ),
    ).toEqual([]);
  });

  it("explains the failure and the remedy", () => {
    const message = formatUnsatisfiedCrossScopeRequirements("monorepo", [
      {
        dependency: "@copilotkit/intelligence",
        dependencyScope: "intelligence",
        requiredVersion: "0.1.0",
        dependents: ["@copilotkit/runtime"],
      },
    ]);
    expect(message).toContain('Refusing to publish scope "monorepo"');
    expect(message).toContain("@copilotkit/intelligence@0.1.0");
    expect(message).toContain('scope "intelligence"');
    expect(message).toContain("@copilotkit/runtime");
    expect(message).toContain("Release the scope(s) listed above first");
  });
});
