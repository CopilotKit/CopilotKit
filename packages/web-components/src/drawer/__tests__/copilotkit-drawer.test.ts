import { html, render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COPILOTKIT_DRAWER_TAG,
  COPILOTKIT_PRICING_URL,
  CopilotkitDrawer,
} from "../copilotkit-drawer";
import { defineCopilotkitDrawer } from "../define";
import { drawerStyles } from "../styles";
import type { DrawerThread } from "../types";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function flush(element: CopilotkitDrawer): Promise<void> {
  await element.updateComplete;
  await tick();
  await element.updateComplete;
}

function sampleThreads(): DrawerThread[] {
  return [
    { id: "t1", name: "First", archived: false, updatedAt: "2026-06-01" },
    { id: "t2", name: "Second", archived: true, updatedAt: "2026-06-02" },
    { id: "t3", name: "Third", archived: false, updatedAt: "2026-06-03" },
  ];
}

async function setupDrawer(
  overrides: Partial<CopilotkitDrawer> = {},
): Promise<CopilotkitDrawer> {
  defineCopilotkitDrawer();
  const element = document.createElement(
    COPILOTKIT_DRAWER_TAG,
  ) as CopilotkitDrawer;
  element.threads = sampleThreads();
  Object.assign(element, overrides);
  document.body.appendChild(element);
  await flush(element);
  return element;
}

function part(element: CopilotkitDrawer, name: string): HTMLElement | null {
  return element.renderRoot.querySelector<HTMLElement>(`[part~="${name}"]`);
}

function rowByThreadId(
  element: CopilotkitDrawer,
  id: string,
): HTMLElement | null {
  return element.renderRoot.querySelector<HTMLElement>(
    `[data-thread-id="${id}"]`,
  );
}

afterEach(() => {
  document.body.replaceChildren();
  document.body.style.overflow = "";
});

describe("copilotkit-drawer registration", () => {
  it("registers the element idempotently", () => {
    const first = defineCopilotkitDrawer();
    const second = defineCopilotkitDrawer();
    expect(first).toBe(second);
    expect(customElements.get(COPILOTKIT_DRAWER_TAG)).toBe(CopilotkitDrawer);
  });
});

