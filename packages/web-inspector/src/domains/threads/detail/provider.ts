import type { ThreadDebuggerProvider } from "../../../shared/thread-debugger/types.js";

export type ThreadDebuggerResource = "messages" | "events" | "state";

const providerIds = new WeakMap<ThreadDebuggerProvider, number>();
let nextProviderId = 1;

export function createProviderLoadKey(
  provider: ThreadDebuggerProvider | null,
): string {
  if (!provider) return "provider:none";
  let id = providerIds.get(provider);
  if (!id) {
    id = nextProviderId;
    nextProviderId += 1;
    providerIds.set(provider, id);
  }
  return [
    `provider:${id}`,
    provider.getThreadMetadata ? "metadata:1" : "metadata:0",
    provider.getMessages ? "messages:1" : "messages:0",
    provider.getEvents ? "events:1" : "events:0",
    provider.getState ? "state:1" : "state:0",
  ].join("|");
}

export function createHeadersLoadKey(headers: Record<string, string>): string {
  return JSON.stringify(
    Object.entries(headers).sort(([leftKey], [rightKey]) =>
      leftKey.localeCompare(rightKey),
    ),
  );
}

export function createThreadLoadKey(input: {
  threadId: string | null;
  provider: ThreadDebuggerProvider | null;
  runtimeUrl: string;
  headers: Record<string, string>;
  threadInspectionAvailable: boolean;
}): string {
  return [
    input.threadId ?? "thread:none",
    createProviderLoadKey(input.provider),
    `runtime:${input.runtimeUrl}`,
    `headers:${createHeadersLoadKey(input.headers)}`,
    `inspect:${input.threadInspectionAvailable ? "1" : "0"}`,
  ].join("||");
}

export function canLoadThreadResource(
  provider: ThreadDebuggerProvider | null,
  resource: ThreadDebuggerResource,
  runtimeUrl: string,
  threadInspectionAvailable: boolean,
): boolean {
  const providerMethod =
    resource === "messages"
      ? provider?.getMessages
      : resource === "events"
        ? provider?.getEvents
        : provider?.getState;
  return (
    typeof providerMethod === "function" ||
    (!!runtimeUrl && threadInspectionAvailable)
  );
}

export function isCurrentThreadLoad(
  controller: AbortController,
  activeController: AbortController | null,
  loadKey: string,
  currentLoadKey: string,
): boolean {
  return (
    !controller.signal.aborted &&
    controller === activeController &&
    loadKey === currentLoadKey
  );
}

export function getThreadInspectionUrl(
  runtimeUrl: string,
  threadId: string,
  resource: ThreadDebuggerResource,
): string {
  return `${runtimeUrl.replace(/\/+$/, "")}/threads/${encodeURIComponent(threadId)}/${resource}`;
}
