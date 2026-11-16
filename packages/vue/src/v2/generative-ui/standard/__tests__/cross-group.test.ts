import { fireEvent, waitFor } from "@testing-library/vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { A2UIComponentNode } from "@copilotkit/shared";
import { STANDARD_CSS } from "@copilotkit/shared/generative-ui";
import { renderSurface } from "../../__tests__/helpers/render-surface";
import { standardUI } from "../index";

// The cases that need components of more than one group. Each group suite
// renders its own components with test-only stand-ins for the others, so it
// left these cases out. Here they render through the real `standardUI`.
//
// Sources, with the React names kept word for word:
// - React `layout-parity.test.tsx`: "Badge, Caption, Label, Divider, Spacer,
//   Blockquote, Code, Link, Markdown render" and "centres Row children by
//   default and keeps text from stretching".
// - React `inputs-parity.test.tsx`: "ListItem action inside a Pressable
//   dispatches only the ListItem action" (also skipped by the data group)
//   and "renders primary buttons and solid badges with token colours, not
//   literals" (the input group ported its Button half on its own).
// - React `data-media-parity.test.tsx`: "Table renders columns and rows,
//   List renders items".
// - React `composites.test.tsx`: "toggles a Popover when its trigger is a
//   Button". The feedback suite runs it with a stand-in Button; the real
//   Button stops the propagation of its click.
// - React `composites.test.tsx` and Angular `button.spec.ts`: "Button with
//   copy writes to the clipboard and shows a check", with the svg check
//   that the input group left out.
// - Angular `button.spec.ts`: "Button icons".
//
// Ported in other files: the bindings cases for the Chart, the List,
// FollowUp and ImageGrid are in `literal-bindings.test.ts`. The group
// suites already port "Italic, Underline and Strikethrough render as inline
// elements", "Blockquote renders inline markdown in its text", "Text
// fontSize, lineHeight and minLines" and the tooltip parity case (text),
// the two Popover cases and PulseIndicator (feedback), "Table rows and
// columns resolve from data paths" (table), and the CarouselMediaItem,
// Image lightbox and other Button and Pressable cases of React's
// `composites.test.tsx` (layout, media and inputs).
//
// The lucide icons load from the real lucide-vue-next, so the icon checks
// wait for the svg.

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const render = (
  components: A2UIComponentNode[],
  data?: Record<string, unknown>,
) => renderSurface(standardUI, components, data);

/** `element` as an HTMLElement. Fails the test when it is missing. */
function htmlElement(element: Element | null | undefined) {
  if (!(element instanceof HTMLElement)) throw new Error("No element.");
  return element;
}

describe("standard catalog: layout and text (parity)", () => {
  it("Badge, Caption, Label, Divider, Spacer, Blockquote, Code, Link, Markdown render", async () => {
    const v = render([
      {
        id: "root",
        component: "Column",
        children: ["b", "c", "l", "d", "s", "q", "k", "a", "m"],
      },
      { id: "b", component: "Badge", label: "New", color: "success" },
      { id: "c", component: "Caption", text: "cap" },
      { id: "l", component: "Label", text: "lab" },
      { id: "d", component: "Divider" },
      { id: "s", component: "Spacer", minSize: 8 },
      { id: "q", component: "Blockquote", text: "quote" },
      { id: "k", component: "Code", text: "x = 1" },
      {
        id: "a",
        component: "Link",
        text: "docs",
        href: "https://copilotkit.ai",
      },
      { id: "m", component: "Markdown", text: "# H\n\n- one" },
    ]);
    expect(await v.findByText("New")).toBeTruthy();
    expect(v.getByText("quote").closest("blockquote")).not.toBeNull();
    expect(v.getByText("docs").getAttribute("href")).toBe(
      "https://copilotkit.ai",
    );
    expect(v.getByText("x = 1").closest("pre")).not.toBeNull();
    expect(v.container.querySelector("hr")).not.toBeNull();
    await waitFor(() =>
      expect(v.container.querySelector("h1")?.textContent).toBe("H"),
    );
    expect(v.container.querySelector("li")?.textContent).toBe("one");
  });

  it("centres Row children by default and keeps text from stretching", async () => {
    const v = render([
      { id: "root", component: "Column", children: ["r1", "r2"] },
      {
        id: "r1",
        component: "Row",
        justify: "spaceBetween",
        children: ["k", "val"],
      },
      { id: "k", component: "Text", text: "Price" },
      { id: "val", component: "Text", text: "$29.00", tabularNums: true },
      { id: "r2", component: "Row", align: "start", children: ["s"] },
      { id: "s", component: "Text", text: "top" },
    ]);
    const value = await v.findByText("$29.00");
    const row = htmlElement(value.parentElement);
    expect(row.style.alignItems).toBe("center");
    expect(row.dataset.a2uiRow).toBe("spaceBetween");
    expect(value.style.flex).toBe("0 1 auto");
    expect(value.style.minWidth).toMatch(/^0(px)?$/);
    expect(value.style.width).toBe("");
    expect(value.style.fontVariantNumeric).toBe("tabular-nums");
    expect(
      htmlElement((await v.findByText("top")).parentElement).style.alignItems,
    ).toBe("flex-start");
    expect(STANDARD_CSS).toContain(
      '[data-a2ui-row="spaceBetween"]>[data-a2ui-text]:last-child:not(:first-child){text-align:right',
    );
  });
});

