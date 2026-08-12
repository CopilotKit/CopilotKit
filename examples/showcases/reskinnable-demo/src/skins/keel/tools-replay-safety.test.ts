import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * BEAT 2 — the source guard, because there is nothing else that can see this.
 *
 * A tool render whose terminal branch is chosen from `status` is PERFECT during a
 * live run and renders the pending copy forever on a reopened thread — which is
 * exactly when beat 2 is being demonstrated. It compiles, it lints, and every
 * behavioural test passes, because a unit test renders the live path.
 *
 * The repo enforces this with `statusKeyedTerminalRender` in `eslint.config.mjs`,
 * but that rule is applied through a PER-SKIN `files` glob and keel is not in it
 * yet (a later slot owns that file — see this suite's sibling note in the wiring
 * report). Until it is, this file is keel's enforcement, and it is deliberately
 * stronger than the lint rule: rather than banning one comparison, it asserts
 * that `ToolCallStatus` is not imported at all, so a status-keyed terminal branch
 * is not even expressible here.
 *
 * Reading the source is the point. Every alternative — asserting on a rendered
 * DOM, or trusting a comment — passes against the very defect this exists to
 * catch.
 */

const SOURCE = readFileSync(
  join(process.cwd(), "src/skins/keel/tools.tsx"),
  "utf8",
);

