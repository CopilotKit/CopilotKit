/**
 * Standalone verification of the app-only Graph channel-file chain — the exact
 * sequence the CopilotKit Channels Teams integration runs in a channel, WITHOUT the bot, a tunnel,
 * an Azure Bot resource, or Chromium. Use it to prove the permission model in a
 * tenant where YOU are the admin (e.g. a free Microsoft 365 Developer sandbox)
 * before asking your real org's admin to consent.
 *
 * Setup (in the sandbox, where you're Global Admin):
 *   1. Entra → App registrations → New registration (single tenant is fine).
 *   2. API permissions → add Microsoft Graph APPLICATION permissions
 *        - ChannelMessage.Read.All   (read the channel message)
 *        - Files.Read.All            (download the SharePoint file)
 *      → Grant admin consent (you can — you're the admin).
 *   3. Certificates & secrets → new client secret.
 *   4. Create a team + channel, upload a CSV to the channel.
 *   5. Get the team + channel ids: open the channel → ••• → "Get link to
 *      channel". The link has groupId=<TEAM_ID> and the channel id is the
 *      "19:....@thread.tacv2" segment (URL-decode %3a → :, %40 → @).
 *
 * Run:
 *   CLIENT_ID=... CLIENT_SECRET=... TENANT_ID=... \
 *   TEAM_ID=... CHANNEL_ID='19:xxxx@thread.tacv2' \
 *   pnpm --filter teams-example exec tsx scripts/verify-graph-channel.ts
 */
const GRAPH = "https://graph.microsoft.com/v1.0";

function need(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing env var ${name} (see the header of this file).`);
    process.exit(1);
  }
  return v;
}

function shareIdFor(url: string): string {
  const b64 = Buffer.from(url, "utf8").toString("base64");
  return "u!" + b64.replace(/=+$/, "").replace(/\//g, "_").replace(/\+/g, "-");
}

async function main(): Promise<void> {
  const clientId = need("CLIENT_ID");
  const clientSecret = need("CLIENT_SECRET");
  const tenantId = need("TENANT_ID");
  const teamId = need("TEAM_ID");
  const channelId = need("CHANNEL_ID");

  // Step 1 — app-only token (client credentials), exactly like the bot.
  console.log("[1/3] Acquiring app-only Graph token…");
  const tokenRes = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
    },
  );
  if (!tokenRes.ok) {
    console.error(
      `  ✗ token failed (HTTP ${tokenRes.status}): ${await tokenRes.text()}`,
    );
    process.exit(1);
  }
  const token = ((await tokenRes.json()) as { access_token: string })
    .access_token;
  console.log("  ✓ got a token");

  // Step 2 — read the channel's recent messages, find file attachments.
  console.log(
    "[2/3] Reading channel messages (needs ChannelMessage.Read.All)…",
  );
  const msgsRes = await fetch(
    `${GRAPH}/teams/${teamId}/channels/${encodeURIComponent(channelId)}/messages?$top=20`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!msgsRes.ok) {
    console.error(
      `  ✗ read messages failed (HTTP ${msgsRes.status}): ${await msgsRes.text()}`,
    );
    console.error(
      "    → ChannelMessage.Read.All probably isn't consented yet.",
    );
    process.exit(1);
  }
  const msgs = (await msgsRes.json()) as {
    value?: Array<{
      id?: string;
      attachments?: Array<{
        contentType?: string;
        contentUrl?: string;
        name?: string;
      }>;
    }>;
  };
  const files = (msgs.value ?? [])
    .flatMap((m) => m.attachments ?? [])
    .filter((a) => a.contentType === "reference" && a.contentUrl);
  console.log(
    `  ✓ read ${msgs.value?.length ?? 0} messages; found ${files.length} file attachment(s)`,
  );
  if (files.length === 0) {
    console.error(
      "    → No file attachments in the last 20 messages. Upload a CSV to this channel and rerun.",
    );
    process.exit(1);
  }
  for (const f of files) console.log(`      • ${f.name}  ${f.contentUrl}`);

  // Step 3 — download each file from SharePoint via /shares.
  console.log("[3/3] Downloading from SharePoint (needs Files.Read.All)…");
  for (const f of files) {
    const dlRes = await fetch(
      `${GRAPH}/shares/${shareIdFor(f.contentUrl!)}/driveItem/content`,
      { headers: { Authorization: `Bearer ${token}` }, redirect: "follow" },
    );
    if (!dlRes.ok) {
      console.error(
        `  ✗ download "${f.name}" failed (HTTP ${dlRes.status}): ${await dlRes.text()}`,
      );
      console.error("    → Files.Read.All probably isn't consented yet.");
      process.exit(1);
    }
    const bytes = Buffer.from(await dlRes.arrayBuffer());
    const preview = bytes.toString("utf8").slice(0, 120).replace(/\n/g, "\\n");
    console.log(
      `  ✓ "${f.name}" — ${bytes.byteLength} bytes; starts: "${preview}"`,
    );
  }

  console.log(
    "\n✅ Verified: app-only token → read channel message → download file all work.\n" +
      "   This is exactly what the bot does; granting the same two permissions in\n" +
      "   your real tenant makes the channel CSV→chart flow work there too.",
  );
}

main().catch((err) => {
  console.error("Unexpected failure:", err);
  process.exit(1);
});
