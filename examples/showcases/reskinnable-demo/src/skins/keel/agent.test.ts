import { beforeEach, describe, expect, it } from "vitest";
import { keelAgent } from "@/skins/keel/agent";
import * as store from "@/skins/keel/data/store";
import { VARIANCE_CODES } from "@/skins/keel/data/variance-codes";
import {
  A2UI_OPERATIONS_KEY,
  IMPACT_BRIEF_SURFACE_ID,
} from "@/skins/keel/canvas/impact-brief-ops";

/**
 * THE DRIFT GUARD `agent.ts` DID NOT HAVE.
 *
 * A server tool that is defined and never added to the `tools` array compiles,
 * lints, renders and passes every other test in this suite. It fails once, on
 * stage, as "the canvas never opened" — which is indistinguishable from a model
 * that chose not to call it. Beat 3d has no other symptom: `render_impact_brief`
 * is the ONLY thing that puts a filed brief on the canvas, and
 * `canvas/impact-brief-ops.ts` shipped unmounted for a whole slot precisely
 * because nothing could see that it was.
 *
 * So this file asserts the resolved tool list by name, executes the beat-3d tool
 * against a real filed record, and reads the prompt for the two claims a reviewer
 * would otherwise have to take on trust: that it teaches the screen is visible
 * (beat 3b's third leg), and that it does NOT leak beat 6's withheld vocabulary.
 */

