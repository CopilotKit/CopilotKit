import {
  BuiltInAgent,
  CopilotRuntime,
  createCopilotRuntimeHandler,
  defineTool,
} from "@copilotkit/runtime/v2";
import { z } from "zod";
import { getArcadeUserId, runArcadeTool } from "@/lib/arcade";
import type { ArcadeToolResult } from "@/lib/arcade";

/**
 * Keep the model-facing payload small. The agent re-sends every tool result on
 * each step of the maxSteps loop, so returning dozens of full email bodies (or
 * every news story) burns the context window fast. We project the output down to
 * what the model actually needs; the credentials and full data still never leave
 * the server.
 */
function slimOutput(
  result: ArcadeToolResult,
  transform: (output: unknown) => unknown,
): ArcadeToolResult {
  if (
    "authorizationRequired" in result &&
    result.authorizationRequired === false
  ) {
    return { ...result, output: transform(result.output) };
  }
  return result;
}

/**
 * Tools are built per request so each `execute` runs against the *current* user's
 * id (see resolveArcadeUserId). Each tool is a thin wrapper around an Arcade tool:
 * `runArcadeTool` authorizes the user (if needed) and runs the tool with their
 * vaulted credentials, and the agent never sees a token.
 *
 * Tool descriptions carry *semantics* (what the tool does), not the auth control
 * flow. The agent learns the Connect-then-retry protocol from the system prompt
 * and the tool's result. Param names mirror the Arcade tool's own schema, or
 * unknown params are silently dropped.
 */
function buildTools(userId: string) {
  const searchNews = defineTool({
    name: "searchNews",
    description: "Search recent news stories by keyword using Google News.",
    parameters: z.object({
      keywords: z
        .string()
        .describe("Search keywords, e.g. 'open source AI agents'"),
    }),
    execute: async ({ keywords }) => {
      const result = await runArcadeTool({
        toolName: "GoogleNews.SearchNewsStories",
        input: { keywords },
        userId,
      });
      // Cap the stories handed to the model (the tool can return many).
      return slimOutput(result, (out) => {
        const stories = (out as { news_results?: unknown[] } | null)
          ?.news_results;
        return Array.isArray(stories)
          ? { news_results: stories.slice(0, 6) }
          : out;
      });
    },
  });

  const sendEmail = defineTool({
    name: "sendEmail",
    description: "Send an email from the user's connected Gmail account.",
    parameters: z.object({
      recipient: z.string().describe("Recipient email address"),
      subject: z.string().describe("Subject line"),
      body: z.string().describe("Plain-text body of the email"),
    }),
    execute: async ({ recipient, subject, body }) =>
      runArcadeTool({
        toolName: "Gmail.SendEmail",
        input: { recipient, subject, body },
        userId,
      }),
  });

  const listEmails = defineTool({
    name: "listEmails",
    description: "List recent emails from the user's connected Gmail inbox.",
    // Param name mirrors the Arcade tool's schema (Gmail.ListEmails takes
    // `n_emails`, 1-100). An unknown param would be silently dropped, so this is verified
    // against the live tool, see https://docs.arcade.dev/toolkits.
    parameters: z.object({
      n_emails: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(10)
        .describe("How many recent emails to return (1-50)"),
    }),
    execute: async ({ n_emails }) => {
      const result = await runArcadeTool({
        toolName: "Gmail.ListEmails",
        input: { n_emails },
        userId,
      });
      // Project each email to the few fields the model and cards need, instead of
      // returning full message bodies.
      return slimOutput(result, (out) => {
        const emails = (out as { emails?: unknown[] } | null)?.emails;
        if (!Array.isArray(emails)) return out;
        return {
          emails: emails.map((e) => {
            const m = (e ?? {}) as Record<string, unknown>;
            return {
              subject: m.subject,
              from: m.from ?? m.sender,
              snippet: m.snippet,
              date: m.date,
            };
          }),
        };
      });
    },
  });

  return [searchNews, sendEmail, listEmails];
}

const SYSTEM_PROMPT = `You are a helpful assistant that can take real actions for the user through Arcade-powered tools: searching Google News, and reading and sending Gmail.

Authorization flow, read carefully:
- Some tools need a one-time OAuth connection. When a tool result is { "authorizationRequired": true, ... }, the chat shows the user a "Connect" card. Do NOT call the tool again right away and do NOT invent a result. In one short sentence, tell the user to click Connect to authorize, then come back and tell you to continue.
- When the user says they've connected (or asks you to try again), call the SAME tool again with the SAME arguments. It will now run.

Other guidance:
- Before sending an email, briefly confirm the recipient, subject, and a one-line summary of the body.
- Keep your text replies to one or two short sentences. The tool cards in the chat already show the details.
- If a tool result contains an "error", explain it plainly and suggest a next step.`;

