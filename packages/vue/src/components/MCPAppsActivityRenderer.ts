import {
  computed,
  defineComponent,
  h,
  onBeforeUnmount,
  ref,
  shallowRef,
  watch,
} from "vue";
import type { PropType } from "vue";
import type { AbstractAgent } from "@ag-ui/client";
import type { VueActivityMessageRendererProps } from "../types";
import { useCopilotKit } from "../providers/useCopilotKit";

// The app<->host protocol (ext-apps AppBridge, sandbox proxy, request queue,
// ui/message + open-link handlers, tool input/result) lives in the shared,
// framework-agnostic package. This file is now a THIN Vue adapter over it: it
// owns the iframe (create/mount/size/remove) and wires the session's reactive
// hooks to Vue refs; all protocol logic is `bindMcpApp`.
//
// The lightweight activity surface (type + content schema + follow-up runner)
// is re-exported from the package's bridge-free `/activity` entry, so importing
// it (for the activity registry) does NOT pull the ext-apps bundle. The bridge
// itself is loaded lazily via a dynamic `import("@copilotkit/mcp-apps-renderer")`
// inside the watcher, so a `<CopilotKitProvider>` app only pays for it when it
// actually renders an MCP App.
export {
  MCPAppsActivityType,
  MCPAppsActivityContentSchema,
  ɵrunMcpFollowUp,
} from "@copilotkit/mcp-apps-renderer/activity";
export type {
  MCPAppsActivityContent,
  ɵMcpFollowUpHost,
} from "@copilotkit/mcp-apps-renderer/activity";

import type { MCPAppsActivityContent } from "@copilotkit/mcp-apps-renderer/activity";
import { ɵMcpAppHost } from "@copilotkit/mcp-apps-renderer/activity";
import type { ɵMcpAppHostState } from "@copilotkit/mcp-apps-renderer/activity";

/**
 * MCP Apps Extension Activity Renderer
 *
 * Renders MCP Apps UI in a sandboxed iframe with full protocol support.
 * Fetches resource content on-demand via proxied MCP requests. The Vue shell
 * owns the iframe; `bindMcpApp` owns the protocol.
 */
export const MCPAppsActivityRenderer = defineComponent({
  name: "MCPAppsActivityRenderer",
  props: {
    activityType: {
      type: String,
      required: true,
    },
    content: {
      type: Object as PropType<MCPAppsActivityContent>,
      required: true,
    },
    message: {
      type: Object as PropType<
        VueActivityMessageRendererProps<MCPAppsActivityContent>["message"]
      >,
      required: true,
    },
    agent: {
      type: Object as PropType<AbstractAgent | undefined>,
      required: false,
      default: undefined,
    },
    /**
     * Restore `allow-same-origin` on the sandbox. Unsafe: the widget runs with
     * the host page's origin. Set via `mcpApps.allowSameOriginFallback` on
     * `CopilotKitProvider`.
     */
    allowSameOriginFallback: {
      type: Boolean,
      required: false,
      default: false,
    },
  },
  setup(props) {
    const { copilotkit } = useCopilotKit();
    const containerRef = ref<HTMLDivElement | null>(null);
    // The shared host owns the iframe, its size and its state, and binds the
    // protocol session (loaded lazily); this component only draws the state.
    const app = shallowRef<ɵMcpAppHost | null>(null);
    // Set by the immediate watcher below, before the first render.
    const state = shallowRef<ɵMcpAppHostState>({
      loading: true,
      error: null,
      contentError: null,
      size: {},
      prefersBorder: false,
    });
    let unsubscribe: () => void = () => undefined;

    // A new host or sandbox setting needs a new host object.
    watch(
      [() => copilotkit.value, () => props.allowSameOriginFallback],
      ([core, allowSameOriginFallback]) => {
        unsubscribe();
        app.value?.destroy();
        const created = new ɵMcpAppHost({
          host: core,
          sessionOptions: { allowSameOriginFallback },
          importRenderer: () => import("@copilotkit/mcp-apps-renderer"),
        });
        unsubscribe = created.subscribe(() => {
          state.value = created.getState();
        });
        state.value = created.getState();
        app.value = created;
      },
      { immediate: true },
    );
    // `flush: "post"` so the container element is mounted when this runs.
    watch(
      [
        app,
        () => props.agent,
        () => props.message?.id,
        () => props.content,
        containerRef,
      ],
      ([host, agent, messageId, content, container]) => {
        if (!host) return;
        host.setAgent(agent);
        host.setMessageId(messageId);
        host.setContent(content);
        host.setContainer(container);
      },
      { immediate: true, flush: "post" },
    );
    onBeforeUnmount(() => {
      unsubscribe();
      app.value?.destroy();
    });

    // prefersBorder: true = border and background; otherwise none.
    const borderStyle = computed(() =>
      state.value.prefersBorder
        ? {
            borderRadius: "8px",
            backgroundColor: "#f9f9f9",
            border: "1px solid #e0e0e0",
          }
        : {},
    );

    return () => {
      const { loading, error, contentError, size } = state.value;
      const shownError = error ?? contentError;
      return h(
        "div",
        {
          ref: containerRef,
          style: {
            width: "100%",
            height: size.height !== undefined ? `${size.height}px` : "auto",
            minHeight: "100px",
            overflow: "hidden",
            position: "relative",
            ...borderStyle.value,
          },
        },
        [
          loading
            ? h(
                "div",
                { style: { padding: "1rem", color: "#666" } },
                "Loading...",
              )
            : null,
          shownError
            ? h(
                "div",
                { style: { color: "red", padding: "1rem" } },
                `Error: ${shownError}`,
              )
            : null,
        ],
      );
    };
  },
});

export default MCPAppsActivityRenderer;
