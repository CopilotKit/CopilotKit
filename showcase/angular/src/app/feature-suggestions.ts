import type { StaticSuggestionsConfig } from "@copilotkit/angular";

const SUGGESTIONS: Readonly<
  Record<string, StaticSuggestionsConfig["suggestions"]>
> = {
  "shared-state-read-write": [
    { title: "Greet me", message: "Say hi and introduce yourself." },
    {
      title: "Remember something",
      message:
        "Remember that I prefer morning meetings and that I don't eat dairy.",
    },
    {
      title: "Plan a weekend",
      message: "Suggest a weekend plan based on my interests.",
    },
  ],
  "shared-state-read": [
    {
      title: "Create Italian recipe",
      message: "Create a delicious Italian pasta recipe.",
    },
    {
      title: "Make it healthier",
      message: "Make the recipe healthier with more vegetables.",
    },
    {
      title: "Suggest variations",
      message: "Suggest some creative variations of this recipe.",
    },
  ],
  "shared-state-streaming": [
    {
      title: "Write a short poem",
      message: "Write a short poem about autumn leaves.",
    },
    {
      title: "Draft an email",
      message:
        "Draft a polite email declining a meeting next Tuesday afternoon.",
    },
    {
      title: "Explain quantum computing",
      message:
        "Write a 2-paragraph explanation of quantum computing for a curious teenager.",
    },
  ],
  "readonly-state-agent-context": [
    {
      title: "Who am I?",
      message: "What do you know about me from my context?",
    },
    {
      title: "Suggest next steps",
      message: "Based on my recent activity, what should I try next?",
    },
    {
      title: "Plan my morning",
      message:
        "What time is it in my timezone and what should I do for the next hour?",
    },
  ],
  "reasoning-default": [
    {
      title: "Show reasoning",
      message:
        "Explain step by step why the sky appears blue during the day but red at sunset.",
    },
  ],
  "reasoning-custom": [
    {
      title: "Show reasoning",
      message:
        "Explain step by step why the sky appears blue during the day but red at sunset.",
    },
  ],
};

/** Return deterministic static suggestions for a canonical showcase feature. */
export function suggestionsConfigForFeature(
  feature: string,
): StaticSuggestionsConfig[] {
  const suggestions = SUGGESTIONS[feature];
  return suggestions
    ? [
        {
          suggestions: [...suggestions],
          available: "always",
          consumerAgentId: feature,
        },
      ]
    : [];
}