describe("copilotkit-drawer events", () => {
  it("emits thread-selected with the thread id", async () => {
    const element = await setupDrawer();
    const onSelect = vi.fn();
    element.addEventListener("thread-selected", onSelect);

    const button = rowByThreadId(
      element,
      "t1",
    )!.querySelector<HTMLButtonElement>('[part~="thread-button"]')!;
    button.click();

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[0].detail).toEqual({ id: "t1" });
  });

  it("emits new-thread", async () => {
    const element = await setupDrawer();
    const onNew = vi.fn();
    element.addEventListener("new-thread", onNew);

    part(element, "new-thread")!.click();

    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it("emits archive for an active thread", async () => {
    const element = await setupDrawer();
    const onArchive = vi.fn();
    element.addEventListener("archive", onArchive);

    rowByThreadId(element, "t1")!
      .querySelector<HTMLButtonElement>('[part~="archive-button"]')!
      .click();

    expect(onArchive.mock.calls[0]?.[0].detail).toEqual({ id: "t1" });
  });

  it("emits unarchive for an archived thread (visible in All)", async () => {
    const element = await setupDrawer({ filter: "all" });
    const onUnarchive = vi.fn();
    element.addEventListener("unarchive", onUnarchive);

    rowByThreadId(element, "t2")!
      .querySelector<HTMLButtonElement>('[part~="unarchive-button"]')!
      .click();

    expect(onUnarchive.mock.calls[0]?.[0].detail).toEqual({ id: "t2" });
  });

  it("emits filter-change when toggling Active/All", async () => {
    const element = await setupDrawer();
    const onFilter = vi.fn();
    element.addEventListener("filter-change", onFilter);

    part(element, "filter-all")!.click();

    expect(onFilter.mock.calls[0]?.[0].detail).toEqual({ filter: "all" });
    expect(element.filter).toBe("all");
  });

  it("emits open-change from the backdrop in overlay mode", async () => {
    const element = await setupDrawer({ overlay: true, open: true });
    const onOpenChange = vi.fn();
    element.addEventListener("open-change", onOpenChange);

    part(element, "backdrop")!.click();

    expect(onOpenChange.mock.calls[0]?.[0].detail).toEqual({ open: false });
    expect(element.open).toBe(false);
  });

  it("emits delete only after confirm flow is confirmed", async () => {
    const element = await setupDrawer();
    const onDelete = vi.fn();
    element.addEventListener("delete", onDelete);

    rowByThreadId(element, "t1")!
      .querySelector<HTMLButtonElement>('[part~="delete-button"]')!
      .click();
    await flush(element);

    // Confirmation UI is shown, no delete yet.
    expect(onDelete).not.toHaveBeenCalled();
    expect(
      rowByThreadId(element, "t1")!.querySelector('[part~="confirm-delete"]'),
    ).toBeTruthy();

    rowByThreadId(element, "t1")!
      .querySelector<HTMLButtonElement>('[part~="confirm-delete-yes"]')!
      .click();

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete.mock.calls[0]?.[0].detail).toEqual({ id: "t1" });
  });

  it("cancels the delete confirm flow without emitting", async () => {
    const element = await setupDrawer();
    const onDelete = vi.fn();
    element.addEventListener("delete", onDelete);

    rowByThreadId(element, "t1")!
      .querySelector<HTMLButtonElement>('[part~="delete-button"]')!
      .click();
    await flush(element);
    rowByThreadId(element, "t1")!
      .querySelector<HTMLButtonElement>('[part~="confirm-delete-no"]')!
      .click();
    await flush(element);

    expect(onDelete).not.toHaveBeenCalled();
    expect(
      rowByThreadId(element, "t1")!.querySelector('[part~="confirm-delete"]'),
    ).toBeNull();
  });

  it("clears a pending delete confirm when the filter no longer shows it", async () => {
    const element = await setupDrawer({ filter: "all" });

    // Open the confirm flow on the archived thread t2 (only visible in All).
    rowByThreadId(element, "t2")!
      .querySelector<HTMLButtonElement>('[part~="delete-button"]')!
      .click();
    await flush(element);
    expect(
      rowByThreadId(element, "t2")!.querySelector('[part~="confirm-delete"]'),
    ).toBeTruthy();

    // Flip to Active — t2 is hidden; the pending confirm must be cleared so it
    // cannot resurface mid-confirm when All is selected again.
    element.filter = "active";
    await flush(element);
    element.filter = "all";
    await flush(element);

    expect(
      rowByThreadId(element, "t2")!.querySelector('[part~="confirm-delete"]'),
    ).toBeNull();
  });

  it("clears a pending delete confirm without scheduling a second update (no Lit warning)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const element = await setupDrawer({ filter: "all" });

    rowByThreadId(element, "t2")!
      .querySelector<HTMLButtonElement>('[part~="delete-button"]')!
      .click();
    await flush(element);

    // Flip the filter so t2 leaves the visible set — the reconcile that clears
    // _pendingDeleteId must happen in willUpdate (pre-render), NOT updated(),
    // so Lit does not warn about an update scheduled after one completed.
    element.filter = "active";
    await flush(element);

    expect(
      warn.mock.calls.some((call) =>
        String(call[0]).includes("scheduled an update"),
      ),
    ).toBe(false);
    expect(
      element.renderRoot.querySelector('[part~="confirm-delete"]'),
    ).toBeNull();
    warn.mockRestore();
  });

  it("clears a pending delete confirm when the thread leaves the inbound list", async () => {
    const element = await setupDrawer();

    rowByThreadId(element, "t1")!
      .querySelector<HTMLButtonElement>('[part~="delete-button"]')!
      .click();
    await flush(element);

    // The consumer removes t1 from the threads array entirely.
    element.threads = sampleThreads().filter((t) => t.id !== "t1");
    await flush(element);

    // Re-add t1; the confirm must NOT reappear since the pending id was cleared.
    element.threads = sampleThreads();
    await flush(element);

    expect(
      rowByThreadId(element, "t1")!.querySelector('[part~="confirm-delete"]'),
    ).toBeNull();
  });

  it("events bubble and cross the shadow boundary (composed)", async () => {
    const element = await setupDrawer();
    const onSelect = vi.fn();
    document.body.addEventListener("thread-selected", onSelect);

    rowByThreadId(element, "t1")!
      .querySelector<HTMLButtonElement>('[part~="thread-button"]')!
      .click();

    expect(onSelect).toHaveBeenCalledTimes(1);
    document.body.removeEventListener("thread-selected", onSelect);
  });
});

