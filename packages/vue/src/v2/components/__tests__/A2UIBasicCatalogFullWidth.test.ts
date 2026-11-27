import { describe, expect, it } from "vitest";
import { ref } from "vue";
import { render } from "@testing-library/vue";
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

const BASIC_CATALOG_ID =
  "https://a2ui.org/specification/v0_9/basic_catalog.json";

const content = {
  a2ui_operations: [
    {
      version: "v0.9",
      createSurface: { surfaceId: "width", catalogId: BASIC_CATALOG_ID },
    },
    {
      version: "v0.9",
      updateComponents: {
        surfaceId: "width",
        components: [
          {
            id: "root",
            component: "Column",
            children: ["name", "amount", "card", "rule"],
          },
          {
            id: "name",
            component: "TextField",
            label: "Name",
            value: { path: "/name" },
          },
          {
            id: "amount",
            component: "Slider",
            label: "Amount",
            min: 0,
            max: 10,
            value: { path: "/amount" },
          },
          { id: "card", component: "Card", child: "cardText" },
          { id: "cardText", component: "Text", text: "In a card" },
          { id: "rule", component: "Divider" },
        ],
      },
    },
  ],
};

const FULL_WIDTH = /(?:^|;\s*)width: calc\(100% - (2 \* 8px|16px)\)/;
const OVERFLOWING_WIDTH = /(?:^|;\s*)width: 100%/;

describe("A2UI basic catalog full-width components", () => {
  it("leaves room for the margin when a component fills its container", async () => {
    const renderer = createA2UIMessageRenderer({ theme: {} });
    const { container, findByText } = render(renderer.render, {
      props: { activityType: "a2ui-surface", content, message: {}, agent: {} },
      global: { provide: copilotKitProvide() },
    });
    await findByText("Name");

    const withMargin = Array.from(
      container.querySelectorAll("[style*='margin: 8px']"),
    ).map((element) => element.getAttribute("style") ?? "");

    expect(withMargin.filter((style) => FULL_WIDTH.test(style))).toHaveLength(
      4,
    );
    expect(withMargin.filter((style) => OVERFLOWING_WIDTH.test(style))).toEqual(
      [],
    );
  });
});
