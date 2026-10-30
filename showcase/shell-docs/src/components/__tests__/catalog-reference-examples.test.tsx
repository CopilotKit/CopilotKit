// @vitest-environment jsdom
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CatalogReferenceExample,
  CatalogReferenceExamples,
} from "@/components/standard-catalog/catalog-reference-examples";
import { SAMPLES } from "@/components/standard-catalog/catalog-data";

const writeText = vi.fn().mockResolvedValue(undefined);
const fetchSpy = vi.fn(() =>
  Promise.reject(new Error("Examples must stay local")),
);

describe("dedicated component examples", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }));
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("renders the existing full Button examples and copies their operations", async () => {
    render(<CatalogReferenceExamples name="Button" />);
    const example = screen.getByRole("region", {
      name: "Button variants, colors, icon, Pressable",
    });
    fireEvent.click(
      await within(example).findByRole(
        "button",
        { name: "Primary" },
        { timeout: 5000 },
      ),
    );
    await waitFor(() =>
      expect(within(example).getByRole("status").textContent).toContain(
        "1 local event",
      ),
    );
    fireEvent.click(within(example).getByText("View code"));
    fireEvent.click(within(example).getByRole("button", { name: "Copy Text" }));
    expect(
      JSON.parse(writeText.mock.calls[0][0])
        .at(-1)
        .updateComponents.components.some(
          (node: { component: string }) => node.component === "Button",
        ),
    ).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("renders a structural part's existing example independently of its parent's copy", async () => {
    render(
      <>
        <CatalogReferenceExamples name="Grid" />
        <CatalogReferenceExamples name="GridItem" />
      </>,
    );
    const examples = screen.getAllByRole("region", {
      name: "Grid and GridItem",
    });
    for (const example of examples) {
      await waitFor(() =>
        expect(
          example.querySelector("[data-generative-ui-surface]"),
        ).not.toBeNull(),
      );
      expect(within(example).queryByRole("alert")).toBeNull();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each(SAMPLES.map((sample, index) => [sample.title, index] as const))(
    "renders the existing %s example without validation errors",
    async (_title, index) => {
      const { container } = render(<CatalogReferenceExample index={index} />);
      await waitFor(() =>
        expect(
          container.querySelector("[data-generative-ui-surface]"),
        ).not.toBeNull(),
      );
      expect(screen.queryByRole("alert")).toBeNull();
    },
  );
});
