import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { mount } from "@vue/test-utils";
import type { AbstractAgent } from "@ag-ui/client";
import {
  MCPAppsActivityContentSchema,
  MCPAppsActivityRenderer,
  MCPAppsActivityType,
  ɵmcpToolResultText,
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

  // A tool call whose MCP result carries `isError: true` used to be forwarded to
  // the app and otherwise ignored host-side: the activity rendered an empty box
  // while the chat chip still read "Done". Captured verbatim off prod:
  // mcp.excalidraw.com rejecting a malformed `elements` argument.
  describe("Tool Failure Surfacing", () => {
    const TOOL_ERROR_TESTID = '[data-testid="copilot-mcp-apps-tool-error"]';
    const RECORDED_ERROR_TEXT =
      "Invalid JSON in elements: Unexpected non-whitespace character after JSON " +
      "at position 540 (line 1 column 541). Ensure no comments, no trailing " +
      "commas, and proper quoting.";

    afterEach(() => {
      vi.restoreAllMocks();
    });

    async function mountWithResult(result: {
      content?: unknown[];
      structuredContent?: unknown;
      isError?: boolean;
    }) {
      const agent = createAgentMock({
        runResult: {
          result: {
            contents: [
              { uri: "ui://excalidraw/view", text: "<div>excalidraw</div>" },
            ],
          },
        },
        threadId: `tool-failure-${Math.random()}`,
      });

      const wrapper = mount(MCPAppsActivityRenderer, {
        props: {
          activityType: MCPAppsActivityType,
          content: {
            resourceUri: "ui://excalidraw/view",
            serverHash: "excalidraw-hash",
            result,
          },
          message: {
            id: "activity-tool-failure",
            role: "assistant",
            content: "",
            activityType: MCPAppsActivityType,
          },
          agent,
        },
      });

      await flushAsync();
      await flushAsync();
      return wrapper;
    }

    it("shows the failure message when the tool result has isError: true", async () => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const wrapper = await mountWithResult({
        content: [{ type: "text", text: RECORDED_ERROR_TEXT }],
        isError: true,
      });

      const notice = wrapper.find(TOOL_ERROR_TESTID);
      expect(notice.exists()).toBe(true);
      expect(notice.attributes("role")).toBe("alert");
      expect(notice.text()).toContain(RECORDED_ERROR_TEXT);
      expect(consoleError).toHaveBeenCalledWith(
        "[MCPAppsRenderer] Tool call failed:",
        RECORDED_ERROR_TEXT,
      );
    });

    it("falls back to a generic message when the failed result carries no text", async () => {
      const wrapper = await mountWithResult({ content: [], isError: true });

      expect(wrapper.find(TOOL_ERROR_TESTID).text()).toContain(
        "returned no message",
      );
    });

    it("shows nothing for a successful tool result", async () => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const wrapper = await mountWithResult({
        content: [{ type: "text", text: "Diagram displayed!" }],
        structuredContent: { checkpointId: "71a8a6d624df4e5281" },
        isError: false,
      });

      // The app iframe must still be created — the happy path is untouched.
      expect(wrapper.find("iframe").exists()).toBe(true);
      expect(wrapper.find(TOOL_ERROR_TESTID).exists()).toBe(false);
      expect(consoleError).not.toHaveBeenCalled();
    });

    it("joins only the text blocks of a mixed-content failure", () => {
      expect(
        ɵmcpToolResultText({
          content: [
            { type: "text", text: "first line" },
            { type: "image", data: "…", mimeType: "image/png" },
            { type: "text", text: "second line" },
          ],
          isError: true,
        }),
      ).toBe("first line\nsecond line");

      expect(ɵmcpToolResultText({ isError: true })).toBe("");
    });
  });
});