interface ServerTool {
  name: string;
  description: string;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

const serverTools = (): ServerTool[] => {
  const agent = keelAgent() as unknown as { config: { tools: ServerTool[] } };
  return agent.config.tools;
};

const prompt = (): string => {
  const agent = keelAgent() as unknown as { config: { prompt: string } };
  return agent.config.prompt;
};

const toolNamed = (name: string): ServerTool => {
  const tool = serverTools().find((t) => t.name === name);
  expect(tool, `no server tool named "${name}" is registered`).toBeDefined();
  return tool!;
};

beforeEach(() => store.reset());

describe("keel's server tools are actually registered", () => {
  it("registers exactly the three the beats need, by name", () => {
    // An EXACT list, not a `toContain` per name: a tool silently DROPPED and a
    // tool silently ADDED are both worth failing on, and only the exact form
    // catches the second.
    expect(serverTools().map((t) => t.name)).toEqual([
      "search_knowledge",
      "render_ops_report",
      "render_impact_brief",
    ]);
  });

  it("names each registered tool in the prompt's tool guidance", () => {
    // A registered tool the prompt never mentions is a tool the agent will not
    // reach for — registered and unreachable is the same demo failure as
    // unregistered, arriving from the other side.
    for (const name of [
      "search_knowledge",
      "render_ops_report",
      "render_impact_brief",
    ]) {
      expect(prompt()).toContain(name);
    }
  });
});

describe("render_impact_brief (beat 3d)", () => {
  const fileBrief = () =>
    store.fileImpactBrief({
      source: "Northeast Health Information Authority",
      space: "privacy",
      effective: "1 October 2026",
      summary: "Tightens minimum-necessary review cadence.",
      citations: [
        {
          ref: "POL-114",
          title: "PHI Access & Minimum Necessary",
          requiredAction: "Re-review the minimum-necessary section.",
        },
        {
          ref: "POL-118",
          title: "A policy the register does not carry",
          requiredAction: "Adopt it.",
        },
      ],
      impacts: ["Re-attest the privacy space."],
      filedBy: "Sam Okafor",
      role: "Knowledge & Operations Lead",
    });

  it("emits a2ui operations for a FILED brief, on the brief's own surface", async () => {
    const brief = fileBrief();
    const result = (await toolNamed("render_impact_brief").execute({
      briefId: brief.id,
    })) as Record<string, unknown>;

    const ops = result[A2UI_OPERATIONS_KEY] as
      | { createSurface?: { surfaceId: string; catalogId: string } }[]
      | undefined;
    expect(ops).toBeDefined();
    const surfaceId = ops![0]?.createSurface?.surfaceId ?? "";
    // Suffixed per call so dismissing one brief never suppresses a later one,
    // but rooted at the BRIEF's id, never the ops report's — sharing that id
    // would let a filed brief overwrite a report the presenter is reading.
    expect(surfaceId.startsWith(IMPACT_BRIEF_SURFACE_ID)).toBe(true);
    expect(surfaceId).not.toBe("keel-ops-report");
  });

  it("draws the register's answer for a ref the library does not carry", async () => {
    const brief = fileBrief();
    const result = (await toolNamed("render_impact_brief").execute({
      briefId: brief.id,
    })) as Record<string, unknown>;

    const ops = result[A2UI_OPERATIONS_KEY] as {
      updateComponents?: {
        components: ({ id: string } & Record<string, unknown>)[];
      };
    }[];
    const components =
      ops.find((op) => op.updateComponents)?.updateComponents?.components ?? [];
    const rows = components.find((c) => c.id === "brief-citations")?.rows as
      | { ref: string; carried: boolean }[]
      | undefined;

    expect(rows?.find((r) => r.ref === "POL-114")?.carried).toBe(true);
    // The row that proves the document was read rather than acknowledged.
    expect(rows?.find((r) => r.ref === "POL-118")?.carried).toBe(false);
  });

  it("tells the agent WHY an unknown id produced nothing, rather than empty ops", async () => {
    const result = (await toolNamed("render_impact_brief").execute({
      briefId: "ib-does-not-exist",
    })) as Record<string, unknown>;

    expect(result[A2UI_OPERATIONS_KEY]).toBeUndefined();
    expect(String(result.error)).toContain("ib-does-not-exist");
    // An agent handed no surface and no reason retries the same wrong id.
    expect(String(result.error)).toContain("fileImpactBrief");
  });
});

describe("the prompt (beat 3b's third leg, and beat 6's withholding)", () => {
  it("teaches that the context IS the screen", () => {
    const text = prompt();
    expect(text).toContain("SCREEN AWARENESS");
    // The refusal the beat cannot survive: an agent that says it cannot see.
    expect(text).toContain("NEVER say you cannot see");
    // The levers and rows the Register's readable actually publishes, so the
    // clause describes THIS skin's screen rather than a generic one.
    //
    // Assertions are kept to SHORT phrases on purpose: the prompt is a template
    // literal with hard newlines, so any phrase long enough to straddle a wrap
    // becomes a test that fails on a reflow and says nothing about the prompt.
    expect(text).toContain("Policy Register");
    expect(text).toContain("levers");
    expect(text).toContain("ORDER SHOWN");
  });

  it("calls the register page 'Register', matching the nav label", () => {
    // The nav label changed from "Knowledge" to "Register" while the SEGMENT
    // stayed `knowledge`. A prompt still saying "Knowledge" would have the agent
    // narrate a page name that is not on screen anywhere.
    expect(prompt()).toContain("Register");
    expect(prompt()).not.toContain("(Desk, Knowledge, Playbooks, Runs)");
  });

  it("states the honest reading of unmeasurable attestation coverage", () => {
    expect(prompt()).toContain("NOT MEASURABLE");
  });

  it("relays a release refusal instead of routing around it", () => {
    const text = prompt();
    expect(text).toContain("countersignRelease");
    expect(text).toContain("relay the refusal");
  });

  /**
   * BEAT 6's FIFTH LEAK CHANNEL. The publication-variance catalogue must not
   * reach the agent through the prompt — if it does, the agent files the right
   * code first time, the operator never has to demonstrate anything, and the
   * teach beat quietly does not exist. Nothing else fails.
   */
  it("never names a publication-variance code", () => {
    const text = prompt();
    for (const code of VARIANCE_CODES) {
      expect(text).not.toContain(code);
    }
    expect(text.toLowerCase()).not.toContain("publication variance");
  });

  /**
   * The other half of that channel: withholding the codes is worthless if the
   * prompt does not FORBID guessing one. Logistics needed exactly these sentences —
   * the model will otherwise file something plausible, get a 422, and the room
   * watches it flounder instead of watching it ask to be taught.
   */
  it("forbids inventing, guessing or trial-filing a code", () => {
    const text = prompt();
    expect(text).toContain("do not guess a code");
    expect(text).toContain("to see what happens");
    // And it must say the catalogue is deliberately not its to have, so "I could
    // not find the codes" is a state it can recognise rather than a gap to fill.
    expect(text).toContain("not given to you");
  });

  it("routes a blocked release to offerWorkflowRecording rather than to a workaround", () => {
    const text = prompt();
    expect(text).toContain("ACTION DISCIPLINE");
    expect(text).toContain("offerWorkflowRecording");
    expect(text).toContain("awaitDemonstration");
    expect(text).toContain("saveLearnedProcedure");
    // The two doors that must stay shut: a persona switch and the e-signature card.
    // Both would clear a run's approval gate and neither can clear this one, so an
    // agent offering either is offering a way past a gate that has none.
    expect(text).toContain("Do not switch persona");
    expect(text).toContain("never WHAT may");
  });

  it("keeps beat 5's procedure and beat 6's teach arc explicitly apart", () => {
    // The single easiest pair in this demo for the model to confuse. Without this,
    // it offers to record a procedure it already has — the most confusing thing it
    // can do on this screen — or assumes the flag-and-notify procedure will clear a
    // release gate.
    const text = prompt();
    expect(text).toContain("DIFFERENT procedure");
    expect(text).toContain("offer to record");
    // …and the reverse: finding the document is not handling it.
    expect(text).toContain("FINDING IS NOT HANDLING");
  });

  it("requires recall BEFORE a library summary, and the why ON SCREEN", () => {
    // Beat 4 is invisible without both halves: recall that precedes the answer, and
    // a note the room can read. A grouped list on its own is not evidence of memory.
    const text = prompt();
    expect(text).toContain("recall_memory");
    expect(text).toContain("showRegisterSummary");
    expect(text).toContain('"note"');
  });

  it("teaches the levers as REQUIRED with an explicit not-pulled value", () => {
    // Beat 3c. `.optional()` gets filled anyway, so the prompt has to name the
    // sentinel — logistics shipped an empty board under four tinted controls before
    // this clause existed, and needed a fix commit for it.
    const text = prompt();
    expect(text).toContain("showRegister");
    expect(text).toContain("EVERY lever is REQUIRED");
    expect(text).toContain("leave this lever alone");
  });

  it("pins durable saves to scope 'user'", () => {
    // A project-scoped row is global to the shared Intelligence instance, survives
    // every presenter reset (`forget-memories.ts` skips it), and would leave beat 6
    // opening already taught.
    expect(prompt()).toContain('always use scope "user"');
  });
});
