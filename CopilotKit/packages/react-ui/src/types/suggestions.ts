export interface CopilotChatSuggestionConfiguration {
  instructions: string;
  minSuggestions?: number;
  maxSuggestions?: number;
}

export interface CopilotChatSuggestion {
  title: string;
  message: string;
  partial?: boolean;
}
