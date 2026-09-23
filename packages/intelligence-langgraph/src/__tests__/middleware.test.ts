import { createHash } from "node:crypto";
import { zipSync, strToU8 } from "fflate";
import { afterEach, expect, it, vi } from "vitest";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";
import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { createAgent, tool } from "langchain";
import { Command, MemorySaver, interrupt } from "@langchain/langgraph";
import { z } from "zod/v4";
import { CopilotKitIntelligence } from "@copilotkit/runtime/v2";
import { SkillRegistry } from "@copilotkit/intelligence-delivery-core";
import * as api from "../index.js";

function archive(revision: string) {
  const files = {
    "SKILL.md": `Secret skill body ${revision}`,
    "reference.txt": `Reference € ${revision}`,
  };
  const manifest = {
    schemaVersion: 1,
    revision,
    skills: [
      {
        name: "refund",
        description: `Refund guidance ${revision}`,
        files: Object.entries(files).map(([path, text]) => ({
          path,
          size: Buffer.byteLength(text),
          sha256: createHash("sha256").update(text).digest("hex"),
        })),
      },
    ],
  };
  const bytes = zipSync(
    Object.fromEntries([
      ["manifest.json", strToU8(JSON.stringify(manifest))],
      ...Object.entries(files).map(([path, text]) => [
        `refund/${path}`,
        strToU8(text),
      ]),
    ]),
  );
  return {
    status: "snapshot" as const,
    bytes,
    revision,
    etag: `"${createHash("sha256").update(bytes).digest("hex")}"`,
    contentType: "application/zip",
  };
}
function setup() {
  let revision = "A";
  const client = new CopilotKitIntelligence({ apiKey: "unused-test-key" });
  const fetch = vi
    .spyOn(client, "getLearnedSkillsSnapshot")
    .mockImplementation(async () => archive(revision));
  const registry = new SkillRegistry({
    client,
    containerId: "container",
    freshnessWindowMs: 0,
  });
  return {
    registry,
    fetch,
    setRevision: (value: string) => {
      revision = value;
    },
  };
}
class Model extends BaseChatModel {
  calls: BaseMessage[][] = [];
  respond: (messages: BaseMessage[]) => Promise<AIMessage>;
  constructor(respond: (messages: BaseMessage[]) => Promise<AIMessage>) {
    super({});
    this.respond = respond;
  }
  _llmType() {
    return "local-skill-test";
  }
  bindTools() {
    return this;
  }
  async _generate(messages: BaseMessage[]) {
    this.calls.push(messages);
    const message = await this.respond(messages);
    return {
      generations: [
        {
          text: typeof message.content === "string" ? message.content : "",
          message,
        },
      ],
    };
  }
}
const input = {
  messages: [{ role: "user" as const, content: "Help with refunds." }],
};
afterEach(() => vi.restoreAllMocks());

it("acquires before model work and keeps catalog and parallel tools on one snapshot", async () => {
  const s = setup();
  const model = new Model(async (messages) => {
    if (!messages.some((message) => message instanceof ToolMessage)) {
      s.setRevision("B");
      await s.registry.acquireSnapshot();
      return new AIMessage({
        content: "",
        tool_calls: [
          {
            id: "load",
            name: "copilotkit_load_skill",
            args: { skill_name: "refund" },
          },
          {
            id: "read",
            name: "copilotkit_read_skill_file",
            args: { skill_name: "refund", path: "reference.txt" },
          },
        ],
      });
    }
    return new AIMessage("done");
  });
  const skills = api.createSkillRegistryMiddleware({ registry: s.registry });
  const agent = skills.wrapAgent(
    createAgent({
      model,
      systemPrompt: "Developer instructions win.",
      middleware: [skills],
    }),
  );
  const result = await agent.invoke(input);
  expect(model.calls).toHaveLength(2);
  for (const messages of model.calls) {
    expect(messages[0].text).toContain("Developer instructions win.");
    expect(messages[0].text).toContain("Refund guidance A");
    expect(messages[0].text).not.toContain("Refund guidance B");
  }
  const outputs = result.messages
    .filter((message) => message instanceof ToolMessage)
    .map((message) => message.text);
  expect(outputs.join("\n")).toContain("Secret skill body A");
  expect(outputs.join("\n")).toContain("Reference € A");
  expect(outputs.join("\n")).not.toContain("Reference € B");
  expect(s.fetch).toHaveBeenCalledTimes(2);
  await agent.invoke(input);
  expect(model.calls[2][0].text).toContain("Refund guidance B");
});

