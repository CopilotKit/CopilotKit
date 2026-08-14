/**
 * GATE 2, and Arm C's load-bearing assumption.
 *
 * Arm A maps codex's chunks to console frames ITSELF, so a surprising chunk
 * shape is a local fix in our own file. Arm C hands the same chunks to
 * `convertTanStackStream`, which lives in `packages/runtime` and which this app
 * does not own — if that converter drops or mangles codex's reasoning chunks,
 * Arm C ships a thread with tool calls and NO visible thinking, and there is no
 * fallback because Arm C has no side channel. So the gate is answered before
 * Tasks 10-11 are built, not after.
 *
 * Gate 1 (`scripts/probe-harness-chunks.ts`, findings in
 * `docs/superpowers/plans/2026-08-14-probe-findings.md`) established that the
 * harness already emits AG-UI-SHAPED chunk names — `REASONING_MESSAGE_CONTENT`,
 * `TOOL_CALL_START`, `CUSTOM`, and so on. That makes the converter look like it
 * might be a pass-through, and makes the OPPOSITE risk real too: a converter
 * that re-interprets already-AG-UI names can double-emit an envelope or nest an
 * event inside another. Both failure shapes are silent — the run succeeds either
 * way — so this probe measures three things rather than one:
 *
 *   1. Does any emitted event carry POPULATED reasoning text, and under which
 *      field? (`REASONING_MESSAGE_CONTENT.delta` upstream, per Gate 1; a
 *      converter that copies `content` instead yields `undefined` and a blank
 *      pane, which is exactly the failure this gate exists to catch.)
 *   2. Do TOOL_CALL events survive? Tasks 10/11 render them.
 *   3. Is anything DOUBLE-wrapped (an AG-UI event nested inside another event's
 *      fields) or DUPLICATED (the same envelope twice)?
 *
 * To answer 3 honestly the probe taps the RAW stream on its way into the
 * converter and catalogues both sides from ONE codex run. A separate raw run
 * would cost a second real ~60s codex process and would not be comparable
 * anyway, since the model picks a different number of searches each time (Gate 1
 * measured 91 chunks then 78 for identical prompts). In-count vs out-count from
 * the same stream is the only form of that comparison that means anything.
 *
 * The `Observation` shape, `textLengthOf`, the `drain` helper and the sorted
 * per-type summary are deliberately copied from Gate 1's probe so the two
 * probes' outputs sit side by side.
 *
 * Run:
 *   NODE_OPTIONS="--conditions=import --conditions=module" \
 *     pnpm tsx scripts/probe-converter-events.ts
 *
 * BOTH conditions are required, and this recipe is one condition LONGER than
 * Gate 1's — do not copy that probe's command onto this one.
 *
 * `--conditions=import` is Gate 1's requirement and unchanged: this app's
 * `package.json` has no `"type": "module"`, so tsx loads every `.ts` here as
 * CJS, while `@tanstack/ai`'s exports map declares an `import` condition and NO
 * `require` one, so a bare `pnpm tsx` dies with `ERR_PACKAGE_PATH_NOT_EXPORTED`
 * before the first chunk.
 *
 * `--conditions=module` is needed by THIS probe only, because it is the first
 * script here to import `@copilotkit/runtime`. That import chain reaches
 * `tslib`, whose exports map is `{ module, import: { node }, default }`. With
 * only `import` active, `require("tslib")` resolves to the ESM wrapper
 * `modules/index.js`, tsx's require hook transpiles that back to CJS, and its
 * `import tslib from "../tslib.js"` becomes a `.default` access on a CJS module
 * that has no `default` — so the script dies at load with
 * `Cannot destructure property '__extends' of 'import_tslib.default'`, nowhere
 * near anything this probe is testing. Adding `module` makes Node match tslib's
 * FIRST exports key (`./tslib.es6.mjs`, real ESM that tsx does not rewrite)
 * instead. It is additive — it only changes resolution for packages that publish
 * a `module` condition — and `@tanstack/ai`, `run.ts` and `workspace.ts` were
 * verified to still load with both conditions active.
 *
 * The app itself is unaffected by any of this: Next bundles these modules as
 * ESM. It is a script-runner concern, exactly as in Gate 1.
 */
import { convertTanStackStream } from "@copilotkit/runtime/v2";
import { createExpenseHarnessStream } from "../src/skins/banking/harness/run";
import { prepareWorkspace } from "../src/skins/banking/harness/workspace";

