import { Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { signal } from "@angular/core";
import { test, expect, vi, beforeEach } from "vitest";
import type { DrawerThread } from "@copilotkit/web-components/threads-drawer";
import type { RuntimeLicenseStatus } from "@copilotkit/core";
import {
  CopilotThreadsDrawer,
  CopilotThreadsDrawerRow,
} from "../copilot-threads-drawer";
import type { Thread } from "../../../threads";
import { COPILOT_CHAT_CONFIGURATION } from "../../../chat-configuration";
import { CopilotKit } from "../../../copilotkit";

// ---------------------------------------------------------------------------
// Mock the `CopilotKit` service so the component's `inject(CopilotKit)` resolves
// to a minimal fake exposing only the `licenseStatus` signal the drawer reads.
// A module-level signal lets tests drive the license gate. Defaults to "valid"
// (fully licensed) so non-license tests render the list path unchanged.
// ---------------------------------------------------------------------------

const licenseStatusSignal = signal<RuntimeLicenseStatus | undefined>("valid");
const fakeCopilotKit = { licenseStatus: licenseStatusSignal };
const copilotkitProvider = { provide: CopilotKit, useValue: fakeCopilotKit };

// ---------------------------------------------------------------------------
// Mock `injectThreads` so the component never tries to connect to a real
// CopilotKit runtime during tests.
// ---------------------------------------------------------------------------

/** Writable signals that back the mock threads store. */
const threadsState = {
  threads: signal<Thread[]>([]),
  isLoading: signal(false),
  error: signal<Error | null>(null),
  listError: signal<Error | null>(null),
  fetchMoreError: signal<Error | null>(null),
  hasMoreThreads: signal(false),
  isFetchingMoreThreads: signal(false),
  isMutating: signal(false),
  fetchMoreThreads: vi.fn(),
  refetchThreads: vi.fn(),
  startNewThread: vi.fn(),
  renameThread: vi.fn(),
  archiveThread: vi.fn().mockResolvedValue(undefined),
  unarchiveThread: vi.fn().mockResolvedValue(undefined),
  deleteThread: vi.fn().mockResolvedValue(undefined),
};

vi.mock("../../../threads", () => ({ injectThreads: () => threadsState }));

// ---------------------------------------------------------------------------
// Host components
// ---------------------------------------------------------------------------

/** Host component that renders {@link CopilotThreadsDrawer} under test. */
@Component({
  selector: "test-host",
  standalone: true,
  imports: [CopilotThreadsDrawer],
  template: `
    <copilot-threads-drawer />
  `,
})
class HostComponent {}

/** Host component that binds an override callback for thread-select. */
@Component({
  selector: "test-host-thread-select",
  standalone: true,
  imports: [CopilotThreadsDrawer],
  template: `
    <copilot-threads-drawer [onThreadSelect]="spy" />
  `,
})
class HostWithThreadSelectComponent {
  spy = vi.fn();
}

/** Host component that binds an override callback for new-thread. */
@Component({
  selector: "test-host-new-thread",
  standalone: true,
  imports: [CopilotThreadsDrawer],
  template: `
    <copilot-threads-drawer [onNewThread]="spy" />
  `,
})
class HostWithNewThreadComponent {
  spy = vi.fn();
}

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

/**
 * Configures TestBed, creates the host fixture, runs change detection, and
 * returns the fixture together with the rendered `<copilotkit-threads-drawer>` element.
 */
function setup() {
  licenseStatusSignal.set("valid");
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [HostComponent],
    providers: [copilotkitProvider],
  });

  const fixture = TestBed.createComponent(HostComponent);
  fixture.detectChanges();
  const el = (fixture.nativeElement as HTMLElement).querySelector(
    "copilotkit-threads-drawer",
  ) as
    | (HTMLElement & {
        threads: DrawerThread[];
        loading: boolean;
        error: string | null;
        hasMore: boolean;
        fetchingMore: boolean;
        activeThreadId: string | null;
      })
    | null;
  return { fixture, el };
}

/**
 * Returns a minimal fake {@link CopilotChatConfiguration}-shaped object for
 * testing event routing without a real service instance.
 */
