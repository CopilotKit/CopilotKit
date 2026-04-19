import { z } from "zod";

/**
 * Host-side functions that agent-authored, sandboxed UIs can invoke from
 * inside the iframe via `Websandbox.connection.remote.<name>(args)`.
 *
 * These are the only bridge between the sandbox and the host page — keep
 * the surface intentionally small.
 */
export const openGenUiSandboxFunctions = [
  {
    name: "notifyHost",
    description:
      "Send a short string message from the sandboxed UI back to the host page.",
    parameters: z.object({ message: z.string() }),
    handler: async ({ message }: { message: string }) => {
      // eslint-disable-next-line no-console
      console.log("[open-gen-ui] sandbox -> host:", message);
      return { ok: true };
    },
  },
];
