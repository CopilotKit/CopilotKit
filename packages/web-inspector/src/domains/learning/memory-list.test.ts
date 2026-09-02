import type { Memory } from "@copilotkit/core";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CpkMemoryList } from "./memory-list.js";

declare global {
  interface HTMLElementTagNameMap {
    "cpk-memory-list": CpkMemoryList;
  }
}

const memories: Memory[] = [
  {
    id: "topical",
    kind: "topical",
    scope: "user",
    content: "Likes cats",
    sourceThreadIds: [],
    invalidatedAt: null,
  },
  {
    id: "episodic",
    kind: "episodic",
    scope: "user",
    content: "First login was on a Monday",
    sourceThreadIds: [],
    invalidatedAt: null,
  },
  {
    id: "operational",
    kind: "operational",
    scope: "project",
    content: "Deploys on Thursdays",
    sourceThreadIds: ["thread-1"],
    invalidatedAt: null,
  },
];

async function mountList(initialMemories = memories) {
  const element = document.createElement("cpk-memory-list");
  element.memories = initialMemories;
  document.body.append(element);
  await element.updateComplete;
  return element;
}

function requireElement<T extends Element>(
  root: ParentNode,
  selector: string,
): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing test element: ${selector}`);
  return element;
}

function requireShadowRoot(element: Element): ShadowRoot {
  const root = element.shadowRoot;
  if (!root) throw new Error("Expected element to have a shadow root");
  return root;
}

describe("CpkMemoryList", () => {
  beforeAll(() => {
    if (!customElements.get("cpk-memory-list")) {
      customElements.define("cpk-memory-list", CpkMemoryList);
    }
  });

  afterEach(() => document.body.replaceChildren());

  it("renders one card per memory in order", async () => {
    const element = await mountList();
    const root = requireShadowRoot(element);
    const contents = Array.from(
      root.querySelectorAll(".cpk-ml__content"),
      (content) => content.textContent?.trim(),
    );

    expect(contents).toEqual([
      "Likes cats",
      "First login was on a Monday",
      "Deploys on Thursdays",
    ]);
  });

  it("filters records by kind and search text", async () => {
    const element = await mountList();
    const root = requireShadowRoot(element);

    requireElement<HTMLButtonElement>(
      root,
      '[data-kind="operational"]',
    ).click();
    await element.updateComplete;
    expect(root.querySelectorAll(".cpk-ml__card")).toHaveLength(1);

    requireElement<HTMLButtonElement>(root, '[data-kind="all"]').click();
    const search = requireElement<HTMLInputElement>(
      root,
      ".cpk-ml__search-input",
    );
    search.value = "cats";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    await element.updateComplete;

    expect(root.querySelectorAll(".cpk-ml__card")).toHaveLength(1);
    expect(root.textContent).toContain("Likes cats");
  });

  it("narrows cards when an operational kind filter is clicked", async () => {
    const element = await mountList();
    const root = requireShadowRoot(element);

    requireElement<HTMLButtonElement>(
      root,
      '[data-kind="operational"]',
    ).click();
    await element.updateComplete;

    const cards = root.querySelectorAll(".cpk-ml__card");
    expect(cards).toHaveLength(1);
    expect(cards[0]?.textContent).toContain("Deploys on Thursdays");
  });

  it("filters cards by search text case-insensitively", async () => {
    const element = await mountList();
    const root = requireShadowRoot(element);
    const search = requireElement<HTMLInputElement>(
      root,
      ".cpk-ml__search-input",
    );

    search.value = "DEPLOY";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    await element.updateComplete;

    const cards = root.querySelectorAll(".cpk-ml__card");
    expect(cards).toHaveLength(1);
    expect(cards[0]?.textContent).toContain("Deploys on Thursdays");
  });

  it("shows the empty state when memories is empty", async () => {
    const element = await mountList([]);
    const root = requireShadowRoot(element);

    expect(root.querySelector(".cpk-ml__empty")).not.toBeNull();
    expect(root.textContent).toContain("No learning records yet");
    expect(root.querySelectorAll(".cpk-ml__card")).toHaveLength(0);
  });

  it("dispatches a trimmed semantic recall query", async () => {
    const element = await mountList([]);
    const submitted = vi.fn<(event: Event) => void>();
    element.addEventListener("recallSubmitted", submitted);
    const root = requireShadowRoot(element);
    const input = requireElement<HTMLInputElement>(
      root,
      ".cpk-ml__recall-input",
    );

    input.value = "  durable preference  ";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    requireElement<HTMLFormElement>(root, "form").dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );

    expect(submitted).toHaveBeenCalledOnce();
    expect(submitted.mock.calls[0]?.[0]).toMatchObject({
      detail: "durable preference",
    });
  });
});
