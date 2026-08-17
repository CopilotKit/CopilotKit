import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { FileSnapshotRestorer, execOptsFor } from "./test-cleanup";
import { SCRIPTS_DIR, SHELL_DATA_DIR } from "./paths";
import {
  findRegionStartNames,
  resolveDemoDir,
  substituteIntegrationSlug,
} from "../bundle-demo-content";
import {
  describeDuplicateRegion,
  findUnexpectedDuplicateRegions,
} from "../lib/demo-region-guard";

// `bundle-demo-content.ts` MULTI-EMITS the same JSON to three shells, and
// rewrites all three on every run. None of the three is tracked by git (see
// showcase/.gitignore: `shell*/src/data/*.json`), so a run cannot leak into a
// commit — the snapshot exists so a suite that runs the bundler seven times
// leaves the developer's generated bundles exactly as it found them
// (byte-identical, untouched mtime), instead of leaving file watchers and
// build caches churning on drift this suite caused.
//
// All three paths are listed on purpose. When only the shell path was
// snapshotted, the "leaves every snapshotted data file byte-identical"
// check below proved nothing about the other two.
// NO serial-execution dependency, despite what an earlier revision of this
// comment claimed: `vitest.config.ts` sets `fileParallelism: true`, and this
// suite is safe under it. `FileSnapshotRestorer` is per-process state, and
// under `pool: "forks"` this file is the ONLY process that writes these three
// paths — `bundle-demo-content.ts` is their sole producer and no other suite
// runs it. Per the parallelism note in `test-cleanup.ts`, a suite needs
// `acquireGeneratedDataLock()` only when it snapshots and mutates generated
// data files SHARED with another suite (registry.json / catalog.json /
// constraints.json, held by generate-catalog + integration-smoke-registry).
// demo-content.json is not shared, so no lock is required here. If a second
// suite ever starts writing demo-content.json, take the lock — do not go back
// to relying on serial file execution.
const CONTENT_PATH = path.join(SHELL_DATA_DIR, "demo-content.json");
const DOCS_CONTENT_PATH = path.resolve(
  SCRIPTS_DIR,
  "..",
  "shell-docs",
  "src",
  "data",
  "demo-content.json",
);
const DOJO_CONTENT_PATH = path.resolve(
  SCRIPTS_DIR,
  "..",
  "shell-dojo",
  "src",
  "data",
  "demo-content.json",
);
const DATA_FILES = [CONTENT_PATH, DOCS_CONTENT_PATH, DOJO_CONTENT_PATH];
const dataRestorer = new FileSnapshotRestorer(DATA_FILES);

const EXEC_OPTS = execOptsFor(SCRIPTS_DIR);

/** Invoke the bundler via argv form — argv-safe, no shell parser involvement.
 *  Returns raw stdout so the call sites that need it (test 1) can assert
 *  against it. */
function runBundler(): string {
  const out = execFileSync("npx", ["tsx", "bundle-demo-content.ts"], EXEC_OPTS);
  return out.toString();
}

/** Run the bundler and return the parsed demo-content.json. Tests 3-5 each
 *  call this so they observe live bundler output (afterEach restores to HEAD
 *  between tests, so without this step they'd read stale committed content). */
function runBundlerAndRead(): any {
  runBundler();
  return JSON.parse(fs.readFileSync(CONTENT_PATH, "utf-8"));
}

// ---------------------------------------------------------------------------
// Pure units — no bundler run, no disk writes.
// ---------------------------------------------------------------------------

