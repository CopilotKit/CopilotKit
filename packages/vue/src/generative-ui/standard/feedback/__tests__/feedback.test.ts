import { fireEvent, render, waitFor } from "@testing-library/vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSSRApp, defineComponent, h, nextTick, ref } from "vue";
import type { PropType } from "vue";
import { renderToString } from "vue/server-renderer";
import { z } from "zod";
import type { A2UIComponentNode } from "@copilotkit/shared";
import { themeStyleSheet } from "@copilotkit/shared/generative-ui";
import { createGenerativeUI } from "../../../catalog";
import {
  SURFACE_ID,
  createRuntimeProvider,
  createTestRuntime,
  renderSurface,
} from "../../../__tests__/helpers/render-surface";
import type { GenerativeUIEventProp } from "../../context";
import Lightbox from "../../Lightbox.vue";
import {
  CopilotGenerativeUIModal,
  FEEDBACK_STYLE_ID,
  feedbackComponents,
} from "../index";

// The React suite renders some cases with the full standard catalog
// (Column, Text, Button, Pressable, Image, Icon). Those components belong
// to other groups, so this file uses test-only stand-ins with the same
// markup that the feedback components react to: a native button, a div
// with the button role, and an image that opens the shared Lightbox.

/** Test-only leaves, so the feedback tests need no other group. */
const Label = defineComponent({
  props: { text: { type: String, required: true } },
  template: `<span>{{ text }}</span>`,
});
const Group = defineComponent({
  template: `<div><slot name="children" /></div>`,
});
/** A native button, like the standard Button: it sends its own event. */
const Button = defineComponent({
  props: {
    label: { type: String, required: true },
    disabled: { type: Boolean, default: false },
    onClick: Function as PropType<GenerativeUIEventProp>,
  },
  template: `<button type="button" :disabled="disabled" @click="onClick?.({})">{{ label }}</button>`,
});
/** A div with the button role, like the standard Pressable. */
const Pressable = defineComponent({
  props: { disabled: { type: Boolean, default: false } },
  template: `<div role="button" :tabindex="disabled ? -1 : 0" :aria-disabled="disabled ? 'true' : undefined"><slot name="children" /></div>`,
});
/** An image that opens the shared Lightbox on click, like the standard Image. */
const Picture = defineComponent({
  components: { Lightbox },
  props: {
    url: { type: String, required: true },
    description: { type: String, required: true },
  },
  setup() {
    return { isZoomed: ref(false) };
  },
  template: `
    <img :src="url" :alt="description" @click="isZoomed = true" />
    <Lightbox
      v-if="isZoomed"
      :images="[{ src: url, alt: description }]"
      @close="isZoomed = false"
    />
  `,
});

const ui = createGenerativeUI({
  id: "test/feedback@1",
  components: {
    ...feedbackComponents,
    Label: { component: Label, props: z.object({ text: z.string() }) },
    Group: { component: Group, slots: { children: "multiple" } },
    Button: {
      component: Button,
      props: z.object({
        label: z.string(),
        disabled: z.boolean().optional(),
      }),
      events: { onClick: { parameters: z.object({}) } },
    },
    Pressable: {
      component: Pressable,
      props: z.object({ disabled: z.boolean().optional() }),
      slots: { children: "multiple" },
    },
    Picture: {
      component: Picture,
      props: z.object({ url: z.string(), description: z.string() }),
    },
  },
});

/** The `open` prop of a Popover: a literal, or a data model binding. */
type PopoverOpen = { open?: boolean | { "@path": string } };

/** A Popover with an "Open" trigger and a "Hidden content" body. */
function popoverNodes(popover: PopoverOpen = {}): A2UIComponentNode[] {
  return [
    { id: "root", component: "Group", children: ["o", "outside"] },
    { id: "o", component: "Popover", children: ["pt", "pc"], ...popover },
    { id: "pt", component: "PopoverTrigger", children: ["tt"] },
    { id: "tt", component: "Label", text: "Open" },
    { id: "pc", component: "PopoverContent", children: ["cc"] },
    { id: "cc", component: "Label", text: "Hidden content" },
    { id: "outside", component: "Label", text: "Outside" },
  ];
}

