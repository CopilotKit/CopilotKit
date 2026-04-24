/**
 * Unit tests for CollapsibleCategory — expand/collapse, localStorage persist.
 * Tests both the legacy CollapsibleCategory wrapper and the new
 * useCollapsible hook + CategoryHeaderRow component.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, fireEvent, renderHook, act } from "@testing-library/react";
import {
  CollapsibleCategory,
  CategoryHeaderRow,
  useCollapsible,
} from "../collapsible-category";

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

describe("CollapsibleCategory (legacy wrapper)", () => {
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

describe("useCollapsible hook", () => {
  it("returns isOpen=true when defaultOpen and no localStorage", () => {
    const { result } = renderHook(() =>
      useCollapsible({ name: "HookTest", defaultOpen: true }),
    );
    expect(result.current.isOpen).toBe(true);
  });

  it("returns isOpen=false when defaultOpen=false and no localStorage", () => {
    const { result } = renderHook(() =>
      useCollapsible({ name: "HookTest", defaultOpen: false }),
    );
    expect(result.current.isOpen).toBe(false);
  });

  it("toggle flips state and persists to localStorage", () => {
    const { result } = renderHook(() =>
      useCollapsible({ name: "HookToggle", defaultOpen: true }),
    );
    expect(result.current.isOpen).toBe(true);

    act(() => result.current.toggle());
    expect(result.current.isOpen).toBe(false);
    expect(storageMap.get("dashboard-collapse-HookToggle")).toBe("collapsed");

    act(() => result.current.toggle());
    expect(result.current.isOpen).toBe(true);
    expect(storageMap.get("dashboard-collapse-HookToggle")).toBe("expanded");
  });

  it("reads initial state from localStorage", () => {
    storageMap.set("dashboard-collapse-Stored", "collapsed");
    const { result } = renderHook(() =>
      useCollapsible({ name: "Stored", defaultOpen: true }),
    );
    expect(result.current.isOpen).toBe(false);
  });
});

describe("CategoryHeaderRow", () => {
  it("renders name, count, and chevron inside a <tr>", () => {
    const onToggle = vi.fn();
    const { getByText, getByTestId } = render(
      <table>
        <tbody>
          <CategoryHeaderRow
            name="Chat & UI"
            count="5/10"
            colSpan={4}
            isOpen={true}
            onToggle={onToggle}
          />
        </tbody>
      </table>,
    );
    expect(getByText("Chat & UI")).toBeDefined();
    expect(getByText("5/10")).toBeDefined();
    expect(getByTestId("collapsible-chevron")).toBeDefined();
  });

  it("calls onToggle when clicked", () => {
    const onToggle = vi.fn();
    const { getByTestId } = render(
      <table>
        <tbody>
          <CategoryHeaderRow
            name="Platform"
            count="2/4"
            colSpan={4}
            isOpen={true}
            onToggle={onToggle}
          />
        </tbody>
      </table>,
    );
    fireEvent.click(getByTestId("collapsible-header"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("sets correct colSpan on the td", () => {
    const { getByTestId } = render(
      <table>
        <tbody>
          <CategoryHeaderRow
            name="Core"
            count="1/2"
            colSpan={5}
            isOpen={false}
            onToggle={() => {}}
          />
        </tbody>
      </table>,
    );
    const tr = getByTestId("collapsible-category");
    const td = tr.querySelector("td");
    expect(td?.getAttribute("colspan")).toBe("5");
  });
});
