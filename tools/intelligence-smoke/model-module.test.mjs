import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadModelModule } from "./model-module.mjs";

test("the default smoke model keeps its current contract", async () => {
  const model = await loadModelModule();
  assert.equal(typeof model.scenario.reply, "string");
  assert.equal(typeof model.startModel, "function");
  assert.equal(typeof model.expectedCitationIds, "function");
});

test("an absolute local module supplies the same contract", async () => {
  const directory = await mkdtemp(join(tmpdir(), "smoke-model-module-"));
  try {
    const path = join(directory, "model.mjs");
    await writeFile(
      path,
      'export const scenario = { threadId: "thread", runId: "run", userMessageId: "user", prompt: "Prompt", reply: "Local reply" };\n' +
        "export const startModel = () => ({});\n" +
        "export const expectedCitationIds = () => [];\n",
    );
    const model = await loadModelModule(path);
    assert.equal(model.scenario.reply, "Local reply");
    assert.equal(model.path, path);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a relative path and an incomplete module fail before the cluster starts", async () => {
  await assert.rejects(loadModelModule("relative.mjs"), /absolute/);
  const directory = await mkdtemp(join(tmpdir(), "smoke-model-module-"));
  try {
    const path = join(directory, "model.mjs");
    await writeFile(
      path,
      'export const scenario = { threadId: "thread", runId: "run", userMessageId: "user", prompt: "Prompt", reply: "Local reply" };\n',
    );
    await assert.rejects(loadModelModule(path), /startModel/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
