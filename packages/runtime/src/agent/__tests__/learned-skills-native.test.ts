import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { streamText, stepCountIs } from "ai";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import type { FakeResponse } from "@tanstack/ai/testing";
import { z } from "zod";
import { EventType } from "@ag-ui/client";
import { convertMessagesToVercelAISDKMessages, toAISDKTools } from "../ai-sdk";
import {
  BuiltInAgent,
  collectEvents,
  createClassicAgent,
  createDefaultInput,
  eventsOfType,
  requestToolNames,
} from "./agent-test-helpers";
import type { ClassicTestConfig } from "./agent-test-helpers";
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

/** What one model call received, the same shape for both SDKs. */
interface ModelCall {
  /** The system prompts and messages, serialized. */
  prompt: string;
  toolNames: string[];
}

/**
 * A classic agent on the fake model. `calls()` lists what each model call
 * received.
 */
function classicSkillAgent(
  config: ClassicTestConfig,
  responses: FakeResponse[],
) {
  const { agent, requests } = createClassicAgent(config, responses);
  const calls = () =>
    requests.map(
      (request): ModelCall => ({
        prompt: JSON.stringify([request.systemPrompts, request.messages]),
        toolNames: requestToolNames(request),
      }),
    );
  return { agent, calls };
}

const loadAndReadSkill: FakeResponse = {
  toolCalls: [
    {
      id: "load",
      name: "copilotkit_load_skill",
      input: { skill_name: "refund-policy" },
    },
    {
      id: "read",
      name: "copilotkit_read_skill_file",
      input: { skill_name: "refund-policy", path: "reference.txt" },
    },
  ],
};
const answer: FakeResponse = { text: "Answer based on guidance." };

/**
 * An aisdk factory agent that runs the real `streamText` with the learned
 * skills through `toAISDKTools`. Its model loads and reads the skill on the
 * first call and answers on every later call.
 */
function aisdkSkillAgent(learnedSkills: ClassicTestConfig["learnedSkills"]) {
  let callCount = 0;
  const model = new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream<StreamPart>({
        chunks:
          callCount++ === 0
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
                  finishReason: { unified: "tool-calls", raw: "tool_calls" },
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
  const agent = new BuiltInAgent({
    type: "aisdk",
    learnedSkills,
    factory: ({ input, abortSignal, learnedSkills: skills }) =>
      streamText({
        model,
        system: ["Host instructions", skills.catalog]
          .filter(Boolean)
          .join("\n\n"),
        messages: convertMessagesToVercelAISDKMessages(input.messages),
        tools: toAISDKTools(skills.tools),
        stopWhen: stepCountIs(4),
        abortSignal,
      }),
  });
  const calls = () =>
    model.doStreamCalls.map(
      (call): ModelCall => ({
        prompt: JSON.stringify(call.prompt),
        toolNames: (call.tools ?? []).map((tool) => tool.name),
      }),
    );
  return { agent, calls };
}

describe("skill delivery over canonical HTTP transport", () => {
  it.each([false, true])(
    "classic pauses on an interrupt with prior skill loading: %s",
    async (loadFirst) => {
      const server = await deliveryServer();
      const approve: FakeResponse = {
        toolCalls: [{ id: "approval", name: "approve", input: {} }],
      };
      const loadSkill: FakeResponse = {
        toolCalls: [
          {
            id: "load",
            name: "copilotkit_load_skill",
            input: { skill_name: "refund-policy" },
          },
        ],
      };
      const { agent, calls } = classicSkillAgent(
        {
          learnedSkills: server.options,
          tools: [
            {
              name: "approve",
              description: "Ask for approval",
              parameters: z.object({}),
              interrupt: true,
            },
          ],
        },
        loadFirst ? [loadSkill, approve] : [approve],
      );
      const events = await collectEvents(
        agent.run(
          createDefaultInput({
            messages: [{ id: "user", role: "user", content: "Get approval." }],
          }),
        ),
      );
      expect(calls()).toHaveLength(loadFirst ? 2 : 1);
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

  it("sends the catalog when a classic run has no conversation messages", async () => {
    const server = await deliveryServer();
    const { agent, calls } = classicSkillAgent(
      { learnedSkills: server.options },
      [{}],
    );

    const events = await collectEvents(agent.run(createDefaultInput()));

    expect(events.some((event) => event.type === EventType.RUN_ERROR)).toBe(
      false,
    );
    const [call] = calls();
    expect(call.prompt).toContain("copilotkit_learned_skills");
    expect(call.prompt).toContain("refund-policy");
  });

  it.each(["classic", "factory", "classic-single-step"] as const)(
    "%s executes both skill tools and refreshes on resume",
    async (mode) => {
      const server = await deliveryServer();
      const { agent, calls } =
        mode === "factory"
          ? aisdkSkillAgent(server.options)
          : classicSkillAgent(
              {
                prompt: "Host instructions",
                learnedSkills: server.options,
                // Without maxSteps, a run with skills allows 10 model steps.
                ...(mode === "classic-single-step" ? { maxSteps: 1 } : {}),
              },
              [loadAndReadSkill, answer, answer],
            );
      const input = createDefaultInput({
        messages: [
          { id: "user", role: "user", content: "Explain the refund policy." },
        ],
      });
      const events = await collectEvents(agent.run(input));
      const results = eventsOfType(events, EventType.TOOL_CALL_RESULT);
      expect(results).toHaveLength(2);
      expect(JSON.stringify(results)).toContain(
        "Use the published refund policy",
      );
      expect(JSON.stringify(results)).toContain("30 days");
      const expectedCalls = mode === "classic-single-step" ? 1 : 2;
      expect(calls()).toHaveLength(expectedCalls);
      const [firstCall] = calls();
      expect(firstCall.prompt).toContain("Host instructions");
      expect(firstCall.prompt).toContain("refund-policy");
      expect(firstCall.prompt).not.toContain("30 days");
      if (expectedCalls === 2) {
        expect(calls()[1].prompt).toContain("30 days");
      }
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
      const resumedCall = calls()[expectedCalls];
      expect(resumedCall.prompt).not.toContain("copilotkit_learned_skills");
      expect(resumedCall.toolNames).not.toContain("copilotkit_load_skill");
      expect(input.state).toEqual({});
    },
  );
});
