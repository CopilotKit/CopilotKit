// Real-package red-green for the FileSystemPersistence disk-flush interception.
//
// Drives the REAL installed @langchain/langgraph-api@1.1.17 FileSystemPersistence
// class (NOT a stub) under write load and asserts:
//   RED   — without the interception, .langgraph_api GROWS on disk (bytes > 0).
//   GREEN — with the interception (disable-file-persistence.mjs) active, the
//           SAME write load leaves .langgraph_api at 0 bytes / absent, AND the
//           in-memory state still round-trips (runtime state intact).
//   F2    — flush()/persist() still resolve (async void contract preserved);
//           initialize() still resolves `this`.
//
// The package's exports map blocks a deep import of persist.mjs, so we resolve
// its on-disk path and import it by file URL to get the REAL class (the SAME
// cached module the package's internal relative imports use).
//
// The interception patches the class PROTOTYPE, which is process-global for the
// cached module, so RED must run FIRST (capturing the real prototype methods),
// then we import the patch module and run GREEN against the patched prototype.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import * as nodePath from "node:path";
import { mkdtempSync, rmSync, existsSync, statSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";

const require = createRequire(import.meta.url);
const __dirname = nodePath.dirname(fileURLToPath(import.meta.url));

// Locate the agent dir (this test lives at tests/node/, agent at src/agent/).
const AGENT_DIR = nodePath.resolve(__dirname, "..", "..", "src", "agent");
const PKG_JSON = require.resolve("@langchain/langgraph-api/package.json", {
  paths: [AGENT_DIR],
});
const PKG_DIR = nodePath.dirname(PKG_JSON);
const PERSIST_MJS = nodePath.join(PKG_DIR, "dist", "storage", "persist.mjs");

function dirBytes(dir) {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const name of readdirSync(dir)) {
    const p = nodePath.join(dir, name);
    const st = statSync(p);
    total += st.isDirectory() ? dirBytes(p) : st.size;
  }
  return total;
}

// Load enough state to push the serialized string into the MBs, then flush.
async function loadAndFlush(persistence, rounds) {
  for (let i = 0; i < rounds; i++) {
    await persistence.with(async (data) => {
      data.blobs ??= [];
      data.blobs.push({ id: i, payload: "x".repeat(64 * 1024) }); // ~64KB each
    });
  }
  await persistence.flush();
}

test("real-package red-green: FileSystemPersistence disk-flush interception", async () => {
  // Import the REAL class BEFORE the patch module — this is the RED prototype.
  const mod = await import(pathToFileURL(PERSIST_MJS).href);
  const { FileSystemPersistence } = mod;
  assert.equal(typeof FileSystemPersistence, "function", "real class loaded");

  // ---- RED: no interception — real package writes to disk -----------------
  const redCwd = mkdtempSync(nodePath.join(tmpdir(), "lgt-red-"));
  const redPersistDir = nodePath.join(redCwd, ".langgraph_api");
  let redBytes = 0;
  try {
    const p = new FileSystemPersistence("red.checkpointer.json", () => ({}));
    const initRet = await p.initialize(redCwd);
    assert.equal(initRet, p, "initialize() returns this (real contract)");
    await loadAndFlush(p, 40);
    redBytes = dirBytes(redPersistDir);
    console.log(`[RED]  no interception: ${redPersistDir} = ${redBytes} bytes on disk`);
    assert.ok(redBytes > 1_000_000, `RED: persist dir MUST grow >1MB without the fix, got ${redBytes}`);
  } finally {
    rmSync(redCwd, { recursive: true, force: true });
  }

  // ---- Apply the interception (patches the shared class prototype) ---------
  process.env.LANGGRAPH_DISABLE_FILE_PERSISTENCE = "true";
  const patchUrl =
    pathToFileURL(nodePath.join(AGENT_DIR, "disable-file-persistence.mjs")).href +
    `?t=${Date.now()}`;
  await import(patchUrl);

  // ---- GREEN: interception active — same load, zero disk -------------------
  const greenCwd = mkdtempSync(nodePath.join(tmpdir(), "lgt-green-"));
  const greenPersistDir = nodePath.join(greenCwd, ".langgraph_api");
  let greenBytes = -1;
  let roundTripOk = false;
  let flushResolved = false;
  try {
    const p = new FileSystemPersistence("green.checkpointer.json", () => ({}));
    const initRet = await p.initialize(greenCwd);
    assert.equal(initRet, p, "F2: patched initialize() still returns this");
    await loadAndFlush(p, 40);
    flushResolved = true; // flush() awaited without throwing
    greenBytes = dirBytes(greenPersistDir);
    console.log(`[GREEN] interception active: ${greenPersistDir} = ${greenBytes} bytes on disk`);

    // In-memory round-trip: the data we wrote is still readable (runtime intact).
    await p.with(async (data) => {
      roundTripOk = Array.isArray(data.blobs) && data.blobs.length === 40;
    });
    console.log(`[GREEN] in-memory round-trip (40 blobs present): ${roundTripOk}`);
    console.log(`[GREEN] flush()/persist() resolved without throwing: ${flushResolved}`);

    assert.equal(greenBytes, 0, "GREEN: persist dir MUST stay 0 bytes with the fix");
    assert.ok(roundTripOk, "GREEN: in-memory runtime state must still round-trip");
    assert.ok(flushResolved, "F2: flush()/persist() must still resolve (async void)");
  } finally {
    rmSync(greenCwd, { recursive: true, force: true });
    delete process.env.LANGGRAPH_DISABLE_FILE_PERSISTENCE;
  }

  console.log(`\n[SUMMARY] RED=${redBytes} bytes (grew) -> GREEN=${greenBytes} bytes (flat). round-trip=${roundTripOk}`);
});
