import { signal, type Signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { recordUserAction } from "@copilotkit/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COPILOT_CHAT_CONFIGURATION } from "./chat-configuration";
import { CopilotKit } from "./copilotkit";
import {
  injectLearnFromUserAction,
  injectLearnFromUserActionInCurrentThread,
} from "./user-actions";

vi.mock("@copilotkit/core", async () => {
  const actual =
    await vi.importActual<typeof import("@copilotkit/core")>(
      "@copilotkit/core",
    );
  return { ...actual, recordUserAction: vi.fn() };
});

const mockRecordUserAction = vi.mocked(recordUserAction);

function configure(currentThread?: Signal<string>) {
  const runtimeUrl = signal<string | undefined>(
    "https://runtime.example.com/copilotkit",
  );
  const headers = signal<Record<string, string>>({ Authorization: "old" });
  const credentials = signal<RequestCredentials | undefined>("same-origin");
  const copilotKit = { runtimeUrl, headers, credentials };

  TestBed.configureTestingModule({
    providers: [
      { provide: CopilotKit, useValue: copilotKit },
      ...(currentThread
        ? [
            {
              provide: COPILOT_CHAT_CONFIGURATION,
              useValue: { threadId: currentThread },
            },
          ]
        : []),
    ],
  });

  return { runtimeUrl, headers, credentials };
}

describe("Angular user-action recorders", () => {
  beforeEach(() => {
    mockRecordUserAction.mockResolvedValue({
      id: "annotation-id",
      duplicate: false,
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.clearAllMocks();
  });

  it("records an explicit-thread user action with the current runtime transport", async () => {
    const transport = configure();
    const recorder = TestBed.runInInjectionContext(() =>
      injectLearnFromUserAction(),
    );
    transport.runtimeUrl.set("https://runtime.example.com/updated");
    transport.headers.set({ Authorization: "Bearer token" });
    transport.credentials.set("include");

    const result = await recorder({
      threadId: "thread-id",
      title: "Renamed project",
      description: "The user chose a clearer name",
      data: { previous: "Old", next: "New" },
      occurredAt: "2026-08-16T12:00:00.000Z",
      clientEventId: "client-event-id",
    });

    expect(result).toEqual({ id: "annotation-id", duplicate: false });
    expect(mockRecordUserAction).toHaveBeenCalledWith({
      runtimeUrl: "https://runtime.example.com/updated",
      headers: { Authorization: "Bearer token" },
      credentials: "include",
      threadId: "thread-id",
      title: "Renamed project",
      description: "The user chose a clearer name",
      data: { previous: "Old", next: "New" },
      occurredAt: "2026-08-16T12:00:00.000Z",
      clientEventId: "client-event-id",
    });
  });

  it("reports a missing runtime URL when the recorder is called", async () => {
    const { runtimeUrl } = configure();
    const recorder = TestBed.runInInjectionContext(() =>
      injectLearnFromUserAction(),
    );
    runtimeUrl.set(undefined);

    await expect(recorder({ threadId: "thread-id" })).rejects.toThrow(
      /runtimeUrl is not configured/,
    );
    expect(mockRecordUserAction).not.toHaveBeenCalled();
  });

  it("reads the ambient thread when the current-thread recorder is called", async () => {
    const threadId = signal("initial-thread");
    configure(threadId);
    const recorder = TestBed.runInInjectionContext(() =>
      injectLearnFromUserActionInCurrentThread(),
    );
    threadId.set("current-thread");

    await recorder({ title: "Approved request" });

    expect(mockRecordUserAction).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: "current-thread" }),
    );
  });

  it("reports a missing ambient thread when the recorder is called", async () => {
    configure();
    const recorder = TestBed.runInInjectionContext(() =>
      injectLearnFromUserActionInCurrentThread(),
    );

    await expect(recorder({ title: "Approved request" })).rejects.toThrow(
      /provideCopilotChatConfiguration/,
    );
    expect(mockRecordUserAction).not.toHaveBeenCalled();
  });
});
