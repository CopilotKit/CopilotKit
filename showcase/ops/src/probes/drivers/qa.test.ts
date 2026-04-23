import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { qaDriver, createQaDriver } from "./qa.js";
import { logger } from "../../logger.js";
import type {
  ProbeContext,
  ProbeResult,
  ProbeResultWriter,
} from "../../types/index.js";

// Driver-level tests for the QA ProbeDriver. The driver reads
// `showcase/packages/<slug>/manifest.yaml` to get the demos list and checks
// `showcase/packages/<slug>/qa/<feature>.md` for each demo. Green per-feature
// rows are emitted for demos that have a qa file; red for those missing.
// Aggregate (primary return) is green iff every demo has a qa file.
//
// Fixture layout uses real tmp dirs (mkdtempSync) so the driver's real
// fs.readFileSync / fs.existsSync paths are exercised end-to-end; this also
// matches the pattern used by pin-drift.test.ts for filesystem fixtures.

function mkWriter(): {
  writer: ProbeResultWriter;
  writes: ProbeResult<unknown>[];
} {
  const writes: ProbeResult<unknown>[] = [];
  const writer: ProbeResultWriter = {
    async write(result) {
      writes.push(result);
      return undefined;
    },
  };
  return { writer, writes };
}

function mkCtx(
  writer?: ProbeResultWriter,
  env: Record<string, string | undefined> = {},
): ProbeContext {
  return {
    now: () => new Date("2026-04-23T00:00:00Z"),
    logger,
    env,
    writer,
  };
}

interface FixtureOpts {
  slug: string;
  features: string[];
  qaFilesFor: string[];
  // When true, the `qa/` directory itself is not created.
  omitQaDir?: boolean;
  // When non-null, overrides manifest demos layout (pass raw YAML body).
  manifestBody?: string;
}

/**
 * Build a throwaway repo-root with `showcase/packages/<slug>/manifest.yaml`
 * and optionally some `qa/<feature>.md` files. Returns the repo root so
 * tests can point the driver at it via the QA_REPO_ROOT env var.
 */
function makeRepoFixture(opts: FixtureOpts): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qa-driver-"));
  const pkgDir = path.join(root, "showcase", "packages", opts.slug);
  fs.mkdirSync(pkgDir, { recursive: true });
  const manifestBody =
    opts.manifestBody ??
    [
      `name: ${opts.slug}`,
      `slug: ${opts.slug}`,
      `demos:`,
      ...opts.features.map((f) => `  - id: ${f}\n    name: ${f}`),
      "",
    ].join("\n");
  fs.writeFileSync(path.join(pkgDir, "manifest.yaml"), manifestBody);
  if (!opts.omitQaDir) {
    const qaDir = path.join(pkgDir, "qa");
    fs.mkdirSync(qaDir, { recursive: true });
    for (const f of opts.qaFilesFor) {
      fs.writeFileSync(path.join(qaDir, `${f}.md`), `# QA for ${f}\n`);
    }
  }
  return root;
}

