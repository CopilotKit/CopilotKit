import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import {
  FileSnapshotRestorer,
  execOptsFor,
  restoreFromGitHead,
} from "./test-cleanup";
import { SCRIPTS_DIR, REPO_ROOT, SHELL_DATA_DIR } from "./paths";

// `bundle-demo-content.ts` rewrites showcase/shell/src/data/demo-content.json
// on every run, leaking changes into the working tree. Snapshot in beforeAll
// and restore after each test. Assumes vitest's `fileParallelism: false`.
const CONTENT_PATH = path.join(SHELL_DATA_DIR, "demo-content.json");
const DATA_FILES = [CONTENT_PATH];
const dataRestorer = new FileSnapshotRestorer(DATA_FILES);

const EXEC_OPTS = execOptsFor(SCRIPTS_DIR);

/** Invoke the bundler via argv form — argv-safe, no shell parser involvement.
 *  Returns raw stdout so the call sites that need it (test 1) can assert
 *  against it. */
function runBundler(): string {
  const out = execFileSync("npx", ["tsx", "bundle-demo-content.ts"], EXEC_OPTS);
  return out.toString();
}

beforeAll(() => {
  restoreFromGitHead(REPO_ROOT, DATA_FILES);
  dataRestorer.snapshot();
  if (dataRestorer.snapshotMap.size === 0) {
    throw new Error(
      `bundle-demo-content.test.ts: data snapshot is empty. Expected to find` +
        ` tracked files at:\n` +
        DATA_FILES.map((p) => `  ${p}`).join("\n"),
    );
  }
  // NOTE: we intentionally do NOT pre-run the bundler here. Test 1 below
  // exercises the bundler AND asserts on stdout, so a pre-run in beforeAll
  // was redundant. Tests 2-5 call `runBundlerAndRead()` which
  // runs the bundler themselves — afterEach restores to HEAD between tests
  // so they must re-invoke rather than read stale committed content.
});
afterEach(() => dataRestorer.restore());
afterAll(() => dataRestorer.restore());

/** Run the bundler and return the parsed demo-content.json. Tests 3-5 each
 *  call this so they observe live bundler output (afterEach restores to HEAD
 *  between tests, so without this step they'd read stale committed content). */
function runBundlerAndRead(): any {
  runBundler();
  return JSON.parse(fs.readFileSync(CONTENT_PATH, "utf-8"));
}

describe("Content Bundler", () => {
  it("generates demo-content.json from existing packages", () => {
    const stdout = runBundler();

    expect(stdout).toContain("Bundling demo content");
    expect(stdout).toContain("langgraph-python::agentic-chat");

    expect(fs.existsSync(CONTENT_PATH)).toBe(true);

    const content = JSON.parse(fs.readFileSync(CONTENT_PATH, "utf-8"));
    expect(Object.keys(content.demos).length).toBeGreaterThan(0);
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
      /agents\/agentic_chat\.py$/.test(f.filename),
    );
    expect(agentFile).toBeDefined();
    expect(agentFile.language).toBe("python");
  });

  it("detects correct language for each file type", () => {
    const content = runBundlerAndRead();

    for (const [, demo] of Object.entries(content.demos) as any) {
      for (const file of demo.files) {
        if (file.filename.endsWith(".tsx") || file.filename.endsWith(".ts")) {
          expect(file.language).toBe("typescript");
        } else if (file.filename.endsWith(".py")) {
          expect(file.language).toBe("python");
        } else if (file.filename.endsWith(".css")) {
          expect(file.language).toBe("css");
        }
      }
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
      /src\/agents\/agentic_chat\.py$/.test(f.filename),
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
      "shared-state-read-write",
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
  // produces in shell/src/data/demo-content.json.
  //
  // The sentinel append creates transient tracking drift on demo-content.json
  // for the duration of the test; a developer with a git GUI / file watcher
  // will see flicker while it runs. Restore heals it before the test returns.
  it("restores shell/src/data/demo-content.json after the bundler mutates it", () => {
    expect(dataRestorer.snapshotMap.size).toBeGreaterThan(0);

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
    expect(dataRestorer.snapshotMap.size).toBeGreaterThan(0);
    for (const [p, baseline] of dataRestorer.snapshotMap) {
      const current = fs.readFileSync(p);
      expect(current.equals(baseline), `data drift after suite: ${p}`).toBe(
        true,
      );
    }
  });
});
