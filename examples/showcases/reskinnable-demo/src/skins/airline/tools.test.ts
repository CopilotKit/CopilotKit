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
 *     SIX channels here (five plus airline's own code-shaped `waiverGround`) and
 *     closing five of six is closing none. ESLint's `withheldGateVocabulary`
 *     catches only the two that appear as identifiers, and its `files` glob does
 *     not list airline yet either.
 *  4. **BEAT 4 — a recall with no visible "why".** A summary the agent silently
 *     shaped from memory is indistinguishable from a summary it just wrote well,
 *     so the beat is invisible and does not count. The `note` slot on `showTrips`
 *     is the whole mechanism, and nothing but this file checks it exists.
 *  5. **BEATS 5 AND 6 CONFLATED.** Two `operational` procedures, one seeded and
 *     one taught. The prompt clauses that keep them apart have no runtime symptom
 *     short of the agent offering to record a procedure it already has, live.
 *
 * Source text, deliberately. Every one of these is about which value selects a
 * branch or which string exists in a file, and none of them has a runtime symptom
 * a render test could observe. It reads a handful of SIBLING files too — the
 * filing form, the teach directives, the seeded memories — because the vocabulary
 * asymmetry is a property of the whole skin rather than of these two files.
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

/**
 * BEAT 6's chain, in the order the agent must walk it. These three are the ONLY
 * registrations exempt from the shared `ToolNote` terminal render, because their
 * settled strings are directives addressed to the agent rather than copy for the
 * room — see the "keys beat 6's own three cards" case below.
 */
const TEACH_CHAIN = [
  "offerWorkflowRecording",
  "awaitDemonstration",
  "saveLearnedProcedure",
] as const;

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
      ...TEACH_CHAIN.map(
        (name, i) =>
          [name, `beat 6 — teach chain step ${i + 1}`] as [string, string],
      ),
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
    // …and every registration that has a `render` uses it, EXCEPT beat 6's three
    // teach-chain cards, which are covered by the next case. Counted rather than
    // sampled: a tool added later with its own inline terminal branch is exactly
    // the drift this is for, and the exemption is a fixed list of three names
    // rather than a slackened count, so a fourth hand-rolled terminal render
    // fails here.
    const renders = [
      ...TOOLS_CODE.matchAll(/render: \(\{[^}]*\bresult\b[^}]*\}\)/g),
    ];
    expect(renders.length).toBeGreaterThanOrEqual(11);
    const toolNotes = [...TOOLS_CODE.matchAll(/<ToolNote\b/g)];
    expect(toolNotes.length).toBe(renders.length - TEACH_CHAIN.length);
  });

  it("keys beat 6's own three cards off the result too, through their readers", () => {
    // The teach chain cannot use `ToolNote`: its settled strings are DIRECTIVES
    // addressed to the agent ("Call awaitDemonstration now…"), and printing one
    // verbatim puts the demo's own wiring on screen in front of the room. So each
    // card prints a human line chosen by a READER from ./teach-mode-directives —
    // and each still has to distinguish "no result recorded" from a result, or the
    // reopened thread shows its pending copy forever.
    for (const [name, reader] of [
      ["offerWorkflowRecording", "readOfferAccepted"],
      ["awaitDemonstration", "readDemonstratedStepCount"],
      ["saveLearnedProcedure", "classifySaveProcedureResult"],
    ] as const) {
      const block = TOOLS_CODE.slice(TOOLS_CODE.indexOf(`name: "${name}"`));
      expect(block, `${name} does not classify its settled result`).toContain(
        `${reader}(`,
      );
    }
    // Two of the three branch on the absence explicitly; the third
    // (`saveLearnedProcedure`) delegates it to `classifySaveProcedureResult`,
    // whose own round-trip test pins that a non-string is "pending".
    const absenceChecks = [
      ...TOOLS_CODE.matchAll(/result === undefined \|\| result === null/g),
    ];
    expect(absenceChecks.length).toBeGreaterThanOrEqual(3);
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
  /**
   * EVERY file whose text can reach the model, not just the obvious two.
   *
   *  - `tools.tsx` — readables, schemas, descriptions (channels 1, 2, 3).
   *  - `agent.ts` — the prompt (channel 4).
   *  - `teach-mode-directives.ts` — its `buildDemonstrationDirective` output IS a
   *    tool result, so a category baked in there is read straight into context.
   *    The one it reports is passed in at RUNTIME, from what the passenger filed.
   *  - `intelligence/seed-memories.ts` — a seeded memory is recalled INTO the
   *    prompt. Naming a category there would hand beat 6's answer over before the
   *    demo starts, which is the failure that still compiles and still looks fine.
   *
   * Channel 5 (the refusal body) lives in the routes and is asserted by
   * `src/app/api/airline/v1/fare-exceptions/route.test.ts` and
   * `.../bookings/[id]/change/route.test.ts`. Channel 6 is airline's own — see the
   * `waiverGround` case at the end of this block.
   */
  const agentFacing: [string, string][] = [
    ["tools.tsx", TOOLS_CODE],
    ["agent.ts", AGENT_CODE],
    [
      "teach-mode-directives.ts",
      stripComments(read("teach-mode-directives.ts")),
    ],
    [
      "intelligence/seed-memories.ts",
      stripComments(read("intelligence/seed-memories.ts")),
    ],
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

  it("closes channel SIX — the code-shaped ground never reaches the agent", () => {
    // AIRLINE HAS A CHANNEL NO OTHER SKIN HAS. `Booking.waiverGround` is a
    // code-shaped token (`"schedule_change"`, `"medical"`, …) that maps 1:1 onto a
    // justifying category, so surfacing it would hand the catalogue over sideways —
    // the failure-modes list does not name this channel because no other skin has a
    // GROUNDED gate. `store.snapshot()` strips it (pinned in `data/store.test.ts`,
    // `/ledger` and `/bookings/[id]`); this is the client half of the same rule.
    for (const [file, source] of agentFacing) {
      expect(source, `${file} surfaces waiverGround`).not.toMatch(
        /waiverGround|waiver_ground/,
      );
    }
    // …and the honest substitute IS present: the passenger-facing prose, which is
    // what beat 6's learned procedure reads to choose a matching category.
    expect(TOOLS_CODE).toMatch(/fare_notes/);
  });

  it("puts the catalogue in exactly ONE place — the human-facing form", () => {
    // The asymmetry IS the beat, so it needs a POSITIVE assertion too: absence
    // everywhere with the form missing is an unlearnable gate, and it would pass
    // every negative case above. Anchored on the import so it cannot be satisfied
    // by a comment.
    const form = read("components/fare-exception-form.tsx");
    expect(form).toMatch(/from "\.\.\/data\/fare-waiver-codes"/);
    expect(form).toContain("FARE_WAIVER_CODES.map(");
    expect(form).toContain("FARE_WAIVER_CODE_LABELS[c]");
    // Catalogue ORDER, unmarked — no grouping, no sort, no `justifies` filter. A
    // form that flagged the working ones turns the demonstration into a guided
    // tour.
    expect(form).not.toMatch(/FARE_WAIVER_CODES[\s\S]{0,40}\.(sort|filter)\(/);
    // And it is mounted, or nobody can demonstrate anything.
    expect(read("pages/account.tsx")).toContain("<FareExceptionForm />");
  });

  it("carries the demonstrated category as DATA on the coded step", () => {
    // `getDemonstratedCode()` reads the LAST step carrying a code, so the call that
    // narrates the filing has to pass it as the second argument. A `logStep(label)`
    // with the code only interpolated into the label reads identically on screen
    // and hands the agent `null`, on a demonstration that plainly happened.
    const form = read("components/fare-exception-form.tsx");
    expect(form).toMatch(
      /logStep\(\s*`Filed the fare exception as \$\{code\}`,\s*code,?\s*\)/,
    );
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

describe("airline beat 4 — recall has a VISIBLE why", () => {
  it("gives the trip summary a note slot the agent must fill", () => {
    // WITHOUT THE VISIBLE WHY THE BEAT DOES NOT COUNT. The room watches a
    // competent summary and has no way to know anything was recalled, so the
    // claim "it remembers me" is taken on faith — which is the same as not
    // making it. Banking's `showSpendSummary` `note` parameter is the pattern.
    const trips = TOOLS.slice(TOOLS.indexOf('name: "showTrips"'));
    expect(trips).toMatch(/note: z\s*\n?\s*\.string\(\)/);
    // REQUIRED, not `.optional()`: an optional slot is the one a model omits, and
    // the omission is silent.
    expect(
      /note: z[\s\S]{0,400}?\.optional\(\)/.test(trips),
      "the note slot is optional, so the model can silently skip the beat",
    ).toBe(false);
    // …and it is actually rendered.
    expect(trips).toContain("<PreferenceNote note={note} />");
  });

  it("renders nothing for a blank note, so silence is never dressed as memory", () => {
    // On the OSS path there is no `recall_memory`, the note comes back empty, and
    // the honest thing on screen is NO band rather than an empty violet stripe
    // implying a recall that never happened. `note` also STREAMS, so `undefined`
    // mid-render must not print one either.
    const band = TOOLS.slice(TOOLS.indexOf("function PreferenceNote"));
    expect(band).toMatch(/\(note \?\? ""\)\.trim\(\)/);
    expect(band).toMatch(/if \(text === ""\) return null;/);
  });

  it("tells the agent to recall BEFORE answering, not after", () => {
    // Recalling after the answer is already on screen is not recalling. The prompt
    // is the only place this ordering can be stated.
    expect(AGENT).toMatch(/RECALL FIRST/i);
    expect(AGENT).toMatch(/BEFORE you answer/i);
    expect(AGENT).toMatch(/recall_memory/);
    // And it must forbid claiming a preference that was not returned.
    expect(AGENT).toMatch(
      /never claim to remember something that\s+was not returned/i,
    );
  });
});

describe("airline beats 5 and 6 — two procedures the model must not confuse", () => {
  it("says out loud in the prompt that they are different", () => {
    // THE EASIEST MISTAKE AVAILABLE HERE, per `data/beat-map.md` § Beat 5: the
    // agent conflates the cancellation procedure with the fare-exception one and
    // starts offering to record something it already knows. Both directions have
    // to be stated.
    expect(AGENT).toMatch(/DIFFERENT PROCEDURE from the fare-exception one/i);
    expect(AGENT).toMatch(/NOT call\s+"offerWorkflowRecording"/);
    expect(AGENT).toMatch(/NOT call "awaitDemonstration"/);
    expect(AGENT).toMatch(/NOT offer to record\s+anything/i);
  });

  it("routes the blocked case through the teach chain rather than a workaround", () => {
    // The ACTION DISCIPLINE clause. Without it the agent does something plausible
    // — a cheaper flight, a guessed category, the card confirmation — and nothing
    // fails, which is worse than failing.
    expect(AGENT).toMatch(/ACTION DISCIPLINE/);
    for (const step of TEACH_CHAIN) {
      expect(AGENT, `the prompt never routes to ${step}`).toContain(step);
    }
    expect(AGENT).toMatch(/Do not\s+guess a category/i);
    expect(AGENT).toMatch(/cannot clear this|cannot clear it/i);
  });

  it("teaches a PROCEDURE rather than a memorized category", () => {
    // `exceptionLifts` is grounded: the category has to match what the booking's
    // own record documents. So replaying the demonstrated category verbatim on the
    // other gated booking is refused, and what has to transfer is "read the notes,
    // file the matching category". If the prompt and the save card do not say so,
    // the unaided replay fails and looks like a memory failure.
    expect(AGENT).toMatch(/HAS TO MATCH WHAT THE BOOKING DOCUMENTS/i);
    const save = TOOLS.slice(TOOLS.indexOf('name: "saveLearnedProcedure"'));
    expect(save).toMatch(/works on a DIFFERENT booking/i);
  });

  it("keeps the outer recording bracket in a component, not a render closure", () => {
    // The bracket must stay open from "show me" until "I'm done", across the
    // form's TWO clicks. A bracket owned by the host card's render closure — or a
    // feed read from it — freezes on the snapshot taken before the passenger
    // touched anything, and a ref count that reaches zero between the clicks
    // clears the feed and STRANDS the demonstrated category.
    const card = TOOLS.slice(
      TOOLS.indexOf("export function DemonstrationCard"),
    );
    expect(card).toMatch(/useEffect\(\(\) => \{\s*beginRecording\(\);/);
    expect(card).toMatch(/return \(\) => endRecording\(\);/);
    // Read BEFORE settling, while the bracket is still open.
    expect(card).toMatch(/code: getDemonstratedCode\(\)/);
    // The awaitDemonstration card delegates to it rather than inlining a feed.
    const await_ = TOOLS.slice(TOOLS.indexOf('name: "awaitDemonstration"'));
    expect(await_).toContain("<DemonstrationCard");
  });
});