function fakeConfig() {
  return {
    threadId: signal("active-1"),
    agentId: signal<string | undefined>(undefined),
    hasExplicitThreadId: signal(true),
    setActiveThreadId: vi.fn(),
    startNewThread: vi.fn(),
    // Drawer open-state coordination consumed by the wrapper.
    drawerOpen: signal(false),
    setDrawerOpen: vi.fn(),
    registerDrawer: vi.fn(() => vi.fn()),
  };
}

/**
 * Configures TestBed with the fake config provided as the
 * `COPILOT_CHAT_CONFIGURATION` token value, creates the fixture, and returns
 * the fixture, the inner `<copilotkit-threads-drawer>` element, and the config spy.
 */
function setupWithConfig(config = fakeConfig()) {
  licenseStatusSignal.set("valid");
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [HostComponent],
    providers: [
      { provide: COPILOT_CHAT_CONFIGURATION, useValue: config },
      copilotkitProvider,
    ],
  });

  const fixture = TestBed.createComponent(HostComponent);
  fixture.detectChanges();
  const el = (fixture.nativeElement as HTMLElement).querySelector(
    "copilotkit-threads-drawer",
  ) as HTMLElement | null;
  return { fixture, el: el!, config };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// The `threadsState` mock is module-level, so reset every signal to its default
// and clear the mock fns' call history before each test. Without this, a test
// that flips a signal (e.g. isLoading/hasMoreThreads/error) leaks that state
// into whichever test runs next — the same order-coupling guard the
// react-core/vue suites establish with their own beforeEach.
beforeEach(() => {
  threadsState.threads.set([]);
  threadsState.isLoading.set(false);
  threadsState.error.set(null);
  threadsState.listError.set(null);
  threadsState.fetchMoreError.set(null);
  threadsState.hasMoreThreads.set(false);
  threadsState.isFetchingMoreThreads.set(false);
  threadsState.isMutating.set(false);
  threadsState.fetchMoreThreads.mockClear();
  threadsState.refetchThreads.mockClear();
  threadsState.startNewThread.mockClear();
  threadsState.renameThread.mockClear();
  threadsState.archiveThread.mockClear();
  threadsState.unarchiveThread.mockClear();
  threadsState.deleteThread.mockClear();
});

test("renders <copilotkit-threads-drawer> with the default data-testid", () => {
  const { el } = setup();

  expect(el).not.toBeNull();
  expect(customElements.get("copilotkit-threads-drawer")).toBeDefined();
  expect(el!.getAttribute("data-testid")).toBe("copilot-threads-drawer");
});

test("binds threads list and load state onto the drawer element imperatively", async () => {
  // Reset mock state to known initial values before this test.
  threadsState.threads.set([]);
  threadsState.isLoading.set(false);
  threadsState.error.set(null);
  threadsState.listError.set(null);
  threadsState.hasMoreThreads.set(false);
  threadsState.isFetchingMoreThreads.set(false);

  const { fixture, el } = setup();

  // Arrange: set mock signals with a thread row, loading, error, hasMore.
  // Set both error and listError to a genuine fetch error so the element
  // receives the message (the component binds listError, not error).
  const thread: Thread = {
    id: "t1",
    agentId: "default",
    name: "My Thread",
    archived: false,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-02T00:00:00Z",
    lastRunAt: "2024-01-02T12:00:00Z",
  };
  const loadError = new Error("load failed");
  threadsState.threads.set([thread]);
  threadsState.isLoading.set(true);
  threadsState.error.set(loadError);
  threadsState.listError.set(loadError);
  threadsState.hasMoreThreads.set(true);

  // Act: trigger change detection so the effect re-runs.
  fixture.detectChanges();
  await fixture.whenStable();

  // Assert: element JS properties reflect the signals.
  const expected: DrawerThread[] = [
    {
      id: "t1",
      name: "My Thread",
      archived: false,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
      lastRunAt: "2024-01-02T12:00:00Z",
    },
  ];

  expect(el!.threads).toEqual(expected);
  expect(el!.loading).toBe(true);
  expect(el!.error).toBe("load failed");
  expect(el!.hasMore).toBe(true);
});

// ---------------------------------------------------------------------------
// Event routing tests
// ---------------------------------------------------------------------------

