import { Composio } from "@composio/core";
import { DESK_APPS } from "../lib/apps";
import type { Connection } from "../lib/connections";

/**
 * The reader's Google apps, through Composio. Composio runs Google's
 * sign-in with its own managed OAuth app and keeps the tokens; the agent
 * looks up the same reader (by Clerk id) when it loads tools.
 */
const APP_IDS = DESK_APPS.map((app) => app.id);

let client: Composio | null = null;
function composio() {
  if (!process.env.COMPOSIO_API_KEY) return null;
  client ??= new Composio();
  return client;
}

export class ConnectionsOff extends Error {
  constructor() {
    super(
      "Connections are off: add COMPOSIO_API_KEY to the example's .env and restart the app.",
    );
  }
}

function composioOrOff() {
  const instance = composio();
  if (!instance) throw new ConnectionsOff();
  return instance;
}

const STATUS: Record<string, Connection["status"]> = {
  ACTIVE: "connected",
  INITIALIZING: "pending",
  INITIATED: "pending",
};

/** A "connected as" label, when Composio has one for the account. */
function accountLabel(item: unknown) {
  const state = (item as { state?: { val?: Record<string, unknown> } }).state;
  const value = state?.val?.displayName ?? state?.val?.email;
  return typeof value === "string" && value ? value : undefined;
}

export async function listConnections(userId: string): Promise<Connection[]> {
  const { items } = await composioOrOff().connectedAccounts.list({
    userIds: [userId],
    toolkitSlugs: APP_IDS,
  });
  return APP_IDS.map((app) => {
    // The newest account per app decides its state.
    const account = items
      .filter((item) => item.toolkit.slug === app)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    const status = account ? (STATUS[account.status] ?? "none") : "none";
    return {
      app,
      status,
      ...(status === "connected" ? { account: accountLabel(account) } : {}),
    };
  });
}

/** Starts Google's sign-in for one app; returns where to send the reader. */
export async function startConnection(
  userId: string,
  app: string,
  callbackUrl: string,
) {
  if (!APP_IDS.includes(app)) throw new Error(`Unknown app: ${app}`);
  const session = await composioOrOff().create(userId, {
    toolkits: [app],
    manageConnections: false,
  });
  const request = await session.authorize(app, { callbackUrl });
  if (!request.redirectUrl)
    throw new Error("Composio returned no sign-in link.");
  return request.redirectUrl;
}

/** Removes the reader's accounts for one app. Only their own are touched. */
export async function removeConnection(userId: string, app: string) {
  if (!APP_IDS.includes(app)) throw new Error(`Unknown app: ${app}`);
  const instance = composioOrOff();
  const { items } = await instance.connectedAccounts.list({
    userIds: [userId],
    toolkitSlugs: [app],
  });
  await Promise.all(
    items.map((item) => instance.connectedAccounts.delete(item.id)),
  );
}