/** The Popover nodes, with hover opening after `hoverOpenDelay` ms. */
function hoverPopoverNodes() {
  return popoverNodes().map((node) =>
    node.id === "o"
      ? { ...node, showOnHover: true, hoverOpenDelay: 200 }
      : node,
  );
}

async function renderPopover(popover: PopoverOpen = {}) {
  const view = renderSurface(ui, popoverNodes(popover));
  const trigger = (await view.findByText("Open")).closest("button");
  if (!trigger) throw new Error("The trigger is not a button.");
  return { view, trigger };
}

/** A Modal with a `trigger` node and a `content` node. */
function modalNode(fields: Partial<A2UIComponentNode> = {}): A2UIComponentNode {
  return {
    id: "root",
    component: "Modal",
    title: "Off",
    trigger: "t",
    content: "c",
    ...fields,
  };
}

/** The Modal trigger wrapper around `element`. */
function modalTrigger(element: Element) {
  const wrapper = element.closest<HTMLElement>("[data-a2ui-modal-trigger]");
  if (!wrapper) throw new Error("The element is not in a Modal trigger.");
  return wrapper;
}

/** Lets the trigger observer and Vue settle, as React's `act` does. */
async function settle() {
  await Promise.resolve();
  await nextTick();
}

const lightbox = () => document.querySelector("[data-a2ui-lightbox]");
const pressEscape = () => fireEvent.keyDown(document, { key: "Escape" });

afterEach(() => {
  vi.useRealTimers();
});

describe("feedbackComponents", () => {
  it("is valid input for createGenerativeUI, with a description for every component", () => {
    const names = Object.keys(feedbackComponents);
    expect(names).toEqual([
      "PulseIndicator",
      "FlashcardFlip",
      "Popover",
      "PopoverTrigger",
      "PopoverContent",
      "Modal",
    ]);
    for (const name of names) {
      expect(ui.manifestComponents[name]?.description).toMatch(/\S/);
    }
    for (const name of ["Popover", "PopoverTrigger", "PopoverContent"]) {
      expect(ui.manifestComponents[name]?.slots).toEqual({
        children: "multiple",
      });
    }
    expect(ui.manifestComponents.FlashcardFlip?.slots).toBeUndefined();
  });
});

