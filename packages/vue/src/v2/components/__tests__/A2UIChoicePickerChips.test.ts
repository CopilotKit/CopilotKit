import { describe, expect, it } from "vitest";
import { ref } from "vue";
import { fireEvent, render, waitFor } from "@testing-library/vue";
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

function renderChips() {
  const renderer = createA2UIMessageRenderer({ theme: {} });
  return render(renderer.render, {
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
                  component: "ChoicePicker",
                  variant: "multipleSelection",
                  displayStyle: "chips",
                  options: [
                    { label: "Red", value: "red" },
                    { label: "Blue", value: "blue" },
                  ],
                  value: { path: "/tags" },
                },
              ],
            },
          },
          {
            version: "v0.9",
            updateDataModel: {
              surfaceId: "surface-1",
              path: "/",
              value: { tags: [] },
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
}

describe("A2UI Vue ChoicePicker chips", () => {
  it("are type=button so a chip inside a form does not submit it", async () => {
    const view = renderChips();
    const chip = (await view.findByText("Red", {}, { timeout: 5000 })).closest(
      "button",
    )!;
    expect(chip.getAttribute("type")).toBe("button");
  });

  it("expose their selected state with aria-pressed", async () => {
    const view = renderChips();
    const red = (await view.findByText("Red", {}, { timeout: 5000 })).closest(
      "button",
    )!;
    const blue = view.getByText("Blue").closest("button")!;
    expect(red.getAttribute("aria-pressed")).toBe("false");
    expect(blue.getAttribute("aria-pressed")).toBe("false");

    await fireEvent.click(red);

    await waitFor(() => {
      expect(
        view.getByText("Red").closest("button")!.getAttribute("aria-pressed"),
      ).toBe("true");
    });
    expect(
      view.getByText("Blue").closest("button")!.getAttribute("aria-pressed"),
    ).toBe("false");
  });
});
