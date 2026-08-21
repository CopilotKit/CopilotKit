/**
 * BEAT 1 for `airline` — the demo opens on a CHART.
 *
 * The claim beat 1 makes is "generative UI, right out of the gate": the first
 * thing the room sees is a picture, not a paragraph. Three things have to line
 * up for that, and each fails in a way nothing else in this app notices:
 *
 *   1. The PILL has to ask the question the chart answers. A pill whose wording
 *      routes elsewhere degrades the beat to whatever tool did match, and the
 *      answer still reads fine.
 *   2. The TOOL has to be registered, and registered as a `useComponent`. A
 *      component that is defined and never registered compiles, lints and
 *      renders — and fails only when someone clicks the pill on stage.
 *      `useFrontendTool` would also "work" live and then replay blank, which is
 *      beat 2's failure wearing beat 1's clothes.
 *   3. The PROMPT has to name it, and has to demand prose alongside it. A chart
 *      with no words reads as a glitch; words with no chart waste the beat.
 *
 * Source-level on purpose: what fails here is what the MODEL was told plus what
 * was registered, neither of which any render test reaches.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) =>
  readFileSync(join(__dirname, file), "utf8").replace(/\r\n/g, "\n");

const tools = read("tools.tsx");
const prompt = read("agent.ts");
const pills = read("suggestions.ts");

const TOOL = "showFlightCadence";

describe("beat 1 — the pill asks about frequency", () => {
  it("ships a pill about how often they fly", () => {
    expect(pills).toMatch(/title:\s*"How often do I fly\?"/);
  });

  it("keeps it distinguishable from the beat-4 trip summary", () => {
    // Both used to be phrased about "trips", which is how a frequency question
    // ends up rendering the trip wall instead of the chart.
    expect(pills).toMatch(/title:\s*"Summarize my trips"/);
    expect(pills).not.toMatch(/title:\s*"How do my trips look\?"/);
  });
});

describe("beat 1 — the chart is registered as a replayable component", () => {
  it(`registers ${TOOL}`, () => {
    expect(tools).toContain(`name: "${TOOL}"`);
  });

  it("registers it with useComponent, not useFrontendTool", () => {
    // Only a component replays out of thread history, which is exactly what
    // beat 2 asks the audience to reload and see.
    const start = tools.indexOf(`name: "${TOOL}"`);
    expect(start).toBeGreaterThan(-1);
    const before = tools.slice(0, start);
    const registrar = before.lastIndexOf("useComponent(");
    const frontend = before.lastIndexOf("useFrontendTool(");
    const hitl = before.lastIndexOf("useHumanInTheLoop(");
    expect(registrar).toBeGreaterThan(frontend);
    expect(registrar).toBeGreaterThan(hitl);
  });

  it("takes the recall note, so beat 4 has somewhere visible to land", () => {
    const block = tools.slice(
      tools.indexOf(`name: "${TOOL}"`),
      tools.indexOf("render:", tools.indexOf(`name: "${TOOL}"`)),
    );
    expect(block).toMatch(/note:\s*z/);
  });
});

describe("beat 1 — the prompt sends frequency questions to the chart", () => {
  it("names the tool", () => {
    expect(prompt).toContain(TOOL);
  });

  it("demands the chart AND prose quoting its figures", () => {
    expect(prompt.toLowerCase()).toMatch(/chart with no words|render it and say/);
  });
});

describe("beat 1 — the chart does not read a live clock", () => {
  // The app runs on a fixed demo clock (`SEED_NOW`). A component or helper that
  // reached for the real date would draw a divider the server never rendered —
  // a hydration mismatch whose visible symptom is a summary line disagreeing
  // with the picture beside it.
  const helper = read("data/flight-cadence.ts");
  const chart = read("components/flight-cadence-chart.tsx");
  const stripComments = (s: string) =>
    s
      .split("\n")
      .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//"))
      .join("\n");

  it("uses no Date in the helper", () => {
    expect(stripComments(helper)).not.toMatch(/new Date\(|Date\.now\(/);
  });

  it("uses no Date in the component", () => {
    expect(stripComments(chart)).not.toMatch(/new Date\(|Date\.now\(/);
  });
});
