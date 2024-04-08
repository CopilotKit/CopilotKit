import { CopilotContextParams, extract } from "@copilotkit/react-core";
import { SuggestionsProps } from "./props";

export function Suggestion({ title, message, onClick }: SuggestionsProps) {
  return (
    <button
      onClick={(e) => {
        e.preventDefault();
        onClick(message);
      }}
    >
      {title}
    </button>
  );
}

export const reloadSuggestions = async (
  context: CopilotContextParams,
  setCurrentSuggestions: (suggestions: { title: string; message: string }[]) => void,
) => {
  try {
    const tools = JSON.stringify(
      context.getChatCompletionFunctionDescriptions(context.entryPoints),
    );
    const { suggestions } = await extract({
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
    });
    setCurrentSuggestions(suggestions || []);
  } catch (error) {
    console.error("Error reloading suggestions", error);
  }
};
