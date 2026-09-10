import { expect, test, vi } from "vitest";
import type { RunAgentInput } from "@ag-ui/client";
import { MockSocket } from "./test-utils";

vi.mock("phoenix", () => ({ Socket: MockSocket }));

const { ProxiedCopilotRuntimeAgent } = await import("../agent");

test.each(["run", "connect"] as const)(
  "Intelligence %s uses the configured single-route mount",
  async (mode) => {
    const runtimeUrl = "https://app.example.com/api/copilotkit";
    const input: RunAgentInput = {
      threadId: "thread-1",
      runId: "run-1",
      messages: [{ id: "message-1", role: "user", content: "Hello" }],
      state: {},
      tools: [],
      context: [],
      forwardedProps: { source: "chat" },
    };
    const requestFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          threadId: input.threadId,
          runId: input.runId,
          joinToken: "join-token",
          realtime: {
            clientUrl: "wss://gateway.example.com/client",
            topic: "thread:thread-1",
          },
        }),
        { headers: { "content-type": "application/json" } },
      ),
    );
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl,
      agentId: "local-alias",
      runtimeAgentId: "graph",
      transport: "single",
      runtimeMode: "intelligence",
      intelligence: { wsUrl: "wss://gateway.example.com/client" },
      headers: { Authorization: "Bearer browser-session" },
      credentials: "include",
      fetch: requestFetch,
    });
    const errors: unknown[] = [];
    const subscription = agent[mode](input).subscribe({
      error: (error) => errors.push(error),
    });

    try {
      await vi.waitFor(() => expect(requestFetch).toHaveBeenCalledTimes(1));
      const [url, init] = requestFetch.mock.calls[0]!;
      expect(url).toBe(runtimeUrl);
      expect(init?.method).toBe("POST");
      expect(init?.credentials).toBe("include");
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer browser-session",
      );
      expect(JSON.parse(String(init?.body))).toEqual({
        method: `agent/${mode}`,
        params: { agentId: "graph" },
        body: {
          ...input,
          ...(mode === "connect" ? { lastSeenEventId: null } : {}),
        },
      });
      expect(errors).toEqual([]);
    } finally {
      subscription.unsubscribe();
    }
  },
);
