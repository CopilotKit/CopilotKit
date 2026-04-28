import * as http from "node:http";
import type { LanguageModelChat } from "vscode";
import {
  vscodeLmFactory,
  type RecordedCall,
  type TanStackChunk,
} from "./vscode-lm-factory";

export interface RuntimeHostHandle {
  url: string;
  stop(): Promise<void>;
}

export interface StartRuntimeHostOptions {
  model: LanguageModelChat;
  mode: "live" | "record" | "replay";
  fixtureCalls?: RecordedCall[];
  onCallRecorded?: (call: RecordedCall) => void;
  log: (line: string) => void;
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

  const factory = makeFactory(opts);
  const agent = new BuiltInAgent({ type: "tanstack", factory });
  const runtime = new CopilotSseRuntime({ agents: { default: agent } });

  const listener = createCopilotNodeListener({
    runtime,
    basePath: "/api/copilotkit",
    cors: true,
  });

  const server = http.createServer(listener);

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
  };
}

type FactoryFn = (ctx: {
  input: unknown;
  abortController: AbortController;
  abortSignal: AbortSignal;
}) => AsyncIterable<TanStackChunk>;

function makeFactory(opts: StartRuntimeHostOptions): FactoryFn {
  if (opts.mode === "live") {
    return vscodeLmFactory({ model: opts.model, mode: "live" }) as FactoryFn;
  }
  if (opts.mode === "record") {
    if (!opts.onCallRecorded) {
      throw new Error("runtime-host: record mode requires onCallRecorded");
    }
    return vscodeLmFactory({
      model: opts.model,
      mode: "record",
      onCallRecorded: opts.onCallRecorded,
    }) as FactoryFn;
  }
  // replay
  return vscodeLmFactory({
    model: opts.model,
    mode: "replay",
    fixtureCalls: opts.fixtureCalls ?? [],
  }) as FactoryFn;
}
