import { randomUUID } from "node:crypto";
import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core/mastra";
import { InMemoryStore } from "@mastra/core/storage";
import { RequestContext } from "@mastra/core/request-context";
import { createTool } from "@mastra/core/tools";
import { z } from "zod/v4";
import { describe, expect, it, vi } from "vitest";
import type {
  SkillRegistry,
  VerifiedSnapshot,
} from "@copilotkit/intelligence-delivery-core";
import { createSkillRegistryProcessor } from "../index.js";

function snapshot(revision: string): VerifiedSnapshot {
  return Object.freeze({
    revision,
    etag: revision,
    skills: [
      {
        name: "refund",
        description: `Refund guidance ${revision}`,
        files: [
          {
            path: "SKILL.md",
            text: `Skill body ${revision}`,
            size: 12,
            sha256: "fixture",
          },
          {
            path: "reference.txt",
            text: `Reference ${revision}`,
            size: 11,
            sha256: "fixture",
          },
        ],
      },
    ],
  });
}

function setup(
  options: {
    toolName?: string;
    toolInput?: string;
    hostTools?: Record<string, ReturnType<typeof createTool>>;
    onModelStep?: () => void;
  } = {},
) {
  let revision = "A";
  const acquire = vi.fn(async () => snapshot(revision));
  const skills = createSkillRegistryProcessor({
    registry: { acquireSnapshot: acquire } as unknown as SkillRegistry,
  });
  expect(skills).toBeDefined();
  const prompts: string[] = [];
  const model = {
    specificationVersion: "v2" as const,
    provider: "test",
    modelId: "skills",
    supportedUrls: {},
    async doGenerate({ prompt }: { prompt: Array<{ role: string }> }) {
      options.onModelStep?.();
      prompts.push(JSON.stringify(prompt));
      const done = prompt.some((message) => message.role === "tool");
      return {
        content: done
          ? [{ type: "text", text: "done" }]
          : [
              {
                type: "tool-call",
                toolCallId: "load",
                toolName: options.toolName ?? "copilotkit_load_skill",
                input: options.toolInput ?? '{"skill_name":"refund"}',
              },
            ],
        finishReason: done ? "stop" : "tool-calls",
        usage: { inputTokens: 1, outputTokens: 1 },
        warnings: [],
      };
    },
    async doStream({ prompt }: { prompt: Array<{ role: string }> }) {
      options.onModelStep?.();
      prompts.push(JSON.stringify(prompt));
      const done = prompt.some((message) => message.role === "tool");
      const chunks = [
        { type: "stream-start", warnings: [] },
        ...(done
          ? [
              { type: "text-start", id: "text" },
              { type: "text-delta", id: "text", delta: "done" },
              { type: "text-end", id: "text" },
            ]
          : [
              {
                type: "tool-call",
                toolCallId: "load",
                toolName: options.toolName ?? "copilotkit_load_skill",
                input: options.toolInput ?? '{"skill_name":"refund"}',
              },
            ]),
        {
          type: "finish",
          finishReason: done ? "stop" : "tool-calls",
          usage: { inputTokens: 1, outputTokens: 1 },
        },
      ];
      return {
        stream: new ReadableStream({
          start(controller) {
            for (const chunk of chunks) controller.enqueue(chunk);
            controller.close();
          },
        }),
      };
    },
  };
  const native = new Agent({
    id: randomUUID(),
    name: "support",
    instructions: "Host instructions.",
    model: model as any,
    inputProcessors: [skills],
    tools: { ...options.hostTools, ...skills.tools },
  });
  const storage = new InMemoryStore();
  const mastra = new Mastra({
    agents: { support: native },
    storage,
    logger: false,
  });
  return {
    mastra,
    skills,
    native,
    storage,
    prompts,
    acquire,
    setRevision: (value: string) => {
      revision = value;
    },
  };
}