it("rejects a missing wrapper before a model call", async () => {
  const s = setup();
  const model = new Model(async () => new AIMessage("done"));
  const skills = api.createSkillRegistryMiddleware({ registry: s.registry });
  await expect(
    createAgent({ model, middleware: [skills] }).invoke(input),
  ).rejects.toThrow();
  expect(model.calls).toHaveLength(0);
});

it("blocks a cold delivery error before the model and allows a later retry", async () => {
  const s = setup();
  s.fetch.mockRejectedValueOnce(new Error("private network detail"));
  const model = new Model(async () => new AIMessage("done"));
  const skills = api.createSkillRegistryMiddleware({ registry: s.registry });
  const agent = skills.wrapAgent(createAgent({ model, middleware: [skills] }));
  await expect(agent.invoke(input)).rejects.toMatchObject({
    code: "NETWORK_ERROR",
  });
  expect(model.calls).toHaveLength(0);
  await agent.invoke(input);
  expect(model.calls).toHaveLength(1);
});

it("pins independently for overlapping invocations", async () => {
  const s = setup();
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const model = new Model(async (messages) => {
    if (messages[0].text.includes("Refund guidance A")) {
      entered();
      await blocked;
    }
    return new AIMessage(messages[0].text);
  });
  const skills = api.createSkillRegistryMiddleware({ registry: s.registry });
  const agent = skills.wrapAgent(createAgent({ model, middleware: [skills] }));
  const first = agent.invoke(input);
  await started;
  s.setRevision("B");
  const second = await agent.invoke(input);
  release();
  expect((await first).messages.at(-1)?.text).toContain("Refund guidance A");
  expect(second.messages.at(-1)?.text).toContain("Refund guidance B");
});

it("refreshes on tool-first resume and does not checkpoint the private snapshot", async () => {
  const s = setup();
  const saver = new MemorySaver();
  const model = new Model(async (messages) =>
    messages.some((message) => message instanceof ToolMessage)
      ? new AIMessage("done")
      : new AIMessage({
          content: "",
          tool_calls: [
            {
              id: "read",
              name: "copilotkit_read_skill_file",
              args: { skill_name: "refund", path: "reference.txt" },
            },
          ],
        }),
  );
  const skills = api.createSkillRegistryMiddleware({ registry: s.registry });
  const agent = skills.wrapAgent(
    createAgent({ model, middleware: [skills], checkpointer: saver }),
  );
  const config = { configurable: { thread_id: "resume" } };
  const first = await agent.invoke(input, {
    ...config,
    interruptBefore: ["tools"],
  });
  expect(first.messages.some((message) => message instanceof ToolMessage)).toBe(
    false,
  );
  expect((await agent.getState(config)).next).toContain("tools");
  const saved = await saver.getTuple(config);
  expect(JSON.stringify(saved)).not.toContain("Secret skill body A");
  expect(JSON.stringify(saved)).not.toContain("Refund guidance A");
  s.setRevision("B");
  const resumed = await agent.invoke(new Command({ resume: true }), config);
  expect(
    resumed.messages
      .filter((message) => message instanceof ToolMessage)
      .map((message) => message.text)
      .join(),
  ).toContain("Reference € B");
  expect(s.fetch).toHaveBeenCalledTimes(2);
  expect(model.calls.at(-1)?.[0].text).toContain("Refund guidance B");
});

