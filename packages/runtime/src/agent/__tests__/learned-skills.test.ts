import { afterEach, describe, expect, it, vi } from "vitest";
import { EventType } from "@ag-ui/client";
import { BuiltInAgent } from "../index";
import type { AgentFactoryContext } from "../index";
import type { BuiltInAgentLearnedSkillsOptions } from "../learned-skills";
import type { AgentToolSpec } from "../tool-spec";
import { CopilotKitIntelligence } from "../../runtime/intelligence-platform/client";
import { LearnedSkillsError } from "../../runtime/intelligence-platform/learned-skills";
import type { LearnedSkillsSnapshotResult } from "../../runtime/intelligence-platform/learned-skills";
import fixtures from "../../../../intelligence-delivery-core/conformance/snapshots.v1.json";
import { createDefaultInput, collectEvents } from "./agent-test-helpers";

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
function factoryAgent(learnedSkills?: BuiltInAgentLearnedSkillsOptions) {
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
/** Runs the learned-skills tool `name` the way a model SDK would. */
async function execute(
  definitions: readonly AgentToolSpec[],
  name: string,
  args: Record<string, string>,
) {
  const definition = definitions.find((spec) => spec.name === name);
  if (!definition?.execute) throw new Error(`No executable tool ${name}`);
  return definition.execute(args);
}
const noSkills = { catalog: "", definitions: [] };
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
    expect(contexts[0].learnedSkills).toEqual(noSkills);
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
    expect(contexts[0].learnedSkills).toEqual(noSkills);
    await collectEvents(agent.run(createDefaultInput({ runId: "next" })));
    expect(contexts[1].learnedSkills.catalog).toContain("refund-policy");
    expect(contexts[1].learnedSkills.catalog).not.toContain("30 days");
    expect(
      contexts[1].learnedSkills.definitions.map((spec) => spec.name),
    ).toEqual(["copilotkit_load_skill", "copilotkit_read_skill_file"]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][0].ifNoneMatch).toBe(response("empty").etag);
  });

  it("loads skill content and only exact supporting paths from the invocation snapshot", async () => {
    const { learnedSkills } = setup();
    const { agent, contexts } = factoryAgent(learnedSkills);
    const input = createDefaultInput();
    const original = structuredClone(input);
    await collectEvents(agent.run(input));
    const { definitions } = contexts[0].learnedSkills;
    expect(
      JSON.parse(
        (await execute(definitions, "copilotkit_load_skill", {
          skill_name: "refund-policy",
        })) as string,
      ),
    ).toMatchObject({ skill_name: "refund-policy", files: ["reference.txt"] });
    expect(
      await execute(definitions, "copilotkit_read_skill_file", {
        skill_name: "refund-policy",
        path: "reference.txt",
      }),
    ).toContain("30 days");
    await expect(
      execute(definitions, "copilotkit_read_skill_file", {
        skill_name: "refund-policy",
        path: "../reference.txt",
      }),
    ).rejects.toThrow("unavailable");
    expect(input).toEqual(original);
    expect(input.state).toEqual({});
  });

  it("supplies executable skills to a TanStack factory and refreshes on resume", async () => {
    const { fetch, learnedSkills } = setup();
    const contexts: AgentFactoryContext[] = [];
    const agent = new BuiltInAgent({
      type: "tanstack",
      learnedSkills,
      factory: async function* (context) {
        contexts.push(context);
        const delta = context.learnedSkills.catalog
          ? ((await execute(
              context.learnedSkills.definitions,
              "copilotkit_load_skill",
              { skill_name: "refund-policy" },
            )) as string)
          : "No skills";
        yield { type: "TEXT_MESSAGE_CONTENT", delta };
      },
    });
    const events = await collectEvents(agent.run(createDefaultInput()));
    expect(contexts[0].learnedSkills.catalog).toContain("refund-policy");
    expect(JSON.stringify(events)).toContain("Use the published refund policy");
    expect(events.at(-1)?.type).toBe(EventType.RUN_FINISHED);
    fetch.mockResolvedValue(response("empty"));
    const resumed = await collectEvents(
      agent.run(
        createDefaultInput({
          runId: "resumed",
          resume: [
            { interruptId: "approval", status: "resolved", payload: true },
          ],
        }),
      ),
    );
    expect(contexts[1].learnedSkills).toEqual(noSkills);
    expect(JSON.stringify(resumed)).toContain("No skills");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("passes exact revision to the canonical client", async () => {
    const { fetch, learnedSkills } = setup();
    const { agent } = factoryAgent({
      ...learnedSkills,
      revision: "r1",
    });
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
    expect(contexts[1].learnedSkills).toEqual(noSkills);
    expect(
      await execute(
        contexts[0].learnedSkills.definitions,
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
});

it("provides both container catalogs and executable tools to BuiltInAgent factories", async () => {
  const { fetch, learnedSkills } = setup();
  vi.spyOn(
    learnedSkills.client,
    "getLearnedSkillsSnapshots",
  ).mockImplementation(async ({ containers }) =>
    Promise.all(
      containers.map(async (source) => ({
        containerId: source.containerId,
        ...(await learnedSkills.client.getLearnedSkillsSnapshot(source)),
      })),
    ),
  );
  const contexts: AgentFactoryContext[] = [];
  const agent = new BuiltInAgent({
    type: "custom",
    learnedSkills: {
      client: learnedSkills.client,
      containers: [{ id: "support" }, { id: "company" }],
    },
    factory: async function* (context) {
      contexts.push(context);
      yield* [];
    },
  });
  await collectEvents(agent.run(createDefaultInput()));
  const skills = contexts[0].learnedSkills;
  expect(skills.catalog).toContain("support/refund-policy");
  expect(skills.catalog).toContain("company/refund-policy");
  expect(
    await execute(skills.definitions, "copilotkit_load_skill", {
      skill_name: "company/refund-policy",
    }),
  ).toContain("published refund policy");
  expect(fetch).toHaveBeenCalledTimes(2);
});
