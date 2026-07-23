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
  /**
   * Initial `open` state. The element defaults `open` to `false` (so a mobile
   * first render never flashes the modal), so mobile-modal tests that want the
   * drawer open at mount must opt in explicitly.
   */
  open?: boolean;
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
  if (options.open !== undefined) element.open = options.open;
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
    "collapse-change",
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

  // The Active/All options live in the funnel popover — open it first.
  (q('[part="filter-toggle"]') as HTMLElement).click();
  await flush(element);
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

  // Row actions live in the per-row kebab menu — open it before acting.
  (q('[part="row-menu"]') as HTMLElement).click();
  await flush(element);
  (q('[part="row-archive"]') as HTMLElement).click();
  expect(events).toContainEqual({ type: "archive", detail: { threadId: "a" } });

  element.threads = [makeThread({ id: "a", name: "A", archived: true })];
  await flush(element);
  // switch to All filter (via the funnel popover) so the archived row is visible
  (q('[part="filter-toggle"]') as HTMLElement).click();
  await flush(element);
  (q('[part="filter-all"]') as HTMLElement).click();
  await flush(element);
  (q('[part="row-menu"]') as HTMLElement).click();
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

  (q('[part="row-menu"]') as HTMLElement).click();
  await flush(element);
  (q('[part="row-delete"]') as HTMLElement).click();
  await flush(element);

  // The <dialog> is always in the DOM now; the confirm state is its OPEN state.
  // jsdom lacks showModal(), so the element falls back to the `open` attribute,
  // which `HTMLDialogElement.open` reflects.
  const dialog = q(
    '[data-testid="drawer-confirm-delete"]',
  ) as HTMLDialogElement;
  expect(dialog).not.toBeNull();
  expect(dialog.open).toBe(true);
  expect(events.some((e) => e.type === "delete")).toBe(false);

  (q('[part="confirm-delete"]') as HTMLElement).click();
  await flush(element);

  expect(events).toContainEqual({
    type: "delete",
    detail: { threadId: "del" },
  });
  expect(dialog.open).toBe(false);
  teardown();
});

test("confirm dialog can be cancelled without emitting delete", async () => {
  const { q, events, element, teardown } = await setup({
    threads: [makeThread({ id: "del", name: "Delete me" })],
  });

  (q('[part="row-menu"]') as HTMLElement).click();
  await flush(element);
  (q('[part="row-delete"]') as HTMLElement).click();
  await flush(element);
  const dialog = q(
    '[data-testid="drawer-confirm-delete"]',
  ) as HTMLDialogElement;
  expect(dialog.open).toBe(true);
  (q('[part="confirm-cancel"]') as HTMLElement).click();
  await flush(element);

  expect(dialog.open).toBe(false);
  expect(events.some((e) => e.type === "delete")).toBe(false);
  teardown();
});

test("native dialog cancel (Escape) resets the confirm state without deleting", async () => {
  const { q, events, element, teardown } = await setup({
    threads: [makeThread({ id: "del", name: "Delete me" })],
  });

  (q('[part="row-menu"]') as HTMLElement).click();
  await flush(element);
  (q('[part="row-delete"]') as HTMLElement).click();
  await flush(element);
  const dialog = q(
    '[data-testid="drawer-confirm-delete"]',
  ) as HTMLDialogElement;
  expect(dialog.open).toBe(true);

  // Simulate the browser's native Escape dismissal, which fires `cancel`.
  dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
  await flush(element);

  expect(dialog.open).toBe(false);
  expect(events.some((e) => e.type === "delete")).toBe(false);
  teardown();
});

