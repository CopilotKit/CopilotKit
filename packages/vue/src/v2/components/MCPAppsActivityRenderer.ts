import { computed, defineComponent, h, ref, shallowRef, watch } from "vue";
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
// Type-only imports: erased at build, so they never pull the ext-apps bridge
// into the bundle. Only the dynamic import() below does, and only lazily.
import type {
  McpAppSession,
  FetchedResource,
} from "@copilotkit/mcp-apps-renderer";

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
  },
  setup(props) {
    const { copilotkit } = useCopilotKit();
    const containerRef = ref<HTMLDivElement | null>(null);
    // UI-only state: plain refs are fine (no agent-bound payload crosses here).
    const error = ref<Error | null>(null);
    // Recoverable: an activity update the content schema rejected, from the
    // store or from props. Cleared as soon as valid content resumes, unlike
    // `error`, which is a fatal setup failure.
    const contentError = ref<Error | null>(null);
    const isLoading = ref(true);
    const iframeSize = ref<{ width?: number; height?: number }>({});
    // shallowRef for externally-owned objects: the session, the iframe element
    // and the fetched resource must never be wrapped in a reactive proxy (the
    // resource crosses into the widget, and proxies are not clone-safe).
    const iframeRef = shallowRef<HTMLIFrameElement | null>(null);
    const sessionRef = shallowRef<McpAppSession | null>(null);
    const fetchedResource = shallowRef<FetchedResource | null>(null);

    // The activity message id. Passed to the session so it self-subscribes to
    // the agent's activity stream and pushes tool input/result itself (this
    // adapter does not forward store-backed activities).
    const messageId = computed(() => props.message?.id);

    // Create the sandbox iframe and bind the MCP session. Re-binds only when the
    // widget identity (resourceUri/serverHash/serverId) or the agent/host/message
    // changes - NOT when tool input/result stream in (those are pushed without
    // recreating the iframe). `flush: "post"` so the container element is mounted
    // when the callback runs.
    watch(
      [
        // The container element is a watch source, not just a read: `immediate`
        // runs the callback synchronously at setup, before the template ref is
        // populated. Watching it re-runs the bind once the element mounts.
        containerRef,
        () => props.agent,
        () => copilotkit.value,
        messageId,
        () => props.content.resourceUri,
        () => props.content.serverHash,
        () => props.content.serverId,
      ],
      ([container, agent], _old, onCleanup) => {
        if (!agent) {
          error.value = new Error("No agent available to fetch resource");
          isLoading.value = false;
          return;
        }
        if (!container) {
          return;
        }

        let mounted = true;
        isLoading.value = true;
        error.value = null;
        contentError.value = null;
        iframeSize.value = {};
        fetchedResource.value = null;

        // The host owns the iframe: create + mount it here (bindMcpApp only
        // configures the sandbox contract + talks to it through the bridge).
        const iframe = document.createElement("iframe");
        iframe.style.width = "100%";
        iframe.style.height = "100px";
        iframe.style.border = "none";
        iframe.style.backgroundColor = "transparent";
        iframe.style.display = "block";
        container.appendChild(iframe);
        iframeRef.value = iframe;

        // Register cleanup BEFORE the async import: if this watcher is
        // invalidated (props change / unmount) while the import is in flight,
        // `mounted` is already false when it resolves, so we never bind.
        onCleanup(() => {
          mounted = false;
          sessionRef.value?.teardown();
          sessionRef.value = null;
          iframe.remove();
          if (iframeRef.value === iframe) {
            iframeRef.value = null;
          }
        });

        const setup = async () => {
          try {
            // Load the bridge package lazily. The bridge is heavy (it pulls the
            // MCP SDK Protocol + zod schemas, ~40-50 kB gzipped); keeping it
            // behind a dynamic import() means a non-MCP app never pays for it.
            const mod = await import("@copilotkit/mcp-apps-renderer").catch(
              (importErr) => {
                throw new Error(
                  "MCP Apps require '@copilotkit/mcp-apps-renderer' and its " +
                    "'@modelcontextprotocol/ext-apps' dependency. Reinstall your " +
                    "dependencies if this package is missing.",
                  { cause: importErr },
                );
              },
            );
            if (!mounted) return;

            const session = mod.bindMcpApp({
              iframe,
              getContent: () => props.content,
              getAgent: () => props.agent,
              host: copilotkit.value,
              // Self-driving: the session subscribes to the agent's activity
              // stream (filtered by messageId) and pushes tool input/result to
              // the widget itself, so this adapter does not forward STORE-backed
              // activities. It still calls syncContent for activities rendered
              // from an external messages list (see the seed below).
              messageId: messageId.value,
              hooks: {
                onResource: (resource) => {
                  if (!mounted) return;
                  fetchedResource.value = resource;
                  isLoading.value = false;
                },
                onSizeChanged: (size) => {
                  if (mounted) iframeSize.value = size;
                },
                onContentError: (err) => {
                  if (mounted) contentError.value = err;
                },
                onError: (err) => {
                  if (!mounted) return;
                  error.value = err;
                  isLoading.value = false;
                },
              },
            });
            sessionRef.value = session;
            // Seed the initial content now: the content watcher below does not
            // re-run for unchanged props, so an activity rendered from an
            // EXTERNAL messages list (absent from agent.messages) would never
            // receive its initial tool input/result. Deduped + store precedence
            // make this a no-op for agent-backed activities.
            session.syncContent(props.content);
          } catch (err) {
            console.error("[MCPAppsRenderer] Setup error:", err);
            if (mounted) {
              error.value = err instanceof Error ? err : new Error(String(err));
              isLoading.value = false;
            }
          }
        };

        void setup();
      },
      { immediate: true, flush: "post" },
    );

    // Size the iframe when the widget reports a new content size.
    watch(
      iframeSize,
      (size) => {
        const iframe = iframeRef.value;
        if (!iframe) return;
        if (size.width !== undefined) {
          // Use minWidth with min() to allow expansion but cap at 100%
          iframe.style.minWidth = `min(${size.width}px, 100%)`;
          iframe.style.width = "100%";
        }
        if (size.height !== undefined) {
          iframe.style.height = `${size.height}px`;
        }
      },
      { deep: true },
    );

    // Forward tool input/result from the content prop. The session is
    // self-driving for activities that live in the agent's message store, but a
    // host can render an activity from an EXTERNAL messages list that is absent
    // from `agent.messages`; this keeps such widgets fed. `syncContent` is
    // deduped and shares the subscription's dedup, so the agent-driven path
    // never double-sends.
    watch(
      [() => props.content.toolInput, () => props.content.result],
      () => {
        sessionRef.value?.syncContent(props.content);
      },
      { deep: true },
    );

    // Determine border styling based on prefersBorder metadata from fetched
    // resource: true = show border/background, false = none, undefined = host
    // decides (we default to none).
    const borderStyle = computed(() => {
      const prefersBorder = fetchedResource.value?._meta?.ui?.prefersBorder;
      if (prefersBorder !== true) return {};
      return {
        borderRadius: "8px",
        backgroundColor: "#f9f9f9",
        border: "1px solid #e0e0e0",
      };
    });

    return () =>
      h(
        "div",
        {
          ref: containerRef,
          style: {
            width: "100%",
            height:
              iframeSize.value.height !== undefined
                ? `${iframeSize.value.height}px`
                : "auto",
            minHeight: "100px",
            overflow: "hidden",
            position: "relative",
            ...borderStyle.value,
          },
        },
        [
          isLoading.value
            ? h(
                "div",
                { style: { padding: "1rem", color: "#666" } },
                "Loading...",
              )
            : null,
          error.value || contentError.value
            ? h(
                "div",
                { style: { color: "red", padding: "1rem" } },
                `Error: ${(error.value ?? contentError.value)!.message}`,
              )
            : null,
        ],
      );
  },
});

export default MCPAppsActivityRenderer;
