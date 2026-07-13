// Preload module — disables @langchain/langgraph-api's FileSystemPersistence
// disk flush, gated by LANGGRAPH_DISABLE_FILE_PERSISTENCE (default: enabled).
//
// This is the TypeScript equivalent of the langgraph-python fix in PR #5825,
// which set `export LANGGRAPH_DISABLE_FILE_PERSISTENCE=true` in the python
// entrypoint so langgraph_runtime_inmem never flushes its unbounded pickle
// state to `.langgraph_api/*.pckl`. Python reads that env var at import time
// inside the runtime package; the TypeScript stack (`@langchain/langgraph-api`)
// has NO such switch, so we neutralise the flush ourselves.
//
// MECHANISM — patch the FileSystemPersistence PROTOTYPE (not the fs layer):
//   @langchain/langgraph-api's `FileSystemPersistence` (dist/storage/persist.mjs)
//   is the single writer of `.langgraph_api`. Verified against the pinned 1.1.17
//   source, ALL disk growth funnels through exactly one method:
//       async persist() { ... await fs.writeFile(this.filepath, serialize(...)) }
//   with `flush()` -> `persist()` and `schedulePersist()` arming a 3s timer that
//   also calls `persist()`. `initialize()` additionally does an empty-dir
//   `mkdir(...,{recursive:true})` (harmless, but we skip it so no dir appears).
//
//   The three consumers (checkpoint.mjs, store.mjs, server.mjs's ops) all
//   `import { FileSystemPersistence } from "./persist.mjs"` — the SAME cached ESM
//   module singleton. So patching the class prototype ONCE at preload is
//   observed by every instance they construct at import time.
//
//   WHY NOT patch fs (the previous mechanism, which was BROKEN):
//   persist.mjs does `import * as fs from "node:fs/promises"` and calls
//   `fs.writeFile(...)`. ESM named imports are LIVE BINDINGS resolved at import
//   time; reassigning `require("node:fs").promises.writeFile` does NOT rebind
//   the consumer's `fs.writeFile` (verified: after the reassignment,
//   `esmNs.writeFile !== cjs.writeFile` and the consumer still calls the
//   original). The ESM namespace's own bindings are non-configurable, so they
//   cannot be redefined either. The prior fs-monkeypatch therefore never
//   intercepted the real writer at all — disk still grew. This module fixes that
//   by neutralising the writer at its own prototype method, which is binding-
//   semantics-independent and robust.
//
//   We deep-import persist.mjs by RESOLVED FILE PATH (the package exports map
//   blocks `@langchain/langgraph-api/.../persist.mjs`, but a direct file URL
//   import bypasses the map and lands on the SAME module the package's internal
//   relative imports resolve to — verified: the two module objects are ===).
//
// F1 (scope / no data loss): patching `persist`/`schedulePersist`/`initialize`
//   touches ONLY the FileSystemPersistence class. No global fs method is
//   replaced, so there is ZERO risk of no-oping an unrelated write — the
//   over-broad-substring hazard of the old approach is gone by construction.
//
// F2 (contract + version guard): we preserve each method's async signature and
//   return type (persist/flush resolve void; initialize resolves `this`).
//   The interception is validated against 1.1.17; at preload we read the
//   installed version and, if it differs, still apply the patch (fail-safe:
//   writes disabled is the safe direction) but log a prominent WARNING to
//   re-validate persist.mjs's writer on upgrade. If the class or method is
//   missing (a major refactor), we log and leave the package untouched rather
//   than crash the agent boot.
//
// F9 (robust env parse + observable logging): LANGGRAPH_DISABLE_FILE_PERSISTENCE
//   is parsed case-insensitively for 1/true/yes/on; we log ONCE whether
//   persistence is DISABLED (with the version) or LEFT ON, so a misconfig is
//   visible in the logs.
//
// Loaded via `node --import` BEFORE liveness.mjs/server.mjs, so the prototype is
// patched before any langgraph code constructs a persistence instance.

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import * as nodePath from "node:path";

const require = createRequire(import.meta.url);

const PINNED_PACKAGE_VERSION = "1.1.17";