describe("standard catalog: inputs (parity)", () => {
  it("ListItem action inside a Pressable dispatches only the ListItem action", async () => {
    const v = render([
      {
        id: "root",
        component: "Pressable",
        children: ["li"],
        onClick: { event: { name: "outer-a" } },
      },
      {
        id: "li",
        component: "ListItem",
        label: "Row",
        action: { event: { name: "item-a" } },
      },
    ]);
    await fireEvent.click(await v.findByText("Row"));
    expect(v.forwardEvent).toHaveBeenCalledTimes(1);
    expect(v.forwardEvent.mock.calls[0]?.[0].name).toBe("item-a");
  });

  it("renders primary buttons and solid badges with token colours, not literals", async () => {
    const v = render([
      { id: "root", component: "Column", children: ["b", "g"] },
      {
        id: "b",
        component: "Button",
        label: "Go",
        variant: "primary",
        onClick: { event: { name: "go" } },
      },
      { id: "g", component: "Badge", label: "New", variant: "solid" },
    ]);
    const button = htmlElement((await v.findByText("Go")).closest("button"));
    expect(button.style.color).toBe("var(--a2ui-color-on-accent, #fff)");
    const badge = htmlElement(v.getByText("New").closest("span"));
    expect(badge.style.color).toBe("var(--a2ui-color-on-accent, #fff)");
  });
});

describe("standard catalog: data and media (parity)", () => {
  it("Table renders columns and rows, List renders items", async () => {
    const v = render([
      { id: "root", component: "Column", children: ["t", "l"] },
      {
        id: "t",
        component: "Table",
        columns: ["Feature", "Team"],
        rows: [
          ["Price", "$29/seat"],
          ["Seats", "Custom"],
        ],
      },
      {
        id: "l",
        component: "List",
        items: ["one", { label: "two", description: "second" }],
        marker: "number",
      },
    ]);
    expect(await v.findByText("$29/seat")).toBeTruthy();
    expect(v.container.querySelectorAll("th").length).toBe(2);
    expect(v.getByText("second")).toBeTruthy();
    expect(v.container.querySelector("ol")).not.toBeNull();
  });
});

describe("Image lightbox and Popover trigger", () => {
  it("toggles a Popover when its trigger is a Button", async () => {
    const v = render([
      { id: "root", component: "Popover", children: ["t", "c"] },
      { id: "t", component: "PopoverTrigger", children: ["b"] },
      { id: "b", component: "Button", label: "Open", variant: "default" },
      { id: "c", component: "PopoverContent", children: ["x"] },
      { id: "x", component: "Text", text: "Popover body" },
    ]);
    await v.findByText("Open");
    // The trigger wrapper is a button too, so target the inner <button>.
    const button = htmlElement(
      v.container.querySelector("[data-a2ui-popover-trigger] button"),
    );
    expect(v.queryByText("Popover body")).toBeNull();
    await fireEvent.click(button);
    expect(v.getByText("Popover body")).not.toBeNull();
    await fireEvent.click(button);
    expect(v.queryByText("Popover body")).toBeNull();
  });
});

describe("Button and Pressable client-side verbs", () => {
  it("Button with copy writes to the clipboard and shows a check", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const v = render([
      { id: "root", component: "Button", label: "Copy code", copy: "ABC-123" },
    ]);
    const button = await v.findByRole("button", { name: "Copy code" });
    await fireEvent.click(button);
    expect(writeText).toHaveBeenCalledWith("ABC-123");
    await waitFor(() =>
      expect(button.hasAttribute("data-a2ui-copied")).toBe(true),
    );
    await waitFor(() =>
      expect(button.querySelector('[data-icon="check"] svg')).not.toBeNull(),
    );
  });
});

describe("Button icons", () => {
  it("sizes the icon with the button scale and hides it from screen readers", async () => {
    const view = render([
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
    const wrapper = htmlElement(
      await waitFor(() =>
        view.container.querySelector('button [data-icon="search"]'),
      ),
    );
    expect(wrapper.getAttribute("aria-hidden")).toBe("true");
    const svg = await waitFor(() => {
      const icon = wrapper.querySelector("svg");
      if (!icon) throw new Error("The Button icon has not loaded.");
      return icon;
    });
    expect(svg.getAttribute("width")).toBe("18");
    // The Select's icon must not take the Select's envelope label.
    const select = htmlElement(view.container.querySelector("select"));
    const selectIcon = htmlElement(select.parentElement).querySelector("svg");
    expect(selectIcon?.closest('[aria-hidden="true"]')).not.toBeNull();
  });
});

describe("cross-group (Vue-specific semantics)", () => {
  it("ListItem shows its icon in the leading marker, hidden from screen readers", async () => {
    const v = render([
      { id: "root", component: "List", children: ["li"] },
      { id: "li", component: "ListItem", label: "Inbox", icon: "inbox" },
    ]);
    await v.findByText("Inbox");
    const svg = await waitFor(() => {
      const icon = v.container.querySelector("svg.lucide-inbox");
      if (!icon) throw new Error("The ListItem icon has not loaded.");
      return icon;
    });
    expect(svg.getAttribute("width")).toBe("16");
    expect(svg.parentElement?.getAttribute("aria-hidden")).toBe("true");
  });

  it("Select shows its icon at 16px before the value", async () => {
    const v = render([
      {
        id: "root",
        component: "Select",
        label: "Plan",
        icon: "search",
        options: ["team"],
      },
    ]);
    await v.findByLabelText("Plan");
    const svg = await waitFor(() => {
      const icon = v.container.querySelector("svg.lucide-search");
      if (!icon) throw new Error("The Select icon has not loaded.");
      return icon;
    });
    expect(svg.getAttribute("width")).toBe("16");
  });
});