describe("copilotkit-drawer filtering", () => {
  it("hides archived threads in Active filter", async () => {
    const element = await setupDrawer({ filter: "active" });
    expect(rowByThreadId(element, "t1")).toBeTruthy();
    expect(rowByThreadId(element, "t2")).toBeNull();
    expect(rowByThreadId(element, "t3")).toBeTruthy();
  });

  it("shows all threads in All filter", async () => {
    const element = await setupDrawer({ filter: "all" });
    expect(rowByThreadId(element, "t1")).toBeTruthy();
    expect(rowByThreadId(element, "t2")).toBeTruthy();
    expect(rowByThreadId(element, "t3")).toBeTruthy();
  });

  it("marks the active thread row", async () => {
    const element = await setupDrawer({ activeThreadId: "t3" });
    expect(rowByThreadId(element, "t3")!.getAttribute("data-active")).toBe(
      "true",
    );
    expect(rowByThreadId(element, "t1")!.getAttribute("data-active")).toBe(
      "false",
    );
  });

  it("renders a plain semantic list of buttons (no invalid listbox/option roles)", async () => {
    const element = await setupDrawer({ filter: "all" });

    const list = part(element, "thread-list")!;
    // A `listbox` role would obligate `option` children + arrow-key nav that
    // these multi-button rows do not implement; the list stays a native <ul>.
    expect(list.tagName).toBe("UL");
    expect(list.hasAttribute("role")).toBe(false);
    expect(element.renderRoot.querySelectorAll('[role="listbox"]').length).toBe(
      0,
    );
    expect(element.renderRoot.querySelectorAll('[role="option"]').length).toBe(
      0,
    );
    // Rows are native <li> wrapping a <button>.
    const row = rowByThreadId(element, "t1")!;
    expect(row.tagName).toBe("LI");
    expect(row.querySelector('[part~="thread-button"]')!.tagName).toBe(
      "BUTTON",
    );
  });

  it("marks only the active row's button with aria-current and omits it otherwise", async () => {
    const element = await setupDrawer({ activeThreadId: "t3", filter: "all" });

    const activeBtn = rowByThreadId(element, "t3")!.querySelector(
      '[part~="thread-button"]',
    )!;
    const inactiveBtn = rowByThreadId(element, "t1")!.querySelector(
      '[part~="thread-button"]',
    )!;
    // Active row carries aria-current="true"; inactive rows omit it entirely
    // (rather than emitting the historically-mishandled aria-current="false").
    expect(activeBtn.getAttribute("aria-current")).toBe("true");
    expect(inactiveBtn.hasAttribute("aria-current")).toBe(false);
  });
});

describe("copilotkit-drawer states", () => {
  it("renders the empty state when no threads pass the filter", async () => {
    const element = await setupDrawer({ threads: [] });
    expect(part(element, "empty")).toBeTruthy();
  });

  it("renders the loading state", async () => {
    const element = await setupDrawer({ loading: true });
    expect(part(element, "loading")).toBeTruthy();
    expect(part(element, "thread-list")).toBeNull();
  });

  it("renders the error state with the message", async () => {
    const element = await setupDrawer({ error: "Boom" });
    const errorEl = part(element, "error");
    expect(errorEl).toBeTruthy();
    expect(errorEl!.textContent).toContain("Boom");
  });

  it("renders the upsell state and pricing CTA when unlicensed", async () => {
    const element = await setupDrawer({ licensed: false });
    const upsell = part(element, "upsell");
    expect(upsell).toBeTruthy();
    // Upsell REPLACES the list and list controls.
    expect(part(element, "thread-list")).toBeNull();
    expect(part(element, "new-thread")).toBeNull();
    const cta = part(element, "upsell-cta") as HTMLAnchorElement | null;
    expect(cta?.getAttribute("href")).toBe(COPILOTKIT_PRICING_URL);
  });
});

