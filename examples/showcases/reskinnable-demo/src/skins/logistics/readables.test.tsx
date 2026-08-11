/**
 * BEAT 3b GUARD — "what's on my screen?"
 *
 * The beat is the presenter asking on one page, navigating, and asking again,
 * and getting two DIFFERENT, correct answers. It needs three things together: a
 * ROUTE readable (which page is open), PER-PAGE readables (what is rendered on
 * that page), and a prompt clause telling the agent that context IS its view of
 * the screen.
 *
 * WHY A SOURCE-TEXT GUARD RATHER THAN A RENDER TEST. This beat is broken by
 * OMISSION, and omission is exactly what a render test does not catch: a skin
 * with only GLOBAL readables renders perfectly, answers fluently, and gives the
 * same answer no matter which page is open. Nothing fails. It reads as working
 * right up until the presenter navigates and asks twice, on stage. Deleting any
 * one of the three below is a silent regression, so each one is asserted.
 *
 * The route readable specifically must come from `useSkinSegments`, never a
 * hand-rolled `pathname.split("/")[2]`: the manual form slices a FIXED offset
 * and is right only while the URL carries the skin prefix, so it reports the
 * wrong page on a LOCK_SKIN deploy — where the skin is served at `/` — while
 * still passing every test run against an unlocked dev server.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SKIN_ROOT = __dirname;
const read = (rel: string) => readFileSync(path.join(SKIN_ROOT, rel), "utf8");

describe("logistics beat 3b", () => {
  it("registers a route readable in the layout", () => {
    const layout = read("layout.tsx");
    expect(layout).toContain("useAgentContext");
    expect(layout).toContain("useSkinSegments");
  });

  it("derives the route readable from useSkinSegments, not a manual split", () => {
    const layout = read("layout.tsx");
    expect(layout).not.toMatch(/pathname\s*\.\s*split\s*\(/);
  });

  it.each([
    ["control-tower", "Control Tower"],
    ["lanes", "Lanes"],
    ["inventory", "Inventory"],
    ["decisions", "Decision Log"],
  ])("registers an on-screen readable in %s", (file, pageName) => {
    const src = read(path.join("pages", `${file}.tsx`));
    expect(src).toContain("useAgentContext");
    expect(src).toContain(pageName);
  });

  it("tells the agent its context is its view of the screen", () => {
    const agent = read("agent.ts");
    expect(agent).toContain("SCREEN AWARENESS");
    expect(agent).toMatch(/NEVER say you cannot see the screen/i);
  });
});
