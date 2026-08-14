/**
 * GATE 1. Prints the distinct chunk shapes `@tanstack/ai-codex` emits.
 *
 * Both arms need this and neither can be written correctly without it: Arm A's
 * mapper matches on these `type` strings, and Arm C depends on
 * `convertTanStackStream` recognising them. Guessing here produces a mapper
 * matching strings the harness never emits — a permanently-empty console that
 * looks like a broken harness rather than a broken mapper.
 *
 * The headline claim of the whole feature is VISIBLE THINKING, so knowing which
 * `type` exists is not enough: a reasoning chunk whose text field is always the
 * empty string satisfies every `type` check and still renders a blank console.
 * That is why this probe also accumulates, per type, how many characters of
 * text-shaped payload actually arrived — the gate is answered by that number,
 * not by the presence of a type name.
 *
 * The gate PASSED, and re-running is neither free nor necessary: a run spawns a
 * real codex process for ~45-60s and bills real tokens. What it found is written
 * up in `docs/superpowers/plans/2026-08-14-probe-findings.md`; read that first,
 * and run this only to re-catalogue after a `@tanstack/ai*` bump or a `run.ts`
 * config change. The three findings most easily got wrong:
 * reasoning text is `REASONING_MESSAGE_CONTENT.delta` and there is NO `content`
 * field on it; tool calls arrive ALREADY RESOLVED (START/ARGS/END from one item,
 * same timestamp, `delta === args`) and must never be executed; and
 * `sandbox.file` / `codex.session-id` are `CUSTOM` chunks discriminated by
 * `name`, so a branch matching `type === "sandbox.file"` never fires.
 *
 * Run: NODE_OPTIONS="--conditions=import" pnpm tsx scripts/probe-harness-chunks.ts
 *
 * No env knobs. `run.ts` now carries the model and the reasoning-summary config
 * this probe once had to override (see its comments) — a bare run reaches the
 * model and streams reasoning.
 *
 * The `NODE_OPTIONS` prefix is REQUIRED, and a bare `pnpm tsx` fails before the
 * first chunk with `ERR_PACKAGE_PATH_NOT_EXPORTED`. This app's `package.json`
 * has no `"type": "module"`, so tsx loads every `.ts` here as CJS, while
 * `@tanstack/ai`'s exports map declares an `import` condition and NO `require`
 * one — so `require("@tanstack/ai")` finds no target at all. Adding `import` as
 * a user condition makes the require resolver match that key, and Node 22's
 * `require(esm)` then evaluates it. Nothing about the app is affected: Next
 * bundles these same modules as ESM, so the mismatch exists only for this
 * script runner.
 */
import { createExpenseHarnessStream } from "../src/skins/banking/harness/run";
import { prepareWorkspace } from "../src/skins/banking/harness/workspace";

/** Field names that plausibly carry streamed prose on any chunk shape. */
const TEXT_FIELDS = ["text", "delta", "content", "reasoning", "summary"];

type Observation = {
  count: number;
  /** First payload seen for this type, truncated. */
  first: string;
  /** First payload for this type whose text-shaped fields were NON-empty. */
  firstWithText: string | null;
  /** Total characters of text-shaped payload across every chunk of this type. */
  textChars: number;
  /** Every key ever seen on a chunk of this type, so a rare field is not lost. */
  keys: Set<string>;
  /**
   * The `name` values seen on this type, and the first payload for each.
   *
   * `CUSTOM` is the reason this field exists. Distinct signals all arrive under
   * that ONE chunk `type` and are told apart only by `name`, so a mapper
   * switching on `type` alone collapses them and a `type === "sandbox.file"`
   * branch never fires at all. Cataloguing types without their names hides that.
   *
   * Observed: `codex.session-id` (once, right after `RUN_STARTED`) and
   * `sandbox.file`. A third, `sandbox.file.diff`, is minted by `@tanstack/ai`
   * but did NOT appear — it needs `fileEvents.diff`, which `run.ts` leaves off.
   */
  names: Map<string, string>;
};