// F9: robust env parse — accept common truthy spellings, case-insensitive.
function parseBoolEnv(raw) {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

const disabled = parseBoolEnv(process.env.LANGGRAPH_DISABLE_FILE_PERSISTENCE);

async function applyPatch() {
  // Resolve the installed package + its version for the guard.
  let version = "unknown";
  let pkgJsonPath;
  try {
    pkgJsonPath = require.resolve("@langchain/langgraph-api/package.json");
    version = require(pkgJsonPath).version ?? "unknown";
  } catch {
    console.warn(
      `[persistence] WARNING: could not resolve @langchain/langgraph-api (expected ${PINNED_PACKAGE_VERSION}) — persistence NOT disabled. Verify the dependency is installed.`,
    );
    return;
  }
  if (version !== PINNED_PACKAGE_VERSION) {
    console.warn(
      `[persistence] WARNING: @langchain/langgraph-api is ${version}, but the FileSystemPersistence flush interception was validated against ${PINNED_PACKAGE_VERSION}. Applying it anyway (fail-safe: writes disabled), but re-verify persist.mjs's writer for this version.`,
    );
  }

  // Deep-import persist.mjs by resolved file path (bypasses the exports map,
  // lands on the same cached module the package's relative imports use).
  const persistMjs = nodePath.join(
    nodePath.dirname(pkgJsonPath),
    "dist",
    "storage",
    "persist.mjs",
  );
  let mod;
  try {
    mod = await import(pathToFileURL(persistMjs).href);
  } catch (err) {
    console.warn(
      `[persistence] WARNING: could not import ${persistMjs} (${err?.message ?? err}) — persistence NOT disabled.`,
    );
    return;
  }

  const FSP = mod.FileSystemPersistence;
  if (typeof FSP !== "function" || typeof FSP.prototype?.persist !== "function") {
    console.warn(
      `[persistence] WARNING: FileSystemPersistence.persist not found in ${persistMjs} — package internals changed; persistence NOT disabled.`,
    );
    return;
  }

  // persist(): the ONLY disk writer. No-op it (preserve async void contract).
  // We do NOT call clearTimeout here; schedulePersist below never arms a timer.
  FSP.prototype.persist = async function persist() {
    return undefined;
  };

  // schedulePersist(): would arm a 3s setTimeout(() => this.persist()). With
  // persist() no-oped this is harmless, but leaving live timers dangling keeps
  // the event loop churning and holds `this.data` referenced; make it a no-op so
  // no background flush is ever scheduled.
  if (typeof FSP.prototype.schedulePersist === "function") {
    FSP.prototype.schedulePersist = function schedulePersist() {
      return undefined;
    };
  }

  // flush() calls persist(); it already becomes a no-op through the patch above.
  // (Left unpatched intentionally so its `await this.persist()` contract holds.)

  // initialize(cwd): keep the read path (so any pre-existing state a prior
  // boot left is still LOADED into memory — matches the boot-purge + in-memory
  // model), but skip the empty-dir mkdir so no `.langgraph_api` dir is even
  // created on disk. Preserve the `=> this` return contract.
  const realInitialize = FSP.prototype.initialize;
  FSP.prototype.initialize = async function initialize(cwd) {
    // Reproduce the read-then-default behaviour WITHOUT the mkdir. We resolve
    // filepath the same way the real method does and try to load; on any error
    // fall back to the default schema. Field names mirror persist.mjs 1.1.17.
    this.filepath = nodePath.resolve(cwd, ".langgraph_api", `${this.name}`);
    try {
      this.data = await mod.deserialize(
        await require("node:fs").promises.readFile(this.filepath, "utf-8"),
      );
    } catch {
      this.data = this.defaultSchema();
    }
    // Deliberately NO mkdir: nothing is written to disk, so no dir to create.
    return this;
  };
  // Belt-and-suspenders: if a future refactor makes our re-implementation drift
  // from the real read semantics, the writer no-op (persist) still guarantees
  // zero disk growth. realInitialize retained only to avoid an unused-var lint
  // if a maintainer wants to delegate; not called by design.
  void realInitialize;

  console.log(
    `[persistence] LANGGRAPH_DISABLE_FILE_PERSISTENCE enabled — FileSystemPersistence disk flush DISABLED at the class writer (in-memory only). package @langchain/langgraph-api@${version}`,
  );
}

if (disabled) {
  await applyPatch();
} else {
  // F9: make a misconfig visible. If persistence is LEFT ON, say so once — a
  // silent no-log here was how a `LANGGRAPH_DISABLE_FILE_PERSISTENCE=1` typo
  // (truthy but not the literal "true") used to leave the flush enabled with no
  // trace in the logs.
  console.log(
    `[persistence] LANGGRAPH_DISABLE_FILE_PERSISTENCE not set to a truthy value (got: ${JSON.stringify(process.env.LANGGRAPH_DISABLE_FILE_PERSISTENCE ?? null)}) — FileSystemPersistence disk flush LEFT ON. Disk state under .langgraph_api will accumulate.`,
  );
}
