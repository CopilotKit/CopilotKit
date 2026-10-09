import { describe, expect, it } from "vitest";
import {
  CHANNELS_INTELLIGENCE,
  createRuntimeConsumerManifest,
  RUNTIME,
  workspaceDependencyClosure,
} from "../lib/pack-workspace.js";
import type { SourceManifest } from "../lib/pack-workspace.js";

/**
 * A release PR mid-flight: every first-party version is bumped past what the
 * registry has (channels 0.3.0 vs. published 0.2.1), and the monorepo packages
 * are wired together with `workspace:` ranges that `pnpm pack` rewrites into
 * those unpublished versions.
 */
const RELEASE_PR_WORKSPACE: Record<string, SourceManifest> = {
  [RUNTIME]: {
    dependencies: {
      "@copilotkit/channels-core": "workspace:^",
      [CHANNELS_INTELLIGENCE]: "workspace:*",
      "@copilotkit/shared": "workspace:*",
      // Published, externally versioned — must not be packed locally.
      "@copilotkit/license-verifier": "~0.5.0",
      express: "^4.21.2",
    },
    peerDependencies: { openai: ">=5.0.0" },
  },
  "@copilotkit/channels-core": {
    dependencies: {
      "@copilotkit/channels-ui": "workspace:~",
      "@copilotkit/core": "workspace:^",
      "@copilotkit/shared": "workspace:^",
    },
  },
  [CHANNELS_INTELLIGENCE]: {
    dependencies: {
      "@copilotkit/channels-core": "workspace:^",
      "@copilotkit/channels-ui": "workspace:^",
    },
  },
  "@copilotkit/channels-ui": {
    dependencies: { "@copilotkit/shared": "workspace:^" },
  },
  "@copilotkit/core": {
    dependencies: { "@copilotkit/shared": "workspace:*" },
  },
  "@copilotkit/shared": {
    dependencies: { "@copilotkit/license-verifier": "~0.5.0" },
  },
};

function readManifest(name: string): SourceManifest {
  const manifest = RELEASE_PR_WORKSPACE[name];
  if (!manifest) throw new Error(`unexpected package read: ${name}`);
  return manifest;
}

const closure = () => workspaceDependencyClosure([RUNTIME], readManifest);

describe("workspaceDependencyClosure", () => {
  it("reaches every transitive workspace dependency of the runtime", () => {
    expect([...closure()].sort()).toEqual([
      "@copilotkit/channels-core",
      CHANNELS_INTELLIGENCE,
      "@copilotkit/channels-ui",
      "@copilotkit/core",
      "@copilotkit/shared",
    ]);
  });

  it("excludes the roots and every non-workspace dependency", () => {
    const found = closure();
    expect(found).not.toContain(RUNTIME);
    // Registry-versioned first-party and third-party deps resolve normally.
    expect(found).not.toContain("@copilotkit/license-verifier");
    expect(found).not.toContain("express");
    expect(found).not.toContain("openai");
  });

  it("terminates on cyclic workspace graphs", () => {
    const cyclic: Record<string, SourceManifest> = {
      a: { dependencies: { "@copilotkit/b": "workspace:*" } },
      "@copilotkit/b": { dependencies: { "@copilotkit/c": "workspace:*" } },
      "@copilotkit/c": { dependencies: { "@copilotkit/b": "workspace:*" } },
    };
    expect(workspaceDependencyClosure(["a"], (name) => cyclic[name])).toEqual([
      "@copilotkit/b",
      "@copilotkit/c",
    ]);
  });
});

describe("createRuntimeConsumerManifest", () => {
  const overrides = new Map(
    closure().map((name) => [
      name,
      `/tmp/tarballs/${name.replace("@copilotkit/", "copilotkit-")}-0.3.0.tgz`,
    ]),
  );

  const manifest = createRuntimeConsumerManifest({
    runtimeTarball: "/tmp/tarballs/copilotkit-runtime-1.63.2.tgz",
    packageManager: "pnpm@10.33.4",
    overrides,
  }) as {
    dependencies: Record<string, string>;
    pnpm?: { overrides: Record<string, string> };
  };

  it("installs the runtime from its local tarball", () => {
    expect(manifest.dependencies[RUNTIME]).toBe(
      "file:/tmp/tarballs/copilotkit-runtime-1.63.2.tgz",
    );
  });

  it("pins the unpublished channels version to a local tarball", () => {
    // Without this the install resolves `@copilotkit/channels-intelligence@0.3.0`
    // from npm, where this release has not published it yet.
    expect(manifest.pnpm?.overrides[CHANNELS_INTELLIGENCE]).toBe(
      `file:${overrides.get(CHANNELS_INTELLIGENCE)}`,
    );
  });

  it("leaves no workspace dependency resolvable from the registry", () => {
    const pinned = manifest.pnpm?.overrides ?? {};
    for (const name of closure()) {
      expect(pinned[name], `${name} is not pinned locally`).toMatch(/^file:/);
    }
  });

  it("omits the overrides block when nothing needs pinning", () => {
    expect(
      createRuntimeConsumerManifest({
        runtimeTarball: "/tmp/tarballs/copilotkit-runtime-1.63.2.tgz",
        packageManager: "pnpm@10.33.4",
        overrides: new Map(),
      }),
    ).not.toHaveProperty("pnpm");
  });
});
