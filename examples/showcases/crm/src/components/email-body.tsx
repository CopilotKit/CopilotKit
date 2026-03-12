import { CopilotTextarea } from "@copilotkit/react-textarea";

interface EmailBodyTextareaProps {
  emailBody: string;
  setEmailBody: (value: string) => void;
  salesReplyCategoryId: string;
}

export function EmailBodyTextarea(props: EmailBodyTextareaProps) {
  return (
    <CopilotTextarea
      value={props.emailBody}
      onValueChange={(value: string) => props.setEmailBody(value)}
      className="min-h-[80px] w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-lg ring-offset-white placeholder:text-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-800 dark:bg-gray-950 dark:ring-offset-gray-950 dark:placeholder:text-gray-400 dark:focus-visible:ring-gray-300"
      placeholderStyle={{
        color: "white",
        opacity: 0.5,
      }}
      autosuggestionsConfig={{
        textareaPurpose:
          "A proposal for a prospective client contract - follow-up to a previous call with Robert & Sarah",
        contextCategories: [props.salesReplyCategoryId],
        chatApiConfigs: {
          suggestionsApiConfig: {
            // makeSystemPrompt: makeSystemPrompt,
            // fewShotMessages: fewShotMessages,

            maxTokens: 5,
            stop: ["\n", ".", ","],
          },
          insertionApiConfig: {},
        },
        debounceTime: 250,
      }}
    />
  );
}