test("thread-selected routes to setActiveThreadId with explicit:true", () => {
  threadsState.startNewThread.mockClear();
  const { el, config } = setupWithConfig();

  el.dispatchEvent(
    new CustomEvent("thread-selected", {
      detail: { threadId: "t9" },
      bubbles: true,
    }),
  );

  expect(config.setActiveThreadId).toHaveBeenCalledWith("t9", {
    explicit: true,
  });
});

test("new-thread routes to both threadsState.startNewThread and config.startNewThread", () => {
  threadsState.startNewThread.mockClear();
  const { el, config } = setupWithConfig();

  el.dispatchEvent(new CustomEvent("new-thread", { bubbles: true }));

  expect(threadsState.startNewThread).toHaveBeenCalled();
  expect(config.startNewThread).toHaveBeenCalled();
});

test("archive routes to threadsState.archiveThread with the thread id", () => {
  threadsState.archiveThread.mockClear();
  const { el } = setupWithConfig();

  el.dispatchEvent(
    new CustomEvent("archive", {
      detail: { threadId: "t-arc" },
      bubbles: true,
    }),
  );

  expect(threadsState.archiveThread).toHaveBeenCalledWith("t-arc");
});

test("unarchive routes to threadsState.unarchiveThread with the thread id", () => {
  threadsState.unarchiveThread.mockClear();
  const { el } = setupWithConfig();

  el.dispatchEvent(
    new CustomEvent("unarchive", {
      detail: { threadId: "t-unarc" },
      bubbles: true,
    }),
  );

  expect(threadsState.unarchiveThread).toHaveBeenCalledWith("t-unarc");
});

test("filter-change routes to threadsState.refetchThreads", () => {
  threadsState.refetchThreads.mockClear();
  const { el } = setupWithConfig();

  el.dispatchEvent(new CustomEvent("filter-change", { bubbles: true }));

  expect(threadsState.refetchThreads).toHaveBeenCalled();
});

test("retry with scope fetch-more routes to threadsState.fetchMoreThreads", () => {
  threadsState.fetchMoreThreads.mockClear();
  const { el } = setupWithConfig();

  el.dispatchEvent(
    new CustomEvent("retry", {
      detail: { scope: "fetch-more" },
      bubbles: true,
    }),
  );

  expect(threadsState.fetchMoreThreads).toHaveBeenCalled();
});

test("load-more routes to threadsState.fetchMoreThreads", () => {
  threadsState.fetchMoreThreads.mockClear();
  const { el } = setupWithConfig();

  el.dispatchEvent(new CustomEvent("load-more", { bubbles: true }));

  expect(threadsState.fetchMoreThreads).toHaveBeenCalled();
});

test("retry with scope initial routes to threadsState.refetchThreads", () => {
  threadsState.refetchThreads.mockClear();
  const { el } = setupWithConfig();

  el.dispatchEvent(
    new CustomEvent("retry", {
      detail: { scope: "initial" },
      bubbles: true,
    }),
  );

  expect(threadsState.refetchThreads).toHaveBeenCalled();
});

test("delete of active thread triggers startNewThread on both threads and config after delete resolves", async () => {
  threadsState.deleteThread.mockClear();
  threadsState.startNewThread.mockClear();
  // The config's threadId signal is set to "active-1" by fakeConfig().
  const { el, config } = setupWithConfig();

  el.dispatchEvent(
    new CustomEvent("delete", {
      detail: { threadId: "active-1" },
      bubbles: true,
    }),
  );

  // Wait for the deleteThread promise to resolve.
  await Promise.resolve();

  expect(threadsState.deleteThread).toHaveBeenCalledWith("active-1");
  expect(threadsState.startNewThread).toHaveBeenCalled();
  expect(config.startNewThread).toHaveBeenCalled();
});

// ---------------------------------------------------------------------------
// Host escape-hatch callback tests
// ---------------------------------------------------------------------------

