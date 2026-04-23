import { LLMock } from "@copilotkit/aimock";
import type { LlmProvider } from "./llm-config";

export interface AimockStartOptions {
  provider: LlmProvider;
  /** Upstream base URL — e.g. https://api.openai.com. */
  upstreamUrl: string;
}

export interface AimockHandle {
  url: string;
  provider: LlmProvider;
  /** Returns the current in-memory journal (recorded requests). */
  getJournal(): unknown[];
  stop(): Promise<void>;
}

const DEFAULT_UPSTREAM: Record<LlmProvider, string> = {
  openai: "https://api.openai.com",
  anthropic: "https://api.anthropic.com",
};

/**
 * Spawns an aimock LLMock server on a random localhost port, forwarding to
 * the provider's real upstream so conversations run against the real LLM.
 * Recording is enabled and buffered in-memory; persistence is Plan #4.
 */
export async function startAimock(
  options: AimockStartOptions,
): Promise<AimockHandle> {
  const upstream = options.upstreamUrl ?? DEFAULT_UPSTREAM[options.provider];
  const mock = new LLMock({
    port: 0,
    logLevel: "silent",
  });
  mock.enableRecording({
    providers: { [options.provider]: upstream },
    proxyOnly: false,
  });
  const url = await mock.start();
  return {
    url,
    provider: options.provider,
    getJournal: () => {
      // getRequests() is the canonical accessor on LLMock — returns JournalEntry[]
      // journal.getAll() is the equivalent via the Journal object
      return mock.getRequests();
    },
    stop: async () => {
      await mock.stop();
    },
  };
}

export function defaultUpstreamFor(provider: LlmProvider): string {
  return DEFAULT_UPSTREAM[provider];
}