test("opening a row menu marks the list so other rows are shielded from hover", async () => {
  const { q, qa, element, teardown } = await setup({
    threads: [
      makeThread({ id: "a", name: "Thread A" }),
      makeThread({ id: "b", name: "Thread B" }),
    ],
  });
  const list = q('[part="list"]') as HTMLElement;
  expect(list.classList.contains("menu-open")).toBe(false);

  // Open the first row's kebab menu. The list gains `menu-open`, which the
  // stylesheet uses to freeze pointer events on every non-owner row so hover
  // affordances no longer bleed around/behind the open popover.
  (qa('[part="row-menu"]')[0] as HTMLElement).click();
  await flush(element);
  expect(list.classList.contains("menu-open")).toBe(true);
  const rows = qa(".row");
  expect(rows[0].classList.contains("menu-open")).toBe(true);
  expect(rows[1].classList.contains("menu-open")).toBe(false);

  // Selecting a row (or otherwise closing the menu) clears the shield.
  (rows[1] as HTMLElement).click();
  await flush(element);
  expect(list.classList.contains("menu-open")).toBe(false);
  teardown();
});

test("clicking the confirm dialog's backdrop dismisses it without deleting", async () => {
  const { q, events, element, teardown } = await setup({
    threads: [makeThread({ id: "del", name: "Delete me" })],
  });

  (q('[part="row-menu"]') as HTMLElement).click();
  await flush(element);
  (q('[part="row-delete"]') as HTMLElement).click();
  await flush(element);
  const dialog = q(
    '[data-testid="drawer-confirm-delete"]',
  ) as HTMLDialogElement;
  expect(dialog.open).toBe(true);

  // A click whose target is the <dialog> itself lands on the ::backdrop (not
  // the inner card) and must dismiss without emitting delete.
  dialog.click();
  await flush(element);

  expect(dialog.open).toBe(false);
  expect(events.some((e) => e.type === "delete")).toBe(false);
  teardown();
});

