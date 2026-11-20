import { afterEach, describe, expect, it, vi } from "vitest";
import { SURFACE_ID, renderSurface } from "../../../__tests__/render";
import {
  buttonNamed,
  byLabel,
  byText,
  click,
  query,
} from "../../../__tests__/dom";
import { standardUI } from "../../index";
import { keyDown, renderInputs, sentEventNames, setValue } from "./helpers";
import type { View } from "./helpers";

describe("standard inputs: events", () => {
  const button = (view: View, text: string) => {
    const buttons = [...view.container.querySelectorAll("button")];
    const match = buttons.find((b) => b.textContent?.trim() === text);
    if (!match) throw new Error(`No button "${text}".`);
    return match;
  };

  it("renders Button text when label is not set, and prefers label", () => {
    const view = renderInputs([
      { id: "root", component: "Column", children: ["a", "b"] },
      { id: "a", component: "Button", text: "Request quote" },
      { id: "b", component: "Button", label: "Send", text: "Ignored" },
    ]);
    expect(button(view, "Request quote")).toBeTruthy();
    expect(button(view, "Send")).toBeTruthy();
    expect(view.container.textContent).not.toContain("Ignored");
  });

  it("sends a bound Button event with its context read from the data model at click time", async () => {
    const view = renderInputs(
      [
        { id: "root", component: "Column", children: ["f", "b"] },
        {
          id: "f",
          component: "TextField",
          label: "Email",
          value: { "@path": "/form/email" },
        },
        {
          id: "b",
          component: "Button",
          label: "Subscribe",
          onClick: {
            event: {
              name: "subscribe",
              context: { email: { "@path": "/form/email" }, source: "footer" },
            },
          },
        },
      ],
      { form: { email: "" } },
    );
    setValue(
      view,
      byLabel<HTMLInputElement>(view.container, "Email"),
      "ada@example.com",
    );
    click(view, button(view, "Subscribe"));
    await Promise.resolve();
    expect(view.forwardEvent).toHaveBeenCalledTimes(1);
    expect(view.forwardEvent.mock.calls[0]![0]).toEqual({
      name: "subscribe",
      surfaceId: SURFACE_ID,
      componentId: "b",
      timestamp: expect.any(String),
      context: { email: "ada@example.com", source: "footer" },
    });
  });

  it("applies the accessibility envelope to a field and to a CheckBox", () => {
    const view = renderInputs([
      { id: "root", component: "Column", children: ["f", "c"] },
      {
        id: "f",
        component: "TextField",
        label: "Email",
        accessibility: { label: "Contact email", description: "Work address" },
      },
      {
        id: "c",
        component: "CheckBox",
        label: "Terms",
        accessibility: { hidden: true },
      },
    ]);
    const group = query(
      view.container,
      '[role=group][aria-label="Contact email"]',
    );
    expect(group.getAttribute("aria-description")).toBe("Work address");
    // The control itself carries the name: ARIA names do not inherit.
    const field = byLabel<HTMLInputElement>(view.container, "Email");
    expect(field.getAttribute("aria-label")).toBe("Contact email");
    expect(field.getAttribute("aria-description")).toBe("Work address");
    expect(group.contains(field)).toBe(true);
    const box = byLabel<HTMLInputElement>(view.container, "Terms");
    expect(box.closest("[aria-hidden]")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });

  it("names a Button by the accessibility label of its envelope", () => {
    const view = renderInputs([
      {
        id: "root",
        component: "Button",
        label: "Go",
        accessibility: { label: "Send the order", description: "Final step" },
      },
    ]);
    const go = query<HTMLButtonElement>(view.container, "button");
    expect(go.getAttribute("aria-label")).toBe("Send the order");
    expect(go.getAttribute("aria-description")).toBe("Final step");
    expect(go.textContent?.trim()).toBe("Go");
  });

  it("does not send the event of a disabled Button", async () => {
    const view = renderInputs([
      {
        id: "root",
        component: "Button",
        label: "Nope",
        disabled: true,
        onClick: { event: { name: "nope" } },
      },
    ]);
    const nope = button(view, "Nope");
    expect(nope.disabled).toBe(true);
    click(view, nope);
    await Promise.resolve();
    expect(view.forwardEvent).not.toHaveBeenCalled();
  });

  it("sends only the Form onSubmit when a submit Button inside the Form is clicked", async () => {
    const view = renderInputs(
      [
        {
          id: "root",
          component: "Form",
          label: "Signup",
          children: ["f", "b"],
          onSubmit: {
            event: {
              name: "signup",
              context: { email: { "@path": "/form/email" } },
            },
          },
        },
        {
          id: "f",
          component: "TextField",
          label: "Email",
          value: { "@path": "/form/email" },
        },
        {
          id: "b",
          component: "Button",
          label: "Send",
          submit: true,
          onClick: { event: { name: "button-click" } },
        },
      ],
      { form: { email: "" } },
    );
    const form = query<HTMLFormElement>(view.container, "form");
    expect(form.getAttribute("aria-label")).toBe("Signup");
    setValue(
      view,
      byLabel<HTMLInputElement>(view.container, "Email"),
      "ada@example.com",
    );
    const send = button(view, "Send");
    expect(send.type).toBe("submit");
    click(view, send);
    await Promise.resolve();
    expect(sentEventNames(view)).toEqual(["signup"]);
    expect(view.forwardEvent.mock.calls[0]![0].context).toEqual({
      email: "ada@example.com",
    });
  });

  it("sends the onClick of a submit Button that is outside of a Form", async () => {
    const view = renderInputs([
      {
        id: "root",
        component: "Button",
        label: "Lone",
        submit: true,
        onClick: { event: { name: "lone-submit" } },
      },
    ]);
    click(view, button(view, "Lone"));
    await Promise.resolve();
    expect(sentEventNames(view)).toEqual(["lone-submit"]);
  });

  it("sends only the innermost event when a control inside a Pressable is used", async () => {
    const view = renderInputs([
      {
        id: "root",
        component: "Pressable",
        children: ["inner", "b"],
        onClick: { event: { name: "outer" } },
      },
      {
        id: "inner",
        component: "Pressable",
        children: ["t"],
        onClick: { event: { name: "inner" } },
      },
      { id: "t", component: "Label", text: "Inner" },
      {
        id: "b",
        component: "Button",
        label: "Click",
        onClick: { event: { name: "button" } },
      },
    ]);
    click(view, button(view, "Click"));
    click(view, query(view.container, "[data-testid=label]"));
    await Promise.resolve();
    expect(sentEventNames(view)).toEqual(["button", "inner"]);
  });

  it("presses a Pressable with Enter, but not when Enter is on a Button inside it", async () => {
    const view = renderInputs([
      {
        id: "root",
        component: "Pressable",
        children: ["b"],
        onClick: { event: { name: "outer" } },
      },
      {
        id: "b",
        component: "Button",
        label: "Key",
        onClick: { event: { name: "button" } },
      },
    ]);
    const pressable = query<HTMLElement>(view.container, "[role=button]");
    expect(pressable.tabIndex).toBe(0);
    keyDown(view, button(view, "Key"), "Enter");
    await Promise.resolve();
    expect(view.forwardEvent).not.toHaveBeenCalled();
    keyDown(view, pressable, "Enter");
    await Promise.resolve();
    expect(sentEventNames(view)).toEqual(["outer"]);
  });

  it("Pressable tooltip, ariaPressed and insetBorder apply", () => {
    const view = renderInputs([
      {
        id: "root",
        component: "Pressable",
        tooltip: "More",
        ariaPressed: true,
        insetBorder: true,
        children: ["t"],
      },
      { id: "t", component: "Label", text: "Toggle" },
    ]);
    const pressable = query<HTMLElement>(view.container, "[role=button]");
    expect(pressable.getAttribute("title")).toBe("More");
    expect(pressable.getAttribute("aria-pressed")).toBe("true");
    expect(pressable.style.boxShadow).toContain("inset 0 0 0 1px");
  });

  it("Select shows clearLabel on the empty option, an icon and full width", () => {
    const view = renderInputs([
      {
        id: "root",
        component: "Select",
        label: "Plan",
        clearable: true,
        clearLabel: "Any plan",
        icon: "search",
        block: true,
        options: ["team"],
      },
    ]);
    const select = byLabel<HTMLSelectElement>(view.container, "Plan");
    expect(select.options[0]!.textContent).toBe("Any plan");
    expect(select.style.width).toBe("100%");
    expect(select.style.paddingLeft).not.toBe("");
  });
});

describe("Button and Pressable client-side verbs", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.querySelector(".cdk-overlay-container")?.remove();
  });

  it("Button with href opens the URL in a new tab and does not dispatch", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const v = renderSurface(standardUI, [
      {
        id: "root",
        component: "Button",
        label: "Docs",
        href: "https://docs.copilotkit.ai",
        onClick: { event: { name: "never" } },
      },
    ]);
    v.act(() => buttonNamed(v.container, "Docs")!.click());
    expect(open).toHaveBeenCalledWith(
      "https://docs.copilotkit.ai",
      "_blank",
      "noopener,noreferrer",
    );
    await Promise.resolve();
    expect(v.forwardEvent).not.toHaveBeenCalled();
  });

  it("Button with href ignores unsafe schemes", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const v = renderSurface(standardUI, [
      {
        id: "root",
        component: "Button",
        label: "Bad",
        href: "javascript:alert(1)",
      },
    ]);
    v.act(() => buttonNamed(v.container, "Bad")!.click());
    expect(open).not.toHaveBeenCalled();
  });

  it("Button with copy writes to the clipboard and shows a check", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const v = renderSurface(standardUI, [
      { id: "root", component: "Button", label: "Copy code", copy: "ABC-123" },
    ]);
    const button = buttonNamed(v.container, "Copy code")!;
    v.act(() => button.click());
    expect(writeText).toHaveBeenCalledWith("ABC-123");
    await vi.waitFor(() => {
      v.detectChanges();
      expect(button.hasAttribute("data-a2ui-copied")).toBe(true);
    });
    expect(button.querySelector("svg")).not.toBeNull();
  });

  it("Pressable with href opens the URL", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const v = renderSurface(standardUI, [
      {
        id: "root",
        component: "Pressable",
        href: "https://copilotkit.ai",
        children: ["t"],
      },
      { id: "t", component: "Text", text: "Go" },
    ]);
    v.act(() =>
      byText(v.container, "Go").closest<HTMLElement>("[role=button]")!.click(),
    );
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe("Button icons", () => {
  it("sizes the icon with the button scale and hides it from screen readers", () => {
    const view = renderSurface(standardUI, [
      { id: "root", component: "Column", children: ["b", "s"] },
      {
        id: "b",
        component: "Button",
        label: "Search",
        icon: "search",
        accessibility: { label: "Find a product" },
      },
      {
        id: "s",
        component: "Select",
        label: "Plan",
        icon: "search",
        options: ["a"],
        accessibility: { label: "Pick a plan" },
      },
    ]);
    const wrapper = view.container.querySelector<HTMLElement>(
      'button [data-icon="search"]',
    )!;
    expect(wrapper.getAttribute("aria-hidden")).toBe("true");
    const svg = wrapper.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("18");
    // The Select's icon must not take the Select's envelope label.
    const selectIcon = view.container
      .querySelector("select")!
      .parentElement!.querySelector("svg")!;
    expect(selectIcon.closest('[aria-hidden="true"]')).not.toBeNull();
  });
});

describe("Button styles", () => {
  it("renders primary buttons with token colours, not literals", () => {
    const v = renderSurface(standardUI, [
      {
        id: "root",
        component: "Button",
        label: "Go",
        variant: "primary",
        onClick: { event: { name: "go" } },
      },
    ]);
    const button = byText(v.container, "Go").closest("button")!;
    expect(button.style.color).toBe("var(--a2ui-color-on-accent, #fff)");
    expect(button.style.minHeight).toBe("36px");
  });
});