describe("qa driver", () => {
  const tmpRoots: string[] = [];
  afterEach(() => {
    for (const r of tmpRoots.splice(0)) {
      fs.rmSync(r, { recursive: true, force: true });
    }
  });

  it("exposes kind === 'qa'", () => {
    expect(qaDriver.kind).toBe("qa");
  });

  it("inputSchema accepts { key } and { key, name, slug }", () => {
    expect(qaDriver.inputSchema.safeParse({ key: "qa:mastra" }).success).toBe(
      true,
    );
    expect(
      qaDriver.inputSchema.safeParse({
        key: "qa:mastra",
        name: "showcase-mastra",
        slug: "mastra",
      }).success,
    ).toBe(true);
  });

  it("inputSchema rejects missing key", () => {
    expect(qaDriver.inputSchema.safeParse({}).success).toBe(false);
  });

  it("emits green qa:<slug>/<feature> for every manifest demo with a matching qa/<feature>.md", async () => {
    const root = makeRepoFixture({
      slug: "foo",
      features: ["agentic-chat", "hitl-in-chat"],
      qaFilesFor: ["agentic-chat", "hitl-in-chat"],
    });
    tmpRoots.push(root);

    const { writer, writes } = mkWriter();
    const ctx = mkCtx(writer, { QA_REPO_ROOT: root });
    const result = await qaDriver.run(ctx, {
      key: "qa:foo",
      name: "showcase-foo",
      slug: "foo",
    });

    expect(result.key).toBe("qa:foo");
    expect(result.state).toBe("green");

    // One side-emit row per feature.
    const keys = writes.map((w) => w.key).sort();
    expect(keys).toEqual(["qa:foo/agentic-chat", "qa:foo/hitl-in-chat"]);
    for (const w of writes) {
      expect(w.state).toBe("green");
    }
  });

  it("emits red qa:<slug>/<feature> rows for demos missing qa files", async () => {
    const root = makeRepoFixture({
      slug: "foo",
      features: ["agentic-chat", "other-feature"],
      qaFilesFor: ["agentic-chat"],
    });
    tmpRoots.push(root);

    const { writer, writes } = mkWriter();
    const ctx = mkCtx(writer, { QA_REPO_ROOT: root });
    const result = await qaDriver.run(ctx, {
      key: "qa:foo",
      slug: "foo",
    });

    const byKey = new Map(writes.map((w) => [w.key, w]));
    expect(byKey.get("qa:foo/agentic-chat")?.state).toBe("green");
    expect(byKey.get("qa:foo/other-feature")?.state).toBe("red");
  });

  it("aggregate probe result is red if any demos are missing qa files", async () => {
    const root = makeRepoFixture({
      slug: "foo",
      features: ["agentic-chat", "other-feature"],
      qaFilesFor: ["agentic-chat"],
    });
    tmpRoots.push(root);

    const { writer } = mkWriter();
    const ctx = mkCtx(writer, { QA_REPO_ROOT: root });
    const result = await qaDriver.run(ctx, {
      key: "qa:foo",
      slug: "foo",
    });

    expect(result.state).toBe("red");
  });

  it("aggregate is green iff every demo has a qa file", async () => {
    const root = makeRepoFixture({
      slug: "foo",
      features: ["a", "b", "c"],
      qaFilesFor: ["a", "b", "c"],
    });
    tmpRoots.push(root);

    const { writer, writes } = mkWriter();
    const ctx = mkCtx(writer, { QA_REPO_ROOT: root });
    const result = await qaDriver.run(ctx, {
      key: "qa:foo",
      slug: "foo",
    });
    expect(result.state).toBe("green");
    expect(writes).toHaveLength(3);
    for (const w of writes) expect(w.state).toBe("green");
  });

  it("handles integration with no qa directory at all — emits all reds", async () => {
    const root = makeRepoFixture({
      slug: "foo",
      features: ["agentic-chat", "hitl-in-chat"],
      qaFilesFor: [],
      omitQaDir: true,
    });
    tmpRoots.push(root);

    const { writer, writes } = mkWriter();
    const ctx = mkCtx(writer, { QA_REPO_ROOT: root });
    const result = await qaDriver.run(ctx, {
      key: "qa:foo",
      slug: "foo",
    });

    expect(result.state).toBe("red");
    expect(writes).toHaveLength(2);
    for (const w of writes) expect(w.state).toBe("red");
    expect(writes.map((w) => w.key).sort()).toEqual([
      "qa:foo/agentic-chat",
      "qa:foo/hitl-in-chat",
    ]);
  });

  it("strips `showcase-` prefix from `name` to derive slug when slug is absent", async () => {
    const root = makeRepoFixture({
      slug: "bar",
      features: ["x"],
      qaFilesFor: ["x"],
    });
    tmpRoots.push(root);

    const { writer, writes } = mkWriter();
    const ctx = mkCtx(writer, { QA_REPO_ROOT: root });
    const result = await qaDriver.run(ctx, {
      key: "qa:bar",
      name: "showcase-bar",
    });

    expect(result.state).toBe("green");
    expect(writes.map((w) => w.key)).toEqual(["qa:bar/x"]);
  });

  it("falls back to key-suffix for slug when neither slug nor name provided", async () => {
    const root = makeRepoFixture({
      slug: "baz",
      features: ["x"],
      qaFilesFor: ["x"],
    });
    tmpRoots.push(root);

    const { writer, writes } = mkWriter();
    const ctx = mkCtx(writer, { QA_REPO_ROOT: root });
    const result = await qaDriver.run(ctx, {
      key: "qa:baz",
    });

    expect(result.state).toBe("green");
    expect(writes.map((w) => w.key)).toEqual(["qa:baz/x"]);
  });

  it("starter-shape input: returns green aggregate and emits no side rows", async () => {
    // Starters have no per-demo /demos routing so the driver skips them.
    const root = makeRepoFixture({
      slug: "starter-foo",
      features: ["something"],
      qaFilesFor: [],
      omitQaDir: true,
    });
    tmpRoots.push(root);

    const { writer, writes } = mkWriter();
    const ctx = mkCtx(writer, { QA_REPO_ROOT: root });
    const result = await qaDriver.run(ctx, {
      key: "qa:starter-foo",
      slug: "starter-foo",
      shape: "starter",
    });

    expect(result.state).toBe("green");
    expect(writes).toHaveLength(0);
  });

  it("manifest missing: returns state='error' with a readable errorDesc", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "qa-driver-empty-"));
    tmpRoots.push(root);

    const { writer, writes } = mkWriter();
    const ctx = mkCtx(writer, { QA_REPO_ROOT: root });
    const result = await qaDriver.run(ctx, {
      key: "qa:nope",
      slug: "nope",
    });

    expect(result.state).toBe("error");
    const sig = result.signal as { errorDesc?: string };
    expect(sig.errorDesc).toBeTruthy();
    expect(writes).toHaveLength(0);
  });

  it("manifest with no demos: aggregate green, no side rows", async () => {
    // An integration without any demos is structurally valid (some
    // integrations are starter-only or still in draft) — the QA probe
    // should NOT flip red for them; there's nothing to check.
    const root = makeRepoFixture({
      slug: "empty",
      features: [],
      qaFilesFor: [],
      manifestBody: "name: empty\nslug: empty\n",
    });
    tmpRoots.push(root);

    const { writer, writes } = mkWriter();
    const ctx = mkCtx(writer, { QA_REPO_ROOT: root });
    const result = await qaDriver.run(ctx, {
      key: "qa:empty",
      slug: "empty",
    });

    expect(result.state).toBe("green");
    expect(writes).toHaveLength(0);
  });

  it("createQaDriver honours an explicit repoRoot dep over the env var", async () => {
    const root = makeRepoFixture({
      slug: "foo",
      features: ["a"],
      qaFilesFor: ["a"],
    });
    tmpRoots.push(root);

    const driver = createQaDriver({ repoRoot: root });
    const { writer, writes } = mkWriter();
    // Deliberately pass a bogus env root — driver should use the injected one.
    const ctx = mkCtx(writer, { QA_REPO_ROOT: "/totally/bogus/path" });
    const result = await driver.run(ctx, {
      key: "qa:foo",
      slug: "foo",
    });

    expect(result.state).toBe("green");
    expect(writes.map((w) => w.key)).toEqual(["qa:foo/a"]);
  });
});
