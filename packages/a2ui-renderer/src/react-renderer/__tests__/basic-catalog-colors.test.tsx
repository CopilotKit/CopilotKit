import React, { useEffect } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { A2UIProvider } from "../core/A2UIProvider";
import { A2UIRenderer } from "../core/A2UIRenderer";
import { useA2UI } from "../hooks/useA2UI";

/**
 * The basic catalog styles itself inline, so a host can only theme it through
 * CSS variables. Each colour reads the same --a2ui-color-* variable as the
 * Angular basic catalog, and falls back to the colour it used before, so a page
 * that sets no variables looks the same.
 */

const BASIC_CATALOG_ID =
  "https://a2ui.org/specification/v0_9/basic_catalog.json";

const operations = [
  {
    version: "v0.9",
    createSurface: { surfaceId: "surface", catalogId: BASIC_CATALOG_ID },
  },
  {
    version: "v0.9",
    updateComponents: {
      surfaceId: "surface",
      components: [
        { id: "root", component: "Card", child: "body" },
        {
          id: "body",
          component: "Column",
          children: ["caption", "choice", "rule", "go"],
        },
        { id: "caption", component: "Text", text: "Hint", variant: "caption" },
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
];

// A text field and a checkbox whose check fails, because /valid is unset.
const invalidOperations = [
  {
    version: "v0.9",
    createSurface: { surfaceId: "surface", catalogId: BASIC_CATALOG_ID },
  },
  {
    version: "v0.9",
    updateComponents: {
      surfaceId: "surface",
      components: [
        { id: "root", component: "Column", children: ["name", "agree"] },
        {
          id: "name",
          component: "TextField",
          label: "Name",
          value: { path: "/name" },
          checks: [{ condition: { path: "/valid" }, message: "Required" }],
        },
        {
          id: "agree",
          component: "CheckBox",
          label: "Agree",
          value: { path: "/agree" },
          checks: [{ condition: { path: "/valid" }, message: "Must agree" }],
        },
      ],
    },
  },
];

function Surface({ messages = operations }: { messages?: unknown[] }) {
  const { processMessages } = useA2UI();
  useEffect(() => {
    processMessages(messages as any);
  }, [processMessages, messages]);
  return <A2UIRenderer surfaceId="surface" />;
}

function styleOf(element: Element | null | undefined) {
  return element?.getAttribute("style") ?? "";
}

describe("basic catalog colours", () => {
  afterEach(() => {
    cleanup();
  });

  it("reads the --a2ui-color-* variables, falling back to the previous colours", async () => {
    const { container } = render(
      <A2UIProvider>
        <Surface />
      </A2UIProvider>,
    );

    const chip = (await screen.findByText("North")).closest("button");
    const button = screen.getByText("Continue").closest("button");
    const caption = screen.getByText("Hint");
    const card = container.querySelector(
      "[data-surface-id] [style*='box-shadow']",
    );
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
    const { container } = render(
      <A2UIProvider>
        <Surface messages={invalidOperations} />
      </A2UIProvider>,
    );

    await screen.findByText("Required");
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
    expect(styleOf(screen.getByText("Required"))).toContain(
      "var(--a2ui-color-error, red)",
    );
  });
});
