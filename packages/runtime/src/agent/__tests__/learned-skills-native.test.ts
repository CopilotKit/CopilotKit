import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { streamText, stepCountIs } from "ai";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { z } from "zod";
import { EventType } from "@ag-ui/client";
import { BuiltInAgent, convertMessagesToVercelAISDKMessages } from "../index";
import { collectEvents, createDefaultInput } from "./agent-test-helpers";
import fixtures from "../../../../intelligence-delivery-core/conformance/snapshots.v1.json";

type StreamPart =
  Awaited<
    ReturnType<MockLanguageModelV3["doStream"]>
  >["stream"] extends ReadableStream<infer Part>
    ? Part
    : never;

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function deliveryServer() {
  let fixture = fixtures.cases.find((item) => item.name === "text-skill")!;
  const requests: Array<{
    url: string;
    etag?: string;
    authorization?: string;
  }> = [];
  const server = createServer((req, res) => {
    requests.push({
      url: req.url!,
      etag: req.headers["if-none-match"],
      authorization: req.headers.authorization,
    });
    res.writeHead(200, {
      "content-type": "application/zip",
      "x-copilotkit-skills-revision": fixture.revision,
      etag: fixture.etag,
    });
    res.end(Buffer.from(fixture.archiveBase64, "base64"));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  );
  return {
    requests,
    empty: () => {
      fixture = fixtures.cases.find((item) => item.name === "empty-r2")!;
    },
    options: {
      apiKey: "test-delivery-key",
      apiUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      containerId: "learning",
      freshnessWindowMs: 0,
    },
  };
}

describe("native AI SDK skill delivery over canonical HTTP transport", () => {
  it.each([false, true])(
    "pauses on an interrupt with prior skill loading: %s",
    async (loadFirst) => {
      const server = await deliveryServer();
      let calls = 0;
      const model = new MockLanguageModelV3({
        doStream: async () => {
          const load = loadFirst && calls++ === 0;
          return {
            stream: simulateReadableStream<StreamPart>({
              chunks: [
                {
                  type: "tool-call",
                  toolCallId: load ? "load" : "approval",
                  toolName: load ? "copilotkit_load_skill" : "approve",
                  input: JSON.stringify(
                    load ? { skill_name: "refund-policy" } : {},
                  ),
                },
                {
                  type: "finish",
                  finishReason: { unified: "tool-calls", raw: "tool_calls" },
                  usage,
                },
              ],
            }),
          };
        },
      });
      const agent = new BuiltInAgent({
        model,
        learnedSkills: server.options,
        tools: [
          {
            name: "approve",
            description: "Ask for approval",
            parameters: z.object({}),
            interrupt: true,
          },
        ],
      });
      const events = await collectEvents(
        agent.run(
          createDefaultInput({
            messages: [{ id: "user", role: "user", content: "Get approval." }],
          }),
        ),
      );
      expect(model.doStreamCalls).toHaveLength(loadFirst ? 2 : 1);
      expect(
        events.find((event) => event.type === EventType.RUN_FINISHED),
      ).toMatchObject({
        outcome: { type: "interrupt", interrupts: [{ id: "approval" }] },
      });
      expect(events.some((event) => event.type === EventType.RUN_ERROR)).toBe(
        false,
      );
    },
  );

  it.each(["classic", "factory"] as const)(
    "%s executes both skill tools and refreshes on resume",
    async (mode) => {
      const server = await deliveryServer();
      let calls = 0;
      const model = new MockLanguageModelV3({
        doStream: async () => ({
          stream: simulateReadableStream<StreamPart>({
            chunks:
              calls++ === 0
                ? [
                    {
                      type: "tool-call",
                      toolCallId: "load",
                      toolName: "copilotkit_load_skill",
                      input: JSON.stringify({ skill_name: "refund-policy" }),
                    },
                    {
                      type: "tool-call",
                      toolCallId: "read",
                      toolName: "copilotkit_read_skill_file",
                      input: JSON.stringify({
                        skill_name: "refund-policy",
                        path: "reference.txt",
                      }),
                    },
                    {
                      type: "finish",
                      finishReason: {
                        unified: "tool-calls",
                        raw: "tool_calls",
                      },
                      usage,
                    },
                  ]
                : [
                    { type: "text-start", id: "answer" },
                    {
                      type: "text-delta",
                      id: "answer",
                      delta: "Answer based on guidance.",
                    },
                    { type: "text-end", id: "answer" },
                    {
                      type: "finish",
                      finishReason: { unified: "stop", raw: "stop" },
                      usage,
                    },
                  ],
          }),
        }),
      });
      const agent =
        mode === "classic"
          ? new BuiltInAgent({
              model,
              prompt: "Host instructions",
              learnedSkills: server.options,
            })
          : new BuiltInAgent({
              type: "aisdk",
              learnedSkills: server.options,
              factory: ({ input, abortSignal, learnedSkills }) =>
                streamText({
                  model,
                  system: ["Host instructions", learnedSkills.catalog]
                    .filter(Boolean)
                    .join("\n\n"),
                  messages: convertMessagesToVercelAISDKMessages(
                    input.messages,
                  ),
                  tools: learnedSkills.tools,
                  stopWhen: stepCountIs(4),
                  abortSignal,
                }),
            });
      const input = createDefaultInput({
        messages: [
          { id: "user", role: "user", content: "Explain the refund policy." },
        ],
      });
      const events = await collectEvents(agent.run(input));
      const results = events.filter(
        (event) => event.type === EventType.TOOL_CALL_RESULT,
      );
      expect(results).toHaveLength(2);
      expect(JSON.stringify(results)).toContain(
        "Use the published refund policy",
      );
      expect(JSON.stringify(results)).toContain("30 days");
      expect(model.doStreamCalls).toHaveLength(2);
      const firstPrompt = JSON.stringify(model.doStreamCalls[0].prompt);
      expect(firstPrompt).toContain("Host instructions");
      expect(firstPrompt).toContain("refund-policy");
      expect(firstPrompt).not.toContain("30 days");
      expect(JSON.stringify(model.doStreamCalls[1].prompt)).toContain(
        "30 days",
      );
      expect(server.requests).toHaveLength(1);
      expect(server.requests[0].url).toContain("learning");
      expect(server.requests[0].authorization).toContain("test-delivery-key");
      server.empty();
      await collectEvents(
        agent.run(
          createDefaultInput({
            runId: "resumed",
            messages: input.messages,
            resume: [
              { interruptId: "approval", status: "resolved", payload: true },
            ],
          }),
        ),
      );
      expect(server.requests).toHaveLength(2);
      expect(server.requests[1].etag).toBe(
        fixtures.cases.find((item) => item.name === "text-skill")!.etag,
      );
      expect(JSON.stringify(model.doStreamCalls[2].prompt)).not.toContain(
        "copilotkit_learned_skills",
      );
      expect(
        model.doStreamCalls[2].tools?.map((tool) => tool.name) ?? [],
      ).not.toContain("copilotkit_load_skill");
      expect(input.state).toEqual({});
    },
  );
});
