import type { Message, RunAgentInput } from "@ag-ui/client";
import { AbstractAgent } from "@ag-ui/client";
import { logger } from "@copilotkit/shared";
import { randomUUID } from "node:crypto";
import type { CopilotIntelligenceRuntimeLike } from "../../core/runtime";
import {
  cloneAgentForRequest,
  configureAgentForRequest,
} from "../shared/agent-utils";
import type { ThreadSummary } from "../../intelligence-platform";
import { isHandlerResponse } from "../shared/json-response";

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
  "Do not call tools.",
].join("\n");

const MAX_TITLE_LENGTH = 80;
const MAX_TITLE_WORDS = 8;
const MAX_TRANSCRIPT_MESSAGES = 8;
const MAX_TITLE_GENERATION_ATTEMPTS = 3;
const FALLBACK_THREAD_TITLE = "Untitled";

interface GenerateThreadNameParams {
  runtime: CopilotIntelligenceRuntimeLike;
  request: Request;
  agentId: string;
  sourceInput: RunAgentInput;
  thread: ThreadSummary;
  userId: string;
}

export async function generateThreadNameForNewThread({
  runtime,
  request,
  agentId,
  sourceInput,
  thread,
  userId,
}: GenerateThreadNameParams): Promise<void> {
  if (!runtime.generateThreadNames || hasThreadName(thread.name)) {
    return;
  }

  const prompt = buildThreadTitlePrompt(sourceInput.messages);
  if (!prompt) {
    return;
  }

  let generatedTitle: string | null = null;

  for (let attempt = 1; attempt <= MAX_TITLE_GENERATION_ATTEMPTS; attempt++) {
    try {
      generatedTitle = await runTitleGenerationAttempt({
        runtime,
        request,
        agentId,
        threadId: thread.id,
        prompt,
      });

      if (generatedTitle) {
        break;
      }

      logger.warn(
        { agentId, attempt, threadId: thread.id },
        "Thread name generation returned an empty or invalid title",
      );
    } catch (error) {
      logger.warn(
        { err: error, agentId, attempt, threadId: thread.id },
        "Thread name generation attempt failed",
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

async function runTitleGenerationAttempt(params: {
  runtime: CopilotIntelligenceRuntimeLike;
  request: Request;
  agentId: string;
  threadId: string;
  prompt: string;
}): Promise<string | null> {
  const { runtime, request, agentId, threadId, prompt } = params;
  const agent = await cloneAgentForRequest(runtime, agentId, request);
  if (isHandlerResponse(agent)) {
    logger.warn(
      { agentId, threadId },
      "Skipping thread naming because the agent could not be cloned",
    );
    return null;
  }

  configureAgentForRequest({
    runtime,
    request,
    agentId,
    agent,
  });

  const messages: Message[] = [
    {
      id: randomUUID(),
      role: "system",
      content: THREAD_NAME_SYSTEM_PROMPT,
    },
    {
      id: randomUUID(),
      role: "user",
      content: prompt,
    },
  ];

  agent.setMessages(messages);
  agent.setState({});
  agent.threadId = randomUUID();
  // Messages and state are picked up from the agent itself (set above);
  // RunAgentParameters no longer accepts them directly.
  const { newMessages } = await agent.runAgent({
    tools: [],
    context: [],
    forwardedProps: {},
  });

  return selectGeneratedTitleFromMessages(newMessages);
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
    "Generate a short title for this conversation.",
    "Conversation:",
    transcript.join("\n"),
  ].join("\n\n");
}

function stringifyMessageContent(content: Message["content"]): string {
  if (typeof content === "string") {
    return content.trim();
  }

  if (content == null) {
    return "";
  }

  try {
    return JSON.stringify(content).trim();
  } catch {
    return "";
  }
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

/**
 * Strips the markdown, surrounding quotes and trailing punctuation that an LLM
 * tends to wrap a title in, then collapses internal whitespace. Shared by both
 * the LLM-title normalizer and the first-user-message fallback so the two paths
 * clean text identically.
 *
 * @param text - Raw candidate title text.
 * @returns The cleaned text (may be empty if everything was stripped).
 */
function cleanupTitleText(text: string): string {
  return text
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/[*_#[\]()!~>|]+/g, "")
    .replace(/[.!?,;:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Derives a short, human-readable thread title from the first user message when
 * LLM title generation could not produce a valid title (for example when the
 * runtime is pointed at a mock LLM whose catch-all reply is not a title). Reuses
 * the same text cleanup as the LLM-title normalizer, then bounds the result to
 * {@link MAX_TITLE_WORDS} words and {@link MAX_TITLE_LENGTH} characters so the
 * fallback reads like a title rather than a sentence fragment.
 *
 * @param messages - The source conversation messages, if any.
 * @returns A derived short title, or {@link FALLBACK_THREAD_TITLE} when there is
 *   no usable user message.
 */
function deriveFallbackTitleFromMessages(
  messages: Message[] | undefined,
): string {
  const firstUserMessage = (messages ?? []).find(
    (message) =>
      message.role === "user" &&
      stringifyMessageContent(message.content).length > 0,
  );

  if (!firstUserMessage) {
    return FALLBACK_THREAD_TITLE;
  }

  const cleaned = cleanupTitleText(
    stringifyMessageContent(firstUserMessage.content),
  );

  if (!cleaned) {
    return FALLBACK_THREAD_TITLE;
  }

  let title = cleaned;

  const words = title.split(/\s+/);
  if (words.length > MAX_TITLE_WORDS) {
    title = words.slice(0, MAX_TITLE_WORDS).join(" ");
  }

  if (title.length > MAX_TITLE_LENGTH) {
    title = title.slice(0, MAX_TITLE_LENGTH).trim();
  }

  return title || FALLBACK_THREAD_TITLE;
}

function selectGeneratedTitleFromMessages(messages: Message[]): string | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role !== "assistant" || typeof message.content !== "string") {
      continue;
    }

    const title = normalizeGeneratedTitle(message.content);
    if (title) {
      return title;
    }
  }

  return null;
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
export const ɵselectGeneratedTitleFromMessages =
  selectGeneratedTitleFromMessages;
/** @internal Exported for testing only. */
export const ɵbuildThreadTitlePrompt = buildThreadTitlePrompt;
/** @internal Exported for testing only. */
export const ɵhasThreadName = hasThreadName;
/** @internal Exported for testing only. */
export const ɵderiveFallbackTitleFromMessages = deriveFallbackTitleFromMessages;
