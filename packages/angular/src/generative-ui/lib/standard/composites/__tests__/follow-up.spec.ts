import { describe, expect, it, vi } from "vitest";
import { renderSurface } from "../../../__tests__/render";
import { buttonNamed, ui } from "./helpers";

describe("standard catalog: composites", () => {
  it("FollowUp dispatches the item's message as an action", async () => {
    const v = renderSurface(ui, [
      {
        id: "root",
        component: "FollowUp",
        title: "Next",
        items: [
          "Cheaper version",
          { label: "Luxury", message: "Make it luxury" },
        ],
        onFollowUp: { event: { name: "follow_up" } },
      },
    ]);
    expect(v.container.textContent).toContain("Next");
    v.act(() => buttonNamed(v.container, "Luxury")!.click());
    await vi.waitFor(() => expect(v.forwardEvent).toHaveBeenCalledTimes(1));
    const event = v.forwardEvent.mock.calls[0]![0];
    expect(event.name).toBe("follow_up");
    expect(event.context).toMatchObject({ message: "Make it luxury" });
  });

  it("FollowUp sends its message without an onFollowUp binding", async () => {
    const v = renderSurface(ui, [
      { id: "root", component: "FollowUp", items: ["Make it cheaper"] },
    ]);
    v.act(() => buttonNamed(v.container, "Make it cheaper")!.click());
    await vi.waitFor(() => expect(v.forwardEvent).toHaveBeenCalledTimes(1));
    expect(v.forwardEvent.mock.calls[0]![0]).toMatchObject({
      name: "follow_up",
      componentId: "root",
      userMessage: "Make it cheaper",
      context: { message: "Make it cheaper" },
    });
  });

  it("FollowUp hides itself without items", () => {
    const v = renderSurface(ui, [{ id: "root", component: "FollowUp" }]);
    const host = v.container.querySelector<HTMLElement>(
      "[data-a2ui-follow-up]",
    )!;
    expect(host.style.display).toBe("none");
  });
});
