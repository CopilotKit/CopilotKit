import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runCanary, inspectCanary, cleanupCanary } from "./isolation.mjs";

const [mode, root, scopePath] = process.argv.slice(2);
assert.ok(
  ["run", "inspect", "cleanup"].includes(mode) && root,
  "Usage: node --import tsx canary/cli.mjs run <new-journal-directory> <reviewed-scope.json> | inspect|cleanup <journal-directory>",
);
const args = { root: resolve(root) };
try {
  let result;
  if (mode === "run") {
    assert.ok(scopePath, "Exact reviewed scope file required");
    args.scope = JSON.parse(await readFile(scopePath, "utf8"));
    result = await runCanary(args);
  } else if (mode === "inspect") result = await inspectCanary(args);
  else result = await cleanupCanary(args);
  const state = result.journal ?? result;
  console.log(
    JSON.stringify({
      journalDirectory: args.root,
      status: state.status,
      result: state.result,
      cleanup: state.cleanup,
    }),
  );
} catch {
  console.error(
    "Canary stopped; inspect the private journal before any further writes.",
  );
  process.exitCode = 1;
}