it("adds a catalog and native read tools without changing host instructions", async () => {
  const test = setup();
  expect(test.skills).toBeDefined();
  const agent = test.skills.wrapAgent(test.native);
  const result = await agent.generate("Help with a refund.");
  expect(result.text).toBe("done");
  expect(test.acquire).toHaveBeenCalledTimes(1);
  expect(test.prompts[0]).toContain("Host instructions.");
  expect(test.prompts[0]).toContain("Refund guidance A");
  expect(test.prompts[0]).not.toContain("Skill body A");
  expect(test.prompts.at(-1)).toContain("Skill body A");
});

describe.each(["generate", "stream"] as const)("%s", (method) => {
  it("refreshes across calls that reuse caller context", async () => {
    const test = setup();
    expect(test.skills).toBeDefined();
    const agent = test.skills.wrapAgent(test.native);
    const requestContext = new RequestContext();
    const first = await agent[method]("First", { requestContext });
    if (method === "stream") await first.consumeStream();
    test.setRevision("B");
    const second = await agent[method]("Second", { requestContext });
    if (method === "stream") await second.consumeStream();
    expect(test.acquire).toHaveBeenCalledTimes(2);
    expect(test.prompts.at(-1)).toContain("Skill body B");
    expect(JSON.stringify(requestContext)).not.toContain("Skill body");
  });
});

describe.each(["resumeGenerate", "resumeStream"] as const)("%s", (method) => {
  it("acquires a fresh snapshot before a resumed tool and retains it for the model", async () => {
    const test = setup();
    expect(test.skills).toBeDefined();
    const agent = test.skills.wrapAgent(test.native);
    const requestContext = new RequestContext();
    const runId = randomUUID();
    const suspended = await agent.generate("Help", {
      runId,
      requestContext,
      requireToolApproval: true,
    });
    expect(suspended.finishReason).toBe("suspended");
    test.setRevision("B");
    const result = await agent[method](
      { approved: true },
      { runId, toolCallId: "load", requestContext },
    );
    if (method === "resumeStream") await result.consumeStream();
    expect(test.acquire).toHaveBeenCalledTimes(2);
    expect(test.prompts.at(-1)).toContain("Skill body B");
    expect(test.prompts.at(-1)).toContain("Refund guidance B");
    expect(test.prompts.at(-1)).not.toContain("Skill body A");
  });
});

it("preserves preflight denial identity before native execution", async () => {
  const test = setup();
  expect(test.skills).toBeDefined();
  const agent = test.skills.wrapAgent(test.native);
  const denied = new Error("DELIVERY_DISABLED");
  test.acquire.mockRejectedValueOnce(denied);
  await expect(agent.generate("Help")).rejects.toBe(denied);
  expect(test.prompts).toHaveLength(0);
});

it("honors cancellation before snapshot acquisition", async () => {
  const test = setup();
  expect(test.skills).toBeDefined();
  const agent = test.skills.wrapAgent(test.native);
  const controller = new AbortController();
  const reason = new Error("cancelled");
  controller.abort(reason);
  await expect(
    agent.generate("Help", { abortSignal: controller.signal }),
  ).rejects.toBe(reason);
  expect(test.acquire).not.toHaveBeenCalled();
  expect(test.prompts).toHaveLength(0);
});

it("isolates overlapping invocations sharing the same caller context", async () => {
  const test = setup();
  let revision = 0;
  test.acquire.mockImplementation(async () => snapshot(String(++revision)));
  const agent = test.skills.wrapAgent(test.native);
  const requestContext = new RequestContext();
  await Promise.all(
    Array.from({ length: 12 }, () =>
      agent.generate("Help", { requestContext }),
    ),
  );
  expect(test.acquire).toHaveBeenCalledTimes(12);
  const toolPrompts = test.prompts.filter((prompt) =>
    prompt.includes("Skill body"),
  );
  expect(toolPrompts).toHaveLength(12);
  for (const prompt of toolPrompts) {
    expect(prompt.match(/Skill body (\d+)/)?.[1]).toBe(
      prompt.match(/Refund guidance (\d+)/)?.[1],
    );
  }
});

