// @vitest-environment jsdom

import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Tab, Tabs } from "@/components/docs-tabs";

const STORAGE_KEY = "shell-docs.tab.pm";

function PersistGroup(): React.ReactElement {
  return (
    <Tabs groupId="pm" persist items={["npm", "pnpm"]}>
      <Tab value="npm">npm content</Tab>
      <Tab value="pnpm">pnpm content</Tab>
    </Tabs>
  );
}

function PanelFor(text: string): HTMLElement | null {
  return screen.getByText(text).closest('[role="tabpanel"]');
}

function LanguageGroup({
  name,
  groupId = "runtime_language",
  items = ["TypeScript", "Python"],
  persist = true,
  urlDefault,
}: {
  name: string;
  groupId?: string;
  items?: string[];
  persist?: boolean;
  urlDefault?: string;
}): React.ReactElement {
  return (
    <section aria-label={name}>
      <Tabs
        groupId={groupId}
        persist={persist}
        items={items}
        urlDefault={urlDefault}
      >
        {items.map((item) => (
          <Tab key={item} value={item}>
            {name} {item} content
          </Tab>
        ))}
      </Tabs>
    </section>
  );
}

function selectLanguage(name: string, language: string): void {
  fireEvent.mouseDown(
    within(screen.getByRole("region", { name })).getByRole("tab", {
      name: language,
    }),
  );
}

describe("DocsTabs", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("synchronizes mounted runtime groups without changing agent or non-persistent tabs", () => {
    render(
      <>
        <LanguageGroup name="install" />
        <LanguageGroup name="runtime" />
        <LanguageGroup name="agent" groupId="agent_language" />
        <LanguageGroup name="local" persist={false} />
      </>,
    );

    selectLanguage("install", "Python");

    expect(PanelFor("runtime Python content")?.getAttribute("data-state")).toBe(
      "active",
    );
    expect(
      PanelFor("agent TypeScript content")?.getAttribute("data-state"),
    ).toBe("active");
    expect(
      PanelFor("local TypeScript content")?.getAttribute("data-state"),
    ).toBe("active");

    selectLanguage("runtime", "TypeScript");
    expect(
      PanelFor("install TypeScript content")?.getAttribute("data-state"),
    ).toBe("active");
  });

  it("allows a user choice to synchronize groups seeded by a URL default", () => {
    window.localStorage.setItem("shell-docs.tab.runtime_language", "python");
    render(
      <>
        <LanguageGroup name="install" urlDefault="TypeScript" />
        <LanguageGroup name="runtime" urlDefault="TypeScript" />
      </>,
    );

    expect(
      PanelFor("runtime TypeScript content")?.getAttribute("data-state"),
    ).toBe("active");
    selectLanguage("install", "Python");
    expect(PanelFor("runtime Python content")?.getAttribute("data-state")).toBe(
      "active",
    );
  });

  it("keeps the active panel when a sibling selects an unsupported value", () => {
    render(
      <>
        <LanguageGroup name="install" />
        <LanguageGroup name="limited" items={["TypeScript", "JavaScript"]} />
      </>,
    );

    selectLanguage("install", "Python");
    expect(
      PanelFor("limited TypeScript content")?.getAttribute("data-state"),
    ).toBe("active");
  });

  it("switches and synchronizes tabs even when localStorage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(
      <>
        <LanguageGroup name="install" />
        <LanguageGroup name="runtime" />
      </>,
    );

    selectLanguage("install", "Python");
    expect(PanelFor("install Python content")?.getAttribute("data-state")).toBe(
      "active",
    );
    expect(PanelFor("runtime Python content")?.getAttribute("data-state")).toBe(
      "active",
    );
  });

  it("selects the first item when no default is given", () => {
    render(<PersistGroup />);

    expect(PanelFor("npm content")?.getAttribute("data-state")).toBe("active");
    expect(PanelFor("pnpm content")?.getAttribute("data-state")).toBe(
      "inactive",
    );
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("persists a groupId pick and reapplies it on a fresh mount", () => {
    render(<PersistGroup />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "pnpm" }));

    expect(PanelFor("pnpm content")?.getAttribute("data-state")).toBe("active");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("pnpm");

    cleanup();
    render(<PersistGroup />);

    // No `default` on the new instance — the stored pick wins over the
    // first-item fallback.
    expect(PanelFor("pnpm content")?.getAttribute("data-state")).toBe("active");
  });

  // 45 of the 101 `persist` groups in the content tree also carry an
  // author `default=`. If the author default outranked storage, the
  // stored pick would be unreachable on almost half of them.
  it("ranks a stored pick above the author's MDX default", () => {
    window.localStorage.setItem(STORAGE_KEY, "pnpm");
    render(
      <Tabs groupId="pm" persist default="npm" items={["npm", "pnpm"]}>
        <Tab value="npm">npm content</Tab>
        <Tab value="pnpm">pnpm content</Tab>
      </Tabs>,
    );

    expect(PanelFor("pnpm content")?.getAttribute("data-state")).toBe("active");
  });

  it("uses the author's MDX default when nothing is stored", () => {
    render(
      <Tabs groupId="pm" persist default="pnpm" items={["npm", "pnpm"]}>
        <Tab value="npm">npm content</Tab>
        <Tab value="pnpm">pnpm content</Tab>
      </Tabs>,
    );

    expect(PanelFor("pnpm content")?.getAttribute("data-state")).toBe("active");
  });

  // urlDefault comes from the framework route (TAB_DEFAULTS_BY_SLUG), so
  // the snippets on screen must match the URL the reader followed.
  it("ranks a urlDefault above a stored pick", () => {
    window.localStorage.setItem(STORAGE_KEY, "pnpm");
    render(
      <Tabs groupId="pm" persist urlDefault="npm" items={["npm", "pnpm"]}>
        <Tab value="npm">npm content</Tab>
        <Tab value="pnpm">pnpm content</Tab>
      </Tabs>,
    );

    expect(PanelFor("npm content")?.getAttribute("data-state")).toBe("active");
  });

  it("ranks a urlDefault above the author's MDX default", () => {
    render(
      <Tabs
        groupId="pm"
        persist
        default="npm"
        urlDefault="pnpm"
        items={["npm", "pnpm"]}
      >
        <Tab value="npm">npm content</Tab>
        <Tab value="pnpm">pnpm content</Tab>
      </Tabs>,
    );

    expect(PanelFor("pnpm content")?.getAttribute("data-state")).toBe("active");
  });

  it("ignores a stored pick that is not in items", () => {
    window.localStorage.setItem(STORAGE_KEY, "bun");
    render(<PersistGroup />);

    expect(PanelFor("npm content")?.getAttribute("data-state")).toBe("active");
  });

  it("does not write to storage when persist is not set", () => {
    render(
      <Tabs groupId="pm" items={["npm", "pnpm"]}>
        <Tab value="npm">npm content</Tab>
        <Tab value="pnpm">pnpm content</Tab>
      </Tabs>,
    );
    fireEvent.mouseDown(screen.getByRole("tab", { name: "pnpm" }));

    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
