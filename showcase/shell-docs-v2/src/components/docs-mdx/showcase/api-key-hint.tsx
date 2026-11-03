// <ApiKeyHint provider="openai" />: under a code block that needs a provider
// key, a quiet line linking to where to get one. Navigational only; it never
// touches a key. A port of shell-docs' api-key-hint.tsx.

import { ExternalLink, KeyRound } from "lucide-react";

const PROVIDERS: Record<string, { label: string; url: string }> = {
  openai: {
    label: "OpenAI API key",
    url: "https://platform.openai.com/api-keys",
  },
  anthropic: {
    label: "Anthropic API key",
    url: "https://console.anthropic.com/",
  },
  google: {
    label: "Google AI Studio API key",
    url: "https://aistudio.google.com/apikey",
  },
  langsmith: {
    label: "LangSmith API key",
    url: "https://smith.langchain.com/",
  },
  copilotkit: {
    label: "CopilotKit Intelligence API key",
    url: "https://dashboard.operations.copilotkit.ai/",
  },
};

export function ApiKeyHint({ provider }: { provider: string }) {
  const meta = Object.hasOwn(PROVIDERS, provider)
    ? PROVIDERS[provider]
    : undefined;
  if (!meta) return null;
  return (
    <p className="not-prose mt-2 flex items-center gap-1.5 text-[0.8125rem] text-muted-foreground">
      <KeyRound className="size-3.5 shrink-0" aria-hidden="true" />
      <span>
        Get your{" "}
        <a
          href={meta.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline-offset-4 hover:underline"
        >
          {meta.label}
          <ExternalLink
            className="ml-0.5 inline-block size-3"
            aria-hidden="true"
          />
        </a>
      </span>
    </p>
  );
}