/** Field names that plausibly carry streamed prose on any event shape. */
const TEXT_FIELDS = ["text", "delta", "content", "reasoning", "summary"];

/**
 * AG-UI / TanStack event names, used ONLY to spot double-wrapping: an emitted
 * event whose own field values contain a nested object carrying one of these as
 * its `type` means the converter wrapped an event instead of translating it.
 */
const EVENT_NAME = /^(RUN|TEXT_MESSAGE|REASONING|TOOL_CALL|STATE|CUSTOM|STEP)/;

type Observation = {
  count: number;
  /** First payload seen for this type, truncated. */
  first: string;
  /** First payload for this type whose text-shaped fields were NON-empty. */
  firstWithText: string | null;
  /** Total characters of text-shaped payload across every event of this type. */
  textChars: number;
  /**
   * Per-field character totals. Gate 1's single `textChars` answers "does this
   * type carry prose"; Arm C additionally needs "under WHICH field", because
   * upstream reasoning lives in `delta` and has no `content` at all. A converter
   * that moved the string to `content` would look identical in a `textChars`
   * column and still render nothing in a pane reading `delta`.
   */
  textCharsByField: Map<string, number>;
  /** Every key ever seen on an event of this type, so a rare field is not lost. */
  keys: Set<string>;
  /** The `name` values seen on this type (CUSTOM is why this exists). */
  names: Map<string, string>;
};

const emptyObservation = (first: string): Observation => ({
  count: 0,
  first,
  firstWithText: null,
  textChars: 0,
  textCharsByField: new Map(),
  keys: new Set(),
  names: new Map(),
});

/** Sum the lengths of any string-valued text-shaped field on this event. */
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

/**
 * Any nested object (or array member) that looks like an AG-UI event. Non-empty
 * means the converter double-wrapped rather than translated.
 */
const nestedEventTypes = (chunk: unknown): string[] => {
  if (typeof chunk !== "object" || chunk === null) return [];
  const found: string[] = [];
  const walk = (value: unknown, depth: number): void => {
    if (depth > 4 || typeof value !== "object" || value === null) return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    const record = value as Record<string, unknown>;
    if (
      depth > 0 &&
      typeof record.type === "string" &&
      EVENT_NAME.test(record.type)
    ) {
      found.push(record.type);
    }
    for (const nested of Object.values(record)) walk(nested, depth + 1);
  };
  walk(chunk, 0);
  return found;
};

/** One event's identity for duplicate detection: type + whichever id it carries. */
const envelopeKey = (chunk: unknown): string => {
  const record = (chunk ?? {}) as Record<string, unknown>;
  const id =
    record.messageId ?? record.toolCallId ?? record.parentMessageId ?? "";
  return `${String(record.type)}#${String(id)}`;
};

type DrainResult = {
  total: number;
  /** Ordered type names, for reading the actual event sequence. */
  order: string[];
  error: unknown;
};

/**
 * Tally one chunk into `seen` and `order`. Shared by the raw tap and the
 * converted drain so both sides of the comparison are measured identically —
 * a per-side copy of this is exactly how two "comparable" tables stop being
 * comparable.
 *
 * `label` non-null also prints each newly-seen type / name / first-with-text, so
 * the converted side is readable live while the raw side stays quiet (it is
 * already catalogued in Gate 1's findings).
 */
const record = (
  chunk: unknown,
  seen: Map<string, Observation>,
  order: string[],
  label: string | null,
): void => {
  const type = (chunk as { type?: string }).type ?? "(no type field)";
  order.push(type);
  const payload = JSON.stringify(chunk) ?? String(chunk);
  const chars = textLengthOf(chunk);

  let observation = seen.get(type);
  if (!observation) {
    observation = emptyObservation(payload.slice(0, 400));
    seen.set(type, observation);
    if (label) console.log(`\n=== ${label} ${type}\n${observation.first}`);
  }
  observation.count += 1;
  observation.textChars += chars;

  if (typeof chunk === "object" && chunk !== null) {
    const fields = chunk as Record<string, unknown>;
    for (const field of TEXT_FIELDS) {
      const value = fields[field];
      if (typeof value === "string" && value.length > 0) {
        observation.textCharsByField.set(
          field,
          (observation.textCharsByField.get(field) ?? 0) + value.length,
        );
      }
    }
    for (const key of Object.keys(fields)) observation.keys.add(key);
    const name = fields.name;
    if (typeof name === "string" && !observation.names.has(name)) {
      observation.names.set(name, payload.slice(0, 400));
      if (label) {
        console.log(
          `\n--- ${label} ${type} name="${name}"\n${payload.slice(0, 400)}`,
        );
      }
    }
  }

  if (chars > 0 && observation.firstWithText === null) {
    observation.firstWithText = payload.slice(0, 400);
    if (label) {
      console.log(
        `\n--- ${label} ${type} (first with non-empty text)\n${observation.firstWithText}`,
      );
    }
  }
};

