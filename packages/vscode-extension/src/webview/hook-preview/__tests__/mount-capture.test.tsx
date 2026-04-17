import { describe, it, expect, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { CopilotKit } from "@copilotkit/react-core";
import { RegistryReader } from "../harness/registry-reader";
import { invokeRender } from "../adapters";
import type { CapturedRegistry } from "../harness/registry";
import TodoActions from "../../../../test-workspace/hooks/TodoActions";

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
    // to publish a registry that contains addTodo.
    let addTodo: { render?: unknown; [k: string]: unknown } | undefined;
    await waitFor(() => {
      const latest: CapturedRegistry | undefined =
        onCapture.mock.calls.at(-1)?.[0];
      addTodo = latest?.renderToolCalls?.find((r) => r.name === "addTodo") as
        | { render?: unknown; [k: string]: unknown }
        | undefined;
      expect(addTodo).toBeDefined();
      expect(typeof addTodo!.render).toBe("function");
    });

    const ui = invokeRender("action", addTodo!, {
      args: { text: "buy milk" },
      status: "complete",
      result: "done",
      onRespond: vi.fn(),
    });

    const { getByTestId } = render(<div>{ui}</div>);
    expect(getByTestId("add-todo-render").textContent).toMatch(/buy milk/);
  });
});
