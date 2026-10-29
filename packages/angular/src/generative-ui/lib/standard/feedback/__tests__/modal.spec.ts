import { afterEach, describe, expect, it, vi } from "vitest";
import { renderSurface, updateDataModel } from "../../../__tests__/render";
import { standardUI } from "../../index";
import { byText, dialog, lightbox, press, settle, ui } from "./helpers";

afterEach(() => {
  vi.useRealTimers();
  document.querySelector(".cdk-overlay-container")?.remove();
});

describe("Modal", () => {
  it("opens from the keyboard when the trigger is plain text, and keeps a Button trigger as the only control", () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Group", children: ["m1", "m2"] },
      {
        id: "m1",
        component: "Modal",
        title: "One",
        trigger: "t1",
        content: "c1",
      },
      { id: "t1", component: "Label", text: "Open one" },
      { id: "c1", component: "Label", text: "Body one" },
      {
        id: "m2",
        component: "Modal",
        title: "Two",
        trigger: "t2",
        content: "c2",
      },
      { id: "t2", component: "Button", label: "Open two" },
      { id: "c2", component: "Label", text: "Body two" },
    ]);
    settle(view);
    const [plain, buttoned] = [
      ...view.container.querySelectorAll<HTMLElement>(
        "[data-a2ui-modal-trigger]",
      ),
    ];
    expect(plain!.getAttribute("role")).toBe("button");
    expect(plain!.getAttribute("tabindex")).toBe("0");
    expect(buttoned!.getAttribute("role")).toBeNull();
    expect(buttoned!.getAttribute("tabindex")).toBeNull();
    view.act(() => press(plain!, "Enter"));
    settle(view);
    expect(dialog()?.textContent).toContain("Body one");
    expect(dialog()?.getAttribute("aria-labelledby")).toBe(
      dialog()?.querySelector("h2")?.id,
    );
    view.act(() => press(dialog()!, "Escape"));
    settle(view);
    expect(dialog()).toBeNull();
  });

  it("applies the envelope of a Modal to its dialog, which is a portal", () => {
    const view = renderSurface(ui, [
      {
        id: "root",
        component: "Modal",
        title: "Terms",
        open: true,
        trigger: "t",
        content: "c",
        accessibility: { label: "Terms of service", live: "polite" },
      },
      { id: "t", component: "Label", text: "Open" },
      { id: "c", component: "Label", text: "Body" },
    ]);
    settle(view);
    const opened = dialog()!;
    expect(opened.getAttribute("aria-label")).toBe("Terms of service");
    expect(opened.getAttribute("aria-live")).toBe("polite");
    expect(opened.hasAttribute("aria-labelledby")).toBe(false);
  });

  it("writes the open state to a bound data path", () => {
    const view = renderSurface(
      ui,
      [
        {
          id: "root",
          component: "Modal",
          title: "Bound",
          open: { "@path": "/open" },
          trigger: "t",
          content: "c",
        },
        { id: "t", component: "Label", text: "Open" },
        { id: "c", component: "Label", text: "Body" },
      ],
      { open: false },
    );
    settle(view);
    view.act(() =>
      view.container
        .querySelector<HTMLElement>("[data-a2ui-modal-trigger]")!
        .click(),
    );
    settle(view);
    expect(dialog()).not.toBeNull();
    expect(view.dataAt("/open")).toBe(true);
    view.update(updateDataModel("/tick", 1));
    expect(dialog()).not.toBeNull();
  });
});

describe("Modal (standard catalog)", () => {
  it("does not open when the trigger is a disabled Pressable", () => {
    const view = renderSurface(standardUI, [
      {
        id: "root",
        component: "Modal",
        title: "Off",
        trigger: "t",
        content: "c",
      },
      { id: "t", component: "Pressable", disabled: true, children: ["l"] },
      { id: "l", component: "Text", text: "Press" },
      { id: "c", component: "Text", text: "Body" },
    ]);
    settle(view);
    const label = byText(view, "Press");
    const wrapper = label.closest<HTMLElement>("[data-a2ui-modal-trigger]")!;
    expect(wrapper.getAttribute("role")).toBeNull();
    view.act(() => label.click());
    view.act(() => press(wrapper, "Enter"));
    settle(view);
    expect(dialog()).toBeNull();
  });

  it("does not open from the keyboard when the trigger is a disabled Button", () => {
    const view = renderSurface(standardUI, [
      {
        id: "root",
        component: "Modal",
        title: "Off",
        trigger: "t",
        content: "c",
      },
      { id: "t", component: "Button", label: "Open", disabled: true },
      { id: "c", component: "Text", text: "Body" },
    ]);
    settle(view);
    const wrapper = view.container
      .querySelector("button")!
      .closest<HTMLElement>("[data-a2ui-modal-trigger]")!;
    expect(wrapper.getAttribute("role")).toBeNull();
    expect(wrapper.getAttribute("tabindex")).toBeNull();
    view.act(() => view.container.querySelector("button")!.click());
    view.act(() => press(wrapper, "Enter"));
    view.act(() => press(wrapper, " "));
    settle(view);
    expect(dialog()).toBeNull();
  });

  it("closes only the newest overlay on Escape: a lightbox inside the dialog first, then the dialog", () => {
    const view = renderSurface(standardUI, [
      {
        id: "root",
        component: "Modal",
        title: "Pics",
        trigger: "t",
        content: "img",
      },
      { id: "t", component: "Text", text: "Open" },
      {
        id: "img",
        component: "Image",
        url: "https://example.com/a.png",
        description: "A",
      },
    ]);
    settle(view);
    view.act(() => byText(view, "Open").click());
    settle(view);
    const opened = dialog()!;
    view.act(() =>
      opened.querySelector<HTMLImageElement>('img[alt="A"]')!.click(),
    );
    settle(view);
    expect(lightbox()).not.toBeNull();
    view.act(() => press(document.body, "Escape"));
    settle(view);
    expect(lightbox()).toBeNull();
    expect(document.body.contains(opened)).toBe(true);
    view.act(() => press(document.body, "Escape"));
    settle(view);
    expect(dialog()).toBeNull();
  });

  it("lets a Button trigger send its own event while the dialog opens", async () => {
    const view = renderSurface(standardUI, [
      {
        id: "root",
        component: "Modal",
        title: "Two",
        trigger: "t",
        content: "c",
      },
      {
        id: "t",
        component: "Button",
        label: "Open",
        onClick: { event: { name: "opened" } },
      },
      { id: "c", component: "Text", text: "Body" },
    ]);
    settle(view);
    view.act(() => view.container.querySelector("button")!.click());
    settle(view);
    const opened = dialog()!;
    expect(opened.textContent).toContain("Body");
    expect(opened.getAttribute("aria-modal")).toBe("true");
    // The overlay is portaled to the body, outside any transformed row, and
    // keeps the surface style scope.
    expect(view.container.contains(opened)).toBe(false);
    expect(opened.closest(".a2ui-surface")).not.toBeNull();
    await vi.waitFor(() =>
      expect(view.forwardEvent).toHaveBeenCalledWith(
        expect.objectContaining({ name: "opened" }),
        expect.anything(),
      ),
    );
    // A click on the backdrop closes it.
    view.act(() =>
      opened.closest<HTMLElement>("[data-a2ui-modal-backdrop]")!.click(),
    );
    settle(view);
    expect(dialog()).toBeNull();
  });
});
