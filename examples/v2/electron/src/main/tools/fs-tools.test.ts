import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { symlinkSync } from "node:fs";
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

describe("symlink sandbox escape", () => {
  // Layout (siblings under a shared parent so symlinks live INSIDE the
  // workspace but resolve OUTSIDE it):
  //   <parent>/workspace/        <- the workspace root passed to fs-tools
  //   <parent>/secret/passwd.txt <- out-of-root file the attacker targets
  let parent: string;
  let wsRoot: string;
  let secretDir: string;
  let secretFile: string;

  beforeAll(async () => {
    parent = await mkdtemp(join(tmpdir(), "fs-tools-symlink-"));
    wsRoot = join(parent, "workspace");
    secretDir = join(parent, "secret");
    secretFile = join(secretDir, "passwd.txt");
    await mkdir(wsRoot);
    await mkdir(secretDir);
    await writeFile(secretFile, "TOP SECRET");

    // A file symlink INSIDE the root pointing to the out-of-root file via "..".
    symlinkSync(join("..", "secret", "passwd.txt"), join(wsRoot, "leak.txt"));
    // A directory symlink INSIDE the root pointing to the out-of-root dir.
    symlinkSync(join("..", "secret"), join(wsRoot, "escape"));
    // A file symlink INSIDE the root pointing to an ABSOLUTE out-of-root path.
    symlinkSync(secretFile, join(wsRoot, "abs-leak.txt"));
  });

  afterAll(async () => {
    await rm(parent, { recursive: true, force: true });
  });

  it("rejects fs_read through an in-root file symlink to an out-of-root file", async () => {
    await expect(readFile(wsRoot, "leak.txt")).rejects.toThrow(
      /outside the workspace root/,
    );
  });

  it("rejects listDir through an in-root dir symlink to an out-of-root dir", async () => {
    await expect(listDir(wsRoot, "escape")).rejects.toThrow(
      /outside the workspace root/,
    );
  });

  it("rejects fs_write through an in-root dir symlink to an out-of-root dir", async () => {
    await expect(
      fsToolsWriteFile(wsRoot, "escape/x.txt", "pwned"),
    ).rejects.toThrow(/outside the workspace root/);
  });

  it("rejects fs_read through an in-root symlink to an absolute out-of-root path", async () => {
    await expect(readFile(wsRoot, "abs-leak.txt")).rejects.toThrow(
      /outside the workspace root/,
    );
  });
});

describe("readFile size cap", () => {
  let capRoot: string;

  beforeAll(async () => {
    capRoot = await mkdtemp(join(tmpdir(), "fs-tools-cap-"));
    // 11 bytes, one over the 10-byte cap used below.
    await writeFile(join(capRoot, "big.txt"), "01234567890");
  });

  afterAll(async () => {
    await rm(capRoot, { recursive: true, force: true });
  });

  it("rejects when the file exceeds the provided maxBytes", async () => {
    await expect(
      readFile(capRoot, "big.txt", { maxBytes: 10 }),
    ).rejects.toThrow(/exceeds the maximum read size/);
  });

  it("succeeds under the default cap", async () => {
    const content = await readFile(capRoot, "big.txt");
    expect(content).toBe("01234567890");
  });
});
