import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import type { RunAgentInput } from "@ag-ui/core";
import { Agent, FileStorage, SessionManager } from "@strands-agents/sdk";
import type { MessageData } from "@strands-agents/sdk";
import { RecordingModel } from "./test-support/recording-model";
import { ShowcaseStrandsAgent } from "./agent";

test("delivers current context across eight native session reloads without persisting it in messages", async () => {
  const directory = await mkdtemp(join(tmpdir(), "strands-transient-context-"));
  const model = new RecordingModel();
  const prompts: string[] = [];
  const catalog = "INTERNAL_CATALOG_SENTINEL" + "catalog-entry ".repeat(5000);
  try {
    for (let turn = 0; turn < 8; turn++) {
      // A fresh Agent loads the actual SDK session on each turn, like a server restart.
      const agent = new Agent({
        id: "context-regression",
        model,
        printer: false,
      });
      const adapter = new ShowcaseStrandsAgent({
        agent,
        name: "context-regression",
        config: {
          sessionManagerProvider: ({ threadId }) =>
            new SessionManager({
              sessionId: threadId,
              storage: { snapshot: new FileStorage(directory) },
            }),
        },
      });
      const prompt = `Show my current preferences, turn ${turn}.`;
      prompts.push(prompt);
      const input: RunAgentInput = {
        threadId: "context-thread",
        runId: `run-${turn}`,
        messages: [{ id: `user-${turn}`, role: "user", content: prompt }],
        context: [{ description: "Application catalog", value: catalog }],
        state: {
          preferences: { name: `Current-name-${turn}` },
          todos: [`Current-deal-${turn}`],
        },
        tools: [],
        forwardedProps: {},
      };
      const events = [];
      for await (const event of adapter.run(input)) events.push(event);
      expect(events.filter((event) => event.type === "RUN_ERROR")).toEqual([]);
      expect(model.requests).toHaveLength(turn + 1);
      const request = model.requests[turn];
      expect(request).toContain(catalog);
      expect(request).toContain(`Current-name-${turn}`);
      expect(request).toContain(`Current-deal-${turn}`);
      expect(request.split("INTERNAL_CATALOG_SENTINEL")).toHaveLength(2);
      if (turn > 0) expect(request).not.toContain(`Current-name-${turn - 1}`);
      // Inspect what native history import will read, not only the in-memory Agent.
      const files = await readdir(directory, { recursive: true });
      const snapshots = files.filter((file) =>
        file.endsWith("snapshot_latest.json"),
      );
      expect(snapshots).toHaveLength(1);
      const persisted = await readFile(join(directory, snapshots[0]), "utf8");
      const snapshot: { data: { messages: MessageData[] } } =
        JSON.parse(persisted);
      expect(
        snapshot.data.messages
          .filter((message) => message.role === "user")
          .map((message) =>
            message.content
              .map((block) => ("text" in block ? block.text : ""))
              .join(""),
          ),
      ).toEqual(prompts);
      expect(persisted).not.toContain("INTERNAL_CATALOG_SENTINEL");
      expect(persisted).not.toContain("Current-name-");
      for (const original of prompts) expect(persisted).toContain(original);
      expect(persisted.length).toBeLessThan(10000);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