describe("copilotkit-drawer overlay + a11y", () => {
  it("toggling overlay open emits and locks body scroll; closing restores", async () => {
    document.body.style.overflow = "scroll";
    const element = await setupDrawer({ overlay: true, open: false });

    element.open = true;
    await flush(element);
    expect(document.body.style.overflow).toBe("hidden");

    element.open = false;
    await flush(element);
    expect(document.body.style.overflow).toBe("scroll");
  });

  it("Escape closes the overlay and emits open-change", async () => {
    const element = await setupDrawer({ overlay: true, open: true });
    const onOpenChange = vi.fn();
    element.addEventListener("open-change", onOpenChange);

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await flush(element);

    expect(element.open).toBe(false);
    expect(onOpenChange.mock.calls[0]?.[0].detail).toEqual({ open: false });
  });

  it("Escape does nothing when not in overlay mode", async () => {
    const element = await setupDrawer({ overlay: false, open: true });
    const onOpenChange = vi.fn();
    element.addEventListener("open-change", onOpenChange);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await flush(element);

    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("does not swallow Escape from other page-level handlers", async () => {
    const element = await setupDrawer({ overlay: true, open: true });
    const onOther = vi.fn();
    // A sibling handler on the same target (document) must still receive the
    // Escape event the drawer reacts to — the drawer must not stopPropagation.
    document.addEventListener("keydown", onOther);

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await flush(element);

    expect(element.open).toBe(false);
    expect(onOther).toHaveBeenCalledTimes(1);
    document.removeEventListener("keydown", onOther);
  });

  it("aria-expanded reflects open state in overlay mode", async () => {
    const element = await setupDrawer({ overlay: true, open: false });
    const toggle = part(element, "toggle-button")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    element.open = true;
    await flush(element);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  it("aria-expanded reflects collapsed state in non-overlay (rail) mode", async () => {
    const element = await setupDrawer({ overlay: false, collapsed: false });
    const toggle = part(element, "toggle-button")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    element.collapsed = true;
    await flush(element);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("hides .new-thread (with the other list controls) in the collapsed desktop rail", () => {
    // jsdom does not lay out CSS, so assert against the stylesheet text: the
    // collapsed-rail display:none rule must scope .new-thread alongside the
    // other list controls so the button cannot overflow/clip the 56px rail.
    const cssText = drawerStyles.cssText;
    // Isolate the selector list that precedes the collapsed-rail display:none.
    const railRule = cssText.match(
      /((?::host\(\[collapsed\]:not\(\[overlay\]\)\)\s*\.[\w-]+\s*,?\s*)+)\{\s*display:\s*none;?\s*\}/,
    );
    expect(railRule).toBeTruthy();
    const selectorList = railRule![1];
    for (const control of [
      ".new-thread",
      ".thread-list",
      ".filters",
      ".footer",
      ".title",
    ]) {
      expect(selectorList).toContain(control);
    }
  });

  it("emits collapse-change when the rail toggle is clicked", async () => {
    const element = await setupDrawer({ overlay: false, collapsed: false });
    const onCollapse = vi.fn();
    element.addEventListener("collapse-change", onCollapse);

    part(element, "toggle-button")!.click();
    await flush(element);

    expect(onCollapse).toHaveBeenCalledTimes(1);
    expect(onCollapse.mock.calls[0]?.[0].detail).toEqual({ collapsed: true });
    expect(element.collapsed).toBe(true);
  });

  it("the overlay toggle emits open-change, not collapse-change", async () => {
    const element = await setupDrawer({ overlay: true, open: false });
    const onCollapse = vi.fn();
    const onOpenChange = vi.fn();
    element.addEventListener("collapse-change", onCollapse);
    element.addEventListener("open-change", onOpenChange);

    part(element, "toggle-button")!.click();
    await flush(element);

    expect(onCollapse).not.toHaveBeenCalled();
    expect(onOpenChange.mock.calls[0]?.[0].detail).toEqual({ open: true });
  });

  it("traps Tab focus within the panel when overlay open", async () => {
    const element = await setupDrawer({ overlay: true, open: true });
    await flush(element);

    const focusables = (
      element as unknown as { focusableElements: () => HTMLElement[] }
    ).focusableElements();
    expect(focusables.length).toBeGreaterThan(1);

    const last = focusables[focusables.length - 1]!;
    last.focus();
    const panel = part(element, "panel")!;
    panel.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
    );
    await flush(element);
    // Forward-tab from last wraps to first (focus stays inside the panel).
    expect((element.renderRoot as ShadowRoot).activeElement).toBe(
      focusables[0],
    );
  });

  it("marks the panel inert + aria-hidden when the overlay is closed", async () => {
    const element = await setupDrawer({ overlay: true, open: false });
    const panel = part(element, "panel")!;

    // Closed off-canvas panel: controls must leave the tab order + AT tree.
    expect(panel.hasAttribute("inert")).toBe(true);
    expect(panel.getAttribute("aria-hidden")).toBe("true");

    element.open = true;
    await flush(element);
    // Open panel is live again.
    expect(panel.hasAttribute("inert")).toBe(false);
    expect(panel.hasAttribute("aria-hidden")).toBe(false);
  });

  it("leaves the panel live (not inert) for an in-flow non-overlay drawer", async () => {
    const element = await setupDrawer({ overlay: false, open: false });
    const panel = part(element, "panel")!;
    expect(panel.hasAttribute("inert")).toBe(false);
    expect(panel.hasAttribute("aria-hidden")).toBe(false);
  });

  it("does not pull focus from a non-tabbable element legitimately inside the panel", async () => {
    defineCopilotkitDrawer();
    const host = document.createElement("div");
    document.body.appendChild(host);
    render(
      html`<copilotkit-drawer .threads=${sampleThreads()} overlay open>
        <div slot="footer" id="non-tabbable" tabindex="-1">
          Programmatically focusable, not tabbable
        </div>
      </copilotkit-drawer>`,
      host,
    );
    const element = host.querySelector(
      COPILOTKIT_DRAWER_TAG,
    ) as CopilotkitDrawer;
    await flush(element);

    const nonTabbable = host.querySelector<HTMLElement>("#non-tabbable")!;
    // The element is inside the panel but excluded from the tabbable set.
    const focusables = (
      element as unknown as { focusableElements: () => HTMLElement[] }
    ).focusableElements();
    expect(focusables.includes(nonTabbable)).toBe(false);

    nonTabbable.focus();
    const panel = part(element, "panel")!;
    panel.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
    );
    await flush(element);

    // Focus was inside the panel, so the trap must NOT yank it to first/last.
    // It is light-DOM, so the shadow root sees no active element and the
    // document still reports the non-tabbable node as focused.
    expect((element.renderRoot as ShadowRoot).activeElement).toBeNull();
    expect(document.activeElement).toBe(nonTabbable);
  });

  it("includes slotted (light-DOM) focusables in the focus trap set", async () => {
    defineCopilotkitDrawer();
    const host = document.createElement("div");
    document.body.appendChild(host);
    render(
      html`<copilotkit-drawer .threads=${sampleThreads()} overlay open>
        <button slot="footer" id="slotted-footer-btn">Slotted action</button>
      </copilotkit-drawer>`,
      host,
    );
    const element = host.querySelector(
      COPILOTKIT_DRAWER_TAG,
    ) as CopilotkitDrawer;
    await flush(element);

    const focusables = (
      element as unknown as { focusableElements: () => HTMLElement[] }
    ).focusableElements();
    expect(focusables.some((el) => el.id === "slotted-footer-btn")).toBe(true);
  });

  it("does not lock scroll for an in-flow (non-overlay) drawer", async () => {
    document.body.style.overflow = "";
    await setupDrawer({ overlay: false, open: true });
    expect(document.body.style.overflow).toBe("");
  });

  it("refcounts body scroll lock across two overlay drawers", async () => {
    document.body.style.overflow = "scroll";
    const a = await setupDrawer({ overlay: true, open: true });
    const b = await setupDrawer({ overlay: true, open: true });
    expect(document.body.style.overflow).toBe("hidden");

    // First drawer closes — the second still holds the lock.
    a.open = false;
    await flush(a);
    expect(document.body.style.overflow).toBe("hidden");

    // Last drawer closes — the original baseline is restored exactly once.
    b.open = false;
    await flush(b);
    expect(document.body.style.overflow).toBe("scroll");
  });

  it("restores the real baseline even if a sibling already locked the body", async () => {
    document.body.style.overflow = "auto";
    const a = await setupDrawer({ overlay: true, open: true });
    // Second drawer must NOT capture the already-"hidden" value as baseline.
    const b = await setupDrawer({ overlay: true, open: true });

    b.open = false;
    await flush(b);
    a.open = false;
    await flush(a);

    expect(document.body.style.overflow).toBe("auto");
  });
});

describe("copilotkit-drawer slots + customization", () => {
  it("projects header, footer, empty, and memories slots", async () => {
    defineCopilotkitDrawer();
    const host = document.createElement("div");
    document.body.appendChild(host);
    render(
      html`
        <copilotkit-drawer .threads=${[]}>
          <span slot="header">My Threads</span>
          <span slot="footer">Footer content</span>
          <span slot="empty">Nothing here</span>
          <span slot="memories">Memory item</span>
        </copilotkit-drawer>
      `,
      host,
    );
    const element = host.querySelector(
      COPILOTKIT_DRAWER_TAG,
    ) as CopilotkitDrawer;
    await flush(element);

    const slotNames = Array.from(
      element.renderRoot.querySelectorAll("slot"),
    ).map((s) => s.getAttribute("name"));
    expect(slotNames).toEqual(
      expect.arrayContaining(["header", "footer", "empty", "memories"]),
    );
  });

  it("keeps the memories region hidden until populated", async () => {
    const element = await setupDrawer();
    const memories = part(element, "memories")!;
    expect(memories.hasAttribute("hidden")).toBe(true);
  });

  it("reveals the memories region once its slot has content", async () => {
    defineCopilotkitDrawer();
    const host = document.createElement("div");
    document.body.appendChild(host);
    render(
      html`<copilotkit-drawer .threads=${[]}>
        <span slot="memories">A memory</span>
      </copilotkit-drawer>`,
      host,
    );
    const element = host.querySelector(
      COPILOTKIT_DRAWER_TAG,
    ) as CopilotkitDrawer;
    await flush(element);

    const memories =
      element.renderRoot.querySelector<HTMLElement>('[part~="memories"]')!;
    expect(memories.hasAttribute("hidden")).toBe(false);
  });

  it("reveals the memories region when content is slotted AFTER initial render", async () => {
    // Guards the slotchange-driven reactive reveal: content added later must
    // flip the region visible, proving the reveal does not depend on querying
    // the render root during the first render() (which could miss the slot).
    const element = await setupDrawer();
    const memories = part(element, "memories")!;
    expect(memories.hasAttribute("hidden")).toBe(true);

    const memory = document.createElement("span");
    memory.slot = "memories";
    memory.textContent = "A late memory";
    element.appendChild(memory);
    await flush(element);

    expect(memories.hasAttribute("hidden")).toBe(false);
  });

  it("uses the per-row render hook when provided", async () => {
    const element = await setupDrawer({
      renderThread: (thread, ctx) =>
        html`<span class="custom-row" data-active=${String(ctx.active)}
          >CUSTOM:${thread.id}</span
        >`,
      activeThreadId: "t1",
    });

    const customRow = rowByThreadId(element, "t1")!.querySelector(
      ".custom-row",
    );
    expect(customRow).toBeTruthy();
    expect(customRow!.textContent).toContain("CUSTOM:t1");
    expect(customRow!.getAttribute("data-active")).toBe("true");
  });

  it("exposes ::part hooks on key nodes", async () => {
    const element = await setupDrawer();
    for (const name of [
      "panel",
      "header",
      "filters",
      "thread-list",
      "thread-row",
      "new-thread",
      "footer",
      "memories",
    ]) {
      expect(part(element, name)).toBeTruthy();
    }
  });

  it("falls back to a placeholder name for unnamed threads", async () => {
    const element = await setupDrawer({
      threads: [{ id: "x", name: null }],
      filter: "all",
    });
    expect(rowByThreadId(element, "x")!.textContent).toContain(
      "Untitled thread",
    );
  });
});
