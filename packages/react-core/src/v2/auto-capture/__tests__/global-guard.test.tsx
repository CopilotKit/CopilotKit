import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCopilotKit } from "../../context";
import { useCopilotChatConfiguration } from "../../providers/CopilotChatConfigurationProvider";
import { useRecordUserAction } from "../../hooks/use-record-user-action";
import { useAutoCaptureUserActions } from "../use-auto-capture-user-actions";
import type { AutoCaptureUserActionsConfig } from "../types";
import { resetAutoCaptureGlobals } from "./reset-globals";

/**
 * RD-30: the global network primitives must be **reference-identical** to their
 * originals — not wrapped, not proxied — in every state except
 * "auto-learning ON **and** Intelligence configured". A transparent
 * call-through wrapper still counts as "touched" and must fail these checks, so
 * the assertions are identity-based (`toBe`), never behavioral.
 */

vi.mock("../../context", () => ({ useCopilotKit: vi.fn() }));
vi.mock("../../providers/CopilotChatConfigurationProvider", () => ({
  useCopilotChatConfiguration: vi.fn(),
}));
vi.mock("../../hooks/use-record-user-action", () => ({
  useRecordUserAction: vi.fn(),
}));

const mockUseCopilotKit = useCopilotKit as ReturnType<typeof vi.fn>;
const mockUseChatConfig = useCopilotChatConfiguration as ReturnType<typeof vi.fn>;
const mockUseRecordUserAction = useRecordUserAction as ReturnType<typeof vi.fn>;

const RUNTIME_URL = `${window.location.origin}/api/copilotkit`;

// A stable function we treat as the pristine `fetch` original for identity checks.
const baseFetch = (async () =>
  new Response("{}")) as unknown as typeof globalThis.fetch;

// A non-undefined `IntelligenceRuntimeInfo`-shaped value = "Intelligence configured".
const CONFIGURED = { wsUrl: "ws://intel.test" };

interface Originals {
  fetch: typeof globalThis.fetch;
  xhrOpen: typeof XMLHttpRequest.prototype.open;
  xhrSend: typeof XMLHttpRequest.prototype.send;
}
let originals: Originals;

/** `intelligence: undefined` models "Intelligence not configured". */
const setContext = (intelligence: unknown): void => {
  mockUseCopilotKit.mockReturnValue({
    copilotkit: { runtimeUrl: RUNTIME_URL, headers: {}, intelligence },
  });
  mockUseChatConfig.mockReturnValue({ threadId: "thread-1" });
  mockUseRecordUserAction.mockReturnValue(
    vi.fn(async () => ({ id: "1", duplicate: false })),
  );
};

const mount = (config: AutoCaptureUserActionsConfig) =>
  renderHook(() => useAutoCaptureUserActions(config));

const expectUntouched = (): void => {
  expect(globalThis.fetch).toBe(originals.fetch);
  expect(XMLHttpRequest.prototype.open).toBe(originals.xhrOpen);
  expect(XMLHttpRequest.prototype.send).toBe(originals.xhrSend);
};

const expectPatched = (): void => {
  expect(globalThis.fetch).not.toBe(originals.fetch);
  expect(XMLHttpRequest.prototype.open).not.toBe(originals.xhrOpen);
  expect(XMLHttpRequest.prototype.send).not.toBe(originals.xhrSend);
};

beforeEach(() => {
  resetAutoCaptureGlobals();
  globalThis.fetch = baseFetch;
  originals = {
    fetch: globalThis.fetch,
    xhrOpen: XMLHttpRequest.prototype.open,
    xhrSend: XMLHttpRequest.prototype.send,
  };
});

afterEach(() => {
  resetAutoCaptureGlobals();
  vi.clearAllMocks();
});

describe("useAutoCaptureUserActions — global guard (RD-30)", () => {
  it("leaves globals untouched when auto-learning is off (default), even with Intelligence configured", () => {
    setContext(CONFIGURED);
    mount({ enabled: false });
    expectUntouched();
  });

  it("leaves globals untouched when Intelligence is NOT configured, even if the flag is on", () => {
    setContext(undefined);
    mount({ enabled: true });
    expectUntouched();
  });

  it("leaves globals untouched when both off", () => {
    setContext(undefined);
    mount({ enabled: false });
    expectUntouched();
  });

  it("patches the globals only when auto-learning is on AND Intelligence is configured", () => {
    setContext(CONFIGURED);
    mount({ enabled: true });
    expectPatched();
  });

  it("restores the originals on unmount — no leak past the feature lifecycle", () => {
    setContext(CONFIGURED);
    const { unmount } = mount({ enabled: true });
    expectPatched();
    unmount();
    expectUntouched();
  });
});
