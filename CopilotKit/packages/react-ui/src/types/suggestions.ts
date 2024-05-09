export interface CopilotChatSuggestionConfiguration {
  instructions: string;
  minSuggestions?: number;
  maxSuggestions?: number;
  className?: string;
}

export interface CopilotChatSuggestion {
  title: string;
  message: string;
  partial?: boolean;
  className?: string;
}
