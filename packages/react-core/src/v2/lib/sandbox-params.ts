"use client";

/**
 * CopilotKit Studio sandbox — URL params + postMessage wire protocol.
 *
 * This module is the **canonical source** for the iframe↔parent contract used
 * by `@copilotkit/studio`. The studio's `<sandbox-frame>` component mirrors
 * these types verbatim (the studio cannot depend on @copilotkit/react-core at
 * type level without creating a cycle through the v1 wraps v2 architecture).
 *
 * Spec: .chalk/plans/web-inspector-v1.md §6.5
 * Execution boundary: .chalk/plans/web-inspector-execution.md §3 (row 3)
 *
 * The query-param protocol:
 *
 *   `<runtimeUrl>/?__cpk_sandbox=<tool_name>&args=<base64-json>`
 *
 * - `__cpk_sandbox` is the sentinel that flips `CopilotKitProvider` into
 *   sandbox-host mode. Without it the provider renders normally.
 * - `args` is a base64-encoded JSON payload. Payloads larger than
 *   {@link SANDBOX_ARGS_URL_LIMIT_BYTES} should be omitted from the URL;
 *   the parent then sends them over postMessage after the iframe's `ready`.
 *
 * The postMessage protocol (after iframe load):
 *
 *   parent → iframe:  `ParentToSandboxMessage`
 *   iframe → parent:  `SandboxToParentMessage`
 *
 * Both directions are best-effort; messages without a matching `kind` are
 * ignored. There is no request/response correlation in v1.
 */

import { useEffect, useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Query-param contract
// ---------------------------------------------------------------------------

/** Sentinel query-param name that triggers sandbox-host mode. */
export const SANDBOX_QUERY_PARAM = "__cpk_sandbox";

/** Query-param name carrying the base64-encoded JSON args payload. */
export const SANDBOX_ARGS_QUERY_PARAM = "args";

/**
 * Soft cap on the size of the base64 args blob in the URL. Browsers vary in
 * their URL-length tolerance; 2KB sits well below every browser's limit and
 * leaves headroom for the rest of the URL. Above this the parent escalates
 * to the postMessage handshake.
 */
export const SANDBOX_ARGS_URL_LIMIT_BYTES = 2048;

/**
 * Parsed result of {@link parseSandboxParams}.
 *
 * - `args` is non-null only when the URL carried a valid base64-encoded JSON
 *   payload. When the URL omits `args` (handshake-driven case) `args` is
 *   `undefined` and the host should reply with `ready: { needsArgs: true }`.
 * - `argsParseError` is set when `args` was present in the URL but failed to
 *   decode or parse. The host surfaces this via `postMessage` so the parent
 *   can render an overlay rather than crashing silently.
 */
export type SandboxParams = {
  toolName: string;
  args: unknown | undefined;
  argsParseError: string | null;
};

// ---------------------------------------------------------------------------
// postMessage wire protocol — iframe ↔ parent
// ---------------------------------------------------------------------------

/**
 * Messages the parent (studio) sends to the iframe (sandbox host).
 *
 * - `host-context` — sent on iframe `ready`. The host can adopt the parent's
 *   theme (dark/light). Future fields are additive.
 * - `args` — sent when the URL omitted `args` (large payload), when the
 *   parent's form state changes, or when an explicit `request-args` was
 *   received.
 */
export type ParentToSandboxMessage =
  | { kind: "host-context"; theme: "dark" | "light" }
  | { kind: "args"; args: unknown };

/**
 * Messages the iframe (sandbox host) sends to the parent (studio).
 *
 * - `ready` — sent once on mount. `needsArgs` is `true` when the URL did not
 *   carry an `args` payload; the parent responds with `{ kind: "args", ... }`.
 * - `render-error` — sent when the sandboxed tool's render function throws.
 *   The parent overlays the message in the iframe area.
 * - `request-args` — rare. Sent when something later in the iframe needs the
 *   args (e.g. user reloaded the iframe with `Cmd+R` and the URL still had
 *   no args). Parent re-sends the latest `{ kind: "args" }` payload.
 */
export type SandboxToParentMessage =
  | { kind: "ready"; needsArgs: boolean }
  | { kind: "render-error"; message: string; stack?: string }
  | { kind: "request-args" };

/**
 * Type guard for {@link SandboxToParentMessage}. Use in window message
 * listeners on the studio side to filter out unrelated postMessage traffic.
 */
export function isSandboxToParentMessage(
  value: unknown,
): value is SandboxToParentMessage {
  if (!value || typeof value !== "object") return false;
  const kind = (value as { kind?: unknown }).kind;
  return kind === "ready" || kind === "render-error" || kind === "request-args";
}

/**
 * Type guard for {@link ParentToSandboxMessage}. Use on the iframe side to
 * filter window messages from other origins / extensions / devtools.
 */
export function isParentToSandboxMessage(
  value: unknown,
): value is ParentToSandboxMessage {
  if (!value || typeof value !== "object") return false;
  const kind = (value as { kind?: unknown }).kind;
  return kind === "host-context" || kind === "args";
}

// ---------------------------------------------------------------------------
// Encoding / decoding helpers
// ---------------------------------------------------------------------------

/**
 * Encode `args` as URL-safe base64 of its JSON form. Returns `null` when the
 * encoded blob would exceed {@link SANDBOX_ARGS_URL_LIMIT_BYTES} — the caller
 * should then escalate to the postMessage handshake.
 */
export function encodeSandboxArgs(args: unknown): string | null {
  let json: string;
  try {
    json = JSON.stringify(args ?? {});
  } catch {
    return null;
  }
  const encoded = base64UrlEncode(json);
  if (encoded.length > SANDBOX_ARGS_URL_LIMIT_BYTES) {
    return null;
  }
  return encoded;
}

/**
 * Decode a URL-encoded base64 JSON blob. Accepts both URL-safe (`-`/`_`) and
 * standard (`+`/`/`) base64 alphabets so a clipboard-copied URL still works.
 *
 * Throws on malformed input; the caller should catch and surface
 * `argsParseError`.
 */
export function decodeSandboxArgs(encoded: string): unknown {
  const json = base64UrlDecode(encoded);
  return JSON.parse(json);
}

/**
 * Parse the sandbox query-params off a URL. Returns `null` when the URL does
 * not contain {@link SANDBOX_QUERY_PARAM} — i.e. normal app render.
 *
 * Tolerates a missing or unparseable `args` blob: `toolName` still resolves
 * and `argsParseError` is set so the host can postMessage the parent.
 */
export function parseSandboxParams(url: string): SandboxParams | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const toolName = parsed.searchParams.get(SANDBOX_QUERY_PARAM);
  if (!toolName) return null;

  const rawArgs = parsed.searchParams.get(SANDBOX_ARGS_QUERY_PARAM);
  if (rawArgs === null) {
    return { toolName, args: undefined, argsParseError: null };
  }

  try {
    const args = decodeSandboxArgs(rawArgs);
    return { toolName, args, argsParseError: null };
  } catch (error) {
    return {
      toolName,
      args: undefined,
      argsParseError: error instanceof Error ? error.message : String(error),
    };
  }
}

