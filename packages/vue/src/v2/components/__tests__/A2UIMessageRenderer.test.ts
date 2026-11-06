import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref } from "vue";
import { fireEvent, render, waitFor } from "@testing-library/vue";
import type { ɵA2UIActionInterceptor } from "@copilotkit/core";
import { createA2UIMessageRenderer } from "../A2UIMessageRenderer";
import { CopilotKitKey } from "../../providers/keys";

function copilotKitProvide(
  onRunAgent: (properties: Record<string, unknown>) => void = () => undefined,
) {
  const copilotkit = {
    properties: {} as Record<string, unknown>,
    setProperties(properties: Record<string, unknown>) {
      copilotkit.properties = properties;
    },
    runAgent: async () => {
      onRunAgent(copilotkit.properties);
    },
  };
  return {
    [CopilotKitKey as symbol]: {
      copilotkit: ref(copilotkit),
      executingToolCallIds: ref(new Set()),
      a2uiTheme: ref({}),
      a2uiCatalog: ref(undefined),
      a2uiLoadingComponent: ref(undefined),
      a2uiIncludeSchema: ref(true),
    },
  };
}

describe("createA2UIMessageRenderer", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

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

  it("keeps an early retry looking like building until showAfterMs passes", async () => {
    vi.useFakeTimers();
    const { container } = renderLifecycle(
      { status: "retrying", attempt: 1, maxAttempts: 3 },
      { recovery: { showAfterMs: 2000 } },
    );
    expect(container.textContent).toContain("Building interface");
    await vi.advanceTimersByTimeAsync(2000);
    expect(container.textContent).toContain(
      "Retrying generation… (1/3 attempts)",
    );
  });

  it("shows retry validation issues unless debugExposure is hidden", () => {
    const retry = {
      status: "retrying",
      attempt: 2,
      errors: [{ code: "missing_required_prop" }],
    };
    const shown = renderLifecycle(retry);
    expect(shown.container.querySelector("details summary")?.textContent).toBe(
      "validation issues",
    );
    expect(shown.container.textContent).toContain("missing_required_prop");
    const hidden = renderLifecycle(retry, {
      recovery: { debugExposure: "hidden" },
    });
    expect(hidden.container.querySelector("details")).toBeNull();
  });

  it("shows collapsed developer details on failure by default", () => {
    const { container } = renderLifecycle({ status: "failed", error: "boom" });
    const details = container.querySelector("details");
    expect(details?.hasAttribute("open")).toBe(false);
    expect(details?.textContent).toContain("boom");
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

  const buttonContent = {
    a2ui_operations: [
      {
        version: "v0.9",
        createSurface: {
          surfaceId: "form",
          catalogId: "https://a2ui.org/specification/v0_9/basic_catalog.json",
        },
      },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "form",
          components: [
            {
              id: "root",
              component: "Button",
              child: "label",
              action: { event: { name: "confirm", context: { n: 1 } } },
            },
            { id: "label", component: "Text", text: "Confirm" },
          ],
        },
      },
    ],
  };

  /** Renders the button surface, clicks it, and returns what reached the agent. */
  async function clickButton(onAction?: ɵA2UIActionInterceptor) {
    const forwarded: Record<string, unknown>[] = [];
    const renderer = createA2UIMessageRenderer({ theme: {}, onAction });
    const { findByRole } = render(renderer.render, {
      props: {
        activityType: "a2ui-surface",
        content: buttonContent,
        message: {},
        agent: { agentId: "a" },
      },
      global: {
        provide: copilotKitProvide((properties) =>
          forwarded.push({ ...properties }),
        ),
      },
    });
    await fireEvent.click(await findByRole("button", { hidden: true }));
    return forwarded;
  }

  it("forwards a button click to the agent wrapped as an A2UI userAction envelope", async () => {
    const forwarded = await clickButton();
    await waitFor(() => expect(forwarded).toHaveLength(1));
    expect(forwarded[0]).toEqual({
      a2uiAction: {
        userAction: {
          name: "confirm",
          surfaceId: "form",
          sourceComponentId: "root",
          context: { n: 1 },
          timestamp: expect.any(String),
        },
      },
    });
  });

  it("does not run the agent when onAction handles the action", async () => {
    const onAction = vi.fn<ɵA2UIActionInterceptor>(() => null);
    const forwarded = await clickButton(onAction);
    await waitFor(() => expect(onAction).toHaveBeenCalledOnce());
    expect(forwarded).toEqual([]);
  });

  it("keeps the loader over the hidden surface until the surface can paint", async () => {
    const renderer = createA2UIMessageRenderer({ theme: {} });
    const createOnly = {
      a2ui_operations: [buttonContent.a2ui_operations[0]],
    };
    const mounted = render(renderer.render, {
      props: {
        activityType: "a2ui-surface",
        content: { status: "building", progressTokens: 120 },
        message: {},
        agent: {},
      },
      global: { provide: copilotKitProvide() },
    });

    await mounted.rerender({
      activityType: "a2ui-surface",
      content: createOnly,
      message: {},
      agent: {},
    });
    // A surface without components cannot paint: the loader stays on top.
    expect(mounted.container.textContent).toContain("~120 tokens");
    expect(
      mounted.container.querySelector(
        "[aria-hidden='true'] [data-testid='a2ui-activity-renderer']",
      ),
    ).not.toBeNull();

    await mounted.rerender({
      activityType: "a2ui-surface",
      content: buttonContent,
      message: {},
      agent: {},
    });
    await waitFor(() => {
      expect(mounted.container.textContent).not.toContain("Building interface");
      expect(
        mounted.container.querySelector("[aria-hidden='true']"),
      ).toBeNull();
    });
  });
});

// Mirrors the React routing regression: nested v0.9 IDs are authoritative.
describe("A2UIMessageRenderer — resolving which surface an operation addresses", () => {
  it("groups by the nested surface id, not a top-level one", async () => {
    const renderer = createA2UIMessageRenderer({ theme: {} });
    const { container, getByText, queryByRole } = render(renderer.render, {
      props: {
        activityType: "a2ui-surface",
        content: {
          a2ui_operations: [
            {
              version: "v0.9",
              surfaceId: "top-level",
              createSurface: {
                surfaceId: "nested",
                catalogId:
                  "https://a2ui.org/specification/v0_9/basic_catalog.json",
              },
            },
            {
              version: "v0.9",
              surfaceId: "top-level",
              updateDataModel: {
                surfaceId: "nested",
                path: "/",
                value: { message: "Nested wins" },
              },
            },
            {
              version: "v0.9",
              surfaceId: "top-level",
              updateComponents: {
                surfaceId: "nested",
                components: [
                  {
                    id: "root",
                    component: "Text",
                    text: { path: "/message" },
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
      global: { provide: copilotKitProvide() },
    });

    await waitFor(() => {
      expect(
        container.querySelector("[data-surface-id='nested']"),
      ).not.toBeNull();
      expect(getByText("Nested wins")).toBeTruthy();
    });
    expect(container.querySelector("[data-surface-id='top-level']")).toBeNull();
    expect(container.textContent).not.toContain("A2UI render error");
    expect(queryByRole("alert")).toBeNull();
  });
});