it("refreshes after an interrupt inside a tool without saving a snapshot holder", async () => {
  const s = setup();
  const approve = tool(() => String(interrupt("approve")), {
    name: "approve",
    description: "Request approval",
    schema: z.object({}),
  });
  const saver = new MemorySaver();
  const model = new Model(async (messages) =>
    messages.some((message) => message instanceof ToolMessage)
      ? new AIMessage("done")
      : new AIMessage({
          content: "",
          tool_calls: [{ id: "approve", name: "approve", args: {} }],
        }),
  );
  const skills = api.createSkillRegistryMiddleware({ registry: s.registry });
  const agent = skills.wrapAgent(
    createAgent({
      model,
      tools: [approve],
      middleware: [skills],
      checkpointer: saver,
    }),
  );
  const config = { configurable: { thread_id: "inside-tool" } };
  await agent.invoke(input, config);
  s.setRevision("B");
  await agent.invoke(new Command({ resume: "yes" }), config);
  expect(model.calls.at(-1)?.[0].text).toContain("Refund guidance B");
  expect(JSON.stringify(await saver.getTuple(config))).not.toContain(
    "Secret skill body",
  );
});

for (const mode of ["stream", "events-v2", "events-v3"] as const) {
  it(`keeps native ${mode} usable and captures a fresh snapshot per stream`, async () => {
    const s = setup();
    const model = new Model(async () => new AIMessage("done"));
    const skills = api.createSkillRegistryMiddleware({ registry: s.registry });
    const agent = skills
      .wrapAgent(createAgent({ model, middleware: [skills] }))
      .withConfig({ tags: ["preserved"] });
    for (const revision of ["A", "B"]) {
      s.setRevision(revision);
      if (mode === "stream") {
        const stream = await agent.stream(input, { streamMode: "values" });
        expect(stream).toBeInstanceOf(ReadableStream);
        for await (const _ of stream) {
          /* consume native values */
        }
      } else if (mode === "events-v2") {
        const stream = agent.streamEvents(input, { version: "v2" });
        expect(stream).toBeInstanceOf(ReadableStream);
        for await (const _ of stream) {
          /* consume native events */
        }
      } else {
        const run = await agent.streamEvents(input, { version: "v3" });
        expect(await run.output).toHaveProperty("messages");
      }
      expect(model.calls.at(-1)?.[0].text).toContain(
        `Refund guidance ${revision}`,
      );
    }
    expect(s.fetch).toHaveBeenCalledTimes(2);
  });
}

it("blocks confirmed denial on a tool-first resume before running any tool", async () => {
  const s = setup();
  const saver = new MemorySaver();
  const called = vi.fn(() => "normal tool");
  const normal = tool(called, {
    name: "normal",
    description: "Normal tool",
    schema: z.object({}),
  });
  const model = new Model(
    async () =>
      new AIMessage({
        content: "",
        tool_calls: [{ id: "normal", name: "normal", args: {} }],
      }),
  );
  const skills = api.createSkillRegistryMiddleware({ registry: s.registry });
  const agent = skills.wrapAgent(
    createAgent({
      model,
      tools: [normal],
      middleware: [skills],
      checkpointer: saver,
    }),
  );
  const config = { configurable: { thread_id: "denied-resume" } };
  await agent.invoke(input, { ...config, interruptBefore: ["tools"] });
  expect(called).not.toHaveBeenCalled();
  s.fetch.mockRejectedValue(
    new api.SkillDeliveryError("REVISION_REVOKED", false),
  );
  const denied = agent.invoke(new Command({ resume: true }), config);
  await expect(denied).rejects.toBeInstanceOf(api.SkillDeliveryError);
  await expect(denied).rejects.toMatchObject({
    code: "REVISION_REVOKED",
    retryable: false,
  });
  expect(called).not.toHaveBeenCalled();
  expect(model.calls).toHaveLength(1);
});

