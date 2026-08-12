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
    ]) {
      expect(SOURCE, `${name} is not registered`).toContain(`name: "${name}"`);
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
  });
});
