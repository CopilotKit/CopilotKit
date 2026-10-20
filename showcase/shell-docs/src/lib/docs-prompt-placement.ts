/** A body-owned prompt replaces the generic header prompt. */
export function hasInContentPrompt(content: string): boolean {
  const prose = content
    .replace(/```[^\n]*\n[\s\S]*?```/g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  return /<(?:FrameworkOverview|IntelligenceOverview|PageAgentPrompt|RichThreadsSetupPrompt|LearningSetupPrompt|MemorySetupPrompt|WebMCPSetupPrompt|IntelligenceOnboardingPrompt|ChannelsStartPrompt)\b/.test(
    prose,
  );
}
