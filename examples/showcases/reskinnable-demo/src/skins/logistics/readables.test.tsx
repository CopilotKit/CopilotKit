/**
 * BEAT 3b GUARD — "what's on my screen?"
 *
 * The beat is the presenter asking on one page, navigating, and asking again,
 * and getting two DIFFERENT, correct answers. It needs three things together: a
 * ROUTE readable (which page is open), PER-PAGE readables (what is rendered on
 * that page), and a prompt clause telling the agent that context IS its view of
 * the screen.
 *
 * THIS FILE GUARDS OMISSION — that all three exist. Its companion,
 * `pages/on-screen-readables.test.tsx`, guards DRIFT — that each readable's rows
 * really are the rows its panel painted. Both are needed and neither subsumes
 * the other: a render test cannot notice a readable that was never written (the
 * page renders fine, the agent answers fluently, and every answer is the same
 * one), and a source grep cannot notice a readable whose list has quietly
 * diverged from the panel's by one row.
 *
 * EVERY ASSERTION HERE MUST FAIL WHEN ITS SUBJECT IS DELETED. That sounds
 * obvious and three of these did not, in the first version of this file:
 * `toContain("useSkinSegments")` passed on the nav's pre-existing active-state
 * call, `toContain("Control Tower")` passed on the page's own `<h1>`, and
 * `toContain("useAgentContext")` passed on a leftover import. All three would
 * have stayed green with the readable deleted, which is worse than no test —
 * a guard that cannot fail actively suppresses the investigation that would
 * find the gap. Each assertion below is now anchored INSIDE the construct it is
 * about; the mutation checks are recorded in this task's report.
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

/**
 * A `useAgentContext({ … })` call containing `needle`. `[^;]` cannot leave the
 * call: the argument is one object literal of strings and `JSON.stringify(…)`,
 * and the statement's own `;` terminates the window. That anchoring is the
 * whole point — an unanchored `toContain(needle)` matches the page's heading,
 * its imports, or a comment, none of which is a registered readable.
 */
const readableContaining = (needle: string) =>
  new RegExp(
    `useAgentContext\\([^;]*${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
  );

describe("logistics beat 3b", () => {
  it("registers a route readable in the layout", () => {
    // Anchored on the VALUE the readable sends. `useSkinSegments` on its own
    // proves nothing here: layout.tsx already called it for nav active-state
    // before this readable existed, so the un-anchored form stayed green with
    // the whole `useAgentContext` call deleted.
    expect(read("layout.tsx")).toMatch(readableContaining("value: restHead"));
  });

  it("derives the route readable from useSkinSegments, not a manual split", () => {
    const layout = read("layout.tsx");
    expect(layout).toMatch(/const\s+restHead\s*=\s*useSkinSegments\(/);
    expect(layout).not.toMatch(/pathname\s*\.\s*split\s*\(/);
  });

  it.each([
    ["control-tower", "Control Tower"],
    ["lanes", "Lanes"],
    ["inventory", "Inventory at Risk"],
    ["decisions", "Decision Log"],
  ])("registers an on-screen readable in %s", (file, pageName) => {
    // `page: "Control Tower"` exists only inside the readable's payload — the
    // page's `<h1>` renders the same words as JSX text, which this cannot match.
    expect(read(path.join("pages", `${file}.tsx`))).toMatch(
      readableContaining(`page: "${pageName}"`),
    );
  });

  it("tells the agent its context is its view of the screen", () => {
    const agent = read("agent.ts");
    expect(agent).toContain("SCREEN AWARENESS");
    expect(agent).toMatch(/NEVER say you cannot see the screen/i);
  });
});
