import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FixtureStore, type FixtureMetadata } from "../fixture-store";

let workspaceRoot: string;

beforeEach(() => {
  workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fixture-store-"));
});

afterEach(() => {
  if (fs.existsSync(workspaceRoot)) {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

describe("FixtureStore", () => {
  it("lists empty when the fixtures dir does not exist", () => {
    const store = new FixtureStore(workspaceRoot);
    expect(store.list()).toEqual([]);
  });

  it("saves a fixture and lists it back with metadata", () => {
    const store = new FixtureStore(workspaceRoot);
    const meta: FixtureMetadata = {
      name: "my-session",
      createdAt: "2026-04-23T12:00:00Z",
      provider: "openai",
      model: "gpt-4o-mini",
    };
    store.save(meta, { recording: [{ request: {}, response: {} }] });
    const list = store.list();
    expect(list).toHaveLength(1);
    expect(list[0].metadata.name).toBe("my-session");
    expect(list[0].filePath).toMatch(/my-session\.json$/);
  });

  it("reads a saved fixture by filePath", () => {
    const store = new FixtureStore(workspaceRoot);
    store.save(
      {
        name: "x",
        createdAt: "2026-04-23T12:00:00Z",
        provider: "openai",
        model: "gpt-4o-mini",
      },
      { recording: [] },
    );
    const entry = store.list()[0];
    const fixture = store.read(entry.filePath);
    expect(fixture.metadata.name).toBe("x");
    expect(fixture.recording).toEqual([]);
  });

  it("sanitizes unsafe filenames", () => {
    const store = new FixtureStore(workspaceRoot);
    store.save(
      {
        name: "../../escape!",
        createdAt: "2026-04-23T12:00:00Z",
        provider: "openai",
        model: "gpt-4o-mini",
      },
      { recording: [] },
    );
    const [entry] = store.list();
    expect(entry.filePath).not.toContain("..");
    expect(path.dirname(entry.filePath)).toBe(
      path.join(workspaceRoot, ".copilotkit", "fixtures"),
    );
  });

  it("emits aimock-native fixtures[] extracted from journal response.fixture", () => {
    const store = new FixtureStore(workspaceRoot);
    const journal = [
      {
        id: "j1",
        timestamp: 1,
        method: "POST",
        path: "/v1/chat/completions",
        response: {
          status: 200,
          fixture: {
            match: { userMessage: "hi" },
            response: { content: "hello" },
          },
        },
      },
      {
        id: "j2",
        timestamp: 2,
        method: "POST",
        path: "/v1/chat/completions",
        response: { status: 503, fixture: null }, // unmatched — skipped
      },
    ];
    const filePath = store.save(
      {
        name: "extract",
        createdAt: "2026-04-24T00:00:00Z",
        provider: "openai",
        model: "gpt-4o-mini",
      },
      { recording: journal },
    );
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(Array.isArray(raw.fixtures)).toBe(true);
    expect(raw.fixtures).toHaveLength(1);
    expect(raw.fixtures[0]).toEqual({
      match: { userMessage: "hi" },
      response: { content: "hello" },
    });
    // Recording still travels in the same file for debugging.
    expect(raw.recording).toHaveLength(2);
  });

  it("deletes a fixture", () => {
    const store = new FixtureStore(workspaceRoot);
    store.save(
      {
        name: "doomed",
        createdAt: "2026-04-23T12:00:00Z",
        provider: "openai",
        model: "gpt-4o-mini",
      },
      { recording: [] },
    );
    const [entry] = store.list();
    store.delete(entry.filePath);
    expect(store.list()).toEqual([]);
  });
});
