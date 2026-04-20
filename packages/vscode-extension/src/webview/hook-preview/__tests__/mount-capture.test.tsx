import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { RegistryReader } from "../harness/registry-reader";
import { invokeRender } from "../adapters";
import { createCopilotkitStubs } from "../copilotkit-stubs";
import type {
  CapturedRegistry,
  CapturedRenderToolCall,
} from "../harness/registry";

/**
 * End-to-end sanity check for the stub-based capture flow. Mirrors what
 * happens in the webview at runtime: the IIFE external resolves every
 * `@copilotkit/react-core` import to `__copilotkit_deps.copilotkitStubs`,
 * which captures each hook call into `window.__copilotkit_captured`.
 *
 * We can't dynamic-import the real fixture here (vitest doesn't apply the
 * IIFE's alias config), so we inline a local twin of TodoActions that calls
 * the stubs directly.
 */
function findCapturedAction(
  reg: CapturedRegistry | undefined,
  name: string,
): CapturedRenderToolCall | undefined {
  return reg?.renderToolCalls.find((r) => r.name === name);
}

describe("stub-based capture → render invocation", () => {
  beforeEach(() => {
    delete (window as unknown as { __copilotkit_captured?: unknown[] })
      .__copilotkit_captured;
  });

  it("captures two actions and invokes the addTodo render with mock args", async () => {
    const stubs = createCopilotkitStubs() as Record<
      string,
      (config: unknown) => void
    >;

    function TodoActionsTwin() {
      stubs.useCopilotAction({
        name: "addTodo",
        description: "Add a todo item",
        parameters: [{ name: "text", type: "string", required: true }],
        available: "frontend",
        render: ({ args, status }: { args?: { text?: string }; status: string }) => (
          <div data-testid="add-todo-render">
            Add: {args?.text} ({status})
          </div>
        ),
      });
      stubs.useCopilotAction({
        name: "removeTodo",
        description: "Remove a todo",
        parameters: [{ name: "id", type: "string", required: true }],
        available: "frontend",
        render: ({ args }: { args?: { id?: string } }) => (
          <div data-testid="remove-todo-render">Remove: {args?.id}</div>
        ),
      });
      return null;
    }

    const onCapture = vi.fn();
    render(
      <>
        <TodoActionsTwin />
        <RegistryReader onCapture={onCapture} />
      </>,
    );

    const addTodo = await waitFor<CapturedRenderToolCall>(() => {
      const latest = onCapture.mock.calls.at(-1)?.[0] as
        | CapturedRegistry
        | undefined;
      const found = findCapturedAction(latest, "addTodo");
      expect(found).toBeDefined();
      expect(typeof found!.render).toBe("function");
      return found!;
    });

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
