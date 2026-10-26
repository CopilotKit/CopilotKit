import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { CopilotKitCore } from "@copilotkit/core";
import { useCopilotKit } from "../../../context";
import { CopilotChat } from "../CopilotChat";
import { useInterrupt } from "../../../hooks/use-interrupt";
import { defineToolCallRenderer } from "../../../types";
import { renderWithCopilotKit } from "../../../__tests__/utils/test-helpers";
import { ChildHistoryFixtureAgent } from "../../../__tests__/utils/child-history-fixture";

function Chat() {
  useInterrupt({
    render: ({ resolve, cancel }) => (
      <div>
        <button onClick={() => resolve({ approved: true })}>Allow child</button>
        <button onClick={() => resolve({ approved: false })}>Deny child</button>
        <button onClick={() => cancel()}>Cancel child</button>
      </div>
    ),
  });
  return <CopilotChat welcomeScreen={false} />;
}
function setup(agent = new ChildHistoryFixtureAgent()) {
  let core: CopilotKitCore;
  function Capture() {
    core = useCopilotKit().copilotkit;
    return <Chat />;
  }
  const handler = vi.fn();
  const renderToolCalls = ["chart", "meeting"].map((name) =>
    defineToolCallRenderer({
      name,
      args: z.object({ value: z.number() }),
      render: ({ args, result, status, toolCallId }) => (
        <div data-testid={`${name}-${args.value}`}>
          {name} {args.value} {toolCallId} {status} {result}
        </div>
      ),
    }),
  );
  const view = renderWithCopilotKit({
    agent,
    renderToolCalls,
    frontendTools: [
      { name: "chart", parameters: z.object({ value: z.number() }), handler },
    ],
    children: <Capture />,
  });
  return { agent, handler, getCore: () => core, ...view };
}
afterEach(cleanup);

describe("public CopilotChat child history replay", () => {
  it.each(["Allow", "Deny", "Cancel"])(
    "keeps completed nested/parallel UI after %s and remount/replay without execution",
    async (action) => {
      const first = setup();
      const errors: string[] = [];
      first.getCore().ɵchildHistories.subscribe(() => {
        const error = first
          .getCore()
          .ɵchildHistories.get(first.agent, first.agent.threadId).error;
        if (error) errors.push(error);
      });
      await act(async () => {
        await first.agent.runAgent({ runId: "import" });
      });
      expect(errors).toEqual([]);
      expect(
        first.getCore().ɵchildHistories.get(first.agent, first.agent.threadId)
          .histories,
      ).toHaveLength(3);
      expect((await screen.findByTestId("chart-1")).textContent).toContain(
        "Saved result 1",
      );
      expect(screen.getByTestId("meeting-2").textContent).toContain(
        "Saved result 2",
      );
      expect(screen.getByTestId("chart-3").textContent).toContain(
        "Saved result 3",
      );
      expect(
        within(screen.getByRole("region", { name: "Child 1" })).getByRole(
          "region",
          { name: "Child 3" },
        ),
      ).toBeDefined();
      expect(screen.queryByTestId("chart-8")).toBeNull();
      fireEvent.click(
        await screen.findByRole("button", { name: `${action} child` }),
      );
      const expected =
        action === "Allow"
          ? '{"approved":true}'
          : action === "Deny"
            ? '{"approved":false}'
            : "cancelled";
      await waitFor(() =>
        expect(screen.getByTestId("chart-8").textContent).toContain(expected),
      );
      expect(screen.getAllByTestId("chart-8")).toHaveLength(1);
      expect(screen.queryByRole("button", { name: "Allow child" })).toBeNull();
      expect(first.handler).not.toHaveBeenCalled();
      expect(first.agent.inputs).toHaveLength(2);
      expect(
        first.agent.inputs[1]?.messages.some(
          (m) => m.id === "same-assistant-id",
        ),
      ).toBe(false);
      const saved = [...first.agent.saved];
      first.unmount();

      // New agent/provider models a cold browser reload; replay is the only data source.
      const reloaded = new ChildHistoryFixtureAgent();
      reloaded.saved.push(...saved);
      const second = setup(reloaded);
      await act(async () => {
        await reloaded.connectAgent({ runId: "replay" });
      });
      expect((await screen.findByTestId("chart-8")).textContent).toContain(
        expected,
      );
      expect(screen.getAllByTestId("chart-1")).toHaveLength(1);
      expect(screen.getAllByTestId("meeting-2")).toHaveLength(1);
      expect(screen.getAllByTestId("chart-3")).toHaveLength(1);
      expect(screen.queryByRole("button", { name: "Allow child" })).toBeNull();
      expect(second.handler).not.toHaveBeenCalled();
      expect(reloaded.inputs).toHaveLength(0);
    },
  );
});
