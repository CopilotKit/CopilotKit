// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { resolveNpmSource } from "../../../scripts/compatibility-audit/sources/npm";
import type {
  LibraryMapping,
  SavedFileReader,
} from "../../../scripts/compatibility-audit/types";

const name = "@example/framework";
const manifestPath = "showcase/integrations/example/package.json";
const lockPath = "showcase/integrations/example/package-lock.json";

function mapping(withLock = true): LibraryMapping {
  return {
    name,
    registry: "npm",
    role: "framework",
    required: true,
    reason: "Framework library",
    source: {
      kind: "npm",
      path: manifestPath,
      ...(withLock ? { lockPath } : {}),
    },
    releasePolicy: "stable",
  };
}

function manifest(declaration = "^1.2.0") {
  return { name: "example-agent", dependencies: { [name]: declaration } };
}

function lock(declaration = "^1.2.0", version = "1.2.3") {
  return {
    name: "example-agent",
    lockfileVersion: 3,
    packages: {
      "": manifest(declaration),
      [`node_modules/${name}`]: { version },
    } as Record<string, Record<string, unknown>>,
  };
}

function saved(packageJson: unknown, packageLock?: unknown) {
  const files = new Map([[manifestPath, JSON.stringify(packageJson)]]);
  if (packageLock !== undefined)
    files.set(lockPath, JSON.stringify(packageLock));
  return vi.fn<SavedFileReader>((path) => {
    const content = files.get(path);
    if (content === undefined) throw new Error(`Missing saved file: ${path}`);
    return content;
  });
}

