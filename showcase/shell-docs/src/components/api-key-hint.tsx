// ApiKeyHint — compact inline callout shown below code blocks that need
// a provider API key (e.g. `.env` snippets).
//
// Renders a small muted row with a link to the provider's key/credential
// page. Does NOT inject or expose any key — it's purely a navigational
// hint. Usage:
//
//   <ApiKeyHint provider="openai" />

import { ExternalLink, KeyRound } from "lucide-react";

interface ProviderMeta {
  label: string;
  url: string;
}

const PROVIDERS: Record<string, ProviderMeta> = {
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
  const meta = PROVIDERS[provider];
  if (!meta) {
    return null;
  }
  return (
    <div className="not-prose mt-2 flex items-center gap-1.5 text-[0.8125rem] text-fd-muted-foreground">
      <KeyRound className="size-3.5 shrink-0" aria-hidden="true" />
      <span>
        Get your{" "}
        <a
          href={meta.url}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 decoration-fd-foreground/20 transition-colors hover:decoration-fd-foreground/40"
        >
          {meta.label}
          <ExternalLink
            className="ml-0.5 inline-block size-3"
            aria-hidden="true"
          />
        </a>
      </span>
    </div>
  );
}
