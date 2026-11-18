import type { Express, Request, RequestHandler } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { isIP } from "node:net";

export const DEMO_RUN_ROUTE = "/api/copilotkit/agent/financial-assistant/run";

export const PER_IP_LIMIT_MESSAGE =
  "Too many demo interactions. Please try again shortly.";
export const GLOBAL_LIMIT_MESSAGE =
  "This public demo has reached its interaction limit. Please try again later.";

const COPILOTKIT_BASE_PATH = "/api/copilotkit";
const DEFAULT_PER_IP_LIMIT = 20;
const DEFAULT_GLOBAL_LIMIT = 2_000;
const UNKNOWN_RAILWAY_CLIENT_KEY = "railway-client:unknown";

interface DemoRunLimitOptions {
  perIpLimit?: number;
  perIpWindowMs?: number;
  globalLimit?: number;
  globalWindowMs?: number;
  railwayEnvironmentId?: string;
}

function requestPath(request: Request) {
  return request.originalUrl.split("?", 1)[0] ?? request.originalUrl;
}

// CopilotKit 1.65.0 matches agent routes from the end after removing empty
// segments. Mirror that small rule so aliases cannot bypass the limiter.
function providerOperation(request: Request): "run" | "suggest" | undefined {
  const path = requestPath(request);
  if (!path.startsWith(COPILOTKIT_BASE_PATH)) return undefined;

  const afterBase = path.slice(COPILOTKIT_BASE_PATH.length);
  if (afterBase && !afterBase.startsWith("/")) return undefined;

  const segments = afterBase.split("/").filter(Boolean);
  if (segments.length < 3 || segments.at(-3) !== "agent") return undefined;

  const operation = segments.at(-1);
  return operation === "run" || operation === "suggest" ? operation : undefined;
}

function clientKey(request: Request, railway: boolean) {
  if (!railway) {
    return `direct-client:${ipKeyGenerator(request.ip ?? "unknown")}`;
  }

  const header = request.headers["x-real-ip"];
  const ip = typeof header === "string" ? header.trim() : "";
  return isIP(ip)
    ? `railway-client:${ipKeyGenerator(ip)}`
    : UNKNOWN_RAILWAY_CLIENT_KEY;
}

export function configureDemoRunLimits(
  app: Express,
  bodyParser: RequestHandler,
  options: DemoRunLimitOptions = {},
) {
  const railway = Boolean(
    options.railwayEnvironmentId ?? process.env.RAILWAY_ENVIRONMENT_ID,
  );
  const perIpLimiter = rateLimit({
    windowMs: options.perIpWindowMs ?? 60_000,
    limit: options.perIpLimit ?? DEFAULT_PER_IP_LIMIT,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    identifier: "demo-per-ip",
    keyGenerator: (request) => clientKey(request, railway),
    message: { error: PER_IP_LIMIT_MESSAGE },
  });
  const globalLimiter = rateLimit({
    windowMs: options.globalWindowMs ?? 24 * 60 * 60 * 1_000,
    limit: options.globalLimit ?? DEFAULT_GLOBAL_LIMIT,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    identifier: "demo-global",
    keyGenerator: () => "global",
    skipFailedRequests: true,
    message: { error: GLOBAL_LIMIT_MESSAGE },
  });

  app.use((request, response, next) => {
    if (request.method !== "POST" || !providerOperation(request)) {
      next();
      return;
    }

    perIpLimiter(request, response, (error?: unknown) => {
      if (error) return next(error);

      const path = requestPath(request);
      if (path !== DEMO_RUN_ROUTE && path !== `${DEMO_RUN_ROUTE}/`) {
        response.status(404).json({ error: "Not found" });
        return;
      }
      next();
    });
  });

  // The abuse gate runs first; parsing failures never consume global quota.
  app.use(COPILOTKIT_BASE_PATH, bodyParser);
  app.post(DEMO_RUN_ROUTE, globalLimiter);
}
