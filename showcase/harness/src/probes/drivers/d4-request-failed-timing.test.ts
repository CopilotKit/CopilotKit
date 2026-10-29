import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Page, Request } from "playwright";
import { describe, expect, it, vi } from "vitest";
import { CvdiagEmitter } from "../../cvdiag/emit.js";
import { CvdiagProbeSession } from "../../cvdiag/probe-session.js";
import type {
  CvdiagRequestFailedEvent,
  CvdiagResponseEvent,
} from "../../cvdiag/probe-session.js";
import { validateEnvelope } from "../../cvdiag/schema.js";
import type { CvdiagEnvelope } from "../../cvdiag/schema.js";
import { wirePlaywrightPage } from "./d4-chat-roundtrip.js";

const require = createRequire(import.meta.url);
const playwrightRequire = createRequire(
  require.resolve("playwright/package.json"),
);
const coreRoot = dirname(
  playwrightRequire.resolve("playwright-core/package.json"),
);
const { Connection } = require(join(coreRoot, "lib/client/connection.js"));
const { nodePlatform } = require(
  join(coreRoot, "lib/server/utils/nodePlatform.js"),
);
const { Request: InstalledRequest, Response: InstalledResponse } = require(
  join(coreRoot, "lib/client/network.js"),
);
const { findValidator } = require(join(coreRoot, "lib/protocol/validator.js"));

interface OfflineConnection {
  sendMessageToServer(
    owner: { _type: string; _guid: string },
    method: string,
  ): PromiseLike<unknown>;
  _createRemoteObject(
    parent: string,
    type: string,
    guid: string,
    initializer: unknown,
  ): void;
  _validatorFromWireContext(): unknown;
  getObjectWithKnownName(guid: string): unknown;
  dispatch(message: unknown): void;
  close(): void;
}

const URL = "https://timing.invalid/api/copilotkit";
const ERROR = "net::ERR_ABORTED";

// Keep the installed Request.response, Response.request, protocol validation,
// BrowserContext normalization and Page event delivery. Only transport is local.
function offlinePage() {
  const connection: OfflineConnection = new Connection(nodePlatform);
  const replies = new Map<string, Promise<unknown>>();
  const calls: string[] = [];
  connection.sendMessageToServer = (owner, method) => {
    if (method === "updateSubscription") return Promise.resolve({});
    if (owner._type !== "Request" || method !== "response") {
      throw new Error(`unexpected offline transport: ${owner._type}.${method}`);
    }
    calls.push(owner._guid);
    const reply = replies.get(owner._guid);
    if (!reply) throw new Error(`missing offline reply: ${owner._guid}`);
    return reply.then((value) =>
      findValidator("Request", "response", "Result")(
        value,
        "",
        connection._validatorFromWireContext(),
      ),
    );
  };
  const create = (
    parent: string,
    type: string,
    guid: string,
    initializer: unknown,
  ) => connection._createRemoteObject(parent, type, guid, initializer);
  try {
    create("", "Tracing", "tracing", {});
    create("", "Debugger", "debugger", {});
    create("", "APIRequestContext", "api", { tracing: { guid: "tracing" } });
    create("", "BrowserContext", "context", {
      tracing: { guid: "tracing" },
      debugger: { guid: "debugger" },
      requestContext: { guid: "api" },
      options: {},
    });
    create("context", "Frame", "frame", {
      url: "about:blank",
      name: "",
      loadStates: [],
    });
    create("context", "Page", "page", {
      mainFrame: { guid: "frame" },
      isClosed: false,
    });
    const rawPage = connection.getObjectWithKnownName("page") as Page;
    const page = wirePlaywrightPage(
      rawPage as unknown as Parameters<typeof wirePlaywrightPage>[0],
    );
    function request(id: string, status?: number) {
      const guid = `request-${id}`;
      create("context", "Request", guid, {
        frame: { guid: "frame" },
        url: URL,
        resourceType: "fetch",
        method: "POST",
        headers: [],
        isNavigationRequest: false,
      });
      const req = connection.getObjectWithKnownName(guid) as Request;
      expect(req).toBeInstanceOf(InstalledRequest);
      const responseGuid = `response-${id}`;
      if (status !== undefined) {
        create("context", "Response", responseGuid, {
          request: { guid },
          url: URL,
          status,
          statusText: "offline",
          headers: [],
          fromServiceWorker: false,
          timing: {
            startTime: 0,
            domainLookupStart: -1,
            domainLookupEnd: -1,
            connectStart: -1,
            secureConnectionStart: -1,
            connectEnd: -1,
            requestStart: -1,
            responseStart: -1,
          },
        });
        const response = connection.getObjectWithKnownName(responseGuid);
        expect(response).toBeInstanceOf(InstalledResponse);
        expect((response as { request(): Request }).request()).toBe(req);
      }
      let settle!: (reply: unknown) => void;
      replies.set(
        guid,
        new Promise((resolve) => {
          settle = resolve;
        }),
      );
      const dispatch = (method: string, params: Record<string, unknown>) =>
        connection.dispatch({
          guid: "context",
          method,
          params: { page: { guid: "page" }, ...params },
        });
      return {
        start: () => dispatch("request", { request: { guid } }),
        respond: () => {
          if (status === undefined) throw new Error("response not constructed");
          dispatch("response", { response: { guid: responseGuid } });
        },
        fail: () => {
          dispatch("requestFailed", {
            request: { guid },
            responseEndTiming: 0,
            failureText: ERROR,
          });
          expect(req.failure()).toEqual({ errorText: ERROR });
        },
        release: () =>
          settle(
            status === undefined ? {} : { response: { guid: responseGuid } },
          ),
      };
    }
    return { connection, page, calls, request };
  } catch (error) {
    connection.close();
    throw error;
  }
}