describe("keel's tool renders are replay-safe", () => {
  it("never imports ToolCallStatus, so no render can key off status", () => {
    expect(SOURCE).not.toContain("ToolCallStatus");
  });

  it("chooses every settled branch through the ONE settledText helper", () => {
    // One definition, so no render re-implements "has this call settled?" and
    // none of them can drift back to `status`.
    const definitions = SOURCE.match(/function settledText\(/g) ?? [];
    expect(definitions).toHaveLength(1);
  });

  /**
   * Every `useFrontendTool` / `useHumanInTheLoop` registration must consult the
   * recorded result. Those two are the hooks whose renders receive
   * `{ args, status, result, respond }` and therefore the only ones that CAN get
   * this wrong; a parameterized `useComponent` receives the parsed args directly
   * and re-derives from the live ledger, which is replay-safe by construction.
   */
  it("has every write/HITL tool consult the recorded result", () => {
    const blocks = SOURCE.split(/use(?:FrontendTool|HumanInTheLoop)\(/).slice(
      1,
    );
    expect(blocks.length).toBeGreaterThanOrEqual(5);
    for (const block of blocks) {
      // The tool's own name, for a failure message that says which one.
      const name = /name:\s*"([^"]+)"/.exec(block)?.[1] ?? "(unnamed)";
      expect(block, `${name}'s render ignores the recorded result`).toContain(
        "settledText(result)",
      );
    }
  });

  it("registers the tools each landed beat needs", () => {
    // agent.ts's server tools have their own drift guard (`agent.test.ts`); this
    // is the client half. An unregistered frontend tool fails exactly once, on
    // stage, as "the agent talked about it instead of doing it".
    for (const name of [
      // beat 1 — the face
      "showRegisterHealth",
      // beat 3a — drive the app, secret withheld
      "countersignRelease",
      // beat 3d — the durable artifact
      "fileImpactBrief",
      // the skin's own identity, which must survive every beat added to it
      "showSources",
      "openDocument",
      "showPlaybook",
      "startRun",
      "showRun",
      "approveStep",
      "showApprovals",
      "navigateTo",
      // beat 3c — the four levers as a maneuver
      "showRegister",
      // beat 4 — memory recall with a visible "why"
      "showRegisterSummary",
      // beat 5 — the stored procedure's three ordered writes
      "raiseReviewFlag",
      "sendOwnerNotice",
      "addDocumentNote",
      // beat 6 — the unlock the agent must be taught, and the teach chain
      "fileReleaseVariance",
      "offerWorkflowRecording",
      "awaitDemonstration",
      "saveLearnedProcedure",
    ]) {
      expect(SOURCE, `${name} is not registered`).toContain(`name: "${name}"`);
    }
  });

  /**
   * BEAT 5's three writes must be `useFrontendTool`, never `useHumanInTheLoop`.
   *
   * Banking's equivalent once opened a confirmation card mid-procedure; a presenter
   * moved on without answering it, that tool call sat unresolved, and the NEXT
   * message failed the whole thread with "Tool result is missing for tool call ...".
   * A procedure with no half-finished state cannot leave one behind — and the beat's
   * claim is that it runs unattended, so a card in the middle costs the beat either
   * way.
   */
  it("registers beat 5's three writes with NO confirmation card", () => {
    for (const name of [
      "raiseReviewFlag",
      "sendOwnerNotice",
      "addDocumentNote",
    ]) {
      const index = SOURCE.indexOf(`name: "${name}"`);
      expect(index).toBeGreaterThan(-1);
      // The registration hook is the nearest one ABOVE the name.
      const before = SOURCE.slice(0, index);
      const frontend = before.lastIndexOf("useFrontendTool(");
      const hitl = before.lastIndexOf("useHumanInTheLoop(");
      expect(
        frontend,
        `${name} is registered as a HITL tool, so the procedure can stall mid-flight`,
      ).toBeGreaterThan(hitl);
    }
  });

  /**
   * BEAT 6's teach chain must be `followUp: true`, or the agent settles a card and
   * then STOPS to narrate instead of advancing to the next one — the arc reads as
   * three disconnected exchanges and the presenter has to prompt between each.
   */
  it("marks the teach chain followUp, so the arc advances by itself", () => {
    for (const name of [
      "offerWorkflowRecording",
      "awaitDemonstration",
      "saveLearnedProcedure",
    ]) {
      const index = SOURCE.indexOf(`name: "${name}"`);
      expect(index).toBeGreaterThan(-1);
      // `followUp` sits immediately above `name` in each registration.
      const window = SOURCE.slice(Math.max(0, index - 200), index);
      expect(window, `${name} is not followUp: true`).toContain(
        "followUp: true",
      );
    }
  });

  /**
   * BEAT 6's withholding, on the client side. The variance catalogue must not
   * reach the agent through a tool description or a schema enum — two of the five
   * leak channels. Keel's release path lives in this file, so this is where the
   * guard belongs until the eslint `withheldGateVocabulary` glob names it.
   */
  it("never names a publication-variance code in a tool surface", () => {
    for (const code of [
      "PATIENT_SAFETY_ALERT",
      "ACCREDITATION_FINDING",
      "REGULATORY_MANDATE",
      "INCIDENT_CONTAINMENT",
      "COMMITTEE_CALENDAR",
      "EDITORIAL_CLEANUP",
    ]) {
      expect(SOURCE).not.toContain(code);
    }
    // The IMPORT, which is what eslint's `withheldGateVocabulary` selector matches.
    // Belt and braces: that rule's `files` glob is per-skin and this file is the
    // guard until keel is named in it.
    expect(SOURCE).not.toContain("VARIANCE_CODES");
    expect(SOURCE).not.toContain("VARIANCE_CODE_LABELS");
  });

  /**
   * The SECOND leak channel, at the exact site it would open. `fileReleaseVariance`
   * is the filing tool, so a `z.enum` on its `code` parameter would hand the agent
   * the whole catalogue through the schema — and the demo would then run beautifully
   * while proving nothing, because the agent would file the right code first time
   * and never need to be taught.
   */
  it("takes a FREE z.string() on the filing tool's code, and says so in its describe", () => {
    const start = SOURCE.indexOf('name: "fileReleaseVariance"');
    expect(start).toBeGreaterThan(-1);
    const block = SOURCE.slice(start, start + 3000);
    // The parameter is a bare string, not an enum of any kind.
    expect(block).toContain("code: z\n          .string()");
    expect(block).not.toContain("z.enum");
    // And the withholding is stated where the model will read it, which is the
    // difference between "it cannot see the codes" and "it knows it cannot".
    expect(block).toContain("WITHHELD");
    expect(block).toContain("Never invent one");
  });
});