/** Sum the lengths of any string-valued text-shaped field on this chunk. */
const textLengthOf = (chunk: unknown): number => {
  if (typeof chunk !== "object" || chunk === null) return 0;
  const record = chunk as Record<string, unknown>;
  let total = 0;
  for (const field of TEXT_FIELDS) {
    const value = record[field];
    if (typeof value === "string") total += value.length;
  }
  return total;
};

/** Drain one stream, printing each distinct type once and tallying the rest. */
const drain = async (
  stream: AsyncIterable<unknown>,
  seen: Map<string, Observation>,
): Promise<{ total: number; error: unknown }> => {
  let total = 0;
  try {
    for await (const chunk of stream) {
      total += 1;
      const type = (chunk as { type?: string }).type ?? "(no type field)";
      const payload = JSON.stringify(chunk) ?? String(chunk);
      const chars = textLengthOf(chunk);

      let observation = seen.get(type);
      if (!observation) {
        observation = {
          count: 0,
          first: payload.slice(0, 400),
          firstWithText: null,
          textChars: 0,
          keys: new Set(),
          names: new Map(),
        };
        seen.set(type, observation);
        console.log(`\n=== ${type}\n${observation.first}`);
      }
      const name = (chunk as { name?: unknown }).name;
      if (typeof name === "string" && !observation.names.has(name)) {
        observation.names.set(name, payload.slice(0, 400));
        console.log(`\n--- ${type} name="${name}"\n${payload.slice(0, 400)}`);
      }
      observation.count += 1;
      observation.textChars += chars;
      if (chars > 0 && observation.firstWithText === null) {
        observation.firstWithText = payload.slice(0, 400);
        console.log(
          `\n--- ${type} (first with non-empty text)\n${observation.firstWithText}`,
        );
      }
      if (typeof chunk === "object" && chunk !== null) {
        for (const key of Object.keys(chunk)) observation.keys.add(key);
      }
    }
  } catch (cause) {
    return { total, error: cause };
  }
  return { total, error: null };
};

const PROMPT =
  "Search the web to find out what kind of business The Copper Room in " +
  'Austin is, then write what you found to summary.json as {"kind":"..."}.';

const main = async () => {
  const { dir, summaryPath } = await prepareWorkspace(
    "date,merchant,amount,city,card_last4,description\n" +
      "2026-07-15,The Copper Room,412.88,Austin,4242,CARD PURCHASE\n",
  );
  console.log(`workspace: ${dir}`);

  const seen = new Map<string, Observation>();
  const startedAt = Date.now();
  const abortSignal = new AbortController().signal;

  console.log("\n>>> driving createExpenseHarnessStream (run.ts)");
  const { total, error } = await drain(
    createExpenseHarnessStream({ dir, prompt: PROMPT, abortSignal }),
    seen,
  );

  const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);

  console.log(`\n\n========== SUMMARY ==========`);
  console.log(`elapsed: ${elapsedSeconds}s   chunks: ${total}`);
  for (const [type, observation] of [...seen].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    console.log(
      `${type}\n  count=${observation.count} textChars=${observation.textChars} ` +
        `keys=[${[...observation.keys].sort().join(", ")}]` +
        (observation.names.size > 0
          ? `\n  names=[${[...observation.names.keys()].sort().join(", ")}]`
          : ""),
    );
  }
  // A throw, NOT the run's own failures. A rejected model or a mid-run error
  // arrives as a `RUN_ERROR` chunk in the catalogue above and gets this far
  // reporting success, so an empty type list with no error here is still a
  // failed run — read the chunks, not just this line.
  if (error) {
    console.log(
      `\nSTREAM ERROR: ${error instanceof Error ? error.stack : String(error)}`,
    );
  }
  console.log(`\nsummary.json path: ${summaryPath}`);
  console.log(`\nDISTINCT CHUNK TYPES: ${[...seen.keys()].sort().join(", ")}`);
};

void main();