describe("substituteIntegrationSlug", () => {
  it("rewrites the runtimeUrl template and drops the now-unused useParams", () => {
    const source = [
      '"use client";',
      "",
      'import { useParams } from "next/navigation";',
      'import { CopilotKit, CopilotChat } from "@copilotkit/react-core/v2";',
      "",
      "export default function AgenticChatDemo() {",
      "  const { integration } = useParams<{ integration: string }>();",
      "  return (",
      "    <CopilotKit",
      "      runtimeUrl={`/api/${integration}/agentic-chat`}",
      '      agent="agentic-chat"',
      "    >",
      "      <CopilotChat />",
      "    </CopilotKit>",
      "  );",
      "}",
      "",
    ].join("\n");

    const result = substituteIntegrationSlug(source, "langgraph-python");

    expect(result.rewrites).toBe(1);
    expect(result.droppedUseParams).toBe(true);
    expect(result.unmatched).toEqual([]);
    expect(result.content).toContain(
      'runtimeUrl="/api/langgraph-python/agentic-chat"',
    );
    expect(result.content).not.toContain("${integration}");
    expect(result.content).not.toContain("useParams");
    // Everything else must survive untouched.
    expect(result.content).toContain('agent="agentic-chat"');
    expect(result.content).toContain("<CopilotChat />");
  });

  it("rewrites the single-line provider form too", () => {
    const source = [
      'import { useParams } from "next/navigation";',
      "export default function Demo() {",
      "  const { integration } = useParams<{ integration: string }>();",
      "  return (",
      '    <CopilotKit runtimeUrl={`/api/${integration}/hitl`} agent="hitl">',
      "      <Chat />",
      "    </CopilotKit>",
      "  );",
      "}",
    ].join("\n");

    const result = substituteIntegrationSlug(source, "mastra");

    expect(result.rewrites).toBe(1);
    expect(result.content).toContain('runtimeUrl="/api/mastra/hitl"');
    expect(result.content).not.toContain("useParams");
  });

  it("passes an unrecognised provider shape through UNCHANGED", () => {
    // A computed base — not the shape we know how to rewrite. Emitting a
    // guess here would ship a wrong URL into published docs.
    const source = [
      'import { useParams } from "next/navigation";',
      "export default function Demo() {",
      "  const { integration } = useParams<{ integration: string }>();",
      "  const base = `/api/${integration}`;",
      '  return <CopilotKit runtimeUrl={`${base}/voice`} agent="voice" />;',
      "}",
    ].join("\n");

    const result = substituteIntegrationSlug(source, "google-adk");

    expect(result.rewrites).toBe(0);
    expect(result.droppedUseParams).toBe(false);
    expect(result.content).toBe(source);
    expect(result.unmatched.length).toBeGreaterThan(0);
    expect(result.unmatched[0]).toMatch(/no runtimeUrl template literal/);
  });

  it("keeps useParams when the integration param is read elsewhere", () => {
    const source = [
      'import { useParams } from "next/navigation";',
      "export default function Demo() {",
      "  const { integration } = useParams<{ integration: string }>();",
      "  const label = `backend: ${integration}`;",
      "  return (",
      '    <CopilotKit runtimeUrl={`/api/${integration}/auth`} agent="auth">',
      "      <span>{label}</span>",
      "    </CopilotKit>",
      "  );",
      "}",
    ].join("\n");

    const result = substituteIntegrationSlug(source, "strands");

    expect(result.rewrites).toBe(1);
    expect(result.content).toContain('runtimeUrl="/api/strands/auth"');
    // Still referenced, so the plumbing must stay or the file won't compile.
    expect(result.droppedUseParams).toBe(false);
    expect(result.content).toContain("useParams<{ integration: string }>()");
    expect(result.unmatched.length).toBeGreaterThan(0);
  });

  it("leaves a file that never touches the route param completely alone", () => {
    const source = [
      "// See https://docs.copilotkit.ai/integrations/langgraph for context.",
      "export const suggestions = [{ title: 'Hi' }];",
    ].join("\n");

    const result = substituteIntegrationSlug(source, "ag2");

    expect(result).toEqual({
      content: source,
      rewrites: 0,
      droppedUseParams: false,
      unmatched: [],
    });
  });

  it("ignores the word 'integration' when it only appears in comments", () => {
    const source = [
      'import { useParams } from "next/navigation";',
      "export default function Demo() {",
      "  // Mirrors every other integration's gen-ui-agent demo.",
      "  const { integration } = useParams<{ integration: string }>();",
      "  return <CopilotKit runtimeUrl={`/api/${integration}/gen-ui-agent`} />;",
      "}",
    ].join("\n");

    const result = substituteIntegrationSlug(source, "agno");

    expect(result.droppedUseParams).toBe(true);
    expect(result.content).not.toContain("useParams");
    expect(result.unmatched).toEqual([]);
  });
});

describe("findRegionStartNames", () => {
  it("reports every start marker, repeats included", () => {
    const source = [
      "// @region[setup]",
      "const a = 1;",
      "// @endregion[setup]",
      "// @region[setup]",
      "const b = 2;",
      "// @endregion[setup]",
      "// @region[other]",
      "// @endregion[other]",
    ].join("\n");

    expect(findRegionStartNames(source)).toEqual(["setup", "setup", "other"]);
  });

  it("does not mistake an @endregion marker for a start", () => {
    expect(findRegionStartNames("// @endregion[setup]")).toEqual([]);
  });

  it("is not affected by a previous call's lastIndex", () => {
    const source = "// @region[setup]";
    expect(findRegionStartNames(source)).toEqual(["setup"]);
    expect(findRegionStartNames(source)).toEqual(["setup"]);
  });
});

