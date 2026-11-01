import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

/** Load the default fixed model or an explicit local model with the same proof contract. */
export async function loadModelModule(path) {
  if (path !== undefined && !isAbsolute(path)) {
    throw new Error("Smoke model module path must be absolute.");
  }
  const model = await import(
    path === undefined ? "./model.mjs" : pathToFileURL(path).href
  );
  if (!model.scenario || typeof model.scenario !== "object") {
    throw new Error("Smoke model module needs a scenario.");
  }
  for (const name of [
    "threadId",
    "runId",
    "userMessageId",
    "prompt",
    "reply",
  ]) {
    if (
      typeof model.scenario[name] !== "string" ||
      !model.scenario[name].trim()
    ) {
      throw new Error(`Smoke model scenario needs ${name}.`);
    }
  }
  for (const name of ["startModel", "expectedCitationIds"]) {
    if (typeof model[name] !== "function") {
      throw new Error(`Smoke model module needs ${name}.`);
    }
  }
  return { ...model, path };
}
