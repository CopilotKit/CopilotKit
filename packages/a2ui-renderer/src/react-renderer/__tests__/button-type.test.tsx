import React, { useEffect } from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { A2UIProvider } from "../core/A2UIProvider";
import { A2UIRenderer } from "../core/A2UIRenderer";
import { useA2UI } from "../hooks/useA2UI";
import { minimalCatalog } from "../a2ui-react";

/**
 * A native <button> without an explicit type defaults to "submit", so a
 * generated A2UI control rendered inside a host application's <form> would
 * also submit that form. Every button in the React catalogs must set
 * type="button", matching the Lit renderers.
 */

const BASIC_CATALOG_ID =
  "https://a2ui.org/specification/v0_9/basic_catalog.json";
const MINIMAL_CATALOG_ID =
  "https://a2ui.org/specification/v0_9/catalogs/minimal/minimal_catalog.json";

function surfaceOperations(catalogId: string, components: unknown[]) {
  return [
    { version: "v0.9", createSurface: { surfaceId: "surface", catalogId } },
    { version: "v0.9", updateComponents: { surfaceId: "surface", components } },
  ];
}

const text = (id: string, value: string) => ({
  id,
  component: "Text",
  text: value,
});

function Surface({ operations }: { operations: unknown[] }) {
  const { processMessages } = useA2UI();
  useEffect(() => {
    processMessages(operations as any);
  }, [processMessages, operations]);
  return <A2UIRenderer surfaceId="surface" />;
}

function renderInsideForm(operations: unknown[], catalog?: unknown) {
  let submits = 0;
  const utils = render(
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submits++;
      }}
    >
      <A2UIProvider catalog={catalog}>
        <Surface operations={operations} />
      </A2UIProvider>
    </form>,
  );
  return { ...utils, submitCount: () => submits };
}

describe("A2UI React buttons inside a host form", () => {
  afterEach(() => {
    cleanup();
  });

  it("Button does not submit the form", async () => {
    const view = renderInsideForm(
      surfaceOperations(BASIC_CATALOG_ID, [
        {
          id: "root",
          component: "Button",
          child: "label",
          action: { event: { name: "go" } },
        },
        text("label", "Go"),
      ]),
    );
    fireEvent.click((await view.findByText("Go")).closest("button")!);
    expect(view.submitCount()).toBe(0);
  });

  it("ChoicePicker chips do not submit the form", async () => {
    const view = renderInsideForm(
      surfaceOperations(BASIC_CATALOG_ID, [
        {
          id: "root",
          component: "ChoicePicker",
          displayStyle: "chips",
          options: [{ label: "Alpha", value: "a" }],
          value: [],
        },
      ]),
    );
    fireEvent.click((await view.findByText("Alpha")).closest("button")!);
    expect(view.submitCount()).toBe(0);
  });

  it("Modal close button does not submit the form", async () => {
    const view = renderInsideForm(
      surfaceOperations(BASIC_CATALOG_ID, [
        { id: "root", component: "Modal", trigger: "trigger", content: "body" },
        text("trigger", "Open"),
        text("body", "Body"),
      ]),
    );
    fireEvent.click(await view.findByText("Open"));
    fireEvent.click(await view.findByText("×"));
    expect(view.submitCount()).toBe(0);
  });

  it("Tabs buttons do not submit the form", async () => {
    const view = renderInsideForm(
      surfaceOperations(BASIC_CATALOG_ID, [
        {
          id: "root",
          component: "Tabs",
          tabs: [
            { title: "One", child: "first" },
            { title: "Two", child: "second" },
          ],
        },
        text("first", "First"),
        text("second", "Second"),
      ]),
    );
    fireEvent.click((await view.findByText("Two")).closest("button")!);
    expect(view.submitCount()).toBe(0);
  });

  it("minimal catalog Button does not submit the form", async () => {
    const view = renderInsideForm(
      surfaceOperations(MINIMAL_CATALOG_ID, [
        {
          id: "root",
          component: "Button",
          child: "label",
          action: { event: { name: "go" } },
        },
        text("label", "Go"),
      ]),
      minimalCatalog,
    );
    fireEvent.click((await view.findByText("Go")).closest("button")!);
    expect(view.submitCount()).toBe(0);
  });
});
