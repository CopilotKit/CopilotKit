import {
  readdir,
  readFile as fsReadFile,
  writeFile as fsWriteFile,
} from "node:fs/promises";
import { join, relative } from "node:path";
import { resolveInWorkspace } from "./paths";

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

export async function readFile(root: string, relPath: string): Promise<string> {
  const abs = resolveInWorkspace(root, relPath);
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
  return relative(root, abs);
}
