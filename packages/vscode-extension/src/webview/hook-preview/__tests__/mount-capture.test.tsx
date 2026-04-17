import { describe, it, expect, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { CopilotKit } from "@copilotkit/react-core";
import { RegistryReader } from "../harness/registry-reader";
import { invokeRender } from "../adapters";
import type {
  CapturedRegistry,
  CapturedRenderToolCall,
} from "../harness/registry";
import TodoActions from "../../../../test-workspace/hooks/TodoActions";

function findCapturedAction(
  reg: CapturedRegistry | undefined,
  name: string,
): CapturedRenderToolCall | undefined {
  return reg?.renderToolCalls.find((r) => r.name === name);
}

describe("end-to-end: mount real host, capture config, invoke render", () => {
  it("captures addTodo + removeTodo and invokes addTodo's render with mock args", async () => {
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
    const addTodo = await waitFor<CapturedRenderToolCall>(() => {
      const latest = onCapture.mock.calls.at(-1)?.[0] as
        | CapturedRegistry
        | undefined;
      const found = findCapturedAction(latest, "addTodo");
      expect(found).toBeDefined();
      expect(typeof found!.render).toBe("function");
      return found!;
    });

    // Also verify the registry captured both actions registered in TodoActions.tsx
    // — locks in that the reader doesn't miss later registrations from the
    // same component's effect.
    const latest = onCapture.mock.calls.at(-1)?.[0] as
      | CapturedRegistry
      | undefined;
    expect(findCapturedAction(latest, "removeTodo")).toBeDefined();

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
