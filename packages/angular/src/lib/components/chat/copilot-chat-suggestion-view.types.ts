import type { Suggestion } from "@copilotkit/core";

export interface SuggestionPillContext {
  children: string;
  isLoading: boolean;
  type: "button" | "submit" | "reset";
  inputClass?: string;
  clickHandler?: () => void;
}

export interface SuggestionContainerContext {
  inputClass?: string;
}

export type { Suggestion };
