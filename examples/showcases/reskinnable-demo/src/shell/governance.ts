/**
 * Memory governance — the ONE definition of the demo's tenants and memory
 * postures, shared by the client control and the server policy.
 *
 * SERVER-SAFE: no "use client", no JSX, no React. The API route imports this to
 * resolve `identifyUser` and `memory.access`; the popover imports it to render
 * the options. A second list would let the two drift, and the failure mode is
 * silent: the UI offers a tenant the server does not recognise, the server falls
 * back to the default bucket, and the room sees isolation "not working" with
 * nothing in any log to explain it.
 *
 * ── WHY COOKIES AND NOT THE RUN `properties` ────────────────────────────────
 * A skin's persona already rides on CopilotKit run `properties`, which live in
 * the run request BODY. The requests that matter most for memory are bodyless —
 * listing memories, listing threads, `/info` — so anything derived from a body
 * silently falls back to a default identity on exactly those routes. That is the
 * bug the ⚠ blocks in `agent-registry.ts` describe. A cookie rides on EVERY
 * request, so identity stops depending on which route happens to carry a body.
 *
 * These cookies are deliberately NOT httpOnly: the popover reads them to show
 * the current state. That is fine here because they are a DEMO stand-in for
 * authentication, and the thing being demonstrated is that the server decides
 * from something on the request. A real deployment reads a verified token in the
 * same two callbacks and never trusts a value the browser can set.
 */

/** Cookie names, shared so client and server cannot disagree about spelling. */
export const TENANT_COOKIE = "demo_tenant";
export const MEMORY_GRANT_COOKIE = "demo_memory_grant";

export interface DemoTenant {
  readonly id: string;
  readonly name: string;
  /** One line the presenter can read aloud when switching. */
  readonly blurb: string;
}

/**
 * The demo's customer organizations. Two is the right number: isolation is a
 * claim about a PAIR, and a third adds nothing a room can follow.
 */
export const DEMO_TENANTS: readonly DemoTenant[] = [
  {
    id: "acme",
    name: "Acme Health",
    blurb: "A hospital network. Its people and their memories live here.",
  },
  {
    id: "globex",
    name: "Globex Medical",
    blurb: "A different customer, same app, same agent — separate memories.",
  },
];

const TENANT_IDS: ReadonlySet<string> = new Set(
  DEMO_TENANTS.map((tenant) => tenant.id),
);

/**
 * Validate an untrusted tenant id. A `Set` rather than a plain-object lookup
 * because this value becomes part of a MEMORY SCOPE: an object lookup walks the
 * prototype chain, so `__proto__` or `constructor` would resolve truthy and mint
 * a bucket nobody intended. `Set.has` only ever sees real entries.
 */
export function isDemoTenant(value: string | undefined): value is string {
  return value !== undefined && TENANT_IDS.has(value);
}

export function tenantById(id: string | undefined): DemoTenant | undefined {
  return DEMO_TENANTS.find((tenant) => tenant.id === id);
}

/** Exactly the three access levels the runtime accepts. */
export type MemoryAccessLevel = "none" | "read" | "read-write";

export interface MemoryGrant {
  readonly user: MemoryAccessLevel;
  readonly project: MemoryAccessLevel;
}

export interface MemoryPosture {
  readonly id: string;
  readonly name: string;
  /** What this posture means, in the words a buyer uses. */
  readonly blurb: string;
  readonly grant: MemoryGrant;
}

/**
 * Named postures rather than a free-form pair of dropdowns. Nine combinations is
 * a matrix; four named postures is something a room can follow, and each one is
 * a posture a real customer actually asks for by name.
 *
 * ── WHAT `shared` DOES AND DOES NOT SHOW ON STAGE ──────────────────────────
 * It genuinely opens the shared scope, and a memory written there IS readable by
 * every tenant — visible by listing memories as each tenant in turn.
 *
 * What it will NOT do is produce a leak by ASKING the agent to save something
 * project-wide. Measured on keel: with this posture active, "save this
 * project-wide" is refused by the AGENT, which replies that shared memories
 * would leak into other products and offers to save it user-scoped instead. That
 * refusal comes from the skin's own prompt, not from the grant — every skin here
 * is instructed never to use project scope, because project scope is global to
 * the one shared Intelligence backend and a reset sweep would delete a sibling
 * skin's seeds (CLAUDE.md § per-skin server identity spells this out).
 *
 * So the grant is the ceiling and the prompt is currently lower than it. Do not
 * plan a stage beat around watching a memory cross tenants through the chat; it
 * will not happen, and the agent's refusal — while correct — is easily mistaken
 * for the grant doing the work when it is not.
 */
export const MEMORY_POSTURES: readonly MemoryPosture[] = [
  {
    id: "isolated",
    name: "Isolated",
    blurb:
      "Personal memory only. Nothing can be written where another customer could read it.",
    grant: { user: "read-write", project: "none" },
  },
  {
    id: "shared",
    name: "Shared pool open",
    blurb:
      "The shared pool is readable and writable — anyone on this project sees what lands there.",
    grant: { user: "read-write", project: "read-write" },
  },
  {
    id: "recall-only",
    name: "Recall only",
    blurb:
      "Reads what it already knows, records nothing new. The cautious first rollout.",
    grant: { user: "read", project: "none" },
  },
  {
    id: "off",
    name: "Off",
    blurb:
      "No memory at all. The assistant still answers — it just has nothing to remember with.",
    grant: { user: "none", project: "none" },
  },
];

/**
 * ── "OFF" DEPENDS ON A RUNTIME FIX THAT IS NOT IN A RELEASE YET ─────────────
 *
 * On the published runtime this demo installs, a grant with both scopes at
 * `"none"` did not disable memory — it REFUSED the request, and because the
 * memory tools are attached during the run, that refusal failed the whole agent
 * run. The conversation produced no reply at all and the only signal was a bare
 * `agent_run_failed` in the console. Measured here, which is how it was found.
 *
 * CopilotKit/CopilotKit#7352 fixes that in the runtime: a grant of nothing now
 * attaches no memory tools and lets the run proceed, matching what Channels has
 * always done with the same shape. The browser memory routes still answer 403,
 * because there the refusal answers the question actually asked.
 *
 * Until that ships in a canary this app can install, the fix is applied to the
 * INSTALLED copy by `scripts/patch-runtime-memory-grant.py`. A reinstall wipes
 * it — so if "Off" ever kills the conversation again, that is the first thing
 * to check, not a regression in this file.
 */

export const DEFAULT_POSTURE_ID = "isolated";

export function postureById(id: string | undefined): MemoryPosture {
  return (
    MEMORY_POSTURES.find((posture) => posture.id === id) ??
    MEMORY_POSTURES.find((posture) => posture.id === DEFAULT_POSTURE_ID)!
  );
}

/**
 * Read one cookie off a raw `Request`. Used by the server policy; the client
 * reads `document.cookie` instead, which is why this takes a `Request` rather
 * than living in a React hook.
 */
export function readRequestCookie(
  request: Request,
  name: string,
): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const value = decodeURIComponent(part.slice(eq + 1).trim());
    return value === "" ? undefined : value;
  }
  return undefined;
}
