import { HttpAgent } from "@ag-ui/client";
import { OmnaraAgent } from "@ag-ui/omnara";
import { omnaraConfig } from "../lib/omnara-config";

/**
 * Builds this starter's agent.
 *
 * Extracted from the runtime route so both mounts share one definition: the
 * route serves the web app over HTTP, and `channel-host.mts` serves a Channel.
 * A fresh instance per call — the channel host sets `threadId` per
 * conversation, so a shared instance would leak state across threads.
 */
export function createDefaultAgent(): HttpAgent | OmnaraAgent {
  // Explicit mock/alternate AG-UI endpoint, used by `npm run dev:mock`.
  if (process.env.AGENT_URL)
    return new HttpAgent({ url: process.env.AGENT_URL });
  // Each chat thread launches its own Omnara agent from the profile.
  return new OmnaraAgent({
    ...omnaraConfig(process.env),
    // This localhost starter has one developer identity. Build the agent per
    // request with the verified user before exposing it to multiple users.
    user: "anonymous",
  });
}
