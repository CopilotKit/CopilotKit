// @vitest-environment jsdom

// Behavioural tests for the docs search modal. They drive the real
// component — type into the real input, read the real result rows,
// navigate through the real click handler — so they stay true when
// scoring constants are retuned. Only the ambient wiring (router,
// framework provider, runtime config) is faked.

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

const pushed: string[] = [];
// The surface the reader is on. Mutable so a test can put the reader on a
// frontend other than React and watch the ranking follow them.
let currentPathname = "/quickstart";
vi.mock("next/navigation", () => ({
  usePathname: () => currentPathname,
  useRouter: () => ({
    push: (href: string) => {
      pushed.push(href);
    },
  }),
}));

vi.mock("../framework-provider", () => ({
  DEFAULT_FRAMEWORK: "built-in-agent",
  useFramework: () => ({
    effectiveFramework: "built-in-agent",
    knownFrameworks: [],
    setStoredFramework: () => {},
  }),
}));

import { SearchModal } from "../search-modal";

const SHELL_HOST = "https://showcase.copilotkit.test";

function resultRows(): HTMLElement[] {
  const list = screen.queryByRole("listbox", { name: "Search results" });
  if (!list) return [];
  // Scoped to the results listbox on purpose. The recommendation block is a
  // separate one-option listbox of its own, so a page-wide option query
  // would count it as a thirteenth result.
  return within(list).queryAllByRole("option");
}

function resultTitles(): string[] {
  return resultRows().map(
    (row) =>
      row.querySelector("[data-search-result-title]")?.textContent?.trim() ??
      "",
  );
}

/**
 * Where each visible row leads, in the order the rows are shown. Read by
 * clicking every row, which is the only way the destination is observable
 * from outside the component.
 */
function resultHrefs(): string[] {
  const before = pushed.length;
  for (const row of resultRows()) fireEvent.click(row);
  return pushed.slice(before);
}

/** Frontends whose pages a React reader should see demoted. */
const FOREIGN_PREFIXES = [
  "/angular/",
  "/vue/",
  "/react-native/",
  "/slack/",
  "/teams/",
  "/reference/angular/",
  "/reference/vue/",
  "/reference/react-native/",
];

function belongsToAnotherFrontend(href: string): boolean {
  return FOREIGN_PREFIXES.some((prefix) => href.startsWith(prefix));
}

async function search(query: string): Promise<void> {
  render(<SearchModal onClose={() => {}} />);
  // The framework picker and the docs-folder map come from a dynamically
  // imported registry.json — wait for it before typing so results are
  // built from the same inputs a real user's search sees.
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: /Choose docs framework/ }).textContent,
    ).not.toContain("Loading frameworks"),
  );
  fireEvent.change(screen.getByRole("combobox"), { target: { value: query } });
  await waitFor(() => expect(resultRows().length).toBeGreaterThan(0));
}

beforeEach(() => {
  pushed.length = 0;
  window.__SHOWCASE_CONFIG__ = {
    baseUrl: "https://docs.copilotkit.test/",
    shellUrl: SHELL_HOST,
    intelligenceSignupUrl: "https://ops.copilotkit.test/",
    posthogKey: "",
    posthogHost: "https://posthog.test/",
    scarfPixelId: "",
    googleAnalyticsTrackingId: "",
    reb2bKey: "",
    reoKey: "",
    clerkPublishableKey: "",
  };
});

afterEach(() => {
  cleanup();
  delete window.__SHOWCASE_CONFIG__;
  currentPathname = "/quickstart";
});

// "chat", "tools" and "state" are the queries that used to fan out into
// feature-registry rows: many differently titled results that every one
// of them navigated to the docs home page.
const QUERIES = ["chat", "tools", "state", "threads", "intelligence"];

describe("docs search results stay on the docs host", () => {
  for (const query of QUERIES) {
    it(`routes every "${query}" result to a real docs route`, async () => {
      await search(query);

      const rows = resultRows();
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) fireEvent.click(row);

      expect(pushed.length).toBe(rows.length);
      for (const href of pushed) {
        // No showcase-host destination, no absolute URL of any kind.
        expect(href).not.toContain(SHELL_HOST);
        expect(href).not.toMatch(/^(https?:)?\/\//);
        expect(href.startsWith("/")).toBe(true);
        // The docs home page is never a stand-in destination.
        expect(href).not.toBe("/");
      }
    });
  }
});

