import React from "react";
import { render, waitFor } from "@testing-library/react";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpAgent } from "@ag-ui/client";
import { CopilotKitProvider } from "../../providers/CopilotKitProvider";
import { useAgent } from "../use-agent";

/**
 * Regression test for #5635: headers configured directly on an HttpAgent that
 * is registered via `agents__unsafe_dev_only` must NOT be silently dropped.
 */

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function AgentConsumer({ agentId }: { agentId: string }) {
  useAgent({ agentId });
  return null;
}

describe("useAgent preserves agent-level headers (#5635)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ version: "1.0.0", agents: {} }),
      text: () => Promise.resolve("{}"),
    });
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("keeps an agent's own Authorization header when no provider headers are set", async () => {
    const agent = new HttpAgent({
      url: "https://backend.example/agent",
      headers: { Authorization: "Bearer agent-token" },
    });

    render(
      <CopilotKitProvider agents__unsafe_dev_only={{ default: agent }}>
        <AgentConsumer agentId="default" />
      </CopilotKitProvider>,
    );

    await waitFor(() => {
      // Exact match: with no provider headers, the agent's own header set is
      // the complete result (HttpAgent adds no defaults).
      expect(agent.headers).toEqual({
        Authorization: "Bearer agent-token",
      });
    });
  });

  it("merges provider headers on top of the agent's own headers", async () => {
    const agent = new HttpAgent({
      url: "https://backend.example/agent",
      headers: { "X-Agent": "agent-value", Authorization: "Bearer agent" },
    });

    render(
      <CopilotKitProvider
        agents__unsafe_dev_only={{ default: agent }}
        headers={{ Authorization: "Bearer provider", "X-Provider": "p" }}
      >
        <AgentConsumer agentId="default" />
      </CopilotKitProvider>,
    );

    await waitFor(() => {
      // Agent-only header survives, provider-only header is added, and the
      // conflicting Authorization is won by the provider-level value.
      expect(agent.headers).toMatchObject({
        "X-Agent": "agent-value",
        Authorization: "Bearer provider",
        "X-Provider": "p",
      });
    });
  });
});
