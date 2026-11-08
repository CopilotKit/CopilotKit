import { afterEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { render, waitFor } from "@testing-library/vue";
import { createA2UIMessageRenderer } from "../A2UIMessageRenderer";
import { CopilotKitKey } from "../../providers/keys";

/** A minimal CopilotKit context for rendering an A2UI surface without a runtime. */
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
      createSurface: { surfaceId: "unknown", catalogId: BASIC_CATALOG_ID },
    },
    {
      version: "v0.9",
      updateComponents: {
        surfaceId: "unknown",
        components: [
          {
            id: "root",
            component: "Column",
            children: ["before", "mystery", "after"],
          },
          { id: "before", component: "Text", text: "Before" },
          { id: "mystery", component: "NotInCatalog" },
          { id: "after", component: "Text", text: "After" },
        ],
      },
    },
  ],
};

/** Renders the surface described by `content`. */
function renderSurface() {
  const renderer = createA2UIMessageRenderer({ theme: {} });
  return render(renderer.render, {
    props: { activityType: "a2ui-surface", content, message: {}, agent: {} },
    global: { provide: copilotKitProvide() },
  });
}

// An unregistered component type is a mistake only the agent's developer can
// act on, so a production build renders nothing for it while the rest of the
// surface renders; development keeps the diagnostic.
describe("A2UI unknown component types", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("renders nothing for an unknown type in production, keeping its siblings", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { container, getByText } = renderSurface();

    await waitFor(() => expect(getByText("Before")).toBeDefined());
    expect(getByText("After")).toBeDefined();
    expect(container.textContent).not.toContain("NotInCatalog");
    expect(container.textContent).not.toContain("Unknown component");
  });

  it("shows the diagnostic for an unknown type in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { container, getByText } = renderSurface();

    await waitFor(() => expect(getByText("Before")).toBeDefined());
    expect(container.textContent).toContain("Unknown component: NotInCatalog");
  });
});