describe("Modal", () => {
  it("opens from the keyboard when the trigger is plain text, and keeps a Button trigger as the only control", async () => {
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
    const plain = modalTrigger(await view.findByText("Open one"));
    await settle();
    expect(plain.getAttribute("role")).toBe("button");
    expect(plain.getAttribute("tabindex")).toBe("0");
    await fireEvent.keyDown(plain, { key: "Enter" });
    const dialog = await view.findByRole("dialog");
    expect(dialog.textContent).toContain("Body one");
    expect(dialog.getAttribute("aria-labelledby")).toBe(
      dialog.querySelector("h2")?.id,
    );
    await pressEscape();
    await settle();
    expect(view.queryByRole("dialog")).toBeNull();

    const buttoned = modalTrigger(
      view.getByRole("button", { name: "Open two" }),
    );
    expect(buttoned.getAttribute("role")).toBeNull();
    expect(buttoned.getAttribute("tabindex")).toBeNull();
  });

  it("does not open when the trigger is a disabled Pressable", async () => {
    const view = renderSurface(ui, [
      modalNode(),
      { id: "t", component: "Pressable", disabled: true, children: ["l"] },
      { id: "l", component: "Label", text: "Press" },
      { id: "c", component: "Label", text: "Body" },
    ]);
    const label = await view.findByText("Press");
    const wrapper = modalTrigger(label);
    await settle();
    expect(wrapper.getAttribute("role")).toBeNull();
    await fireEvent.click(label);
    await fireEvent.keyDown(wrapper, { key: "Enter" });
    expect(view.queryByRole("dialog")).toBeNull();
  });

  it("does not open from the keyboard when the trigger is a disabled Button", async () => {
    const view = renderSurface(ui, [
      modalNode(),
      { id: "t", component: "Button", label: "Open", disabled: true },
      { id: "c", component: "Label", text: "Body" },
    ]);
    const wrapper = modalTrigger(
      await view.findByRole("button", { name: "Open" }),
    );
    await settle();
    expect(wrapper.getAttribute("role")).toBeNull();
    expect(wrapper.getAttribute("tabindex")).toBeNull();
    await fireEvent.keyDown(wrapper, { key: "Enter" });
    await fireEvent.keyDown(wrapper, { key: " " });
    expect(view.queryByRole("dialog")).toBeNull();
  });

  it("closes only the newest overlay on Escape: a lightbox inside the dialog first, then the dialog", async () => {
    const view = renderSurface(ui, [
      modalNode({ title: "Pics", content: "img" }),
      { id: "t", component: "Label", text: "Open" },
      {
        id: "img",
        component: "Picture",
        url: "https://example.com/a.png",
        description: "A",
      },
    ]);
    await fireEvent.click(await view.findByText("Open"));
    const dialog = await view.findByRole("dialog");
    await fireEvent.click(await view.findByAltText("A"));
    await settle();
    expect(lightbox()).not.toBeNull();
    await pressEscape();
    await settle();
    expect(lightbox()).toBeNull();
    expect(document.body.contains(dialog)).toBe(true);
    await pressEscape();
    await settle();
    expect(view.queryByRole("dialog")).toBeNull();
  });

  it("lets a Button trigger send its own event while the dialog opens", async () => {
    const view = renderSurface(ui, [
      modalNode({ title: "Two" }),
      {
        id: "t",
        component: "Button",
        label: "Open",
        onClick: { event: { name: "opened" } },
      },
      { id: "c", component: "Label", text: "Body" },
    ]);
    await fireEvent.click(await view.findByRole("button", { name: "Open" }));
    const dialog = await view.findByRole("dialog");
    expect(dialog.textContent).toContain("Body");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    // The overlay is portaled to the body, outside any transformed row, and
    // keeps the surface style scope.
    expect(view.container.contains(dialog)).toBe(false);
    expect(dialog.closest(".a2ui-surface")).not.toBeNull();
    await waitFor(() =>
      expect(view.forwardEvent).toHaveBeenCalledWith(
        expect.objectContaining({ name: "opened" }),
        expect.anything(),
      ),
    );
    // A click on the backdrop closes it.
    const backdrop = dialog.closest("[data-a2ui-modal-backdrop]");
    if (!backdrop) throw new Error("The dialog has no backdrop.");
    await fireEvent.click(backdrop);
    expect(view.queryByRole("dialog")).toBeNull();
  });

  it("writes the open state to a bound data path", async () => {
    const view = renderSurface(
      ui,
      [
        modalNode({ title: "Bound", open: { "@path": "/open" } }),
        { id: "t", component: "Label", text: "Open" },
        { id: "c", component: "Label", text: "Body" },
      ],
      { open: false },
    );
    await fireEvent.click(await view.findByText("Open"));
    expect(await view.findByRole("dialog")).toBeTruthy();
    expect(view.dataAt("/open")).toBe(true);
    await view.update({
      version: "1.0",
      updateDataModel: { surfaceId: SURFACE_ID, path: "/tick", value: 1 },
    });
    expect(view.queryByRole("dialog")).not.toBeNull();
  });
});

