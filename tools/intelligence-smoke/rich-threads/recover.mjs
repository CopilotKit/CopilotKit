import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
import { recoverEnvironment } from "./lifecycle/environment.mjs";

const { values } = parseArgs({
  options: {
    output: { type: "string" },
    config: { type: "string" },
    "docker-host": { type: "string" },
  },
});
assert.ok(
  values.output && (values.config || values["docker-host"]),
  "--output and either --config or --docker-host required",
);
const receiptPath = join(resolve(values.output), "environment.json");
let receipt;
try {
  receipt = JSON.parse(await readFile(receiptPath, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (receipt && receipt.status !== "cleaned") {
  const config = values.config
    ? JSON.parse(await readFile(resolve(values.config), "utf8"))
    : undefined;
  if (config)
    assert.equal(
      receipt.provider,
      config.provider,
      "Recovery provider must match the retained receipt",
    );
  const result = await recoverEnvironment({
    receiptPath,
    config,
    dockerHost: values["docker-host"] ?? config?.dockerHost,
  });
  console.log(`Owned environment recovery: ${result.status}`);
} else
  console.log(
    receipt
      ? "Owned environment already cleaned"
      : "No environment was provisioned",
  );
