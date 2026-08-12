/**
 * THE DRIFT GUARD `agent.ts` AND `tools.tsx` OTHERWISE DO NOT HAVE.
 *
 * Three defect classes live in these two files, and every one of them leaves the
 * app compiling, linting and rendering:
 *
 *  1. **A tool the prompt names and nobody registered.** `CLAUDE.md` § "How to
 *     add a skin" says it out loud: `agent-registry.ts` has no drift guard, and
 *     neither does a prompt. The failure surfaces when someone sends the message
 *     on stage, as "I don't have a tool for that".
 *  2. **BEAT 2 — a terminal render keyed off `status`.** On replay the recorded
 *     result comes back but no status transition fires, so the card renders its
 *     PENDING copy forever the moment the thread is reopened — which is precisely
 *     the reload beat 2 performs on stage. `eslint.config.mjs`'s
 *     `statusKeyedTerminalRender` rule covers logistics only; airline's glob entry
 *     is a later slot's, so until it lands this file is the whole guard.
 *  3. **BEAT 6 — the withheld vocabulary reaching the agent.** It leaks through
 *     five channels and closing four is closing none. ESLint's
 *     `withheldGateVocabulary` catches the two that appear as identifiers, and its
 *     `files` glob does not list airline yet either.
 *
 * Source text, deliberately. Every one of these is about which value selects a
 * branch or which string exists in a file, and none of them has a runtime symptom
 * a render test could observe.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SKIN_ROOT = __dirname;
const read = (rel: string) => readFileSync(path.join(SKIN_ROOT, rel), "utf8");

const TOOLS = read("tools.tsx");
const AGENT = read("agent.ts");

/**
 * Source with block and line comments removed.
 *
 * Required for every NEGATIVE assertion below, and for the same reason
 * `readables.test.tsx` needs it: these two files DOCUMENT the defects they must
 * not contain — `tools.tsx` explains in prose why a terminal branch must not be
 * keyed off `status === ToolCallStatus.Complete` and why `*_CODES` must not be
 * imported. Matching that would fail the guard for writing the documentation the
 * guard exists to enforce, which is the most annoying possible false positive.
 *
 * The line-comment pass requires the `//` to sit at a line start or after
 * whitespace and removes only the tail, so a violation sitting BEFORE a trailing
 * comment is still visible.
 */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");

const TOOLS_CODE = stripComments(TOOLS);
const AGENT_CODE = stripComments(AGENT);

/** Every tool name registered on the client, from its registration literal. */
const registeredClientTools = [...TOOLS.matchAll(/\bname: "([^"]+)"/g)].map(
  (m) => m[1]!,
);
/** Every tool the SERVER agent defines. */
const registeredServerTools = [...AGENT.matchAll(/\bname: "([^"]+)"/g)].map(
  (m) => m[1]!,
);
const registered = new Set([
  ...registeredClientTools,
  ...registeredServerTools,
]);

/** Runtime tools the Intelligence runtime attaches; not this skin's to register. */
const RUNTIME_TOOLS = new Set(["recall_memory", "save_memory"]);

