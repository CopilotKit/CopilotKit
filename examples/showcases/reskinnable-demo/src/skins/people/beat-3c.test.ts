/**
 * BEAT 3c for `people` — the agent must MOVE the user, not describe the move.
 *
 * THE FAILURE THIS PINS. Asked for "the ten oldest requests still waiting on
 * me", the agent replied in prose:
 *
 *     Confirm the levers and I'll take you there: **pending** only, sorted by
 *     **oldest first**, top **10**.
 *
 * and stopped. No tool call, no confirm card, no navigation. That is beat 3c
 * failing while looking like it worked — the answer is correct, well formatted,
 * and proves nothing, because "that was a maneuver, not a link" is exactly the
 * claim the beat exists to make.
 *
 * WHY IT HAPPENED, and why each assertion below is the fix rather than a wish:
 *
 *   1. `showRequestQueue`'s description said "Confirm the levers with them
 *      first" without saying WHERE that confirmation happens. The HITL card IS
 *      the confirmation — it lists the levers and waits — but nothing told the
 *      model that, so confirming in prose SATISFIED the instruction it was
 *      given. The model was not disobeying; it was obeying a sentence that read
 *      two ways.
 *   2. The prompt never mentioned the tool at all. `agent.ts` had no navigation
 *      guidance of any kind, so nothing connected "show me the oldest requests"
 *      to a tool call.
 *   3. `top` was `.optional()`. An optional lever invites the model to go and
 *      GET the missing value first, which is one more reason to talk instead of
 *      act. `logistics` hit this and fixed it by making every lever REQUIRED
 *      with a sentinel meaning "leave this one alone" — `0` for the limit,
 *      which the render already treats as "set no limit" because
 *      `if (args?.top)` is falsy at 0.
 *
 * These are source-level assertions on purpose. What went wrong is not
 * reachable by rendering a component: it is what the MODEL was told, and the
 * model reads `description` and the prompt. Nothing else in this app checks
 * either of those, which is how a sibling skin kept the defect after logistics
 * had already fixed it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) =>
  readFileSync(join(__dirname, file), "utf8").replace(/\r\n/g, "\n");

const tools = read("tools.tsx");
const prompt = read("agent.ts");

/** The `showRequestQueue` definition only, so a match elsewhere cannot pass. */
const queueTool = (() => {
  const start = tools.indexOf('name: "showRequestQueue"');
  expect(start, "showRequestQueue must exist").toBeGreaterThan(-1);
  const end = tools.indexOf("render:", start);
  return tools.slice(start, end);
})();

/**
 * Same block with `//` comments removed, for assertions about what the CODE
 * does. The comment explaining why `top` is not `.optional()` contains the
 * literal `.optional()`, so a naive scan of the raw source reports the defect
 * it is documenting. Assertions about what the MODEL is told keep the comments
 * out of scope by reading `description` text, which is a string literal.
 */
const queueToolCode = queueTool
  .split("\n")
  .filter((line) => !line.trim().startsWith("//"))
  .join("\n");

describe("beat 3c — the prompt sends the user to the queue", () => {
  it("names the tool, so the model knows one exists for this question", () => {
    expect(prompt).toContain("showRequestQueue");
  });

  it("says to PUT the user in front of the queue rather than describe it", () => {
    // The wording that fixed logistics. Without it the model answers the
    // question truthfully in prose and never moves anyone.
    expect(prompt.toLowerCase()).toMatch(
      /in front of[\s\S]{0,80}rather than describ/,
    );
  });
});

describe("beat 3c — the tool tells the model the CARD confirms", () => {
  it("does not leave 'confirm first' ambiguous", () => {
    // The card lists the levers and waits for a click. If the description does
    // not say so, "confirm the levers with them first" is satisfied by a
    // sentence in the chat, which is the bug.
    expect(queueTool.toLowerCase()).toMatch(/card[\s\S]{0,60}lever/);
  });
});

describe("beat 3c — every lever is required, with a leave-it-alone value", () => {
  it("takes no optional lever", () => {
    // `.optional()` on a lever is an invitation to go and ask for it.
    expect(queueToolCode).not.toMatch(/\.optional\(\)/);
  });

  it("keeps status and sort as closed sets the page can actually honour", () => {
    expect(queueToolCode).toMatch(/status:\s*z\s*\n?\s*\.?enum/);
    expect(queueToolCode).toMatch(/sort:\s*z\s*\n?\s*\.?enum/);
  });

  it("documents the sentinel that means 'do not limit'", () => {
    // 0 is deliberate and load-bearing: `if (args?.top)` in the render is falsy
    // at 0, so the `top` query param is never set and the page applies no
    // limit. A required lever with no way to say "leave this alone" would force
    // the model to invent a limit nobody asked for.
    expect(queueTool).toMatch(/0[\s\S]{0,80}no limit|no limit[\s\S]{0,80}0/i);
  });
});
