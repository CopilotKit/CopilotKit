import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
import { recoverEnvironment } from "./lifecycle/environment.mjs";

const { values } = parseArgs({
  options: { output: { type: "string" }, "docker-host": { type: "string" } },
});
assert.ok(
  values.output && values["docker-host"],
  "--output and --docker-host required",
);
const receiptPath = join(resolve(values.output), "environment.json");
let receipt;
try {
  receipt = JSON.parse(await readFile(receiptPath, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (receipt && receipt.status !== "cleaned") {
  const result = await recoverEnvironment({
    receiptPath,
    dockerHost: values["docker-host"],
  });
  console.log(`Owned environment recovery: ${result.status}`);
} else
  console.log(
    receipt
      ? "Owned environment already cleaned"
      : "No environment was provisioned",
  );
