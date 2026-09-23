import { NextResponse } from "next/server";

import { agentRegistry } from "@/shell/agent-registry";
import { defaultSkinId } from "@/shell/skins-config";
import { DEMO_TENANTS } from "@/shell/governance";

/**
 * Forget the memories the ORGANIZATION switcher creates, for the persona now on
 * screen, in EVERY organization at once.
 *
 * ── WHY THE SKINS' OWN RESET BUTTONS DO NOT COVER THIS ─────────────────────
 * Each skin ships `v1/dev/reset`, which forgets the buckets that skin's own
 * resolver names (`keel-lin-avery`, and so on). The organization switcher
 * prefixes the resolved id with the tenant (`acme:keel-lin-avery`), and that
 * happens in the shared CopilotKit route AFTER the skin's resolver has run — so
 * a skin's reset never sees these buckets. It does not fail; it forgets nothing,
 * which looks identical to a clean demo until the agent recalls last
 * rehearsal's preference in front of the room.
 *
 * ── WHY BOTH ORGANIZATIONS, NOT JUST THE ACTIVE ONE ────────────────────────
 * The beat being reset spans both: teach as one customer, check as the other.
 * Clearing only the active one leaves the second half of the demo primed, so
 * the "it knows nothing" moment would be the one that silently broke.
 *
 * ── WHY USER SCOPE ONLY ────────────────────────────────────────────────────
 * Project-scoped rows are global to the single Intelligence backend every skin
 * in this app shares, so sweeping them deletes a sibling skin's seeds —
 * banking's stored-procedure beat lives there (see CLAUDE.md § per-skin server
 * identity). A reset that quietly breaks the neighbouring demo is worse than no
 * reset.
 */

const PRESENTER_RESET_ENABLED = process.env.PRESENTER_RESET_ENABLED === "true";
const INTELLIGENCE_API_URL = process.env.INTELLIGENCE_API_URL;
const CPK_INTELLIGENCE_API_KEY = process.env.CPK_INTELLIGENCE_API_KEY;

interface Memory {
  readonly id: string;
  readonly scope?: string;
}

async function forgetUserScoped(userId: string): Promise<number> {
  const headers = {
    Authorization: `Bearer ${CPK_INTELLIGENCE_API_KEY}`,
    "X-Cpki-User-Id": userId,
  };

  const listed = await fetch(`${INTELLIGENCE_API_URL}/api/memories`, {
    headers,
  });
  // An empty or never-used bucket is the normal state, not an error.
  if (!listed.ok) return 0;

  const body = (await listed.json()) as { memories?: Memory[] };
  const rows = (body.memories ?? []).filter((m) => m.scope !== "project");

  let forgotten = 0;
  for (const row of rows) {
    const deleted = await fetch(
      `${INTELLIGENCE_API_URL}/api/memories/${row.id}`,
      { method: "DELETE", headers },
    );
    if (deleted.ok) forgotten += 1;
  }
  return forgotten;
}

export async function POST(request: Request) {
  // The same gate the skins' own reset routes use, so a deployment cannot end
  // up with one presenter control live and another 403ing.
  if (!PRESENTER_RESET_ENABLED) {
    return NextResponse.json({ error: "Not enabled" }, { status: 403 });
  }
  if (!INTELLIGENCE_API_URL || !CPK_INTELLIGENCE_API_KEY) {
    return NextResponse.json(
      { error: "Intelligence is not configured; nothing to forget" },
      { status: 409 },
    );
  }

  const { agentId } = (await request.json().catch(() => ({}))) as {
    agentId?: string;
  };

  // Resolve the persona the SAME way the CopilotKit route does, so the bucket
  // this clears is exactly the bucket a run would have written to. Reaching
  // through the server registry keeps the skin's own scheme where it belongs;
  // this route never learns what a keel persona is.
  const resolve =
    (agentId ? agentRegistry[agentId]?.identifyUser : undefined) ??
    agentRegistry[defaultSkinId]?.identifyUser;
  if (!resolve) {
    return NextResponse.json(
      { error: `No identity resolver for agent "${agentId ?? defaultSkinId}"` },
      { status: 400 },
    );
  }

  // `undefined` properties on purpose: this is a bodyless-style resolution, the
  // same one every non-run request gets, so it lands on the skin's default
  // persona bucket — which is where the demo's memories actually accumulate.
  const base = resolve(undefined);

  let forgotten = 0;
  for (const tenant of DEMO_TENANTS) {
    forgotten += await forgetUserScoped(`${tenant.id}:${base.id}`);
  }

  return NextResponse.json({ forgotten, personas: [base.id] });
}
