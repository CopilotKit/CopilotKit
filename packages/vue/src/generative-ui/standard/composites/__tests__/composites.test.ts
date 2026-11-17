import { fireEvent, waitFor } from "@testing-library/vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSSRApp, defineComponent, h, provide, shallowRef } from "vue";
import { renderToString } from "vue/server-renderer";
import { z } from "zod";
import type {
  A2UIComponentNode,
  GenerativeUISurfaceContent,
} from "@copilotkit/shared";
import { createGenerativeUI } from "../../../catalog";
import { GenerativeUIRuntimeKey } from "../../../runtime-context";
import { SurfaceView } from "../../../SurfaceView";
import {
  createTestRuntime,
  renderSurface,
  SURFACE_ID,
} from "../../../__tests__/helpers/render-surface";
import { compositeComponents } from "../index";

// React renders these cases with `standardUI`. The Citation case needs a Row
// and a Text, which other groups own, so two small stand-ins take their
// place, as Angular's `testComponents` do.
const TestRow = defineComponent({
  template: `<div style="display: flex"><slot name="children" /></div>`,
});
const TestText = defineComponent({
  props: { text: String, inline: Boolean },
  template: `<span>{{ text }}</span>`,
});

const ui = createGenerativeUI({
  id: "test/composites@1",
  components: {
    ...compositeComponents,
    Row: { component: TestRow, slots: { children: "multiple" } },
    Text: {
      component: TestText,
      props: z.object({
        text: z.string().optional(),
        inline: z.boolean().optional(),
      }),
    },
  },
});

const render = (components: A2UIComponentNode[]) =>
  renderSurface(ui, components);

const lightbox = () => document.querySelector("[data-a2ui-lightbox]");
const shownSrc = () => lightbox()?.querySelector("img")?.getAttribute("src");

/** Stops `window.open` from opening anything, and records its calls. */
const spyOnOpen = () => vi.spyOn(window, "open").mockImplementation(() => null);

afterEach(() => {
  vi.restoreAllMocks();
});

// Not ported from React's `composites.test.tsx`: the CarouselMediaItem,
// "Image lightbox and Popover trigger" and "Button and Pressable
// client-side verbs" cases. Those components belong to the media, layout
// and inputs groups, and their suites port those cases.

describe("compositeComponents", () => {
  it("is valid input for createGenerativeUI, with a description for every component", () => {
    const names = Object.keys(compositeComponents);
    expect(names).toEqual([
      "LinkCard",
      "Citation",
      "FollowUp",
      "EntityCard",
      "ImageGrid",
    ]);
    for (const name of names) {
      expect(ui.manifestComponents[name]?.description).toMatch(/\S/);
    }
    expect(ui.manifestComponents.FollowUp?.events).toHaveProperty("onFollowUp");
  });
});

