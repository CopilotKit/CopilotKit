import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Page, Request } from "playwright";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  BYTE_CAP_BY_TIER,
  CvdiagEmitter,
  DEBUG_MAX_WALLCLOCK_MS,
} from "../../cvdiag/emit.js";
import { CvdiagProbeSession } from "../../cvdiag/probe-session.js";
import type { CvdiagRequestFailedEvent } from "../../cvdiag/probe-session.js";
import {
  EDGE_HEADER_KEYS,
  SCHEMA_VERSION,
  validateEnvelope,
} from "../../cvdiag/schema.js";
import type { CvdiagEnvelope } from "../../cvdiag/schema.js";
import { wirePlaywrightPage } from "./d4-chat-roundtrip.js";

// Resolve the locked dependency's private entry points from its own metadata.
// No browser, HTTP client, provider, or persistence service is constructed.
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
const { TargetClosedError } = require(join(coreRoot, "lib/client/errors.js"));

type Owner = { _type: string; _guid: string };
interface OfflineConnection {
  sendMessageToServer(owner: Owner, method: string): PromiseLike<unknown>;
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

type Mode =
  | "default"
  | "verbose"
  | "debug-safe"
  | "debug-expired"
  | "no-writer";
type Case = {
  id: string;
  url?: string;
  failureText?: string;
  status?: number;
  rejection?: string;
  thenable?: boolean;
  mode?: Mode;
  expectedUrl?: string;
  expectedError?: string;
  truncated?: boolean;
};
const URL = "https://boundary.invalid/failed";
const ERROR = "net::ERR_ABORTED";
const cases: Case[] = [
  { id: "null-normal", failureText: ERROR },
  { id: "null-empty-failure", failureText: "" },
  { id: "null-absent-failure" },
  ...[0, -1, 503, Number.MAX_SAFE_INTEGER].map((status) => ({
    id: `integer-status-${status}`,
    status,
    failureText: ERROR,
  })),
  {
    id: "transport-closed",
    failureText: ERROR,
    rejection: "Target page, context or browser has been closed",
  },
  {
    id: "transport-ordinary",
    failureText: ERROR,
    rejection: "ordinary offline transport rejection",
  },
  { id: "transport-thenable", failureText: ERROR, status: 503, thenable: true },
  {
    id: "unicode",
    url: "https://boundary.invalid/雪/🙂",
    failureText: "失敗🙂",
  },
  { id: "empty-strings", url: "", failureText: "" },
  {
    id: "oversized-url",
    url: "界".repeat(1000),
    failureText: ERROR,
    expectedUrl: "界".repeat(85),
  },
  {
    id: "oversized-error",
    failureText: "界".repeat(3000),
    expectedError: `${"界".repeat(61)}...`,
    truncated: true,
  },
  {
    id: "synthetic-scrub",
    url: "https://user:synthetic@boundary.invalid/failed",
    failureText: "Bearer synthetic-token sk-abcdefghijklmnop",
    expectedUrl: "https://[REDACTED]@boundary.invalid/failed",
    expectedError: "[REDACTED] [REDACTED]",
  },
  ...(["verbose", "debug-safe", "debug-expired", "no-writer"] as const).map(
    (mode) => ({
      id: `inclusion-${mode}`,
      mode,
      failureText: ERROR,
      status: 503,
    }),
  ),
];
const caseIds = [
  ...cases.map(({ id }) => id),
  "reverse-first",
  "reverse-second",
];
const observedIds: string[] = [];

// All initializers, events and response results pass the installed validators.
// The only dependency interception is the channel transport; Request.response,
// Response.fromNullable, BrowserContext normalization and Page.emit stay real.
function offlinePage() {
  const connection: OfflineConnection = new Connection(nodePlatform);
  const transports = new Map<string, () => unknown>();
  const calls: string[] = [];
  connection.sendMessageToServer = (owner, method) => {
    if (method === "updateSubscription") return Promise.resolve({});
    if (owner._type !== "Request" || method !== "response") {
      throw new Error(`unexpected offline transport: ${owner._type}.${method}`);
    }
    calls.push(owner._guid);
    const result = transports.get(owner._guid);
    if (!result) throw new Error(`missing transport: ${owner._guid}`);
    // Return the transport's actual Promise/thenable. The installed async
    // channel and Request.response perform adoption and nullable conversion.
    return result() as PromiseLike<unknown>;
  };
  function create(
    parent: string,
    type: string,
    guid: string,
    initializer: unknown,
  ) {
    connection._createRemoteObject(parent, type, guid, initializer);
  }
  let rawPage: Page;
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
    rawPage = connection.getObjectWithKnownName("page") as Page;
  } catch (error) {
    connection.close();
    throw error;
  }
  const page = wirePlaywrightPage(
    rawPage as unknown as Parameters<typeof wirePlaywrightPage>[0],
  );
  function request(input: Case, transport?: () => unknown) {
    const guid = `request-${input.id}`;
    const url = input.url ?? URL;
    create("context", "Request", guid, {
      frame: { guid: "frame" },
      url,
      resourceType: "fetch",
      method: "POST",
      headers: [],
      isNavigationRequest: false,
    });
    const req = connection.getObjectWithKnownName(guid) as Request;
    expect(req).toBeInstanceOf(InstalledRequest);
    let reply: unknown = {};
    if (input.status !== undefined) {
      const responseGuid = `response-${input.id}`;
      create("context", "Response", responseGuid, {
        request: { guid },
        url,
        status: input.status,
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
      expect(connection.getObjectWithKnownName(responseGuid)).toBeInstanceOf(
        InstalledResponse,
      );
      reply = { response: { guid: responseGuid } };
    }
    const validateReply = (value: unknown) =>
      findValidator("Request", "response", "Result")(
        value,
        "",
        connection._validatorFromWireContext(),
      );
    transports.set(
      guid,
      transport
        ? () => Promise.resolve(transport()).then(validateReply)
        : () => {
            if (input.rejection)
              return Promise.reject(
                input.id === "transport-closed"
                  ? new TargetClosedError(input.rejection)
                  : new Error(input.rejection),
              );
            if (input.thenable) {
              return {
                // Required non-Promise transport input for adoption coverage.
                // eslint-disable-next-line unicorn/no-thenable
                then(resolve: (value: unknown) => void) {
                  resolve(validateReply(reply));
                },
              };
            }
            return Promise.resolve(validateReply(reply));
          },
    );
    return {
      req,
      reply,
      fire() {
        connection.dispatch({
          guid: "context",
          method: "requestFailed",
          params: {
            request: { guid },
            page: { guid: "page" },
            responseEndTiming: 0,
            ...(input.failureText === undefined
              ? {}
              : { failureText: input.failureText }),
          },
        });
        expect(req.failure()).toEqual(
          input.failureText ? { errorText: input.failureText } : null,
        );
      },
    };
  }
  return { page, connection, calls, request };
}

async function deadline<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`D4 boundary delivery deadline: ${label}`)),
          1000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function ndjson(
  bufferDir: string,
  count: number,
): Promise<CvdiagEnvelope[]> {
  // buffer() is asynchronous and intentionally not exposed by the session.
  // Bounded reads observe the real file completion, rather than mocking it.
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const dates = await readdir(bufferDir);
    const lines: CvdiagEnvelope[] = [];
    for (const date of dates) {
      for (const file of await readdir(join(bufferDir, date))) {
        const content = await readFile(join(bufferDir, date, file), "utf8");
        const complete = content.slice(0, content.lastIndexOf("\n") + 1);
        lines.push(
          ...complete
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line) as CvdiagEnvelope),
        );
      }
    }
    if (lines.length === count) return lines;
    expect(lines.length).toBeLessThanOrEqual(count);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`D4 boundary NDJSON completion deadline: expected ${count}`);
}