describe("standard feedback", () => {
  it("names a PopoverTrigger by its envelope", async () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Popover", children: ["t", "c"] },
      {
        id: "t",
        component: "PopoverTrigger",
        children: ["i"],
        accessibility: { label: "More options" },
      },
      { id: "i", component: "Label", text: "..." },
      { id: "c", component: "PopoverContent", children: ["x"] },
      { id: "x", component: "Label", text: "Options" },
    ]);
    await view.findByRole("button", { name: "More options" });
  });

  it("applies the envelope of a Modal to its dialog, which is a portal", async () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Group", children: ["m"] },
      {
        id: "m",
        component: "Modal",
        title: "Terms",
        open: true,
        trigger: "t",
        content: "c",
        accessibility: { label: "Terms of service", live: "polite" },
      },
      { id: "t", component: "Button", label: "Open" },
      { id: "c", component: "Label", text: "Body" },
    ]);
    const dialog = await view.findByRole("dialog", {
      name: "Terms of service",
    });
    expect(dialog.getAttribute("aria-live")).toBe("polite");
    expect(dialog.hasAttribute("aria-labelledby")).toBe(false);
  });

  it("renders the feedback and overlay components", async () => {
    const view = renderSurface(ui, [
      {
        id: "root",
        component: "Group",
        children: ["p", "f", "o"],
      },
      { id: "p", component: "PulseIndicator" },
      { id: "f", component: "FlashcardFlip", front: "Q", back: "A" },
      { id: "o", component: "Popover", children: ["pt", "pc"] },
      { id: "pt", component: "PopoverTrigger", children: ["tt"] },
      { id: "tt", component: "Label", text: "Open" },
      { id: "pc", component: "PopoverContent", children: ["cc"] },
      { id: "cc", component: "Label", text: "Hidden content" },
    ]);
    expect(await view.findByText("Q")).toBeTruthy();
    expect(view.queryByText("Hidden content")).toBeNull();
    await fireEvent.click(view.getByText("Open"));
    expect(await view.findByText("Hidden content")).toBeTruthy();
  });

  it("names a PulseIndicator only when it has a label", async () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Group", children: ["a", "b"] },
      { id: "a", component: "PulseIndicator", label: "Live" },
      { id: "b", component: "PulseIndicator" },
    ]);
    expect(await view.findByRole("img", { name: "Live" })).toBeTruthy();
    expect(view.getAllByRole("img")).toHaveLength(1);
    const silent = view.container.querySelector('[aria-hidden="true"]');
    expect(silent?.querySelector("[data-a2ui-pulse]")).not.toBeNull();
  });

  it("keeps a pulse under reduced motion, as a fade without growth", async () => {
    const view = renderSurface(ui, [
      { id: "root", component: "PulseIndicator", label: "Live", size: 20 },
    ]);
    const pulse = await view.findByRole("img", { name: "Live" });
    expect(pulse.style.width).toBe("20px");
    const ring = pulse.querySelector<HTMLElement>("[data-a2ui-pulse]");
    expect(ring?.style.animation).toContain("a2ui-pulse 1500ms");
    const css = document.getElementById(FEEDBACK_STYLE_ID)?.textContent;
    expect(css).toContain(
      "@media (prefers-reduced-motion: reduce){[data-a2ui-pulse]{animation-name:a2ui-pulse-fade !important}}",
    );
    expect(css).toContain("@keyframes a2ui-pulse-fade{0%{opacity:");
  });

  it("PulseIndicator takes endScale and startOpacity", async () => {
    const view = renderSurface(ui, [
      {
        id: "root",
        component: "PulseIndicator",
        label: "Live",
        endScale: 3,
        startOpacity: 0.4,
      },
    ]);
    const pulse = await view.findByRole("img", { name: "Live" });
    const ring = pulse.querySelector<HTMLElement>("[data-a2ui-motion]");
    expect(ring?.style.getPropertyValue("--a2ui-pulse-scale")).toBe("3");
    expect(ring?.style.getPropertyValue("--a2ui-pulse-opacity")).toBe("0.4");
  });

  it("Popover sideOffset moves the content and a block trigger fills the width", async () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Popover", children: ["t", "c"] },
      { id: "t", component: "PopoverTrigger", block: true, children: ["b"] },
      { id: "b", component: "Label", text: "Toggle" },
      { id: "c", component: "PopoverContent", sideOffset: 12, children: ["x"] },
      { id: "x", component: "Label", text: "Body" },
    ]);
    const trigger = (await view.findByText("Toggle")).closest<HTMLElement>(
      "[data-a2ui-popover-trigger]",
    );
    if (!trigger) throw new Error("The trigger is missing.");
    expect(trigger.style.width).toBe("100%");
    await fireEvent.click(trigger);
    const dialog = await view.findByRole("dialog");
    expect(dialog.style.marginTop).toBe("12px");
  });
});

