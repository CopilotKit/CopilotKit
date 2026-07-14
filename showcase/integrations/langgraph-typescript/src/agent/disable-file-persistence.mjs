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
//   @langchain/langgraph-api's `FileSystemPersistence`
//   (dist/storage/persist.mjs) is the single writer for all three persist
//   targets (.langgraphjs_ops.json, .langgraphjs_api.store.json,
//   .langgraphjs_api.checkpointer.json — all under a `.langgraph_api/` dir).
//   Its module singletons (checkpointer, store, ops) are constructed at import
//   time and are NOT exported, and the package's exports map blocks a deep
//   import of persist.mjs (ERR_PACKAGE_PATH_NOT_EXPORTED), so the class
//   prototype cannot be patched from here. Intercepting the fs write surface
//   for the persist dir fully stops disk growth while leaving the in-memory
//   store — the actual runtime state — untouched. Conversation/thread/run
//   state still works within a container's lifetime; it just never persists to
//   disk. This matches python's behaviour: in-memory state bounded by process
//   memory, discarded on restart, nothing accumulating on disk to trip the
//   size watchdog.
//
// Why the CJS handle (and not `import * as fs from "node:fs/promises"`):
//   An ESM namespace object is sealed — `fsPromises.writeFile = ...` throws
//   "Cannot assign to read only property". The writable seam is the CJS
//   `require("node:fs").promises` object; the package reaches fs/promises via
//   `import * as fs from "node:fs/promises"` and calls `fs.writeFile(...)`
//   (NAMESPACE property access — verified in persist.mjs@1.1.17), which reads
//   through to that same live object, so patching it there IS observed. NOTE:
//   this holds for namespace/property-access calls; it does NOT hold for NAMED
//   imports (`import { writeFile } from "node:fs/promises"`), whose bindings
//   Node snapshots at link time. Two guards make a silent regression
//   impossible: (1) the source-shape guard below fails loudly if the package
//   ever switches to a named-import form (or drops the fs.writeFile call), and
//   (2) a runtime binding-identity assertion (end of this module) imports the
//   node:fs/promises namespace AFTER patching and throws if any patched member
//   is not identity-equal to the function we installed — catching the case
//   where fs/promises was LINKED before the reassignment ran and the namespace
//   snapshotted the ORIGINAL (unpatched) reference.
//
// Why anchor on the resolved persist-dir path (and not a bare substring):
//   The persist dir is `path.resolve(cwd, ".langgraph_api", <name>)`. We match
//   the `.langgraph_api` path SEGMENT (a `/.langgraph_api/` boundary or a
//   trailing `/.langgraph_api`), not a bare `.includes(".langgraph_api")`, so
//   an unrelated path that merely embeds the token (e.g.
//   `/tmp/x.langgraph_api.log`, `.langgraph_api_backup`) is NOT silently
//   dropped. String, Buffer, and URL path forms are all normalised first.
//
// Why patch every write surface (and not just writeFile + mkdir):
//   persist.mjs@1.1.17 writes ONLY via `fs.writeFile` + `fs.mkdir`. But an
//   atomic write-then-rename, appendFile, open()+handle.write, a *Sync variant,
//   or createWriteStream would each bypass a writeFile-only patch and let the
//   dir grow again with zero signal (the exact recurring-outage failure mode).
//   We therefore neutralise every fs write surface — async promises, sync, and
//   handle/stream openers — for the persist dir. Reads (readFile/readdir/stat)
//   pass through untouched so in-lifetime read-back still works.
//
// Loaded via `node --import` BEFORE liveness.mjs/server.mjs, so the patch is in
// place before any langgraph code touches the filesystem.

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const PERSIST_MARKER = ".langgraph_api";

// Accept the common truthy bool conventions (case-insensitive) so an operator
// setting `=1` / `=yes` / `=TRUE` is not silently ignored (which would re-enable
// unbounded persistence and recur the outage with no diagnostic).
const rawFlag = String(
  process.env.LANGGRAPH_DISABLE_FILE_PERSISTENCE ?? "",
).trim();
const disabled = ["1", "true", "yes", "on"].includes(rawFlag.toLowerCase());