test("Escape while confirming delete on mobile does NOT close the drawer", async () => {
  const { q, element, teardown } = await setup({
    mobile: true,
    open: true,
    threads: [makeThread({ id: "del", name: "Delete me" })],
  });

  (q('[part="row-menu"]') as HTMLElement).click();
  await flush(element);
  (q('[part="row-delete"]') as HTMLElement).click();
  await flush(element);
  const dialog = q(
    '[data-testid="drawer-confirm-delete"]',
  ) as HTMLDialogElement;
  expect(dialog.open).toBe(true);

  // The Escape keydown bubbles from the modal dialog to the host handler. It
  // must be consumed by the confirm guard, NOT fall through to the mobile-close
  // branch — otherwise dismissing the confirmation also closes the drawer.
  element.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  await flush(element);

  expect(element.open).toBe(true);
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

test("locked view replaces the list and the CTA emits `licensed` + opens the default licenseUrl", async () => {
  const open = vi
    .spyOn(window, "open")
    .mockReturnValue(null as unknown as Window);
  const { element, q, events, teardown } = await setup({
    threads: [makeThread()],
  });
  element.licensed = false;
  await flush(element);

  expect(q('[data-testid="drawer-licensed"]')).not.toBeNull();
  expect(q("li.row")).toBeNull();

  (q('[part="licensed-cta"]') as HTMLElement).click();

  const licensedEvent = events.find((e) => e.type === "licensed");
  expect(licensedEvent).toBeDefined();
  expect(licensedEvent?.detail).toEqual({
    licenseUrl: "https://docs.copilotkit.ai/intelligence",
  });
  expect(open).toHaveBeenCalledWith(
    "https://docs.copilotkit.ai/intelligence",
    "_blank",
    "noopener,noreferrer",
  );
  open.mockRestore();
  teardown();
});

test("the Upgrade CTA opens a host-provided licenseUrl", async () => {
  const open = vi
    .spyOn(window, "open")
    .mockReturnValue(null as unknown as Window);
  const { element, q, teardown } = await setup({ threads: [] });
  element.licensed = false;
  element.licenseUrl = "https://example.com/upgrade";
  await flush(element);

  (q('[part="licensed-cta"]') as HTMLElement).click();

  expect(open).toHaveBeenCalledWith(
    "https://example.com/upgrade",
    "_blank",
    "noopener,noreferrer",
  );
  open.mockRestore();
  teardown();
});

test("calling preventDefault on the `licensed` event suppresses the default navigation", async () => {
  const open = vi
    .spyOn(window, "open")
    .mockReturnValue(null as unknown as Window);
  const { element, q, teardown } = await setup({ threads: [] });
  element.licensed = false;
  await flush(element);
  element.addEventListener("licensed", (e) => e.preventDefault());

  (q('[part="licensed-cta"]') as HTMLElement).click();

  expect(open).not.toHaveBeenCalled();
  open.mockRestore();
  teardown();
});

test("a blank licenseUrl emits the event but performs no navigation", async () => {
  const open = vi
    .spyOn(window, "open")
    .mockReturnValue(null as unknown as Window);
  const { element, q, events, teardown } = await setup({ threads: [] });
  element.licensed = false;
  element.licenseUrl = "";
  await flush(element);

  (q('[part="licensed-cta"]') as HTMLElement).click();

  expect(events.some((e) => e.type === "licensed")).toBe(true);
  expect(open).not.toHaveBeenCalled();
  open.mockRestore();
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

  // The list and filter affordance stay; the full error panel does NOT replace
  // them. The funnel toggle is the always-present filter control (the Active/All
  // options live inside its popover).
  expect(qa("li.row")).toHaveLength(1);
  expect(q('[data-testid="drawer-error"]')).toBeNull();
  expect(q('[part="filter-toggle"]')).not.toBeNull();
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
  const { element, q, events, teardown } = await setup({
    mobile: true,
    open: true,
  });

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

test("mobile open drawer shows a header close button that closes it (open-change); desktop has none", async () => {
  const { element, q, events, teardown } = await setup({
    mobile: true,
    open: true,
  });
  const close = q('[part="close-toggle"]') as HTMLElement | null;
  expect(close).not.toBeNull();
  close!.click();
  await flush(element);
  expect(element.open).toBe(false);
  expect(events).toContainEqual({
    type: "open-change",
    detail: { open: false },
  });
  teardown();

  // Desktop is a persistent sidebar — no close affordance.
  const desktop = await setup({ mobile: false });
  expect(desktop.q('[part="close-toggle"]')).toBeNull();
  desktop.teardown();
});

test("mobile overlay applies scroll-lock when open and releases it when closed", async () => {
  const { element, teardown } = await setup({ mobile: true, open: true });

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

test("defaults to closed on a mobile first render — no backdrop, no scroll-lock until opened", async () => {
  // Regression guard for the mobile open-flash: a freshly-created element must
  // default `open` to false so a mobile-width first render does NOT paint the
  // modal (backdrop + body scroll-lock) before a wrapper can close it.
  const { element, q, teardown } = await setup({ mobile: true });

  expect(element.open).toBe(false);
  expect(q(".backdrop")).toBeNull();
  expect(document.body.style.overflow).not.toBe("hidden");

  // Opening it explicitly now applies the mobile-modal treatment.
  element.open = true;
  await flush(element);
  expect(q(".backdrop")).not.toBeNull();
  expect(document.body.style.overflow).toBe("hidden");
  teardown();
});

test("Escape closes the mobile overlay", async () => {
  const { element, teardown } = await setup({ mobile: true, open: true });

  element.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  await flush(element);

  expect(element.open).toBe(false);
  teardown();
});

test("Escape on desktop does NOT close the drawer (no modal behavior)", async () => {
  const { element, teardown } = await setup({ mobile: false, open: true });

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
    open: true,
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
    open: true,
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
  // chrome (archive + delete affordances) still rendered around the slot —
  // they now live in the per-row kebab menu, so open it first.
  (q('[part="row-menu"]') as HTMLElement).click();
  await flush(element);
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
  // filter affordance stays visible (not hidden behind a phantom error)
  expect(q('[part="filter-toggle"]')).not.toBeNull();
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
  // (Uses a label change to trigger a re-render without touching `threads`.)
  element.label = "Renamed";
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

  (q('li.row[data-thread-id="del"] [part="row-menu"]') as HTMLElement).click();
  await flush(element);
  (
    q('li.row[data-thread-id="del"] [part="row-delete"]') as HTMLElement
  ).click();
  await flush(element);
  const dialog = q(
    '[data-testid="drawer-confirm-delete"]',
  ) as HTMLDialogElement;
  expect(dialog.open).toBe(true);

  // consumer removes the thread under confirmation
  element.threads = [makeThread({ id: "keep", name: "Keep" })];
  await flush(element);

  expect(dialog.open).toBe(false);
  teardown();
});

test("confirm-delete survives an unrelated thread change (same id still present)", async () => {
  const { element, q, events, teardown } = await setup({
    threads: [makeThread({ id: "del", name: "Delete me" })],
  });

  (q('[part="row-menu"]') as HTMLElement).click();
  await flush(element);
  (q('[part="row-delete"]') as HTMLElement).click();
  await flush(element);

  // unrelated change: the same id is still present
  element.threads = [makeThread({ id: "del", name: "Renamed" })];
  await flush(element);
  expect(
    (q('[data-testid="drawer-confirm-delete"]') as HTMLDialogElement).open,
  ).toBe(true);

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

test("kebab menu items render icons with visible text labels", async () => {
  const { q, element, teardown } = await setup({
    threads: [makeThread({ id: "a", name: "A", archived: false })],
  });

  // The archive/delete actions now live in the per-row kebab menu.
  (q('[part="row-menu"]') as HTMLElement).click();
  await flush(element);

  const archive = q('[part="row-archive"]') as HTMLElement;
  const del = q('[part="row-delete"]') as HTMLElement;

  expect(archive.querySelector("svg.row-action-icon")).not.toBeNull();
  expect(del.querySelector("svg.row-action-icon")).not.toBeNull();
  // Menu items carry a visible text label (not a hover tooltip / native title).
  expect(archive.textContent).toContain("Archive");
  expect(del.textContent).toContain("Delete");
  expect(archive.hasAttribute("title")).toBe(false);
  teardown();
});

test("archived rows are muted, not struck through", async () => {
  const { q, element, teardown } = await setup({
    threads: [makeThread({ id: "a", name: "A", archived: true })],
  });
  // Open the funnel popover, then switch to All so the archived row is visible.
  (q('[part="filter-toggle"]') as HTMLElement).click();
  await flush(element);
  (q('[part="filter-all"]') as HTMLElement).click();
  await flush(element);

  const name = q(".row.archived .row-name") as HTMLElement;
  expect(name).not.toBeNull();
  // jsdom's getComputedStyle never resolves an adopted-stylesheet rule, so a
  // `textDecorationLine` assertion is vacuous (it returns ""). Assert the CSS
  // contract directly instead: the archived-name rule mutes the color and does
  // NOT strike the name through.
  const cssText = (CopilotKitThreadsDrawer.styles as { cssText: string })
    .cssText;
  const archivedRule =
    cssText.match(/\.row\.archived\s+\.row-name\s*\{([^}]*)\}/)?.[1] ?? "";
  expect(archivedRule).not.toBe("");
  expect(archivedRule).toContain("color: var(--_muted-fg)");
  expect(archivedRule).not.toContain("line-through");
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

test("label defaults to Threads: root panel aria-label and listbox aria-label are both Threads", async () => {
  const { element, q, teardown } = await setup();

  const root = q("[part='root']") as HTMLElement;
  const list = q("[role='listbox']") as HTMLElement;

  // The redesign has no visible title — `label` drives accessible names only.
  expect(root.getAttribute("aria-label")).toBe("Threads");
  expect(list.getAttribute("aria-label")).toBe("Threads");
  expect(element.label).toBe("Threads");

  teardown();
});

test("setting label updates root panel aria-label and listbox aria-label", async () => {
  const { element, q, teardown } = await setup();

  element.label = "My Conversations";
  await flush(element);

  const root = q("[part='root']") as HTMLElement;
  const list = q("[role='listbox']") as HTMLElement;

  // `label` is accessible-name only; there is no visible title span to update.
  expect(root.getAttribute("aria-label")).toBe("My Conversations");
  expect(list.getAttribute("aria-label")).toBe("My Conversations");

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

  // `height: 100%` appears more than once in the sheet (both `:host` and
  // `.root` set it), so a bare `toContain("height: 100%")` doesn't prove the
  // declaration lives on `:host`. Match the `:host` block + declaration as a
  // unit. Likewise scope `min-height: 0` to the `.list` block.
  expect(sheets).toMatch(/:host\s*\{[^}]*height:\s*100%[^}]*\}/);
  expect(sheets).toMatch(/\.list\s*\{[^}]*min-height:\s*0[^}]*\}/);
});

// --- ENT-1051 Task 1: header gating ---------------------------------------

test("desktop header shows the collapse toggle by default (collapsible)", async () => {
  const { element } = await setup({ threads: [makeThread()] });
  // Default desktop (collapsible=true) renders the header with the collapse
  // toggle, so the header is visible even without projected slot content.
  const header = element.shadowRoot!.querySelector('[part="header"]')!;
  expect((header as HTMLElement).hidden).toBe(false);
  expect(
    element.shadowRoot!.querySelector('[part="collapse-toggle"]'),
  ).not.toBeNull();
});

test("with collapsible=false the header stays hidden until slot=header content is projected", async () => {
  const { element } = await setup({ threads: [makeThread()] });
  // With no collapse toggle (collapsible=false) and no projected header content,
  // the empty header bar stays hidden so no padded bar renders above the
  // "New Conversation" row.
  element.collapsible = false;
  await flush(element);
  const header = element.shadowRoot!.querySelector('[part="header"]')!;
  expect((header as HTMLElement).hidden).toBe(true);
  expect(
    element.shadowRoot!.querySelector('[part="collapse-toggle"]'),
  ).toBeNull();

  const headerContent = document.createElement("div");
  headerContent.slot = "header";
  element.appendChild(headerContent);
  await flush(element);
  expect((header as HTMLElement).hidden).toBe(false);
});

// --- ENT-1051: desktop collapse + floating cluster ------------------------

test("desktop collapse toggle collapses to the cluster and emits collapse-change", async () => {
  const { element, events } = await setup({ threads: [makeThread()] });
  element
    .shadowRoot!.querySelector<HTMLButtonElement>('[part="collapse-toggle"]')!
    .click();
  await flush(element);
  expect(element.collapsed).toBe(true);
  expect(events).toContainEqual({
    type: "collapse-change",
    detail: { collapsed: true },
  });
  // Panel is replaced by the floating cluster (sidebar toggle + New Conversation).
  const cluster = element.shadowRoot!.querySelector(
    '[part="launcher-cluster"]',
  );
  expect(cluster).not.toBeNull();
  expect(
    element.shadowRoot!.querySelector('[part="launcher-new-thread"]'),
  ).not.toBeNull();
});

test("collapsed cluster expand toggle restores the panel and emits collapse-change", async () => {
  const { element, events } = await setup({ threads: [makeThread()] });
  element.collapsed = true;
  await flush(element);
  element
    .shadowRoot!.querySelector<HTMLButtonElement>('[part="launcher"]')!
    .click();
  await flush(element);
  expect(element.collapsed).toBe(false);
  expect(events).toContainEqual({
    type: "collapse-change",
    detail: { collapsed: false },
  });
});

test("collapsed cluster New Conversation button fires new-thread", async () => {
  const { element, events } = await setup({ threads: [makeThread()] });
  element.collapsed = true;
  await flush(element);
  element
    .shadowRoot!.querySelector<HTMLButtonElement>(
      '[part="launcher-new-thread"]',
    )!
    .click();
  expect(events).toContainEqual({ type: "new-thread", detail: {} });
});

test("collapsible=false never renders the collapsed cluster on desktop", async () => {
  const { element } = await setup({ threads: [makeThread()] });
  element.collapsible = false;
  element.collapsed = true;
  await flush(element);
  expect(
    element.shadowRoot!.querySelector('[part="launcher-cluster"]'),
  ).toBeNull();
  // Panel stays rendered.
  expect(
    element.shadowRoot!.querySelector('[part="new-thread-button"]'),
  ).not.toBeNull();
});

test("mobile closed state renders the cluster with a New Conversation button", async () => {
  const { element, events } = await setup({
    threads: [makeThread()],
    mobile: true,
  });
  // Mobile closed → cluster launcher opens the off-canvas modal.
  const cluster = element.shadowRoot!.querySelector(
    '[part="launcher-cluster"]',
  );
  expect(cluster).not.toBeNull();
  const newThread = element.shadowRoot!.querySelector<HTMLButtonElement>(
    '[part="launcher-new-thread"]',
  )!;
  expect(newThread).not.toBeNull();
  newThread.click();
  expect(events).toContainEqual({ type: "new-thread", detail: {} });

  element
    .shadowRoot!.querySelector<HTMLButtonElement>('[part="launcher"]')!
    .click();
  expect(events).toContainEqual({
    type: "open-change",
    detail: { open: true },
  });
});

// --- ENT-1051 Task 2: New Conversation row --------------------------------

test("New Conversation row fires new-thread and keeps part=new-thread-button", async () => {
  const { element } = await setup({ threads: [makeThread()] });
  const btn = element.shadowRoot!.querySelector<HTMLButtonElement>(
    '[part="new-thread-button"]',
  )!;
  expect(btn.textContent).toContain("New Conversation");
  const onNew = vi.fn();
  element.addEventListener("new-thread", onNew);
  btn.click();
  expect(onNew).toHaveBeenCalledTimes(1);
});

// --- ENT-1051 Task 3: Recent Conversations heading + funnel filter --------

test("funnel opens a popover; choosing All emits filter-change and switches filter", async () => {
  const { element } = await setup({ threads: [makeThread()] });
  element
    .shadowRoot!.querySelector<HTMLButtonElement>('[part="filter-toggle"]')!
    .click();
  await flush(element);
  const all = element.shadowRoot!.querySelector<HTMLButtonElement>(
    '[part="filter-all"]',
  )!;
  const onFilter = vi.fn();
  element.addEventListener("filter-change", onFilter);
  all.click();
  await flush(element);
  expect(onFilter).toHaveBeenCalledWith(
    expect.objectContaining({ detail: { filter: "all" } }),
  );
});

test("section heading text is configurable via recentLabel", async () => {
  const { element } = await setup({ threads: [makeThread()] });
  element.recentLabel = "History";
  await flush(element);
  expect(
    element.shadowRoot!.querySelector('[part="section-heading"]')!.textContent,
  ).toContain("History");
});

test("filter-applied indicator dot shows only when a non-default filter is active", async () => {
  const { element } = await setup({ threads: [makeThread()] });
  // Default filter ("active") → no indicator.
  expect(
    element.shadowRoot!.querySelector('[part="filter-indicator"]'),
  ).toBeNull();
  // Switch to "All" via the funnel popover → indicator appears on the toggle.
  element
    .shadowRoot!.querySelector<HTMLButtonElement>('[part="filter-toggle"]')!
    .click();
  await flush(element);
  element
    .shadowRoot!.querySelector<HTMLButtonElement>('[part="filter-all"]')!
    .click();
  await flush(element);
  expect(
    element.shadowRoot!.querySelector('[part="filter-indicator"]'),
  ).not.toBeNull();
});

// --- ENT-1051 Task 5: per-row kebab menu ----------------------------------

test("row kebab opens a menu; Archive fires archive with the row id", async () => {
  const { element } = await setup({
    threads: [makeThread({ id: "x", name: "X" })],
  });
  const kebab =
    element.shadowRoot!.querySelector<HTMLButtonElement>('[part="row-menu"]')!;
  kebab.click();
  await flush(element);
  const onArchive = vi.fn();
  element.addEventListener("archive", onArchive);
  element
    .shadowRoot!.querySelector<HTMLButtonElement>('[part="row-archive"]')!
    .click();
  await flush(element);
  expect(onArchive).toHaveBeenCalledWith(
    expect.objectContaining({ detail: { threadId: "x" } }),
  );
});

test("row kebab Delete routes through the confirm dialog (no immediate delete)", async () => {
  const { element } = await setup({ threads: [makeThread({ id: "x" })] });
  element
    .shadowRoot!.querySelector<HTMLButtonElement>('[part="row-menu"]')!
    .click();
  await flush(element);
  const onDelete = vi.fn();
  element.addEventListener("delete", onDelete);
  element
    .shadowRoot!.querySelector<HTMLButtonElement>('[part="row-delete"]')!
    .click();
  await flush(element);
  expect(onDelete).not.toHaveBeenCalled();
  expect(
    element.shadowRoot!.querySelector<HTMLDialogElement>(
      '[data-testid="drawer-confirm-delete"]',
    )!.open,
  ).toBe(true);
});

// --- ENT-1051 Task 6: archived italic -------------------------------------

test("archived row name renders italic-muted in All view", async () => {
  const { element } = await setup({
    threads: [makeThread({ id: "a", name: "Archived one", archived: true })],
  });
  // switch to All via the funnel popover
  element
    .shadowRoot!.querySelector<HTMLButtonElement>('[part="filter-toggle"]')!
    .click();
  await flush(element);
  element
    .shadowRoot!.querySelector<HTMLButtonElement>('[part="filter-all"]')!
    .click();
  await flush(element);
  const row = element.shadowRoot!.querySelector(".row.archived .row-name")!;
  expect(row).not.toBeNull();
  // jsdom has no real cascade engine, so getComputedStyle never resolves an
  // adopted-stylesheet rule (the "muted, not struck through" test above only
  // passes because "" trivially lacks "line-through"). Assert the CSS contract
  // directly against the adopted stylesheet — the same approach the
  // ":host height" / "::part hooks" tests use.
  //
  // `font-style: italic` appears more than once in the sheet (placeholder rows
  // are italic too), so a bare `toContain("font-style: italic")` would not lock
  // the declaration to THIS selector. Match the selector + declaration together
  // as a unit instead.
  const cssText = (CopilotKitThreadsDrawer.styles as { cssText: string })
    .cssText;
  expect(cssText).toMatch(
    /\.row\.archived\s+\.row-name\s*\{[^}]*font-style:\s*italic[^}]*\}/,
  );
  expect(cssText).toMatch(
    /\.row\.archived\s+\.row-name\s*\{[^}]*color:\s*var\(--_muted-fg\)[^}]*\}/,
  );
});

// --- CR round 1, Finding 3: outside-click dismissal + row-select closes menu --

test("an outside pointerdown closes the open funnel filter popover", async () => {
  const { element, q, teardown } = await setup({ threads: [makeThread()] });

  (q('[part="filter-toggle"]') as HTMLElement).click();
  await flush(element);
  expect(q('[part="filters"]')).not.toBeNull();

  document.dispatchEvent(
    new MouseEvent("pointerdown", { bubbles: true, composed: true }),
  );
  await flush(element);

  expect(q('[part="filters"]')).toBeNull();
  teardown();
});

test("an outside pointerdown closes an open row kebab menu", async () => {
  const { element, q, teardown } = await setup({
    threads: [makeThread({ id: "a", name: "A" })],
  });

  (q('[part="row-menu"]') as HTMLElement).click();
  await flush(element);
  expect(q('[part="row-menu-popover"]')).not.toBeNull();

  document.dispatchEvent(
    new MouseEvent("pointerdown", { bubbles: true, composed: true }),
  );
  await flush(element);

  expect(q('[part="row-menu-popover"]')).toBeNull();
  teardown();
});

test("selecting a thread row closes an open kebab menu", async () => {
  const { element, q, teardown } = await setup({
    threads: [makeThread({ id: "a", name: "A" })],
  });

  (q('[part="row-menu"]') as HTMLElement).click();
  await flush(element);
  expect(q('[part="row-menu-popover"]')).not.toBeNull();

  (q('li.row[data-thread-id="a"]') as HTMLElement).click();
  await flush(element);

  expect(q('[part="row-menu-popover"]')).toBeNull();
  teardown();
});

// --- CR round 1, Finding 4: kebab popover must not be clipped by list overflow --

test("kebab menu on a lower-half row opens upward to escape the list overflow clip", async () => {
  const { element, qa, teardown } = await setup({
    threads: [
      makeThread({ id: "a", name: "A", updatedAt: "2026-06-04T00:00:00.000Z" }),
      makeThread({ id: "b", name: "B", updatedAt: "2026-06-03T00:00:00.000Z" }),
      makeThread({ id: "c", name: "C", updatedAt: "2026-06-02T00:00:00.000Z" }),
      makeThread({ id: "d", name: "D", updatedAt: "2026-06-01T00:00:00.000Z" }),
    ],
  });

  const lastRow = qa("li.row")[3] as HTMLElement;
  (lastRow.querySelector('[part="row-menu"]') as HTMLElement).click();
  await flush(element);

  // The row is flagged `menu-up`, which flips the popover to bottom-anchored so
  // it renders ABOVE the button (toward the list interior) rather than below it
  // where the list's overflow would clip a bottom row's downward menu.
  expect(lastRow.classList.contains("menu-up")).toBe(true);
  teardown();
});

test("kebab menu on a top row opens downward (no menu-up flag)", async () => {
  const { element, qa, teardown } = await setup({
    threads: [
      makeThread({ id: "a", name: "A", updatedAt: "2026-06-04T00:00:00.000Z" }),
      makeThread({ id: "b", name: "B", updatedAt: "2026-06-03T00:00:00.000Z" }),
      makeThread({ id: "c", name: "C", updatedAt: "2026-06-02T00:00:00.000Z" }),
      makeThread({ id: "d", name: "D", updatedAt: "2026-06-01T00:00:00.000Z" }),
    ],
  });

  const firstRow = qa("li.row")[0] as HTMLElement;
  (firstRow.querySelector('[part="row-menu"]') as HTMLElement).click();
  await flush(element);

  expect(firstRow.classList.contains("menu-up")).toBe(false);
  teardown();
});

test("menu-up flips the popover to open upward (CSS contract: bottom-anchored)", () => {
  const cssText = (CopilotKitThreadsDrawer.styles as { cssText: string })
    .cssText;
  // The upward variant must anchor to the button's top edge via `bottom` and
  // clear the default `top` anchor.
  expect(cssText).toMatch(
    /\.row\.menu-up\s+\.row-menu-popover\s*\{[^}]*bottom:\s*calc\(100% - 4px\)[^}]*\}/,
  );
});

