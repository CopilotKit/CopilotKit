/**
 * Learned skills in `aiSdkAgent` runs: the catalog in the system prompt, the
 * skill tools the model can call, and the run failing before the model call.
 * Delivery, caching, and refresh are covered for every agent type in
 * `agent/__tests__/learned-skills.test.ts`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import type { ToolSet } from "ai";
import {
  collectEventsIncludingErrors,
  createDefaultInput,
  eventField,
} from "../../agent/__tests__/agent-test-helpers";
import { CopilotKitIntelligence } from "../../runtime/intelligence-platform/client";
import { LearnedSkillsError } from "../../runtime/intelligence-platform/learned-skills";
import type { LearnedSkillsSnapshotResult } from "../../runtime/intelligence-platform/learned-skills";
import fixtures from "../../../../intelligence-delivery-core/conformance/snapshots.v1.json";
import { aiSdkAgent } from "../agent";
import {
  modelEmitting,
  modelEmittingTurns,
  offeredToolNames,
  textTurn,
  toolCallTurn,
} from "./mock-model";

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

/** Learned-skills options whose delivery client answers with `snapshot`. */
function setup(snapshot = response()) {
  const client = new CopilotKitIntelligence({ apiKey: "test-key" });
  const fetch = vi
    .spyOn(client, "getLearnedSkillsSnapshot")
    .mockResolvedValue(snapshot);
  return {
    fetch,
    learnedSkills: { client, containerId: "learning", freshnessWindowMs: 0 },
  };
}

function run(
  agent: ReturnType<typeof aiSdkAgent>,
  input: Partial<RunAgentInput> = {},
) {
  return collectEventsIncludingErrors(
    agent.run(
      createDefaultInput({
        messages: [{ id: "u1", role: "user", content: "Hello" }],
        ...input,
      }),
    ),
  );
}

function eventTypes(events: BaseEvent[]) {
  return events.map((event) => event.type);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("aiSdkAgent learned skills", () => {
  it("puts the catalog before the prompt as system messages and runs the skill tools", async () => {
    const { learnedSkills } = setup();
    const model = modelEmittingTurns([
      toolCallTurn("tc-1", "copilotkit_read_skill_file", {
        skill_name: "refund-policy",
        path: "reference.txt",
      }),
      textTurn("ok"),
    ]);
    const agent = aiSdkAgent({ model, prompt: "Host rules", learnedSkills });

    const { events } = await run(agent);

    const [catalog, host, ...conversation] = model.doStreamCalls[0].prompt;
    expect(catalog.role).toBe("system");
    expect(catalog.content).toContain("refund-policy");
    expect(catalog.content).not.toContain("30 days");
    expect(host).toEqual({ role: "system", content: "Host rules" });
    expect(conversation.map((message) => message.role)).toEqual(["user"]);
    const result = events.find(
      (event) => event.type === EventType.TOOL_CALL_RESULT,
    );
    expect(eventField(result!, "content")).toContain("30 days");
  });

  it.each([
    { name: "not configured", configured: false, fetches: 0 },
    { name: "configured with an empty snapshot", configured: true, fetches: 1 },
  ])(
    "adds no catalog and no skill tools when $name",
    async ({ configured, fetches }) => {
      const { fetch, learnedSkills } = setup(response("empty"));
      const model = modelEmitting(textTurn("ok"));
      const agent = aiSdkAgent({
        model,
        ...(configured ? { learnedSkills } : {}),
      });

      await run(agent);

      const roles = model.doStreamCalls[0].prompt.map((m) => m.role);
      expect(roles).toEqual(["user"]);
      expect(offeredToolNames(model)).not.toContain("copilotkit_load_skill");
      expect(fetch).toHaveBeenCalledTimes(fetches);
    },
  );

  it.each(["NETWORK_ERROR", "AUTHORIZATION_FAILED"] as const)(
    "fails a cold run on %s with RUN_ERROR before calling the model",
    async (code) => {
      const { fetch, learnedSkills } = setup();
      fetch.mockRejectedValue(
        new LearnedSkillsError(code, code === "NETWORK_ERROR"),
      );
      const model = modelEmitting(textTurn("ok"));
      const agent = aiSdkAgent({ model, learnedSkills });

      const { events, errored } = await run(agent);

      expect(errored).toBe(true);
      expect(eventTypes(events)).toEqual([
        EventType.RUN_STARTED,
        EventType.RUN_ERROR,
      ]);
      expect(model.doStreamCalls).toHaveLength(0);
    },
  );

  it("rejects a frontend tool that uses a learned-skill tool name before calling the model", async () => {
    const { learnedSkills } = setup();
    const model = modelEmitting(textTurn("ok"));
    const agent = aiSdkAgent({ model, learnedSkills });

    const { events } = await run(agent, {
      tools: [
        {
          name: "copilotkit_load_skill",
          description: "collision",
          parameters: { type: "object" },
        },
      ],
    });

    const failure = events.find((event) => event.type === EventType.RUN_ERROR);
    expect(eventField(failure!, "message")).toContain("copilotkit_load_skill");
    expect(model.doStreamCalls).toHaveLength(0);
  });

  it("builds no tools and calls no model after an immediate unsubscribe", async () => {
    const tools = vi.fn(async (): Promise<ToolSet> => ({}));
    const model = modelEmitting(textTurn("ok"));
    const agent = aiSdkAgent({ model, tools });

    agent.run(createDefaultInput()).subscribe().unsubscribe();
    await new Promise((resolve) => setImmediate(resolve));

    expect(tools).not.toHaveBeenCalled();
    expect(model.doStreamCalls).toHaveLength(0);
  });
});
