import { NextResponse } from "next/server";
import { Socket } from "phoenix";

const INTEGRATION_SLUG = "acp-agent";
const SMOKE_AGENT_ID = "agentic_chat";
const RUN_TIMEOUT_MS = 45_000;

interface Admission {
  readonly joinToken: string;
  readonly realtime: { readonly clientUrl: string; readonly topic: string };
  readonly runId: string;
  readonly threadId: string;
}

interface PushLike {
  receive(status: string, callback: (payload?: unknown) => void): PushLike;
}

interface ChannelLike {
  join(): PushLike;
  leave(): unknown;
  on(event: string, callback: (payload: unknown) => void): unknown;
  onClose(callback: () => void): unknown;
  onError(callback: (payload?: unknown) => void): unknown;
}

interface SocketLike {
  channel(topic: string, params: object): ChannelLike;
  connect(): void;
  disconnect(): void;
  onClose(callback: () => void): unknown;
  onError(callback: (payload?: unknown) => void): unknown;
}

interface SmokeDependencies {
  readonly fetchImpl?: typeof fetch;
  readonly socketFactory?: (url: string, options: object) => SocketLike;
}

const parseAdmission = (value: unknown): Admission => {
  if (typeof value !== "object" || value === null) {
    throw new Error("Runtime did not return realtime admission JSON");
  }
  const admission = value as Record<string, unknown>;
  const realtime = admission.realtime;
  if (
    typeof admission.joinToken !== "string" ||
    typeof admission.runId !== "string" ||
    typeof admission.threadId !== "string" ||
    typeof realtime !== "object" ||
    realtime === null ||
    typeof (realtime as Record<string, unknown>).clientUrl !== "string" ||
    typeof (realtime as Record<string, unknown>).topic !== "string"
  ) {
    throw new Error("Runtime returned incomplete realtime admission JSON");
  }
  return admission as unknown as Admission;
};

const reasonText = (value: unknown): string => {
  if (
    typeof value === "object" &&
    value !== null &&
    "reason" in value &&
    typeof value.reason === "string"
  ) {
    return value.reason;
  }
  return typeof value === "string" ? value : "unknown error";
};

const followRun = (
  admission: Admission,
  socketFactory: (url: string, options: object) => SocketLike,
): Promise<Array<Record<string, unknown>>> => {
  const socket = socketFactory(admission.realtime.clientUrl, {
    params: { join_token: admission.joinToken },
    reconnectAfterMs: () => 1_000,
    rejoinAfterMs: () => 1_000,
  });
  const channel = socket.channel(admission.realtime.topic, {
    run_id: admission.runId,
    stream_mode: "run",
  });

  return new Promise((resolve, reject) => {
    const events: Array<Record<string, unknown>> = [];
    let settled = false;
    const finish = (
      outcome: { readonly events: Array<Record<string, unknown>> } | Error,
    ): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      channel.leave();
      socket.disconnect();
      if (outcome instanceof Error) reject(outcome);
      else resolve(outcome.events);
    };
    const timer = setTimeout(() => {
      finish(new Error("Realtime run follow timed out"));
    }, RUN_TIMEOUT_MS);

    channel.on("ag_ui_event", (payload) => {
      if (typeof payload !== "object" || payload === null) {
        finish(new Error("Gateway returned an invalid AG-UI event"));
        return;
      }
      const event = payload as Record<string, unknown>;
      events.push(event);
      if (event.type === "RUN_FINISHED" || event.type === "RUN_ERROR") {
        finish({ events });
      }
    });
    channel.onError((payload) => {
      finish(new Error(`Realtime channel failed: ${reasonText(payload)}`));
    });
    channel.onClose(() => {
      finish(new Error("Realtime channel closed before the run finished"));
    });
    socket.onError((payload) => {
      finish(new Error(`Realtime socket failed: ${reasonText(payload)}`));
    });
    socket.onClose(() => {
      finish(new Error("Realtime socket closed before the run finished"));
    });
    channel
      .join()
      .receive("error", (payload) => {
        finish(new Error(`Realtime join failed: ${reasonText(payload)}`));
      })
      .receive("timeout", () => {
        finish(new Error("Realtime join timed out"));
      });
    socket.connect();
  });
};

const errorResponse = (
  stage: string,
  error: string,
  latency: number,
): NextResponse =>
  NextResponse.json(
    {
      status: "error",
      integration: INTEGRATION_SLUG,
      stage,
      error,
      latency_ms: latency,
      timestamp: new Date().toISOString(),
    },
    { status: 502 },
  );

/** Runs one deployed ACP prompt through REST admission and Gateway replay. */
export async function runSmoke(
  dependencies: SmokeDependencies = {},
): Promise<NextResponse> {
  const start = Date.now();
  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL ||
    `http://localhost:${process.env.PORT || 10000}`;
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const socketFactory =
    dependencies.socketFactory ??
    ((url: string, options: object): SocketLike =>
      new Socket(url, options) as unknown as SocketLike);

  try {
    const now = Date.now();
    const res = await fetchImpl(`${baseUrl}/api/copilotkit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        method: "agent/run",
        params: { agentId: SMOKE_AGENT_ID },
        body: {
          threadId: `smoke-${now}`,
          runId: `smoke-run-${now}`,
          state: {},
          messages: [
            {
              id: `smoke-msg-${now}`,
              role: "user",
              content: "Respond with exactly: OK",
            },
          ],
          tools: [],
          context: [],
          forwardedProps: {},
        },
      }),
      signal: AbortSignal.timeout(RUN_TIMEOUT_MS),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      return errorResponse(
        "runtime_response",
        `Runtime returned ${res.status}: ${errBody.slice(0, 200)}`,
        Date.now() - start,
      );
    }

    const admission = parseAdmission(await res.json());
    const events = await followRun(admission, socketFactory);
    const latency = Date.now() - start;
    if (events.some((event) => event.type === "RUN_ERROR")) {
      return errorResponse(
        "run_failed",
        "Runtime reported an ACP run error",
        latency,
      );
    }
    const terminal = events.find((event) => event.type === "RUN_FINISHED");
    const outcome = terminal?.outcome;
    if (
      typeof outcome !== "object" ||
      outcome === null ||
      !("type" in outcome) ||
      outcome.type !== "success"
    ) {
      return errorResponse(
        "run_incomplete",
        "Gateway replay did not finish the ACP run successfully",
        latency,
      );
    }
    const answer = events
      .filter((event) => event.type === "TEXT_MESSAGE_CONTENT")
      .map((event) => (typeof event.delta === "string" ? event.delta : ""))
      .join("");
    if (answer !== "OK") {
      return errorResponse(
        "unexpected_output",
        "Gateway replay did not contain the external ACP fixture response",
        latency,
      );
    }

    return NextResponse.json({
      status: "ok",
      integration: INTEGRATION_SLUG,
      latency_ms: latency,
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    const failure = error instanceof Error ? error : new Error(String(error));
    const stage =
      failure.name === "AbortError" ||
      failure.name === "TimeoutError" ||
      failure.message.includes("timed out")
        ? "timeout"
        : failure.message.includes("fetch") ||
            failure.message.includes("ECONNREFUSED")
          ? "agent_unreachable"
          : "pipeline_error";
    return errorResponse(stage, failure.message, Date.now() - start);
  }
}
