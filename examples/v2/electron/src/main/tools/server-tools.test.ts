import { describe, it, expect, afterAll } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createReadOnlyFsTools } from "./server-tools";

let root: string;

const rootPromise = (async () => {
  const dir = await mkdtemp(join(tmpdir(), "server-tools-test-"));
  await writeFile(join(dir, "hello.txt"), "world");
  root = dir;
  return dir;
})();

afterAll(async () => {
  await rootPromise;
  await rm(root, { recursive: true, force: true });
});

describe("createReadOnlyFsTools", () => {
  it("returns exactly the three expected tool names", async () => {
    await rootPromise;
    const tools = createReadOnlyFsTools(root);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["fs_list", "fs_read", "fs_search"]);
  });

  it("every tool has a non-empty string description and defined parameters", async () => {
    await rootPromise;
    const tools = createReadOnlyFsTools(root);
    for (const tool of tools) {
      expect(typeof tool.description).toBe("string");
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.parameters).toBeDefined();
    }
  });

  it("fs_read returns the correct content for hello.txt", async () => {
    await rootPromise;
    const tools = createReadOnlyFsTools(root);
    const fsRead = tools.find((t) => t.name === "fs_read")!;
    const result = await fsRead.execute({ path: "hello.txt" });
    expect(result).toEqual({ content: "world" });
  });

  it("fs_list rejects a path escaping the workspace", async () => {
    await rootPromise;
    const tools = createReadOnlyFsTools(root);
    const fsList = tools.find((t) => t.name === "fs_list")!;
    await expect(fsList.execute({ path: ".." })).rejects.toThrow(
      /outside the workspace/,
    );
  });
});
