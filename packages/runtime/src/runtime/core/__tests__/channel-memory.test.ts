import { beforeEach, expect, test, vi } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";

const middlewareCalls: unknown[][] = [];
vi.mock("@ag-ui/mcp-middleware", () => ({
  MCPMiddleware: class MockMCPMiddleware {
    constructor(...args: unknown[]) {
      middlewareCalls.push(args);
    }
  },
}));

import { attachChannelMemory } from "../channel-manager";
import { CopilotKitIntelligence } from "../../intelligence-platform";
import {
  INTELLIGENCE_MEMORY_GRANT_HEADER,
  INTELLIGENCE_USER_ID_HEADER,
} from "../../intelligence-platform/client";

const intelligence = new CopilotKitIntelligence({
  apiUrl: "https://intelligence.example",
  wsUrl: "wss://intelligence.example",
  apiKey: "cpk-42_short_long",
});

beforeEach(() => middlewareCalls.splice(0));

test("Channel Memory attaches an immutable personal and project grant", () => {
  const use = vi.fn();
  const agent = { use } as unknown as AbstractAgent;

  attachChannelMemory(agent, intelligence, {
    grant: { user: "read", project: "read-write" },
    user: { id: "person-1", name: "Ada" },
  });

  expect(use).toHaveBeenCalledTimes(1);
  expect(middlewareCalls).toEqual([
    [
      [
        {
          type: "http",
          url: "https://intelligence.example/mcp",
          serverId: "intelligence",
          headers: {
            Authorization: "Bearer cpk-42_short_long",
            [INTELLIGENCE_MEMORY_GRANT_HEADER]: JSON.stringify({
              user: "read",
              project: "read-write",
            }),
            [INTELLIGENCE_USER_ID_HEADER]: "person-1",
          },
        },
      ],
    ],
  ]);
});

test("project-only Channel Memory sends no fabricated user", () => {
  const agent = { use: vi.fn() } as unknown as AbstractAgent;

  attachChannelMemory(agent, intelligence, {
    grant: { user: "none", project: "read" },
    user: null,
  });

  const [[servers]] = middlewareCalls as [[Array<{ headers: object }>]];
  expect(servers[0]?.headers).toEqual({
    Authorization: "Bearer cpk-42_short_long",
    [INTELLIGENCE_MEMORY_GRANT_HEADER]: JSON.stringify({
      user: "none",
      project: "read",
    }),
  });
});

test("Channel Memory rejects an agent without middleware before its run", () => {
  expect(() =>
    attachChannelMemory({} as AbstractAgent, intelligence, {
      grant: { user: "none", project: "read" },
      user: null,
    }),
  ).toThrow(
    expect.objectContaining({ code: "channel_memory_agent_unsupported" }),
  );
});
