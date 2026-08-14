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
 * Run: NODE_OPTIONS="--conditions=import" pnpm tsx scripts/probe-harness-chunks.ts
 *
 * On a ChatGPT-account `codex login`, add `PROBE_MODEL` and
 * `PROBE_REASONING_SUMMARY` — see `createMirrorStream` for why a bare run
 * cannot reach the model or produce a single reasoning chunk:
 *
 *   NODE_OPTIONS="--conditions=import" PROBE_MODEL=gpt-5.6-sol \
 *     PROBE_REASONING_SUMMARY=auto pnpm tsx scripts/probe-harness-chunks.ts
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
import { chat } from "@tanstack/ai";
import { codexText } from "@tanstack/ai-codex";
import { defineSandbox, localSource, withSandbox } from "@tanstack/ai-sandbox";
import { localProcessSandbox } from "@tanstack/ai-sandbox-local-process";
import { createExpenseHarnessStream } from "../src/skins/banking/harness/run";
import { prepareWorkspace } from "../src/skins/banking/harness/workspace";

/** Field names that plausibly carry streamed prose on any chunk shape. */
const TEXT_FIELDS = ["text", "delta", "content", "reasoning", "summary"];

/**
 * The setup crash `run.ts` hits at the pinned versions, matched on its text.
 *
 * `withSandbox` DECLARES `provides: [SandboxCapability, ProjectionCapability]`
 * unconditionally but only calls `provideWorkspaceProjection` when the sandbox
 * definition carries a `workspace` block, and `@tanstack/ai` 0.44.0's
 * `MiddlewareRunner.runSetup` throws when a declared capability was never
 * provided. `run.ts` deliberately omits `workspace`, so at
 * `@tanstack/ai@0.44.0` + `@tanstack/ai-sandbox@0.3.2` it cannot reach the
 * model at all — the run dies before the first chunk.
 */
const PROJECTION_BUG =
  'provides "sandbox-projection" but never called provide()';

/**
 * A mirror of `run.ts`'s `chat()` call with the ONE difference that unblocks the
 * probe: a minimal `workspace` block, which is what makes `withSandbox` honour
 * its own capability declaration.
 *
 * This exists so the chunk catalogue is still obtainable while `run.ts` is
 * broken — a crash at middleware setup answers nothing about which chunk
 * carries reasoning, and that question is the gate. It is NOT a fix and nothing
 * should import it: `run.ts` stays the single launch site, and the projection
 * bug above has to be fixed there.
 *
 * The added block is a no-op on disk. `bootstrapWorkspace` clones only when
 * `source.type === "git"`, and with no skills, no instructions and no setup
 * steps there is nothing left for it to write — so `prepareWorkspace`'s
 * `expenses.csv` survives it.
 */
const createMirrorStream = (opts: {
  dir: string;
  prompt: string;
  abortSignal: AbortSignal;
}): AsyncIterable<unknown> =>
  chat({
    // Both overrides DEFAULT to what `run.ts` does, so a bare run reproduces
    // its blockers rather than papering over them:
    //
    // - `PROBE_MODEL` — `run.ts` pins `gpt-5.1-codex`, which a ChatGPT-account
    //   `codex login` rejects with a 400 ("not supported when using Codex with
    //   a ChatGPT account"). Override to catalogue chunks on such an account.
    // - `PROBE_REASONING_SUMMARY` — unset by default because `run.ts` sets no
    //   summary mode and `CodexTextConfig` has no field for one. Unset, codex
    //   emits NO `reasoning` items at all, so `REASONING_*` chunks never
    //   appear. Set it to `auto` or `concise` and they do, with populated text.
    //   That is the whole gate, and the reason it is a knob here.
    adapter: codexText(process.env.PROBE_MODEL ?? "gpt-5.1-codex", {
      cwd: "/workspace",
      sandboxMode: "workspace-write",
      networkAccessEnabled: true,
      webSearchMode: "live",
      modelReasoningEffort: "high",
      skipGitRepoCheck: true,
      // Values are passed verbatim as TOML, hence the inner quotes.
      ...(process.env.PROBE_REASONING_SUMMARY
        ? {
            config: {
              model_reasoning_summary: `"${process.env.PROBE_REASONING_SUMMARY}"`,
            },
          }
        : {}),
    }),
    messages: [{ role: "user", content: opts.prompt }],
    abortController: (() => {
      const controller = new AbortController();
      opts.abortSignal.addEventListener("abort", () => controller.abort(), {
        once: true,
      });
      return controller;
    })(),
    middleware: [
      withSandbox(
        defineSandbox({
          id: "banking-expense-harness-probe",
          provider: localProcessSandbox({ dir: opts.dir }),
          workspace: { root: "/workspace", source: localSource(opts.dir) },
          lifecycle: { reuse: "none", destroyOnComplete: true },
        }),
      ),
    ],
  });

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
   * `CUSTOM` is the reason this field exists. Several distinct signals —
   * `codex.session-id`, `sandbox.file`, `sandbox.file.diff` — all arrive as ONE
   * chunk `type` and are told apart only by `name`, so a mapper switching on
   * `type` alone collapses them and a `type === "sandbox.file"` branch never
   * fires at all. Cataloguing types without their names hides that.
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
  const primary = await drain(
    createExpenseHarnessStream({ dir, prompt: PROMPT, abortSignal }),
    seen,
  );
  const error = primary.error;
  let total = primary.total;

  // `run.ts` cannot start at the pinned versions, and a crash at middleware
  // setup answers nothing about which chunk carries reasoning. Re-drive the
  // mirror so the catalogue is still produced, and keep both errors visible.
  let mirrorError: unknown = null;
  if (error instanceof Error && error.message.includes(PROJECTION_BUG)) {
    console.log(
      `\n!!! run.ts failed at middleware setup: ${error.message}\n` +
        `!!! Falling back to the local mirror so the chunk catalogue is still ` +
        `obtainable. The chunk SHAPES below are the adapter's and are ` +
        `unaffected by the workspace block; the run.ts bug is a separate ` +
        `finding that still has to be fixed.\n`,
    );
    console.log(">>> driving the local mirror (workspace block added)");
    const second = await drain(
      createMirrorStream({ dir, prompt: PROMPT, abortSignal }),
      seen,
    );
    total += second.total;
    mirrorError = second.error;
  }

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
  for (const [label, cause] of [
    ["run.ts", error],
    ["mirror", mirrorError],
  ] as const) {
    if (cause) {
      console.log(
        `\n${label} STREAM ERROR: ${cause instanceof Error ? cause.stack : String(cause)}`,
      );
    }
  }
  console.log(`\nsummary.json path: ${summaryPath}`);
  console.log(`\nDISTINCT CHUNK TYPES: ${[...seen.keys()].sort().join(", ")}`);
};

void main();
