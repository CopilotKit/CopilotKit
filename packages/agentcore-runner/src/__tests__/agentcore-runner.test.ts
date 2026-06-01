import { describe, it, expect } from "vitest";
import { firstValueFrom } from "rxjs";
import { toArray } from "rxjs/operators";
import { EventType, type MessagesSnapshotEvent } from "@ag-ui/client";
import type { AgentRunnerConnectRequest } from "@copilotkit/runtime/v2";
import { AgentCoreRunner } from "..";

describe("AgentCoreRunner.connect()", () => {
  it("emits empty snapshot for unknown thread", async () => {
    const runner = new AgentCoreRunner();
    const request: AgentRunnerConnectRequest = { threadId: "unknown-thread" };
    const events = await firstValueFrom(
      runner.connect(request).pipe(toArray()),
    );

    expect(events.map((e) => e.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.MESSAGES_SNAPSHOT,
      EventType.RUN_FINISHED,
    ]);
    const snapshot = events[1] as MessagesSnapshotEvent;
    expect(snapshot.messages).toEqual([]);
  });
});