describe("airline tool registration", () => {
  it("registers every tool the beats need", () => {
    // One entry per beat obligation, so a deletion names the beat it broke rather
    // than failing as "expected true to be false".
    const REQUIRED: [string, string][] = [
      ["showTrips", "beat 1 — the trip wall as gen-UI"],
      ["showRebookingOptions", "beat 1 — the option board in the transcript"],
      ["showFlight", "beat 1 / distractor"],
      ["showSeatMap", "beat 5 distractor (data/beat-map.md § Beat 5)"],
      ["showLoyalty", "beat 5 distractor"],
      ["showRedemptions", "beat 5 distractor"],
      ["showDisruption", "beat 5 distractor"],
      ["trackBaggage", "beat 5 distractor"],
      ["showBoardingPass", "beat 5 distractor"],
      ["showRebookingSearch", "beat 3c — the four levers plus top-N"],
      ["rebookOntoOption", "beat 5 step 1 AND beat 6's gate"],
      ["reseatPassenger", "beat 5 step 2"],
      ["notifyTripParty", "beat 5 step 3"],
      ["authorizeWithCardConfirmation", "beat 3a — the withheld secret"],
      ["fileFareException", "beat 6 — the unlock"],
      ["fileTripBrief", "beat 3d — the durable artifact"],
      ["render_trip_brief", "beat 3d — opening the canvas"],
    ];
    for (const [name, why] of REQUIRED) {
      expect(registered.has(name), `${name} is not registered (${why})`).toBe(
        true,
      );
    }
  });

  it("registers `render_trip_brief` as a SERVER tool, or the canvas never opens", () => {
    // The a2ui middleware only turns an `a2ui_operations` payload into an
    // `a2ui-surface` activity when it observes it in an in-stream
    // TOOL_CALL_RESULT — a client frontend-tool result never produces one. So
    // this specific tool cannot live in `tools.tsx`, and it has to be listed on
    // the agent, not merely defined next to it.
    expect(registeredServerTools).toContain("render_trip_brief");
    expect(AGENT).toMatch(/defineTool\(/);
    expect(AGENT).toMatch(/A2UI_OPERATIONS_KEY/);
    expect(AGENT).toMatch(/buildTripBriefOps\(/);
    expect(AGENT).toMatch(/tools:\s*\[renderTripBriefTool\]/);
  });

  it("names no tool in the prompt that nothing registers", () => {
    // The failure this catches has no other symptom: the prompt tells the model
    // to call something, the model tries, and the run answers "no such tool" in
    // front of the room.
    const prompt = AGENT.slice(AGENT.indexOf("AIRLINE_PROMPT"));
    const named = new Set(
      [...prompt.matchAll(/"([A-Za-z][A-Za-z_]*)"/g)]
        .map((m) => m[1]!)
        // Only tool-SHAPED tokens: camelCase with an interior capital, or
        // snake_case. That leaves ordinary quoted words ("all", "user",
        // "topical") and quoted phrases out without an allowlist to maintain.
        .filter((t) => /[a-z][A-Z]/.test(t) || /^[a-z]+(_[a-z]+)+$/.test(t)),
    );
    // A prompt that names no tools at all would pass vacuously.
    expect(named.size).toBeGreaterThanOrEqual(10);
    for (const name of named) {
      if (RUNTIME_TOOLS.has(name)) continue;
      expect(
        registered.has(name),
        `the prompt names "${name}", which nothing registers`,
      ).toBe(true);
    }
  });

  it("labels the tool it names for the canvas the same way `skin.tsx` does", () => {
    // `toolLabels` is keyed by the RAW tool name, so a rename in one place and
    // not the other shows the function name on a projector.
    expect(read("skin.tsx")).toContain('render_trip_brief: "');
  });
});

describe("airline beat 2 — the thread survives a reload", () => {
  it("keys no terminal render off `status`", () => {
    // `status === ToolCallStatus.Executing` on the INTERACTIVE branch is correct
    // and deliberately allowed: an executing HITL card only ever exists live.
    // `Complete` is the defect — see this file's header.
    expect(TOOLS_CODE).not.toMatch(/ToolCallStatus\.Complete/);
    // …and the interactive guard IS present, so this cannot pass by a render
    // that dropped its executing branch and became unusable live.
    expect(TOOLS_CODE).toMatch(/ToolCallStatus\.Executing/);
  });

  it("never narrows the recorded result with a type test", () => {
    // Two defect greps the docs name by hand. `result` is whatever the runtime
    // recorded, and a test that misses turns a real outcome back into
    // "preparing…" — silently, and only on replay.
    expect(TOOLS_CODE).not.toMatch(/result\.match\b/);
    expect(TOOLS_CODE).not.toMatch(/typeof\s+result\s*===\s*"string"/);
  });

  it("renders every terminal branch from the result", () => {
    // ONE shared component does it, so there is one thing to keep honest. It has
    // to distinguish "no result recorded" (pending) from a result — a plain
    // truthiness test would print the pending copy over an empty-string result.
    expect(TOOLS).toMatch(
      /result === undefined \|\| result === null \? pending : String\(result\)/,
    );
    // …and every registration that has a `render` uses it. Counted rather than
    // sampled: a tool added later with its own inline terminal branch is exactly
    // the drift this is for.
    const renders = [
      ...TOOLS_CODE.matchAll(/render: \(\{[^}]*\bresult\b[^}]*\}\)/g),
    ];
    expect(renders.length).toBeGreaterThanOrEqual(8);
    const toolNotes = [...TOOLS_CODE.matchAll(/<ToolNote\b/g)];
    expect(toolNotes.length).toBe(renders.length);
  });

  it("revalidates the screen after every write, or the trip record lies", () => {
    // Beat 3a's card POSTs from inside a chat card, so nothing in the ledger
    // module can observe it. Without the bus the itinerary on screen stays the
    // pre-write one after the passenger authorized the change on stage — the one
    // thing that beat has to disprove.
    expect(TOOLS).toMatch(/notifyAirlineDataChanged\(\)/);
    // The shared `post()` helper fires it on every successful write, and the
    // card's own callback fires it again for the write it makes itself.
    expect([...TOOLS.matchAll(/notifyAirlineDataChanged\(\)/g)]).toHaveLength(
      2,
    );
  });
});

