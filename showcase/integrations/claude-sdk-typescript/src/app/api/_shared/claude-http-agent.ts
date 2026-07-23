import { HttpAgent } from "@ag-ui/client";

const AIMOCK_CONTEXT = "claude-sdk-typescript";

function shouldAttachAimockContext(): boolean {
  return [process.env.ANTHROPIC_BASE_URL, process.env.AIMOCK_URL].some(
    (value) => value?.includes("aimock"),
  );
}

export function claudeHttpAgentConfig(url: string): {
  url: string;
  headers?: Record<string, string>;
} {
  return {
    url,
    ...(shouldAttachAimockContext()
      ? { headers: { "x-aimock-context": AIMOCK_CONTEXT } }
      : {}),
  };
}

export function createClaudeHttpAgent(url: string): HttpAgent {
  return new HttpAgent(claudeHttpAgentConfig(url));
}
