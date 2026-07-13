// Preload module — disables @langchain/langgraph-api's FileSystemPersistence
// disk flush, gated by LANGGRAPH_DISABLE_FILE_PERSISTENCE (default: enabled).
//
// This is the TypeScript equivalent of the langgraph-python fix in PR #5825,
// which set `export LANGGRAPH_DISABLE_FILE_PERSISTENCE=true` in the python
// entrypoint so langgraph_runtime_inmem never flushes its unbounded pickle
// state to `.langgraph_api/*.pckl`. Python reads that env var at import time
// inside the runtime package; the TypeScript stack (`@langchain/langgraph-api`)
// has NO such switch, so we neutralise the flush ourselves at the fs layer.
//
// Why the fs layer (and not the class):
//   @langchain/langgraph-api's `FileSystemPersistence` (dist/storage/persist.mjs)
//   is the single writer. Its module singletons (checkpointer, store, ops) are
//   constructed at import time and are NOT exported, and the package's exports
//   map blocks a deep import of persist.mjs (ERR_PACKAGE_PATH_NOT_EXPORTED), so
//   the class prototype cannot be patched from here. The only disk-write surface
//   in persist.mjs is `fs.writeFile` (the flush) and `fs.mkdir` (dir create),
//   both from `node:fs/promises`. Intercepting those two calls for the
//   `.langgraph_api` path fully stops disk growth while leaving the in-memory
//   store — the actual runtime state — untouched. Conversation/thread/run state
//   still works within a container's lifetime; it just never persists to disk.
//   This matches python's behaviour: in-memory state bounded by process memory,
//   discarded on restart, nothing accumulating on disk to trip the size
//   watchdog.
//
// Why the CJS handle (and not `import * as fs from "node:fs/promises"`):
//   An ESM namespace object is sealed — `fsPromises.writeFile = ...` throws
//   "Cannot assign to read only property". The writable seam is the CJS
//   `require("node:fs").promises` object; the package's ESM
//   `import * as fs from "node:fs/promises"` named exports are backed by that
//   same object, so patching it there IS observed by the package (verified:
//   `esmNs.writeFile === require("node:fs").promises.writeFile`).
//
// Loaded via `node --import` BEFORE liveness.mjs/server.mjs, so the patch is in
// place before any langgraph code touches the filesystem.

import { createRequire } from "node:module";

const PERSIST_MARKER = ".langgraph_api";
const disabled =
  String(process.env.LANGGRAPH_DISABLE_FILE_PERSISTENCE ?? "").toLowerCase() ===
  "true";

if (disabled) {
  const require = createRequire(import.meta.url);
  const fsPromises = require("node:fs").promises;

  // Only paths under `.langgraph_api` are short-circuited; every other fs write
  // (Next.js caches, tmp files, langgraph worker caches, etc.) is untouched.
  const targetsPersistDir = (p) =>
    // p may be a string, Buffer, URL, or file handle. Only the path-like string
    // form addresses the persistence dir; anything else falls through to the
    // real implementation unchanged.
    typeof p === "string" && p.includes(PERSIST_MARKER);

  const realWriteFile = fsPromises.writeFile;
  const realMkdir = fsPromises.mkdir;

  fsPromises.writeFile = function writeFile(file, ...rest) {
    if (targetsPersistDir(file)) {
      // No-op: the flush is skipped, matching python's disabled-persistence
      // behaviour. Resolve so the caller's `await` completes normally.
      return Promise.resolve();
    }
    return realWriteFile.call(this, file, ...rest);
  };

  fsPromises.mkdir = function mkdir(dir, ...rest) {
    if (targetsPersistDir(dir)) {
      // No-op: no persistence dir is created, so `du` finds nothing to grow.
      // mkdir({recursive:true}) resolves to the first created path or undefined;
      // callers of this path ignore the result, so undefined is safe.
      return Promise.resolve(undefined);
    }
    return realMkdir.call(this, dir, ...rest);
  };

  console.log(
    "[persistence] LANGGRAPH_DISABLE_FILE_PERSISTENCE=true — FileSystemPersistence disk flush disabled (in-memory only)",
  );
}