/** Drain one stream, printing each distinct type once and tallying the rest. */
const drain = async (
  stream: AsyncIterable<unknown>,
  seen: Map<string, Observation>,
  label: string,
): Promise<DrainResult> => {
  let total = 0;
  const order: string[] = [];
  try {
    for await (const chunk of stream) {
      total += 1;
      record(chunk, seen, order, label);
    }
  } catch (cause) {
    return { total, order, error: cause };
  }
  return { total, order, error: null };
};

/** Print a sorted per-type table in Gate 1's format, plus the per-field split. */
const printTable = (seen: Map<string, Observation>): void => {
  for (const [type, observation] of [...seen].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const byField = [...observation.textCharsByField]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([field, chars]) => `${field}=${chars}`)
      .join(" ");
    console.log(
      `${type}\n  count=${observation.count} textChars=${observation.textChars} ` +
        `keys=[${[...observation.keys].sort().join(", ")}]` +
        (byField ? `\n  textBy: ${byField}` : "") +
        (observation.names.size > 0
          ? `\n  names=[${[...observation.names.keys()].sort().join(", ")}]`
          : ""),
    );
  }
};

/**
 * Pass every chunk through untouched while cataloguing it, so the raw stream and
 * the converted stream are measured on the SAME codex run.
 */
const tap = async function* (
  stream: AsyncIterable<unknown>,
  seen: Map<string, Observation>,
  order: string[],
  counter: { total: number },
): AsyncIterable<unknown> {
  for await (const chunk of stream) {
    counter.total += 1;
    record(chunk, seen, order, null);
    yield chunk;
  }
};

/** Gate 1's prompt, verbatim, so the two runs are comparable. */
const PROMPT =
  "Search the web to find out what kind of business The Copper Room in " +
  'Austin is, then write what you found to summary.json as {"kind":"..."}.';