if (!disabled) {
  // Log on the NOT-disabled branch too, so a misconfiguration (typo, wrong
  // value) is diagnosable from the boot log rather than presenting as a silent
  // return of the disk-growth outage.
  console.log(
    `[persistence] LANGGRAPH_DISABLE_FILE_PERSISTENCE not enabled ` +
      `(value=${JSON.stringify(rawFlag)}) — FileSystemPersistence disk flush ` +
      `is ACTIVE; .langgraph_api will grow on disk`,
  );
} else {
  const require = createRequire(import.meta.url);
  const fs = require("node:fs");
  const fsPromises = fs.promises;

  // --- Version / writer-shape guard -------------------------------------
  // The interception below is coupled to how @langchain/langgraph-api writes:
  // namespace `fs.*` calls (not named imports) and only through the surfaces we
  // patch. If a version bump changes the pinned version OR the persist.mjs
  // source no longer matches the expected writer shape, FAIL LOUDLY at boot so
  // the mismatch is caught here and not as a silent disk-growth outage in prod.
  const EXPECTED_PKG_VERSION = "1.1.17";
  try {
    const pkgJsonPath =
      require.resolve("@langchain/langgraph-api/package.json");
    const installed = require(pkgJsonPath).version;
    if (installed !== EXPECTED_PKG_VERSION) {
      throw new Error(
        `@langchain/langgraph-api is ${installed}, but the fs-write ` +
          `interception was verified against ${EXPECTED_PKG_VERSION}. ` +
          `Re-verify persist.mjs's write surfaces and import form (see ` +
          `disable-file-persistence.mjs header), then bump EXPECTED_PKG_VERSION. ` +
          `Refusing to boot with an unverified writer shape.`,
      );
    }
    // Confirm the writer still uses namespace fs access (not a named import)
    // and still writes via fs.writeFile. Reading the source is a cheap, robust
    // shape check. persist.mjs sits at <pkgRoot>/dist/storage/persist.mjs.
    const pkgRoot = pkgJsonPath.slice(0, -"package.json".length);
    const persistSrc = fs.readFileSync(
      `${pkgRoot}dist/storage/persist.mjs`,
      "utf-8",
    );
    // Tolerant shape check: match the namespace-import form regardless of
    // cosmetic reformatting (whitespace runs, single/double quotes) so a benign
    // re-spaced / re-quoted / lightly-minified dist bump that STILL uses a
    // namespace import does NOT crash boot. We only fail loud on a genuine
    // writer-shape change (e.g. a switch to a named import, or dropping the
    // fs.writeFile call). Capture the namespace alias and verify the write call
    // uses that SAME alias (`<alias>.writeFile(`), so a rename of the imported
    // binding is still validated correctly.
    const nsImportRe =
      /import\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s+from\s*['"]node:fs\/promises['"]/;
    const nsMatch = nsImportRe.exec(persistSrc);
    const writerAlias = nsMatch ? nsMatch[1] : null;
    const writeCallRe = writerAlias
      ? new RegExp(`\\b${writerAlias}\\.writeFile\\s*\\(`)
      : null;
    if (
      writerAlias === null ||
      writeCallRe === null ||
      !writeCallRe.test(persistSrc)
    ) {
      throw new Error(
        `persist.mjs no longer uses \`import * as fs from "node:fs/promises"\` ` +
          `+ \`fs.writeFile(...)\`. The namespace-access interception may no ` +
          `longer be observed. Re-verify the writer shape before trusting the ` +
          `persistence disable.`,
      );
    }
  } catch (err) {
    // A hard failure here is intentional: a wrong writer shape must NOT boot
    // silently. Re-throw to crash the process with a clear message.
    console.error(
      "[persistence] version/shape guard failed:",
      err && err.message ? err.message : err,
    );
    throw err;
  }

  // --- Path matching -----------------------------------------------------
  // Normalise string | Buffer | URL path forms to a string, then match the
  // `.langgraph_api` path SEGMENT (boundary-anchored), not a bare substring.
  const toPathString = (p) => {
    if (typeof p === "string") return p;
    if (p instanceof URL) {
      try {
        return fileURLToPath(p);
      } catch {
        return null;
      }
    }
    if (Buffer.isBuffer(p)) return p.toString("utf-8");
    // Numeric fd or FileHandle — not a path we can classify; treat as non-match
    // (a bare fd is only obtained via open(), which we already gate below).
    return null;
  };

  // Matches `<...>/.langgraph_api` or `<...>/.langgraph_api/<...>` (POSIX or
  // Windows separators), but NOT `.langgraph_api_backup` or `x.langgraph_api`.
  const persistDirRe = new RegExp(
    `(^|[\\\\/])${PERSIST_MARKER.replace(/\./g, "\\.")}([\\\\/]|$)`,
  );
  const targetsPersistDir = (p) => {
    const s = toPathString(p);
    return s != null && persistDirRe.test(s);
  };

  // For a suppressed `mkdir({recursive:true})`, the real fs contract returns the
  // FIRST (topmost) directory actually created — not the requested leaf. When a
  // fresh persist tree is created the topmost new dir is the `.langgraph_api`
  // segment itself (its parent, the cwd, already exists), so we report the path
  // truncated at (and including) that segment. This keeps a caller that branches
  // on the recursive-create return value consistent with the real contract even
  // though we create nothing on disk. Returns the requested path unchanged if the
  // segment can't be located (defensive; targetsPersistDir already matched it).
  const persistDirRoot = (p) => {
    const str = toPathString(p);
    if (str == null) return str;
    // Split on either separator, find the `.langgraph_api` segment, rejoin up to
    // and including it (preserving the original separator style via a regex that
    // keeps the leading portion + the segment).
    const m = new RegExp(
      `^(.*?[\\\\/]?${PERSIST_MARKER.replace(/\./g, "\\.")})(?:[\\\\/]|$)`,
    ).exec(str);
    return m ? m[1] : str;
  };

  // One-time observable signal that an interception actually fired, so an
  // operator can confirm the patch is live on the real write path (and, if the
  // dir ever DOES grow, distinguish "patch never fired" from "write slipped
  // through an unpatched surface").
  let firstHitLogged = false;
  const noteHit = (surface, target) => {
    if (!firstHitLogged) {
      firstHitLogged = true;
      console.log(
        `[persistence] intercepted first persist-dir write via ${surface} ` +
          `(target=${target}); further hits silent`,
      );
    }
  };

  // Construct an ENOENT-shaped error so a suppressed-path READ presents to the
  // caller exactly as if the file does not exist — the caller then takes its
  // missing-file/default branch (persist.mjs: a missing checkpoint file yields
  // the empty-state default) rather than parsing an empty buffer as JSON.
  const makeEnoent = (syscall, target) => {
    const err = new Error(
      `ENOENT: no such file or directory, ${syscall} '${target}'`,
    );
    err.code = "ENOENT";
    err.errno = -2;
    err.syscall = syscall;
    err.path = target;
    return err;
  };

  // A read-only open (flags "r"/"rs"/undefined default) must ENOENT for a
  // suppressed path; a write-intent open (w/a/r+/w+/a+/...) gets a no-op handle
  // so writes are swallowed without growing the dir.
  const isReadOnlyFlags = (flags) => {
    if (flags === undefined) return true; // fs default is "r"
    const f = typeof flags === "number" ? null : String(flags);
    // Numeric flag: cannot cheaply classify → treat as write-intent (no-op
    // handle) to preserve the swallow-writes invariant; a numeric read-only
    // open of a suppressed file is not a path this package exercises.
    if (f === null) return false;
    // Read-only iff it contains no write/append/create/truncate indicators.
    return !/[wa+]/.test(f);
  };

  // --- Async (fs.promises) surfaces --------------------------------------
  const realWriteFile = fsPromises.writeFile;
  const realAppendFile = fsPromises.appendFile;
  const realMkdir = fsPromises.mkdir;
  const realRename = fsPromises.rename;
  const realCp = fsPromises.cp;
  const realOpen = fsPromises.open;

  fsPromises.writeFile = function writeFile(file, ...rest) {
    if (targetsPersistDir(file)) {
      noteHit("promises.writeFile", toPathString(file));
      return Promise.resolve();
    }
    return realWriteFile.call(this, file, ...rest);
  };

  fsPromises.appendFile = function appendFile(file, ...rest) {
    if (targetsPersistDir(file)) {
      noteHit("promises.appendFile", toPathString(file));
      return Promise.resolve();
    }
    return realAppendFile.call(this, file, ...rest);
  };

  fsPromises.mkdir = function mkdir(dir, ...rest) {
    if (targetsPersistDir(dir)) {
      noteHit("promises.mkdir", toPathString(dir));
      // Honour the `{recursive:true}` return contract: real mkdir resolves to
      // the first-created directory path (or undefined if it already existed).
      // We report the requested dir as "created" so a caller that branches on
      // the return value sees a consistent recursive-create result.
      const opts = rest[0];
      const recursive =
        opts && typeof opts === "object" && opts.recursive === true;
      return Promise.resolve(recursive ? persistDirRoot(dir) : undefined);
    }
    return realMkdir.call(this, dir, ...rest);
  };

  fsPromises.rename = function rename(src, dest, ...rest) {
    // Drop the write if EITHER endpoint is in the persist dir (a *.tmp→final
    // atomic-write-then-rename lands the payload IN the persist dir).
    if (targetsPersistDir(src) || targetsPersistDir(dest)) {
      noteHit("promises.rename", toPathString(dest) ?? toPathString(src));
      return Promise.resolve();
    }
    return realRename.call(this, src, dest, ...rest);
  };

  if (typeof realCp === "function") {
    fsPromises.cp = function cp(src, dest, ...rest) {
      if (targetsPersistDir(dest)) {
        noteHit("promises.cp", toPathString(dest));
        return Promise.resolve();
      }
      return realCp.call(this, src, dest, ...rest);
    };
  }

  fsPromises.open = function open(pth, flags, ...rest) {
    if (targetsPersistDir(pth)) {
      noteHit("promises.open", toPathString(pth));
      // Read-only open of a suppressed file must reject ENOENT (as if missing)
      // so the caller hits its missing-file default branch — NOT an empty
      // handle whose read yields "" and mis-parses. A write-intent open gets a
      // no-op handle so writes are swallowed without growing the dir.
      if (isReadOnlyFlags(flags)) {
        return Promise.reject(makeEnoent("open", toPathString(pth)));
      }
      return Promise.resolve(makeNoopFileHandle());
    }
    return realOpen.call(this, pth, flags, ...rest);
  };

  // --- Sync surfaces -----------------------------------------------------
  const realWriteFileSync = fs.writeFileSync;
  const realAppendFileSync = fs.appendFileSync;
  const realMkdirSync = fs.mkdirSync;
  const realRenameSync = fs.renameSync;
  const realOpenSync = fs.openSync;

  fs.writeFileSync = function writeFileSync(file, ...rest) {
    if (targetsPersistDir(file)) {
      noteHit("writeFileSync", toPathString(file));
      return undefined;
    }
    return realWriteFileSync.call(this, file, ...rest);
  };

  fs.appendFileSync = function appendFileSync(file, ...rest) {
    if (targetsPersistDir(file)) {
      noteHit("appendFileSync", toPathString(file));
      return undefined;
    }
    return realAppendFileSync.call(this, file, ...rest);
  };

  fs.mkdirSync = function mkdirSync(dir, ...rest) {
    if (targetsPersistDir(dir)) {
      noteHit("mkdirSync", toPathString(dir));
      const opts = rest[0];
      const recursive =
        opts && typeof opts === "object" && opts.recursive === true;
      return recursive ? persistDirRoot(dir) : undefined;
    }
    return realMkdirSync.call(this, dir, ...rest);
  };

  fs.renameSync = function renameSync(src, dest, ...rest) {
    if (targetsPersistDir(src) || targetsPersistDir(dest)) {
      noteHit("renameSync", toPathString(dest) ?? toPathString(src));
      return undefined;
    }
    return realRenameSync.call(this, src, dest, ...rest);
  };

  fs.openSync = function openSync(pth, flags, ...rest) {
    if (targetsPersistDir(pth)) {
      noteHit("openSync", toPathString(pth));
      // Read-only openSync of a suppressed file must throw ENOENT (as if
      // missing) so the caller takes its missing-file branch — not read EOF
      // from a /dev/null fd and mis-handle the empty payload. A write-intent
      // openSync hands back a real /dev/null fd so subsequent fd writes are
      // discarded but the fd is valid (closeSync etc. behave).
      if (isReadOnlyFlags(flags)) {
        throw makeEnoent("open", toPathString(pth));
      }
      return realOpenSync.call(this, "/dev/null", "r+");
    }
    return realOpenSync.call(this, pth, flags, ...rest);
  };

  // --- Stream opener -----------------------------------------------------
  const realCreateWriteStream = fs.createWriteStream;
  fs.createWriteStream = function createWriteStream(pth, ...rest) {
    if (targetsPersistDir(pth)) {
      noteHit("createWriteStream", toPathString(pth));
      // Stream writes to /dev/null so the persist dir never grows but the
      // stream contract (writable, 'finish'/'close' events) is preserved.
      return realCreateWriteStream.call(this, "/dev/null", ...rest);
    }
    return realCreateWriteStream.call(this, pth, ...rest);
  };

  // --- Runtime binding-identity assertion (the ordering-safety net) ------
  // The interception above works by MUTATING properties on the live
  // `require("node:fs").promises` object. A consumer reaches these via
  // `import * as fs from "node:fs/promises"; fs.writeFile(...)` — a namespace
  // property access that reads THROUGH to that same live object, so the patch
  // is observed. BUT an ESM namespace binding snapshots the function reference
  // at the importing module's LINK time. If anything links `node:fs/promises`
  // BEFORE the reassignment above (an earlier-ordered `--import`, a future edit
  // that imports fs/promises before patching, or a Node-internal pre-link), the
  // consumer's `fs.writeFile` resolves to the ORIGINAL function and every
  // persist write SILENTLY bypasses the patch — the dir refills and the outage
  // recurs with zero signal. The source-string guard above cannot catch this
  // (it checks text, not runtime identity).
  //
  // So: import the namespace HERE (after patching) and assert each patched
  // member is identity-equal to the function we installed. A mismatch means the
  // seam is not live for that member — FAIL BOOT LOUDLY naming the member rather
  // than continue into a silent disk-growth outage. Top-level await is valid in
  // an ESM `--import` preload and completes before any langgraph code runs.
  const ns = await import("node:fs/promises");
  const patchedMembers = {
    writeFile: fsPromises.writeFile,
    appendFile: fsPromises.appendFile,
    mkdir: fsPromises.mkdir,
    rename: fsPromises.rename,
    open: fsPromises.open,
  };
  // `cp` is only patched when the runtime provides it (older Node lacks it).
  if (typeof realCp === "function") {
    patchedMembers.cp = fsPromises.cp;
  }
  const mismatches = [];
  for (const [name, patchedFn] of Object.entries(patchedMembers)) {
    // The namespace member MUST be the exact function object we installed on
    // the live promises object. If it is not, a consumer importing the
    // namespace will call the pre-patch original and bypass the no-op.
    if (ns[name] !== patchedFn) {
      mismatches.push(name);
    }
  }
  if (mismatches.length > 0) {
    const msg =
      `[persistence] FATAL: node:fs/promises namespace binding does NOT reflect ` +
      `the installed patch for: ${mismatches.join(", ")}. This means the ` +
      `fs/promises namespace was LINKED BEFORE the interception was installed, ` +
      `so @langchain/langgraph-api's \`fs.${mismatches[0]}(...)\` would call the ` +
      `ORIGINAL function and silently refill .langgraph_api on disk — the exact ` +
      `recurring-outage failure mode. Refusing to boot. Ensure ` +
      `disable-file-persistence.mjs is the FIRST \`--import\` and that nothing ` +
      `links node:fs/promises before its property reassignments run.`;
    console.error(msg);
    throw new Error(msg);
  }

  console.log(
    "[persistence] LANGGRAPH_DISABLE_FILE_PERSISTENCE enabled " +
      `(value=${JSON.stringify(rawFlag)}) — FileSystemPersistence disk flush ` +
      "disabled across all fs write surfaces (in-memory only); " +
      `namespace binding-identity verified for ${Object.keys(patchedMembers).length} members`,
  );
}

// A minimal FileHandle-shaped stub whose writes are swallowed. Only the members
// a persistence writer plausibly touches are implemented; everything resolves
// so a caller's `await` completes normally.
function makeNoopFileHandle() {
  return {
    write: () => Promise.resolve({ bytesWritten: 0, buffer: Buffer.alloc(0) }),
    writeFile: () => Promise.resolve(),
    appendFile: () => Promise.resolve(),
    truncate: () => Promise.resolve(),
    sync: () => Promise.resolve(),
    datasync: () => Promise.resolve(),
    read: () => Promise.resolve({ bytesRead: 0, buffer: Buffer.alloc(0) }),
    readFile: () => Promise.resolve(Buffer.alloc(0)),
    stat: () => Promise.resolve({ size: 0 }),
    close: () => Promise.resolve(),
    [Symbol.asyncDispose]: () => Promise.resolve(),
  };
}
