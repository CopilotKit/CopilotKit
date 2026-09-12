import { describe, expect, it } from "vitest";
import {
  crossScopeEdges,
  findExactCrossScopePins,
  findSupersededPublishedPins,
} from "./cross-scope-pins.js";
import type { PublishedManifest, ScopedManifest } from "./cross-scope-pins.js";
import type { ReleaseConfig } from "./config.js";

/**
 * `@copilotkit/angular` is released on its own version line and pinned
 * `@copilotkit/core` at an exact version, so the four days between
 * `angular@0.4.0` and `angular@0.5.0` resolved two copies of core in every
 * Angular journey obeying the dependency floor (OSS-1107). These cover the two
 * halves that stop it: no exact pin may cross a scope boundary, and no scope
 * may publish a version the other scopes' published ranges have stopped
 * admitting.
 */

const CONFIG: ReleaseConfig = {
  prereleaseTag: "canary",
  scopes: {
    angular: {
      packages: ["@copilotkit/angular"],
      sharedVersion: false,
      versionSource: "@copilotkit/angular",
    },
    channels: {
      packages: ["@copilotkit/channels-core", "@copilotkit/channels"],
      sharedVersion: true,
      versionSource: "@copilotkit/channels",
    },
    monorepo: {
      packages: ["@copilotkit/core", "@copilotkit/runtime"],
      sharedVersion: true,
      versionSource: "@copilotkit/core",
    },
  },
};

/** A workspace manifest reduced to what the check reads. */
function manifest(
  name: string,
  dependencies: Record<string, string> = {},
  extra: Partial<ScopedManifest> = {},
): ScopedManifest {
  return { dependencies, name, version: "1.0.0", ...extra };
}

/** What one package declares on the registry, keyed by dependency field. */
function published(
  fields: Partial<Record<string, Record<string, string>>>,
): PublishedManifest {
  return fields as PublishedManifest;
}

describe("crossScopeEdges", () => {
  it("reports a runtime dependency that crosses a scope boundary", () => {
    const edges = crossScopeEdges(
      [
        manifest("@copilotkit/angular", { "@copilotkit/core": "workspace:^" }),
        manifest("@copilotkit/core"),
      ],
      CONFIG,
    );

    expect(edges).toEqual([
      {
        dependency: "@copilotkit/core",
        dependencyScope: "monorepo",
        field: "dependencies",
        package: "@copilotkit/angular",
        packageScope: "angular",
        range: "workspace:^",
      },
    ]);
  });

  it("ignores a dependency inside the same scope", () => {
    // Same-scope packages share a version and publish together, so an exact pin
    // between them can never point at a version that is not being released.
    expect(
      crossScopeEdges(
        [
          manifest("@copilotkit/runtime", {
            "@copilotkit/core": "workspace:*",
          }),
          manifest("@copilotkit/core"),
        ],
        CONFIG,
      ),
    ).toEqual([]);
  });

  it("ignores devDependencies, which are never published", () => {
    expect(
      crossScopeEdges(
        [
          manifest(
            "@copilotkit/runtime",
            {},
            { devDependencies: { "@copilotkit/channels": "workspace:*" } },
          ),
        ],
        CONFIG,
      ),
    ).toEqual([]);
  });

  it("reads peerDependencies, which a consumer does have to satisfy", () => {
    expect(
      crossScopeEdges(
        [
          manifest(
            "@copilotkit/angular",
            {},
            { peerDependencies: { "@copilotkit/core": "workspace:^" } },
          ),
        ],
        CONFIG,
      ).map((edge) => edge.field),
    ).toEqual(["peerDependencies"]);
  });

  it("ignores a package that no release scope publishes", () => {
    expect(
      crossScopeEdges(
        [manifest("@copilotkit/demo", { "@copilotkit/core": "workspace:*" })],
        CONFIG,
      ),
    ).toEqual([]);
  });
});