describe("airline beat 6 — the vocabulary is withheld from the agent", () => {
  const agentFacing: [string, string][] = [
    ["tools.tsx", TOOLS_CODE],
    ["agent.ts", AGENT_CODE],
  ];

  it.each(agentFacing)(
    "%s imports no code catalogue (channels 1 and 2)",
    (_file, source) => {
      // The identifier forms ESLint's `withheldGateVocabulary` would catch — its
      // `files` glob does not list airline yet, so this is the guard until it
      // does. A readable or a `z.enum(...)` built from the catalogue is the same
      // leak wearing two hats.
      expect(source).not.toMatch(/_CODES\b/);
      expect(source).not.toMatch(/_CODE_LABELS\b/);
      expect(source).not.toMatch(/fare-waiver-codes/);
    },
  );

  it.each(agentFacing)(
    "%s names no category, in a schema or in prose (channels 3 and 4)",
    (_file, source) => {
      // The PROSE channel, which no lint rule can see: a tool description or a
      // prompt sentence leaks just as effectively as an enum. The four
      // justifying categories and the three decoys, checked by name.
      for (const code of [
        "SCHEDULE_CHANGE_TRIGGERED",
        "MEDICAL_DOCUMENTED",
        "BEREAVEMENT_DOCUMENTED",
        "MILITARY_ORDERS",
        "CHANGED_PLANS",
        "FOUND_LOWER_FARE",
        "ELITE_COURTESY",
      ]) {
        expect(source, `${code} reaches the agent`).not.toContain(code);
      }
    },
  );

  it("takes a free string for the category and says the catalogue is withheld", () => {
    // This INVERTS the enumerate-every-closed-set rule the rest of tools.tsx
    // follows — for a gate, reaching the model IS the defect. The `.describe()`
    // has to SAY so, or the model fills the free string with a guess.
    const filing = TOOLS.slice(TOOLS.indexOf('name: "fileFareException"'));
    expect(filing).toMatch(/code: z\s*\n?\s*\.string\(\)/);
    expect(filing).toMatch(/NOT given the/i);
  });

  it("still enumerates beat 5's vocabulary, which is the opposite case", () => {
    // The contrast is the point: beat 5's whole claim is that the assistant
    // ALREADY knows the procedure, so its closed sets are enumerated on the
    // schemas from `data/handling.ts` — the module that shares no token with the
    // withheld one.
    for (const set of [
      "SEAT_PREFERENCES",
      "NOTIFY_PARTIES",
      "NOTICE_TEMPLATES",
    ]) {
      expect(TOOLS_CODE, `${set} is not enumerated on any schema`).toMatch(
        new RegExp(`\\.enum\\(${set}\\)`),
      );
    }
  });
});

describe("airline beat 3a — the card is not an entitlement override", () => {
  it("offers the card only through the entitlement-and-money filter", () => {
    // `offerableOptions` drops anything the fare refuses and anything costing
    // $0. If the card were rendered unconditionally it would become a second
    // door around beat 6: the agent would route around the gate, the teach arc
    // would never fire, and NOTHING would fail.
    expect(TOOLS).toMatch(/offerableOptions\(\{/);
    const card = TOOLS.slice(
      TOOLS.indexOf('name: "authorizeWithCardConfirmation"'),
    );
    expect(card).toMatch(/offerableOptions/);
    expect(card).toMatch(/<CardConfirmationCard/);
  });

  it("tells the agent in the prompt that a card cannot clear a fare refusal", () => {
    // The prompt is the channel that decides whether the agent REACHES for the
    // card as a workaround. `authorizations/route.test.ts` proves the server
    // refuses; this proves the agent was told not to try.
    expect(AGENT).toMatch(/SECOND FACTOR, not an entitlement\s+override/i);
    expect(AGENT).toMatch(/never offer the\s+card as a way past a refusal/i);
    expect(AGENT).toMatch(/NEVER ask for card digits/i);
  });
});
