import { createFileRoute } from "@tanstack/react-router";
import {
  ConnectionsOff,
  listConnections,
  removeConnection,
  startConnection,
} from "../../server/connections";
import { readerId } from "../../server/runtime";

/** Runs a connections call for the signed-in reader, as JSON. */
async function forReader(work: (userId: string) => Promise<unknown>) {
  const userId = await readerId();
  if (!userId)
    return Response.json({ error: "Sign in first." }, { status: 401 });
  try {
    return Response.json(await work(userId));
  } catch (error) {
    const off = error instanceof ConnectionsOff;
    if (!off) console.error("[connections]", error);
    return Response.json(
      {
        error: off
          ? error.message
          : "Composio could not be reached. Try again.",
      },
      { status: off ? 503 : 502 },
    );
  }
}

export const Route = createFileRoute("/api/connections")({
  server: {
    handlers: {
      GET: () =>
        forReader(async (userId) => ({
          connections: await listConnections(userId),
        })),
      POST: async ({ request }) => {
        const { app } = (await request.json()) as { app?: string };
        // Google's sign-in comes back to the Connections page.
        const back = new URL("/", request.url);
        back.searchParams.set("connections", "");
        return forReader(async (userId) => ({
          redirectUrl: await startConnection(userId, String(app), back.href),
        }));
      },
      DELETE: ({ request }) => {
        const app = new URL(request.url).searchParams.get("app") ?? "";
        return forReader(async (userId) => {
          await removeConnection(userId, app);
          return { ok: true };
        });
      },
    },
  },
});
