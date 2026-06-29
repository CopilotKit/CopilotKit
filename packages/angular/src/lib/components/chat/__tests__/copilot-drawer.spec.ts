import { Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { signal } from "@angular/core";
import { test, expect, vi } from "vitest";
import type { DrawerThread } from "@copilotkit/web-components/drawer";
import { CopilotDrawer, CopilotDrawerRow } from "../copilot-drawer";
import type { Thread } from "../../../threads";
import { COPILOT_CHAT_CONFIGURATION } from "../../../chat-configuration";

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

/** Host component that renders {@link CopilotDrawer} under test. */
@Component({
  selector: "test-host",
  standalone: true,
  imports: [CopilotDrawer],
  template: `
    <copilot-drawer />
  `,
})
class HostComponent {}

/** Host component that binds an override callback for thread-select. */
@Component({
  selector: "test-host-thread-select",
  standalone: true,
  imports: [CopilotDrawer],
  template: `
    <copilot-drawer [onThreadSelect]="spy" />
  `,
})
class HostWithThreadSelectComponent {
  spy = vi.fn();
}

/** Host component that binds an override callback for new-thread. */
@Component({
  selector: "test-host-new-thread",
  standalone: true,
  imports: [CopilotDrawer],
  template: `
    <copilot-drawer [onNewThread]="spy" />
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
 * returns the fixture together with the rendered `<copilotkit-drawer>` element.
 */
function setup() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [HostComponent],
  });

  const fixture = TestBed.createComponent(HostComponent);
  fixture.detectChanges();
  const el = (fixture.nativeElement as HTMLElement).querySelector(
    "copilotkit-drawer",
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
  };
}

/**
 * Configures TestBed with the fake config provided as the
 * `COPILOT_CHAT_CONFIGURATION` token value, creates the fixture, and returns
 * the fixture, the inner `<copilotkit-drawer>` element, and the config spy.
 */
function setupWithConfig(config = fakeConfig()) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [HostComponent],
    providers: [{ provide: COPILOT_CHAT_CONFIGURATION, useValue: config }],
  });

  const fixture = TestBed.createComponent(HostComponent);
  fixture.detectChanges();
  const el = (fixture.nativeElement as HTMLElement).querySelector(
    "copilotkit-drawer",
  ) as HTMLElement | null;
  return { fixture, el: el!, config };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("renders <copilotkit-drawer> with the default data-testid", () => {
  const { el } = setup();

  expect(el).not.toBeNull();
  expect(customElements.get("copilotkit-drawer")).toBeDefined();
  expect(el!.getAttribute("data-testid")).toBe("copilot-drawer");
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
    providers: [{ provide: COPILOT_CHAT_CONFIGURATION, useValue: config }],
  });

  const fixture = TestBed.createComponent(HostWithThreadSelectComponent);
  fixture.detectChanges();
  const el = (fixture.nativeElement as HTMLElement).querySelector(
    "copilotkit-drawer",
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
    providers: [{ provide: COPILOT_CHAT_CONFIGURATION, useValue: config }],
  });

  const fixture = TestBed.createComponent(HostWithNewThreadComponent);
  fixture.detectChanges();
  const el = (fixture.nativeElement as HTMLElement).querySelector(
    "copilotkit-drawer",
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
// Per-row custom content projection (copilotDrawerRow directive)
// ---------------------------------------------------------------------------

/** Host component that projects a copilotDrawerRow template into the drawer. */
@Component({
  selector: "test-host-row",
  standalone: true,
  imports: [CopilotDrawer, CopilotDrawerRow],
  template: `
    <copilot-drawer
      ><ng-template copilotDrawerRow let-t
        >ROW:{{ t.name }}</ng-template
      ></copilot-drawer
    >
  `,
})
class HostWithRowComponent {}

/** Host component that projects a slotted light-DOM child into the drawer. */
@Component({
  selector: "test-host-slot",
  standalone: true,
  imports: [CopilotDrawer],
  template: `
    <copilot-drawer><span slot="launcher-icon">ICON-X</span></copilot-drawer>
  `,
})
class HostWithSlotComponent {}

test("slotted light-DOM children pass through to <copilotkit-drawer>", () => {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [HostWithSlotComponent],
  });

  const fixture = TestBed.createComponent(HostWithSlotComponent);
  fixture.detectChanges();

  const drawerEl = (fixture.nativeElement as HTMLElement).querySelector(
    "copilotkit-drawer",
  );
  const slotChild = drawerEl?.querySelector('[slot="launcher-icon"]');
  expect(slotChild).not.toBeNull();
  expect(slotChild?.textContent).toContain("ICON-X");
});

test("copilotDrawerRow renders per-row slot content for each thread", () => {
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
  imports: [CopilotDrawer],
  template: `<copilot-drawer [label]="'Custom'" />`,
})
class HostWithLabelComponent {}

test("label input is forwarded to the <copilotkit-drawer> element label property", () => {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [HostWithLabelComponent],
  });

  const fixture = TestBed.createComponent(HostWithLabelComponent);
  fixture.detectChanges();

  const drawerEl = (fixture.nativeElement as HTMLElement).querySelector(
    "copilotkit-drawer",
  ) as HTMLElement & { label: string };

  expect(drawerEl.label).toBe("Custom");
});
