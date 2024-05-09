import { CopilotContextParams, extract } from "@copilotkit/react-core";
import { SuggestionsProps } from "./props";
import { SmallSpinnerIcon } from "./Icons";
import { CopilotChatSuggestion, CopilotChatSuggestionConfiguration } from "../../types/suggestions";

export function Suggestion({ title, message, onClick, partial, className }: SuggestionsProps) {
  return (
    <button
      disabled={partial}
      onClick={(e) => {
        e.preventDefault();
        onClick(message);
      }}
      className={className || "suggestion"}
    >
      {partial && SmallSpinnerIcon}
      <span>{title}</span>
    </button>
  );
}

export const reloadSuggestions = async (
  context: CopilotContextParams,
  chatSuggestionConfiguration: { [key: string]: CopilotChatSuggestionConfiguration },
  setCurrentSuggestions: (suggestions: { title: string; message: string }[]) => void,
  abortControllerRef: React.MutableRefObject<AbortController | null>,
) => {
  const abortController = abortControllerRef.current;
  const tools = JSON.stringify(context.getChatCompletionFunctionDescriptions(context.entryPoints));

  const allSuggestions: CopilotChatSuggestion[] = [];

  for (const config of Object.values(chatSuggestionConfiguration)) {
    try {
      const numOfSuggestionsInstructions =
        config.minSuggestions === 0
          ? `Produce up to ${config.maxSuggestions} suggestions. ` +
            `If there are no highly relevant suggestions you can think of, provide an empty array.`
          : `Produce between ${config.minSuggestions} and ${config.maxSuggestions} suggestions.`;
      const result = await extract({
        context,
        instructions:
          "Suggest what the user could say next. Provide clear, highly relevant suggestions. Do not literally suggest function calls. " +
          config.instructions +
          "\n\n" +
          numOfSuggestionsInstructions,
        data: "Available tools: " + tools + "\n\n",
        parameters: [
          {
            name: "suggestions",
            type: "object[]",
            attributes: [
              {
                name: "title",
                description:
                  "The title of the suggestion. This is shown as a button and should be short.",
                type: "string",
              },
              {
                name: "message",
                description:
                  "The message to send when the suggestion is clicked. This should be a clear, complete sentence and will be sent as an instruction to the AI.",
                type: "string",
              },
            ],
          },
        ],
        include: {
          messages: true,
          readable: true,
        },
        abortSignal: abortController?.signal,
        stream: ({ status, args }) => {
          const suggestions = args.suggestions || [];
          const newSuggestions: CopilotChatSuggestion[] = [];
          for (let i = 0; i < suggestions.length; i++) {
            // if GPT provides too many suggestions, limit the number of suggestions
            if (config.maxSuggestions !== undefined && i >= config.maxSuggestions) {
              break;
            }
            const { title, message } = suggestions[i];

            // If this is the last suggestion and the status is not complete, mark it as partial
            const partial = i == suggestions.length - 1 && status !== "complete";

            newSuggestions.push({
              title,
              message,
              partial,
              className: config.className,
            });
          }
          setCurrentSuggestions([...allSuggestions, ...newSuggestions]);
        },
      });
      allSuggestions.push(...result.suggestions);
    } catch (error) {
      console.error("Error loading suggestions", error);
    }
  }

  if (abortControllerRef.current === abortController) {
    abortControllerRef.current = null;
  }
};