it("cancels the delivery wait without cancelling a shared registry refresh", async () => {
  const test = setup();
  let resolve!: (value: VerifiedSnapshot) => void;
  test.acquire.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const agent = test.skills.wrapAgent(test.native);
  const controller = new AbortController();
  const pending = agent.generate("Help", { abortSignal: controller.signal });
  const reason = new Error("cancelled during preflight");
  controller.abort(reason);
  await expect(pending).rejects.toBe(reason);
  resolve(snapshot("A"));
  await Promise.resolve();
  expect(test.prompts).toHaveLength(0);
});

it("keeps wrapper identity stable and binds native private-field methods", () => {
  const test = setup();
  const agent = test.skills.wrapAgent(test.native);
  expect(test.skills.wrapAgent(test.native)).toBe(agent);
  expect(test.skills.wrapAgent(agent)).toBe(agent);
  expect(agent.generate).toBe(agent.generate);
  expect(agent.getInstructions()).toBe("Host instructions.");
});

it.each(["approveToolCall", "approveToolCallGenerate"] as const)(
  "%s preflights once and refreshes resumed reads",
  async (method) => {
    const test = setup();
    const agent = test.skills.wrapAgent(test.native);
    const runId = randomUUID();
    await agent.generate("Help", { runId, requireToolApproval: true });
    test.setRevision("B");
    const result = await agent[method]({ runId, toolCallId: "load" });
    if (method === "approveToolCall") await result.consumeStream();
    expect(test.acquire).toHaveBeenCalledTimes(2);
    expect(test.prompts.at(-1)).toContain("Skill body B");
  },
);

it("blocks a resumed invocation on confirmed denial", async () => {
  const test = setup();
  const agent = test.skills.wrapAgent(test.native);
  const runId = randomUUID();
  await agent.generate("Help", { runId, requireToolApproval: true });
  const count = test.prompts.length;
  const denied = new Error("REVISION_REVOKED");
  test.acquire.mockRejectedValueOnce(denied);
  await expect(
    agent.resumeGenerate({ approved: true }, { runId, toolCallId: "load" }),
  ).rejects.toBe(denied);
  expect(test.prompts).toHaveLength(count);
});

it("retains the wrapper when registered and retrieved through Mastra", async () => {
  const test = setup();
  const agent = test.skills.wrapAgent(test.native);
  const mastra = new Mastra({
    agents: { support: agent },
    storage: new InMemoryStore(),
    logger: false,
  });
  const result = await mastra.getAgent("support").generate("Help");
  expect(result.text).toBe("done");
  expect(test.acquire).toHaveBeenCalledTimes(1);
  expect(test.prompts.at(-1)).toContain("Skill body A");
});

it("registers both native tools and an empty catalog for an empty container", async () => {
  const test = setup();
  test.acquire.mockResolvedValue({
    revision: "empty",
    etag: "empty",
    skills: [],
  });
  expect(Object.keys(test.skills.tools)).toEqual([
    "copilotkit_load_skill",
    "copilotkit_read_skill_file",
  ]);
  const agent = test.skills.wrapAgent(test.native);
  await agent.generate("Help");
  expect(test.prompts[0]).toContain("No learned skills are available.");
  expect(test.prompts[0]).toContain("Host instructions.");
});

