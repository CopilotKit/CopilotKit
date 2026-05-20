import { describe, expect, it } from "vitest";
import { defineComponent, h, ref } from "vue";
import { render, waitFor } from "@testing-library/vue";
import { createA2UIMessageRenderer } from "../A2UIMessageRenderer";
import { CopilotKitKey } from "../../providers/keys";

function copilotKitProvide() {
  return {
    [CopilotKitKey as symbol]: {
      copilotkit: ref({
        properties: {},
        setProperties: () => undefined,
        runAgent: async () => undefined,
      }),
      executingToolCallIds: ref(new Set()),
      a2uiTheme: ref({}),
      a2uiCatalog: ref(undefined),
      a2uiLoadingComponent: ref(undefined),
      a2uiIncludeSchema: ref(true),
    },
  };
}

describe("createA2UIMessageRenderer", () => {
  it("returns loading state when no operations exist", () => {
    const renderer = createA2UIMessageRenderer({ theme: {} });
    const { getByTestId } = render(renderer.render, {
      props: {
        activityType: "a2ui-surface",
        content: {},
        message: {},
        agent: {},
      },
    });
    expect(getByTestId("a2ui-loading")).not.toBeNull();
  });

  it("default loading fallback renders header dot, 'Generating UI...' label, and three pulsing skeleton bars", () => {
    const renderer = createA2UIMessageRenderer({ theme: {} });
    const { getByTestId, getAllByTestId, container } = render(renderer.render, {
      props: {
        activityType: "a2ui-surface",
        content: {},
        message: {},
        agent: {},
      },
    });

    const root = getByTestId("a2ui-loading");
    expect(root).not.toBeNull();
    expect((root as HTMLElement).textContent ?? "").toContain(
      "Generating UI...",
    );

    const dot = getByTestId("a2ui-loading-dot") as HTMLElement;
    expect(dot.getAttribute("style") ?? "").toMatch(/cpk-a2ui-pulse/);

    const bars = getAllByTestId("a2ui-loading-bar") as HTMLElement[];
    expect(bars).toHaveLength(3);

    const widthMatches = bars.map((bar) => {
      const style = bar.getAttribute("style") ?? "";
      const match = style.match(/width:\s*([\d.]+)%/);
      expect(style).toMatch(/cpk-a2ui-pulse/);
      return match ? Number(match[1]) : null;
    });
    expect(widthMatches).toEqual([80, 60, 40]);

    const styleTag = container.querySelector("style");
    expect(styleTag?.textContent ?? "").toContain("@keyframes cpk-a2ui-pulse");
  });

  it("renders custom loading component when provided", () => {
    const CustomLoading = defineComponent({
      name: "CustomLoading",
      setup() {
        return () => h("div", { "data-testid": "custom-loading" }, "Loading");
      },
    });
    const renderer = createA2UIMessageRenderer({
      theme: {},
      loadingComponent: CustomLoading,
    });
    const { getByTestId } = render(renderer.render, {
      props: {
        activityType: "a2ui-surface",
        content: {},
        message: {},
        agent: {},
      },
    });
    expect(getByTestId("custom-loading")).not.toBeNull();
  });

  it("renders A2UI surface when operations exist", async () => {
    const renderer = createA2UIMessageRenderer({ theme: {} });
    const { container, getByTestId, queryByTestId } = render(renderer.render, {
      props: {
        activityType: "a2ui-surface",
        content: {
          a2ui_operations: [
            {
              version: "v0.9",
              createSurface: {
                surfaceId: "surface-1",
                catalogId:
                  "https://a2ui.org/specification/v0_9/basic_catalog.json",
              },
            },
            {
              version: "v0.9",
              updateComponents: {
                surfaceId: "surface-1",
                components: [
                  {
                    id: "root",
                    component: "Text",
                    text: "Hello",
                    variant: "body",
                  },
                ],
              },
            },
          ],
        },
        message: {},
        agent: {},
      },
      global: {
        provide: copilotKitProvide(),
      },
    });
    await waitFor(
      () => {
        expect(queryByTestId("a2ui-loading")).toBeNull();
        expect(container.querySelector("[data-copilotkit]")).not.toBeNull();
        expect(getByTestId("a2ui-activity-renderer")).not.toBeNull();
      },
      { timeout: 5000 },
    );
  });

  it("updates rendered surface when operations change", async () => {
    const renderer = createA2UIMessageRenderer({ theme: {} });
    const mounted = render(renderer.render, {
      props: {
        activityType: "a2ui-surface",
        content: {
          a2ui_operations: [
            {
              version: "v0.9",
              createSurface: {
                surfaceId: "test",
                catalogId:
                  "https://a2ui.org/specification/v0_9/basic_catalog.json",
              },
            },
            {
              version: "v0.9",
              updateComponents: {
                surfaceId: "test",
                components: [
                  {
                    id: "root",
                    component: "Text",
                    text: "Initial",
                    variant: "body",
                  },
                ],
              },
            },
          ],
        },
        message: {},
        agent: {},
      },
      global: {
        provide: copilotKitProvide(),
      },
    });

    await waitFor(() => {
      expect(
        mounted.container.querySelector("[data-surface-id='test']"),
      ).not.toBeNull();
      expect(mounted.container.textContent ?? "").toContain("Initial");
    });

    await mounted.rerender({
      activityType: "a2ui-surface",
      content: {
        a2ui_operations: [
          {
            version: "v0.9",
            createSurface: {
              surfaceId: "test",
              catalogId:
                "https://a2ui.org/specification/v0_9/basic_catalog.json",
            },
          },
          {
            version: "v0.9",
            updateComponents: {
              surfaceId: "test",
              components: [
                {
                  id: "root",
                  component: "Text",
                  text: "Updated",
                  variant: "body",
                },
              ],
            },
          },
        ],
      },
      message: {},
      agent: {},
    });

    await waitFor(() => {
      const updatedSurface = mounted.container.querySelector(
        "[data-surface-id='test']",
      );
      expect(updatedSurface).not.toBeNull();
      expect(mounted.container.textContent ?? "").toContain("Updated");
      // Text content flipped from "Initial" to "Updated" while the surface id
      // stayed the same — proving an in-place update rather than a replacement.
      expect(mounted.container.textContent ?? "").not.toContain("Initial");
    });
  });

  it("renders multiple surfaces independently", async () => {
    const renderer = createA2UIMessageRenderer({ theme: {} });
    const { container } = render(renderer.render, {
      props: {
        activityType: "a2ui-surface",
        content: {
          a2ui_operations: [
            {
              version: "v0.9",
              createSurface: {
                surfaceId: "s1",
                catalogId:
                  "https://a2ui.org/specification/v0_9/basic_catalog.json",
              },
            },
            {
              version: "v0.9",
              createSurface: {
                surfaceId: "s2",
                catalogId:
                  "https://a2ui.org/specification/v0_9/basic_catalog.json",
              },
            },
          ],
        },
        message: {},
        agent: {},
      },
      global: {
        provide: copilotKitProvide(),
      },
    });

    await waitFor(() => {
      expect(container.querySelector("[data-surface-id='s1']")).not.toBeNull();
      expect(container.querySelector("[data-surface-id='s2']")).not.toBeNull();
    });
  });
});
