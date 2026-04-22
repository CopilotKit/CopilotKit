import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  pnpmPackagesDiscoverySource,
  type PnpmPackageRecord,
} from "./pnpm-packages.js";
import {
  DiscoverySourceNotFoundError,
  DiscoverySourceSchemaError,
} from "./errors.js";
import { logger } from "../../logger.js";

/**
 * Fixture harness: each test builds a fresh temp-dir workspace with
 * pnpm-workspace.yaml + a handful of packages. Deliberately NOT using a
 * shared fixture tree because every test exercises a different schema
 * shape — the cost of a few mkdir calls is far less than the cost of
 * reading a fixture tree to understand what a test is asserting.
 */

const BASE_CTX = {
  fetchImpl: globalThis.fetch, // unused by this source, satisfies interface
  logger,
  env: {},
};

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pnpm-packages-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function writeFile(rel: string, content: string): Promise<void> {
  const abs = path.join(tmpDir, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content);
}

describe("pnpmPackagesDiscoverySource", () => {
  it("discovers 3 npm packages + 1 python package", async () => {
    await writeFile(
      "pnpm-workspace.yaml",
      `packages:\n  - "packages/*"\n  - "sdk-python"\n`,
    );
    await writeFile(
      "packages/runtime/package.json",
      JSON.stringify({ name: "@copilotkit/runtime", version: "1.2.0" }),
    );
    await writeFile(
      "packages/core/package.json",
      JSON.stringify({ name: "@copilotkit/core", version: "0.9.5" }),
    );
    await writeFile(
      "packages/react-ui/package.json",
      JSON.stringify({ name: "@copilotkit/react-ui", version: "1.0.0" }),
    );
    await writeFile(
      "sdk-python/pyproject.toml",
      `[tool.poetry]\nname = "copilotkit"\nversion = "0.8.1"\n`,
    );

    const records = await pnpmPackagesDiscoverySource.enumerate(BASE_CTX, {
      rootDir: tmpDir,
    });

    const npm = records.filter((r) => r.ecosystem === "npm");
    const pypi = records.filter((r) => r.ecosystem === "pypi");
    expect(npm).toHaveLength(3);
    expect(pypi).toHaveLength(1);

    const runtime = records.find((r) => r.name === "@copilotkit/runtime");
    expect(runtime).toMatchObject<Partial<PnpmPackageRecord>>({
      name: "@copilotkit/runtime",
      pinnedVersion: "1.2.0",
      ecosystem: "npm",
      path: "packages/runtime",
    });

    const py = records.find((r) => r.ecosystem === "pypi");
    expect(py).toMatchObject<Partial<PnpmPackageRecord>>({
      name: "copilotkit",
      pinnedVersion: "0.8.1",
      ecosystem: "pypi",
      path: "sdk-python",
    });
  });

  it("supports PEP 621 [project] tables in addition to Poetry's [tool.poetry]", async () => {
    await writeFile("pnpm-workspace.yaml", `packages:\n  - "svc"\n`);
    await writeFile(
      "svc/pyproject.toml",
      `[project]\nname = "my-svc"\nversion = "2.0.0"\n`,
    );
    const records = await pnpmPackagesDiscoverySource.enumerate(BASE_CTX, {
      rootDir: tmpDir,
    });
    expect(records).toEqual([
      {
        name: "my-svc",
        pinnedVersion: "2.0.0",
        ecosystem: "pypi",
        path: "svc",
      },
    ]);
  });

  it("filter by ecosystem='npm' drops pypi records", async () => {
    await writeFile(
      "pnpm-workspace.yaml",
      `packages:\n  - "packages/*"\n  - "py-pkg"\n`,
    );
    await writeFile(
      "packages/a/package.json",
      JSON.stringify({ name: "a", version: "1.0.0" }),
    );
    await writeFile(
      "py-pkg/pyproject.toml",
      `[project]\nname = "p"\nversion = "0.1.0"\n`,
    );

    const records = await pnpmPackagesDiscoverySource.enumerate(BASE_CTX, {
      rootDir: tmpDir,
      ecosystem: "npm",
    });
    expect(records).toHaveLength(1);
    expect(records[0]?.ecosystem).toBe("npm");
  });

  it("filter by ecosystem='pypi' drops npm records", async () => {
    await writeFile(
      "pnpm-workspace.yaml",
      `packages:\n  - "packages/*"\n  - "py-pkg"\n`,
    );
    await writeFile(
      "packages/a/package.json",
      JSON.stringify({ name: "a", version: "1.0.0" }),
    );
    await writeFile(
      "py-pkg/pyproject.toml",
      `[project]\nname = "p"\nversion = "0.1.0"\n`,
    );
    const records = await pnpmPackagesDiscoverySource.enumerate(BASE_CTX, {
      rootDir: tmpDir,
      ecosystem: "pypi",
    });
    expect(records).toHaveLength(1);
    expect(records[0]?.ecosystem).toBe("pypi");
  });

  it("filter by pathPrefix narrows to a subtree", async () => {
    await writeFile(
      "pnpm-workspace.yaml",
      `packages:\n  - "packages/*"\n  - "showcase/*"\n`,
    );
    await writeFile(
      "packages/a/package.json",
      JSON.stringify({ name: "a", version: "1.0.0" }),
    );
    await writeFile(
      "packages/b/package.json",
      JSON.stringify({ name: "b", version: "1.0.0" }),
    );
    await writeFile(
      "showcase/ops/package.json",
      JSON.stringify({ name: "ops", version: "1.0.0" }),
    );
    const records = await pnpmPackagesDiscoverySource.enumerate(BASE_CTX, {
      rootDir: tmpDir,
      pathPrefix: "packages/",
    });
    expect(records.map((r) => r.name).sort()).toEqual(["a", "b"]);
  });

  it("honors leading-`!` negation patterns", async () => {
    await writeFile(
      "pnpm-workspace.yaml",
      `packages:\n  - "examples/v1/*"\n  - "!examples/v1/_legacy"\n`,
    );
    await writeFile(
      "examples/v1/keep/package.json",
      JSON.stringify({ name: "keep", version: "1.0.0" }),
    );
    await writeFile(
      "examples/v1/_legacy/package.json",
      JSON.stringify({ name: "legacy", version: "1.0.0" }),
    );
    const records = await pnpmPackagesDiscoverySource.enumerate(BASE_CTX, {
      rootDir: tmpDir,
    });
    expect(records.map((r) => r.name)).toEqual(["keep"]);
  });

  it("supports literal (non-glob) workspace entries", async () => {
    await writeFile("pnpm-workspace.yaml", `packages:\n  - "showcase/ops"\n`);
    await writeFile(
      "showcase/ops/package.json",
      JSON.stringify({ name: "@x/ops", version: "0.1.0" }),
    );
    const records = await pnpmPackagesDiscoverySource.enumerate(BASE_CTX, {
      rootDir: tmpDir,
    });
    expect(records).toHaveLength(1);
    expect(records[0]?.path).toBe("showcase/ops");
  });

  it("skips directories matched by a glob but lacking any manifest", async () => {
    await writeFile("pnpm-workspace.yaml", `packages:\n  - "packages/*"\n`);
    await fs.mkdir(path.join(tmpDir, "packages/empty"), { recursive: true });
    await writeFile(
      "packages/a/package.json",
      JSON.stringify({ name: "a", version: "1.0.0" }),
    );
    const records = await pnpmPackagesDiscoverySource.enumerate(BASE_CTX, {
      rootDir: tmpDir,
    });
    expect(records.map((r) => r.name)).toEqual(["a"]);
  });

  it("missing pnpm-workspace.yaml throws DiscoverySourceNotFoundError", async () => {
    await expect(
      pnpmPackagesDiscoverySource.enumerate(BASE_CTX, { rootDir: tmpDir }),
    ).rejects.toBeInstanceOf(DiscoverySourceNotFoundError);
  });

  it("malformed workspace YAML throws DiscoverySourceSchemaError", async () => {
    // Indented-after-scalar is the one thing js-yaml consistently rejects
    // as a parse failure rather than silently massaging into a string.
    await writeFile(
      "pnpm-workspace.yaml",
      `foo: bar\n  baz: bad\ninvalid: [\n`,
    );
    await expect(
      pnpmPackagesDiscoverySource.enumerate(BASE_CTX, { rootDir: tmpDir }),
    ).rejects.toBeInstanceOf(DiscoverySourceSchemaError);
  });

  it("workspace YAML without a `packages:` array throws SchemaError", async () => {
    await writeFile("pnpm-workspace.yaml", `otherKey: value\n`);
    await expect(
      pnpmPackagesDiscoverySource.enumerate(BASE_CTX, { rootDir: tmpDir }),
    ).rejects.toBeInstanceOf(DiscoverySourceSchemaError);
  });

  it("workspace YAML with non-string packages entries throws SchemaError", async () => {
    await writeFile("pnpm-workspace.yaml", `packages:\n  - 42\n`);
    await expect(
      pnpmPackagesDiscoverySource.enumerate(BASE_CTX, { rootDir: tmpDir }),
    ).rejects.toBeInstanceOf(DiscoverySourceSchemaError);
  });

  it("workspace YAML parsed as a list (no packages key) throws SchemaError", async () => {
    await writeFile("pnpm-workspace.yaml", `- just a list\n- of strings\n`);
    await expect(
      pnpmPackagesDiscoverySource.enumerate(BASE_CTX, { rootDir: tmpDir }),
    ).rejects.toBeInstanceOf(DiscoverySourceSchemaError);
  });

  it("workspace YAML parsed as a scalar (non-object) throws SchemaError", async () => {
    // js-yaml loads `just-a-string` as a plain string, tripping the
    // !parsed || typeof !== "object" guard. Exercises the "is not an
    // object" branch distinct from the "missing packages array" branch.
    await writeFile("pnpm-workspace.yaml", `just-a-string\n`);
    await expect(
      pnpmPackagesDiscoverySource.enumerate(BASE_CTX, { rootDir: tmpDir }),
    ).rejects.toBeInstanceOf(DiscoverySourceSchemaError);
  });

  it("empty workspace YAML (null after parse) throws SchemaError", async () => {
    await writeFile("pnpm-workspace.yaml", `\n`);
    await expect(
      pnpmPackagesDiscoverySource.enumerate(BASE_CTX, { rootDir: tmpDir }),
    ).rejects.toBeInstanceOf(DiscoverySourceSchemaError);
  });

  it("malformed package.json throws SchemaError carrying the offending file path", async () => {
    await writeFile("pnpm-workspace.yaml", `packages:\n  - "packages/*"\n`);
    await writeFile("packages/bad/package.json", `{ not: json }`);
    try {
      await pnpmPackagesDiscoverySource.enumerate(BASE_CTX, {
        rootDir: tmpDir,
      });
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(DiscoverySourceSchemaError);
      const e = err as DiscoverySourceSchemaError;
      expect(e.filePath).toContain("packages/bad/package.json");
      expect(e.message).toContain("packages/bad/package.json");
    }
  });

  it("package.json missing `name` throws SchemaError", async () => {
    await writeFile("pnpm-workspace.yaml", `packages:\n  - "packages/*"\n`);
    await writeFile(
      "packages/x/package.json",
      JSON.stringify({ version: "1.0.0" }),
    );
    await expect(
      pnpmPackagesDiscoverySource.enumerate(BASE_CTX, { rootDir: tmpDir }),
    ).rejects.toBeInstanceOf(DiscoverySourceSchemaError);
  });

  it("package.json missing `version` throws SchemaError", async () => {
    await writeFile("pnpm-workspace.yaml", `packages:\n  - "packages/*"\n`);
    await writeFile("packages/x/package.json", JSON.stringify({ name: "x" }));
    await expect(
      pnpmPackagesDiscoverySource.enumerate(BASE_CTX, { rootDir: tmpDir }),
    ).rejects.toBeInstanceOf(DiscoverySourceSchemaError);
  });

  it("package.json that parses as a non-object throws SchemaError", async () => {
    await writeFile("pnpm-workspace.yaml", `packages:\n  - "packages/*"\n`);
    await writeFile("packages/x/package.json", `"just a string"`);
    await expect(
      pnpmPackagesDiscoverySource.enumerate(BASE_CTX, { rootDir: tmpDir }),
    ).rejects.toBeInstanceOf(DiscoverySourceSchemaError);
  });

  it("pyproject.toml missing name throws SchemaError", async () => {
    await writeFile("pnpm-workspace.yaml", `packages:\n  - "py"\n`);
    await writeFile("py/pyproject.toml", `[project]\nversion = "1.0.0"\n`);
    await expect(
      pnpmPackagesDiscoverySource.enumerate(BASE_CTX, { rootDir: tmpDir }),
    ).rejects.toBeInstanceOf(DiscoverySourceSchemaError);
  });

  it("pyproject.toml missing version throws SchemaError", async () => {
    await writeFile("pnpm-workspace.yaml", `packages:\n  - "py"\n`);
    await writeFile("py/pyproject.toml", `[project]\nname = "p"\n`);
    await expect(
      pnpmPackagesDiscoverySource.enumerate(BASE_CTX, { rootDir: tmpDir }),
    ).rejects.toBeInstanceOf(DiscoverySourceSchemaError);
  });

  it("unknown filter keys rejected by Zod at parse time", async () => {
    await writeFile("pnpm-workspace.yaml", `packages: []\n`);
    await expect(
      pnpmPackagesDiscoverySource.enumerate(BASE_CTX, {
        rootDir: tmpDir,
        bogusKey: "nope",
      } as unknown),
    ).rejects.toThrow(); // Zod ZodError
  });

  it("exposes name 'pnpm-packages' and a configSchema", () => {
    expect(pnpmPackagesDiscoverySource.name).toBe("pnpm-packages");
    expect(pnpmPackagesDiscoverySource.configSchema).toBeDefined();
  });

  it("directory with BOTH package.json and pyproject.toml emits two records", async () => {
    await writeFile("pnpm-workspace.yaml", `packages:\n  - "poly"\n`);
    await writeFile(
      "poly/package.json",
      JSON.stringify({ name: "poly-js", version: "1.0.0" }),
    );
    await writeFile(
      "poly/pyproject.toml",
      `[project]\nname = "poly-py"\nversion = "0.1.0"\n`,
    );
    const records = await pnpmPackagesDiscoverySource.enumerate(BASE_CTX, {
      rootDir: tmpDir,
    });
    expect(records.map((r) => r.name).sort()).toEqual(["poly-js", "poly-py"]);
  });

  it("unsupported glob pattern (non-trailing `*`) throws SchemaError", async () => {
    // Our matcher intentionally supports only literals + trailing `*`.
    // Middle-of-string wildcards should surface as a load-time error
    // rather than silently under-enumerating.
    await writeFile(
      "pnpm-workspace.yaml",
      `packages:\n  - "packages/*/apps"\n`,
    );
    await writeFile(
      "packages/x/apps/package.json",
      JSON.stringify({ name: "x-app", version: "1.0.0" }),
    );
    await expect(
      pnpmPackagesDiscoverySource.enumerate(BASE_CTX, { rootDir: tmpDir }),
    ).rejects.toBeInstanceOf(DiscoverySourceSchemaError);
  });

  it("skips non-directory entries inside a globbed prefix", async () => {
    await writeFile("pnpm-workspace.yaml", `packages:\n  - "packages/*"\n`);
    await writeFile(
      "packages/a/package.json",
      JSON.stringify({ name: "a", version: "1.0.0" }),
    );
    // plain file directly under packages/ must be ignored, not treated
    // as a candidate package directory.
    await writeFile("packages/readme.txt", "not a package");
    const records = await pnpmPackagesDiscoverySource.enumerate(BASE_CTX, {
      rootDir: tmpDir,
    });
    expect(records.map((r) => r.name)).toEqual(["a"]);
  });

  it("skips hidden (dot-prefixed) directories under a glob", async () => {
    await writeFile("pnpm-workspace.yaml", `packages:\n  - "packages/*"\n`);
    await writeFile(
      "packages/a/package.json",
      JSON.stringify({ name: "a", version: "1.0.0" }),
    );
    await writeFile(
      "packages/.cache/package.json",
      JSON.stringify({ name: "cache", version: "1.0.0" }),
    );
    const records = await pnpmPackagesDiscoverySource.enumerate(BASE_CTX, {
      rootDir: tmpDir,
    });
    expect(records.map((r) => r.name)).toEqual(["a"]);
  });

  it("returns empty list when a literal workspace entry resolves to a missing dir", async () => {
    // Workspace lists a literal that doesn't exist — enumerate survives
    // and the other entries still emit. Exercises matchPattern's
    // ENOENT swallow on the literal-path branch.
    await writeFile(
      "pnpm-workspace.yaml",
      `packages:\n  - "no/such/dir"\n  - "real"\n`,
    );
    await writeFile(
      "real/package.json",
      JSON.stringify({ name: "real", version: "1.0.0" }),
    );
    const records = await pnpmPackagesDiscoverySource.enumerate(BASE_CTX, {
      rootDir: tmpDir,
    });
    expect(records.map((r) => r.name)).toEqual(["real"]);
  });

  it("returns empty list when a literal workspace entry points to a plain file", async () => {
    await writeFile(
      "pnpm-workspace.yaml",
      `packages:\n  - "afile"\n  - "real"\n`,
    );
    await writeFile("afile", "not a directory");
    await writeFile(
      "real/package.json",
      JSON.stringify({ name: "real", version: "1.0.0" }),
    );
    const records = await pnpmPackagesDiscoverySource.enumerate(BASE_CTX, {
      rootDir: tmpDir,
    });
    expect(records.map((r) => r.name)).toEqual(["real"]);
  });

  it("returns empty list when a globbed prefix directory doesn't exist", async () => {
    // `packages/*` under a rootDir with no `packages` dir at all —
    // readdir ENOENTs and the matcher returns []. Exercises the empty
    // branch of the glob path.
    await writeFile("pnpm-workspace.yaml", `packages:\n  - "nowhere/*"\n`);
    const records = await pnpmPackagesDiscoverySource.enumerate(BASE_CTX, {
      rootDir: tmpDir,
    });
    expect(records).toEqual([]);
  });

  it("defaults to process.cwd() when rootDir is omitted", async () => {
    // Set cwd into the temp dir so the default resolves there. Restored
    // in afterEach by the cleanup of tmpDir; cwd itself is reset below.
    const origCwd = process.cwd();
    try {
      process.chdir(tmpDir);
      await writeFile("pnpm-workspace.yaml", `packages:\n  - "x"\n`);
      await writeFile(
        "x/package.json",
        JSON.stringify({ name: "cwd-pkg", version: "0.0.1" }),
      );
      const records = await pnpmPackagesDiscoverySource.enumerate(BASE_CTX, {});
      expect(records.map((r) => r.name)).toEqual(["cwd-pkg"]);
    } finally {
      process.chdir(origCwd);
    }
  });
});