async function consume(inputs: Case[], reverse = false) {
  const bufferDir = await mkdtemp(join(tmpdir(), "d4-boundary-"));
  let connection: OfflineConnection | undefined;
  try {
    const offline = offlinePage();
    connection = offline.connection;
    const mode = inputs[0].mode ?? "default";
    const written: CvdiagEnvelope[] = [];
    const emitter = new CvdiagEmitter({
      env: { NODE_ENV: "test", CVDIAG_DEBUG_ALLOW_LIST: "boundary" },
      verbose: mode === "verbose",
      debug: mode.startsWith("debug"),
      ...(mode === "no-writer"
        ? {}
        : {
            pbWriter: {
              async writeBatch(batch: CvdiagEnvelope[]) {
                written.push(...structuredClone(batch));
              },
            },
          }),
    });
    const session = new CvdiagProbeSession({
      emitter,
      testId: "d4-boundary",
      slug: "boundary",
      demo: "d4",
      bufferDir,
      nowMs: performance.now(),
    });
    const diagnostics: CvdiagRequestFailedEvent[] = [];
    let delivered!: () => void;
    const done = new Promise<void>((resolve) => {
      delivered = resolve;
    });
    // Clock control only selects the documented DEBUG-expiry path. No adapter,
    // session, emitter method or request accessor is replaced.
    const clock =
      mode === "debug-expired"
        ? vi
            .spyOn(Date, "now")
            .mockReturnValue(Date.now() + DEBUG_MAX_WALLCLOCK_MS + 1)
        : undefined;
    try {
      expect(emitter.shouldEmit("probe.network.error")).toBe(true);
      expect(emitter.shouldEmit("probe.start")).toBe(
        mode === "verbose" || mode === "debug-safe",
      );
      offline.page.onRequestFailed?.((event) => {
        diagnostics.push(event);
        session.networkError(event);
        if (diagnostics.length === inputs.length) delivered();
      });
      const settle: (() => void)[] = [];
      for (const input of inputs) {
        let resolve!: (reply: unknown) => void;
        const pending = reverse
          ? new Promise<unknown>((settleResponse) => {
              resolve = settleResponse;
            })
          : undefined;
        const request = offline.request(
          input,
          pending ? () => pending : undefined,
        );
        if (pending) settle.push(() => resolve(request.reply));
        request.fire();
      }
      if (reverse) {
        settle[1]();
        await new Promise<void>((resolve) => setImmediate(resolve));
        settle[0]();
      }
      await deadline(done, inputs.map(({ id }) => id).join(","));
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(diagnostics).toHaveLength(inputs.length);
      const order = reverse ? [inputs[1], inputs[0]] : inputs;
      expect(diagnostics).toEqual(
        order.map((input) => ({
          url: input.url ?? URL,
          errorClass: input.failureText || "unknown",
          responseStatus: input.rejection ? null : (input.status ?? null),
        })),
      );
      expect(offline.calls).toHaveLength(inputs.length);
      expect(emitter.queueDepth()).toBe(inputs.length);
      const buffered = await ndjson(bufferDir, inputs.length);
      await emitter.flush();
      if (mode === "no-writer") {
        expect(written).toEqual([]);
        expect(emitter.queueDepth()).toBe(inputs.length);
      } else {
        expect(emitter.queueDepth()).toBe(0);
        expect(written).toHaveLength(inputs.length);
        // Multiple async append operations may finish in a different order.
        expect(written).toEqual(expect.arrayContaining(buffered));
      }
      for (const input of inputs) {
        const expectedUrl = input.expectedUrl ?? input.url ?? URL;
        const envelope = buffered.find(
          ({ metadata }) => metadata.url === expectedUrl,
        );
        expect(envelope, input.id).toBeDefined();
        if (!envelope)
          throw new Error(`missing boundary envelope: ${input.id}`);
        expect(
          validateEnvelope(envelope as unknown as Record<string, unknown>),
        ).toEqual({ ok: true, unknownKeys: [] });
        expect(envelope).toMatchObject({
          schema_version: 1,
          test_id: "d4-boundary",
          trace_id: "d4-boundary",
          layer: "probe",
          boundary: "probe.network.error",
          slug: "boundary",
          demo: "d4",
          outcome: "err",
          duration_ms: null,
          metadata: {
            url: expectedUrl,
            error_class:
              input.expectedError ?? (input.failureText || "unknown"),
            response_status: input.rejection ? null : (input.status ?? null),
          },
        });
        expect(Object.keys(envelope.metadata).sort()).toEqual([
          "error_class",
          "response_status",
          "url",
        ]);
        expect(envelope.span_id).toMatch(/^[0-9a-f]{16}$/);
        expect(envelope.parent_span_id).toMatch(/^[0-9a-f]{16}$/);
        expect(Number.isFinite(Date.parse(envelope.ts))).toBe(true);
        expect(Number.isFinite(envelope.mono_ns)).toBe(true);
        expect(envelope.edge_headers).toEqual(
          Object.fromEntries(EDGE_HEADER_KEYS.map((key) => [key, null])),
        );
        expect(envelope._metadata_dropped).toBeUndefined();
        expect(envelope._truncated ?? false).toBe(input.truncated ?? false);
        expect(
          Buffer.byteLength(JSON.stringify(envelope), "utf8"),
        ).toBeLessThanOrEqual(
          BYTE_CAP_BY_TIER[
            mode.startsWith("debug")
              ? "debug"
              : mode === "verbose"
                ? "verbose"
                : "default"
          ],
        );
        expect(JSON.parse(JSON.stringify(envelope))).toEqual(envelope);
        console.info(
          JSON.stringify({
            kind: "D4_BOUNDARY_OBSERVED",
            id: input.id,
            input,
            diagnostic: diagnostics.find(
              ({ url }) => url === (input.url ?? URL),
            ),
            envelope,
            ndjson: envelope,
            writer:
              mode === "no-writer"
                ? null
                : written.find(({ span_id }) => span_id === envelope.span_id),
            queueDepth: emitter.queueDepth(),
          }),
        );
        observedIds.push(input.id);
      }
    } finally {
      clock?.mockRestore();
      emitter.stopBackgroundFlush();
    }
  } finally {
    connection?.close();
    await rm(bufferDir, { recursive: true, force: true });
  }
}

