import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import { JsonFileTipStore } from "../../src/tips/stores/json-file.js";
import fs from "fs";
import os from "os";
import path from "path";

describe("JsonFileTipStore", () => {
  let tmpDir: string;
  let filePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tip-store-test-"));
    filePath = path.join(tmpDir, "tips.json");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("load returns empty state when file does not exist", async () => {
    const store = new JsonFileTipStore(filePath);
    const state = await store.load();
    expect(state).toEqual({ shownTipIds: [] });
  });

  test("save creates file and load reads it back", async () => {
    const store = new JsonFileTipStore(filePath);
    await store.save({
      shownTipIds: ["tip-1", "tip-2"],
      lastShownAt: "2026-04-21T00:00:00.000Z",
    });
    const state = await store.load();
    expect(state.shownTipIds).toEqual(["tip-1", "tip-2"]);
    expect(state.lastShownAt).toBe("2026-04-21T00:00:00.000Z");
  });

  test("load returns empty state when file is corrupted", async () => {
    fs.writeFileSync(filePath, "not valid json{{{");
    const store = new JsonFileTipStore(filePath);
    const state = await store.load();
    expect(state).toEqual({ shownTipIds: [] });
  });

  test("save creates parent directories if they don't exist", async () => {
    const nestedPath = path.join(tmpDir, "nested", "dir", "tips.json");
    const store = new JsonFileTipStore(nestedPath);
    await store.save({ shownTipIds: ["tip-1"] });
    const state = await store.load();
    expect(state.shownTipIds).toEqual(["tip-1"]);
  });

  test("save does not throw on permission errors", async () => {
    // Use a path that can't be written to
    const badPath = "/dev/null/impossible/tips.json";
    const store = new JsonFileTipStore(badPath);
    // Should not throw
    await expect(store.save({ shownTipIds: ["tip-1"] })).resolves.not.toThrow();
  });
});
