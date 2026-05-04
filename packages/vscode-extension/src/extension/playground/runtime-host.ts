import * as http from "node:http";
import * as vscode from "vscode";
import type { LanguageModelChat } from "vscode";
import {
  vscodeLmFactory,
  type RecordedCall,
  type TanStackChunk,
} from "./vscode-lm-factory";

export interface RuntimeHostHandle {
  url: string;
  stop(): Promise<void>;
  /**
   * Snapshot of whether vscode.lm tools were exposed to the model on
   * this session, and how many were registered. Surfaced to the
   * Diagnostics panel so the user can tell at a glance whether
   * Copilot Chat (or another LM-tool provider) is installed.
   */
  vscodeLmTools: { enabled: boolean; count: number };
}

export interface StartRuntimeHostOptions {
  model: LanguageModelChat;
  mode: "live" | "record" | "replay";
  fixtureCalls?: RecordedCall[];
  onCallRecorded?: (call: RecordedCall) => void;
  log: (line: string) => void;
  /**
   * Expose `vscode.lm.tools` (system-wide tools registered by GitHub
   * Copilot, etc.) to the model alongside the user's registered tools.
   * Off by default — the playground reflects only the user's tool
   * surface. Toggled via the `copilotkit.playground.enableVscodeLmTools`
   * setting.
   */
  enableVscodeLmTools?: boolean;
}

/**
 * Lazy-loads `@copilotkit/runtime/v2`, builds a TanStack-mode BuiltInAgent
 * with the vscode-lm factory, listens on a random localhost port, returns
 * the URL + a stop handle.
 *
 * The dynamic import is intentional — the runtime's transitive deps total
 * several MB and we only need them when the chat tab is open.
 */
export async function startRuntimeHost(
  opts: StartRuntimeHostOptions,
): Promise<RuntimeHostHandle> {
  opts.log(
    `[runtime-host] starting (mode=${opts.mode}, model=${opts.model.id})`,
  );

  const [{ BuiltInAgent, CopilotSseRuntime }, { createCopilotNodeListener }] =
    await Promise.all([
      import("@copilotkit/runtime/v2"),
      import("@copilotkit/runtime/v2/node"),
    ]);

  // Snapshot the vscode.lm tool registry once per session — used both
  // by the factory and surfaced in the returned handle so the
  // Diagnostics panel can show whether tool-providing extensions are
  // installed.
  const vscodeLmToolsSnapshot = opts.enableVscodeLmTools
    ? Array.from(vscode.lm.tools)
    : [];
  if (opts.enableVscodeLmTools) {
    opts.log(
      `[runtime-host] vscode.lm tools setting=ON, vscode.lm.tools registry size=${vscodeLmToolsSnapshot.length}` +
        (vscodeLmToolsSnapshot.length === 0
          ? " — no LM-tool-providing extensions installed in this dev host (install GitHub Copilot Chat or another LM tool extension to populate this)"
          : ""),
    );
  } else {
    opts.log(
      `[runtime-host] vscode.lm tools setting=OFF (set copilotkit.playground.enableVscodeLmTools=true to enable)`,
    );
  }

  const factory = makeFactory(opts, vscodeLmToolsSnapshot);
  const agent = new BuiltInAgent({ type: "tanstack", factory });
  const runtime = new CopilotSseRuntime({ agents: { default: agent } });

  const listener = createCopilotNodeListener({
    runtime,
    basePath: "/api/copilotkit",
    cors: true,
  });

  // Wrap the listener for two reasons:
  //   1. Log every request to the output channel so silent failures
  //      (CSP blocks, wrong port, stale bundle, etc.) become visible.
  //   2. Short-circuit non-OPTIONS `/threads*` requests with an empty
  //      list. CopilotKit's thread routes require a CopilotKitIntelligence
  //      persistence layer we don't ship in the playground; without the
  //      short-circuit the runtime returns 422 and any consumer of
  //      `useThreads` errors out. OPTIONS preflight has to pass through
  //      to the underlying listener so it gets the proper
  //      `Access-Control-Allow-Methods` / `-Headers` reply — without
  //      those the browser blocks the follow-up GET.
  const threadsPath = "/api/copilotkit/threads";
  const loggedListener: http.RequestListener = (req, res) => {
    opts.log(`[runtime-host] ${req.method} ${req.url}`);
    if (
      req.method !== "OPTIONS" &&
      req.url &&
      req.url.startsWith(threadsPath)
    ) {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      // CORS open — the runtime's createCopilotNodeListener uses cors:true,
      // we mirror its headers here so the browser accepts our short-circuit
      // response after a successful preflight.
      res.setHeader("access-control-allow-origin", "*");
      res.setHeader(
        "access-control-allow-headers",
        req.headers["access-control-request-headers"] ?? "*",
      );
      res.end(JSON.stringify({ threads: [], hasMore: false }));
      return;
    }
    return listener(req, res);
  };

  const server = http.createServer(loggedListener);

  const port: number = await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const addr = server.address();
      if (typeof addr === "object" && addr !== null) {
        resolve(addr.port);
      } else {
        reject(new Error("runtime-host: server.address() returned no port"));
      }
    });
  });

  const url = `http://127.0.0.1:${port}`;
  opts.log(`[runtime-host] listening at ${url}`);

  return {
    url,
    stop: () =>
      new Promise<void>((resolve) => {
        if (typeof server.closeAllConnections === "function") {
          server.closeAllConnections();
        }
        server.close(() => {
          opts.log(`[runtime-host] stopped`);
          resolve();
        });
      }),
    vscodeLmTools: {
      enabled: !!opts.enableVscodeLmTools,
      count: vscodeLmToolsSnapshot.length,
    },
  };
}

type FactoryFn = (ctx: {
  input: unknown;
  abortController: AbortController;
  abortSignal: AbortSignal;
}) => AsyncIterable<TanStackChunk>;

function makeFactory(
  opts: StartRuntimeHostOptions,
  vscodeLmTools: vscode.LanguageModelToolInformation[],
): FactoryFn {
  if (opts.mode === "live") {
    return vscodeLmFactory({
      model: opts.model,
      mode: "live",
      log: opts.log,
      vscodeLmTools,
    }) as FactoryFn;
  }
  if (opts.mode === "record") {
    if (!opts.onCallRecorded) {
      throw new Error("runtime-host: record mode requires onCallRecorded");
    }
    return vscodeLmFactory({
      model: opts.model,
      mode: "record",
      onCallRecorded: opts.onCallRecorded,
      log: opts.log,
      vscodeLmTools,
    }) as FactoryFn;
  }
  return vscodeLmFactory({
    model: opts.model,
    mode: "replay",
    fixtureCalls: opts.fixtureCalls ?? [],
    log: opts.log,
    vscodeLmTools,
  }) as FactoryFn;
}