// ---------------------------------------------------------------------------
// React hook — consumed by InspectorSandboxHost
// ---------------------------------------------------------------------------

/**
 * Hook that returns the parsed sandbox params, or `null` when not in sandbox
 * mode. Re-evaluates on `popstate` so back/forward navigation that changes
 * the query string is picked up.
 *
 * Returns `null` during SSR (window is unavailable). The host renders
 * `children` normally in that case.
 */
export function useSandboxParams(): SandboxParams | null {
  // Cache the initial parse result so it survives commits where window.location
  // hasn't changed. We intentionally don't subscribe to args mutations from
  // postMessage here — that's a separate state machine owned by
  // InspectorSandboxHost (it merges URL-derived args with postMessage args).
  const initial = useMemo<SandboxParams | null>(
    () => readCurrentLocation(),
    [],
  );

  const [params, setParams] = useState<SandboxParams | null>(initial);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (typeof window.addEventListener !== "function") return;
    const onPopState = () => {
      setParams(readCurrentLocation());
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  return params;
}

/**
 * Read the current document URL safely. Returns `null` during SSR (no
 * `window`) or in test environments that null out `window.location`.
 */
function readCurrentLocation(): SandboxParams | null {
  if (typeof window === "undefined") return null;
  const href = window.location?.href;
  if (typeof href !== "string") return null;
  return parseSandboxParams(href);
}

// ---------------------------------------------------------------------------
// Internal: base64 codec that's URL-safe and tolerant on decode
// ---------------------------------------------------------------------------

function base64UrlEncode(input: string): string {
  if (typeof btoa === "function") {
    // `unescape(encodeURIComponent(s))` round-trips through Latin-1 so btoa
    // accepts Unicode. This is the long-standing browser-compatible idiom.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const latin1 = unescape(encodeURIComponent(input));
    return btoa(latin1)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }
  // Node fallback for tests.
  return Buffer.from(input, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(input: string): string {
  // Accept both alphabets and re-pad.
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  if (typeof atob === "function") {
    const latin1 = atob(padded);
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    return decodeURIComponent(escape(latin1));
  }
  return Buffer.from(padded, "base64").toString("utf-8");
}