// The bundler's collapse loop concatenates EVERY slice of a region name, so
// two markers of the same name in ONE file are glued together exactly like a
// cross-file duplicate. The guard therefore decides on total slice count.
// Deciding on distinct-file count left that case completely unguarded — it did
// not even need an allowlist entry to slip through.
describe("findUnexpectedDuplicateRegions", () => {
  it("flags two regions of the same name inside ONE file", () => {
    const unexpected = findUnexpectedDuplicateRegions([
      {
        demoKey: "ag2::agentic-chat",
        demoId: "agentic-chat",
        regionName: "provider-setup",
        files: ["src/app/demos/agentic-chat/page.tsx"],
        sliceCount: 2,
      },
    ]);

    expect(unexpected).toHaveLength(1);
    expect(describeDuplicateRegion(unexpected[0])).toBe(
      "appears 2 times in src/app/demos/agentic-chat/page.tsx",
    );
  });

  it("still flags the same name across two files", () => {
    const unexpected = findUnexpectedDuplicateRegions([
      {
        demoKey: "ag2::agentic-chat",
        demoId: "agentic-chat",
        regionName: "provider-setup",
        files: [
          "src/app/demos/agentic-chat/page.tsx",
          "src/app/demos/agentic-chat/helper.ts",
        ],
        sliceCount: 2,
      },
    ]);

    expect(unexpected).toHaveLength(1);
    expect(describeDuplicateRegion(unexpected[0])).toContain(
      "appears in multiple files",
    );
  });

  it("passes a single-slice region", () => {
    expect(
      findUnexpectedDuplicateRegions([
        {
          demoKey: "ag2::agentic-chat",
          demoId: "agentic-chat",
          regionName: "provider-setup",
          files: ["src/app/demos/agentic-chat/page.tsx"],
          sliceCount: 1,
        },
      ]),
    ).toEqual([]);
  });

  it("honours the allowlist for a same-file duplicate too", () => {
    expect(
      findUnexpectedDuplicateRegions([
        {
          demoKey: "ag2::headless-complete",
          demoId: "headless-complete",
          regionName: "custom-bubbles",
          files: ["src/app/demos/headless-complete/page.tsx"],
          sliceCount: 3,
        },
      ]),
    ).toEqual([]);
  });

  it("falls back to the file count when sliceCount is omitted", () => {
    expect(
      findUnexpectedDuplicateRegions([
        {
          demoKey: "ag2::agentic-chat",
          regionName: "provider-setup",
          files: ["a.tsx", "b.tsx"],
        },
      ]),
    ).toHaveLength(1);
  });
});

describe("resolveDemoDir", () => {
  let tmp: string;
  let unifiedRoot: string;
  let pkgRoot: string;

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "resolve-demo-dir-"));
    unifiedRoot = path.join(tmp, "frontends", "demos");
    pkgRoot = path.join(tmp, "integrations", "some-slug");
    fs.mkdirSync(path.join(unifiedRoot, "ported"), { recursive: true });
    fs.mkdirSync(path.join(pkgRoot, "src", "app", "demos", "ported"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(pkgRoot, "src", "app", "demos", "not-ported"), {
      recursive: true,
    });
  });

  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("prefers the unified app when both roots have the demo", () => {
    const resolved = resolveDemoDir(pkgRoot, "ported", unifiedRoot);
    expect(resolved).toEqual({
      dir: path.join(unifiedRoot, "ported"),
      origin: "unified",
    });
  });

  it("falls back to the integration for a demo that is not ported yet", () => {
    const resolved = resolveDemoDir(pkgRoot, "not-ported", unifiedRoot);
    expect(resolved).toEqual({
      dir: path.join(pkgRoot, "src", "app", "demos", "not-ported"),
      origin: "integration",
    });
  });

  it("returns null when neither root has the demo", () => {
    expect(resolveDemoDir(pkgRoot, "nowhere", unifiedRoot)).toBeNull();
  });
});