describe("FlashcardFlip", () => {
  const cardNodes = [
    {
      id: "root",
      component: "FlashcardFlip",
      front: "Q",
      back: "A",
      hint: "Click to flip",
    },
  ];

  it("flips to the back on click, and back to the front on a second click", async () => {
    const view = renderSurface(ui, cardNodes);
    const card = await view.findByRole("button", { pressed: false });
    expect(card.textContent).toBe("QClick to flip");
    await fireEvent.click(card);
    expect(card.getAttribute("aria-pressed")).toBe("true");
    expect(card.textContent).toBe("A");
    await fireEvent.click(card);
    expect(card.textContent).toBe("QClick to flip");
  });

  it("flips with the Enter and Space keys", async () => {
    const view = renderSurface(ui, cardNodes);
    const card = await view.findByRole("button", { pressed: false });
    // A native button: the browser turns Enter and Space into a click.
    // jsdom has no activation behavior (and this package has no
    // user-event), so the test sends that click itself.
    expect(card.getAttribute("type")).toBe("button");
    card.focus();
    await fireEvent.keyDown(card, { key: "Enter" });
    await fireEvent.click(card);
    expect(card.textContent).toBe("A");
    await fireEvent.keyUp(card, { key: " " });
    await fireEvent.click(card);
    expect(card.textContent).toBe("QClick to flip");
  });
});

describe("Popover", () => {
  it("opens a dialog named by its trigger, and closes on a second click", async () => {
    const { view, trigger } = await renderPopover();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    await fireEvent.click(trigger);
    const dialog = await view.findByRole("dialog", { name: "Open" });
    expect(dialog.textContent).toBe("Hidden content");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.getAttribute("aria-controls")).toBe(dialog.id);
    await fireEvent.click(trigger);
    expect(view.queryByRole("dialog")).toBeNull();
  });

  it("closes on Escape and moves focus back to the trigger", async () => {
    const { view, trigger } = await renderPopover({ open: true });
    const dialog = await view.findByRole("dialog");
    dialog.tabIndex = -1;
    dialog.focus();
    await fireEvent.keyDown(dialog, { key: "Escape" });
    expect(view.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes on a pointer press outside of it", async () => {
    const { view, trigger } = await renderPopover();
    await fireEvent.click(trigger);
    await view.findByRole("dialog");
    await fireEvent.pointerDown(view.getByText("Hidden content"));
    expect(view.queryByRole("dialog")).not.toBeNull();
    await fireEvent.pointerDown(view.getByText("Outside"));
    expect(view.queryByRole("dialog")).toBeNull();
  });

  it("writes the open state to a bound data path", async () => {
    const view = renderSurface(
      ui,
      popoverNodes({ open: { "@path": "/menuOpen" } }),
      { menuOpen: false },
    );
    await fireEvent.click(await view.findByText("Open"));
    expect(await view.findByRole("dialog")).toBeTruthy();
    expect(view.dataAt("/menuOpen")).toBe(true);
  });

  it("Popover with showOnHover and hoverOpenDelay opens after the delay", async () => {
    vi.useFakeTimers();
    const view = renderSurface(ui, hoverPopoverNodes());
    const popover = view.container.querySelector<HTMLElement>(
      "[data-a2ui-popover-trigger]",
    )?.parentElement;
    if (!popover) throw new Error("The Popover is missing.");
    await fireEvent.mouseEnter(popover);
    expect(view.queryByRole("dialog")).toBeNull();
    vi.advanceTimersByTime(200);
    await nextTick();
    expect(view.queryByRole("dialog")).not.toBeNull();
    await fireEvent.mouseLeave(popover);
    expect(view.queryByRole("dialog")).toBeNull();
  });

  it("drops a pending hover open when the Popover is removed", async () => {
    vi.useFakeTimers();
    const view = renderSurface(ui, hoverPopoverNodes());
    const popover = view.container.querySelector<HTMLElement>(
      "[data-a2ui-popover-trigger]",
    )?.parentElement;
    if (!popover) throw new Error("The Popover is missing.");
    const timers = vi.getTimerCount();
    await fireEvent.mouseEnter(popover);
    expect(vi.getTimerCount()).toBe(timers + 1);
    await view.update({
      version: "1.0",
      updateComponents: {
        surfaceId: SURFACE_ID,
        components: [{ id: "root", component: "Group", children: ["outside"] }],
      },
    });
    expect(
      view.container.querySelector("[data-a2ui-popover-trigger]"),
    ).toBeNull();
    expect(vi.getTimerCount()).toBe(timers);
  });
});