describe("resolveNpmSource", () => {
  it.each([2, 3])(
    "resolves a scoped root package in lockfile v%i",
    (version) => {
      const packageLock = { ...lock(), lockfileVersion: version };
      const read = saved(manifest(), packageLock);

      expect(resolveNpmSource(mapping(), read)).toMatchObject({
        version: "1.2.3",
        basis: "source-lock",
        evidence: [manifestPath, lockPath],
      });
      expect(read.mock.calls.map(([path]) => path)).toEqual([
        manifestPath,
        lockPath,
      ]);
    },
  );

  it("ignores a nested duplicate when the associated root package exists", () => {
    const packageLock = lock();
    packageLock.packages[`node_modules/parent/node_modules/${name}`] = {
      version: "9.0.0",
    };

    expect(
      resolveNpmSource(mapping(), saved(manifest(), packageLock)),
    ).toMatchObject({ version: "1.2.3", basis: "source-lock" });
  });

  it("does not search nested copies when the root package is missing", () => {
    const packageLock = lock();
    delete packageLock.packages[`node_modules/${name}`];
    packageLock.packages[`node_modules/parent/node_modules/${name}`] = {
      version: "1.2.3",
    };

    expect(
      resolveNpmSource(mapping(), saved(manifest(), packageLock)),
    ).toMatchObject({ version: null, basis: "unknown" });
  });

  it("rejects a root declaration that no longer matches the manifest", () => {
    expect(
      resolveNpmSource(mapping(), saved(manifest("^2.0.0"), lock())),
    ).toMatchObject({ version: null, basis: "unknown" });
  });

  it("rejects a locked version conflicting with an exact manifest pin", () => {
    expect(
      resolveNpmSource(
        mapping(),
        saved(manifest("1.2.3"), lock("1.2.3", "1.2.4")),
      ),
    ).toMatchObject({ version: null, basis: "unknown" });
  });

  it.each([
    ["^1.2.0", "1.9.9+build.42"],
    ["~1.2.0", "1.2.9"],
    [">=1.2.0 <2.0.0", "1.8.0"],
    ["^1.2.0 || ^2.0.0", "2.4.0"],
    ["1.2.0 - 1.4.0", "1.4.0"],
    ["1.x", "1.9.0"],
    ["^1.3.0-rc.1", "1.3.0-rc.2"],
    ["1.2.3+build.42", "1.2.3+build.42"],
  ])(
    "accepts a recorded %s resolution of %s without rewriting it",
    (declaration, version) => {
      expect(
        resolveNpmSource(
          mapping(),
          saved(manifest(declaration), lock(declaration, version)),
        ),
      ).toMatchObject({ version, basis: "source-lock" });
    },
  );

  it.each([
    ["^1.2.0", "9.0.0"],
    ["~1.2.0", "1.3.0"],
    [">=1.2.0 <2.0.0", "2.0.0"],
    ["^1.2.0 || ^2.0.0", "3.0.0"],
    ["1.2.0 - 1.4.0", "1.4.1"],
    ["^0.2.3", "0.3.0"],
    ["^1.2.0", "1.3.0-rc.1"],
    [">=1.0.0", "2.0.0-rc.1"],
  ])(
    "rejects recorded version %s / %s when the declared range excludes it",
    (declaration, version) => {
      const fact = resolveNpmSource(
        mapping(),
        saved(manifest(declaration), lock(declaration, version)),
      );
      expect(fact).toMatchObject({ version: null, basis: "unknown" });
      expect(fact.reason).toMatch(/range/);
    },
  );

  it.each(["^invalid", ">>1.2.3", "1.2.3 || not a range"])(
    "rejects malformed range %s instead of treating it as a dist-tag",
    (declaration) => {
      expect(
        resolveNpmSource(
          mapping(),
          saved(manifest(declaration), lock(declaration)),
        ),
      ).toMatchObject({ version: null, basis: "unknown" });
    },
  );

  it.each(["latest", "next", "canary-build", "legacy_tag"])(
    "preserves the associated lock fact for mutable dist-tag %s",
    (declaration) => {
      const read = saved(manifest(declaration), lock(declaration, "9.0.0"));
      expect(resolveNpmSource(mapping(), read)).toMatchObject({
        version: "9.0.0",
        basis: "source-lock",
        evidence: [manifestPath, lockPath],
      });
      expect(read.mock.calls.map(([path]) => path)).toEqual([
        manifestPath,
        lockPath,
      ]);
      expect(
        resolveNpmSource(mapping(false), saved(manifest(declaration))),
      ).toMatchObject({ version: null, basis: "unknown" });
    },
  );

  it("still requires matching root declarations for a dist-tag", () => {
    expect(
      resolveNpmSource(mapping(), saved(manifest("latest"), lock("next"))),
    ).toMatchObject({ version: null, basis: "unknown" });
  });

  it("rejects an unrelated root project even when dependency specs match", () => {
    expect(
      resolveNpmSource(
        mapping(),
        saved(manifest(), { ...lock(), name: "other-agent" }),
      ),
    ).toMatchObject({ version: null, basis: "unknown" });
  });

  it.each([1, 4, "3", undefined])(
    "does not fall back around unsupported lockfile version %s",
    (lockfileVersion) => {
      expect(
        resolveNpmSource(
          mapping(),
          saved(manifest("1.2.3"), {
            ...lock("1.2.3"),
            lockfileVersion,
          }),
        ),
      ).toMatchObject({ version: null, basis: "unknown" });
    },
  );

  it.each(["^1.2.3", "latest", "1.2", "01.2.3", "1.2.3-01", "1.2.3\n"])(
    "rejects an inexact or invalid locked version %s",
    (version) => {
      expect(
        resolveNpmSource(mapping(), saved(manifest(), lock("^1.2.0", version))),
      ).toMatchObject({ version: null, basis: "unknown" });
    },
  );

  it.each([
    { version: "1.2.3", link: true },
    { version: "1.2.3", name: "different-package" },
  ])("rejects links and alias package identities", (entry) => {
    const packageLock = lock();
    packageLock.packages[`node_modules/${name}`] = entry;

    expect(
      resolveNpmSource(mapping(), saved(manifest(), packageLock)),
    ).toMatchObject({ version: null, basis: "unknown" });
  });

  it("rejects conflicting declarations across dependency groups", () => {
    const packageJson = {
      ...manifest("1.2.3"),
      optionalDependencies: { [name]: "2.0.0" },
    };
    expect(resolveNpmSource(mapping(false), saved(packageJson))).toMatchObject({
      version: null,
      basis: "unknown",
    });
  });

  it("rejects a dependency-group change between manifest and lock", () => {
    const packageLock = lock();
    packageLock.packages[""] = { devDependencies: { [name]: "^1.2.0" } };

    expect(
      resolveNpmSource(mapping(), saved(manifest(), packageLock)),
    ).toMatchObject({ version: null, basis: "unknown" });
  });

  it.each(["1.2.3", "1.2.3-rc.1+build.42"])(
    "uses an exact literal %s only as source-declared without a mapped lock",
    (version) => {
      const read = saved(manifest(version));
      expect(resolveNpmSource(mapping(false), read)).toMatchObject({
        version,
        basis: "source-declared",
        evidence: [manifestPath],
      });
      expect(read).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["^1.2.0", "~1.2.0", ">=1.2.0", "*", "latest", "v1.2.3", "=1.2.3"])(
    "leaves declaration %s unresolved without a lock",
    (declaration) => {
      expect(
        resolveNpmSource(mapping(false), saved(manifest(declaration))),
      ).toMatchObject({ version: null, basis: "unknown" });
    },
  );

  it.each([
    "npm:other-package@1.2.3",
    "file:../local",
    "org/repo",
    "workspace:*",
  ])(
    "does not treat a non-registry declaration %s as a registry library",
    (declaration) => {
      expect(
        resolveNpmSource(
          mapping(),
          saved(manifest(declaration), lock(declaration)),
        ),
      ).toMatchObject({ version: null, basis: "unknown" });
    },
  );

  it("keeps absent and malformed declarations unknown", () => {
    for (const packageJson of [{}, [], { dependencies: { [name]: 123 } }]) {
      expect(
        resolveNpmSource(mapping(false), saved(packageJson)),
      ).toMatchObject({ version: null, basis: "unknown" });
    }
    expect(
      resolveNpmSource(mapping(false), () => "{ invalid JSON"),
    ).toMatchObject({ version: null, basis: "unknown" });
  });

  it("propagates missing captured files instead of using local files or fallback", () => {
    expect(() => resolveNpmSource(mapping(), saved(manifest("1.2.3")))).toThrow(
      "Missing saved file",
    );
  });
});
