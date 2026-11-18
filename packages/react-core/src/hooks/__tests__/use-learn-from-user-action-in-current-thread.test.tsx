import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCopilotKit } from "../../context";
import { useCopilotChatConfiguration } from "../../providers";
import { useLearnFromUserActionInCurrentThread } from "../use-learn-from-user-action-in-current-thread";

vi.mock("../../context", () => ({
  useCopilotKit: vi.fn(),
}));

vi.mock("../../providers", () => ({
  useCopilotChatConfiguration: vi.fn(),
}));

let uuidCounter = 0;
vi.mock("@copilotkit/shared", async () => {
  const actual =
    await vi.importActual<Record<string, unknown>>("@copilotkit/shared");
  return {
    ...actual,
    randomUUID: vi.fn(() => `uuid-${++uuidCounter}`),
  };
});

const mockUseCopilotKit = useCopilotKit as ReturnType<typeof vi.fn>;
const mockUseCopilotChatConfiguration =
  useCopilotChatConfiguration as ReturnType<typeof vi.fn>;

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
  body: Record<string, unknown> | null;
}

const mockFetch = (
  responses: Array<{ status: number; body: unknown }>,
): { calls: FetchCall[]; fetch: typeof globalThis.fetch } => {
  const calls: FetchCall[] = [];
  let index = 0;
  const fetch = vi.fn(async (url, init) => {
    let parsedBody: Record<string, unknown> | null = null;
    if (init?.body && typeof init.body === "string") {
      try {
        parsedBody = JSON.parse(init.body);
      } catch {
        parsedBody = null;
      }
    }
    calls.push({ url: String(url), init, body: parsedBody });
    const response = responses[index++] ?? responses[responses.length - 1]!;
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  });
  return { calls, fetch: fetch as unknown as typeof globalThis.fetch };
};

const installCopilotKit = () => {
  mockUseCopilotKit.mockReturnValue({
    copilotkit: {
      runtimeUrl: "https://bff.example.com/api/copilotkit",
      headers: undefined,
    },
  });
};

const installChatConfig = (threadId: string | null | undefined) => {
  if (threadId == null) {
    mockUseCopilotChatConfiguration.mockReturnValue(null);
    return;
  }
  mockUseCopilotChatConfiguration.mockReturnValue({
    threadId,
    agentId: "agent-1",
    labels: {},
    isModalOpen: false,
    setModalOpen: () => undefined,
    hasExplicitThreadId: true,
  });
};

describe("useLearnFromUserActionInCurrentThread", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    uuidCounter = 0;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it("POSTs to ${runtimeUrl}/annotate with type:user_action and pre-fills threadId from chat config", async () => {
    installCopilotKit();
    installChatConfig("thread-from-context");
    const { calls, fetch } = mockFetch([
      { status: 200, body: { id: "1", duplicate: false } },
    ]);
    globalThis.fetch = fetch;

    const { result } = renderHook(() =>
      useLearnFromUserActionInCurrentThread(),
    );
    await result.current({ title: "Clicked rename" });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      "https://bff.example.com/api/copilotkit/annotate",
    );
    expect(calls[0]!.body!.type).toBe("user_action");
    expect(calls[0]!.body!.threadId).toBe("thread-from-context");
  });

  it("uses an auto-minted thread id from the provider just as well as an explicit one", async () => {
    installCopilotKit();
    // Even if the chat-config provider auto-minted the threadId (no
    // explicit caller choice), the hook still uses it. The platform
    // accepts unknown thread ids and the writer agent still learns
    // from user-action-only threads — orphans are not a concern.
    mockUseCopilotChatConfiguration.mockReturnValue({
      threadId: "auto-minted-uuid",
      agentId: "agent-1",
      labels: {},
      isModalOpen: false,
      setModalOpen: () => undefined,
      hasExplicitThreadId: false,
    });
    const { calls, fetch } = mockFetch([
      { status: 200, body: { id: "1", duplicate: false } },
    ]);
    globalThis.fetch = fetch;

    const { result } = renderHook(() =>
      useLearnFromUserActionInCurrentThread(),
    );
    await result.current({ title: "x" });

    expect(calls[0]!.body!.threadId).toBe("auto-minted-uuid");
  });

  it("throws on call (not on mount) when no chat config is in scope", async () => {
    installCopilotKit();
    installChatConfig(null);
    const { fetch } = mockFetch([
      { status: 200, body: { id: "1", duplicate: false } },
    ]);
    globalThis.fetch = fetch;

    // Mounting the hook with no config is fine.
    const { result } = renderHook(() =>
      useLearnFromUserActionInCurrentThread(),
    );

    // The call throws.
    await expect(result.current({ title: "x" })).rejects.toThrow(
      /no CopilotChatConfigurationProvider/,
    );
  });

  it("throws on call when config.threadId is empty", async () => {
    installCopilotKit();
    installChatConfig("");
    const { result } = renderHook(() =>
      useLearnFromUserActionInCurrentThread(),
    );
    await expect(result.current({ title: "x" })).rejects.toThrow(
      /no CopilotChatConfigurationProvider/,
    );
  });

  it("nests title, description, and data inside payload", async () => {
    installCopilotKit();
    installChatConfig("thread-1");
    const { calls, fetch } = mockFetch([
      { status: 200, body: { id: "1", duplicate: false } },
    ]);
    globalThis.fetch = fetch;

    const { result } = renderHook(() =>
      useLearnFromUserActionInCurrentThread(),
    );
    await result.current({
      title: "Renamed project",
      description: "User renamed Foo to Bar",
      data: { previous: { name: "Foo" }, next: { name: "Bar" } },
    });

    expect(calls[0]!.body).toMatchObject({
      type: "user_action",
      threadId: "thread-1",
      payload: {
        title: "Renamed project",
        description: "User renamed Foo to Bar",
        data: { previous: { name: "Foo" }, next: { name: "Bar" } },
      },
    });
    // learningContainer and metadata must not appear anywhere in the body
    expect(calls[0]!.body).not.toHaveProperty("learningContainer");
    expect(calls[0]!.body).not.toHaveProperty("metadata");
  });

  it("does not accept learningContainer or metadata — both are removed from the input type", async () => {
    installCopilotKit();
    installChatConfig("thread-1");
    const { calls, fetch } = mockFetch([
      { status: 200, body: { id: "1", duplicate: false } },
    ]);
    globalThis.fetch = fetch;

    const { result } = renderHook(() =>
      useLearnFromUserActionInCurrentThread(),
    );
    await result.current({
      title: "Renamed project",
    });

    expect(calls[0]!.body).not.toHaveProperty("learningContainer");
    expect(calls[0]!.body).not.toHaveProperty("metadata");
  });

  it("allows omitting all optional fields", async () => {
    installCopilotKit();
    installChatConfig("thread-1");
    const { calls, fetch } = mockFetch([
      { status: 200, body: { id: "1", duplicate: false } },
    ]);
    globalThis.fetch = fetch;

    const { result } = renderHook(() =>
      useLearnFromUserActionInCurrentThread(),
    );
    // No title, no description, no data — just thread context.
    await result.current({});

    expect(calls[0]!.body!.threadId).toBe("thread-1");
    expect(calls[0]!.body!.type).toBe("user_action");
    // payload may be present but should not have title/description
    const payload = calls[0]!.body!.payload as
      | Record<string, unknown>
      | undefined;
    if (payload) {
      expect(payload).not.toHaveProperty("title");
      expect(payload).not.toHaveProperty("description");
    }
  });
});