describe("Popover trigger", () => {
  it("toggles a Popover when its trigger is a Button", async () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Popover", children: ["t", "c"] },
      { id: "t", component: "PopoverTrigger", children: ["b"] },
      { id: "b", component: "Button", label: "Open" },
      { id: "c", component: "PopoverContent", children: ["x"] },
      { id: "x", component: "Label", text: "Popover body" },
    ]);
    // The trigger wrapper is a button too, so target the inner <button>.
    const button = (await view.findByText("Open")).closest("button");
    if (!button) throw new Error("The Button is missing.");
    expect(view.queryByText("Popover body")).toBeNull();
    await fireEvent.click(button);
    expect(view.queryByText("Popover body")).not.toBeNull();
    await fireEvent.click(button);
    expect(view.queryByText("Popover body")).toBeNull();
  });
});

describe("Vue-specific semantics", () => {
  const ModalHost = defineComponent({
    components: { CopilotGenerativeUIModal },
    template: `
      <CopilotGenerativeUIModal title="Local">
        <template #trigger><span>Open</span></template>
        <template #content><button type="button">First</button><button type="button">Last</button></template>
      </CopilotGenerativeUIModal>
    `,
  });

  it("keeps the open state locally when nothing binds v-model:open", async () => {
    const view = render(ModalHost);
    await settle();
    await fireEvent.click(view.getByText("Open"));
    expect(await view.findByRole("dialog", { name: "Local" })).toBeTruthy();
    await fireEvent.click(view.getByRole("button", { name: "Close" }));
    expect(view.queryByRole("dialog")).toBeNull();
  });

  it("moves the focus into the dialog, cycles Tab inside it, and returns the focus on close", async () => {
    const view = render(ModalHost);
    await settle();
    const trigger = modalTrigger(view.getByText("Open"));
    trigger.focus();
    await fireEvent.keyDown(trigger, { key: "Enter" });
    await view.findByRole("dialog");
    const close = view.getByRole("button", { name: "Close" });
    const last = view.getByRole("button", { name: "Last" });
    expect(document.activeElement).toBe(close);
    last.focus();
    await fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    await fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
    await pressEscape();
    expect(view.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("renders only the trigger on the server, also when open", async () => {
    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(
            CopilotGenerativeUIModal,
            { title: "Server", open: true },
            {
              trigger: () => h("span", "Open"),
              content: () => h("p", "Body"),
            },
          ),
      }),
    );
    expect(html).toContain("Open");
    expect(html).not.toContain("Body");
    expect(html).not.toContain('role="dialog"');
  });

  it("gives the teleported dialog the theme stylesheet id that the surface root has", async () => {
    const { runtime } = createTestRuntime(ui);
    runtime.theme = { "--a2ui-color-accent": "#d97706" };
    const Provider = createRuntimeProvider(runtime);
    const view = render(
      defineComponent({
        components: { Provider, ModalHost },
        template: `<Provider><ModalHost /></Provider>`,
      }),
    );
    await settle();
    await fireEvent.click(view.getByText("Open"));
    const portal = (await view.findByRole("dialog")).closest(".a2ui-surface");
    const themeId = portal?.getAttribute("data-a2ui-theme");
    expect(themeId).toMatch(/\S/);
    expect(themeId).toBe(themeStyleSheet(runtime.theme)?.id);
  });
});