describe("Content Bundler", () => {
  // Scoped to this describe on purpose: the pure-unit suites above import the
  // bundler's helpers directly and must not pay for (or be blocked by) a full
  // bundle run.
  beforeAll(() => {
    // Generate the data file (it's gitignored, so it may not exist).
    runBundler();
    dataRestorer.snapshot();
    // Every emitted path must exist after a run, so a partial snapshot means
    // the bundler stopped writing one of the shells.
    if (dataRestorer.snapshotMap.size !== DATA_FILES.length) {
      const missing = DATA_FILES.filter(
        (p) => !dataRestorer.snapshotMap.has(p),
      );
      throw new Error(
        `bundle-demo-content.test.ts: data snapshot is incomplete (` +
          `${dataRestorer.snapshotMap.size}/${DATA_FILES.length}). The bundler` +
          ` did not generate:\n` +
          missing.map((p) => `  ${p}`).join("\n"),
      );
    }
  });
  afterEach(() => dataRestorer.restore());
  afterAll(() => dataRestorer.restore());

  it("generates demo-content.json from existing packages", () => {
    const stdout = runBundler();

    expect(stdout).toContain("Bundling demo content");
    expect(stdout).toContain("langgraph-python::agentic-chat");

    expect(fs.existsSync(CONTENT_PATH)).toBe(true);

    const content = JSON.parse(fs.readFileSync(CONTENT_PATH, "utf-8"));
    expect(Object.keys(content.demos).length).toBeGreaterThan(0);
  });

  it("emits the identical bundle to all three shells", () => {
    // shell, shell-docs and shell-dojo each read demo-content.json (runtime
    // drawer, build-time <Snippet>, dojo cell viewer). One shell silently
    // missing its copy means a build-time import failure or a stale bundle in
    // exactly one surface, which is the hardest version of this to notice.
    runBundler();

    const shell = fs.readFileSync(CONTENT_PATH);
    for (const other of [DOCS_CONTENT_PATH, DOJO_CONTENT_PATH]) {
      expect(fs.existsSync(other), `bundler did not write ${other}`).toBe(true);
      expect(
        fs.readFileSync(other).equals(shell),
        `${other} differs from ${CONTENT_PATH}`,
      ).toBe(true);
    }
  });

  it("bundles correct files for each demo", () => {
    const content = runBundlerAndRead();

    const agenticChat = content.demos["langgraph-python::agentic-chat"];
    expect(agenticChat).toBeDefined();
    expect(agenticChat.readme).toBeTruthy();
    expect(agenticChat.readme).toContain("Agentic Chat");
    expect(agenticChat.files.length).toBeGreaterThan(0);

    // page.tsx should be first (sorted by bundler); its bundled filename
    // is the column-relative path.
    expect(agenticChat.files[0].filename).toBe(
      "src/app/demos/agentic-chat/page.tsx",
    );
    expect(agenticChat.files[0].language).toBe("typescript");
    expect(agenticChat.files[0].content).toContain("CopilotKit");

    // Backend agent file (from manifest.highlight) should be present.
    const agentFile = agenticChat.files.find((f: any) =>
      f.filename.endsWith("agents/agentic_chat.py"),
    );
    expect(agentFile).toBeDefined();
    expect(agentFile.language).toBe("python");
  });

  it("detects correct language for each file type", () => {
    const content = runBundlerAndRead();

    // Extension -> the language the bundler must report for it.
    const EXPECTED: Record<string, string> = {
      ".tsx": "typescript",
      ".ts": "typescript",
      ".py": "python",
      ".css": "css",
    };
    // Extensions that MUST appear in the bundle. Without this the whole test
    // was a loop of conditional assertions: a bundle that lost every .py and
    // .css file passed vacuously, which is the failure most worth catching.
    const REQUIRED = [".tsx", ".py", ".css"];

    const seen = new Map<string, number>();
    for (const [, demo] of Object.entries(content.demos) as any) {
      for (const file of demo.files) {
        const ext = (file.filename.match(/\.[^./]+$/)?.[0] ?? "").toLowerCase();
        seen.set(ext, (seen.get(ext) ?? 0) + 1);
        // Every bundled file carries a language — never undefined or empty,
        // because the consumers feed it straight to the highlighter.
        expect(typeof file.language, `${file.filename} language`).toBe(
          "string",
        );
        expect(
          file.language.length,
          `${file.filename} language`,
        ).toBeGreaterThan(0);
        const expected = EXPECTED[ext];
        if (expected !== undefined) {
          expect(file.language, `${file.filename}`).toBe(expected);
        }
      }
    }

    for (const ext of REQUIRED) {
      expect(
        seen.get(ext) ?? 0,
        `no ${ext} file in the bundle`,
      ).toBeGreaterThan(0);
    }
  });

  it("includes backend files for packages with agent code", () => {
    const content = runBundlerAndRead();

    // langgraph-python: backend files are merged into the flat `files`
    // list via the manifest's `highlight:` entries (column-relative paths
    // like src/agents/main.py).
    const lgDemo = content.demos["langgraph-python::agentic-chat"];
    expect(lgDemo).toBeDefined();
    const lgAgent = lgDemo.files.find((f: any) =>
      f.filename.endsWith("src/agents/agentic_chat.py"),
    );
    expect(lgAgent).toBeDefined();
    expect(lgAgent.language).toBe("python");
  });

  it("includes core langgraph-python demos", () => {
    const content = runBundlerAndRead();

    const expectedDemos = [
      "agentic-chat",
      "frontend-tools",
      "hitl-in-chat",
      "tool-rendering",
      "gen-ui-tool-based",
      "gen-ui-agent",
      "shared-state-streaming",
      "subagents",
    ];

    for (const demoId of expectedDemos) {
      const key = `langgraph-python::${demoId}`;
      expect(content.demos[key]).toBeDefined();
      expect(content.demos[key].files.length).toBeGreaterThan(0);
    }
  });

  // Regression guard — verifies the snapshot/restore hooks defined at the
  // top of this file actually heal drift that `bundle-demo-content.ts`
  // produces in each shell's demo-content.json.
  //
  // The sentinel append makes every snapshotted file differ for the duration
  // of the test; a developer with a file watcher will see flicker while it
  // runs. Restore heals it before the test returns.
  it("restores every shell's demo-content.json after the bundler mutates it", () => {
    // All three emitted paths must be under snapshot, not just shell's.
    expect([...dataRestorer.snapshotMap.keys()].sort()).toEqual(
      [...DATA_FILES].sort(),
    );

    // Run the bundler (side-effect: overwrites demo-content.json).
    runBundler();

    // Capture pre-sentinel content so we can prove the append landed via a
    // content check (stronger than byte-length: resistant to a hypothetical
    // fs shim that updates stat but not bytes).
    const preAppendContent = new Map<string, Buffer>();
    for (const p of dataRestorer.snapshotMap.keys()) {
      preAppendContent.set(p, fs.readFileSync(p));
    }

    // Force the file to differ from the snapshot regardless of generator
    // output. Safe because we restore immediately below.
    const SENTINEL = "\n/* regression-guard-sentinel */\n";
    const sentinelBuf = Buffer.from(SENTINEL, "utf-8");
    for (const p of dataRestorer.snapshotMap.keys()) {
      fs.appendFileSync(p, SENTINEL);
    }

    // Verify the sentinel actually landed on disk — the file must be
    // pre-append content followed by sentinel bytes, exactly.
    for (const p of dataRestorer.snapshotMap.keys()) {
      const before = preAppendContent.get(p)!;
      const expected = Buffer.concat([before, sentinelBuf]);
      const actual = fs.readFileSync(p);
      expect(
        actual.equals(expected),
        `sentinel append did not land on ${p}`,
      ).toBe(true);
    }

    // Restore and assert bit-for-bit against the in-memory snapshot (NOT
    // against a re-read of disk, which would silently agree with a buggy
    // restore()).
    dataRestorer.restore();

    for (const [p, baseline] of dataRestorer.snapshotMap) {
      const current = fs.readFileSync(p);
      expect(current.equals(baseline), `data drift not restored: ${p}`).toBe(
        true,
      );
    }
  });

  // Safety net: every snapshotted data file must match its captured baseline
  // bit-for-bit at the end of the suite. Mirrors the equivalent check in
  // create-integration.test.ts and generate-registry.test.ts.
  it("leaves every snapshotted data file byte-identical to its baseline", () => {
    expect([...dataRestorer.snapshotMap.keys()].sort()).toEqual(
      [...DATA_FILES].sort(),
    );
    for (const [p, baseline] of dataRestorer.snapshotMap) {
      const current = fs.readFileSync(p);
      expect(current.equals(baseline), `data drift after suite: ${p}`).toBe(
        true,
      );
    }
  });
});