async function deadline<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("D4 timing diagnostic delivery deadline")),
          1000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function ndjson(bufferDir: string, count: number) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const rows: CvdiagEnvelope[] = [];
    for (const date of await readdir(bufferDir)) {
      for (const file of await readdir(join(bufferDir, date))) {
        const content = await readFile(join(bufferDir, date, file), "utf8");
        rows.push(
          ...content
            .slice(0, content.lastIndexOf("\n") + 1)
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line) as CvdiagEnvelope),
        );
      }
    }
    expect(rows.length).toBeLessThanOrEqual(count);
    if (rows.length === count) return rows;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`D4 timing NDJSON completion deadline: expected ${count}`);
}

async function exercise(postResponseFailure: boolean) {
  const bufferDir = await mkdtemp(join(tmpdir(), "d4-timing-"));
  const written: CvdiagEnvelope[] = [];
  const emitter = new CvdiagEmitter({
    env: { NODE_ENV: "test" },
    pbWriter: {
      async writeBatch(batch: CvdiagEnvelope[]) {
        written.push(...structuredClone(batch));
      },
    },
  });
  let offline: ReturnType<typeof offlinePage> | undefined;
  let release: (() => void) | undefined;
  let clock: { mockRestore(): void } | undefined;
  let now = 100;
  try {
    clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    expect(performance.now()).toBe(100);
    offline = offlinePage();
    const session = new CvdiagProbeSession({
      emitter,
      testId: "d4-timing",
      slug: "timing",
      demo: "d4",
      bufferDir,
      nowMs: performance.now(),
    });
    const responses: CvdiagResponseEvent[] = [];
    const diagnostics: CvdiagRequestFailedEvent[] = [];
    let delivered!: () => void;
    const done = new Promise<void>((resolve) => {
      delivered = resolve;
    });
    offline.page.onResponse?.((event) => {
      responses.push(event);
    });
    offline.page.onRequestFailed?.((event) => {
      diagnostics.push(event);
      delivered();
    });
    const first = offline.request(
      postResponseFailure ? "A" : "C",
      postResponseFailure ? 503 : undefined,
    );
    release = first.release;
    first.start();
    if (postResponseFailure) {
      now = 120;
      first.respond();
      expect(responses.map(({ durationMs }) => durationMs)).toEqual([20]);
    } else {
      now = 120;
      first.fail();
    }
    const second = offline.request(postResponseFailure ? "B" : "D", 200);
    now = 200;
    second.start();
    if (postResponseFailure) {
      now = 230;
      first.fail();
    }
    expect(diagnostics).toEqual([]);
    now = 250;
    expect(performance.now()).toBe(250);
    second.respond();
    expect(responses).toHaveLength(postResponseFailure ? 2 : 1);
    expect(
      responses.at(-1)?.durationMs,
      postResponseFailure
        ? "B keeps its 50ms start after A responds then fails"
        : "D keeps its 50ms start after responseless C fails",
    ).toBe(50);
    first.release();
    await deadline(done);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(diagnostics).toEqual([
      {
        url: URL,
        errorClass: ERROR,
        responseStatus: postResponseFailure ? 503 : null,
      },
    ]);
    expect(offline.calls).toEqual([
      postResponseFailure ? "request-A" : "request-C",
    ]);
    // Persist only after the direct duration assertion, so an assertion RED
    // cannot leave asynchronous file writes racing resource cleanup.
    for (const response of responses) session.networkResponse(response);
    for (const diagnostic of diagnostics) session.networkError(diagnostic);
    const buffered = await ndjson(bufferDir, postResponseFailure ? 3 : 2);
    await emitter.flush();
    expect(written).toHaveLength(buffered.length);
    expect(written).toEqual(expect.arrayContaining(buffered));
    expect(emitter.queueDepth()).toBe(0);
    for (const envelope of buffered) {
      expect(
        validateEnvelope(envelope as unknown as Record<string, unknown>),
      ).toEqual({ ok: true, unknownKeys: [] });
    }
    const sibling = buffered.filter(
      ({ boundary, metadata }) =>
        boundary === "probe.network.response" && metadata.status === 200,
    );
    expect(sibling).toHaveLength(1);
    expect(sibling[0]).toMatchObject({
      duration_ms: 50,
      metadata: { url: URL, duration_ms: 50 },
    });
    const errors = buffered.filter(
      ({ boundary }) => boundary === "probe.network.error",
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      schema_version: 1,
      duration_ms: null,
      outcome: "err",
      metadata: {
        url: URL,
        error_class: ERROR,
        response_status: postResponseFailure ? 503 : null,
      },
    });
    expect(Object.keys(errors[0].metadata).sort()).toEqual([
      "error_class",
      "response_status",
      "url",
    ]);
  } finally {
    release?.();
    await new Promise<void>((resolve) => setImmediate(resolve));
    offline?.connection.close();
    clock?.mockRestore();
    emitter.stopBackgroundFlush();
    await rm(bufferDir, { recursive: true, force: true });
  }
}

describe("D4 installed Playwright failed-request timing eviction", () => {
  it(
    "preserves B duration 50 after A response then requestfailed without double eviction",
    { retry: 0 },
    async () => {
      await exercise(true);
    },
  );
  it(
    "evicts a responseless failure synchronously while its response lookup remains pending",
    { retry: 0 },
    async () => {
      await exercise(false);
    },
  );
});
