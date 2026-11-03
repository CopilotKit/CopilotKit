import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
  type CopilotRuntimeHooks,
} from "@copilotkit/runtime/v2";
import { createDocsAgent } from "@/lib/docs-agent";
import { createRateLimit } from "@/lib/rate-limit";

// What the docs' chats send: `info` to connect, `agent/run` to ask, and
// `agent/connect` and `agent/stop` on the chat's own thread. The rest of the
// runtime is turned away, above all the thread endpoints behind
// `resource/request`: readers don't sign in, so every thread in the
// in-memory runner would be open to anyone.
const ALLOWED_METHODS = new Set([
  "info",
  "agent/run",
  "agent/connect",
  "agent/stop",
]);

// The frontend tools the chats register: open_page and set_stack
// (components/ai/docs-agent.tsx), ask_quickstart_setup
// (components/ask/quickstart-setup.tsx). The runtime adds render_ui itself.
const FRONTEND_TOOLS = new Set([
  "open_page",
  "set_stack",
  "ask_quickstart_setup",
]);

// Agent runs per reader IP. A question can take two runs when the agent
// opens a page or switches the stack and then follows up.
const perMinute = createRateLimit({ limit: 10, windowMs: 60_000 });
const perHour = createRateLimit({ limit: 60, windowMs: 60 * 60_000 });
// Agent runs across all readers, so many IPs together can't run up the bill.
// Each server instance keeps its own count.
const everyonePerMinute = createRateLimit({ limit: 60, windowMs: 60_000 });
const everyonePerDay = createRateLimit({
  limit: 5_000,
  windowMs: 24 * 60 * 60_000,
});

// Sizes in characters of JSON. Context, state, tools and the generative UI
// catalog (in forwardedProps) all land in the model's prompt, so each gets a
// cap well above what the chats send.
// The whole request but its images: the conversation so far (with the pages
// the agent read), page context, tools, and the catalog.
const MAX_REQUEST_CHARS = 300_000;
const MAX_QUESTION_CHARS = 2_000;
// The page, the stack, and the sidebar's pages: under 20K on the longest
// sidebar.
const MAX_CONTEXT_CHARS = 50_000;
const MAX_CONTEXT_ENTRIES = 6;
// The frontend tools: about 2K.
const MAX_TOOLS_CHARS = 8_000;
// The docs agent keeps no state; this leaves room for a little, should the
// model write some.
const MAX_STATE_CHARS = 2_000;
// /ask's generative UI catalog: about 80K. The side chat sends none.
const MAX_FORWARDED_PROPS_CHARS = 120_000;
// Images (screenshots of an error or a UI) ride inline as base64, so they get
// their own budget across the conversation: about 6MB of images, 4 at most.
const MAX_ATTACHMENT_CHARS = 8_000_000;
const MAX_ATTACHMENTS = 4;

function reject(status: number, message: string, headers?: HeadersInit) {
  return Response.json({ error: message }, { status, headers });
}

/**
 * The reader's IP, from the X-Real-IP header Railway's edge sets.
 * X-Forwarded-For is whatever the client sent, so it isn't read.
 */
function clientIp(request: Request) {
  return request.headers.get("x-real-ip") ?? "unknown";
}

interface Envelope {
  body?: {
    messages?: { role?: string; content?: unknown }[];
    context?: unknown;
    state?: unknown;
    tools?: { name?: unknown }[];
    forwardedProps?: unknown;
  };
}

const sizeOf = (value: unknown) => JSON.stringify(value ?? null).length;

type Part = { type?: string; text?: string };

/** A message's typed text, without its attachments. */
function textOf(content: unknown) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return (content as Part[])
      .filter((p) => p?.type === "text")
      .map((p) => p.text ?? "")
      .join("");
  }
  return JSON.stringify(content ?? "");
}

/** The attachments (every non-text part) across the conversation. */
function attachmentsIn(messages: NonNullable<Envelope["body"]>["messages"]) {
  let count = 0;
  let chars = 0;
  for (const m of messages ?? []) {
    if (!Array.isArray(m.content)) continue;
    for (const part of m.content as Part[]) {
      if (part?.type === "text") continue;
      count++;
      chars += JSON.stringify(part).length;
    }
  }
  return { count, chars };
}

/**
 * Why a run's context, state, tools or catalog aren't what the chats send,
 * as a status and a message; null when they are.
 */
function inputProblem(body: Envelope["body"]): [number, string] | null {
  const context = body?.context;
  if (
    (Array.isArray(context) && context.length > MAX_CONTEXT_ENTRIES) ||
    sizeOf(context) > MAX_CONTEXT_CHARS
  ) {
    return [413, "The page context is too large."];
  }
  if (sizeOf(body?.state) > MAX_STATE_CHARS) {
    return [413, "The chat state is too large."];
  }
  const tools = body?.tools ?? [];
  if (
    !Array.isArray(tools) ||
    tools.some((t) => !FRONTEND_TOOLS.has(t?.name as string))
  ) {
    return [400, "This chat only takes the docs' own tools."];
  }
  if (sizeOf(tools) > MAX_TOOLS_CHARS) {
    return [413, "The tools are too large."];
  }
  if (sizeOf(body?.forwardedProps) > MAX_FORWARDED_PROPS_CHARS) {
    return [413, "The request is too large."];
  }
  return null;
}

const guard: CopilotRuntimeHooks["onBeforeHandler"] = async ({
  request,
  route,
}) => {
  if (!ALLOWED_METHODS.has(route.method)) throw reject(404, "Not found");
  if (route.method !== "agent/run") return;

  for (const limit of [perMinute, perHour]) {
    const result = limit(clientIp(request));
    if (!result.ok) {
      throw reject(429, "Too many questions. Try again in a moment.", {
        "Retry-After": String(result.retryAfter),
      });
    }
  }

  const raw = await request.clone().text();
  if (raw.length > MAX_REQUEST_CHARS + MAX_ATTACHMENT_CHARS) {
    throw reject(413, "This chat is too long. Start a new chat to keep going.");
  }

  const { body } = JSON.parse(raw) as Envelope;
  const attachments = attachmentsIn(body?.messages);
  if (
    attachments.count > MAX_ATTACHMENTS ||
    attachments.chars > MAX_ATTACHMENT_CHARS
  ) {
    throw reject(
      413,
      "That's too many images for one chat. Start a new chat to add more.",
    );
  }
  if (raw.length - attachments.chars > MAX_REQUEST_CHARS) {
    throw reject(413, "This chat is too long. Start a new chat to keep going.");
  }

  const question = body?.messages?.findLast((m) => m.role === "user")?.content;
  const length = textOf(question).length;
  if (length > MAX_QUESTION_CHARS) {
    throw reject(413, `Keep questions under ${MAX_QUESTION_CHARS} characters.`);
  }

  const problem = inputProblem(body);
  if (problem) throw reject(...problem);

  // Counted last, so rejected requests don't use up everyone's runs.
  for (const limit of [everyonePerMinute, everyonePerDay]) {
    const result = limit("everyone");
    if (!result.ok) {
      throw reject(429, "Ask CopilotKit is busy. Try again later.", {
        "Retry-After": String(result.retryAfter),
      });
    }
  }
};

const runtime = new CopilotRuntime({
  agents: { default: createDocsAgent() },
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
  mode: "single-route",
  hooks: { onBeforeHandler: guard },
});

export const POST = (request: Request) => handler(request);
