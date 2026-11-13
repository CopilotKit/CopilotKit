import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

test("sub-agent delegations stay in their conversation thread", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mastra-subagents-"));
  vi.stubEnv("MASTRA_WORKING_MEMORY_URL", `file:${join(dir, "memory.db")}`);
  vi.stubEnv("OPENAI_API_KEY", "test-key");

  try {
    const { subagentsSupervisorAgent } =
      await import("../../src/mastra/agents");
    const { writeDelegationsToWorkingMemory } =
      await import("../../src/mastra/tools/working-memory");
    const memory = await subagentsSupervisorAgent.getMemory();
    expect(memory).toBeDefined();
    if (!memory) throw new Error("supervisor has no memory");

    for (const threadId of ["first", "second"]) {
      await memory.createThread({ threadId, resourceId: "same-user" });
    }

    const write = (threadId: string, id: string) =>
      writeDelegationsToWorkingMemory(
        {
          agent: {
            agentId: "subagentsSupervisorAgent",
            threadId,
            resourceId: "same-user",
          },
          mastra: { getAgentById: () => subagentsSupervisorAgent },
        },
        {
          id,
          sub_agent: "research_agent",
          task: "Test delegation",
          status: "completed",
          result: "Done",
        },
      );

    await write("first", "first-call");
    expect(
      await memory.getWorkingMemory({
        threadId: "second",
        resourceId: "same-user",
      }),
    ).toBeNull();

    await write("second", "second-call");
    const first = await memory.getWorkingMemory({
      threadId: "first",
      resourceId: "same-user",
    });
    const second = await memory.getWorkingMemory({
      threadId: "second",
      resourceId: "same-user",
    });
    expect(
      JSON.parse(String(first)).delegations.map(
        (entry: { id: string }) => entry.id,
      ),
    ).toEqual(["first-call"]);
    expect(
      JSON.parse(String(second)).delegations.map(
        (entry: { id: string }) => entry.id,
      ),
    ).toEqual(["second-call"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
