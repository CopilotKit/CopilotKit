/**
 * Slack-platform-universal frontend tools — tools every Slack bot
 * benefits from, regardless of what the bot does. Apps spread
 * `defaultSlackTools` into the `tools:` config they pass to
 * `createSlackBridge`.
 */
import { z } from "zod";
import type { FrontendTool, FrontendToolContext } from "./frontend-tools.js";

interface SlackMember {
  id: string;
  name?: string;
  real_name?: string;
  deleted?: boolean;
  is_bot?: boolean;
  profile?: {
    real_name?: string;
    display_name?: string;
    display_name_normalized?: string;
    real_name_normalized?: string;
    email?: string;
  };
}

interface DirectoryEntry {
  id: string;
  handle: string;
  realName: string;
  displayName: string;
  email: string;
  aliases: string[];
}

const CACHE_TTL_MS = 10 * 60 * 1000;
let cached: { at: number; entries: DirectoryEntry[] } | undefined;

function normalise(s: string | undefined): string {
  return (s ?? "").toLowerCase().trim();
}

function toEntry(m: SlackMember): DirectoryEntry | undefined {
  if (!m.id || m.deleted || m.is_bot) return undefined;
  const handle = m.name ?? "";
  const realName = m.profile?.real_name ?? m.real_name ?? "";
  const displayName = m.profile?.display_name ?? "";
  const email = m.profile?.email ?? "";
  const aliases = [
    handle,
    realName,
    displayName,
    m.profile?.display_name_normalized,
    m.profile?.real_name_normalized,
    email,
    email.split("@")[0],
    realName.split(/\s+/)[0],
  ]
    .map(normalise)
    .filter((s): s is string => Boolean(s));
  return { id: m.id, handle, realName, displayName, email, aliases };
}

async function loadDirectory(
  ctx: FrontendToolContext,
): Promise<DirectoryEntry[]> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.entries;
  const entries: DirectoryEntry[] = [];
  let cursor: string | undefined;
  do {
    const r = (await ctx.client.users.list({
      cursor,
      limit: 200,
    })) as {
      ok?: boolean;
      members?: SlackMember[];
      response_metadata?: { next_cursor?: string };
    };
    for (const m of r.members ?? []) {
      const entry = toEntry(m);
      if (entry) entries.push(entry);
    }
    cursor = r.response_metadata?.next_cursor || undefined;
  } while (cursor);
  cached = { at: now, entries };
  return entries;
}

function matchEntry(
  entries: DirectoryEntry[],
  rawQuery: string,
): DirectoryEntry | undefined {
  const q = normalise(rawQuery);
  if (!q) return undefined;
  const exact = entries.find((e) => e.aliases.includes(q));
  if (exact) return exact;
  const byEmail = entries.find((e) => normalise(e.email) === q);
  if (byEmail) return byEmail;
  const startsWith = entries.find((e) =>
    e.aliases.some((a) => a.startsWith(q)),
  );
  if (startsWith) return startsWith;
  return entries.find((e) => e.aliases.some((a) => a.includes(q)));
}

const lookupSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      "Handle, display name, first name, or email of the person to look up.",
    ),
});

export const lookupSlackUserTool: FrontendTool<typeof lookupSchema> = {
  name: "lookup_slack_user",
  description:
    "Resolve a person to a Slack user ID so you can @-mention them. " +
    "Accepts a handle (`atai`), display name (`Atai Barkai`), first name, " +
    "or email. Returns a JSON object with `found`, and on success a " +
    "`mention` string (e.g. `<@U0B45V75NNR>`) — put that string verbatim " +
    "in your reply to ping them. If `found` is false, write the plain " +
    "name instead.",
  parameters: lookupSchema,
  async handler({ query }, ctx) {
    let entries: DirectoryEntry[];
    try {
      entries = await loadDirectory(ctx);
    } catch (err) {
      return JSON.stringify({
        found: false,
        reason: `directory fetch failed: ${(err as Error).message}`,
      });
    }
    const hit = matchEntry(entries, query);
    if (!hit) return JSON.stringify({ found: false, query });
    return JSON.stringify({
      found: true,
      query,
      userId: hit.id,
      handle: hit.handle,
      realName: hit.realName,
      mention: `<@${hit.id}>`,
    });
  },
};

/** Test seam: wipe the in-module directory cache. */
export function _resetLookupCache(): void {
  cached = undefined;
}

/**
 * The flat list of tools the SDK ships. Spread into your
 * `createSlackBridge({tools: …})`:
 *
 *     tools: [...defaultSlackTools, ...myAppTools],
 */
export const defaultSlackTools: ReadonlyArray<FrontendTool> = [
  lookupSlackUserTool,
];
