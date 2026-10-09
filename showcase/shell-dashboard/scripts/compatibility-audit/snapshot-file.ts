import { randomUUID } from "node:crypto";
import { lstat, open, readFile, rename, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { CompatibilitySnapshotValue } from "./types";

function wrapperError(): never {
  throw new Error(
    "Cannot find an intact static snapshot declaration and satisfies wrapper.",
  );
}

// Only find the literal boundary; never evaluate the previous TypeScript value.
// Braces in quoted strings and comments must not be mistaken for that boundary.
function literalEnd(source: string, start: number): number {
  if (source[start] !== "{") return wrapperError();
  const brackets: string[] = [];
  for (let index = start; index < source.length; index++) {
    const char = source[index];
    if (char === '"' || char === "'") {
      const quote = char;
      let closed = false;
      while (++index < source.length) {
        if (source[index] === "\\") index++;
        else if (source[index] === quote) {
          closed = true;
          break;
        } else if (source[index] === "\n" || source[index] === "\r") {
          return wrapperError();
        }
      }
      if (!closed) return wrapperError();
    } else if (char === "/" && source[index + 1] === "/") {
      const end = source.indexOf("\n", index + 2);
      if (end < 0) return wrapperError();
      index = end;
    } else if (char === "/" && source[index + 1] === "*") {
      const end = source.indexOf("*/", index + 2);
      if (end < 0) return wrapperError();
      index = end + 1;
    } else if (char === "`" || char === "/") {
      return wrapperError();
    } else if ("{[(".includes(char)) {
      brackets.push(char);
    } else if ("}])".includes(char)) {
      if (brackets.pop() !== "{[("["}])".indexOf(char)]) return wrapperError();
      if (brackets.length === 0) return index + 1;
    }
  }
  return wrapperError();
}

function replaceValue(
  source: string,
  snapshot: CompatibilitySnapshotValue,
): string {
  const declarations = [
    ...source.matchAll(
      /^[\t ]*export\s+const\s+COMPATIBILITY_SNAPSHOT\s*=\s*/gm,
    ),
  ];
  if (declarations.length !== 1) return wrapperError();
  const declaration = declarations[0];
  const start = declaration.index + declaration[0].length;
  const end = literalEnd(source, start);
  const suffix = source.slice(end);
  const wrapper =
    /^\s+satisfies\s*\{\s*date\s*:\s*string\s*;\s*assessedAt\s*:\s*string\s*;\s*methodology\s*:\s*string\s*;\s*rows\s*:\s*CompatibilitySnapshotRow\s*\[\s*\]\s*;\s*\}\s*;\s*$/;
  if (!wrapper.test(suffix)) return wrapperError();
  return `${source.slice(0, start)}${JSON.stringify(snapshot, null, 2)}${suffix}`;
}

/** Only an explicit caller may replace a snapshot. Importing this module has no writes. */
export async function writeSnapshotAtomic(
  path: string,
  snapshot: CompatibilitySnapshotValue,
): Promise<void> {
  const metadata = await lstat(path);
  if (!metadata.isFile())
    throw new Error("The snapshot must be a regular file.");
  const source = await readFile(path, "utf8");
  const replacement = replaceValue(source, snapshot);
  const temporary = join(
    dirname(path),
    `.${basename(path)}.${randomUUID()}.tmp`,
  );
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let created = false;
  try {
    handle = await open(temporary, "wx", metadata.mode & 0o777);
    created = true;
    await handle.writeFile(replacement, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, path);
  } catch (error) {
    const cleanupErrors: unknown[] = [];
    if (handle) {
      await handle.close().catch((failure) => cleanupErrors.push(failure));
    }
    if (created) {
      await unlink(temporary).catch((failure) => cleanupErrors.push(failure));
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        "Snapshot replacement failed and temporary-file cleanup also failed.",
        { cause: error },
      );
    }
    throw error;
  }
}
