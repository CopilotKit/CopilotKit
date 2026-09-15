import { describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { mount } from "@vue/test-utils";
import type { AbstractAgent } from "@ag-ui/client";
import {
  MCPAppsActivityContentSchema,
  MCPAppsActivityRenderer,
  MCPAppsActivityType,
} from "../MCPAppsActivityRenderer";

const runCopilotAgent = vi.fn();
vi.mock("../../providers/useCopilotKit", () => ({
  useCopilotKit: () => ({
    copilotkit: {
      value: {
        runAgent: runCopilotAgent,
      },
    },
  }),
}));

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

/**
 * Wait for the sandbox iframe to be configured by the shared session. The host
 * mounts the iframe synchronously, but the bridge package is loaded through a
 * dynamic import and the resource is fetched through the agent, so `srcdoc` (and
 * the sandbox contract attributes) land a few macrotasks later.
 */
async function waitForSandboxIframe(wrapper: {
  find: (selector: string) => { exists: () => boolean; element: Element };
}): Promise<HTMLIFrameElement> {
  let iframe: HTMLIFrameElement | undefined;
  await vi.waitFor(() => {
    const found = wrapper.find("iframe");
    expect(found.exists()).toBe(true);
    const element = found.element as HTMLIFrameElement;
    expect(element.srcdoc).toBeTruthy();
    iframe = element;
  });
  return iframe!;
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
          role: "activity",
          content: {},
          activityType: MCPAppsActivityType,
        },
        agent: undefined,
      },
    });

    await nextTick();

    expect(wrapper.text()).toContain("No agent available to fetch resource");
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
          role: "activity",
          content: {},
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
          role: "activity",
          content: {},
          activityType: MCPAppsActivityType,
        },
        agent,
      },
    });

    const iframe = await waitForSandboxIframe(wrapper);
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
          role: "activity",
          content: {},
          activityType: MCPAppsActivityType,
        },
        agent,
      },
    });

    const iframe = await waitForSandboxIframe(wrapper);
    expect(iframe.srcdoc).toContain(
      "script-src 'self' 'wasm-unsafe-eval' 'unsafe-inline' 'unsafe-eval' blob: data: http://localhost:* https://localhost:*;",
    );
    expect(iframe.srcdoc).toContain(
      "frame-src * blob: data: http://localhost:* https://localhost:*;",
    );
    expect(iframe.srcdoc).not.toContain("widgets.example.com");
  });

  // Cross-frontend surface contract: the shared harness probe
  // (`showcase/harness/src/probes/scripts/d5-mcp-apps.ts`) settles the turn on
  // `[data-testid="mcp-app-iframe"]` mounting. Angular and react-core declare
  // the same pair; dropping it here silently reds the D5/D6 mcp-apps rows on
  // every Vue integration while the demo still looks fine by hand.
  it("tags the sandbox iframe with the shared mcp-app-iframe testid", async () => {
    const agent = createAgentMock({
      runResult: {
        result: {
          contents: [{ uri: "ui://server/testid", text: "<div>testid</div>" }],
        },
      },
      threadId: "testid-thread",
    });

    const wrapper = mount(MCPAppsActivityRenderer, {
      props: {
        activityType: MCPAppsActivityType,
        content: {
          resourceUri: "ui://server/testid",
          serverHash: "hash-testid",
          result: {},
        },
        message: {
          id: "activity-testid",
          role: "activity",
          content: {},
          activityType: MCPAppsActivityType,
        },
        agent,
      },
    });

    await waitForSandboxIframe(wrapper);

    const iframe = wrapper.find('iframe[data-testid="mcp-app-iframe"]');
    expect(iframe.exists()).toBe(true);
    expect(iframe.attributes("title")).toBe("Interactive MCP application");
  });
});
