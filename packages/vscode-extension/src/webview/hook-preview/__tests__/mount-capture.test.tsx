import { describe, it, expect, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { CopilotKit } from "@copilotkit/react-core";
import { RegistryReader } from "../harness/registry-reader";
import { invokeRender } from "../adapters";
import type { CapturedRegistry } from "../harness/registry";
import TodoActions from "../../../../test-workspace/hooks/TodoActions";

type CapturedAction = { name: string; render: (props: unknown) => unknown };

describe("end-to-end: mount real host, capture config, invoke render", () => {
  it("captures addTodo action and invokes its render with mock args", async () => {
    const onCapture = vi.fn();
    render(
      <CopilotKit runtimeUrl="https://mock.local/api">
        <RegistryReader onCapture={onCapture} />
        <TodoActions />
      </CopilotKit>,
    );

    // Wait for the host's registration effect + the reader's deferred capture
    // to publish a registry that contains addTodo. Returning the resolved
    // value from waitFor (rather than mutating an outer-scope variable)
    // keeps the happy-path value stable across retries.
    const addTodo = await waitFor<CapturedAction>(() => {
      const latest: CapturedRegistry | undefined =
        onCapture.mock.calls.at(-1)?.[0];
      const found = latest?.renderToolCalls?.find((r) => r.name === "addTodo");
      expect(found).toBeDefined();
      expect(typeof (found as { render?: unknown }).render).toBe("function");
      return found as CapturedAction;
    });

    const ui = invokeRender("action", addTodo, {
      args: { text: "buy milk" },
      status: "complete",
      result: "done",
      onRespond: vi.fn(),
    });

    const { getByTestId } = render(<div>{ui as React.ReactNode}</div>);
    expect(getByTestId("add-todo-render").textContent).toMatch(/buy milk/);
  });
});
