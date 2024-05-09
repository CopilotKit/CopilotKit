export interface CopilotChatSuggestionConfiguration {
  /**
   * A prompt or instructions for the GPT to generate suggestions.
   */
  instructions: string;

  /**
   * The minimum number of suggestions to generate. Defaults to `1`.
   * @default 1
   */
  minSuggestions?: number;

  /**
   * The maximum number of suggestions to generate. Defaults to `3`.
   * @default 1
   */
  maxSuggestions?: number;

  /**
   * An optional class name to apply to the suggestions.
   */
  className?: string;
}

export interface CopilotChatSuggestion {
  title: string;
  message: string;
  partial?: boolean;
  className?: string;
}
