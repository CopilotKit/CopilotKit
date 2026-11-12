import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, Message, RunAgentInput } from "@ag-ui/client";
import { A2UIMiddleware } from "@ag-ui/a2ui-middleware";
import { firstValueFrom, from, toArray } from "rxjs";
import type { Observable } from "rxjs";
import { describe, expect, it } from "vitest";
import { GENERATIVE_UI_ACTIVITY_TYPE } from "@copilotkit/shared";
import type {
  A2UIActionMessage,
  CopilotKitUIEnvelope,
} from "@copilotkit/shared";
import { downgradeA2UIV09Action } from "../generative-ui/a2ui-v09-actions";

const action: A2UIActionMessage = {
  version: "1.0",
  action: {
    name: "choose",
    surfaceId: "plans",
    sourceComponentId: "team-button",
    timestamp: "2026-10-20T10:00:00.000Z",
    userMessage: "Show me the Team plan",
    context: { plan: "team" },
  },
};

type Surfaces =
  CopilotKitUIEnvelope["metadata"]["extensions"]["copilotkit_surfaces"];

/**
 * A format 3 envelope, as the 1.0 client sends it, with an optional action
 * and the surface summaries.
 */
function envelope(
  copilotkitAction?: unknown,
  surfaces: Surfaces = {},
): CopilotKitUIEnvelope {
  return {
    "1.0": {
      supportedCatalogIds: ["shop"],
      inlineCatalogs: [
        { catalogId: "shop", protocolVersion: "1.0", functions: {} },
      ],
    },
    metadata: {
      extensions: {
        copilotkit_format: 3,
        copilotkit_transport: "tool",
        copilotkit_targets: [{ id: "chat", kind: "chat" }],
        copilotkit_surfaces: surfaces,
        copilotkit_contextSent: false,
        ...(copilotkitAction === undefined
          ? {}
          : { copilotkit_action: copilotkitAction as A2UIActionMessage }),
      },
    },
  };
}

function surfaceMessage(surfaceId: string, a2uiSourceVersion?: "0.9"): Message {
  return {
    id: `genui:${surfaceId}`,
    role: "activity",
    activityType: GENERATIVE_UI_ACTIVITY_TYPE,
    content: {
      surfaceId,
      target: "chat",
      catalogId: "shop",
      operations: [],
      status: "ready",
      rejected: [],
      ...(a2uiSourceVersion ? { a2uiSourceVersion } : {}),
    },
  };
}

const clickMessage: Message = {
  id: "click",
  role: "user",
  content: "Show me the Team plan\n\nplan: team",
};

function runInput(
  messages: Message[],
  copilotkitAction: unknown = action,
  surfaces: Surfaces = {},
): RunAgentInput {
  return {
    threadId: "thread",
    runId: "run",
    state: {},
    messages,
    tools: [],
    context: [],
    forwardedProps: {
      other: true,
      copilotkit: { ui: envelope(copilotkitAction, surfaces) },
    },
  };
}

const firstTurn: Message[] = [
  { id: "u1", role: "user", content: "Which plans are there?" },
  { id: "a1", role: "assistant", content: "Here they are." },
];

/** The v0.9 `userAction` of `action`, in the v0.9 client's field order. */
const expectedUserAction = {
  name: "choose",
  surfaceId: "plans",
  sourceComponentId: "team-button",
  context: { plan: "team" },
  timestamp: "2026-10-20T10:00:00.000Z",
};

