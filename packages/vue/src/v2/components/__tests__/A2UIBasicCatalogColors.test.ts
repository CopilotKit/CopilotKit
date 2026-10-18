import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
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
      createSurface: { surfaceId: "colors", catalogId: BASIC_CATALOG_ID },
    },
    {
      version: "v0.9",
      updateComponents: {
        surfaceId: "colors",
        components: [
          { id: "root", component: "Card", child: "body" },
          {
            id: "body",
            component: "Column",
            children: ["caption", "choice", "rule", "go"],
          },
          {
            id: "caption",
            component: "Text",
            text: "Hint",
            variant: "caption",
          },
          {
            id: "choice",
            component: "ChoicePicker",
            displayStyle: "chips",
            options: [{ label: "North", value: "north" }],
            value: [],
          },
          { id: "rule", component: "Divider" },
          {
            id: "go",
            component: "Button",
            child: "goLabel",
            action: { event: { name: "go" } },
          },
          { id: "goLabel", component: "Text", text: "Continue" },
        ],
      },
    },
  ],
};

/** The element's inline `style` attribute, or "" when there is no element. */
const styleOf = (element: Element | null | undefined) =>
  element?.getAttribute("style") ?? "";

// The basic catalog styles itself inline, so a host can only theme it through
// CSS variables. Each colour reads the same --a2ui-color-* variable as the
// Angular basic catalog and falls back to the colour it used before; in dark
// mode the chat stylesheet sets the variables from its own tokens.
describe("A2UI basic catalog colours", () => {
  it("reads the --a2ui-color-* variables, falling back to the previous colours", async () => {
    const renderer = createA2UIMessageRenderer({ theme: {} });
    const { container, getByText } = render(renderer.render, {
      props: { activityType: "a2ui-surface", content, message: {}, agent: {} },
      global: { provide: copilotKitProvide() },
    });

    await waitFor(() => expect(getByText("Continue")).toBeDefined());

    const card = container.querySelector(
      "[data-surface-id] [style*='box-shadow']",
    );
    const chip = getByText("North").closest("button");
    const button = getByText("Continue").closest("button");
    const caption = getByText("Hint");
    const divider = container.querySelector(
      "[data-surface-id] [style*='height: 1px']",
    );

    expect(styleOf(card)).toContain("var(--a2ui-color-surface, #fff)");
    expect(styleOf(card)).toContain("var(--a2ui-color-border, #ccc)");
    expect(styleOf(chip)).toContain("var(--a2ui-color-surface, #fff)");
    expect(styleOf(chip)).toContain("var(--a2ui-color-border, #ccc)");
    expect(styleOf(button)).toContain("var(--a2ui-color-surface, #fff)");
    expect(styleOf(button)).toContain("var(--a2ui-color-border, #ccc)");
    expect(styleOf(caption)).toContain("var(--a2ui-color-muted, #666)");
    expect(styleOf(divider)).toContain("var(--a2ui-color-border, #ccc)");
  });

  it("colours the error text and outlines with --a2ui-color-error", async () => {
    // A text field and a checkbox whose check fails, because /valid is unset.
    const invalid = {
      a2ui_operations: [
        {
          version: "v0.9",
          createSurface: { surfaceId: "invalid", catalogId: BASIC_CATALOG_ID },
        },
        {
          version: "v0.9",
          updateComponents: {
            surfaceId: "invalid",
            components: [
              { id: "root", component: "Column", children: ["name", "agree"] },
              {
                id: "name",
                component: "TextField",
                label: "Name",
                value: { path: "/name" },
                checks: [
                  { condition: { path: "/valid" }, message: "Required" },
                ],
              },
              {
                id: "agree",
                component: "CheckBox",
                label: "Agree",
                value: { path: "/agree" },
                checks: [
                  { condition: { path: "/valid" }, message: "Must agree" },
                ],
              },
            ],
          },
        },
      ],
    };
    const renderer = createA2UIMessageRenderer({ theme: {} });
    const { container, findByText, getByText } = render(renderer.render, {
      props: {
        activityType: "a2ui-surface",
        content: invalid,
        message: {},
        agent: {},
      },
      global: { provide: copilotKitProvide() },
    });

    await findByText("Required");
    const textInput = container.querySelector(
      "input[type='text'], input:not([type])",
    );
    const checkbox = container.querySelector("input[type='checkbox']");

    expect(styleOf(textInput)).toContain(
      "1px solid var(--a2ui-color-error, red)",
    );
    expect(styleOf(checkbox)).toContain(
      "1px solid var(--a2ui-color-error, red)",
    );
    expect(styleOf(getByText("Required"))).toContain(
      "var(--a2ui-color-error, red)",
    );
  });

  it("sets the variables from the dark theme in the chat stylesheet", () => {
    const globalsCss = readFileSync("src/styles/globals.css", "utf8");
    const darkBlock =
      globalsCss.match(
        /\.dark \[data-copilotkit\],\s*\[data-copilotkit\]\.dark \{([^}]*)\}/,
      )?.[1] ?? "";

    expect(darkBlock).toContain("--a2ui-color-surface: var(--card);");
    expect(darkBlock).toContain("--a2ui-color-border: oklch(0.371 0 0);");
    expect(darkBlock).toContain("--a2ui-color-muted: var(--muted-foreground);");
    expect(darkBlock).toContain("--a2ui-color-error: #f87171;");
  });
});
