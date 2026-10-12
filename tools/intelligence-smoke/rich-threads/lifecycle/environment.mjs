import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createRailwayEnvironment,
  recoverRailwayEnvironment,
} from "./railway/environment.mjs";

/** Bounded Railway milestone entry. The preserved Docker/row5 work is deferred. */
export async function createEnvironment(options, dependencies = {}) {
  assert.equal(
    options.config.provider,
    "railway",
    "This milestone requires isolated Railway",
  );
  return createRailwayEnvironment(options, dependencies);
}
export async function recoverEnvironment(
  { receiptPath, config },
  dependencies = {},
) {
  assert.equal(config.provider, "railway");
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  return recoverRailwayEnvironment(
    { config, runId: receipt.runId },
    dependencies,
  );
}