describe.each(["resumeGenerate", "resumeStream"] as const)(
  "%s host tools",
  (method) => {
    it("blocks a suspended side effect on denial and permits the same resume after recovery", async () => {
      const execute = vi.fn(async () => "Refund submitted.");
      const test = setup({
        toolName: "submit_refund",
        toolInput: "{}",
        hostTools: {
          submit_refund: createTool({
            id: "submit_refund",
            description: "Submit the customer's refund.",
            inputSchema: z.object({}),
            execute,
          }),
        },
      });
      const agent = test.skills.wrapAgent(test.native);
      const runId = randomUUID();
      const suspended = await agent.generate("Submit a refund", {
        runId,
        requireToolApproval: true,
      });
      expect(suspended.finishReason).toBe("suspended");
      expect(execute).not.toHaveBeenCalled();
      const promptCount = test.prompts.length;
      const denied = new Error("DELIVERY_DISABLED");
      test.acquire.mockRejectedValueOnce(denied);
      await expect(
        agent[method]({ approved: true }, { runId, toolCallId: "load" }),
      ).rejects.toBe(denied);
      expect(execute).not.toHaveBeenCalled();
      expect(test.prompts).toHaveLength(promptCount);

      test.setRevision("B");
      const recovered = await agent[method](
        { approved: true },
        { runId, toolCallId: "load" },
      );
      if (method === "resumeStream") await recovered.consumeStream();
      expect(execute).toHaveBeenCalledTimes(1);
      expect(test.prompts.at(-1)).toContain("Refund submitted.");
      expect(test.prompts.at(-1)).toContain("Refund guidance B");
      expect(test.acquire).toHaveBeenCalledTimes(3);
    });
  },
);

describe.each(["generate", "stream"] as const)(
  "%s supporting files",
  (method) => {
    it("keeps the file and catalog pinned while a newer registry revision becomes available", async () => {
      let nextRevision = "B";
      const test = setup({
        toolName: "copilotkit_read_skill_file",
        toolInput: '{"skill_name":"refund","path":"reference.txt"}',
        // Native model execution happens after the invocation acquired its pin.
        onModelStep: () => test.setRevision(nextRevision),
      });
      const agent = test.skills.wrapAgent(test.native);
      const first = await agent[method]("Read refund reference");
      if (method === "stream") await first.consumeStream();
      expect(test.acquire).toHaveBeenCalledTimes(1);
      expect(test.prompts.at(-1)).toContain("Reference A");
      expect(test.prompts.at(-1)).toContain("Refund guidance A");
      expect(test.prompts.at(-1)).not.toContain("Reference B");

      nextRevision = "C";
      const second = await agent[method]("Read the current refund reference");
      if (method === "stream") await second.consumeStream();
      expect(test.acquire).toHaveBeenCalledTimes(2);
      expect(test.prompts.at(-1)).toContain("Reference B");
      expect(test.prompts.at(-1)).toContain("Refund guidance B");
      expect(test.prompts.at(-1)).not.toContain("Reference C");
    });
  },
);

it.each(["declineToolCall", "declineToolCallGenerate"] as const)(
  "%s acquires a fresh catalog without running the declined tool",
  async (method) => {
    const test = setup();
    const agent = test.skills.wrapAgent(test.native);
    const runId = randomUUID();
    const requestContext = new RequestContext();
    requestContext.set("customer", "test-customer");
    const suspended = await agent.generate("Help", {
      runId,
      requestContext,
      requireToolApproval: true,
    });
    expect(suspended.finishReason).toBe("suspended");
    test.setRevision("B");
    const result = await agent[method]({
      runId,
      toolCallId: "load",
      requestContext,
    });
    if (method === "declineToolCall") await result.consumeStream();
    expect(test.acquire).toHaveBeenCalledTimes(2);
    expect(test.prompts.at(-1)).toContain("Refund guidance B");
    expect(test.prompts.at(-1)).not.toContain("Skill body");
    // Inspect the native public entries API, rather than serializing a Map's
    // empty object representation and accidentally accepting hidden state.
    const callerEntries = [...requestContext.entries()];
    expect(callerEntries).toContainEqual(["customer", "test-customer"]);
    expect(JSON.stringify(callerEntries)).not.toMatch(
      /Refund guidance|Skill body|Reference [AB]/,
    );
    const acquiredSnapshot = await test.acquire.mock.results[0]?.value;
    expect(callerEntries.some(([, value]) => value === acquiredSnapshot)).toBe(
      false,
    );
  },
);
