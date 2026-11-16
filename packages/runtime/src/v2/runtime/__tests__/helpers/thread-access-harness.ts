/**
 * Shared harness for the Thread access tests. Every request goes through the
 * real fetch handler, router and handlers. Only the agent is a local stub.
 */
import { afterEach, expect } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";
import { CopilotRuntime } from "../../core/runtime";
import type { CopilotRuntimeOptions } from "../../core/runtime";
import { createCopilotRuntimeHandler } from "../../core/fetch-handler";
import { ɵGLOBAL_STORE } from "../../runner/in-memory";
import { OwnershipTestAgent } from "../../runner/__tests__/ownership-test-agent";

export const BASE = "http://localhost/api/copilotkit";

export type Handler = (request: Request) => Promise<Response>;

/** Identity from the `x-test-user` header; throws when the header is missing. */
export const identifyFromHeader = (request: Request) => {
  const id = request.headers.get("x-test-user");
  if (!id) throw new Error("not signed in");
  return { id, name: id };
};

/**
 * Release hanging runs and reset the process-wide in-memory store after each
 * test, so no test sees another test's threads or a still-running thread.
 */
export function isolateThreadStore(): void {
  afterEach(() => {
    OwnershipTestAgent.releaseAll();
    ɵGLOBAL_STORE.clear();
  });
}

export function testAgents(): Record<string, AbstractAgent> {
  return {
    secret: new OwnershipTestAgent(),
    hang: new OwnershipTestAgent(true),
  };
}

export function makeHandler(
  extra: Partial<CopilotRuntimeOptions> = {},
  agents: Record<string, AbstractAgent> = testAgents(),
): Handler {
  const runtime = new CopilotRuntime({
    agents,
    ...extra,
  } as CopilotRuntimeOptions);
  return createCopilotRuntimeHandler({ runtime, basePath: "/api/copilotkit" });
}

export function headersFor(user?: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(user ? { "x-test-user": user } : {}),
  };
}

let seq = 0;
export function uniqueThreadId(label: string): string {
  seq += 1;
  return `${label}-${Date.now().toString(36)}-${seq}`;
}

export function runBody(threadId: string, secret: string, runId?: string) {
  return JSON.stringify({
    threadId,
    runId: runId ?? `run-${threadId}-${Math.random().toString(36).slice(2)}`,
    messages: [{ id: `msg-${threadId}`, role: "user", content: secret }],
    state: { secret },
    tools: [],
    context: [],
    forwardedProps: {},
  });
}

/** Runs to completion and returns the response with its raw body. */
export async function runThread(
  handler: Handler,
  opts: { user?: string; threadId: string; secret: string; agent?: string },
): Promise<Response & { bodyText: string }> {
  const response = await handler(
    new Request(`${BASE}/agent/${opts.agent ?? "secret"}/run`, {
      method: "POST",
      headers: headersFor(opts.user),
      body: runBody(opts.threadId, opts.secret),
    }),
  );
  const bodyText = await response.text();
  return Object.assign(response, { bodyText });
}

export interface HangingRun {
  runId: string;
  /** Reads the stream to its end and returns the whole body. */
  drain: () => Promise<string>;
}

/**
 * Starts a run on the hanging agent and resolves once the stream carried
 * RUN_STARTED, so the runner has marked the run active. Fails at once when the
 * run is refused or ends before it starts.
 */
export async function startHangingRun(
  handler: Handler,
  opts: { user?: string; threadId: string; secret: string },
): Promise<HangingRun> {
  const runId = `run-${opts.threadId}-hang`;
  const response = await handler(
    new Request(`${BASE}/agent/hang/run`, {
      method: "POST",
      headers: headersFor(opts.user),
      body: runBody(opts.threadId, opts.secret, runId),
    }),
  );
  expect(response.status).toBe(200);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (!text.includes("RUN_STARTED")) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  // A run that ended before it started must fail here, at the cause.
  expect(text).toContain("RUN_STARTED");
  return {
    runId,
    drain: async () => {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
      }
      return text;
    },
  };
}

export function get(handler: Handler, path: string, user?: string) {
  return handler(new Request(`${BASE}${path}`, { headers: headersFor(user) }));
}

export function post(
  handler: Handler,
  path: string,
  user?: string,
  body?: string,
) {
  return handler(
    new Request(`${BASE}${path}`, {
      method: "POST",
      headers: headersFor(user),
      ...(body !== undefined ? { body } : {}),
    }),
  );
}

export async function listIds(
  handler: Handler,
  user?: string,
): Promise<string[]> {
  const response = await get(handler, "/threads", user);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { threads: { id: string }[] };
  return body.threads.map((t) => t.id);
}
