import { createTRPCClient as trpcClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";

export const COPILOT_CLOUD_BASE_URL =
  process.env.COPILOT_CLOUD_BASE_URL || "https://cloud.copilotkit.ai";

export function createTRPCClient(cliToken: string): any {
  return trpcClient({
    links: [
      httpBatchLink({
        url: `${COPILOT_CLOUD_BASE_URL}/api/trpc-cli`,
        transformer: superjson,
        headers: () => {
          return {
            "x-trpc-source": "cli",
            "x-cli-token": cliToken,
          };
        },
      }),
    ],
  });
}
