import { describe, it, expect, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listDir,
  readFile,
  searchFiles,
  writeFile as fsToolsWriteFile,
} from "./fs-tools";

let root: string;

async function setupTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "fs-tools-test-"));
  await writeFile(join(dir, "a.txt"), "hello from a");
  await mkdir(join(dir, "sub"));
  await writeFile(join(dir, "sub", "b.md"), "hello from b");
  return dir;
}

// Use a module-level setup so all tests share one temp dir
const rootPromise = setupTempDir().then((dir) => {
  root = dir;
  return dir;
});

afterAll(async () => {
  await rootPromise;
  await rm(root, { recursive: true, force: true });
});

describe("listDir", () => {
  it("lists names and isDirectory flags at root", async () => {
    await rootPromise;
    const entries = await listDir(root, ".");
    const names = entries.map((e) => e.name).sort();
    expect(names).toContain("a.txt");
    expect(names).toContain("sub");
    const sub = entries.find((e) => e.name === "sub");
    expect(sub?.isDirectory).toBe(true);
    const file = entries.find((e) => e.name === "a.txt");
    expect(file?.isDirectory).toBe(false);
  });

  it("lists names in subdirectory", async () => {
    await rootPromise;
    const entries = await listDir(root, "sub");
    expect(entries.map((e) => e.name)).toContain("b.md");
    expect(entries.find((e) => e.name === "b.md")?.isDirectory).toBe(false);
  });

  it("rejects path escaping workspace with '..'", async () => {
    await rootPromise;
    await expect(listDir(root, "..")).rejects.toThrow(/outside the workspace/);
  });
});

describe("readFile", () => {
  it("reads the content of a.txt", async () => {
    await rootPromise;
    const content = await readFile(root, "a.txt");
    expect(content).toBe("hello from a");
  });

  it("reads the content of sub/b.md", async () => {
    await rootPromise;
    const content = await readFile(root, "sub/b.md");
    expect(content).toBe("hello from b");
  });

  it("rejects path escaping workspace with '..'", async () => {
    await rootPromise;
    await expect(readFile(root, "../etc/passwd")).rejects.toThrow(
      /outside the workspace/,
    );
  });
});

describe("searchFiles", () => {
  it("finds sub/b.md when querying 'b'", async () => {
    await rootPromise;
    const results = await searchFiles(root, "b");
    // normalise separators for cross-platform safety
    const normalised = results.map((r) => r.replace(/\\/g, "/"));
    expect(normalised).toContain("sub/b.md");
  });

  it("finds a.txt when querying 'a'", async () => {
    await rootPromise;
    const results = await searchFiles(root, "a");
    const normalised = results.map((r) => r.replace(/\\/g, "/"));
    expect(normalised).toContain("a.txt");
  });

  it("returns an empty array when query matches nothing", async () => {
    await rootPromise;
    const results = await searchFiles(root, "zzz-no-match");
    expect(results).toHaveLength(0);
  });
});

describe("writeFile", () => {
  it("writes content and returns the relative path", async () => {
    await rootPromise;
    const returned = await fsToolsWriteFile(root, "new.txt", "written content");
    expect(returned.replace(/\\/g, "/")).toBe("new.txt");
  });

  it("content can be read back after write", async () => {
    await rootPromise;
    await fsToolsWriteFile(root, "readback.txt", "readback value");
    const content = await readFile(root, "readback.txt");
    expect(content).toBe("readback value");
  });

  it("rejects path escaping workspace with '..'", async () => {
    await rootPromise;
    await expect(
      fsToolsWriteFile(root, "../evil.txt", "bad content"),
    ).rejects.toThrow(/outside the workspace/);
  });
});
