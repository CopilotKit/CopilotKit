import {
  CopilotKitCore,
  CopilotKitCoreRuntimeConnectionStatus,
} from "@copilotkit/core";
import type { RuntimeMode } from "@copilotkit/shared";
import type { NotificationFeed } from "../lib/notifications.js";
import { afterEach, expect, test, vi } from "vitest";
import { WebInspectorElement, configureWebInspectorElement } from "../index.js";
import { loadNotificationState } from "../lib/persistence.js";

const feed: NotificationFeed = {
  schemaVersion: 1,
  notifications: [
    {
      id: "e0897224-968b-5a24-b46c-6744c2b2b254",
      title: "Update CopilotKit",
      body: "A **fix** with [details](https://example.com).",
      publishedAt: "2026-09-08T12:00:00.000Z",
      audiences: [{}],
      priority: "High",
    },
    {
      id: "3df5e60d-7f7d-579c-9899-02859a3edfec",
      title: "Another update",
      body: "More news.",
      publishedAt: "2026-09-01T12:00:00.000Z",
      audiences: [{}],
      priority: "Low",
    },
  ],
};
// The loader owns one request per page. A test replaces that page-level boundary,
// leaving feed validation and request caching covered by loader tests.
vi.mock("../lib/notification-loader.js", () => ({
  loadNotificationFeed: vi.fn(async () => feed),
}));
import { loadNotificationFeed } from "../lib/notification-loader.js";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  sessionStorage.clear();
  document.cookie = "cpk_inspector_notifications_v1=; Path=/; Max-Age=0";
  vi.clearAllMocks();
});

async function mount(development = true, core: CopilotKitCore | null = null) {
  const inspector = configureWebInspectorElement(
    new WebInspectorElement(),
    core,
    { development, framework: "react", sdkVersion: "1.70.2" },
  );
  document.body.append(inspector);
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
    await inspector.updateComplete;
  }
  return inspector;
}

async function openHud(inspector: WebInspectorElement) {
  inspector.shadowRoot
    ?.querySelector(".console-button-wrapper")
    ?.dispatchEvent(
      new PointerEvent("pointerenter", { bubbles: true, composed: true }),
    );
  await inspector.updateComplete;
}

function button(
  inspector: WebInspectorElement,
  label: string,
): HTMLButtonElement {
  const element = [
    ...(inspector.shadowRoot?.querySelectorAll("button") ?? []),
  ].find(
    (b) =>
      b.getAttribute("aria-label") === label || b.textContent?.trim() === label,
  );
  if (!element) throw new Error(`Missing button: ${label}`);
  return element;
}

test("production and unconfigured Inspectors never request notifications", async () => {
  await mount(false);
  const unconfigured = new WebInspectorElement();
  document.body.append(unconfigured);
  await unconfigured.updateComplete;
  expect(loadNotificationFeed).not.toHaveBeenCalled();
});

test("uses the existing New bubble without a second preview and X suppresses backlog across remounts", async () => {
  const inspector = await mount();
  expect(
    inspector.shadowRoot?.querySelector(".cpk-notification-preview"),
  ).toBeNull();
  await openHud(inspector);
  expect(
    inspector.shadowRoot?.querySelector("[data-cpk-hud-news]")?.textContent,
  ).toContain("Update CopilotKit");
  expect(
    inspector.shadowRoot?.querySelector("[data-cpk-hud-news]")?.textContent,
  ).not.toMatch(/High|Urgent|Normal|Low/);
  button(inspector, "Dismiss notification").click();
  await inspector.updateComplete;
  expect(loadNotificationState().suppressedIds).toEqual([
    "e0897224-968b-5a24-b46c-6744c2b2b254",
    "3df5e60d-7f7d-579c-9899-02859a3edfec",
  ]);
  inspector.remove();
  const next = await mount();
  await openHud(next);
  expect(next.shadowRoot?.querySelector("[data-cpk-hud-news]")).toBeNull();
});

test("reading the preview opens its Markdown and leaves both notices browseable", async () => {
  const inspector = await mount();
  await openHud(inspector);
  button(inspector, "Open new notification: Update CopilotKit").click();
  await inspector.updateComplete;
  expect(
    inspector.shadowRoot?.querySelector(".announcement-content strong")
      ?.textContent,
  ).toBe("fix");
  expect(loadNotificationState().readIds).toEqual([
    "e0897224-968b-5a24-b46c-6744c2b2b254",
  ]);
  button(inspector, "All updates").click();
  await inspector.updateComplete;
  expect(
    inspector.shadowRoot?.querySelectorAll(".cpk-notification-row"),
  ).toHaveLength(2);
});

test("reading another notice does not dismiss the highlighted notice", async () => {
  const inspector = await mount();
  inspector.openInspector("floating_button");
  await inspector.updateComplete;
  inspector.shadowRoot
    ?.querySelector<HTMLButtonElement>('[data-inspector-menu-key="whats-new"]')
    ?.click();
  await inspector.updateComplete;
  const row = [
    ...(inspector.shadowRoot?.querySelectorAll<HTMLButtonElement>(
      ".cpk-notification-row",
    ) ?? []),
  ].find((b) => b.textContent?.includes("Another update"));
  expect(row).toBeDefined();
  row?.click();
  await inspector.updateComplete;
  expect(loadNotificationState().activeId).toBe(
    "e0897224-968b-5a24-b46c-6744c2b2b254",
  );
  expect(loadNotificationState().readIds).toEqual([
    "3df5e60d-7f7d-579c-9899-02859a3edfec",
  ]);
  button(inspector, "Close Web Inspector").click();
  await inspector.updateComplete;
  await openHud(inspector);
  expect(
    inspector.shadowRoot?.querySelector("[data-cpk-hud-news]")?.textContent,
  ).toContain("Update CopilotKit");
});