test("onThreadSelect override is called with threadId and config.setActiveThreadId is NOT called", () => {
  threadsState.startNewThread.mockClear();
  const config = fakeConfig();

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [HostWithThreadSelectComponent],
    providers: [
      { provide: COPILOT_CHAT_CONFIGURATION, useValue: config },
      copilotkitProvider,
    ],
  });

  const fixture = TestBed.createComponent(HostWithThreadSelectComponent);
  fixture.detectChanges();
  const el = (fixture.nativeElement as HTMLElement).querySelector(
    "copilotkit-threads-drawer",
  ) as HTMLElement;

  el.dispatchEvent(
    new CustomEvent("thread-selected", {
      detail: { threadId: "t5" },
      bubbles: true,
    }),
  );

  expect(fixture.componentInstance.spy).toHaveBeenCalledWith("t5");
  expect(config.setActiveThreadId).not.toHaveBeenCalled();
});

test("onNewThread override is called and threads.startNewThread is always called; config.startNewThread is NOT called", () => {
  threadsState.startNewThread.mockClear();
  const config = fakeConfig();

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [HostWithNewThreadComponent],
    providers: [
      { provide: COPILOT_CHAT_CONFIGURATION, useValue: config },
      copilotkitProvider,
    ],
  });

  const fixture = TestBed.createComponent(HostWithNewThreadComponent);
  fixture.detectChanges();
  const el = (fixture.nativeElement as HTMLElement).querySelector(
    "copilotkit-threads-drawer",
  ) as HTMLElement;

  el.dispatchEvent(new CustomEvent("new-thread", { bubbles: true }));

  expect(threadsState.startNewThread).toHaveBeenCalled();
  expect(fixture.componentInstance.spy).toHaveBeenCalled();
  expect(config.startNewThread).not.toHaveBeenCalled();
});

// ---------------------------------------------------------------------------
// listError filter tests
// ---------------------------------------------------------------------------

test("dev/config error on error() does not leak to element.error when listError() is null", async () => {
  threadsState.error.set(new Error("Runtime URL is not configured"));
  threadsState.listError.set(null);

  const { fixture, el } = setup();
  fixture.detectChanges();
  await fixture.whenStable();

  expect(el!.error).toBeNull();
});

test("genuine fetch error surfaces on element.error when listError() is non-null", async () => {
  const fetchErr = new Error("list fetch failed");
  threadsState.error.set(fetchErr);
  threadsState.listError.set(fetchErr);

  const { fixture, el } = setup();
  fixture.detectChanges();
  await fixture.whenStable();

  expect(el!.error).toBe("list fetch failed");
});

// ---------------------------------------------------------------------------
// D2: fetchMoreError forwarding
// ---------------------------------------------------------------------------

test("fetchMoreError is forwarded to the element's fetchMoreError property; error stays null", async () => {
  threadsState.error.set(null);
  threadsState.listError.set(null);
  threadsState.fetchMoreError.set(new Error("couldn't load more"));

  const { fixture, el } = setup();
  fixture.detectChanges();
  await fixture.whenStable();

  expect(
    (el as unknown as { fetchMoreError: string | null }).fetchMoreError,
  ).toBe("couldn't load more");
  // The dedicated fetch-more channel must NOT bleed into the initial-list error.
  expect(el!.error).toBeNull();

  // Clearing the fetch-more error clears the element property.
  threadsState.fetchMoreError.set(null);
  fixture.detectChanges();
  await fixture.whenStable();
  expect(
    (el as unknown as { fetchMoreError: string | null }).fetchMoreError,
  ).toBeNull();
});

// ---------------------------------------------------------------------------
// D1: open-state coordination
// ---------------------------------------------------------------------------

test("drawer starts CLOSED (el.open === false) with a provider present", async () => {
  const { fixture, el } = setupWithConfig();
  await fixture.whenStable();

  expect((el as unknown as { open: boolean }).open).toBe(false);
});

test("drawer starts CLOSED (el.open === false) with no provider (local fallback)", async () => {
  const { fixture, el } = setup();
  await fixture.whenStable();

  expect((el as unknown as { open: boolean }).open).toBe(false);
});

test("open-change routes to config.setDrawerOpen when a provider is present", () => {
  const { el, config } = setupWithConfig();

  el.dispatchEvent(
    new CustomEvent("open-change", {
      detail: { open: true },
      bubbles: true,
    }),
  );

  expect(config.setDrawerOpen).toHaveBeenCalledWith(true);
});