describe("findExactCrossScopePins", () => {
  it("names an exact cross-scope pin, which is what OSS-1107 shipped", () => {
    const problems = findExactCrossScopePins(
      [
        manifest("@copilotkit/angular", { "@copilotkit/core": "workspace:*" }),
        manifest("@copilotkit/core"),
      ],
      CONFIG,
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("@copilotkit/angular");
    expect(problems[0]).toContain("@copilotkit/core");
    expect(problems[0]).toContain("workspace:^");
  });

  it("accepts a range that a later release of the other scope satisfies", () => {
    expect(
      findExactCrossScopePins(
        [
          manifest("@copilotkit/angular", {
            "@copilotkit/core": "workspace:^",
          }),
          manifest("@copilotkit/core"),
        ],
        CONFIG,
      ),
    ).toEqual([]);
  });

  it("rejects a hand-written exact version as well as workspace:*", () => {
    // `pnpm pack` rewrites `workspace:*` into an exact version, so the two are
    // the same defect written differently.
    expect(
      findExactCrossScopePins(
        [
          manifest("@copilotkit/angular", { "@copilotkit/core": "1.69.3" }),
          manifest("@copilotkit/core"),
        ],
        CONFIG,
      ),
    ).toHaveLength(1);
  });
});

describe("findSupersededPublishedPins", () => {
  it("refuses the release that broke every Angular journey", () => {
    // The real sequence: `angular@0.4.0` published pinning `1.69.3`, then the
    // monorepo scope released `1.70.0` without republishing Angular.
    const problems = findSupersededPublishedPins({
      config: CONFIG,
      publishedDependencies: {
        "@copilotkit/angular": {
          dependencies: { "@copilotkit/core": "1.69.3" },
        },
      },
      scope: "monorepo",
      version: "1.70.0",
      workspace: [
        manifest("@copilotkit/angular", { "@copilotkit/core": "workspace:*" }),
        manifest("@copilotkit/core"),
      ],
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("@copilotkit/angular");
    expect(problems[0]).toContain("1.69.3");
    expect(problems[0]).toContain("1.70.0");
    expect(problems[0]).toContain("Release scope angular first");
  });

  it("allows a minor release the published range still admits", () => {
    expect(
      findSupersededPublishedPins({
        config: CONFIG,
        publishedDependencies: {
          "@copilotkit/angular": {
            dependencies: { "@copilotkit/core": "^1.70.0" },
          },
        },
        scope: "monorepo",
        version: "1.71.0",
        workspace: [
          manifest("@copilotkit/angular", {
            "@copilotkit/core": "workspace:^",
          }),
          manifest("@copilotkit/core"),
        ],
      }),
    ).toEqual([]);
  });

  it("refuses a major release no published caret range admits", () => {
    expect(
      findSupersededPublishedPins({
        config: CONFIG,
        publishedDependencies: {
          "@copilotkit/angular": {
            dependencies: { "@copilotkit/core": "^1.70.0" },
          },
        },
        scope: "monorepo",
        version: "2.0.0",
        workspace: [
          manifest("@copilotkit/angular", {
            "@copilotkit/core": "workspace:^",
          }),
          manifest("@copilotkit/core"),
        ],
      }),
    ).toHaveLength(1);
  });

  it("says nothing about a package that is not published yet", () => {
    expect(
      findSupersededPublishedPins({
        config: CONFIG,
        publishedDependencies: {},
        scope: "monorepo",
        version: "1.70.0",
        workspace: [
          manifest("@copilotkit/angular", {
            "@copilotkit/core": "workspace:*",
          }),
          manifest("@copilotkit/core"),
        ],
      }),
    ).toEqual([]);
  });

  it("ignores a dependent inside the scope being released", () => {
    // Same-scope packages are republished by this very run, so their published
    // pins are about to be replaced.
    expect(
      findSupersededPublishedPins({
        config: CONFIG,
        publishedDependencies: {
          "@copilotkit/runtime": {
            dependencies: { "@copilotkit/core": "1.69.3" },
          },
        },
        scope: "monorepo",
        version: "1.70.0",
        workspace: [
          manifest("@copilotkit/runtime", {
            "@copilotkit/core": "workspace:*",
          }),
          manifest("@copilotkit/core"),
        ],
      }),
    ).toEqual([]);
  });

  it("reads the published range rather than the workspace one", () => {
    // The workspace already carries the fix; the registry still carries the
    // exact pin the last release baked in. Only the second one can break an
    // install today.
    expect(
      findSupersededPublishedPins({
        config: CONFIG,
        publishedDependencies: {
          "@copilotkit/angular": {
            dependencies: { "@copilotkit/core": "1.69.3" },
          },
        },
        scope: "monorepo",
        version: "1.70.0",
        workspace: [
          manifest("@copilotkit/angular", {
            "@copilotkit/core": "workspace:^",
          }),
          manifest("@copilotkit/core"),
        ],
      }),
    ).toHaveLength(1);
  });
});

describe("exact-pin classification by semver semantics", () => {
  /** One workspace where angular declares core with the given range. */
  function angularDeclaring(range: string): readonly ScopedManifest[] {
    return [
      manifest("@copilotkit/angular", { "@copilotkit/core": range }),
      manifest("@copilotkit/core"),
    ];
  }

  it.each([
    ["workspace:*", "packs as the exact version in the tree"],
    ["1.69.3", "the literal OSS-1107 shipped"],
    ["=1.69.3", "the same pin, spelled with an operator"],
    ["1.69.3+build.7", "build metadata does not widen a range"],
    ["1.69.3 - 1.69.3", "a range that admits exactly one version"],
  ])('rejects "%s", which %s', (range) => {
    expect(
      findExactCrossScopePins(angularDeclaring(range), CONFIG),
    ).toHaveLength(1);
  });

  it.each([
    ["workspace:^", "packs as a caret range"],
    ["workspace:~", "packs as a tilde range"],
    ["workspace:^1.70.0", "packs as the caret range it carries"],
    ["workspace:~1.70.0", "packs as the tilde range it carries"],
    ["workspace:>=1.70.0", "packs as the floor it carries"],
    [">=1.70.0", "admits every later release"],
    ["^1.70.0", "admits every later minor"],
    ["1.x", "admits every later 1.x"],
  ])('accepts "%s", which %s', (range) => {
    expect(findExactCrossScopePins(angularDeclaring(range), CONFIG)).toEqual(
      [],
    );
  });

  it("leaves a non-semver protocol alone, which is not this rule's business", () => {
    expect(
      findExactCrossScopePins(angularDeclaring("file:../core"), CONFIG),
    ).toEqual([]);
  });
});

describe("optionalDependencies", () => {
  it("reads an optional cross-scope dependency, which npm still resolves", () => {
    // npm installs an optional dependency unless the consumer opts out, so an
    // exact one splits the installed graph like any other.
    const edges = crossScopeEdges(
      [
        manifest(
          "@copilotkit/angular",
          {},
          { optionalDependencies: { "@copilotkit/core": "workspace:*" } },
        ),
        manifest("@copilotkit/core"),
      ],
      CONFIG,
    );

    expect(edges).toHaveLength(1);
    expect(edges[0]?.field).toBe("optionalDependencies");
  });

  it("rejects an exact optional cross-scope pin", () => {
    expect(
      findExactCrossScopePins(
        [
          manifest(
            "@copilotkit/angular",
            {},
            { optionalDependencies: { "@copilotkit/core": "1.69.3" } },
          ),
          manifest("@copilotkit/core"),
        ],
        CONFIG,
      ),
    ).toHaveLength(1);
  });

  it("refuses a release a published optional range has stopped admitting", () => {
    expect(
      findSupersededPublishedPins({
        config: CONFIG,
        publishedDependencies: {
          "@copilotkit/angular": published({
            optionalDependencies: { "@copilotkit/core": "1.69.3" },
          }),
        },
        scope: "monorepo",
        version: "1.70.0",
        workspace: [
          manifest(
            "@copilotkit/angular",
            {},
            { optionalDependencies: { "@copilotkit/core": "workspace:^" } },
          ),
          manifest("@copilotkit/core"),
        ],
      }),
    ).toHaveLength(1);
  });
});

describe("published peer and optional ranges reach the registry check", () => {
  it("refuses a release a published peer range has stopped admitting", () => {
    // The edge is declared as a peer dependency. Reading only the published
    // `dependencies` map skipped it and let the release through.
    const problems = findSupersededPublishedPins({
      config: CONFIG,
      publishedDependencies: {
        "@copilotkit/angular": published({
          peerDependencies: { "@copilotkit/core": "1.69.3" },
        }),
      },
      scope: "monorepo",
      version: "1.70.0",
      workspace: [
        manifest(
          "@copilotkit/angular",
          {},
          { peerDependencies: { "@copilotkit/core": "workspace:^" } },
        ),
        manifest("@copilotkit/core"),
      ],
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("peerDependencies");
  });
});

describe("published edges the workspace no longer declares", () => {
  it("refuses a release stranded by a dependency dropped from the tree", () => {
    // The cross-scope dependency was deleted from the workspace before the
    // angular scope republished. The published manifest still carries the old
    // range, and every consumer still resolves it, so the gate has to see it.
    const problems = findSupersededPublishedPins({
      config: CONFIG,
      publishedDependencies: {
        "@copilotkit/angular": published({
          dependencies: { "@copilotkit/core": "1.69.3" },
        }),
      },
      scope: "monorepo",
      version: "1.70.0",
      workspace: [
        // No `@copilotkit/core` entry at all any more.
        manifest("@copilotkit/angular"),
        manifest("@copilotkit/core"),
      ],
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("@copilotkit/angular");
    expect(problems[0]).toContain("no longer declares");
  });

  it("ignores a published dependency that no release scope publishes", () => {
    expect(
      findSupersededPublishedPins({
        config: CONFIG,
        publishedDependencies: {
          "@copilotkit/angular": published({
            dependencies: { react: "18.0.0" },
          }),
        },
        scope: "monorepo",
        version: "1.70.0",
        workspace: [
          manifest("@copilotkit/angular"),
          manifest("@copilotkit/core"),
        ],
      }),
    ).toEqual([]);
  });
});