class NotificationCore extends CopilotKitCore {
  mode: RuntimeMode = "sse";
  override get runtimeMode() {
    return this.mode;
  }
  async confirm(mode: RuntimeMode = this.mode) {
    this.mode = mode;
    await this.notifySubscribers(
      (subscriber) =>
        subscriber.onRuntimeConnectionStatusChanged?.({
          copilotkit: this,
          status: CopilotKitCoreRuntimeConnectionStatus.Connected,
        }),
      "notification test",
    );
  }
}

test("runtime targeting remains quiet until confirmed metadata arrives", async () => {
  const targeted: NotificationFeed = {
    ...feed,
    notifications: feed.notifications.map((n) => ({
      ...n,
      audiences: [{ intelligence: "enabled" }],
    })),
  };
  vi.mocked(loadNotificationFeed).mockResolvedValueOnce(targeted);
  const core = new NotificationCore({ deferInitialConnection: true });
  const inspector = await mount(true, core);
  await openHud(inspector);
  expect(inspector.shadowRoot?.querySelector("[data-cpk-hud-news]")).toBeNull();
  await core.confirm("sse");
  await inspector.updateComplete;
  expect(inspector.shadowRoot?.querySelector("[data-cpk-hud-news]")).toBeNull();
  await core.confirm("intelligence");
  await inspector.updateComplete;
  expect(
    inspector.shadowRoot?.querySelector("[data-cpk-hud-news]"),
  ).not.toBeNull();
  expect(loadNotificationFeed).toHaveBeenCalledTimes(1);
});

test("uses the existing SSE default for a connected runtime", async () => {
  vi.mocked(loadNotificationFeed).mockResolvedValueOnce({
    ...feed,
    notifications: feed.notifications.map((n) => ({
      ...n,
      audiences: [{ intelligence: "disabled" }],
    })),
  });
  const core = new NotificationCore({ deferInitialConnection: true });
  const inspector = await mount(true, core);
  expect(loadNotificationState().eligibleIds).toEqual([]);
  await core.confirm();
  await inspector.updateComplete;
  expect(loadNotificationState().eligibleIds).toHaveLength(
    feed.notifications.length,
  );
});

test("Home previews the active notice after reading a different article", async () => {
  const inspector = await mount();
  inspector.openInspector("floating_button");
  await inspector.updateComplete;
  inspector.shadowRoot
    ?.querySelector<HTMLButtonElement>('[data-inspector-menu-key="whats-new"]')
    ?.click();
  await inspector.updateComplete;
  const row = [
    ...inspector.shadowRoot!.querySelectorAll<HTMLButtonElement>(
      ".cpk-notification-row",
    ),
  ].find((b) => b.textContent?.includes("Another update"))!;
  row.click();
  await inspector.updateComplete;
  inspector.shadowRoot
    ?.querySelector<HTMLButtonElement>('[data-inspector-menu-key="home"]')
    ?.click();
  await inspector.updateComplete;
  const preview = inspector.shadowRoot!.querySelector<HTMLButtonElement>(
    "[data-inspector-whats-new-preview]",
  )!;
  expect(preview.textContent).toContain("Update CopilotKit");
  expect(preview.textContent).not.toContain("Another update");
  preview.click();
  await inspector.updateComplete;
  expect(
    inspector.shadowRoot!.querySelector(".inspector-whats-new-document h1")
      ?.textContent,
  ).toBe("Update CopilotKit");
});

test("clearing the core removes runtime-targeted notices and reconnecting restores them", async () => {
  vi.mocked(loadNotificationFeed).mockResolvedValueOnce({
    ...feed,
    notifications: [
      { ...feed.notifications[0]!, audiences: [{ intelligence: "enabled" }] },
      feed.notifications[1]!,
    ],
  });
  const core = new NotificationCore({ deferInitialConnection: true });
  const inspector = await mount(true, core);
  await core.confirm("intelligence");
  await inspector.updateComplete;
  expect(loadNotificationState().eligibleIds).toContain(
    "e0897224-968b-5a24-b46c-6744c2b2b254",
  );
  inspector.core = null;
  await inspector.updateComplete;
  expect(loadNotificationState().eligibleIds).toEqual([
    "3df5e60d-7f7d-579c-9899-02859a3edfec",
  ]);
  await openHud(inspector);
  expect(
    inspector.shadowRoot?.querySelector("[data-cpk-hud-news]")?.textContent ??
      "",
  ).not.toContain("Update CopilotKit");
  inspector.core = core;
  await core.confirm("intelligence");
  await inspector.updateComplete;
  expect(loadNotificationState().eligibleIds).toContain(
    "e0897224-968b-5a24-b46c-6744c2b2b254",
  );
});
