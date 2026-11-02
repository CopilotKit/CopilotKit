import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { EvalCase } from "./cases";
import { createFakeModel } from "./fake";
import { runSample } from "./harness";
import type { SampleOutput } from "./harness";

const FIXTURES_DIR = fileURLToPath(new URL("../fixtures/", import.meta.url));

const cache = new Map<string, Promise<SampleOutput | undefined>>();

/**
 * The reference answer of a case, run through the harness like a reply, so
 * the judge sees it in the same shape: its prose and its surfaces. The
 * reference is one great answer in the markdown transport, in
 * fixtures/reference/<id>.markdown.txt. Undefined when a case has none.
 */
export function referenceOutput(
  c: EvalCase,
  fixturesDir = FIXTURES_DIR,
): Promise<SampleOutput | undefined> {
  const key = `${fixturesDir}${c.id}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = existsSync(`${fixturesDir}reference/${c.id}.markdown.txt`)
      ? runSample({
          case: c,
          transport: "markdown",
          entry: { model: "fake:reference" },
          model: createFakeModel("fake:reference", fixturesDir),
        })
      : Promise.resolve(undefined);
    cache.set(key, pending);
  }
  return pending;
}
