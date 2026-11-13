import type { Message, RunAgentInput } from "@ag-ui/client";
import { logger } from "@copilotkit/shared";
import { generateText } from "ai";
import { resolveModel } from "../../../../agent";
import type {
  CopilotIntelligenceRuntimeLike,
  ThreadNameGenerationConfig,
} from "../../core/runtime";
import type { ThreadSummary } from "../../intelligence-platform";

const THREAD_NAME_SYSTEM_PROMPT = [
  "You generate short, specific conversation titles.",
  'Return JSON only in this exact shape: {"title":"..."}',
  "The title must be 2 to 5 words.",
  "Use sentence case.",
  "No quotes.",
  "No emoji.",
  "No markdown characters or formatting.",
  "Do not use *, _, #, `, [, ], (, ), !, ~, >, or |.",
  "No trailing punctuation.",
  "No explanations.",
].join("\n");

const MAX_TITLE_LENGTH = 80;
const MAX_TITLE_WORDS = 8;
const MAX_TRANSCRIPT_MESSAGES = 8;
const TITLE_MODEL_TIMEOUT_MS = 15_000;
const FALLBACK_THREAD_TITLE = "Untitled";

interface GenerateThreadNameParams {
  runtime: CopilotIntelligenceRuntimeLike;
  agentId: string;
  sourceInput: RunAgentInput;
  thread: ThreadSummary;
  userId: string;
}

/**
 * Names a new thread. It never runs the app's agent: an agent keeps its own
 * server-side tools, so a "title" run can repeat the user's task and change
 * app data (#8375). With a configured model, the runtime makes one direct
 * model call with no tools. Otherwise, or if that call fails, the name is the
 * first user message.
 */
export async function generateThreadNameForNewThread({
  runtime,
  agentId,
  sourceInput,
  thread,
  userId,
}: GenerateThreadNameParams): Promise<void> {
  const config = runtime.generateThreadNames;
  if (!config || hasThreadName(thread.name)) {
    return;
  }

  const prompt = buildThreadTitlePrompt(sourceInput.messages);
  if (!prompt) {
    return;
  }

  let generatedTitle: string | null = null;
  if (typeof config === "object") {
    try {
      generatedTitle = await generateTitleWithModel(config, prompt);
      if (!generatedTitle) {
        logger.warn(
          { agentId, threadId: thread.id },
          "Thread name model returned an empty or invalid title",
        );
      }
    } catch (error) {
      logger.warn(
        { err: error, agentId, threadId: thread.id },
        "Thread name model call failed",
      );
    }
  }

  await runtime.intelligence.updateThread({
    threadId: thread.id,
    userId,
    agentId,
    updates: {
      name:
        generatedTitle ?? deriveFallbackTitleFromMessages(sourceInput.messages),
    },
  });
}

async function generateTitleWithModel(
  config: ThreadNameGenerationConfig,
  prompt: string,
): Promise<string | null> {
  const { text } = await generateText({
    model: resolveModel(config.model, config.apiKey),
    system: THREAD_NAME_SYSTEM_PROMPT,
    prompt,
    // No maxOutputTokens: a reasoning model (gpt-5-mini) spends a small cap
    // on reasoning and returns no text. The title is checked and cut anyway.
    // One call only: on any failure the first user message names the thread.
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(TITLE_MODEL_TIMEOUT_MS),
  });
  return normalizeGeneratedTitle(text);
}

function buildThreadTitlePrompt(
  messages: Message[] | undefined,
): string | null {
  const transcript = (messages ?? [])
    .filter((message) =>
      ["user", "assistant", "system", "developer"].includes(message.role),
    )
    .map((message) => {
      const content = stringifyMessageContent(message.content);
      if (!content) {
        return null;
      }

      return `${message.role}: ${content}`;
    })
    .filter((message): message is string => !!message)
    .slice(-MAX_TRANSCRIPT_MESSAGES);

  if (transcript.length === 0) {
    return null;
  }

  return [
    "Conversation:",
    transcript.join("\n"),
    'Generate a short title for the conversation above. Return JSON only in this exact shape: {"title":"..."}. Do not answer the conversation.',
  ].join("\n\n");
}

/**
 * Returns the text of a message. For content parts (a message with an
 * attachment), it keeps only the text parts: images, files, and other binary
 * parts never go into a title or a title prompt.
 */
function stringifyMessageContent(content: Message["content"]): string {
  if (typeof content === "string") {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part: unknown) =>
      typeof part === "object" &&
      part !== null &&
      (part as { type?: unknown }).type === "text" &&
      typeof (part as { text?: unknown }).text === "string"
        ? (part as { text: string }).text
        : "",
    )
    .join(" ")
    .trim();
}

function normalizeGeneratedTitle(rawTitle: string): string | null {
  let candidate = rawTitle.trim();
  if (!candidate) {
    return null;
  }

  candidate = candidate
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  const jsonLike = isJsonLike(candidate);

  try {
    const parsed = JSON.parse(candidate) as { title?: unknown };
    if (typeof parsed.title === "string") {
      candidate = parsed.title;
    } else if (jsonLike) {
      return null;
    }
  } catch {
    if (jsonLike) {
      return null;
    }
  }

  candidate = cleanupTitleText(candidate);

  if (!candidate) {
    return null;
  }

  if (candidate.length > MAX_TITLE_LENGTH) {
    candidate = candidate.slice(0, MAX_TITLE_LENGTH).trim();
  }

  if (candidate.split(/\s+/).length > MAX_TITLE_WORDS) {
    return null;
  }

  return candidate;
}

function cleanupTitleText(text: string): string {
  return text
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/[*_#[\]()!~>|]+/g, "")
    .replace(/[.!?,;:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function deriveFallbackTitleFromMessages(
  messages: Message[] | undefined,
): string {
  for (const message of messages ?? []) {
    if (message.role !== "user") {
      continue;
    }

    const cleaned = cleanupTitleText(stringifyMessageContent(message.content));
    if (!cleaned) {
      continue;
    }

    let title = cleaned.split(/\s+/).slice(0, MAX_TITLE_WORDS).join(" ");
    if (title.length > MAX_TITLE_LENGTH) {
      title = title.slice(0, MAX_TITLE_LENGTH).trim();
    }

    return title || FALLBACK_THREAD_TITLE;
  }

  return FALLBACK_THREAD_TITLE;
}

function isJsonLike(candidate: string): boolean {
  return (
    (candidate.startsWith("{") && candidate.endsWith("}")) ||
    (candidate.startsWith("[") && candidate.endsWith("]"))
  );
}

function hasThreadName(name: string | null | undefined): boolean {
  return typeof name === "string" && name.trim().length > 0;
}

/** @internal Exported for testing only. */
export const ɵnormalizeGeneratedTitle = normalizeGeneratedTitle;
/** @internal Exported for testing only. */
export const ɵbuildThreadTitlePrompt = buildThreadTitlePrompt;
/** @internal Exported for testing only. */
export const ɵhasThreadName = hasThreadName;
/** @internal Exported for testing only. */
export const ɵderiveFallbackTitleFromMessages = deriveFallbackTitleFromMessages;