test("open-change drives the local fallback (el.open flips) when no provider is present", async () => {
  const { fixture, el } = setup();
  await fixture.whenStable();
  expect((el as unknown as { open: boolean }).open).toBe(false);

  el!.dispatchEvent(
    new CustomEvent("open-change", {
      detail: { open: true },
      bubbles: true,
    }),
  );
  fixture.detectChanges();
  await fixture.whenStable();

  expect((el as unknown as { open: boolean }).open).toBe(true);
});

test("registerDrawer is called once when a provider is present", () => {
  const { config } = setupWithConfig();
  expect(config.registerDrawer).toHaveBeenCalledTimes(1);
});

// ---------------------------------------------------------------------------
// D3: focus-return to the chat input on thread select
// ---------------------------------------------------------------------------

test("thread-selected returns focus to the chat input (document-global fallback)", () => {
  const { el } = setupWithConfig();

  // No `copilot-chat-view` ancestor in the test DOM, so findChatInput uses the
  // document-global fallback: a `<textarea copilotChatTextarea>` on the page.
  const textarea = document.createElement("textarea");
  textarea.setAttribute("copilotChatTextarea", "");
  document.body.appendChild(textarea);
  const focusSpy = vi.spyOn(textarea, "focus");

  try {
    el.dispatchEvent(
      new CustomEvent("thread-selected", {
        detail: { threadId: "t-focus" },
        bubbles: true,
      }),
    );

    expect(focusSpy).toHaveBeenCalled();
  } finally {
    focusSpy.mockRestore();
    document.body.removeChild(textarea);
  }
});

test("thread-selected focuses the chat input scoped to the ancestor copilot-chat-view", () => {
  const { el } = setupWithConfig();

  // Wrap the drawer in a `copilot-chat-view` that owns its own input, and add a
  // decoy input elsewhere in the document (earlier in document order, so the
  // global fallback would pick IT). findChatInput must prefer the scoped one.
  const decoy = document.createElement("textarea");
  decoy.setAttribute("copilotChatTextarea", "");
  document.body.appendChild(decoy);

  const chatView = document.createElement("copilot-chat-view");
  const scoped = document.createElement("textarea");
  scoped.setAttribute("copilotChatTextarea", "");
  const parent = el.parentElement as HTMLElement;
  parent.insertBefore(chatView, el);
  chatView.appendChild(scoped);
  chatView.appendChild(el); // drawer now lives inside the chat-view

  const scopedSpy = vi.spyOn(scoped, "focus");
  const decoySpy = vi.spyOn(decoy, "focus");
  try {
    el.dispatchEvent(
      new CustomEvent("thread-selected", {
        detail: { threadId: "t-scoped" },
        bubbles: true,
      }),
    );

    expect(scopedSpy).toHaveBeenCalled();
    expect(decoySpy).not.toHaveBeenCalled();
  } finally {
    scopedSpy.mockRestore();
    decoySpy.mockRestore();
    decoy.remove();
    chatView.remove();
  }
});

// ---------------------------------------------------------------------------
// Per-row custom content projection (copilotThreadsDrawerRow directive)
// ---------------------------------------------------------------------------

/** Host component that projects a copilotThreadsDrawerRow template into the drawer. */
@Component({
  selector: "test-host-row",
  standalone: true,
  imports: [CopilotThreadsDrawer, CopilotThreadsDrawerRow],
  template: `
    <copilot-threads-drawer
      ><ng-template copilotThreadsDrawerRow let-t
        >ROW:{{ t.name }}</ng-template
      ></copilot-threads-drawer
    >
  `,
})
class HostWithRowComponent {}

/** Host component that projects a slotted light-DOM child into the drawer. */
@Component({
  selector: "test-host-slot",
  standalone: true,
  imports: [CopilotThreadsDrawer],
  template: `
    <copilot-threads-drawer
      ><span slot="launcher-icon">ICON-X</span></copilot-threads-drawer
    >
  `,
})
class HostWithSlotComponent {}

