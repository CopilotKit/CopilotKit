import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FixtureStore, type FixtureMetadata } from "../fixture-store";
import type { RecordedCall } from "../vscode-lm-factory";

let workspaceRoot: string;

beforeEach(() => {
  workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fixture-store-"));
});

afterEach(() => {
  if (fs.existsSync(workspaceRoot)) {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

const meta: FixtureMetadata = {
  name: "round-trip",
  createdAt: "2026-04-28T12:00:00Z",
  modelId: "claude-3-5-sonnet",
  modelVendor: "github-copilot",
  version: 2,
};

const sampleCall: RecordedCall = {
  matchKey: "a".repeat(64),
  input: { messages: [], tools: [], modelId: "claude-3-5-sonnet" },
  chunks: [{ type: "TEXT_MESSAGE_CONTENT", delta: "Hello" }],
};

describe("FixtureStore (v2)", () => {
  it("lists empty when the fixtures dir does not exist", () => {
    const store = new FixtureStore(workspaceRoot);
    expect(store.list()).toEqual([]);
  });

  it("saves a v2 fixture and reads it back with calls[]", () => {
    const store = new FixtureStore(workspaceRoot);
    const file = store.save(meta, { calls: [sampleCall] });
    const fixture = store.read(file);
    expect(fixture.metadata.modelId).toBe("claude-3-5-sonnet");
    expect(fixture.metadata.version).toBe(2);
    expect(fixture.calls).toEqual([sampleCall]);
  });

  it("sanitizes unsafe filenames", () => {
    const store = new FixtureStore(workspaceRoot);
    store.save({ ...meta, name: "../../escape!" }, { calls: [] });
    const [entry] = store.list();
    expect(entry.filePath).not.toContain("..");
    expect(path.dirname(entry.filePath)).toBe(
      path.join(workspaceRoot, ".copilotkit", "fixtures"),
    );
  });

  it("skips v1 (journal-shaped) fixtures with no version field", () => {
    const dir = path.join(workspaceRoot, ".copilotkit", "fixtures");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "old.json"),
      JSON.stringify({
        metadata: { name: "old", createdAt: "2026-01-01T00:00:00Z" },
        recording: [],
      }),
      "utf-8",
    );
    const warnings: string[] = [];
    const store = new FixtureStore(workspaceRoot, {
      onWarn: (m) => warnings.push(m),
    });
    expect(store.list()).toEqual([]);
    expect(warnings.some((w) => w.includes("old.json"))).toBe(true);
  });

  it("deletes a fixture", () => {
    const store = new FixtureStore(workspaceRoot);
    store.save(meta, { calls: [] });
    const [entry] = store.list();
    store.delete(entry.filePath);
    expect(store.list()).toEqual([]);
  });
});