describe("docs search ordering", () => {
  it("ranks the canonical Threads guide above the threads drawer page", async () => {
    await search("threads");

    const titles = resultTitles();
    expect(titles).toContain("Rich Threads");
    expect(titles).toContain("Threads Drawer");
    expect(titles.indexOf("Rich Threads")).toBeLessThan(
      titles.indexOf("Threads Drawer"),
    );
  });

  it("ranks the Intelligence landing page above pages that merely mention it", async () => {
    await search("intelligence");

    const titles = resultTitles();
    expect(titles[0]).toBe("CopilotKit Intelligence");
    expect(titles.indexOf("CopilotKit Intelligence")).toBeLessThan(
      titles.indexOf("Self-host CopilotKit Intelligence"),
    );
  });

  it("produces the same order for the same query twice", async () => {
    await search("threads");
    const first = resultTitles();
    cleanup();
    await search("threads");

    expect(resultTitles()).toEqual(first);
  });
});

describe("the reader's own frontend ranks above the others", () => {
  it("keeps other frontends below agnostic rows for a React reader", async () => {
    await search("chat");

    const hrefs = resultHrefs();
    const firstForeign = hrefs.findIndex(belongsToAnotherFrontend);
    const lastOwn = hrefs.map(belongsToAnotherFrontend).lastIndexOf(false);

    // Nothing is filtered out — a foreign row may still appear — but it
    // can never sit above a row the reader can actually use.
    expect(firstForeign === -1 || firstForeign > lastOwn).toBe(true);
    expect(hrefs.slice(0, 3).every((h) => !belongsToAnotherFrontend(h))).toBe(
      true,
    );
  });

  // A reference symbol documented once per frontend is where the demotion
  // is observable on its own: the copies share a type, a title and a title
  // length, so nothing but the penalty separates them. Take the penalty
  // away and the destination tie-break decides — "/reference/angular/…"
  // sorts BEFORE "/reference/components/…" — so the foreign copies would
  // take the visible slots instead of losing them.
  it("keeps another frontend's copy of a component out of the visible rows", async () => {
    await search("copilotchat");

    const hrefs = resultHrefs();
    expect(hrefs).toContain("/reference/components/CopilotChat");
    expect(hrefs.filter(belongsToAnotherFrontend)).toEqual([]);
  });

  // The mirror image, and what it pins is the surface detection rather than
  // the size of the penalty: on an Angular route Angular is the reader's own
  // frontend, so its copy leads and React's agnostic copy follows. Ignore
  // the reader's surface and the Angular rows become foreign and vanish, as
  // they do in the test above.
  it("follows the reader onto an Angular surface", async () => {
    currentPathname = "/angular/quickstart";
    await search("copilotchat");

    const hrefs = resultHrefs();
    expect(hrefs).toContain("/reference/angular/components/CopilotChat");
    expect(
      hrefs.indexOf("/reference/angular/components/CopilotChat"),
    ).toBeLessThan(hrefs.indexOf("/reference/components/CopilotChat"));
  });

  // NOT tested, deliberately: the waiver that drops the penalty when the
  // query names a frontend ("angular chat"). It is not observable through
  // the result list, because every term must match for a row to appear at
  // all — naming a frontend filters the agnostic rows out before ranking, so
  // there is nothing left for a demoted row to lose to. Measured on the real
  // index: "angular chat" matches 24 rows, 23 of them Angular's own, and a
  // bare "angular" matches 78 with only 3 agnostic. The waiver stays in the
  // code as a guard for a query where that ratio is different; a test
  // asserting it here would pass with the waiver removed and would only look
  // like coverage.
});