test("slotted light-DOM children pass through to <copilotkit-threads-drawer>", () => {
  licenseStatusSignal.set("valid");
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [HostWithSlotComponent],
    providers: [copilotkitProvider],
  });

  const fixture = TestBed.createComponent(HostWithSlotComponent);
  fixture.detectChanges();

  const drawerEl = (fixture.nativeElement as HTMLElement).querySelector(
    "copilotkit-threads-drawer",
  );
  const slotChild = drawerEl?.querySelector('[slot="launcher-icon"]');
  expect(slotChild).not.toBeNull();
  expect(slotChild?.textContent).toContain("ICON-X");
});

test("copilotThreadsDrawerRow renders per-row slot content for each thread", () => {
  licenseStatusSignal.set("valid");
  threadsState.threads.set([
    {
      id: "t1",
      name: "Alpha",
      archived: false,
      createdAt: "x",
      updatedAt: "x",
      agentId: "default",
    },
  ]);

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [HostWithRowComponent],
    providers: [copilotkitProvider],
  });

  const fixture = TestBed.createComponent(HostWithRowComponent);
  fixture.detectChanges();

  const slotEl = (fixture.nativeElement as HTMLElement).querySelector(
    '[slot="row:t1"]',
  );
  expect(slotEl?.textContent?.trim()).toContain("ROW:Alpha");
});

// ---------------------------------------------------------------------------
// label input forwarding
// ---------------------------------------------------------------------------

/** Host that passes a custom label to the drawer. */
@Component({
  selector: "test-host-label",
  standalone: true,
  imports: [CopilotThreadsDrawer],
  template: `
    <copilot-threads-drawer [label]="'Custom'" />
  `,
})
class HostWithLabelComponent {}

test("label input is forwarded to the <copilotkit-threads-drawer> element label property", () => {
  licenseStatusSignal.set("valid");
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [HostWithLabelComponent],
    providers: [copilotkitProvider],
  });

  const fixture = TestBed.createComponent(HostWithLabelComponent);
  fixture.detectChanges();

  const drawerEl = (fixture.nativeElement as HTMLElement).querySelector(
    "copilotkit-threads-drawer",
  ) as HTMLElement & { label: string };

  expect(drawerEl.label).toBe("Custom");
});

// ---------------------------------------------------------------------------
// recentLabel input forwarding (ENT-1051 UX redesign parity)
// ---------------------------------------------------------------------------

/** Host that passes a custom recentLabel to the drawer. */
@Component({
  selector: "test-host-recent-label",
  standalone: true,
  imports: [CopilotThreadsDrawer],
  template: `
    <copilot-threads-drawer [recentLabel]="'History'" />
  `,
})
class HostWithRecentLabelComponent {}

test("recentLabel input is forwarded to the element's recent-label attribute", () => {
  licenseStatusSignal.set("valid");
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [HostWithRecentLabelComponent],
    providers: [copilotkitProvider],
  });

  const fixture = TestBed.createComponent(HostWithRecentLabelComponent);
  fixture.detectChanges();

  const el = (fixture.nativeElement as HTMLElement).querySelector(
    "copilotkit-threads-drawer",
  ) as HTMLElement;

  expect(el.getAttribute("recent-label")).toBe("History");
});

// ---------------------------------------------------------------------------
// collapsible input forwarding + collapseChange output (ENT-1051)
// ---------------------------------------------------------------------------

/** Host that passes collapsible={false} to the drawer. */
@Component({
  selector: "test-host-collapsible",
  standalone: true,
  imports: [CopilotThreadsDrawer],
  template: `
    <copilot-threads-drawer [collapsible]="false" />
  `,
})
class HostWithCollapsibleComponent {}

test("collapsible input is forwarded to the element's collapsible property", () => {
  licenseStatusSignal.set("valid");
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [HostWithCollapsibleComponent],
    providers: [copilotkitProvider],
  });

  const fixture = TestBed.createComponent(HostWithCollapsibleComponent);
  fixture.detectChanges();

  const el = (fixture.nativeElement as HTMLElement).querySelector(
    "copilotkit-threads-drawer",
  ) as HTMLElement & { collapsible: boolean };

  expect(el.collapsible).toBe(false);
});

/** Host that binds the `collapseChange` output to a spy. */
@Component({
  selector: "test-host-collapse-change",
  standalone: true,
  imports: [CopilotThreadsDrawer],
  template: `
    <copilot-threads-drawer (collapseChange)="spy($event)" />
  `,
})
class HostWithCollapseChangeComponent {
  spy = vi.fn();
}

