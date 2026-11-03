import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/vue";
import { ToolCallStatus } from "@copilotkit/core";
import { OpenGenerativeUIToolRenderer } from "../OpenGenerativeUIRenderer";

function toolProps(messages: string[], status = ToolCallStatus.InProgress) {
  return {
    name: "generateSandboxedUi",
    args: { placeholderMessages: [...messages] },
    status,
  };
}

describe("OpenGenerativeUIToolRenderer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("keeps rotating while streamed snapshots repeat the same messages", async () => {
    const view = render(OpenGenerativeUIToolRenderer, {
      props: toolProps(["Sketching", "Styling"]),
    });
    expect(view.container.textContent).toBe("Styling");

    await vi.advanceTimersByTimeAsync(4000);
    await view.rerender(toolProps(["Sketching", "Styling"]));
    await vi.advanceTimersByTimeAsync(1000);

    expect(view.container.textContent).toBe("Sketching");
  });

  it("renders nothing once the tool call is complete", async () => {
    const view = render(OpenGenerativeUIToolRenderer, {
      props: toolProps(["Sketching"]),
    });
    await view.rerender(toolProps(["Sketching"], ToolCallStatus.Complete));
    expect(view.container.textContent).toBe("");
  });
});
