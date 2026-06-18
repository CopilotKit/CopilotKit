import {
  readdir,
  readFile as fsReadFile,
  stat,
  writeFile as fsWriteFile,
} from "node:fs/promises";
import { join, relative } from "node:path";
import { resolveInWorkspace } from "./paths";

/** Default maximum size, in bytes, that {@link readFile} will read (10 MiB). */
const DEFAULT_MAX_READ_BYTES = 10 * 1024 * 1024;

export interface DirEntry {
  name: string;
  isDirectory: boolean;
}

export async function listDir(
  root: string,
  relPath: string,
): Promise<DirEntry[]> {
  const abs = resolveInWorkspace(root, relPath);
  const entries = await readdir(abs, { withFileTypes: true });
  return entries.map((d) => ({ name: d.name, isDirectory: d.isDirectory() }));
}

export async function readFile(
  root: string,
  relPath: string,
  opts?: { maxBytes?: number },
): Promise<string> {
  const maxBytes = opts?.maxBytes ?? DEFAULT_MAX_READ_BYTES;
  const abs = resolveInWorkspace(root, relPath);
  const { size } = await stat(abs);
  if (size > maxBytes) {
    throw new Error(
      `File "${relPath}" (${size} bytes) exceeds the maximum read size of ${maxBytes} bytes`,
    );
  }
  return fsReadFile(abs, "utf8");
}

export async function searchFiles(
  root: string,
  query: string,
): Promise<string[]> {
  const start = resolveInWorkspace(root, ".");
  const results: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
      } else if (entry.name.includes(query)) {
        results.push(relative(start, abs));
      }
    }
  }

  await walk(start);
  return results;
}

export async function writeFile(
  root: string,
  relPath: string,
  content: string,
): Promise<string> {
  const abs = resolveInWorkspace(root, relPath);
  await fsWriteFile(abs, content, "utf8");
  // Compute the returned relative path against the canonical root so it stays
  // a clean in-workspace path even when `root` itself contains symlinked
  // ancestors (e.g. macOS's /var -> /private/var) that resolveInWorkspace
  // canonicalizes in `abs`.
  const canonicalRoot = resolveInWorkspace(root, ".");
  return relative(canonicalRoot, abs);
}
