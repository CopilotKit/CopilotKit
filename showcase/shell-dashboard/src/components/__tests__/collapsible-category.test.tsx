/**
 * Unit tests for CollapsibleCategory — expand/collapse, localStorage persist.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { CollapsibleCategory } from "../collapsible-category";

// Mock localStorage
const storageMap = new Map<string, string>();

beforeEach(() => {
  storageMap.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storageMap.get(key) ?? null,
    setItem: (key: string, value: string) => storageMap.set(key, value),
    removeItem: (key: string) => storageMap.delete(key),
    clear: () => storageMap.clear(),
    get length() {
      return storageMap.size;
    },
    key: (_i: number) => null,
  });
});

describe("CollapsibleCategory", () => {
  it("renders children when defaultOpen is true", () => {
    const { getByText } = render(
      <CollapsibleCategory name="Core" count="10/38" defaultOpen>
        <div>child content</div>
      </CollapsibleCategory>,
    );
    expect(getByText("child content")).toBeDefined();
  });

  it("hides children when defaultOpen is false", () => {
    const { queryByText } = render(
      <CollapsibleCategory name="Core" count="10/38" defaultOpen={false}>
        <div>child content</div>
      </CollapsibleCategory>,
    );
    expect(queryByText("child content")).toBeNull();
  });

  it("shows category name and count", () => {
    const { getByText } = render(
      <CollapsibleCategory name="Chat & UI" count="5/10" defaultOpen>
        <div>content</div>
      </CollapsibleCategory>,
    );
    expect(getByText("Chat & UI")).toBeDefined();
    expect(getByText("5/10")).toBeDefined();
  });

  it("toggles visibility on click", () => {
    const { getByTestId, queryByText } = render(
      <CollapsibleCategory name="Core" count="3/5" defaultOpen>
        <div>child content</div>
      </CollapsibleCategory>,
    );
    const header = getByTestId("collapsible-header");

    // Initially open
    expect(queryByText("child content")).not.toBeNull();

    // Click to close
    fireEvent.click(header);
    expect(queryByText("child content")).toBeNull();

    // Click to open
    fireEvent.click(header);
    expect(queryByText("child content")).not.toBeNull();
  });

  it("persists collapsed state in localStorage", () => {
    const { getByTestId } = render(
      <CollapsibleCategory name="Platform" count="2/4" defaultOpen>
        <div>content</div>
      </CollapsibleCategory>,
    );
    const header = getByTestId("collapsible-header");

    // Collapse
    fireEvent.click(header);
    expect(storageMap.get("dashboard-collapse-Platform")).toBe("collapsed");

    // Expand
    fireEvent.click(header);
    expect(storageMap.get("dashboard-collapse-Platform")).toBe("expanded");
  });

  it("reads initial state from localStorage when available", () => {
    storageMap.set("dashboard-collapse-TestCat", "collapsed");
    const { queryByText } = render(
      <CollapsibleCategory name="TestCat" count="1/2" defaultOpen>
        <div>should be hidden</div>
      </CollapsibleCategory>,
    );
    // localStorage says collapsed, even though defaultOpen=true
    expect(queryByText("should be hidden")).toBeNull();
  });

  it("renders chevron indicator", () => {
    const { getByTestId } = render(
      <CollapsibleCategory name="Core" count="3/5" defaultOpen>
        <div>content</div>
      </CollapsibleCategory>,
    );
    const chevron = getByTestId("collapsible-chevron");
    expect(chevron).toBeDefined();
  });
});
