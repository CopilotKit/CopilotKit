import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
  type CopilotRuntimeHooks,
} from "@copilotkit/runtime/v2";
import { createDocsAgent } from "@/lib/docs-agent";
import { createRateLimit } from "@/lib/rate-limit";

// Agent runs per reader IP. A question can take two runs when the agent
// opens a page or switches the stack and then follows up.
const perMinute = createRateLimit({ limit: 10, windowMs: 60_000 });
const perHour = createRateLimit({ limit: 60, windowMs: 60 * 60_000 });

// The whole request: the conversation so far, page context, and tools.
const MAX_REQUEST_CHARS = 300_000;
const MAX_QUESTION_CHARS = 2_000;
// Images (screenshots of an error or a UI) ride inline as base64, so they get
// their own budget across the conversation: about 6MB of images, 4 at most.
const MAX_ATTACHMENT_CHARS = 8_000_000;
const MAX_ATTACHMENTS = 4;

function reject(status: number, message: string, headers?: HeadersInit) {
  return Response.json({ error: message }, { status, headers });
}

function clientIp(request: Request) {
  return (
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

interface Envelope {
  body?: { messages?: { role?: string; content?: unknown }[] };
}

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

const guard: CopilotRuntimeHooks["onBeforeHandler"] = async ({
  request,
  route,
}) => {
  if (route.method !== "agent/run" && route.method !== "agent/suggest") return;

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
