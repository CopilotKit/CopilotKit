import React, { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { A2UIProvider } from "../core/A2UIProvider";
import { A2UIRenderer } from "../core/A2UIRenderer";
import { useA2UI } from "../hooks/useA2UI";

/**
 * An unregistered component type is a mistake only the agent's developer can
 * act on, so a production build renders nothing for it while the rest of the
 * surface renders; development keeps the diagnostic.
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
];

/** Processes the given A2UI operations and renders the resulting surface. */
function Surface({ messages = operations }: { messages?: unknown[] }) {
  const { processMessages } = useA2UI();
  useEffect(() => {
    processMessages(messages as any);
  }, [processMessages, messages]);
  return <A2UIRenderer surfaceId="surface" />;
}

/**
 * True when `after` follows `before` as the very next element among the
 * column's children, so nothing (even an empty element) sits between them.
 */
function isNextSibling(before: Element, after: Element): boolean {
  let node: Element = before;
  while (node.parentElement && !node.parentElement.contains(after)) {
    node = node.parentElement;
  }
  return node.nextElementSibling?.contains(after) ?? false;
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("unknown component types", () => {
  it("renders nothing for an unknown type in production, keeping its siblings", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { container } = render(
      <A2UIProvider>
        <Surface />
      </A2UIProvider>,
    );

    await screen.findByText("Before");
    expect(
      isNextSibling(screen.getByText("Before"), screen.getByText("After")),
    ).toBe(true);
    expect(container.textContent).not.toContain("NotInCatalog");
    expect(container.textContent).not.toContain("Unknown component");
  });

  it("treats a page without a process global as production", async () => {
    vi.stubGlobal("process", undefined);
    const { container } = render(
      <A2UIProvider>
        <Surface />
      </A2UIProvider>,
    );

    await screen.findByText("Before");
    vi.unstubAllGlobals();
    expect(
      isNextSibling(screen.getByText("Before"), screen.getByText("After")),
    ).toBe(true);
    expect(container.textContent).not.toContain("Unknown component");
  });

  it("shows the diagnostic for an unknown type in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { container } = render(
      <A2UIProvider>
        <Surface />
      </A2UIProvider>,
    );

    await screen.findByText("Before");
    expect(container.textContent).toContain("Unknown component: NotInCatalog");
    // The diagnostic is an element between the siblings, which is what the
    // production test's adjacency check would catch.
    expect(
      isNextSibling(screen.getByText("Before"), screen.getByText("After")),
    ).toBe(false);
  });
});
