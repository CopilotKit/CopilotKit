import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin, ViteDevServer } from "vite";
import {
  isLearningLabState,
  LEARNING_LAB_BASE_PATH,
  learningRuntimeInfo,
  learningSnapshotForState,
} from "./learning-state-fixtures.js";

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });

async function singleRouteEnvelope(request: Request): Promise<{
  method?: string;
  params?: Record<string, unknown>;
}> {
  try {
    const value: unknown = await request.json();
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return {};
    }
    const envelope = value as Record<string, unknown>;
    return {
      method: typeof envelope.method === "string" ? envelope.method : undefined,
      params:
        typeof envelope.params === "object" &&
        envelope.params !== null &&
        !Array.isArray(envelope.params)
          ? (envelope.params as Record<string, unknown>)
          : undefined,
    };
  } catch {
    return {};
  }
}

/** Deterministic local Runtime used by the real Core and Inspector shell. */
export async function handleLearningStateLabRequest(
  request: Request,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const parts = url.pathname
    .slice(LEARNING_LAB_BASE_PATH.length)
    .split("/")
    .filter(Boolean);
  const [stateValue, route] = parts;
  if (!stateValue || !isLearningLabState(stateValue)) return undefined;

  let method = route;
  let params: Record<string, unknown> = Object.fromEntries(url.searchParams);
  if (request.method === "POST" && route === undefined) {
    const envelope = await singleRouteEnvelope(request);
    method = envelope.method;
    params = envelope.params ?? {};
  }

  if (method === "info") return json(learningRuntimeInfo(stateValue));
  if (method !== "inspector-learning" && method !== "inspector/learning") {
    return json({ error: "Not found" }, 404);
  }
  if (stateValue === "unsupported") return json({ error: "Not found" }, 404);
  if (stateValue === "data-error") {
    return json(
      { error: "Inspector Learning is temporarily unavailable" },
      503,
    );
  }
  if (stateValue === "loading") {
    return new Promise<Response>(() => undefined);
  }

  const numberParam = (name: string): number | undefined => {
    const value = params[name];
    const parsed = typeof value === "string" ? Number(value) : undefined;
    return Number.isSafeInteger(parsed) && parsed! > 0 ? parsed : undefined;
  };
  return json(
    learningSnapshotForState(stateValue, {
      skillsPage: numberParam("skillsPage"),
      insightsPage: numberParam("insightsPage"),
    }),
  );
}

async function readBody(
  request: IncomingMessage,
): Promise<Uint8Array | undefined> {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function writeResponse(response: Response, target: ServerResponse) {
  target.statusCode = response.status;
  response.headers.forEach((value, name) => target.setHeader(name, value));
  target.end(Buffer.from(await response.arrayBuffer()));
}

export type LearningStateLabPlugin = Plugin &
  Readonly<{
    name: "web-inspector-learning-state-lab";
    transform?: never;
  }>;

export function createLearningStateLabPlugin(): LearningStateLabPlugin {
  return {
    name: "web-inspector-learning-state-lab" as const,
    configureServer(server: ViteDevServer) {
      server.middlewares.use((request, response, next) => {
        const host = request.headers.host ?? "127.0.0.1";
        const url = new URL(request.url ?? "/", `http://${host}`);
        if (
          url.pathname !== LEARNING_LAB_BASE_PATH &&
          !url.pathname.startsWith(`${LEARNING_LAB_BASE_PATH}/`)
        ) {
          next();
          return;
        }
        void (async () => {
          const body = await readBody(request);
          const labResponse = await handleLearningStateLabRequest(
            new Request(url, {
              method: request.method,
              headers: request.headers as HeadersInit,
              body,
            }),
          );
          await writeResponse(
            labResponse ?? json({ error: "Not found" }, 404),
            response,
          );
        })().catch((error: unknown) => {
          response.statusCode = 500;
          response.end(
            JSON.stringify({
              error: error instanceof Error ? error.message : "Lab failed",
            }),
          );
        });
      });
    },
  };
}