describe("standard catalog: composites", () => {
  it("LinkCard renders a new-tab link with domain, title and description", async () => {
    const v = render([
      {
        id: "root",
        component: "LinkCard",
        href: "https://docs.copilotkit.ai/a2ui",
        title: "A2UI markdown mode",
        description: "Render surfaces from fences.",
      },
    ]);
    const card = (await v.findByText("A2UI markdown mode")).closest("a")!;
    expect(card.getAttribute("href")).toBe("https://docs.copilotkit.ai/a2ui");
    expect(card.getAttribute("target")).toBe("_blank");
    expect(card.getAttribute("rel")).toBe("noopener noreferrer");
    expect(v.getByText("docs.copilotkit.ai")).not.toBeNull();
    expect(v.getByText("Render surfaces from fences.")).not.toBeNull();
    expect(card.querySelector("img")?.getAttribute("src")).toContain(
      "favicons?domain=docs.copilotkit.ai",
    );
  });

  it("LinkCard with a bound onClick is a button that sends the event", async () => {
    const v = render([
      {
        id: "root",
        component: "LinkCard",
        href: "https://docs.copilotkit.ai",
        title: "Docs",
        onClick: { event: { name: "open_docs" } },
      },
    ]);
    await fireEvent.click(await v.findByRole("button", { name: /Docs/ }));
    expect(v.container.querySelector("a")).toBeNull();
    await waitFor(() => expect(v.forwardEvent).toHaveBeenCalledTimes(1));
    expect(v.forwardEvent.mock.calls[0]![0].name).toBe("open_docs");
  });

  it("Citation shows its source on click", async () => {
    const v = render([
      { id: "root", component: "Row", children: ["t", "c"] },
      {
        id: "t",
        component: "Text",
        text: "Vienna has 1.9M people",
        inline: true,
      },
      {
        id: "c",
        component: "Citation",
        index: 2,
        title: "Vienna population",
        url: "https://en.wikipedia.org/wiki/Vienna",
        snippet: "1.9 million inhabitants",
      },
    ]);
    const marker = await v.findByRole("button", { name: "Source 2" });
    expect(marker.textContent?.trim()).toBe("2");
    expect(v.queryByText("Vienna population")).toBeNull();
    await fireEvent.click(marker);
    expect(v.getByText("Vienna population")).not.toBeNull();
    expect(v.getByText("1.9 million inhabitants")).not.toBeNull();
    expect(v.getByText("Open source").getAttribute("href")).toBe(
      "https://en.wikipedia.org/wiki/Vienna",
    );
    expect(v.getByRole("dialog").textContent).toContain("en.wikipedia.org");
    expect(marker.getAttribute("aria-expanded")).toBe("true");
    await fireEvent.mouseDown(document.body);
    expect(v.queryByRole("dialog")).toBeNull();
  });

  it("FollowUp dispatches the item's message as an action", async () => {
    const v = render([
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
    await fireEvent.click(await v.findByRole("button", { name: "Luxury" }));
    expect(v.getByText("Next")).not.toBeNull();
    await waitFor(() => expect(v.forwardEvent).toHaveBeenCalledTimes(1));
    const event = v.forwardEvent.mock.calls[0]![0];
    expect(event.name).toBe("follow_up");
    expect(event.context).toMatchObject({ message: "Make it luxury" });
  });

  it("FollowUp sends its message without an onFollowUp binding", async () => {
    const v = render([
      {
        id: "root",
        component: "FollowUp",
        items: ["Make it cheaper"],
      },
    ]);
    await fireEvent.click(
      await v.findByRole("button", { name: "Make it cheaper" }),
    );
    expect(v.forwardEvent).toHaveBeenCalledTimes(1);
    expect(v.forwardEvent.mock.calls[0]![0]).toMatchObject({
      name: "follow_up",
      componentId: "root",
      userMessage: "Make it cheaper",
      context: { message: "Make it cheaper" },
    });
  });

  it("EntityCard renders title, meta, badge, rating and action buttons", async () => {
    const v = render([
      {
        id: "root",
        component: "EntityCard",
        title: "Café Central",
        subtitle: "Coffee house",
        description: "Grand historic café.",
        meta: "Open until 22:00",
        badge: { label: "Popular", color: "success" },
        rating: 4.5,
        ratingCount: 1200,
        actions: [{ label: "Pick" }],
        onAction: { event: { name: "pick" } },
      },
    ]);
    expect(await v.findByText("Café Central")).not.toBeNull();
    expect(v.getByText("Open until 22:00")).not.toBeNull();
    expect(v.getByText("Popular")).not.toBeNull();
    expect(v.getByLabelText("4.5 out of 5")).not.toBeNull();
    expect(v.getByText("(1200)")).not.toBeNull();
    expect(v.queryByRole("link")).toBeNull();
    await fireEvent.click(v.getByRole("button", { name: "Pick" }));
    await waitFor(() => expect(v.forwardEvent).toHaveBeenCalledTimes(1));
    const event = v.forwardEvent.mock.calls[0]![0];
    expect(event.name).toBe("pick");
    expect(event.context).toMatchObject({ label: "Pick" });
  });

  it("EntityCard with href opens the page and a button with href opens its URL", async () => {
    const open = spyOnOpen();
    const v = render([
      {
        id: "root",
        component: "EntityCard",
        title: "Sacher",
        href: "https://sacher.example",
        layout: "horizontal",
        image: "https://sacher.example/img.png",
        actions: [{ label: "Directions", href: "https://maps.example" }],
      },
    ]);
    await fireEvent.click(await v.findByRole("button", { name: "Directions" }));
    expect(open).toHaveBeenLastCalledWith(
      "https://maps.example",
      "_blank",
      "noopener,noreferrer",
    );
    const card = v.getByRole("link");
    expect(card.getAttribute("tabindex")).toBe("0");
    expect(card.style.flexDirection).toBe("row");
    expect(v.getByAltText("Sacher")).not.toBeNull();
    await fireEvent.click(card);
    expect(open).toHaveBeenLastCalledWith(
      "https://sacher.example",
      "_blank",
      "noopener,noreferrer",
    );
    await fireEvent.keyDown(card, { key: "Enter" });
    expect(open).toHaveBeenCalledTimes(3);
    expect(v.forwardEvent).not.toHaveBeenCalled();
  });

  it("ImageGrid renders every image and opens the lightbox on click", async () => {
    const v = render([
      {
        id: "root",
        component: "ImageGrid",
        layout: "bento",
        images: [
          { url: "https://example.com/1.png", description: "one" },
          {
            url: "https://example.com/2.png",
            description: "two",
            caption: "Two",
          },
          { url: "https://example.com/3.png", description: "three" },
        ],
      },
    ]);
    const first = await v.findByAltText("one");
    expect(v.getAllByRole("img")).toHaveLength(3);
    expect(v.getByText("Two")).not.toBeNull();
    const grid = v.container.querySelector<HTMLElement>(
      "[data-a2ui-image-grid]",
    )!;
    expect(grid.style.gridTemplateColumns).toBe("repeat(3, minmax(0, 1fr))");
    expect(first.closest("figure")?.style.gridRow).toBe("span 2");
    await fireEvent.click(first);
    expect(shownSrc()).toBe("https://example.com/1.png");
    await fireEvent.click(lightbox()!);
    expect(lightbox()).toBeNull();
  });

  it("ImageGrid lightbox walks through all images with the arrows and keys", async () => {
    const v = render([
      {
        id: "root",
        component: "ImageGrid",
        images: [
          { url: "https://example.com/1.png", description: "one" },
          { url: "https://example.com/2.png", description: "two" },
          { url: "https://example.com/3.png", description: "three" },
        ],
      },
    ]);
    await fireEvent.click(await v.findByAltText("two"));
    expect(shownSrc()).toBe("https://example.com/2.png");
    expect(lightbox()!.textContent).toContain("2 / 3");
    await fireEvent.click(
      lightbox()!.querySelector("[data-a2ui-lightbox-arrow=next]")!,
    );
    expect(shownSrc()).toBe("https://example.com/3.png");
    await fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(shownSrc()).toBe("https://example.com/1.png");
    await fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(shownSrc()).toBe("https://example.com/3.png");
    await fireEvent.keyDown(document, { key: "Escape" });
    expect(lightbox()).toBeNull();
  });

  // From Angular's `image-grid.spec.ts`; React has no such case.
  it("ImageGrid opens the href of an image instead of the lightbox", async () => {
    const open = spyOnOpen();
    const v = render([
      {
        id: "root",
        component: "ImageGrid",
        images: [
          { url: "https://example.com/1.png", href: "https://example.com" },
        ],
      },
    ]);
    await fireEvent.click(await v.findByRole("img"));
    expect(open).toHaveBeenCalledWith(
      "https://example.com",
      "_blank",
      "noopener,noreferrer",
    );
    expect(lightbox()).toBeNull();
  });
});

describe("Vue-specific semantics", () => {
  // Angular keeps an empty host element with `display: none` for this
  // ("FollowUp hides itself without items"). Vue renders nothing, as React.
  it("FollowUp and ImageGrid render nothing without items", async () => {
    const v = render([
      { id: "root", component: "Row", children: ["t", "f", "g"] },
      { id: "t", component: "Text", text: "Ready" },
      { id: "f", component: "FollowUp" },
      { id: "g", component: "ImageGrid", images: [] },
    ]);
    await v.findByText("Ready");
    expect(v.container.querySelector("[data-a2ui-follow-up]")).toBeNull();
    expect(v.container.querySelector("[data-a2ui-image-grid]")).toBeNull();
  });

  it("LinkCard shows the favicon unless favicon is false", async () => {
    const v = render([
      { id: "root", component: "Row", children: ["on", "off"] },
      {
        id: "on",
        component: "LinkCard",
        href: "https://a.example",
        title: "A",
      },
      {
        id: "off",
        component: "LinkCard",
        href: "https://b.example",
        title: "B",
        favicon: false,
      },
    ]);
    const shown = (await v.findByText("A")).closest("a")!;
    const hidden = v.getByText("B").closest("a")!;
    expect(shown.querySelector("img")).not.toBeNull();
    expect(hidden.querySelector("img")).toBeNull();
    expect(v.getByText("b.example")).not.toBeNull();
  });

  it("LinkCard turns from a link into a button when the agent binds onClick", async () => {
    const v = render([
      {
        id: "root",
        component: "LinkCard",
        href: "https://docs.copilotkit.ai",
        title: "Docs",
      },
    ]);
    expect((await v.findByText("Docs")).closest("a")).not.toBeNull();
    await v.update({
      version: "1.0",
      updateComponents: {
        surfaceId: SURFACE_ID,
        components: [
          {
            id: "root",
            component: "LinkCard",
            href: "https://docs.copilotkit.ai",
            title: "Docs",
            onClick: { event: { name: "open_docs" } },
          },
        ],
      },
    });
    const button = v.getByRole("button", { name: /Docs/ });
    expect(button.getAttribute("href")).toBeNull();
    expect(v.container.querySelector("a")).toBeNull();
  });

  it("Citation opens on hover and closes when the pointer leaves", async () => {
    const v = render([
      { id: "root", component: "Citation", label: "wiki", title: "Vienna" },
    ]);
    const marker = await v.findByRole("button", { name: "Source wiki" });
    const citation = marker.closest<HTMLElement>("[data-a2ui-citation]")!;
    await fireEvent.mouseEnter(citation);
    expect(v.getByRole("dialog").textContent).toContain("Vienna");
    await fireEvent.mouseLeave(citation);
    expect(v.queryByRole("dialog")).toBeNull();
  });

  it("ImageGrid gives its lightbox the live region of the envelope", async () => {
    const v = render([
      {
        id: "root",
        component: "ImageGrid",
        accessibility: { live: "polite" },
        images: [{ url: "https://example.com/1.png", description: "one" }],
      },
    ]);
    await fireEvent.click(await v.findByAltText("one"));
    expect(lightbox()?.getAttribute("aria-live")).toBe("polite");
  });

  it("server-renders every composite", async () => {
    const { runtime } = createTestRuntime(ui);
    const content: GenerativeUISurfaceContent = {
      surfaceId: SURFACE_ID,
      target: "inline",
      catalogId: ui.id,
      operations: [
        {
          version: "1.0",
          createSurface: { surfaceId: SURFACE_ID, catalogId: ui.id },
        },
        {
          version: "1.0",
          updateComponents: {
            surfaceId: SURFACE_ID,
            components: [
              {
                id: "root",
                component: "Row",
                children: ["link", "cite", "follow", "entity", "grid"],
              },
              {
                id: "link",
                component: "LinkCard",
                href: "https://a.example",
                title: "Link title",
              },
              { id: "cite", component: "Citation", index: 3 },
              { id: "follow", component: "FollowUp", items: ["Again"] },
              {
                id: "entity",
                component: "EntityCard",
                title: "Entity title",
                rating: 4,
              },
              {
                id: "grid",
                component: "ImageGrid",
                images: [{ url: "https://example.com/1.png" }],
              },
            ],
          },
        },
      ],
      status: "streaming",
      rejected: [],
    };
    runtime.manager.ingest("thread", "default", content);
    const surface = runtime.manager.getSurface("thread", SURFACE_ID)!;
    const html = await renderToString(
      createSSRApp(
        defineComponent({
          setup() {
            provide(GenerativeUIRuntimeKey, shallowRef(runtime));
            return () => h(SurfaceView, { surface });
          },
        }),
      ),
    );
    expect(html).toContain("Link title");
    expect(html).toContain('aria-label="Source 3"');
    expect(html).toContain("Again");
    expect(html).toContain('aria-label="4 out of 5"');
    expect(html).toContain('src="https://example.com/1.png"');
  });
});
