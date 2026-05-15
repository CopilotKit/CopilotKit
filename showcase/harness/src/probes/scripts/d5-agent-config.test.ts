import { describe, it, expect } from "vitest";
import { getD5Script, type D5BuildContext } from "../helpers/d5-registry.js";
import type { Page } from "../helpers/conversation-runner.js";
import {
  buildTurns,
  buildKnobDiffAssertion,
  AGENT_CONFIG_PROBES,
  RESPONSE_LENGTH_DELTA_MIN,
  type KnobSnapshot,
} from "./d5-agent-config.js";

function makePage(transcript: string): Page {
  return {
    async waitForSelector() {},
    async fill() {},
    async press() {},
    async evaluate<R>() {
      return transcript as unknown as R;
    },
  };
}

/** Construct a KnobSnapshot whose `aOnly` is the supplied A-delta and
 *  whose `postACumulative` is the priorCumulative + aOnly — matching
 *  what the snapshot assertion would have populated had it run. */
function snapshotFor(priorCumulative: string, aOnly: string): KnobSnapshot {
  return {
    priorCumulative,
    postACumulative: `${priorCumulative} ${aOnly}`.trim(),
    aOnly,
  };
}

describe("d5-agent-config script", () => {
  it("registers under featureType 'agent-config'", () => {
    const script = getD5Script("agent-config");
    expect(script).toBeDefined();
    expect(script?.featureTypes).toEqual(["agent-config"]);
    expect(script?.fixtureFile).toBe("agent-config.json");
  });

  it("buildTurns produces 6 turns covering 3 knob pairs", () => {
    const ctx: D5BuildContext = {
      integrationSlug: "langgraph-python",
      featureType: "agent-config",
      baseUrl: "https://x.test",
    };
    const turns = buildTurns(ctx);
    expect(turns).toHaveLength(6);
    const inputs = turns.map((t) => t.input);
    expect(inputs[0]).toContain("tone:professional");
    expect(inputs[1]).toContain("tone:casual");
    expect(inputs[2]).toContain("expertise:beginner");
    expect(inputs[3]).toContain("expertise:expert");
    expect(inputs[4]).toContain("responseLength:concise");
    expect(inputs[5]).toContain("responseLength:detailed");
  });

  it("AGENT_CONFIG_PROBES covers tone / expertise / responseLength", () => {
    const knobs = AGENT_CONFIG_PROBES.map((p) => p.knob);
    expect(knobs).toEqual(["tone", "expertise", "responseLength"]);
  });

  it("text-diff assertion succeeds when A and B responses differ", async () => {
    const snap = snapshotFor("", "Greetings. Professional tone.");
    const assertion = buildKnobDiffAssertion("tone", "text", snap);
    // Cumulative transcript at value-B turn = postA + B-delta.
    const page = makePage(`${snap.postACumulative} Hey! Casual mode here.`);
    await expect(assertion(page)).resolves.toBeUndefined();
  });

  it("text-diff assertion fails when value-A delta was empty", async () => {
    const snap = snapshotFor("", "");
    const assertion = buildKnobDiffAssertion("tone", "text", snap);
    const page = makePage("anything");
    await expect(assertion(page)).rejects.toThrow(/value-A delta was empty/);
  });

  it("text-diff assertion fails when B contains no new content", async () => {
    const snap = snapshotFor("", "same response");
    const assertion = buildKnobDiffAssertion("tone", "text", snap);
    // Cumulative is unchanged after B turn — no suffix added.
    const page = makePage(snap.postACumulative);
    await expect(assertion(page)).rejects.toThrow(/no new transcript/);
  });

  it("text-diff assertion fails when A and B deltas are byte-identical", async () => {
    const snap = snapshotFor("", "matching reply.");
    const assertion = buildKnobDiffAssertion("tone", "text", snap);
    // Cumulative = postA + same reply repeated.
    const page = makePage(`${snap.postACumulative} matching reply.`);
    await expect(assertion(page)).rejects.toThrow(/byte-identical/);
  });

  it("length-diff compares per-turn deltas, not cumulative totals", async () => {
    // Simulate the "third pair" scenario: prior knobs already pushed
    // hundreds of chars onto the page. The aOnly delta is short and
    // the bOnly delta is long (the +threshold case).
    const priorCumulative = "x".repeat(500); // tone+expertise responses
    const aDelta = "concise.";
    const snap = snapshotFor(priorCumulative, aDelta);
    const bDelta = "y".repeat(aDelta.length + RESPONSE_LENGTH_DELTA_MIN + 10);
    const assertion = buildKnobDiffAssertion("responseLength", "length", snap);
    // Cumulative at B = postA + bDelta.
    const page = makePage(`${snap.postACumulative} ${bDelta}`);
    await expect(assertion(page)).resolves.toBeUndefined();
  });

  it("length-diff assertion fails when B-delta is barely longer than A-delta", async () => {
    const priorCumulative = "x".repeat(500);
    const aDelta = "short concise reply.";
    const snap = snapshotFor(priorCumulative, aDelta);
    const bDelta = "y".repeat(aDelta.length + 10); // well below threshold
    const assertion = buildKnobDiffAssertion("responseLength", "length", snap);
    const page = makePage(`${snap.postACumulative} ${bDelta}`);
    await expect(assertion(page)).rejects.toThrow(/chars longer/);
  });
});
