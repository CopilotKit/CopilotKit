import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { streamText } from "ai";
import type { ToolSet } from "ai";
import type * as AISDK from "ai";
import { EventType } from "@ag-ui/client";
import { BuiltInAgent } from "../index";
import type { AgentFactoryContext } from "../index";
import { CopilotKitIntelligence } from "../../v2/runtime/intelligence-platform/client";
import { LearnedSkillsError } from "../../v2/runtime/intelligence-platform/learned-skills";
import type { LearnedSkillsSnapshotResult } from "../../v2/runtime/intelligence-platform/learned-skills";
import fixtures from "../../../../intelligence-delivery-core/conformance/snapshots.v1.json";
import { createDefaultInput, collectEvents } from "./agent-test-helpers";
import { mockStreamTextResponse, finish } from "./test-helpers";

vi.mock("ai", async (original) => ({
  ...(await original<typeof AISDK>()),
  streamText: vi.fn(),
}));

function response(name = "text-skill"): LearnedSkillsSnapshotResult {
  const fixture = fixtures.cases.find((item) => item.name === name)!;
  return {
    status: "snapshot",
    bytes: new Uint8Array(Buffer.from(fixture.archiveBase64, "base64")),
    revision: fixture.revision,
    etag: fixture.etag,
    contentType: "application/zip",
  };
}
function setup() {
  const client = new CopilotKitIntelligence({ apiKey: "test-key" });
  const fetch = vi
    .spyOn(client, "getLearnedSkillsSnapshot")
    .mockResolvedValue(response());
  return {
    fetch,
    learnedSkills: { client, containerId: "learning", freshnessWindowMs: 0 },
  };
}
function factoryAgent(
  learnedSkills?: ReturnType<typeof setup>["learnedSkills"],
) {
  const contexts: AgentFactoryContext[] = [];
  const agent = new BuiltInAgent({
    type: "custom",
    learnedSkills,
    factory: async function* (ctx) {
      contexts.push(ctx);
    },
  });
  return { agent, contexts };
}
async function execute(
  tools: ToolSet,
  name: string,
  args: Record<string, string>,
) {
  return tools[name].execute!(args, { toolCallId: "test", messages: [] });
}
beforeEach(() => {
  vi.mocked(streamText).mockImplementation(
    () => mockStreamTextResponse([finish()]) as ReturnType<typeof streamText>,
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("BuiltInAgent learned skills", () => {
  it("always supplies an empty factory context when unconfigured, even with delivery environment variables", async () => {
    vi.stubEnv("CPK_INTELLIGENCE_API_KEY", "environment-key");
    vi.stubEnv(
      "CPK_INTELLIGENCE_LEARNING_CONTAINER_ID",
      "environment-container",
    );
    const fetch = vi.spyOn(
      CopilotKitIntelligence.prototype,
      "getLearnedSkillsSnapshot",
    );
    const { agent, contexts } = factoryAgent();
    await collectEvents(agent.run(createDefaultInput()));
    expect(contexts[0].learnedSkills).toEqual({ catalog: "", tools: {} });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not invoke a factory after immediate unsubscribe", async () => {
    const factory = vi.fn(async function* () {});
    const agent = new BuiltInAgent({ type: "custom", factory });
    agent.run(createDefaultInput()).subscribe().unsubscribe();
    await new Promise((resolve) => setImmediate(resolve));
    expect(factory).not.toHaveBeenCalled();
  });

  it("keeps a configured empty snapshot empty and discovers skills on a later run", async () => {
    const { fetch, learnedSkills } = setup();
    fetch.mockResolvedValueOnce(response("empty"));
    const { agent, contexts } = factoryAgent(learnedSkills);
    await collectEvents(agent.run(createDefaultInput()));
    expect(contexts[0].learnedSkills).toEqual({ catalog: "", tools: {} });
    await collectEvents(agent.run(createDefaultInput({ runId: "next" })));
    expect(contexts[1].learnedSkills.catalog).toContain("refund-policy");
    expect(contexts[1].learnedSkills.catalog).not.toContain("30 days");
    expect(Object.keys(contexts[1].learnedSkills.tools)).toEqual([
      "copilotkit_load_skill",
      "copilotkit_read_skill_file",
    ]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][0].ifNoneMatch).toBe(response("empty").etag);
  });

  it("loads skill content and only exact supporting paths from the invocation snapshot", async () => {
    const { learnedSkills } = setup();
    const { agent, contexts } = factoryAgent(learnedSkills);
    const input = createDefaultInput();
    const original = structuredClone(input);
    await collectEvents(agent.run(input));
    const { tools } = contexts[0].learnedSkills;
    expect(
      JSON.parse(
        (await execute(tools, "copilotkit_load_skill", {
          skill_name: "refund-policy",
        })) as string,
      ),
    ).toMatchObject({ skill_name: "refund-policy", files: ["reference.txt"] });
    expect(
      await execute(tools, "copilotkit_read_skill_file", {
        skill_name: "refund-policy",
        path: "reference.txt",
      }),
    ).toContain("30 days");
    await expect(
      execute(tools, "copilotkit_read_skill_file", {
        skill_name: "refund-policy",
        path: "../reference.txt",
      }),
    ).rejects.toThrow("unavailable");
    expect(input).toEqual(original);
    expect(input.state).toEqual({});
  });

  it("automatically adds the catalog and executable tools to classic model calls", async () => {
    const { learnedSkills } = setup();
    const agent = new BuiltInAgent({
      model: "openai/gpt-4o",
      prompt: "Host rules",
      learnedSkills,
    });
    await collectEvents(agent.run(createDefaultInput()));
    const params = vi.mocked(streamText).mock.calls[0][0];
    expect(JSON.stringify(params.messages)).toContain("Host rules");
    expect(JSON.stringify(params.messages)).toContain("refund-policy");
    expect(JSON.stringify(params.messages)).not.toContain("30 days");
    expect(
      await execute(params.tools!, "copilotkit_read_skill_file", {
        skill_name: "refund-policy",
        path: "reference.txt",
      }),
    ).toContain("30 days");
  });

  it.each([false, true])(
    "does not add classic catalog/tools when empty (configured=%s)",
    async (configured) => {
      const { fetch, learnedSkills } = setup();
      fetch.mockResolvedValue(response("empty"));
      const agent = new BuiltInAgent({
        model: "openai/gpt-4o",
        ...(configured ? { learnedSkills } : {}),
      });
      await collectEvents(agent.run(createDefaultInput()));
      const params = vi.mocked(streamText).mock.calls[0][0];
      expect(params.tools).not.toHaveProperty("copilotkit_load_skill");
      expect(JSON.stringify(params.messages)).not.toContain(
        "copilotkit_learned_skills",
      );
      expect(fetch).toHaveBeenCalledTimes(configured ? 1 : 0);
    },
  );

  it("passes exact revision to the canonical client", async () => {
    const { fetch, learnedSkills } = setup();
    const { agent } = factoryAgent({
      ...learnedSkills,
      revision: "r1",
    } as typeof learnedSkills);
    await collectEvents(agent.run(createDefaultInput()));
    expect(fetch).toHaveBeenCalledWith(
      expect.objectContaining({ containerId: "learning", revision: "r1" }),
    );
  });

  it("refreshes for a resumed run without changing the previous run's tool closures", async () => {
    const { fetch, learnedSkills } = setup();
    const { agent, contexts } = factoryAgent(learnedSkills);
    await collectEvents(agent.run(createDefaultInput()));
    fetch.mockResolvedValue(response("empty"));
    await collectEvents(
      agent.run(
        createDefaultInput({
          runId: "resume",
          resume: [
            { interruptId: "approval", status: "resolved", payload: true },
          ],
        }),
      ),
    );
    expect(contexts[1].learnedSkills).toEqual({ catalog: "", tools: {} });
    expect(
      await execute(
        contexts[0].learnedSkills.tools,
        "copilotkit_read_skill_file",
        { skill_name: "refund-policy", path: "reference.txt" },
      ),
    ).toContain("30 days");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("shares one fetch and warm cache across concurrently invoked clones", async () => {
    const { fetch, learnedSkills } = setup();
    let resolve!: (response: LearnedSkillsSnapshotResult) => void;
    fetch.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const { agent, contexts } = factoryAgent({
      ...learnedSkills,
      freshnessWindowMs: 5000,
    });
    const first = collectEvents(agent.clone().run(createDefaultInput()));
    const second = collectEvents(
      agent.clone().run(createDefaultInput({ threadId: "second" })),
    );
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(contexts).toHaveLength(0);
    resolve(response());
    await Promise.all([first, second]);
    await collectEvents(agent.clone().run(createDefaultInput()));
    expect(contexts).toHaveLength(3);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(contexts[0].input.threadId).not.toBe(contexts[1].input.threadId);
  });

  it("cancels a waiting invocation without cancelling a clone's shared fetch", async () => {
    const { fetch, learnedSkills } = setup();
    let resolve!: (response: LearnedSkillsSnapshotResult) => void;
    fetch.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const { agent, contexts } = factoryAgent(learnedSkills);
    const cancelled = agent.clone();
    const first = collectEvents(cancelled.run(createDefaultInput()));
    const second = collectEvents(
      agent.clone().run(createDefaultInput({ threadId: "survivor" })),
    );
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    cancelled.abortRun();
    await first;
    expect(contexts).toHaveLength(0);
    expect(fetch.mock.calls[0][0].signal?.aborted).toBe(false);
    resolve(response());
    await second;
    expect(contexts.map((ctx) => ctx.input.threadId)).toEqual(["survivor"]);
  });

  it.each(["NETWORK_ERROR", "AUTHORIZATION_FAILED"] as const)(
    "blocks cold factory work on %s and emits RUN_ERROR",
    async (code) => {
      const { fetch, learnedSkills } = setup();
      fetch.mockRejectedValue(
        new LearnedSkillsError(code, code === "NETWORK_ERROR"),
      );
      const { agent, contexts } = factoryAgent(learnedSkills);
      const events: string[] = [];
      await expect(
        new Promise<void>((resolve, reject) =>
          agent.run(createDefaultInput()).subscribe({
            next: (event) => events.push(event.type),
            error: reject,
            complete: resolve,
          }),
        ),
      ).rejects.toMatchObject({ code });
      expect(contexts).toHaveLength(0);
      expect(events).toEqual([EventType.RUN_STARTED, EventType.RUN_ERROR]);
    },
  );

  it("uses a verified stale cache after network failure, but blocks after confirmed denial", async () => {
    const { fetch, learnedSkills } = setup();
    const { agent, contexts } = factoryAgent(learnedSkills);
    await collectEvents(agent.run(createDefaultInput()));
    fetch.mockRejectedValue(new LearnedSkillsError("NETWORK_ERROR", true));
    await collectEvents(agent.run(createDefaultInput()));
    expect(contexts[1].learnedSkills.catalog).toBe(
      contexts[0].learnedSkills.catalog,
    );
    fetch.mockRejectedValue(new LearnedSkillsError("DELIVERY_DISABLED", false));
    await expect(
      collectEvents(agent.run(createDefaultInput())),
    ).rejects.toMatchObject({ code: "DELIVERY_DISABLED" });
    expect(contexts).toHaveLength(2);
  });

  it("rejects a client tool that shadows a learned skill tool before calling the model", async () => {
    const { learnedSkills } = setup();
    const agent = new BuiltInAgent({ model: "openai/gpt-4o", learnedSkills });
    await expect(
      collectEvents(
        agent.run(
          createDefaultInput({
            tools: [
              {
                name: "copilotkit_load_skill",
                description: "collision",
                parameters: { type: "object" },
              },
            ],
          }),
        ),
      ),
    ).rejects.toThrow("copilotkit_load_skill");
    expect(streamText).not.toHaveBeenCalled();
  });
});
