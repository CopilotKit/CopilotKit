import type { SharedStateStreamingConfig } from "@/app/demos/[integration]/shared-state-streaming/config";

// Spring AI 1.0.1 merges the streamed tool-call arguments before the agent
// sees them, so the document reaches state in one piece, not token by token.
export default {
  unsupportedNotice:
    "Progressive document streaming is unsupported with Spring AI 1.0.1.",
} satisfies SharedStateStreamingConfig;
