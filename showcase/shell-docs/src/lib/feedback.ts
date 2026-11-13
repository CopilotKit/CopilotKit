"use server";

import { z } from "zod";
import {
  pageFeedback,
  type ActionResponse,
  type PageFeedback,
} from "@/components/feedback/schema";

/**
 * Receives Fumadocs' page feedback (src/components/feedback). Anyone can call
 * a server action with any input, so it's validated first. Not stored yet:
 * GitHub Discussions or analytics plug in here
 * (https://www.fumadocs.dev/docs/integrations/feedback).
 */
export async function sendPageFeedback(
  input: PageFeedback,
): Promise<ActionResponse> {
  const feedback = pageFeedback.parse(input);
  console.info(
    "[docs feedback]",
    feedback.opinion,
    feedback.url,
    feedback.message.slice(0, 1000),
  );
  return {};
}

const answerFeedback = z.object({
  rating: z.enum(["up", "down"]),
  messageId: z.string().max(200),
  url: z.string().max(500),
  question: z.string().max(2_000),
  answer: z.string().max(8_000),
});

/**
 * Receives a thumbs up or down on an Ask CopilotKit answer, with the question
 * and the answer it rates. Validated like page feedback; only logged for now.
 */
export async function sendAnswerFeedback(
  input: z.input<typeof answerFeedback>,
): Promise<void> {
  const feedback = answerFeedback.parse(input);
  console.info(
    "[ask copilotkit feedback]",
    feedback.rating,
    feedback.url,
    JSON.stringify({
      messageId: feedback.messageId,
      question: feedback.question.slice(0, 500),
      answer: feedback.answer.slice(0, 1000),
    }),
  );
}
