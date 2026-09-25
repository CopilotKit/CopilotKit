import { provideZonelessChangeDetection } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { of } from "rxjs";
import { afterEach, describe, expect, it } from "vitest";

import { provideCopilotKit } from "./config";
import { CopilotKit } from "./copilotkit";

class OneMessageAgent extends AbstractAgent {
  run(input: RunAgentInput) {
    return of<BaseEvent[]>(
      {
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      },
      {
        type: EventType.TEXT_MESSAGE_START,
        messageId: "message-1",
        role: "assistant",
      },
      { type: EventType.TEXT_MESSAGE_END, messageId: "message-1" },
      {
        type: EventType.RUN_FINISHED,
        threadId: input.threadId,
        runId: input.runId,
      },
    );
  }
}

describe("CopilotKit dev agents", () => {
  afterEach(() => TestBed.resetTestingModule());

  it("lets the core track runs of agents passed to provideCopilotKit", async () => {
    const agent = new OneMessageAgent({ threadId: "thread-1" });
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideCopilotKit({
          licenseKey: "ck_pub_00000000000000000000000000000000",
          agents: { default: agent },
        }),
      ],
    });
    const { core } = TestBed.inject(CopilotKit);

    await agent.runAgent({ runId: "run-1" });

    expect(core.getRunIdForMessage("default", "thread-1", "message-1")).toBe(
      "run-1",
    );
  });
});