describe("D4 installed Playwright to diagnostic consumer boundary", () => {
  beforeAll(() => {
    expect(caseIds).toHaveLength(21);
    expect(new Set(caseIds).size).toBe(caseIds.length);
    console.info(
      JSON.stringify({
        kind: "D4_BOUNDARY_CATALOG",
        caseIds,
        count: caseIds.length,
        versions: {
          node: process.version,
          playwright: require("playwright/package.json").version,
          core: playwrightRequire("playwright-core/package.json").version,
          tsx: require("tsx/package.json").version,
          vitest: require("vitest/package.json").version,
          schema: SCHEMA_VERSION,
        },
        contracts: [
          "RequestInitializer",
          "ResponseInitializer",
          "BrowserContextRequestFailedEvent",
          "RequestResponseResult",
        ],
      }),
    );
  });
  afterAll(() => {
    expect([...observedIds].sort()).toEqual([...caseIds].sort());
  });
  it.each(cases)(
    "accepts $id through actual dependency and consumer",
    async (input) => {
      await consume([input]);
    },
  );
  it("preserves request identity when real transport responses settle in reverse order", async () => {
    await consume(
      [
        {
          id: "reverse-first",
          url: "https://boundary.invalid/first",
          failureText: "first",
          status: 503,
        },
        {
          id: "reverse-second",
          url: "https://boundary.invalid/second",
          failureText: "second",
          status: 0,
        },
      ],
      true,
    );
  });
  it.each(["503", NaN, 0.5])(
    "rejects invalid status %s as a validator control only",
    (status) => {
      const offline = offlinePage();
      try {
        expect(() =>
          offline.request({ id: "invalid", status: status as number }),
        ).toThrow(/expected integer/);
        console.info(
          JSON.stringify({
            kind: "D4_VALIDATOR_CONTROL",
            status: String(status),
            accepted: false,
          }),
        );
      } finally {
        offline.connection.close();
      }
    },
  );
});
