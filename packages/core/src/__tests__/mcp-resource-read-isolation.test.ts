import { createServer } from "node:http";
import { once } from "node:events";
import type { RunAgentInput } from "@ag-ui/client";
import { RunAgentInputSchema } from "@ag-ui/core/schemas";
import { createToolCallMessage, createToolResultMessage } from "./test-utils";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { ProxiedCopilotRuntimeAgent } from "../agent";

describe("proxied MCP resource read isolation", () => {
  it("runs a resource read on a clone and rejects other MCP methods", async () => {
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://runtime.example",
      agentId: "agent",
      runtimeMode: "intelligence",
      intelligence: { wsUrl: "wss://intelligence.example/client" },
    });
    agent.threadId = "thread-1";
    const clone = agent.clone();
    const cloneRun = vi.spyOn(clone, "runAgent").mockResolvedValue({
      result: { contents: [{ uri: "ui://app", text: "html" }] },
      newMessages: [],
    });
    vi.spyOn(agent, "clone").mockReturnValue(clone);
    const originalRun = vi.spyOn(agent, "runAgent");

    const result = await agent.ɵrunMcpResourceRead({
      forwardedProps: {
        __proxiedMCPRequest: {
          method: "resources/read",
          params: { uri: "ui://app" },
        },
      },
    });
    expect(result.result).toEqual({
      contents: [{ uri: "ui://app", text: "html" }],
    });
    expect(clone.threadId).toBe("thread-1");
    expect(cloneRun).toHaveBeenCalledOnce();
    expect(cloneRun).toHaveBeenCalledWith(
      expect.objectContaining({
        forwardedProps: expect.objectContaining({
          __copilotkitMcpResourceReadOnly: true,
        }),
      }),
    );
    expect(originalRun).not.toHaveBeenCalled();

    await expect(
      agent.ɵrunMcpResourceRead({
        forwardedProps: { __proxiedMCPRequest: { method: "tools/call" } },
      }),
    ).rejects.toThrow("Only MCP resources/read");
    expect(cloneRun).toHaveBeenCalledOnce();
  });
});

describe("MCP resource reads through the real AG-UI interrupt guard", () => {
  it.each(["rest", "single"] as const)(
    "preserves mixed history and approvals across repeated %s reads and replay",
    async (transport) => {
      const requests: RunAgentInput[] = [];
      const server = createServer(async (request, response) => {
        let raw = "";
        for await (const chunk of request) raw += chunk.toString();
        const body = JSON.parse(raw);
        const input = RunAgentInputSchema.parse(
          transport === "single" ? body.body : body,
        );
        requests.push(input);
        response.setHeader("Content-Type", "application/json");
        response.end(
          JSON.stringify({
            kind: "mcp-resource-read",
            threadId: input.threadId,
            runId: input.runId,
            result: {
              contents: [{ uri: "ui://app", text: "<h1>Saved app</h1>" }],
            },
          }),
        );
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      onTestFinished(
        () =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
      );
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Missing localhost port");
      const createAgent = () =>
        new ProxiedCopilotRuntimeAgent({
          runtimeUrl: `http://127.0.0.1:${address.port}/runtime`,
          agentId: "agent",
          transport,
          runtimeMode: "intelligence",
          intelligence: { wsUrl: "ws://localhost/client" },
        });
      let agent = createAgent();
      agent.threadId = "thread-1";
      agent.setMessages([
        createToolCallMessage(
          "saved_app",
          {},
          {
            id: "completed-call",
            toolCalls: [
              {
                id: "completed",
                type: "function",
                function: { name: "saved_app", arguments: "{}" },
              },
            ],
          },
        ),
        createToolResultMessage("completed", "saved resource", {
          id: "completed-result",
        }),
        createToolCallMessage(
          "Read",
          {},
          {
            id: "pending-calls",
            toolCalls: ["pending-one", "pending-two"].map((id) => ({
              id,
              type: "function",
              function: { name: "Read", arguments: "{}" },
            })),
          },
        ),
      ]);
      agent.setState({ counter: 7 });
      const resourceParameters = {
        forwardedProps: {
          __proxiedMCPRequest: {
            method: "resources/read",
            params: { uri: "ui://app" },
          },
        },
      };

      // Before approval, two simultaneous pending approvals, one answered sibling,
      // and after approval. Rehydrate a fresh client to model saved replay.
      for (const pendingIds of [
        [],
        ["pending-one", "pending-two"],
        ["pending-two"],
        [],
      ]) {
        agent.pendingInterrupts = pendingIds.map((id) => ({
          id,
          reason: "approval",
        }));
        const snapshot = structuredClone({
          messages: agent.messages,
          state: agent.state,
          interrupts: agent.pendingInterrupts,
        });
        const subscriber = {
          onRunStartedEvent: vi.fn(),
          onMessagesChanged: vi.fn(),
          onStateChanged: vi.fn(),
        };
        agent.subscribe(subscriber);
        for (let repeat = 0; repeat < 2; repeat++) {
          await expect(
            agent.ɵrunMcpResourceRead(resourceParameters),
          ).resolves.toMatchObject({
            result: {
              contents: [{ uri: "ui://app", text: "<h1>Saved app</h1>" }],
            },
          });
          expect({
            messages: agent.messages,
            state: agent.state,
            interrupts: agent.pendingInterrupts,
          }).toEqual(snapshot);
          expect(agent.isRunning).toBe(false);
        }
        expect(subscriber.onRunStartedEvent).not.toHaveBeenCalled();
        expect(subscriber.onMessagesChanged).not.toHaveBeenCalled();
        expect(subscriber.onStateChanged).not.toHaveBeenCalled();
        if (pendingIds.length) {
          const requestCount = requests.length;
          await expect(agent.runAgent()).rejects.toThrow(
            "pending interrupt(s) not addressed by resume",
          );
          await expect(agent.clone().runAgent()).rejects.toThrow(
            "pending interrupt(s) not addressed by resume",
          );
          expect(requests).toHaveLength(requestCount);
        }
        agent = createAgent();
        agent.threadId = "thread-1";
        agent.setMessages(snapshot.messages);
        agent.setState(snapshot.state);
        agent.pendingInterrupts = snapshot.interrupts;
      }
      expect(requests).toHaveLength(8);
      for (const input of requests) {
        expect(input.forwardedProps).toMatchObject({
          __copilotkitMcpResourceReadOnly: true,
          __proxiedMCPRequest: { method: "resources/read" },
        });
        expect(input.resume).toBeUndefined();
        expect(input.threadId).toBe("thread-1");
      }
    },
  );
});
