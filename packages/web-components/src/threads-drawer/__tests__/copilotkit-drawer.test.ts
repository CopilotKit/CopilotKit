import { afterEach, expect, test, vi } from "vitest";
import {
  COPILOTKIT_THREADS_DRAWER_TAG,
  CopilotKitThreadsDrawer,
  defineCopilotKitThreadsDrawer,
} from "../index";
import type { DrawerThread } from "../index";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function flush(element: CopilotKitThreadsDrawer) {
  await element.updateComplete;
  await tick();
  await element.updateComplete;
}

function makeThread(overrides: Partial<DrawerThread> = {}): DrawerThread {
  return {
    id: "t1",
    name: "Thread one",
    archived: false,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

type SetupOptions = {
  threads?: DrawerThread[];
  mobile?: boolean;
};

function setMatchMedia(matches: boolean) {
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  const mql = {
    matches,
    media: "",
    onchange: null,
    addEventListener: (_t: string, cb: (e: MediaQueryListEvent) => void) =>
      listeners.add(cb),
    removeEventListener: (_t: string, cb: (e: MediaQueryListEvent) => void) =>
      listeners.delete(cb),
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
  };
  window.matchMedia = vi
    .fn()
    .mockReturnValue(mql) as unknown as typeof window.matchMedia;
  return {
    emit(next: boolean) {
      mql.matches = next;
      listeners.forEach((cb) => cb({ matches: next } as MediaQueryListEvent));
    },
  };
}

async function setup(options: SetupOptions = {}) {
  defineCopilotKitThreadsDrawer();
  const mediaController = setMatchMedia(options.mobile ?? false);
  const element = document.createElement(
    COPILOTKIT_THREADS_DRAWER_TAG,
  ) as CopilotKitThreadsDrawer;
  element.threads = options.threads ?? [makeThread()];
  document.body.appendChild(element);
  await flush(element);

  const events: Array<{ type: string; detail: unknown }> = [];
  const captureTypes = [
    "thread-selected",
    "archive",
    "unarchive",
    "delete",
    "new-thread",
    "filter-change",
    "open-change",
    "retry",
    "licensed",
    "load-more",
  ];
  for (const type of captureTypes) {
    element.addEventListener(type, (e) =>
      events.push({ type, detail: (e as CustomEvent).detail }),
    );
  }

  const shadow = () => element.shadowRoot as ShadowRoot;
  const q = (selector: string) => shadow().querySelector(selector);
  const qa = (selector: string) =>
    Array.from(shadow().querySelectorAll(selector));

  function teardown() {
    element.remove();
    document.body.replaceChildren();
  }

  return { element, events, shadow, q, qa, mediaController, teardown };
}

afterEach(() => {
  document.body.replaceChildren();
  document.body.style.overflow = "";
});

test("registers the custom element idempotently", () => {
  defineCopilotKitThreadsDrawer();
  defineCopilotKitThreadsDrawer();

  expect(customElements.get(COPILOTKIT_THREADS_DRAWER_TAG)).toBe(
    CopilotKitThreadsDrawer,
  );
});

test("renders a row per visible thread into the shadow root", async () => {
  const { qa, teardown } = await setup({
    threads: [
      makeThread({ id: "a", name: "Alpha" }),
      makeThread({ id: "b", name: "Beta" }),
    ],
  });

  const rows = qa("li.row");

  expect(rows).toHaveLength(2);
  teardown();
});

test("a named row carries the full name as a data-tooltip (CPK bubble; shown when clipped)", async () => {
  const longName = "A very long thread name that gets clipped with an ellipsis";
  const { q, teardown } = await setup({
    threads: [makeThread({ id: "a", name: longName })],
  });

  // The full name rides on the row-name as data-tooltip (the same instant-bubble
  // mechanism as the row actions); CSS reveals it only when `.name-clipped`.
  const name = q('[part="row-name"]') as HTMLElement;
  expect(name.getAttribute("data-tooltip")).toBe(longName);
  expect(name.querySelector(".row-name-text")?.textContent).toBe(longName);
  teardown();
});

test("a clipped name marks BOTH the row-name and the owning row (tooltip + z-index stacking contract)", async () => {
  const longName = "A very long thread name that gets clipped with an ellipsis";
  const { element, q, teardown } = await setup({
    threads: [makeThread({ id: "a", name: longName })],
  });

  const row = q("li.row") as HTMLElement;
  const name = q('[part="row-name"]') as HTMLElement;
  const text = name.querySelector(".row-name-text") as HTMLElement;

  // jsdom has no layout, so simulate a truncated text node.
  Object.defineProperty(text, "scrollWidth", {
    value: 200,
    configurable: true,
  });
  Object.defineProperty(text, "clientWidth", {
    value: 100,
    configurable: true,
  });
  (element as unknown as { _syncNameClipping(): void })._syncNameClipping();

  // The tooltip bubble keys off `.row-name.name-clipped`; the z-index lift that
  // frees the bubble from the row's transform stacking context keys off
  // `.row.name-clipped`. BOTH elements must carry the flag — if it only landed
  // on `.row-name` (the original bug), the z-lift selector never matched and the
  // tooltip stayed trapped under later rows.
  expect(name.classList.contains("name-clipped")).toBe(true);
  expect(row.classList.contains("name-clipped")).toBe(true);

  // And it clears on both when the name fits (no stale bubble / z-lift).
  Object.defineProperty(text, "scrollWidth", {
    value: 100,
    configurable: true,
  });
  (element as unknown as { _syncNameClipping(): void })._syncNameClipping();
  expect(name.classList.contains("name-clipped")).toBe(false);
  expect(row.classList.contains("name-clipped")).toBe(false);

  teardown();
});

test("a placeholder (unnamed) row has no name tooltip", async () => {
  const { q, teardown } = await setup({
    threads: [makeThread({ id: "a", name: null })],
  });

  const name = q('[part="row-name"]') as HTMLElement;
  expect(name.classList.contains("placeholder")).toBe(true);
  expect(name.hasAttribute("data-tooltip")).toBe(false);
  teardown();
});

test("emits thread-selected with the thread id on row click", async () => {
  const { q, events, teardown } = await setup({
    threads: [makeThread({ id: "abc", name: "Pick me" })],
  });

  (q('li.row[data-thread-id="abc"]') as HTMLElement).click();

  expect(events).toContainEqual({
    type: "thread-selected",
    detail: { threadId: "abc" },
  });
  teardown();
});

test("emits new-thread when the new-thread button is pressed", async () => {
  const { q, events, teardown } = await setup();

  (q('[part="new-thread-button"]') as HTMLElement).click();

  expect(events.some((e) => e.type === "new-thread")).toBe(true);
  teardown();
});

test("active filter hides archived threads; All shows them and emits filter-change", async () => {
  const { qa, q, events, element, teardown } = await setup({
    threads: [
      makeThread({ id: "a", name: "Active", archived: false }),
      makeThread({ id: "z", name: "Archived", archived: true }),
    ],
  });

  expect(qa("li.row")).toHaveLength(1);

  (q('[part="filter-all"]') as HTMLElement).click();
  await flush(element);

  expect(qa("li.row")).toHaveLength(2);
  expect(events).toContainEqual({
    type: "filter-change",
    detail: { filter: "all" },
  });
  teardown();
});

test("element is authoritative on row order — sorts most-recent-first", async () => {
  const { qa, teardown } = await setup({
    threads: [
      makeThread({
        id: "old",
        name: "Old",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
      makeThread({
        id: "new",
        name: "New",
        updatedAt: "2026-06-20T00:00:00.000Z",
      }),
    ],
  });

  const order = qa("li.row").map((el) => el.getAttribute("data-thread-id"));

  expect(order).toEqual(["new", "old"]);
  teardown();
});

test("emits archive for an active row and unarchive for an archived row", async () => {
  const { q, events, element, teardown } = await setup({
    threads: [makeThread({ id: "a", name: "A", archived: false })],
  });

  (q('[part="row-archive"]') as HTMLElement).click();
  expect(events).toContainEqual({ type: "archive", detail: { threadId: "a" } });

  element.threads = [makeThread({ id: "a", name: "A", archived: true })];
  await flush(element);
  // switch to All filter so the archived row is visible
  (q('[part="filter-all"]') as HTMLElement).click();
  await flush(element);
  (q('[part="row-unarchive"]') as HTMLElement).click();

  expect(events).toContainEqual({
    type: "unarchive",
    detail: { threadId: "a" },
  });
  teardown();
});

test("delete is gated behind a confirm dialog and only fires on confirm", async () => {
  const { q, events, element, teardown } = await setup({
    threads: [makeThread({ id: "del", name: "Delete me" })],
  });

  (q('[part="row-delete"]') as HTMLElement).click();
  await flush(element);

  expect(q('[data-testid="drawer-confirm-delete"]')).not.toBeNull();
  expect(events.some((e) => e.type === "delete")).toBe(false);

  (q('[part="confirm-delete"]') as HTMLElement).click();
  await flush(element);

  expect(events).toContainEqual({
    type: "delete",
    detail: { threadId: "del" },
  });
  expect(q('[data-testid="drawer-confirm-delete"]')).toBeNull();
  teardown();
});

test("confirm dialog can be cancelled without emitting delete", async () => {
  const { q, events, element, teardown } = await setup({
    threads: [makeThread({ id: "del", name: "Delete me" })],
  });

  (q('[part="row-delete"]') as HTMLElement).click();
  await flush(element);
  (q('[part="confirm-cancel"]') as HTMLElement).click();
  await flush(element);

  expect(q('[data-testid="drawer-confirm-delete"]')).toBeNull();
  expect(events.some((e) => e.type === "delete")).toBe(false);
  teardown();
});

test("opening the confirm dialog marks the root `confirming` so row-action tooltips are suppressed", async () => {
  const { q, element, teardown } = await setup({
    threads: [makeThread({ id: "del", name: "Delete me" })],
  });

  const root = () => q('[part="root"]') as HTMLElement;
  expect(root().classList.contains("confirming")).toBe(false);

  (q('[part="row-delete"]') as HTMLElement).click();
  await flush(element);
  // While the dialog is open the clicked trash button keeps :focus-visible; the
  // `confirming` class is what hides its lingering "Delete" tooltip via CSS.
  expect(root().classList.contains("confirming")).toBe(true);

  (q('[part="confirm-cancel"]') as HTMLElement).click();
  await flush(element);
  expect(root().classList.contains("confirming")).toBe(false);
  teardown();
});

test("loading state renders while loading", async () => {
  const { element, q, teardown } = await setup({ threads: [] });
  element.loading = true;
  await flush(element);

  expect(q('[data-testid="drawer-loading"]')).not.toBeNull();
  teardown();
});

test("empty state renders when there are no threads", async () => {
  const { element, q, teardown } = await setup({ threads: [] });
  element.loading = false;
  await flush(element);

  expect(q('[data-testid="drawer-empty"]')).not.toBeNull();
  teardown();
});

test("initial-fetch error is actionable — Retry emits retry{initial}", async () => {
  const { element, q, events, teardown } = await setup({ threads: [] });
  element.error = "Network down";
  await flush(element);

  expect(q('[data-testid="drawer-error"]')).not.toBeNull();
  (q('[part="retry-button"]') as HTMLElement).click();

  expect(events).toContainEqual({
    type: "retry",
    detail: { scope: "initial" },
  });
  teardown();
});

test("locked view replaces the list and the CTA emits the `licensed` event", async () => {
  const { element, q, events, teardown } = await setup({
    threads: [makeThread()],
  });
  element.licensed = false;
  await flush(element);

  expect(q('[data-testid="drawer-licensed"]')).not.toBeNull();
  expect(q("li.row")).toBeNull();

  (q('[part="licensed-cta"]') as HTMLElement).click();

  expect(events.some((e) => e.type === "licensed")).toBe(true);
  teardown();
});

test("locked view beats error — an unlicensed org sees the prompt, not the error state", async () => {
  const { element, q, teardown } = await setup({ threads: [] });
  element.licensed = false;
  element.error = "Some fetch error";
  await flush(element);

  expect(q('[data-testid="drawer-licensed"]')).not.toBeNull();
  expect(q('[data-testid="drawer-error"]')).toBeNull();
  teardown();
});

test("a list error with threads present keeps the list visible (failed mutation does not blank)", async () => {
  const { element, q, qa, teardown } = await setup({
    threads: [makeThread({ id: "a", name: "A" })],
  });

  // `error` reflects the core store error, which a failed mutation also sets.
  element.error = "Delete failed";
  await flush(element);

  // The list and filters stay; the full error panel does NOT replace them.
  expect(qa("li.row")).toHaveLength(1);
  expect(q('[data-testid="drawer-error"]')).toBeNull();
  expect(q('[part="filters"]')).not.toBeNull();
  teardown();
});

test("a list error with NO threads still shows the full error panel", async () => {
  const { element, q, teardown } = await setup({ threads: [] });

  element.error = "Network down";
  await flush(element);

  expect(q('[data-testid="drawer-error"]')).not.toBeNull();
  teardown();
});

test("fetchMore failure keeps the loaded list and offers an inline retry", async () => {
  const { element, q, qa, events, teardown } = await setup({
    threads: [makeThread({ id: "a", name: "A" })],
  });
  element.fetchMoreError = "Couldn't load page 2";
  await flush(element);

  expect(qa("li.row")).toHaveLength(1);
  expect(q('[part="fetch-more-error"]')).not.toBeNull();

  (q('[part="fetch-more-retry"]') as HTMLElement).click();

  expect(events).toContainEqual({
    type: "retry",
    detail: { scope: "fetch-more" },
  });
  teardown();
});

test("renders a Load more button when hasMore and emits load-more on click", async () => {
  const { element, q, events, teardown } = await setup({
    threads: [makeThread({ id: "a", name: "A" })],
  });
  element.hasMore = true;
  await flush(element);

  const btn = q('[part="load-more"]') as HTMLElement | null;
  expect(btn).not.toBeNull();

  btn!.click();

  expect(events).toContainEqual({ type: "load-more", detail: {} });
  teardown();
});

test("hides Load more when there is no next page", async () => {
  const { element, q, teardown } = await setup({
    threads: [makeThread({ id: "a", name: "A" })],
  });
  element.hasMore = false;
  await flush(element);

  expect(q('[part="load-more"]')).toBeNull();
  teardown();
});

test("shows the fetching-more spinner instead of Load more while a page is in flight", async () => {
  const { element, q, teardown } = await setup({
    threads: [makeThread({ id: "a", name: "A" })],
  });
  element.hasMore = true;
  element.fetchingMore = true;
  await flush(element);

  expect(q('[part="load-more"]')).toBeNull();
  expect(q('[part="fetching-more"]')).not.toBeNull();
  teardown();
});

test("null name renders a 'New thread' placeholder", async () => {
  const { q, teardown } = await setup({
    threads: [makeThread({ id: "n", name: null })],
  });

  const name = q('[part="row-name"]') as HTMLElement;

  expect(name.textContent?.trim()).toBe("New thread");
  expect(name.classList.contains("placeholder")).toBe(true);
  teardown();
});

test("async name arrival marks the row name as revealed", async () => {
  const { element, q, teardown } = await setup({
    threads: [makeThread({ id: "n", name: null })],
  });

  element.threads = [makeThread({ id: "n", name: "Now named" })];
  await flush(element);

  const name = q('[part="row-name"]') as HTMLElement;

  expect(name.textContent?.trim()).toBe("Now named");
  expect(name.classList.contains("revealed")).toBe(true);
  teardown();
});

test("open is externally controllable and emits open-change when changed via backdrop", async () => {
  const { element, q, events, teardown } = await setup({ mobile: true });

  expect(element.open).toBe(true);
  (q(".backdrop") as HTMLElement).click();
  await flush(element);

  expect(element.open).toBe(false);
  expect(events).toContainEqual({
    type: "open-change",
    detail: { open: false },
  });
  teardown();
});

test("mobile overlay applies scroll-lock when open and releases it when closed", async () => {
  const { element, teardown } = await setup({ mobile: true });

  expect(document.body.style.overflow).toBe("hidden");

  element.open = false;
  await flush(element);

  expect(document.body.style.overflow).not.toBe("hidden");
  teardown();
});

test("desktop does NOT apply scroll-lock (not a modal)", async () => {
  const { teardown } = await setup({ mobile: false });

  expect(document.body.style.overflow).not.toBe("hidden");
  teardown();
});

test("Escape closes the mobile overlay", async () => {
  const { element, teardown } = await setup({ mobile: true });

  element.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  await flush(element);

  expect(element.open).toBe(false);
  teardown();
});

test("Escape on desktop does NOT close the drawer (no modal behavior)", async () => {
  const { element, teardown } = await setup({ mobile: false });

  element.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  await flush(element);

  expect(element.open).toBe(true);
  teardown();
});

test("mobile modal traps Tab at both boundaries, including the out-of-root backdrop", async () => {
  const { element, teardown } = await setup({
    mobile: true,
    threads: [makeThread({ id: "a", name: "A" })],
  });
  await flush(element);

  const shadow = element.shadowRoot as ShadowRoot;
  const backdrop = shadow.querySelector('[part="backdrop"]') as HTMLElement;
  expect(backdrop).not.toBeNull();
  // Focusables in DOM order: the backdrop (sibling before .root) then the
  // controls inside .root. The trap must treat the backdrop as the first stop.
  const focusables = Array.from(
    shadow.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  );
  const last = focusables[focusables.length - 1]!;
  expect(focusables[0]).toBe(backdrop);
  expect(last).not.toBe(backdrop);

  // Shift+Tab from the backdrop (first) must wrap to the last control — a keydown
  // dispatched ON the backdrop has to reach the HOST-level trap and be handled.
  backdrop.focus();
  const back = new KeyboardEvent("keydown", {
    key: "Tab",
    shiftKey: true,
    bubbles: true,
    composed: true,
    cancelable: true,
  });
  backdrop.dispatchEvent(back);
  expect(back.defaultPrevented).toBe(true);
  expect(shadow.activeElement).toBe(last);

  // Tab from the last control wraps back to the backdrop — focus stays in the modal.
  last.focus();
  const fwd = new KeyboardEvent("keydown", {
    key: "Tab",
    bubbles: true,
    composed: true,
    cancelable: true,
  });
  last.dispatchEvent(fwd);
  expect(fwd.defaultPrevented).toBe(true);
  expect(shadow.activeElement).toBe(backdrop);
  teardown();
});

test("mobile root carries dialog role + aria-modal; desktop is a region", async () => {
  const { element, q, mediaController, teardown } = await setup({
    mobile: true,
  });

  let root = q('[part="root"]') as HTMLElement;
  expect(root.getAttribute("role")).toBe("dialog");
  expect(root.getAttribute("aria-modal")).toBe("true");

  mediaController.emit(false);
  await flush(element);
  root = q('[part="root"]') as HTMLElement;

  expect(root.getAttribute("role")).toBe("region");
  teardown();
});

test("projects a named header slot while keeping the new-thread chrome", async () => {
  const { element, q, teardown } = await setup();
  const headerContent = document.createElement("div");
  headerContent.slot = "header";
  headerContent.id = "custom-header";
  element.appendChild(headerContent);
  await flush(element);

  const slot = q('slot[name="header"]') as HTMLSlotElement;
  const assigned = slot.assignedElements();

  expect(assigned.map((el) => el.id)).toContain("custom-header");
  expect(q('[part="new-thread-button"]')).not.toBeNull();
  teardown();
});

test("memories region stays hidden until a memories slot is populated", async () => {
  const { element, q, teardown } = await setup();

  expect((q('[part="memories"]') as HTMLElement).hidden).toBe(true);

  const mem = document.createElement("div");
  mem.slot = "memories";
  element.appendChild(mem);
  await flush(element);

  expect((q('[part="memories"]') as HTMLElement).hidden).toBe(false);
  teardown();
});

test("exposes ::part hooks and CSS-variable tokens for theming", async () => {
  const { q, teardown } = await setup({
    threads: [makeThread({ id: "t-theme", name: "Theme" })],
  });

  expect(q('[part="root"]')).not.toBeNull();
  expect(q('[part="list"]')).not.toBeNull();
  expect(q('[part~="row"]')).not.toBeNull();

  const sheets = (CopilotKitThreadsDrawer.styles as { cssText: string })
    .cssText;
  expect(sheets).toContain("--cpk-drawer-bg");
  expect(sheets).toContain("var(--cpk-drawer-accent");
  teardown();
});

test("per-row slot projects wrapper row content while keeping selection chrome", async () => {
  const { element, q, teardown } = await setup({
    threads: [makeThread({ id: "row-a", name: "A" })],
  });

  const custom = document.createElement("span");
  custom.slot = "row:row-a";
  custom.id = "custom-row-a";
  custom.textContent = "Custom A";
  element.appendChild(custom);
  await flush(element);

  const slot = q('slot[name="row:row-a"]') as HTMLSlotElement;
  expect(slot).not.toBeNull();
  expect(slot.assignedElements().map((el) => el.id)).toContain("custom-row-a");
  // chrome (archive + delete affordances) still rendered around the slot
  expect(q('[part="row-archive"]')).not.toBeNull();
  expect(q('[part="row-delete"]')).not.toBeNull();
  teardown();
});

// --- Fix 1: error="" falsy gate -------------------------------------------

test("empty-string error does NOT trigger the error state — list still renders", async () => {
  const { element, q, qa, teardown } = await setup({
    threads: [makeThread({ id: "a", name: "A" })],
  });
  element.error = "";
  await flush(element);

  expect(q('[data-testid="drawer-error"]')).toBeNull();
  expect(qa("li.row")).toHaveLength(1);
  // filters stay visible (not hidden behind a phantom error)
  expect(q('[part="filter-active"]')).not.toBeNull();
  teardown();
});

test("whitespace-only error does NOT trigger the error state", async () => {
  const { element, q, qa, teardown } = await setup({
    threads: [makeThread({ id: "a", name: "A" })],
  });
  element.error = "   \n\t ";
  await flush(element);

  expect(q('[data-testid="drawer-error"]')).toBeNull();
  expect(qa("li.row")).toHaveLength(1);
  teardown();
});

test("empty-string fetchMoreError does NOT show the inline fetch-more error", async () => {
  const { element, q, teardown } = await setup({
    threads: [makeThread({ id: "a", name: "A" })],
  });
  element.fetchMoreError = "";
  await flush(element);

  expect(q('[part="fetch-more-error"]')).toBeNull();
  teardown();
});

// --- Fix 2: role="dialog" only when mobile AND open -----------------------

test("mobile-but-closed drawer is NOT a dialog in the a11y tree", async () => {
  const { element, q, teardown } = await setup({ mobile: true });

  element.open = false;
  await flush(element);
  const root = q('[part="root"]') as HTMLElement;

  expect(root.getAttribute("role")).toBe("region");
  expect(root.getAttribute("aria-modal")).toBeNull();
  teardown();
});

// --- Fix 3: _justRevealed clears after the reveal -------------------------

test("reveal class is dropped on the next unrelated re-render (fires once)", async () => {
  const { element, q, teardown } = await setup({
    threads: [makeThread({ id: "n", name: null })],
  });

  element.threads = [makeThread({ id: "n", name: "Now named" })];
  await flush(element);
  expect(
    (q('[part="row-name"]') as HTMLElement).classList.contains("revealed"),
  ).toBe(true);

  // An unrelated re-render (no threads change) must NOT re-apply `revealed`.
  element.collapsed = !element.collapsed;
  await flush(element);

  expect(
    (q('[part="row-name"]') as HTMLElement).classList.contains("revealed"),
  ).toBe(false);
  teardown();
});

// --- Fix 4: _seenNamed pruning --------------------------------------------

test("a removed-then-re-added named thread re-reveals (seen-set was pruned)", async () => {
  const { element, q, teardown } = await setup({
    threads: [makeThread({ id: "x", name: "X" })],
  });

  // remove it
  element.threads = [];
  await flush(element);
  // re-add the SAME id with a name; if _seenNamed were never pruned this would
  // not be treated as a fresh reveal
  element.threads = [makeThread({ id: "x", name: "X again" })];
  await flush(element);

  expect(
    (q('[part="row-name"]') as HTMLElement).classList.contains("revealed"),
  ).toBe(true);
  teardown();
});

// --- Fix 5: stale confirm-delete reconcile --------------------------------

test("pending confirm-delete auto-dismisses when its thread leaves the list", async () => {
  const { element, q, teardown } = await setup({
    threads: [
      makeThread({ id: "del", name: "Delete me" }),
      makeThread({ id: "keep", name: "Keep" }),
    ],
  });

  (
    q('li.row[data-thread-id="del"] [part="row-delete"]') as HTMLElement
  ).click();
  await flush(element);
  expect(q('[data-testid="drawer-confirm-delete"]')).not.toBeNull();

  // consumer removes the thread under confirmation
  element.threads = [makeThread({ id: "keep", name: "Keep" })];
  await flush(element);

  expect(q('[data-testid="drawer-confirm-delete"]')).toBeNull();
  teardown();
});

test("confirm-delete survives an unrelated thread change (same id still present)", async () => {
  const { element, q, events, teardown } = await setup({
    threads: [makeThread({ id: "del", name: "Delete me" })],
  });

  (q('[part="row-delete"]') as HTMLElement).click();
  await flush(element);

  // unrelated change: the same id is still present
  element.threads = [makeThread({ id: "del", name: "Renamed" })];
  await flush(element);
  expect(q('[data-testid="drawer-confirm-delete"]')).not.toBeNull();

  (q('[part="confirm-delete"]') as HTMLElement).click();
  await flush(element);
  expect(events).toContainEqual({
    type: "delete",
    detail: { threadId: "del" },
  });
  teardown();
});

// --- Fix 6: malformed-timestamp sort guard --------------------------------

test("malformed timestamps are not coerced to epoch 0 — dated rows sort first", async () => {
  const { qa, teardown } = await setup({
    threads: [
      makeThread({ id: "bad", name: "Bad", updatedAt: "not-a-date" }),
      makeThread({
        id: "old",
        name: "Old",
        updatedAt: "2020-01-01T00:00:00.000Z",
      }),
      makeThread({
        id: "new",
        name: "New",
        updatedAt: "2026-06-20T00:00:00.000Z",
      }),
    ],
  });

  const order = qa("li.row").map((el) => el.getAttribute("data-thread-id"));

  // valid dates first (most-recent-first); the unparseable row sorts last,
  // NOT pinned to 1970 ahead of the 2020 row.
  expect(order).toEqual(["new", "old", "bad"]);
  teardown();
});

test("multiple malformed timestamps keep their incoming relative order (stable)", async () => {
  const { qa, teardown } = await setup({
    threads: [
      makeThread({ id: "bad1", name: "Bad1", updatedAt: "nope" }),
      makeThread({
        id: "good",
        name: "Good",
        updatedAt: "2026-06-20T00:00:00.000Z",
      }),
      makeThread({ id: "bad2", name: "Bad2", updatedAt: "also-nope" }),
    ],
  });

  const order = qa("li.row").map((el) => el.getAttribute("data-thread-id"));

  expect(order).toEqual(["good", "bad1", "bad2"]);
  teardown();
});

// --- Fix 7: slot-name sanitized id ----------------------------------------

test("a thread id with whitespace does NOT emit a malformed row slot", async () => {
  const { element, q, qa, teardown } = await setup({
    threads: [makeThread({ id: "bad id", name: "Spacey" })],
  });

  // no per-row slot is rendered for the unsafe id...
  expect(qa("slot[name^='row:']")).toHaveLength(0);
  // ...but the row + its default name still render
  expect(qa("li.row")).toHaveLength(1);
  expect((q('[part="row-name"]') as HTMLElement).textContent?.trim()).toBe(
    "Spacey",
  );
  teardown();
});

test("a safe thread id still emits its row slot for projection", async () => {
  const { q, teardown } = await setup({
    threads: [makeThread({ id: "safe-id_123", name: "OK" })],
  });

  expect(q('slot[name="row:safe-id_123"]')).not.toBeNull();
  teardown();
});

test("row actions render icons (not text) with instant tooltips", async () => {
  const { q, teardown } = await setup({
    threads: [makeThread({ id: "a", name: "A", archived: false })],
  });

  const archive = q('[part="row-archive"]') as HTMLElement;
  const del = q('[part="row-delete"]') as HTMLElement;

  expect(archive.querySelector("svg.row-action-icon")).not.toBeNull();
  expect(del.querySelector("svg.row-action-icon")).not.toBeNull();
  // tooltip carried on a data attribute (CSS instant tooltip), NOT native title
  expect(archive.getAttribute("data-tooltip")).toBe("Archive");
  expect(del.getAttribute("data-tooltip")).toBe("Delete");
  expect(archive.hasAttribute("title")).toBe(false);
  teardown();
});

test("archived rows are muted, not struck through", async () => {
  const { q, element, teardown } = await setup({
    threads: [makeThread({ id: "a", name: "A", archived: true })],
  });
  (q('[part="filter-all"]') as HTMLElement).click();
  await flush(element);

  const name = q(".row.archived .row-name") as HTMLElement;
  expect(name).not.toBeNull();
  expect(getComputedStyle(name).textDecorationLine).not.toContain(
    "line-through",
  );
  teardown();
});

test("a refetch keeps the known list visible instead of flashing loading", async () => {
  const { q, qa, element, teardown } = await setup({
    threads: [makeThread({ id: "a", name: "A" })],
  });

  // loading goes true during a refetch while threads are already known
  element.loading = true;
  await flush(element);

  expect(q('[data-testid="drawer-loading"]')).toBeNull();
  expect(qa("li.row")).toHaveLength(1);
  teardown();
});

test("the footer region stays hidden when nothing is slotted into it", async () => {
  const { q, teardown } = await setup({ threads: [makeThread()] });

  const footer = q('[part="footer"]') as HTMLElement;
  expect(footer).not.toBeNull();
  expect(footer.hasAttribute("hidden")).toBe(true);
  teardown();
});

test("mobile renders a self-owned launcher that opens the drawer", async () => {
  const { q, element, teardown } = await setup({
    mobile: true,
    threads: [makeThread()],
  });
  // start closed so the launcher (open-affordance) shows
  element.open = false;
  await flush(element);

  const launcher = q('[part="launcher"]') as HTMLElement;
  expect(launcher).not.toBeNull();
  // icon is swappable via a named slot (CPK slot convention)
  expect(launcher.querySelector('slot[name="launcher-icon"]')).not.toBeNull();

  launcher.click();
  await flush(element);
  expect(element.open).toBe(true);
  teardown();
});

test("desktop does NOT render the mobile launcher", async () => {
  const { q, element, teardown } = await setup({
    mobile: false,
    threads: [makeThread()],
  });
  element.open = false;
  await flush(element);

  expect(q('[part="launcher"]')).toBeNull();
  teardown();
});

// ---------------------------------------------------------------------------
// label property
// ---------------------------------------------------------------------------

test("label defaults to Threads: root panel aria-label, listbox aria-label, and default header text are all Threads", async () => {
  const { element, q, teardown } = await setup();

  const root = q("[part='root']") as HTMLElement;
  const list = q("[role='listbox']") as HTMLElement;
  const headerSpan = q("slot[name='header'] span") as HTMLElement;

  expect(root.getAttribute("aria-label")).toBe("Threads");
  expect(list.getAttribute("aria-label")).toBe("Threads");
  expect(headerSpan.textContent?.trim()).toBe("Threads");
  expect(element.label).toBe("Threads");

  teardown();
});

test("setting label updates root panel aria-label, listbox aria-label, and default header text", async () => {
  const { element, q, teardown } = await setup();

  element.label = "My Conversations";
  await flush(element);

  const root = q("[part='root']") as HTMLElement;
  const list = q("[role='listbox']") as HTMLElement;
  const headerSpan = q("slot[name='header'] span") as HTMLElement;

  expect(root.getAttribute("aria-label")).toBe("My Conversations");
  expect(list.getAttribute("aria-label")).toBe("My Conversations");
  expect(headerSpan.textContent?.trim()).toBe("My Conversations");

  teardown();
});

// --- Scroll fix: :host height + .list min-height:0 -------------------------

test("list is scrollable in a bounded container — CSS contract: :host has height:100% and .list has min-height:0", async () => {
  // jsdom has no real layout engine, so scrollHeight/clientHeight are always 0.
  // Instead we assert the CSS contract directly: the adopted stylesheet must
  // declare `height: 100%` on `:host` (so the element fills a bounded host and
  // doesn't grow to content height) and `min-height: 0` on `.list` (so the flex
  // child can shrink below its content height and scroll rather than expand the
  // panel).  This is the same approach used by the "exposes ::part hooks" test
  // which reads CopilotKitThreadsDrawer.styles.cssText to verify declarations.
  const sheets = (CopilotKitThreadsDrawer.styles as { cssText: string })
    .cssText;

  // :host block must contain height: 100%
  expect(sheets).toContain("height: 100%");

  // .list block must contain min-height: 0
  // We check both declarations are present; the ordering within the block is
  // not significant for correctness.
  expect(sheets).toContain("min-height: 0");
});