describe("the deprecated V1 reference", () => {
  it("sorts last, below everything else", async () => {
    await search("copilotruntime");

    const hrefs = resultHrefs();
    const v1 = hrefs.filter((href) => href.startsWith("/reference/v1/"));
    // Demoted, never filtered: still reachable, just last.
    expect(v1.length).toBeGreaterThan(0);
    expect(hrefs.slice(-v1.length)).toEqual(v1);
  });

  it("is marked as deprecated in the row", async () => {
    await search("copilotruntime");

    const rows = resultRows();
    const marked = rows.filter((row) =>
      row.querySelector("[data-search-result-deprecated]"),
    );
    expect(marked.length).toBeGreaterThan(0);
    expect(marked[0].textContent).toContain("Deprecated");
    // Only the V1 rows carry it.
    expect(marked.length).toBeLessThan(rows.length);
  });
});

describe("punctuation and camelCase do not defeat the match", () => {
  // The apostrophe sits on the READER's side of this comparison: the
  // announcement pages live under a section spelled "Whats new", while a
  // reader naturally types the phrase with an apostrophe. Without folding
  // punctuation out of the query, "what's new" finds nothing at all.
  it('finds the announcement pages from "what\'s new"', async () => {
    await search("what's new");

    expect(resultHrefs().some((href) => href.startsWith("/whats-new/"))).toBe(
      true,
    );
  });

  it('finds the same pages from "whats new"', async () => {
    await search("whats new");

    expect(resultHrefs().some((href) => href.startsWith("/whats-new/"))).toBe(
      true,
    );
  });

  it('ranks useCopilotKit near the top of "use Copilot kit"', async () => {
    await search("use Copilot kit");

    // Spelling the identifier out in words names it exactly, so it beats
    // the pages that merely happen to contain all three words.
    expect(resultHrefs().slice(0, 3)).toContain(
      "/reference/hooks/useCopilotKit",
    );
  });

  it('finds CopilotChat from "copilot chat"', async () => {
    await search("copilot chat");

    expect(resultTitles()[0]).toBe("CopilotChat");
  });

  it('finds "AG-UI" from "ag ui"', async () => {
    await search("ag ui");

    expect(resultTitles()[0]).toBe("AG-UI");
    expect(resultHrefs()[0]).toBe("/agentic-protocols/ag-ui");
  });

  it("does not turn an unrelated query into a match", async () => {
    render(<SearchModal onClose={() => {}} />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Choose docs framework/ })
          .textContent,
      ).not.toContain("Loading frameworks"),
    );
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "kubernetes ingress" },
    });

    await waitFor(() =>
      expect(screen.getByText(/No results for/)).toBeTruthy(),
    );
    expect(resultRows()).toHaveLength(0);
  });
});

describe("keyboard selection scrolls the list", () => {
  let scrolled: Array<{ id: string; options: unknown }>;

  beforeEach(() => {
    scrolled = [];
    // jsdom does not implement scrollIntoView, so the component's optional
    // call is a no-op until one is provided here.
    Element.prototype.scrollIntoView = function (
      this: HTMLElement,
      options?: unknown,
    ) {
      scrolled.push({ id: this.id, options });
    } as typeof Element.prototype.scrollIntoView;
  });

  afterEach(() => {
    // @ts-expect-error putting back jsdom's missing implementation
    delete Element.prototype.scrollIntoView;
  });

  it("brings the keyboard-selected row into view with the smallest scroll", async () => {
    await search("chat");

    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });

    // No recommendation block for "chat", so two presses land on row 2.
    const last = scrolled[scrolled.length - 1];
    expect(last.id).toBe(resultRows()[2].id);
    expect(last.options).toEqual({ block: "nearest" });
  });

  it("does not scroll when hover moves the selection", async () => {
    await search("chat");

    scrolled.length = 0;
    fireEvent.mouseEnter(resultRows()[5]);

    expect(resultRows()[5].getAttribute("aria-selected")).toBe("true");
    expect(scrolled).toHaveLength(0);
  });

  it("stops on the last row rather than wrapping to the top", async () => {
    await search("chat");

    const input = screen.getByRole("combobox");
    const rowCount = resultRows().length;
    for (let i = 0; i < rowCount + 3; i += 1) {
      fireEvent.keyDown(input, { key: "ArrowDown" });
    }

    expect(resultRows()[rowCount - 1].getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(resultRows()[0].getAttribute("aria-selected")).toBe("false");
  });
});