function buildAgent(userId: string) {
  // Fail with a readable message instead of a cryptic provider 401 / Arcade
  // construction error when keys are missing on a fresh clone.
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY is not set. Add it to .env.local (see .env.example).",
    );
  }
  if (!process.env.ARCADE_API_KEY) {
    throw new Error(
      "ARCADE_API_KEY is not set. Add it to .env.local (see .env.example).",
    );
  }
  return new BuiltInAgent({
    model: process.env.OPENAI_MODEL || "openai/gpt-4o",
    apiKey: process.env.OPENAI_API_KEY,
    prompt: SYSTEM_PROMPT,
    tools: buildTools(userId),
    // maxSteps must be > 1 so the agent can call a tool and THEN respond with
    // the result (and chain tools, e.g. search news -> send an email).
    maxSteps: 6,
  });
}

/**
 * Resolve the Arcade user id for THIS request. Every tool call is scoped to it,
 * so it must identify the real end user. Otherwise all visitors share one Arcade
 * token vault (e.g. a single connected Gmail), which is cross-account access.
 *
 * In production, derive it from a SERVER-VERIFIED session (a validated cookie/JWT):
 *
 *   const { userId } = await verifySession(request);
 *   return userId;
 *
 * NEVER trust a raw client header for identity in production, because headers are
 * spoofable. This demo has no auth system, so it falls back to the env id (which
 * throws in production if unset). The header path below is gated behind an
 * explicit opt-in for local experimentation only.
 */
function resolveArcadeUserId(request: Request): string {
  if (process.env.ARCADE_ALLOW_HEADER_USER_ID === "true") {
    const headerId = request.headers.get("x-arcade-user-id");
    if (headerId) return headerId;
  }
  return getArcadeUserId();
}

/**
 * Auth gate for the agent runtime. The runtime can read and send email on YOUR
 * keys, so it must NOT be reachable unauthenticated in production.
 *
 * Replace this with your real session check. The production-correct shape is:
 *
 *   const session = await verifySession(request); // validate cookie/JWT
 *   if (!session) throw new Response("Unauthorized", { status: 401 });
 *
 * This fails CLOSED in production (mirroring getArcadeUserId): if no real auth is
 * wired, it returns 503 rather than serving an open mail endpoint. A bearer token
 * (COPILOTKIT_RUNTIME_TOKEN) is offered only as a server-to-server option, so don't
 * rely on it for a browser app, where the token would ship in the bundle.
 */
function authorizeRuntimeRequest(request: Request): void {
  const requiredToken = process.env.COPILOTKIT_RUNTIME_TOKEN;
  if (requiredToken) {
    if (request.headers.get("authorization") !== `Bearer ${requiredToken}`) {
      throw new Response("Unauthorized", { status: 401 });
    }
    return;
  }
  // No auth configured: fine for local dev, never for a public production deploy.
  if (process.env.NODE_ENV === "production") {
    throw new Response(
      "Runtime auth is not configured. Wire authorizeRuntimeRequest to your session " +
        "auth (or set COPILOTKIT_RUNTIME_TOKEN) before deploying.",
      { status: 503 },
    );
  }
}

const runtime = new CopilotRuntime({
  // Per-request factory → a fresh agent scoped to the resolved user id (and it
  // avoids the "agent is already running" error on overlapping messages).
  agents: ({ request }) => ({
    default: buildAgent(resolveArcadeUserId(request)),
  }),
});

// Single-route transport: CopilotKit's provider defaults to `useSingleEndpoint`,
// so the client POSTs every call as a `{ method, params, body }` envelope to this
// one base path, so we mount a single-route handler to match. `<CopilotKit>` pairs
// with `useSingleEndpoint` in app/providers.tsx. `createCopilotRuntimeHandler` is
// CopilotKit's preferred primitive, not the deprecated `createCopilotEndpointSingleRoute`.
const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
  mode: "single-route",
  hooks: {
    // Runs before routing; throw a Response to short-circuit unauthorized calls.
    onRequest: ({ request }) => {
      authorizeRuntimeRequest(request);
    },
  },
});

export const GET = handler;
export const POST = handler;
export const OPTIONS = handler;