it("preserves the pin through .graph streams consumed by native integrations", async () => {
  const s = setup();
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let enter!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const model = new Model(async (messages) => {
    if (!messages.some((message) => message instanceof ToolMessage)) {
      enter();
      await blocked;
      return new AIMessage({
        content: "",
        tool_calls: [
          {
            id: "read",
            name: "copilotkit_read_skill_file",
            args: { skill_name: "refund", path: "reference.txt" },
          },
        ],
      });
    }
    return new AIMessage("done");
  });
  const skills = api.createSkillRegistryMiddleware({ registry: s.registry });
  const agent = skills.wrapAgent(createAgent({ model, middleware: [skills] }));
  const events: unknown[] = [];
  const consume = (async () => {
    for await (const event of agent.graph
      .withConfig({ tags: ["graph"] })
      .streamEvents(input, { version: "v2" }))
      events.push(event);
  })();
  await entered;
  s.setRevision("B");
  await s.registry.acquireSnapshot();
  release();
  await consume;
  expect(model.calls.at(-1)?.[0].text).toContain("Refund guidance A");
  expect(
    model.calls.at(-1)?.find((message) => message instanceof ToolMessage)?.text,
  ).toBe("Reference € A");
  expect(JSON.stringify(events)).not.toContain("Secret skill body A");
});

it("one aborted caller does not cancel a shared registry refresh", async () => {
  const s = setup();
  let resolve!: (value: ReturnType<typeof archive>) => void;
  s.fetch.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const model = new Model(async () => new AIMessage("done"));
  const skills = api.createSkillRegistryMiddleware({ registry: s.registry });
  const agent = skills.wrapAgent(createAgent({ model, middleware: [skills] }));
  const controller = new AbortController();
  const first = agent.invoke(input, { signal: controller.signal });
  const rejection = expect(first).rejects.toThrow();
  const second = agent.invoke(input);
  await vi.waitFor(() => expect(s.fetch).toHaveBeenCalledTimes(1));
  controller.abort();
  resolve(archive("A"));
  await rejection;
  await second;
  expect(s.fetch).toHaveBeenCalledTimes(1);
  expect(s.fetch.mock.calls[0][0].signal?.aborted).toBe(false);
});

it("uses a multi-container registry through native middleware and skill tools", async () => {
  const client = new CopilotKitIntelligence({ apiKey: "test" });
  vi.spyOn(client, "getLearnedSkillsSnapshots").mockImplementation(
    async ({ containers }) =>
      containers.map(({ containerId }) => ({
        containerId,
        ...archive(containerId),
      })),
  );
  const registry = new SkillRegistry({
    client,
    containers: [{ id: "support" }, { id: "company" }],
  });
  const model = new Model(async (messages) => {
    if (!messages.some((message) => message instanceof ToolMessage)) {
      return new AIMessage({
        content: "",
        tool_calls: [
          {
            id: "load-support",
            name: "copilotkit_load_skill",
            args: { skill_name: "support/refund" },
          },
          {
            id: "load-company",
            name: "copilotkit_load_skill",
            args: { skill_name: "company/refund" },
          },
        ],
      });
    }
    return new AIMessage("done");
  });
  const skills = api.createSkillRegistryMiddleware({ registry });
  const agent = skills.wrapAgent(createAgent({ model, middleware: [skills] }));
  const result = await agent.invoke(input);
  expect(JSON.stringify(model.calls[0])).toContain("support/refund");
  expect(JSON.stringify(model.calls[0])).toContain("company/refund");
  const toolMessages = result.messages.filter(
    (message) => message instanceof ToolMessage,
  );
  expect(JSON.stringify(toolMessages)).toContain("Secret skill body support");
  expect(JSON.stringify(toolMessages)).toContain("Secret skill body company");
});
