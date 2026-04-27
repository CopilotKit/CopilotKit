import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "fs";
import path from "path";
import os from "os";

const CACHE_PATH = path.join(os.homedir(), ".copilotkit", "remote-tips.json");

// Mock the constants in the module by patching fs and fetch
const SAMPLE_REMOTE: Record<string, unknown> = {
  version: 1,
  alert: null,
  tips: {
    "post-create": [
      {
        id: "remote-1",
        message: "Remote tip 1",
        category: "activation",
        weight: 2,
      },
      { id: "remote-2", message: "Remote tip 2", category: "conversion" },
    ],
    dev: [
      { id: "remote-dev-1", message: "Remote dev tip", category: "activation" },
    ],
  },
};

const SAMPLE_WITH_ALERT: Record<string, unknown> = {
  version: 1,
  alert: { message: "Service disruption — update to latest", level: "warning" },
  tips: {
    "post-create": [
      { id: "alert-tip", message: "Alert tip", category: "activation" },
    ],
    dev: [],
  },
};

// We need to test loadRemoteTips which depends on global fetch and hardcoded paths.
// Rather than complex mocking, we'll test the validation and fallback logic by
// directly testing the behavior through the exported function with fetch mocked.

let originalFetch: typeof globalThis.fetch;

function mockFetch(data: unknown, ok = true): void {
  globalThis.fetch = (() =>
    Promise.resolve({
      ok,
      json: () => Promise.resolve(data),
    })) as unknown as typeof globalThis.fetch;
}

function mockFetchError(): void {
  globalThis.fetch = (() =>
    Promise.reject(
      new Error("Network error"),
    )) as unknown as typeof globalThis.fetch;
}

// We dynamically import to reset module state between tests
async function getLoader() {
  // Clear the module cache so we get fresh constants...
  // Actually, we can't easily override the constants. Instead, we test the
  // public API behavior with fetch mocked and accept that the cache path
  // is the real ~/.copilotkit path. We'll clean up after ourselves.
  const mod = await import("../../src/tips/loaders/remote.js");
  return mod;
}

describe("RemoteTipLoader", () => {
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    // Clean up any cache files we may have written
    try {
      fs.unlinkSync(CACHE_PATH);
    } catch {
      // OK if it doesn't exist
    }
  });

  test("returns remote tips when fetch succeeds", async () => {
    mockFetch(SAMPLE_REMOTE);
    const { loadRemoteTips } = await getLoader();

    const result = await loadRemoteTips("post-create");
    expect(result.tips).toHaveLength(2);
    expect(result.tips[0].id).toBe("remote-1");
    expect(result.tips[1].id).toBe("remote-2");
    expect(result.alert).toBeNull();
  });

  test("returns alert when present in remote config", async () => {
    mockFetch(SAMPLE_WITH_ALERT);
    const { loadRemoteTips } = await getLoader();

    const result = await loadRemoteTips("post-create");
    expect(result.alert).toBeDefined();
    expect(result.alert!.message).toContain("Service disruption");
    expect(result.alert!.level).toBe("warning");
  });

  test("falls back to hardcoded tips when fetch fails", async () => {
    mockFetchError();
    const { loadRemoteTips } = await getLoader();

    const result = await loadRemoteTips("post-create");
    // Should get the hardcoded postCreateTips
    expect(result.tips.length).toBeGreaterThan(0);
    expect(result.tips[0].id).toBeDefined();
    expect(result.alert).toBeUndefined();
  });

  test("falls back to hardcoded tips when fetch returns non-ok", async () => {
    mockFetch(null, false);
    const { loadRemoteTips } = await getLoader();

    const result = await loadRemoteTips("post-create");
    expect(result.tips.length).toBeGreaterThan(0);
  });

  test("falls back to hardcoded when remote JSON is malformed", async () => {
    mockFetch({ not: "valid" }); // missing version field
    const { loadRemoteTips } = await getLoader();

    const result = await loadRemoteTips("post-create");
    // Should fall back since the remote data has no version
    expect(result.tips.length).toBeGreaterThan(0);
  });

  test("falls back to hardcoded tips for unknown command", async () => {
    mockFetch(SAMPLE_REMOTE);
    const { loadRemoteTips } = await getLoader();

    const result = await loadRemoteTips("unknown-command");
    // No tips in remote for this command, no hardcoded fallback either
    expect(result.tips).toEqual([]);
  });

  test("returns dev tips from remote config", async () => {
    mockFetch(SAMPLE_REMOTE);
    const { loadRemoteTips } = await getLoader();

    const result = await loadRemoteTips("dev");
    expect(result.tips).toHaveLength(1);
    expect(result.tips[0].id).toBe("remote-dev-1");
  });

  test("validates tip objects — rejects tips without id or message", async () => {
    const badData = {
      version: 1,
      tips: {
        "post-create": [
          { id: "valid", message: "Valid tip" },
          { id: 123, message: "Bad id type" }, // id must be string
          { message: "No id" }, // missing id
          { id: "no-msg" }, // missing message
        ],
      },
    };
    mockFetch(badData);
    const { loadRemoteTips } = await getLoader();

    const result = await loadRemoteTips("post-create");
    expect(result.tips).toHaveLength(1);
    expect(result.tips[0].id).toBe("valid");
  });

  test("validates alert — rejects invalid alert objects", async () => {
    const badAlert = {
      version: 1,
      alert: { message: "", level: "warning" }, // empty message
      tips: { "post-create": [{ id: "t", message: "tip" }] },
    };
    mockFetch(badAlert);
    const { loadRemoteTips } = await getLoader();

    const result = await loadRemoteTips("post-create");
    expect(result.alert).toBeNull();
  });

  test("validates alert — rejects unknown level", async () => {
    const badLevel = {
      version: 1,
      alert: { message: "Some alert", level: "critical" }, // not info/warning/error
      tips: { "post-create": [{ id: "t", message: "tip" }] },
    };
    mockFetch(badLevel);
    const { loadRemoteTips } = await getLoader();

    const result = await loadRemoteTips("post-create");
    expect(result.alert).toBeNull();
  });
});