test("collapseChange output emits the collapsed state when the element fires a `collapse-change` event", () => {
  licenseStatusSignal.set("valid");
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [HostWithCollapseChangeComponent],
    providers: [copilotkitProvider],
  });

  const fixture = TestBed.createComponent(HostWithCollapseChangeComponent);
  fixture.detectChanges();
  const el = (fixture.nativeElement as HTMLElement).querySelector(
    "copilotkit-threads-drawer",
  ) as HTMLElement;

  el.dispatchEvent(
    new CustomEvent("collapse-change", {
      detail: { collapsed: true },
      bubbles: true,
      composed: true,
    }),
  );

  expect(fixture.componentInstance.spy).toHaveBeenCalledWith(true);
});

// ---------------------------------------------------------------------------
// License gate
// ---------------------------------------------------------------------------

/** Casts the drawer element to expose the license-related JS properties. */
type LicensedEl = HTMLElement & {
  licensed: boolean;
  loading: boolean;
  licenseUrl: string;
};

test("a resolved-unlicensed status gates the element to the locked view", async () => {
  const { fixture, el } = setup();

  licenseStatusSignal.set("none");
  fixture.detectChanges();
  await fixture.whenStable();

  expect((el as LicensedEl).licensed).toBe(false);
});

test("an expired status gates the element to the locked view", async () => {
  const { fixture, el } = setup();

  licenseStatusSignal.set("expired");
  fixture.detectChanges();
  await fixture.whenStable();

  expect((el as LicensedEl).licensed).toBe(false);
});

test("a valid license keeps the element in the licensed (list) state", async () => {
  const { fixture, el } = setup();

  licenseStatusSignal.set("valid");
  fixture.detectChanges();
  await fixture.whenStable();

  expect((el as LicensedEl).licensed).toBe(true);
});

test("a pending (unresolved) status renders licensed-and-loading, never the locked view", async () => {
  threadsState.isLoading.set(false);
  const { fixture, el } = setup();

  licenseStatusSignal.set(undefined);
  fixture.detectChanges();
  await fixture.whenStable();

  expect((el as LicensedEl).licensed).toBe(true);
  expect((el as LicensedEl).loading).toBe(true);
});

/** Host that passes a custom licenseUrl to the drawer. */
@Component({
  selector: "test-host-license-url",
  standalone: true,
  imports: [CopilotThreadsDrawer],
  template: `
    <copilot-threads-drawer [licenseUrl]="'https://example.com/upgrade'" />
  `,
})
class HostWithLicenseUrlComponent {}

test("licenseUrl input is forwarded to the element's licenseUrl property", () => {
  licenseStatusSignal.set("valid");
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [HostWithLicenseUrlComponent],
    providers: [copilotkitProvider],
  });

  const fixture = TestBed.createComponent(HostWithLicenseUrlComponent);
  fixture.detectChanges();

  const drawerEl = (fixture.nativeElement as HTMLElement).querySelector(
    "copilotkit-threads-drawer",
  ) as LicensedEl;

  expect(drawerEl.licenseUrl).toBe("https://example.com/upgrade");
});

/** Host that binds an onLicensed override callback. */
@Component({
  selector: "test-host-licensed",
  standalone: true,
  imports: [CopilotThreadsDrawer],
  template: `
    <copilot-threads-drawer [onLicensed]="spy" />
  `,
})
class HostWithLicensedComponent {
  spy = vi.fn();
}

test("onLicensed handler is invoked when the element emits the `licensed` event", () => {
  licenseStatusSignal.set("valid");
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [HostWithLicensedComponent],
    providers: [copilotkitProvider],
  });

  const fixture = TestBed.createComponent(HostWithLicensedComponent);
  fixture.detectChanges();
  const el = (fixture.nativeElement as HTMLElement).querySelector(
    "copilotkit-threads-drawer",
  ) as HTMLElement;

  el.dispatchEvent(
    new CustomEvent("licensed", {
      detail: { licenseUrl: "https://example.com" },
      bubbles: true,
    }),
  );

  expect(fixture.componentInstance.spy).toHaveBeenCalled();
});
