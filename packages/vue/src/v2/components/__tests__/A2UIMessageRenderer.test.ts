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
  const renderLifecycle = (
    content: Record<string, unknown>,
    options: Partial<Parameters<typeof createA2UIMessageRenderer>[0]> = {},
  ) => {
    const renderer = createA2UIMessageRenderer({ theme: {}, ...options });
    return render(renderer.render, {
      props: { activityType: "a2ui-surface", content, message: {}, agent: {} },
    });
  };

  it("shows the 'Building interface' skeleton while there are no operations", () => {
    const { container } = renderLifecycle({});
    expect(container.textContent).toContain("Building interface");
    expect(container.textContent).not.toContain("Generating UI");
  });

  it("shows the live token count while building", () => {
    const { container } = renderLifecycle({
      status: "building",
      progressTokens: 97,
    });
    expect(container.textContent).toContain("~97 tokens");
  });

  it("shows the retry state for status 'retrying'", () => {
    const { container } = renderLifecycle({
      status: "retrying",
      attempt: 2,
      maxAttempts: 3,
    });
    expect(container.textContent).toContain(
      "Retrying generation… (2/3 attempts)",
    );
  });

  it("honours recovery.showAfterAttempts", () => {
    const { container } = renderLifecycle(
      { status: "retrying", attempt: 2, maxAttempts: 3 },
      { recovery: { showAfterAttempts: 5, showAfterMs: 999999 } },
    );
    expect(container.textContent).toContain("Building interface");
    expect(container.textContent).not.toContain("Retrying");
  });

  it("shows the failure card for status 'failed', with details per recovery.debugExposure", () => {
    const { container } = renderLifecycle(
      { status: "failed", error: "boom", attempts: [] },
      { recovery: { debugExposure: "hidden" } },
    );
    expect(
      container.querySelector(".cpk-a2ui-recovery-failure")?.textContent,
    ).toContain("Couldn't generate the UI");
    expect(container.querySelector("details")).toBeNull();
  });

  it("lets a server-stamped debugExposure win over the option", () => {
    const { container } = renderLifecycle(
      { status: "failed", error: "boom", debugExposure: "verbose" },
      { recovery: { debugExposure: "hidden" } },
    );
    expect(container.querySelector("details")?.hasAttribute("open")).toBe(true);
  });

  it("shows the failure card instead of a custom loading component", () => {
    const CustomLoading = defineComponent({
      setup: () => () => h("div", { "data-testid": "custom-loading" }),
    });
    const { container, queryByTestId } = renderLifecycle(
      { status: "failed" },
      { loadingComponent: CustomLoading },
    );
    expect(queryByTestId("custom-loading")).toBeNull();
    expect(container.textContent).toContain("Couldn't generate the UI");
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
