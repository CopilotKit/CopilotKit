import { describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { mount } from "@vue/test-utils";
import type { AbstractAgent } from "@ag-ui/client";
import {
  MCPAppsActivityContentSchema,
  MCPAppsActivityRenderer,
  MCPAppsActivityType,
} from "../MCPAppsActivityRenderer";

function createAgentMock(options?: {
  runResult?: unknown;
  runImpl?: () => Promise<unknown>;
  isRunning?: boolean;
  threadId?: string;
}): AbstractAgent {
  const runAgent = options?.runImpl
    ? vi.fn(options.runImpl)
    : vi
        .fn()
        .mockResolvedValue(options?.runResult ?? { result: { contents: [] } });

  return {
    threadId: options?.threadId ?? `thread-${Math.random()}`,
    isRunning: options?.isRunning ?? false,
    runAgent,
    addMessage: vi.fn(),
    subscribe: vi.fn(() => ({
      unsubscribe: vi.fn(),
    })),
  } as unknown as AbstractAgent;
}

async function flushAsync() {
  await nextTick();
  await Promise.resolve();
  await nextTick();
}

describe("MCPAppsActivityRenderer", () => {
  it("exports the expected activity type and schema", () => {
    expect(MCPAppsActivityType).toBe("mcp-apps");

    const valid = MCPAppsActivityContentSchema.safeParse({
      resourceUri: "ui://server/dashboard",
      serverHash: "abc123",
      result: {
        content: [{ type: "text", text: "ok" }],
        isError: false,
      },
    });
    expect(valid.success).toBe(true);

    const invalid = MCPAppsActivityContentSchema.safeParse({
      serverHash: "abc123",
      result: {},
    });
    expect(invalid.success).toBe(false);
  });

  it("shows an error when no agent is provided", async () => {
    const wrapper = mount(MCPAppsActivityRenderer, {
      props: {
        activityType: MCPAppsActivityType,
        content: {
          resourceUri: "ui://server/dashboard",
          serverHash: "abc123",
          result: {},
        },
        message: {
          id: "activity-1",
          role: "assistant",
          content: "",
          activityType: MCPAppsActivityType,
        },
        agent: undefined,
      },
    });

    await nextTick();

    expect(wrapper.text()).toContain("No agent available to fetch resource");
  });

  it("shows loading state while request is in progress", async () => {
    let resolveRun: ((value: unknown) => void) | undefined;
    const pendingRun = new Promise((resolve) => {
      resolveRun = resolve;
    });
    const agent = createAgentMock({
      runImpl: () => pendingRun,
      threadId: "loading-thread",
    });

    const wrapper = mount(MCPAppsActivityRenderer, {
      props: {
        activityType: MCPAppsActivityType,
        content: {
          resourceUri: "ui://server/loading",
          serverHash: "hash-loading",
          result: {},
        },
        message: {
          id: "activity-loading",
          role: "assistant",
          content: "",
          activityType: MCPAppsActivityType,
        },
        agent,
      },
    });

    await flushAsync();
    expect(wrapper.text()).toContain("Loading...");
    resolveRun?.({ result: { contents: [] } });
  });

  it("renders error when response has no resource content", async () => {
    const agent = createAgentMock({
      runResult: { result: { contents: [] } },
      threadId: "error-thread",
    });

    const wrapper = mount(MCPAppsActivityRenderer, {
      props: {
        activityType: MCPAppsActivityType,
        content: {
          resourceUri: "ui://server/empty",
          serverHash: "hash-empty",
          result: {},
        },
        message: {
          id: "activity-empty",
          role: "assistant",
          content: "",
          activityType: MCPAppsActivityType,
        },
        agent,
      },
    });

    await flushAsync();
    await flushAsync();
    expect(wrapper.text()).toContain("Error: No resource content in response");
  });

  it("forwards both serverHash and serverId for proxied request", async () => {
    const agent = createAgentMock({
      runResult: {
        result: {
          contents: [{ uri: "ui://server/r", text: "<div>ok</div>" }],
        },
      },
      threadId: "proxy-thread",
    });

    mount(MCPAppsActivityRenderer, {
      props: {
        activityType: MCPAppsActivityType,
        content: {
          resourceUri: "ui://server/r",
          serverHash: "hash-1",
          serverId: "srv-1",
          result: {},
        },
        message: {
          id: "activity-proxy",
          role: "assistant",
          content: "",
          activityType: MCPAppsActivityType,
        },
        agent,
      },
    });

    await flushAsync();
    expect(agent.runAgent).toHaveBeenCalledWith({
      forwardedProps: {
        __proxiedMCPRequest: {
          serverHash: "hash-1",
          serverId: "srv-1",
          method: "resources/read",
          params: { uri: "ui://server/r" },
        },
      },
    });
  });

  it("applies border styling when prefersBorder is true", async () => {
    const agent = createAgentMock({
      runResult: {
        result: {
          contents: [
            {
              uri: "ui://server/bordered",
              text: "<div>bordered</div>",
              _meta: {
                ui: {
                  prefersBorder: true,
                },
              },
            },
          ],
        },
      },
      threadId: "border-thread",
    });

    const wrapper = mount(MCPAppsActivityRenderer, {
      props: {
        activityType: MCPAppsActivityType,
        content: {
          resourceUri: "ui://server/bordered",
          serverHash: "hash-border",
          result: {},
        },
        message: {
          id: "activity-border",
          role: "assistant",
          content: "",
          activityType: MCPAppsActivityType,
        },
        agent,
      },
    });

    await flushAsync();
    await flushAsync();

    const style = wrapper.attributes("style");
    expect(style).toContain("border-radius: 8px");
    expect(style).toContain("border: 1px solid rgb(224, 224, 224)");
  });

  it("does not apply border styling when prefersBorder is false", async () => {
    const agent = createAgentMock({
      runResult: {
        result: {
          contents: [
            {
              uri: "ui://server/plain",
              text: "<div>plain</div>",
              _meta: {
                ui: {
                  prefersBorder: false,
                },
              },
            },
          ],
        },
      },
      threadId: "no-border-thread",
    });

    const wrapper = mount(MCPAppsActivityRenderer, {
      props: {
        activityType: MCPAppsActivityType,
        content: {
          resourceUri: "ui://server/plain",
          serverHash: "hash-plain",
          result: {},
        },
        message: {
          id: "activity-no-border",
          role: "assistant",
          content: "",
          activityType: MCPAppsActivityType,
        },
        agent,
      },
    });

    await flushAsync();
    await flushAsync();

    const style = wrapper.attributes("style");
    expect(style).not.toContain("border-radius: 8px");
    expect(style).not.toContain("border: 1px solid rgb(224, 224, 224)");
  });

  it("includes resourceDomains in the sandbox iframe CSP when provided", async () => {
    const agent = createAgentMock({
      runResult: {
        result: {
          contents: [
            {
              uri: "ui://server/csp",
              text: "<div>csp</div>",
              _meta: {
                ui: {
                  csp: {
                    resourceDomains: [
                      "https://widgets.example.com",
                      "https://cdn.example.com",
                    ],
                  },
                },
              },
            },
          ],
        },
      },
      threadId: "csp-thread",
    });

    const wrapper = mount(MCPAppsActivityRenderer, {
      props: {
        activityType: MCPAppsActivityType,
        content: {
          resourceUri: "ui://server/csp",
          serverHash: "hash-csp",
          result: {},
        },
        message: {
          id: "activity-csp",
          role: "assistant",
          content: "",
          activityType: MCPAppsActivityType,
        },
        agent,
      },
    });

    await flushAsync();
    await flushAsync();

    const iframe = wrapper.find("iframe").element as HTMLIFrameElement;
    expect(iframe.srcdoc).toContain("script-src");
    expect(iframe.srcdoc).toContain("frame-src");
    expect(iframe.srcdoc).toContain("https://widgets.example.com");
    expect(iframe.srcdoc).toContain("https://cdn.example.com");
  });

  it("keeps the sandbox iframe CSP unchanged when no resourceDomains are provided", async () => {
    const agent = createAgentMock({
      runResult: {
        result: {
          contents: [
            { uri: "ui://server/default-csp", text: "<div>default</div>" },
          ],
        },
      },
      threadId: "default-csp-thread",
    });

    const wrapper = mount(MCPAppsActivityRenderer, {
      props: {
        activityType: MCPAppsActivityType,
        content: {
          resourceUri: "ui://server/default-csp",
          serverHash: "hash-default-csp",
          result: {},
        },
        message: {
          id: "activity-default-csp",
          role: "assistant",
          content: "",
          activityType: MCPAppsActivityType,
        },
        agent,
      },
    });

    await flushAsync();
    await flushAsync();

    const iframe = wrapper.find("iframe").element as HTMLIFrameElement;
    expect(iframe.srcdoc).toContain(
      "script-src 'self' 'wasm-unsafe-eval' 'unsafe-inline' 'unsafe-eval' blob: data: http://localhost:* https://localhost:*;",
    );
    expect(iframe.srcdoc).toContain(
      "frame-src * blob: data: http://localhost:* https://localhost:*;",
    );
    expect(iframe.srcdoc).not.toContain("widgets.example.com");
  });
});
