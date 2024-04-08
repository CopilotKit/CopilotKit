import { CopilotContextParams, extract } from "@copilotkit/react-core";
import { SuggestionsProps } from "./props";
import { useChatContext } from "./ChatContext";
import { SmallSpinnerIcon } from "./Icons";

export function Suggestion({ title, message, onClick, partial }: SuggestionsProps) {
  // const context = useChatContext();
  return (
    <button
      disabled={partial}
      onClick={(e) => {
        e.preventDefault();
        onClick(message);
      }}
    >
      {partial && SmallSpinnerIcon}
      <span>{title}</span>
    </button>
  );
}

export const reloadSuggestions = async (
  context: CopilotContextParams,
  setCurrentSuggestions: (suggestions: { title: string; message: string }[]) => void,
  abortSignal: AbortSignal,
) => {
  try {
    const tools = JSON.stringify(
      context.getChatCompletionFunctionDescriptions(context.entryPoints),
    );
    await extract({
      context,
      instructions:
        "Suggest what the user could say next. Make sure to keep the suggestions highly relevant and useful to the current conversation.",
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
              description: "The message to send when the suggestion is clicked.",
              type: "string",
            },
          ],
        },
      ],
      include: {
        messages: true,
        readable: true,
      },
      abortSignal,
      stream: ({ status, args }) => {
        const newSuggestions: { title: string; message: string; partial: boolean }[] = [];
        const suggestions = args.suggestions || [];
        for (let i = 0; i < suggestions.length; i++) {
          const { title, message } = suggestions[i];

          // If this is the last suggestion and the status is not complete, mark it as partial
          const partial = i == suggestions.length - 1 && status !== "complete";

          newSuggestions.push({
            title,
            message,
            partial,
          });
        }
        setCurrentSuggestions(newSuggestions);
      },
    });
  } catch (error) {
    console.error("Error reloading suggestions", error);
  }
};
