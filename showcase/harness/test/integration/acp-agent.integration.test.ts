import { AcpAgent, CopilotKitIntelligence } from "@copilotkit/runtime/v2";
import { lastValueFrom, toArray } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";

const apiUrl = "https://intelligence.showcase.test";
const originalFetch = globalThis.fetch;
type AcpRunInput = Parameters<AcpAgent["run"]>[0];

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const input = (runId: string, resume?: AcpRunInput["resume"]): AcpRunInput => ({
  threadId: "showcase-acp-thread",
  runId,
  state: {},
  messages: [
    { id: "user-1", role: "user" as const, content: "Inspect this project." },
  ],
  tools: [],
  context: [],
  forwardedProps: {},
  ...(resume ? { resume } : {}),
});

const stored = (sequence: number, event: Record<string, unknown>) => ({
  sequence,
  eventId: `event-${sequence}`,
  event,
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("ACP Agent Showcase probe", () => {
  it("streams rich translated events through the public Intelligence client with exact cursors", async () => {
    const requests: Array<{ body?: unknown; headers: Headers; url: URL }> = [];
    let afterThreeCalls = 0;
    globalThis.fetch = vi.fn(async (request, init) => {
      const url = new URL(String(request));
      const headers = new Headers(init?.headers);
      requests.push({
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
        headers,
        url,
      });

      if (url.pathname === "/api/acp/runs") {
        return json({
          cursor: 0,
          duplicate: false,
          promptId: "prompt-1",
          runId: "showcase-run-rich",
          sessionId: "session-1",
        });
      }
      const after = Number(url.searchParams.get("after"));
      if (after === 0) {
        return json({
          events: [
            stored(1, {
              type: "RUN_STARTED",
              threadId: "showcase-acp-thread",
              runId: "showcase-run-rich",
            }),
            stored(2, {
              type: "TEXT_MESSAGE_START",
              messageId: "assistant-1",
              role: "assistant",
            }),
            stored(3, {
              type: "TEXT_MESSAGE_CONTENT",
              messageId: "assistant-1",
              delta: "I found the relevant files.",
            }),
          ],
        });
      }
      if (after === 3 && afterThreeCalls++ === 0) {
        return json({ events: [] });
      }
      if (after === 3) {
        return json({
          events: [
            stored(4, {
              type: "ACTIVITY_SNAPSHOT",
              messageId: "activity-1",
              activityType: "acp.tool",
              content: {
                kind: "tool_call",
                status: "completed",
                title: "Read project files",
              },
            }),
            stored(5, {
              type: "RAW",
              event: {
                protocol: "acp/v1",
                sessionUpdate: "available_commands_update",
              },
            }),
            stored(6, {
              type: "TEXT_MESSAGE_END",
              messageId: "assistant-1",
            }),
            stored(7, {
              type: "RUN_FINISHED",
              threadId: "showcase-acp-thread",
              runId: "showcase-run-rich",
              outcome: { type: "success" },
            }),
          ],
        });
      }
      return json({ events: [] });
    }) as typeof fetch;

    const intelligence = new CopilotKitIntelligence({
      apiKey: "showcase-project-key",
      apiUrl,
      wsUrl: "wss://realtime.showcase.test",
    });
    const agent = new AcpAgent({
      intelligence,
      agentProfileId: "showcase-codex",
      userId: "customer-user-1",
      pollIntervalMs: 0,
    });

    const events = await lastValueFrom(
      agent.run(input("showcase-run-rich")).pipe(toArray()),
    );

    expect(events.map((event) => event.type)).toEqual([
      "RUN_STARTED",
      "TEXT_MESSAGE_START",
      "TEXT_MESSAGE_CONTENT",
      "ACTIVITY_SNAPSHOT",
      "RAW",
      "TEXT_MESSAGE_END",
      "RUN_FINISHED",
    ]);
    expect(
      requests
        .filter(({ url }) => url.pathname.endsWith("/events"))
        .map(({ url }) => url.searchParams.get("after")),
    ).toEqual(["0", "3", "3"]);
    expect(requests[0]?.headers.get("authorization")).toBe(
      "Bearer showcase-project-key",
    );
    expect(requests[0]?.body).toMatchObject({
      agentProfileId: "showcase-codex",
      appUserId: "customer-user-1",
      input: { runId: "showcase-run-rich" },
    });
  });

  it("ends one run at an ACP permission interrupt and resumes it as a new AG-UI run", async () => {
    const admissions: unknown[] = [];
    globalThis.fetch = vi.fn(async (request, init) => {
      const url = new URL(String(request));
      if (url.pathname === "/api/acp/runs") {
        const body = JSON.parse(String(init?.body));
        admissions.push(body);
        return json({
          cursor: 0,
          duplicate: false,
          promptId: "prompt-permission",
          runId: body.input.runId,
          sessionId: "session-permission",
        });
      }
      const runId = decodeURIComponent(
        url.pathname.split("/").at(-2) ?? "missing",
      );
      if (runId === "showcase-run-interrupt") {
        return json({
          events: [
            stored(1, {
              type: "RUN_FINISHED",
              threadId: "showcase-acp-thread",
              runId,
              outcome: {
                type: "interrupt",
                interrupts: [
                  {
                    id: "acp-permission-1",
                    value: {
                      kind: "acp.permission",
                      title: "Allow project inspection?",
                      options: [{ id: "allow", name: "Allow once" }],
                    },
                  },
                ],
              },
            }),
          ],
        });
      }
      return json({
        events: [
          stored(1, {
            type: "TEXT_MESSAGE_CONTENT",
            messageId: "assistant-resume",
            delta: "Permission accepted.",
          }),
          stored(2, {
            type: "RUN_FINISHED",
            threadId: "showcase-acp-thread",
            runId,
            outcome: { type: "success" },
          }),
        ],
      });
    }) as typeof fetch;

    const intelligence = new CopilotKitIntelligence({
      apiKey: "showcase-project-key",
      apiUrl,
      wsUrl: "wss://realtime.showcase.test",
    });
    const agent = new AcpAgent({
      intelligence,
      agentProfileId: "showcase-codex",
      userId: "customer-user-1",
      pollIntervalMs: 0,
    });
    const firstEvents = await lastValueFrom(
      agent.run(input("showcase-run-interrupt")).pipe(toArray()),
    );
    const resume = [
      {
        interruptId: "acp-permission-1",
        status: "resolved" as const,
        payload: { optionId: "allow" },
      },
    ];
    const resumedEvents = await lastValueFrom(
      agent.run(input("showcase-run-resume", resume)).pipe(toArray()),
    );

    expect(firstEvents.at(-1)).toMatchObject({
      type: "RUN_FINISHED",
      outcome: { type: "interrupt" },
    });
    expect(resumedEvents.map((event) => event.type)).toEqual([
      "TEXT_MESSAGE_CONTENT",
      "RUN_FINISHED",
    ]);
    expect(admissions[1]).toMatchObject({
      input: { runId: "showcase-run-resume", resume },
    });
  });

  it("sends durable cancellation through the public client before local completion", async () => {
    const cancelBodies: unknown[] = [];
    globalThis.fetch = vi.fn(async (request, init) => {
      const url = new URL(String(request));
      if (url.pathname === "/api/acp/runs") {
        return json({
          cursor: 0,
          duplicate: false,
          promptId: "prompt-cancel",
          runId: "showcase-run-cancel",
          sessionId: "session-cancel",
        });
      }
      if (url.pathname.endsWith("/cancel")) {
        cancelBodies.push(JSON.parse(String(init?.body)));
        return json({ accepted: true });
      }
      return json({ events: [] });
    }) as typeof fetch;

    const agent = new AcpAgent({
      intelligence: new CopilotKitIntelligence({
        apiKey: "showcase-project-key",
        apiUrl,
        wsUrl: "wss://realtime.showcase.test",
      }),
      agentProfileId: "showcase-codex",
      userId: "customer-user-1",
      pollIntervalMs: 1,
    });
    const completed = new Promise<void>((resolve, reject) => {
      agent.run(input("showcase-run-cancel")).subscribe({
        complete: resolve,
        error: reject,
      });
    });
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());

    agent.abortRun();
    await completed;

    expect(cancelBodies).toEqual([{ runId: "showcase-run-cancel" }]);
  });
});
