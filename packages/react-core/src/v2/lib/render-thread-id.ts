import { randomUUID } from "@copilotkit/shared";

/**
 * Mints a Thread ID during render, for a component that has none yet.
 *
 * In the browser it returns a random UUID. In a server render it returns
 * `serverId` (pass a value from `useId()`) instead, because frameworks that
 * prerender, such as Next.js with `cacheComponents`, fail the build on random
 * values read during render. The server ID is never used: the effects that
 * connect and run the agent run only in the browser, and the browser render
 * mints a real ID during hydration. Thread IDs are not written to the DOM, so
 * hydration does not mismatch.
 */
export function mintRenderThreadId(serverId: string): string {
  return typeof window === "undefined"
    ? `ssr-thread-${serverId}`
    : randomUUID();
}
