import {
  AppBridge,
  LATEST_PROTOCOL_VERSION,
  PostMessageTransport,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import type { AbstractAgent } from "@ag-ui/client";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { randomUUID } from "@copilotkit/shared";
import { buildSandboxHTML } from "./sandbox";
import {
  mcpAppsRequestQueue,
  MCP_APPS_QUEUE_IDLE_TIMEOUT_MS,
  MCPAppsQueueThreadChangedError,
} from "./request-queue";
import { ɵrunMcpFollowUp } from "./follow-up";
import type { ɵMcpFollowUpHost } from "./follow-up";
import {
  MCP_OPEN_LINK_BLOCKED_SCHEMES,
  MCPAppsActivityType,
} from "./constants";
import { MCPAppsActivityContentSchema } from "./content-schema";
import type { MCPAppsActivityContent } from "./content-schema";

/** Structural shape of an ag-ui activity message (avoids a hard type import). */
interface ActivityLike {
  id?: string;
  activityType?: string;
  content?: unknown;
}

/** JSON key for dedup; falls back to empty string on a cyclic/unserializable value. */
function keyOf(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

/**
 * Decode a base64 resource body as UTF-8.
 *
 * @internal exported for testing.
 *
 * `atob` alone yields a latin1 string, which mangles non-ASCII widget HTML
 * (`<p>Été ☀️</p>` decoded to `<p>Ã‰tÃ© â˜€ï¸</p>`). Decode to bytes first, then
 * run them through a UTF-8 TextDecoder.
 */
export function ɵdecodeBase64(value: string): string {
  try {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    );
    return new TextDecoder().decode(bytes);
  } catch {
    throw new Error("The MCP App resource contains invalid base64 content.");
  }
}

/**
 * Pick the resource this session asked for.
 *
 * A `resources/read` response may carry several contents; taking the first one
 * can hand the widget a different resource than the one it is bound to. Match on
 * the requested URI, and fall back to a lone content only when the server
 * returned exactly one (some servers normalize the URI they echo back).
 */
function selectResource(
  contents: FetchedResource[] | undefined,
  resourceUri: string,
  requireExact = false,
): FetchedResource | undefined {
  const match = contents?.find((candidate) => candidate.uri === resourceUri);
  if (match) return match;
  return !requireExact && contents?.length === 1 ? contents[0] : undefined;
}

/**
 * Stable key for the widget resource a session is bound to. A session fetches
 * and renders exactly ONE resource. If the store activity for this messageId is
 * later replaced by a different resource (resourceUri/serverHash/serverId), the
 * store subscription must NOT push the new widget's tool input/result into this
 * (old) iframe - the adapter re-binds a fresh session for the new identity.
 */
function identityKeyOf(content: {
  resourceUri?: string;
  serverHash?: string;
  serverId?: string;
}): string {
  return [content.resourceUri, content.serverHash, content.serverId]
    .map((v) => v ?? "")
    .join("::");
}

/**
 * The MCP Apps protocol version this host negotiates. Sourced directly from the
 * ext-apps bridge (single source of truth, no hand-maintained literal). It lives
 * here (a bridge-side module) rather than in the bridge-free `./constants` /
 * `./activity` entry so the lightweight activity-registration surface stays free
 * of the ext-apps bundle; consumers that need the version import it from the
 * package root, which already loads the bridge.
 */
export const MCP_APPS_PROTOCOL_VERSION = LATEST_PROTOCOL_VERSION;

/**
 * Permissive `ui/message` schema. ext-apps restricts the request to
 * `role: "user"` with no `followUp`, but CopilotKit intentionally extends
 * `ui/message` with `role` ("user" | "assistant") and `followUp` (documented
 * behavior with dedicated tests). We register our own handler (instead of the
 * bridge's strict `onmessage`) so those extensions survive.
 *
 * Going forward, widgets SHOULD pass the extensions under
 * `params._meta.copilotkit`; the top-level `role`/`followUp` fields are the
 * legacy channel, kept for backward compatibility and slated for deprecation.
 */
const CopilotKitUiMessageSchema = z.object({
  method: z.literal("ui/message"),
  params: z
    .object({
      role: z.string().optional(),
      content: z.array(z.any()).optional(),
      followUp: z.boolean().optional(),
      _meta: z.record(z.string(), z.any()).optional(),
    })
    .passthrough(),
});

/** A resource fetched from the MCP server via the agent proxy. */
export interface FetchedResource {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
  _meta?: {
    ui?: {
      prefersBorder?: boolean;
      csp?: {
        connectDomains?: string[];
        resourceDomains?: string[];
      };
    };
  };
}

/** Reactive callbacks the framework adapter wires to its own state. */
export interface McpAppSessionHooks {
  /** The widget reported a new content size (ui/notifications/size-changed). */
  onSizeChanged?(size: { width?: number; height?: number }): void;
  /** The widget finished initializing (safe to push tool input/result). */
  onInitialized?(): void;
  /** The sandbox proxy is ready and its resource has been sent. */
  onSandboxReady?(): void;
  /** The fetched resource metadata (e.g. prefersBorder) is available. */
  onResource?(resource: FetchedResource): void;
  /**
   * FATAL setup failure (resource fetch, bridge connect, sandbox timeout).
   * The session cannot serve this widget; the host keeps showing the error
   * until it re-binds.
   */
  onError?(err: Error): void;
  /** A queued ui/message follow-up failed. */
  onFollowUpError?(err: Error): void;
  /**
   * RECOVERABLE content problem: an activity update was rejected by the content
   * schema and therefore not forwarded to the widget. Reported the same way
   * whether the content came from the agent's store or from an adapter prop.
   *
   * Called with the `Error` when content is rejected, and with `null` as soon as
   * valid content arrives again - the widget resumes, so the host must clear the
   * message rather than leave a stale error on screen.
   */
  onContentError?(err: Error | null): void;
}

export interface BindMcpAppOptions {
  /**
   * The sandbox iframe. The adapter creates and OWNS this element (mounts it in
   * its render model, sizes it, removes it on unmount). The session only
   * configures the sandbox contract (sandbox attr, testid, srcdoc) and talks to
   * it through the bridge - it never creates, moves, or removes the iframe.
   */
  iframe: HTMLIFrameElement;
  /** Returns the current activity content (resourceUri, serverHash, tool input/result). */
  getContent: () => MCPAppsActivityContent;
  /** Returns the current agent (may change across renders). */
  getAgent: () => AbstractAgent | undefined;
  /** CopilotKit host, for ui/message follow-up runs (issue #5819). */
  host: ɵMcpFollowUpHost;
  /**
   * The id of the activity message this session renders. When provided, the
   * session subscribes to the agent's message store, finds this activity, and
   * pushes its tool input/result to the widget itself (self-driving), so the
   * adapter does not re-implement the agent-driven forwarding loop.
   *
   * The store is authoritative only for activities that live in it. When a host
   * renders an activity from an EXTERNAL message list (e.g. CopilotChatView's
   * `messages` prop), that activity is not in `agent.messages`; the adapter must
   * then call `syncContent` on content change so the widget still receives its
   * tool input/result. Both paths share one dedup, so they never double-send.
   */
  messageId?: string;
  hooks?: McpAppSessionHooks;
  /**
   * Host identity, capabilities and UI context announced during the MCP Apps
   * initialization handshake, plus the two timeouts. Every field is optional and
   * merged over {@link MCP_APPS_SESSION_DEFAULTS}, so a frontend only overrides
   * what it exposes to its users.
   */
  options?: McpAppSessionOptions;
  /**
   * Decides whether `ui/open-link` may open a URL, and with what final value.
   *
   * Defaults to {@link denyDangerousSchemes}, the single policy every CopilotKit
   * frontend uses - no adapter overrides it, so a widget behaves the same in
   * React, Vue and Angular. This hook exists for a host with a genuinely
   * different security contract; prefer changing the shared policy over setting
   * it, otherwise widget behaviour becomes framework-dependent again.
   */
  openLinkPolicy?: McpAppOpenLinkPolicy;
  /**
   * Whether `teardown` also cancels a queued `ui/message` follow-up run.
   *
   * Defaults to `false`: the follow-up carries the user's message onwards, so it
   * outlives the widget that sent it. Hosts that scope follow-ups to the widget
   * (the Angular contract) can opt in.
   */
  cancelFollowUpsOnTeardown?: boolean;
  /** Require the fetched resource URI to match exactly (Angular compatibility). */
  requireExactResourceUri?: boolean;
  /** Release already-started proxy/follow-up waits on teardown, without aborting the underlying run. */
  cancelRunningWaitOnTeardown?: boolean;
}

/** Host identity announced during the initialization handshake. */
export interface McpAppHostInfo {
  name: string;
  version: string;
}

export interface McpAppSessionOptions {
  /** Maximum time a queued request waits for a busy agent. Default 30s. */
  idleTimeoutMs?: number;
  /**
   * Maximum time to wait for the sandbox proxy handshake
   * (`ui/notifications/sandbox-proxy-ready`). Default 30s.
   *
   * This measures the SANDBOX step, not `ui/notifications/initialized`: a widget
   * that loads its proxy but never reports initialized is a different failure.
   */
  initializationTimeoutMs?: number;
  /** Host identity announced during the initialization handshake. */
  hostInfo?: McpAppHostInfo;
  /** Protocol capabilities announced to embedded MCP Apps. */
  hostCapabilities?: Record<string, unknown>;
  /** Non-secret UI context announced to embedded MCP Apps. */
  hostContext?: Record<string, unknown>;
}

/** Defaults every frontend inherits unless it overrides them. */
export const MCP_APPS_SESSION_DEFAULTS: Readonly<
  Required<McpAppSessionOptions>
> = {
  idleTimeoutMs: MCP_APPS_QUEUE_IDLE_TIMEOUT_MS,
  initializationTimeoutMs: 30_000,
  hostInfo: { name: "CopilotKit MCP Apps Host", version: "1.0.0" },
  hostCapabilities: { openLinks: {}, logging: {}, message: { text: {} } },
  hostContext: { theme: "light", platform: "web" },
};

/**
 * Returns the URL to open, or `undefined` to refuse. Receiving the raw string
 * (not a parsed URL) lets a policy resolve relative links itself.
 */
export type McpAppOpenLinkPolicy = (url: string) => string | undefined;

/**
 * The MCP Apps link policy, shared by every frontend.
 *
 * Three independent rules, deliberately kept as ONE policy so a widget behaves
 * the same whichever framework hosts it:
 *
 * 1. **Scheme denylist**, not an allowlist. Only the schemes that execute script
 *    or render attacker-controlled HTML are refused (`javascript:`, `data:`,
 *    `vbscript:`, `blob:`, `file:`). Everything else is allowed, including
 *    app-defined deep links (`myapp:`, `whatsapp:`), which hand off to an OS
 *    handler rather than executing in the page. An allowlist could never
 *    enumerate those, and restricting to http/https would break them.
 * 2. **Embedded credentials refused** (`https://user:pw@host`): a widget must not
 *    hand the browser a URL carrying someone's credentials.
 * 3. **Path-relative links resolved** against the host document, so `/docs`,
 *    `./x` and `../x` open instead of failing URL parsing. Only those three
 *    forms: every string is technically a valid relative reference, so anything
 *    else stays refused rather than becoming a navigation on the host origin.
 *    This does mean a widget can reach a path of the HOST application - the same
 *    reach a normal anchor in the page would have.
 *
 * Rules 2 and 3 come from the Angular host, which enforced them before it moved
 * onto this session; rule 1 is the CopilotKit product decision (it matches the
 * Anthropic Software Directory policy: https origins plus owned custom URI
 * schemes). Merging them means no frontend overrides anything.
 */
export const denyDangerousSchemes: McpAppOpenLinkPolicy = (url) => {
  let parsed: URL;
  let absolute = true;
  try {
    parsed = new URL(url);
  } catch {
    // Not absolute. Resolve only what is unambiguously a path reference: per the
    // URL spec ANY string is a valid relative reference, so resolving blindly
    // would turn "not a url" into a navigation on the host origin.
    if (!/^(\/|\.\/|\.\.\/)/.test(url)) return undefined;
    absolute = false;
    try {
      parsed = new URL(url, window.location.href);
    } catch {
      return undefined;
    }
  }
  if (MCP_OPEN_LINK_BLOCKED_SCHEMES.has(parsed.protocol)) return undefined;
  if (parsed.username || parsed.password) return undefined;
  // An absolute URL is handed back exactly as the widget wrote it: `href`
  // normalisation would rewrite it (adding a trailing slash, reserialising a
  // custom-scheme deep link). Only a relative link needs the resolved form,
  // since the raw string is not openable on its own.
  return absolute ? url : parsed.href;
};

export interface McpAppSession {
  /** Forward the tool call input to the widget (host -> app). Buffered until ready. */
  sendToolInput(args: Record<string, unknown>): void;
  /** Forward the tool result to the widget (host -> app). Buffered until ready. */
  sendToolResult(result: CallToolResult): void;
  /**
   * Forward the tool input/result carried by `content` to the widget, deduped so
   * an unchanged value is not re-sent. The prop-driven counterpart to the agent
   * subscription: the adapter calls this on content change so activities rendered
   * from an external message list (absent from `agent.messages`) still reach the
   * widget. No-op for values already sent (shared dedup with the subscription).
   *
   * Content is validated here exactly as it is on the store path: a rejected
   * value is not forwarded and surfaces through `onContentError`.
   */
  syncContent(content: MCPAppsActivityContent): void;
  /** Disconnect the bridge and release listeners. Does NOT remove the iframe. */
  teardown(): void;
}

/**
 * Bind an MCP App to a host-provided sandbox iframe: fetch the widget resource
 * through the agent, connect the ext-apps `AppBridge` over a PostMessage
 * transport, and wire the app<->host protocol (ui/message, ui/open-link,
 * tools/call + resources/read proxy, size, host context). Framework-agnostic:
 * the React/Vue/Angular renderers create the iframe and wire reactive state via
 * `hooks`, but all protocol logic lives here.
 */
export function bindMcpApp(opts: BindMcpAppOptions): McpAppSession {
  const {
    iframe,
    getContent,
    getAgent,
    host,
    messageId,
    hooks,
    options,
    openLinkPolicy = denyDangerousSchemes,
    cancelFollowUpsOnTeardown = false,
  } = opts;
  // Frontend-supplied options merged over the shared defaults, so a host only
  // overrides what it actually exposes (Angular's provideMCPApps merge, lifted).
  const settings = { ...MCP_APPS_SESSION_DEFAULTS, ...options };

  // The widget resource identity this session is bound to, captured once at bind
  // time. The store subscription refuses to forward content for any other
  // identity (see `pushFromContent`).
  const boundIdentity = identityKeyOf(getContent());

  // Ownership token for this session's queued work. Widget-scoped requests
  // (resources/read, tools/call) exist only to feed THIS iframe, so `teardown`
  // cancels the ones still waiting.
  //
  // The `ui/message` follow-up run is owned only when the host asks for it via
  // `cancelFollowUpsOnTeardown` (the Angular contract). Left unowned - the
  // default, used by React and Vue - it survives the widget, because it carries
  // the user's message onwards rather than feeding the iframe.
  const queueOwner = {};

  let disposed = false;
  let ready = false;
  let bridge: AppBridge | null = null;
  let pendingToolInput: Record<string, unknown> | undefined;
  let pendingToolResult: CallToolResult | undefined;
  // Self-driving mode (messageId set): dedup keys so a re-emitted activity with
  // unchanged tool input/result does not re-notify the widget, and the agent
  // subscription handle so teardown can unsubscribe.
  let lastToolInputKey: string | undefined;
  let lastToolResultKey: string | undefined;
  // Last content that failed validation, so the same rejection is not reported
  // again on every subsequent update. Shared by both sources: the widget has a
  // single error state, whether the content came from the store or from a prop.
  let lastInvalidContentKey: string | undefined;
  let activitySub: { unsubscribe(): void } | null = null;
  // Sandbox handshake watchdog (see initializationTimeoutMs).
  let sandboxTimer: ReturnType<typeof setTimeout> | undefined;
  let sandboxReady = false;
  let sandboxTimedOut = false;

  /** Flush any buffered tool input/result to the widget once it is initialized. */
  const flushPending = () => {
    if (!ready || !bridge) return;
    if (pendingToolInput !== undefined) {
      void bridge.sendToolInput({ arguments: pendingToolInput });
      pendingToolInput = undefined;
    }
    if (pendingToolResult !== undefined) {
      void bridge.sendToolResult(pendingToolResult);
      pendingToolResult = undefined;
    }
  };

  /**
   * Report content the schema rejected. RECOVERABLE: the session keeps running
   * and resumes as soon as valid content arrives, so this never goes through the
   * fatal `onError` channel. Deduped on the offending value, since store updates
   * fire for every message change, not just this activity's.
   */
  const reportContentRejected = (
    value: unknown,
    error: { message: string },
  ) => {
    const key = keyOf(value);
    if (key === lastInvalidContentKey) return;
    lastInvalidContentKey = key;
    hooks?.onContentError?.(
      new Error(
        `[MCPAppsRenderer] Activity content for message "${messageId ?? "(no id)"}" does not match the MCP Apps content schema, so it was not forwarded to the widget: ${error.message}`,
      ),
    );
  };

  /** Valid content resumed: clear the message the host shows for a rejection. */
  const clearContentRejection = () => {
    if (lastInvalidContentKey === undefined) return;
    lastInvalidContentKey = undefined;
    hooks?.onContentError?.(null);
  };

  /**
   * Push tool input/result from an activity content to the widget, deduped so an
   * unchanged value (e.g. a re-emitted snapshot) is not re-sent. Buffered by the
   * imperative sender until the widget is initialized.
   *
   * The single forwarding path for BOTH sources - the store subscription
   * (`pushFromMessages`) and the adapter props (`syncContent`) - so validation,
   * the identity guard and recoverable-error reporting behave identically
   * whichever one produced the content.
   */
  const pushFromContent = (content: MCPAppsActivityContent) => {
    // Identity guard: only forward tool input/result for the resource this
    // session is bound to. If the store activity for this messageId has been
    // replaced by a different widget (resourceUri/serverHash/serverId), pushing
    // here would leak the new widget's data into this (old, still-mounted) iframe
    // before the adapter tears the session down and re-binds for the new
    // identity. Refuse it; the fresh session will forward the new widget's data.
    if (identityKeyOf(content) !== boundIdentity) return;
    const { toolInput, result } = content;

    // Validate BEFORE forwarding anything. `toolInput` and `result` describe one
    // exchange: sending the input and only then discovering the result is
    // invalid would leave the widget with a half-applied update. A rejection is
    // RECOVERABLE (reported through onContentError, cleared when valid content
    // returns), not a fatal session error - and it is reported identically
    // whether the content came from the store or from an adapter prop.
    let validResult: CallToolResult | undefined;
    if (result !== undefined) {
      const parsed =
        MCPAppsActivityContentSchema.shape.result.safeParse(result);
      if (!parsed.success) {
        reportContentRejected(result, parsed.error);
        return;
      }
      validResult = parsed.data as CallToolResult;
    }
    clearContentRejection();

    if (toolInput !== undefined) {
      const key = keyOf(toolInput);
      if (key !== lastToolInputKey) {
        lastToolInputKey = key;
        pendingToolInput = toolInput as Record<string, unknown>;
        flushPending();
      }
    }
    if (validResult !== undefined) {
      const key = keyOf(validResult);
      if (key !== lastToolResultKey) {
        lastToolResultKey = key;
        pendingToolResult = validResult;
        flushPending();
      }
    }
  };

  /**
   * Push the CURRENT content of this activity (read from the agent's message
   * store, the authoritative post-apply source) to the widget. Used both at
   * initialize and on every `onMessagesChanged`, so the widget always reflects
   * the applied state - never a stale React prop or a pre-apply activity message.
   * Store path only (requires `messageId`); the props path goes through
   * `syncContent`. `messages` overrides the store lookup when provided.
   */
  const pushFromMessages = (messages?: readonly ActivityLike[]) => {
    if (disposed || !messageId) return;
    const list = (messages ??
      (getAgent()?.messages as readonly ActivityLike[] | undefined)) as
      | readonly ActivityLike[]
      | undefined;
    const msg = list?.find((m) => m?.id === messageId);
    if (!msg || msg.activityType !== MCPAppsActivityType) return;
    const parsed = MCPAppsActivityContentSchema.safeParse(msg.content);
    if (!parsed.success) {
      // Rejected content is NOT forwarded, but the failure must be observable
      // rather than a silent no-op: otherwise the widget simply never receives
      // its result and nothing says why.
      reportContentRejected(msg.content, parsed.error);
      return;
    }
    // pushFromContent clears the rejection once it has validated the result.
    pushFromContent(parsed.data);
  };

  /** True when this activity currently lives in the agent's message store. */
  const activityInStore = (): boolean =>
    !!(getAgent()?.messages as readonly ActivityLike[] | undefined)?.some(
      (m) => m?.id === messageId && m?.activityType === MCPAppsActivityType,
    );

  /** Fetch the widget resource (`resources/read`) through the agent proxy queue. */
  const fetchResource = async (): Promise<FetchedResource> => {
    const agent = getAgent();
    if (!agent) {
      throw new Error("No agent available to fetch resource");
    }
    const { resourceUri, serverHash, serverId } = getContent();
    const runResult = await mcpAppsRequestQueue.enqueue(
      agent,
      () =>
        agent.runAgent({
          forwardedProps: {
            __proxiedMCPRequest: {
              serverHash,
              serverId,
              method: "resources/read",
              params: { uri: resourceUri },
            },
          },
        }),
      {
        owner: queueOwner,
        timeoutMs: settings.idleTimeoutMs,
        cancelRunningWait: opts.cancelRunningWaitOnTeardown,
        // The widget belongs to the thread it was rendered in: running its fetch
        // against a thread the host switched to would load it into the wrong
        // conversation.
        dropAfterThreadSwitch: true,
      },
    );
    const resultData = runResult.result as
      | { contents?: FetchedResource[] }
      | undefined;
    const resource = selectResource(
      resultData?.contents,
      resourceUri,
      opts.requireExactResourceUri,
    );
    if (!resource) {
      throw new Error("No resource content in response");
    }
    return resource;
  };

  /**
   * Terminal shutdown, owned by the session itself.
   *
   * Used by `teardown()` AND by the sandbox watchdog: once the handshake window
   * closes, the session must stop serving this widget rather than leave the
   * bridge and its handlers live until the adapter happens to unmount. It does
   * NOT remove the iframe - the adapter owns that element.
   *
   * Idempotent.
   */
  const closeSession = () => {
    if (disposed) return;
    disposed = true;
    if (sandboxTimer !== undefined) {
      clearTimeout(sandboxTimer);
      sandboxTimer = undefined;
    }
    // Drop this widget's still-waiting proxy requests: they only exist to feed
    // an iframe that is going away. Requests already in flight keep running
    // (runAgent has no abort), and other widgets' queued work is untouched.
    mcpAppsRequestQueue.cancelOwner(queueOwner);
    activitySub?.unsubscribe();
    activitySub = null;
    const b = bridge;
    bridge = null;
    void b?.close();
  };

  /**
   * Fetch the resource, configure + load the sandbox iframe, construct the
   * AppBridge, wire the app->host handlers, and connect the transport.
   */
  const setup = async () => {
    try {
      const resource = await fetchResource();
      if (disposed) return;
      hooks?.onResource?.(resource);

      // Configure the sandbox iframe (contract shared across frontends).
      iframe.setAttribute(
        "sandbox",
        "allow-scripts allow-same-origin allow-forms",
      );
      // Cross-frontend MCP-apps surface contract: every frontend must expose the
      // sandbox iframe under the SAME testid so one shared probe (harness
      // `d5-mcp-apps`) and one shared e2e spec can assert the surface mounted
      // without per-frontend selectors.
      iframe.setAttribute("data-testid", "mcp-app-iframe");
      iframe.setAttribute("title", "Interactive MCP application");

      const cspDomains = resource._meta?.ui?.csp?.resourceDomains;
      iframe.srcdoc = buildSandboxHTML(cspDomains);

      const win = iframe.contentWindow;
      if (!win) {
        throw new Error("Sandbox iframe has no contentWindow");
      }

      let html: string;
      if (resource.text) {
        html = resource.text;
      } else if (resource.blob) {
        html = ɵdecodeBase64(resource.blob);
      } else {
        throw new Error("Resource has no text or blob content");
      }

      bridge = new AppBridge(
        null,
        settings.hostInfo,
        settings.hostCapabilities,
        // Seed the host context at construction so it is already in place when
        // the widget's ui/initialize is handled (deterministic, not a race).
        { hostContext: settings.hostContext },
      );

      // Sandbox handshake: on proxy ready, load the widget HTML into the inner
      // sandboxed iframe.
      // The sandbox proxy must report back within initializationTimeoutMs. This
      // measures the SANDBOX handshake (sandbox-proxy-ready), not the widget's
      // later `initialized` notification - a widget that loads but never reports
      // initialized is a different failure and is not covered here.
      sandboxTimer = setTimeout(() => {
        if (disposed || sandboxReady) return;
        // Mark the handshake window closed: a proxy that reports ready after the
        // deadline must not silently resurrect a session the host already
        // surfaced as failed.
        sandboxTimedOut = true;
        // Report first (closeSession sets `disposed`, which gates the hooks),
        // then terminate: the widget never handshaked, so keeping the bridge and
        // its handlers alive would let a late iframe still proxy runs through us.
        hooks?.onError?.(
          new Error(
            `[MCPAppsRenderer] Timed out after ${settings.initializationTimeoutMs}ms waiting for the MCP App sandbox to initialize.`,
          ),
        );
        closeSession();
      }, settings.initializationTimeoutMs);

      bridge.onsandboxready = () => {
        if (sandboxTimedOut) {
          console.warn(
            "[MCPAppsRenderer] Ignoring a sandbox handshake that arrived after the initialization timeout.",
          );
          return;
        }
        sandboxReady = true;
        if (sandboxTimer !== undefined) {
          clearTimeout(sandboxTimer);
          sandboxTimer = undefined;
        }
        void bridge?.sendSandboxResourceReady({ html }).then(() => {
          if (!disposed) hooks?.onSandboxReady?.();
        });
      };

      // --- App -> host requests ---
      // ui/message: custom handler preserving CopilotKit role/followUp extensions
      // (via _meta.copilotkit first, then legacy top-level fields).
      bridge.setRequestHandler(CopilotKitUiMessageSchema, async (req) => {
        const currentAgent = getAgent();
        if (!currentAgent) {
          console.warn("[MCPAppsRenderer] ui/message: No agent available");
          return { isError: false };
        }
        try {
          const params = req.params;
          const ck = (params._meta?.copilotkit ?? {}) as {
            role?: string;
            followUp?: boolean;
          };
          const role =
            (ck.role as "user" | "assistant") ||
            (params.role as "user" | "assistant") ||
            "user";
          const textContent =
            (
              params.content as
                | Array<{ type: string; text?: string }>
                | undefined
            )
              ?.filter((c) => c.type === "text" && c.text)
              .map((c) => c.text)
              .join("\n") || "";
          if (textContent) {
            currentAgent.addMessage({
              id: randomUUID(),
              role,
              content: textContent,
            });
          }
          const followUp = ck.followUp ?? params.followUp;
          const shouldFollowUp = followUp ?? role === "user";
          if (shouldFollowUp && textContent) {
            const capturedThreadId = currentAgent.threadId || "default";
            mcpAppsRequestQueue
              .enqueue(
                currentAgent,
                () =>
                  ɵrunMcpFollowUp({
                    host,
                    agent: currentAgent,
                    capturedThreadId,
                  }),
                {
                  // Honour the configured wait like the other proxied requests.
                  // Ownership is deliberate policy, see cancelFollowUpsOnTeardown.
                  timeoutMs: settings.idleTimeoutMs,
                  owner: cancelFollowUpsOnTeardown ? queueOwner : undefined,
                  cancelRunningWait: opts.cancelRunningWaitOnTeardown,
                },
              )
              .catch((err) => {
                if (disposed && cancelFollowUpsOnTeardown) return;
                console.error(
                  "[MCPAppsRenderer] ui/message agent run failed:",
                  err,
                );
                hooks?.onFollowUpError?.(
                  err instanceof Error ? err : new Error(String(err)),
                );
              });
          }
          return { isError: false };
        } catch (err) {
          console.error("[MCPAppsRenderer] ui/message error:", err);
          return { isError: true };
        }
      });

      bridge.onopenlink = async ({ url }) => {
        // The bridge validates `url` as a string but not its scheme. The policy
        // decides (and may rewrite, e.g. resolving a relative link).
        const allowed = openLinkPolicy(url);
        if (!allowed) {
          console.warn(
            "[MCPAppsRenderer] ui/open-link rejected by policy:",
            url,
          );
          return { isError: true };
        }
        window.open(allowed, "_blank", "noopener,noreferrer");
        return { isError: false };
      };

      bridge.oncalltool = async (params) => {
        const { serverHash, serverId } = getContent();
        const currentAgent = getAgent();
        if (!serverHash) {
          throw new Error("No server hash available for proxying");
        }
        if (!currentAgent) {
          throw new Error("No agent available for proxying");
        }
        let runResult;
        try {
          runResult = await mcpAppsRequestQueue.enqueue(
            currentAgent,
            () =>
              currentAgent.runAgent({
                forwardedProps: {
                  __proxiedMCPRequest: {
                    serverHash,
                    serverId,
                    method: "tools/call",
                    params,
                  },
                },
              }),
            {
              owner: queueOwner,
              timeoutMs: settings.idleTimeoutMs,
              cancelRunningWait: opts.cancelRunningWaitOnTeardown,
              dropAfterThreadSwitch: true,
            },
          );
        } catch (err) {
          // A call dropped by the thread guard must come back to the widget as
          // an explicit JSON-RPC error. Swallowing it would leave the caller
          // waiting for a response that can never arrive.
          if (err instanceof MCPAppsQueueThreadChangedError) {
            throw new Error(
              `tools/call was not executed: ${err.message} Retry from the current thread.`,
              { cause: err },
            );
          }
          throw err;
        }
        return MCPAppsActivityContentSchema.shape.result.parse(
          runResult.result ?? {},
        );
      };

      // --- App -> host notifications ---
      bridge.onsizechange = (p) => {
        if (disposed) return;
        const { width, height } = (p || {}) as {
          width?: number;
          height?: number;
        };
        hooks?.onSizeChanged?.({
          width: typeof width === "number" ? width : undefined,
          height: typeof height === "number" ? height : undefined,
        });
      };
      bridge.oninitialized = () => {
        if (disposed) return;
        ready = true;
        hooks?.onInitialized?.();
        // Self-driving: reconcile the buffers BEFORE the first flush. When this
        // activity lives in the store, the store is authoritative, so discard any
        // prop-seeded buffers - e.g. an activity that was absent at bind time and
        // seeded via syncContent, then appeared in the store with the applied
        // content during the resource fetch - and push the CURRENT store content
        // instead. Clearing first means a stale pre-init value is never sent
        // ahead of (or instead of) the applied one; reading from the store - not
        // getContent() - honors an update that arrived before initialize.
        if (messageId && activityInStore()) {
          pendingToolInput = undefined;
          pendingToolResult = undefined;
          lastToolInputKey = undefined;
          lastToolResultKey = undefined;
          pushFromMessages();
        }
        flushPending();
      };
      bridge.onloggingmessage = (p) => {
        console.log("[MCPAppsRenderer] App log:", p);
      };

      const transport = new PostMessageTransport(win, win);
      await bridge.connect(transport);
      if (disposed) {
        await bridge.close();
        bridge = null;
        return;
      }

      // Self-driving: subscribe to the agent and push tool input/result for THIS
      // activity to the widget, so the framework adapter does not forward them.
      //
      // We read from `onMessagesChanged`, NOT `onActivitySnapshotEvent` /
      // `onActivityDeltaEvent`: those fire with the PRE-update `activityMessage`
      // (the snapshot's new content / the delta patch is applied only after the
      // callback returns), so reading them yields stale content and the dedup
      // below can suppress the send entirely. `onMessagesChanged` fires AFTER the
      // store is updated, so `messages` holds the applied content - and it also
      // covers full messages-snapshot updates, which the activity callbacks miss.
      if (messageId) {
        activitySub =
          getAgent()?.subscribe({
            onMessagesChanged: ({ messages }) =>
              pushFromMessages(messages as readonly ActivityLike[]),
          }) ?? null;
      }
    } catch (err) {
      console.error("[MCPAppsRenderer] Setup error:", err);
      if (!disposed) {
        hooks?.onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    }
  };

  void setup();

  return {
    sendToolInput(args) {
      pendingToolInput = args;
      flushPending();
    },
    sendToolResult(result) {
      pendingToolResult =
        MCPAppsActivityContentSchema.shape.result.parse(result);
      flushPending();
    },
    syncContent(content) {
      // Store precedence: when this activity lives in the agent's message store,
      // the subscription is authoritative (it reads the applied post-update
      // content), so ignore the prop to avoid pushing a possibly-stale React
      // prop over it. Forward props only for activities absent from the store
      // (rendered from an external messages list).
      if (messageId && activityInStore()) return;
      pushFromContent(content);
    },
    teardown() {
      closeSession();
    },
  };
}