const main = async () => {
  const { dir, summaryPath } = await prepareWorkspace(
    "date,merchant,amount,city,card_last4,description\n" +
      "2026-07-15,The Copper Room,412.88,Austin,4242,CARD PURCHASE\n",
  );
  console.log(`workspace: ${dir}`);

  const rawSeen = new Map<string, Observation>();
  const rawOrder: string[] = [];
  const rawCounter = { total: 0 };
  const outSeen = new Map<string, Observation>();

  const startedAt = Date.now();
  const abortSignal = new AbortController().signal;

  // Duplicate + nesting detection, collected while the converted stream drains.
  const envelopeCounts = new Map<string, number>();
  const reasoningDeltas: string[] = [];
  const nested: string[] = [];

  console.log(
    "\n>>> driving createExpenseHarnessStream -> convertTanStackStream",
  );

  const rawStream = tap(
    createExpenseHarnessStream({ dir, prompt: PROMPT, abortSignal }),
    rawSeen,
    rawOrder,
    rawCounter,
  );

  // The converter is an AsyncGenerator, so wrap it once more to collect the
  // duplicate/nesting evidence without a second pass over the events.
  const convertedStream = (async function* () {
    for await (const event of convertTanStackStream(rawStream, abortSignal)) {
      const key = envelopeKey(event);
      envelopeCounts.set(key, (envelopeCounts.get(key) ?? 0) + 1);
      const fields = event as unknown as Record<string, unknown>;
      if (
        fields.type === "REASONING_MESSAGE_CONTENT" &&
        typeof fields.delta === "string"
      ) {
        reasoningDeltas.push(fields.delta);
      }
      for (const inner of nestedEventTypes(event)) {
        nested.push(`${String(fields.type)} contains ${inner}`);
      }
      yield event;
    }
  })();

  const {
    total: outTotal,
    order: outOrder,
    error,
  } = await drain(convertedStream, outSeen, "OUT");

  const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);

  console.log(`\n\n========== RAW (into the converter) ==========`);
  console.log(`chunks: ${rawCounter.total}`);
  printTable(rawSeen);

  console.log(`\n\n========== AG-UI EVENTS (out of the converter) ==========`);
  console.log(`elapsed: ${elapsedSeconds}s   events: ${outTotal}`);
  printTable(outSeen);

  console.log(`\nRAW SEQUENCE:\n  ${rawOrder.join(" ")}`);
  console.log(`\nOUT SEQUENCE:\n  ${outOrder.join(" ")}`);

  console.log(`\n---------- pass-through or re-interpretation? ----------`);
  console.log(
    `raw chunks in: ${rawCounter.total}   AG-UI events out: ${outTotal}`,
  );
  const rawTypes = new Set(rawSeen.keys());
  const outTypes = new Set(outSeen.keys());
  console.log(
    `dropped types (in, never out): ${
      [...rawTypes]
        .filter((t) => !outTypes.has(t))
        .sort()
        .join(", ") || "NONE"
    }`,
  );
  console.log(
    `invented types (out, never in): ${
      [...outTypes]
        .filter((t) => !rawTypes.has(t))
        .sort()
        .join(", ") || "NONE"
    }`,
  );

  console.log(`\n---------- double-wrapping ----------`);
  console.log(
    nested.length === 0
      ? "no nested AG-UI event found inside any emitted event"
      : `NESTED EVENTS FOUND:\n  ${[...new Set(nested)].join("\n  ")}`,
  );

  console.log(`\n---------- duplication ----------`);
  const repeatedEnvelopes = [...envelopeCounts].filter(([, n]) => n > 1);
  console.log(
    repeatedEnvelopes.length === 0
      ? "every (type + id) envelope emitted exactly once"
      : `REPEATED (type#id) ENVELOPES:\n  ${repeatedEnvelopes
          .map(([key, n]) => `${key} x${n}`)
          .join("\n  ")}`,
  );
  const duplicateDeltas = reasoningDeltas.filter(
    (delta, index) => reasoningDeltas.indexOf(delta) !== index,
  );
  console.log(
    duplicateDeltas.length === 0
      ? `reasoning deltas: ${reasoningDeltas.length}, all distinct`
      : `REPEATED REASONING DELTAS (${duplicateDeltas.length}):\n  ${[
          ...new Set(duplicateDeltas),
        ].join("\n  ")}`,
  );

  console.log(`\n---------- reasoning text ----------`);
  for (const [type, observation] of [...outSeen].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (!/REASONING/i.test(type)) continue;
    const byField = [...observation.textCharsByField]
      .map(([field, chars]) => `${field}=${chars}`)
      .join(" ");
    console.log(
      `  ${type}: count=${observation.count} textChars=${observation.textChars}` +
        (byField ? ` (${byField})` : " (no populated text field)"),
    );
  }
  const reasoningChars = [...outSeen]
    .filter(([type]) => /REASONING/i.test(type))
    .reduce((sum, [, observation]) => sum + observation.textChars, 0);

  const reasoningTypes = [...outTypes]
    .filter((t) => /REASONING/i.test(t))
    .sort();
  const toolCallTypes = [...outTypes]
    .filter((t) => /TOOL_CALL/i.test(t))
    .sort();
  console.log(
    `\nREASONING event types: ${reasoningTypes.join(", ") || "NONE"}`,
  );
  console.log(`TOOL_CALL event types: ${toolCallTypes.join(", ") || "NONE"}`);

  // A throw, NOT the run's own failures. `convertTanStackStream` DOES throw on a
  // RUN_ERROR chunk (unlike the raw stream, where it is just another chunk), so
  // on this side an error here can mean a rejected model rather than a converter
  // bug — read the raw catalogue above before blaming the converter.
  if (error) {
    console.log(
      `\nSTREAM ERROR: ${error instanceof Error ? error.stack : String(error)}`,
    );
  }
  console.log(`\nsummary.json path: ${summaryPath}`);

  // The gate is answered by POPULATED CHARACTERS, not by a type name: an
  // envelope-only REASONING_START proves the family survived the conversion and
  // still paints a blank pane.
  console.log(
    reasoningChars > 0
      ? `\nGATE 2 PASS — ${reasoningChars} characters of reasoning text survived the conversion. Arm C can show visible thinking.`
      : "\nGATE 2 FAIL — no populated reasoning text out of the converter. STOP and report; Arm C has no side channel to fall back on.",
  );
};

void main();
