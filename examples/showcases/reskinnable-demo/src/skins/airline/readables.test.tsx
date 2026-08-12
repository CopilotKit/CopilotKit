/**
 * BEAT 3b GUARD — "what's on my screen?"
 *
 * The beat is the presenter asking on one page, navigating, and asking again,
 * and getting two DIFFERENT, correct answers. It needs three things together: a
 * ROUTE readable (which page is open), PER-PAGE readables (what is rendered on
 * that page), and a prompt clause telling the agent that context IS its view of
 * the screen.
 *
 * THIS FILE GUARDS OMISSION — that the first two exist. Its companion,
 * `pages/on-screen-readables.test.tsx`, guards DRIFT — that each readable's rows
 * really are the rows its panel painted. Both are needed and neither subsumes
 * the other: a render test cannot notice a readable that was never written (the
 * page renders fine, the agent answers fluently, and every answer is the same
 * one), and a source grep cannot notice a readable whose list has quietly
 * diverged from the panel's by one row.
 *
 * ⚠️ THE THIRD LEG IS NOT GUARDED HERE, AND IS NOT YET WRITTEN. Logistics'
 * equivalent file asserts a "SCREEN AWARENESS" clause in its `agent.ts`. This
 * slot does not own `src/skins/airline/agent.ts`, so no such assertion exists
 * below — and airline's prompt carries no screen-awareness clause today. THE
 * BEAT IS INCOMPLETE WITHOUT IT: readables the agent is never told to treat as
 * its view of the screen produce an assistant that says it cannot see the page.
 * The slot that lands airline's prompt must add the clause AND the assertion
 * here, mirroring `skins/logistics/readables.test.tsx`.
 *
 * EVERY ASSERTION HERE MUST FAIL WHEN ITS SUBJECT IS DELETED. That sounds
 * obvious and it is where logistics' first version went wrong three times:
 * `toContain("useSkinSegments")` passed on the nav's pre-existing active-state
 * call, `toContain("Control Tower")` passed on the page's own `<h1>`, and
 * `toContain("useAgentContext")` passed on a leftover import. All three would
 * have stayed green with the readable deleted, which is worse than no test — a
 * guard that cannot fail actively suppresses the investigation that would find
 * the gap. Each assertion below is anchored INSIDE the construct it is about.
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
/**
 * Source with block and line comments removed. See the useSkinHref case.
 *
 * The line-comment pass requires the `//` to sit at a line start or after
 * whitespace, and it removes only the tail — not the whole line. Both details
 * matter: stripping whole lines would hide a violation sitting before a
 * trailing comment, and an unanchored `//` would eat everything after a
 * `https://` in a real string.
 */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");

const readableContaining = (needle: string) =>
  new RegExp(
    `useAgentContext\\([^;]*${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
  );

describe("airline beat 3b", () => {
  it("registers a route readable in the layout", () => {
    // Anchored on the VALUE the readable sends. `useSkinSegments` on its own
    // proves nothing here: layout.tsx already called it for nav active-state
    // before this readable existed, so the un-anchored form would stay green
    // with the whole `useAgentContext` call deleted.
    expect(read("layout.tsx")).toMatch(readableContaining("value: restHead"));
  });

  it("derives the route readable from useSkinSegments, not a manual split", () => {
    // Comments stripped for the negative half, for the same reason as the
    // useSkinHref case below: the layout's own comment EXPLAINS the trap by
    // naming `pathname.split(...)`, and matching that would fail the guard for
    // documenting the thing it exists to prevent.
    const layout = read("layout.tsx");
    expect(layout).toMatch(/const\s+restHead\s*=\s*useSkinSegments\(/);
    expect(stripComments(layout)).not.toMatch(/pathname\s*\.\s*split\s*\(/);
  });

  it.each([
    ["trips", "Your trip"],
    ["loyalty", "Aeronova Club"],
    ["disruptions", "Disruptions & service"],
    ["account", "Your account"],
    ["rebook", "Rebooking search"],
  ])("registers an on-screen readable in %s", (file, pageName) => {
    // `page: "Your account"` exists only inside the readable's payload — the
    // page's `<h1>` renders the same words as JSX text, which this cannot match.
    expect(read(path.join("pages", `${file}.tsx`))).toMatch(
      readableContaining(`page: "${pageName}"`),
    );
  });

  it("gives every page a DISTINCT name, or the beat cannot be demonstrated", () => {
    // Two pages answering to the same name is the same failure as no per-page
    // readable at all: the presenter navigates, asks again, and the room hears
    // the same sentence. The render test proves the VALUES differ — this proves
    // nobody has quietly copy-pasted a page name while adding a sixth page.
    const names = ["trips", "loyalty", "disruptions", "account", "rebook"].map(
      (file) => {
        const source = read(path.join("pages", `${file}.tsx`));
        const match = /useAgentContext\([^;]*page: "([^"]+)"/.exec(source);
        expect(match, `${file}.tsx registers no page name`).not.toBeNull();
        return match![1];
      },
    );
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("airline beat 3c", () => {
  it("reads all five levers off the query string through the shared record", () => {
    const page = read(path.join("pages", "rebook.tsx"));
    // `readLevers` is the ONE normalizer the confirm card, the pushed URL, this
    // page and `GET /bookings/[id]/options` all share. A page parsing the query
    // string by hand is how commerce's chips and rows drifted apart.
    expect(page).toMatch(/readLevers\(new URLSearchParams\(/);
    expect(page).toMatch(/applyLevers\(/);
  });

  it("gives every lever a control the agent can be seen to have set", () => {
    const page = read(path.join("pages", "rebook.tsx"));
    for (const label of [
      "Departure window",
      "Stops",
      "Cabin",
      "Sort order",
      "Result limit",
    ]) {
      expect(page).toContain(`aria-label="${label}"`);
    }
  });

  it("builds its own links through useSkinHref, never a hardcoded prefix", () => {
    // `pnpm lint`'s LOCK_SKIN selectors enforce this too, but only for the
    // patterns they recognise. A literal here would put the skin prefix back in
    // the address bar on the first lever click of a locked deploy.
    //
    // Comments are stripped first: the page's own header EXPLAINS the trap by
    // naming the literal it must not contain, and matching that would fail the
    // guard for writing the documentation it is meant to enforce.
    const page = stripComments(read(path.join("pages", "rebook.tsx")));
    expect(page).toMatch(/useSkinHref\(/);
    expect(page).not.toMatch(/["'`]\/airline\//);
  });
});
