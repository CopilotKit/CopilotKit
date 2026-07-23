/**
 * Microsoft Graph file access for Teams CHANNEL messages.
 *
 * The Teams bot file API (the `file.download.info` attachment) only fires in a
 * 1:1 personal chat. In a channel the bot's inbound activity carries no file at
 * all — the upload lives in the team's SharePoint document library and is only
 * referenced from the channel *message*, which the bot doesn't receive inline.
 * So to chart "a CSV someone dropped in a channel" we go through Graph:
 *
 *   1. Acquire an app-only Graph token (client credentials — the same
 *      clientId/clientSecret/tenantId the adapter already uses for Teams).
 *   2. Read the channel message to find its file attachments
 *      (`GET /teams/{team}/channels/{channel}/messages/{id}` — app-only via the
 *      RSC permission `ChannelMessage.Read.Group`, declared in the app
 *      manifest; no tenant admin consent or protected-API approval needed).
 *   3. Download each referenced SharePoint file via the `/shares` endpoint
 *      (needs the `Files.Read.All` application permission + admin consent).
 *
 * Returns nothing (with a note) when Graph isn't configured or a step fails, so
 * the bot degrades to asking the user to paste the data rather than crashing.
 */
import {
  decodeFileBytes,
  mimeFromName,
  type FileDeliveryConfig,
} from "./download-files.js";
import type { AgentContentPart } from "@copilotkit/channels-ui";

/** The Microsoft credentials needed for an app-only Graph token. */
export interface GraphCredentials {
  clientId: string;
  clientSecret: string;
  tenantId: string;
}

/** Identifiers needed to read a channel message, pulled from the activity. */
export interface ChannelMessageRef {
  /** The team's Entra (AAD) group id — `channelData.team.aadGroupId`. */
  teamId: string;
  /** The channel thread id — `channelData.teamsChannelId`. */
  channelId: string;
  /** The inbound message id (`activity.id`). */
  messageId: string;
  /** Root message id when this is a reply; equals `messageId` for a top-level post. */
  rootId: string;
}

const GRAPH = "https://graph.microsoft.com/v1.0";

/** A file referenced from a channel message (a Graph `reference` attachment). */
interface GraphFileRef {
  name: string;
  contentUrl: string;
}

// One cached app token per process; Graph tokens last ~1h. Date.now is fine here
// (this is ordinary runtime code, not a replay-sensitive workflow script).
let cachedToken: { token: string; expiresAt: number } | undefined;

/** Acquire (and cache) an app-only Graph token via the client-credentials grant. */
async function acquireAppToken(creds: GraphCredentials): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.token;
  }
  const body = new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const res = await fetch(
    `https://login.microsoftonline.com/${creds.tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    },
  );
  if (!res.ok) {
    throw new Error(
      `Graph token request failed (HTTP ${res.status}): ${(await res.text()).slice(0, 200)}`,
    );
  }
  const json = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };
  cachedToken = {
    token: json.access_token,
    expiresAt: now + json.expires_in * 1000,
  };
  return cachedToken.token;
}

/** Encode a sharing URL into a Graph `/shares` share id (`u!<base64url>`). */
function shareIdFor(url: string): string {
  const b64 = Buffer.from(url, "utf8").toString("base64");
  return "u!" + b64.replace(/=+$/, "").replace(/\//g, "_").replace(/\+/g, "-");
}

/** Read a channel message and return its file-reference attachments. */
async function getMessageFileRefs(
  ref: ChannelMessageRef,
  token: string,
): Promise<GraphFileRef[]> {
  const channel = encodeURIComponent(ref.channelId);
  const url =
    ref.rootId && ref.rootId !== ref.messageId
      ? `${GRAPH}/teams/${ref.teamId}/channels/${channel}/messages/${ref.rootId}/replies/${ref.messageId}`
      : `${GRAPH}/teams/${ref.teamId}/channels/${channel}/messages/${ref.messageId}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(
      `read channel message failed (HTTP ${res.status}): ${(await res.text()).slice(0, 200)}`,
    );
  }
  const msg = (await res.json()) as {
    attachments?: Array<{
      contentType?: string;
      contentUrl?: string;
      name?: string;
    }>;
  };
  return (msg.attachments ?? [])
    .filter(
      (a): a is { contentType: string; contentUrl: string; name?: string } =>
        a.contentType === "reference" && typeof a.contentUrl === "string",
    )
    .map((a) => ({ name: a.name ?? "file", contentUrl: a.contentUrl }));
}

/** Download a SharePoint file by its sharing URL via the Graph `/shares` API. */
async function downloadSharedFile(
  contentUrl: string,
  token: string,
): Promise<Buffer> {
  const res = await fetch(
    `${GRAPH}/shares/${shareIdFor(contentUrl)}/driveItem/content`,
    { headers: { Authorization: `Bearer ${token}` }, redirect: "follow" },
  );
  if (!res.ok) {
    throw new Error(`download failed (HTTP ${res.status})`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Resolve a channel message's uploaded files into AG-UI content parts via
 * Graph. Returns `{ parts, notes }`; on any failure the parts are empty and a
 * note explains why (so the caller can tell the user to paste the data).
 */
export async function buildChannelFileContentParts(
  ref: ChannelMessageRef,
  creds: GraphCredentials,
  config: FileDeliveryConfig = {},
): Promise<{ parts: AgentContentPart[]; notes: string[] }> {
  const parts: AgentContentPart[] = [];
  const notes: string[] = [];

  let token: string;
  try {
    token = await acquireAppToken(creds);
  } catch (err) {
    notes.push(`couldn't get a Graph token: ${(err as Error).message}`);
    return { parts, notes };
  }

  let refs: GraphFileRef[];
  try {
    refs = await getMessageFileRefs(ref, token);
  } catch (err) {
    notes.push(
      `couldn't read channel-message files via Graph (is ChannelMessage.Read.Group granted?): ${(err as Error).message}`,
    );
    return { parts, notes };
  }

  const maxFiles = config.maxFiles ?? 5;
  for (const f of refs.slice(0, maxFiles)) {
    let bytes: Buffer;
    try {
      bytes = await downloadSharedFile(f.contentUrl, token);
    } catch (err) {
      notes.push(
        `skipped "${f.name}" (is Files.Read.All granted?): ${(err as Error).message}`,
      );
      continue;
    }
    const mime = mimeFromName(f.name) ?? "application/octet-stream";
    const decoded = decodeFileBytes(f.name, mime, bytes, config);
    if ("note" in decoded) notes.push(decoded.note);
    else parts.push(decoded.part);
  }

  return { parts, notes };
}
