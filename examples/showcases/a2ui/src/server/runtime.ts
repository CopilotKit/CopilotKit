import { HttpAgent } from "@ag-ui/client";
import { auth, clerkClient } from "@clerk/tanstack-react-start/server";
import {
  CopilotKitIntelligence,
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { AGENT_ID } from "../lib/agent";

const apiKey = process.env.CPK_INTELLIGENCE_API_KEY;
if (!apiKey) {
  throw new Error(
    "CPK_INTELLIGENCE_API_KEY is not set. Copy .env.example to .env and add your Intelligence key.",
  );
}

/** The signed-in reader's Clerk id. Clerk's middleware read the session. */
export async function readerId() {
  const { isAuthenticated, userId } = await auth();
  return isAuthenticated ? userId : null;
}

// Names change rarely; one lookup per reader per ten minutes is plenty.
const NAME_TTL_MS = 10 * 60 * 1000;
const names = new Map<string, { name: string; at: number }>();

async function readerName(userId: string) {
  const cached = names.get(userId);
  if (cached && Date.now() - cached.at < NAME_TTL_MS) return cached.name;
  const user = await clerkClient().users.getUser(userId);
  const name =
    user.fullName ??
    user.username ??
    user.primaryEmailAddress?.emailAddress ??
    "Reader";
  names.set(userId, { name, at: Date.now() });
  return name;
}

const agentUrl = process.env.AGENT_URL ?? "http://localhost:8014/";
const agentSecret = process.env.AGENT_SHARED_SECRET;

/** The ADK agent, naming the reader (if any) in a header it trusts. */
function deskAgent(userId: string | null) {
  return new HttpAgent({
    url: agentUrl,
    headers: {
      ...(userId ? { "x-desk-user": userId } : {}),
      ...(agentSecret ? { "x-desk-agent-secret": agentSecret } : {}),
    },
  });
}

/**
 * For signed-in readers: Intelligence keeps the threads. `identifyUser`
 * gives Intelligence the Clerk user, so each reader sees only their own
 * threads. The agent is built per request with the reader's id, the key
 * under which their connected apps are found.
 *
 * Generative UI needs no option here. With the markdown transport the browser
 * sends the generative UI guide as context on each run, and the agent writes
 * A2UI into its reply as text; the runtime passes both through.
 */
const readerRuntime = new CopilotRuntime({
  agents: async () => ({ [AGENT_ID]: deskAgent(await readerId()) }),
  intelligence: new CopilotKitIntelligence({ apiKey }),
  identifyUser: async () => {
    const userId = await readerId();
    if (!userId) throw new Error("Not signed in");
    return { id: userId, name: await readerName(userId) };
  },
});

/**
 * Signed out, the default: the same agent, nothing kept. Conversations live
 * in the server's memory for the visit, and the agent has no reader, so no
 * connected apps.
 */
const signedOutRuntime = new CopilotRuntime({
  agents: { [AGENT_ID]: deskAgent(null) },
});

export const readerHandler = createCopilotRuntimeHandler({
  runtime: readerRuntime,
  basePath: "/api/copilotkit",
});
export const signedOutHandler = createCopilotRuntimeHandler({
  runtime: signedOutRuntime,
  basePath: "/api/copilotkit",
});