describe("downgradeA2UIV09Action", () => {
  it("sets the v0.9 a2uiAction for a click on a converted surface", () => {
    const input = runInput([
      ...firstTurn,
      surfaceMessage("plans", "0.9"),
      clickMessage,
    ]);

    const result = downgradeA2UIV09Action(input);

    const forwardedProps = result.forwardedProps as Record<string, unknown>;
    expect(forwardedProps.a2uiAction).toStrictEqual({
      userAction: expectedUserAction,
    });
    expect(
      Object.keys(
        (forwardedProps.a2uiAction as { userAction: object }).userAction,
      ),
    ).toEqual([
      "name",
      "surfaceId",
      "sourceComponentId",
      "context",
      "timestamp",
    ]);
    // The rest of forwardedProps, including the 1.0 envelope, is kept.
    expect(forwardedProps.other).toBe(true);
    expect(forwardedProps.copilotkit).toBe(
      (input.forwardedProps as Record<string, unknown>).copilotkit,
    );
  });

  it("removes the visible click message and keeps the rest of the history", () => {
    const surface = surfaceMessage("plans", "0.9");
    const input = runInput([...firstTurn, surface, clickMessage]);

    const result = downgradeA2UIV09Action(input);

    expect(result.messages).toEqual([...firstTurn, surface]);
  });

  it("keeps the messages when the last one is not a user message", () => {
    const surface = surfaceMessage("plans", "0.9");
    const input = runInput([...firstTurn, surface]);

    const result = downgradeA2UIV09Action(input);

    expect(result.messages).toEqual([...firstTurn, surface]);
    expect(
      (result.forwardedProps as Record<string, unknown>).a2uiAction,
    ).toBeDefined();
  });

  it("leaves a click on a native 1.0 surface unchanged", () => {
    const input = runInput([
      ...firstTurn,
      surfaceMessage("plans"),
      clickMessage,
    ]);

    expect(downgradeA2UIV09Action(input, { agentVersion: "0.9" })).toBe(input);
  });

  it("uses the last activity message of the clicked surface only", () => {
    const input = runInput([
      surfaceMessage("plans"),
      surfaceMessage("other", "0.9"),
      clickMessage,
    ]);

    expect(downgradeA2UIV09Action(input)).toBe(input);
  });

  it("falls back to agentVersion when no activity message names the surface", () => {
    const input = runInput([...firstTurn, clickMessage]);

    const converted = downgradeA2UIV09Action(input, { agentVersion: "0.9" });

    expect(
      (converted.forwardedProps as Record<string, unknown>).a2uiAction,
    ).toStrictEqual({ userAction: expectedUserAction });
    expect(converted.messages).toEqual(firstTurn);
    expect(downgradeA2UIV09Action(input, { agentVersion: "1.0" })).toBe(input);
    expect(downgradeA2UIV09Action(input)).toBe(input);
  });

  describe("the surface summary in the envelope", () => {
    it("converts a click on a surface the summary marks 0.9, whatever the agent speaks", () => {
      // The 1.0 client sends no activity messages: only the summary knows.
      const input = runInput([...firstTurn, clickMessage], action, {
        plans: { target: "chat", a2uiSourceVersion: "0.9" },
      });

      const result = downgradeA2UIV09Action(input, { agentVersion: "1.0" });

      expect(
        (result.forwardedProps as Record<string, unknown>).a2uiAction,
      ).toStrictEqual({ userAction: expectedUserAction });
      expect(result.messages).toEqual(firstTurn);
    });

    it("leaves a click on a surface the summary lists without a tag unchanged", () => {
      const input = runInput(
        [...firstTurn, surfaceMessage("plans", "0.9"), clickMessage],
        action,
        { plans: { target: "chat" } },
      );

      expect(downgradeA2UIV09Action(input, { agentVersion: "0.9" })).toBe(
        input,
      );
    });

    it("falls back to the activity message and agentVersion when it does not list the surface", () => {
      const surfaces = {
        other: { target: "chat", a2uiSourceVersion: "0.9" as const },
      };
      const fromMessage = runInput(
        [...firstTurn, surfaceMessage("plans", "0.9"), clickMessage],
        action,
        surfaces,
      );
      const unknown = runInput([...firstTurn, clickMessage], action, surfaces);

      expect(
        (
          downgradeA2UIV09Action(fromMessage).forwardedProps as Record<
            string,
            unknown
          >
        ).a2uiAction,
      ).toStrictEqual({ userAction: expectedUserAction });
      expect(downgradeA2UIV09Action(unknown, { agentVersion: "1.0" })).toBe(
        unknown,
      );
      expect(
        (
          downgradeA2UIV09Action(unknown, { agentVersion: "0.9" })
            .forwardedProps as Record<string, unknown>
        ).a2uiAction,
      ).toStrictEqual({ userAction: expectedUserAction });
    });
  });

  it("leaves a run with no action unchanged", () => {
    const input: RunAgentInput = {
      ...runInput([...firstTurn, surfaceMessage("plans", "0.9")]),
      forwardedProps: { copilotkit: { ui: envelope() } },
    };

    expect(downgradeA2UIV09Action(input, { agentVersion: "0.9" })).toBe(input);
  });

  it("leaves a run with no envelope unchanged", () => {
    const input: RunAgentInput = {
      ...runInput([surfaceMessage("plans", "0.9"), clickMessage]),
      forwardedProps: undefined,
    };

    expect(downgradeA2UIV09Action(input, { agentVersion: "0.9" })).toBe(input);
  });

  it("leaves a malformed action unchanged", () => {
    const input = runInput([surfaceMessage("plans", "0.9"), clickMessage], {
      version: "1.0",
      action: { surfaceId: "plans" },
    });

    expect(downgradeA2UIV09Action(input)).toBe(input);
  });

  it("keeps an a2uiAction that the run already has", () => {
    const input = runInput([surfaceMessage("plans", "0.9"), clickMessage]);
    const existing = { userAction: { name: "legacy", surfaceId: "plans" } };
    input.forwardedProps = { ...input.forwardedProps, a2uiAction: existing };

    expect(downgradeA2UIV09Action(input)).toBe(input);
  });

  it("does not mutate the input", () => {
    const input = runInput([
      ...firstTurn,
      surfaceMessage("plans", "0.9"),
      clickMessage,
    ]);
    const snapshot = structuredClone(input);

    const result = downgradeA2UIV09Action(input);

    expect(result).not.toBe(input);
    expect(input).toStrictEqual(snapshot);
  });

  it("gives A2UIMiddleware one click: its private action message ends the conversation", async () => {
    class RecordingAgent extends AbstractAgent {
      lastInput?: RunAgentInput;
      run(input: RunAgentInput): Observable<BaseEvent> {
        this.lastInput = input;
        return from([
          { type: EventType.RUN_STARTED, threadId: "thread", runId: "run" },
          { type: EventType.RUN_FINISHED, threadId: "thread", runId: "run" },
        ] as BaseEvent[]);
      }
    }
    const agent = new RecordingAgent();
    const input = downgradeA2UIV09Action(
      runInput([...firstTurn, surfaceMessage("plans", "0.9"), clickMessage]),
    );

    await firstValueFrom(
      new A2UIMiddleware().run(input, agent).pipe(toArray()),
    );

    // `@ag-ui/a2ui-middleware` 0.0.15 appends the action as a private user
    // message. The visible click message is gone, so the agent sees the
    // click once, and the conversation ends with it.
    const messages = agent.lastInput!.messages;
    const prefix = "A2UI user action:\n";
    const actionMessages = messages.filter(
      (message) =>
        message.role === "user" &&
        typeof message.content === "string" &&
        message.content.startsWith(prefix),
    );
    expect(actionMessages).toHaveLength(1);
    expect(messages.at(-1)).toBe(actionMessages[0]);
    expect(
      JSON.parse((actionMessages[0]!.content as string).slice(prefix.length)),
    ).toEqual(expectedUserAction);
    expect(messages.some((message) => message.id === clickMessage.id)).toBe(
      false,
    );
    expect(
      messages.some((message) => "toolCalls" in message && message.toolCalls),
    ).toBe(false);
  });
});