// --- CR round 1, Finding 5: locked view hides feature chrome ----------------

test("locked view hides the New Conversation chrome", async () => {
  const { element, q, teardown } = await setup({ threads: [makeThread()] });
  element.licensed = false;
  await flush(element);

  expect(q('[data-testid="drawer-licensed"]')).not.toBeNull();
  // The feature chrome (New Conversation row) is absent — only the Upgrade
  // panel is offered.
  expect(q('[part="new-thread-button"]')).toBeNull();
  teardown();
});

test("licensed view still renders the New Conversation chrome", async () => {
  const { q, teardown } = await setup({ threads: [makeThread()] });
  // default licensed=true
  expect(q('[part="new-thread-button"]')).not.toBeNull();
  teardown();
});

// --- CR round 1, Finding 6: aria-labels fall back for empty-string names ----

test("row-action aria-labels fall back to 'New thread' for an empty-string name", async () => {
  const { element, q, teardown } = await setup({
    threads: [makeThread({ id: "e", name: "" })],
  });

  const kebab = q('[part="row-menu"]') as HTMLElement;
  expect(kebab.getAttribute("aria-label")).toBe("Actions for New thread");

  kebab.click();
  await flush(element);

  expect(
    (q('[part="row-archive"]') as HTMLElement).getAttribute("aria-label"),
  ).toBe("Archive thread New thread");
  expect(
    (q('[part="row-delete"]') as HTMLElement).getAttribute("aria-label"),
  ).toBe("Delete thread New thread");
  teardown();
});

test("unarchive aria-label falls back to 'New thread' for an empty-string name", async () => {
  const { element, q, teardown } = await setup({
    threads: [makeThread({ id: "e", name: "", archived: true })],
  });
  // reveal the archived row via the All filter
  (q('[part="filter-toggle"]') as HTMLElement).click();
  await flush(element);
  (q('[part="filter-all"]') as HTMLElement).click();
  await flush(element);

  (q('[part="row-menu"]') as HTMLElement).click();
  await flush(element);

  expect(
    (q('[part="row-unarchive"]') as HTMLElement).getAttribute("aria-label"),
  ).toBe("Unarchive thread New thread");
  teardown();
});
