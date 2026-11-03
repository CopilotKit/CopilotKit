import {
  createStreamingMarkdownParserState,
  parseStreamingMarkdownChunk,
} from "@copilotkit/markdown";
import type { StreamingMarkdownParserOptions } from "@copilotkit/markdown";

export function parse(text: string, options: StreamingMarkdownParserOptions) {
  return parseStreamingMarkdownChunk(
    createStreamingMarkdownParserState(options),
    text,
  );
}
