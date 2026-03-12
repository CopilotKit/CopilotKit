import { CopilotTextarea } from "@copilotkit/react-textarea";

interface EmailSubjectTextareaProps {
  emailSubject: string;
  setEmailSubject: (value: string) => void;
  salesReplyCategoryId: string;
}

export function EmailSubjectTextarea(props: EmailSubjectTextareaProps) {
  return (
    <CopilotTextarea
      className="flex h-10 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm ring-offset-white file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-800 dark:bg-gray-950 dark:ring-offset-gray-950 dark:placeholder:text-gray-400 dark:focus-visible:ring-gray-300"
      value={props.emailSubject}
      onValueChange={(value: string) => props.setEmailSubject(value)}
      placeholderStyle={{
        color: "white",
        opacity: 0.5,
      }}
      placeholder="Enter the subject"
      autosuggestionsConfig={{
        textareaPurpose:
          "An email subject (title). Keep it SHORT AND SIMPLE! Written by a high-quality sales executive, who knows how to be PERSONIBLE, DIRECT, AND NON-SALESY. The specific context is A proposal for a prospective client contract - as a follow-up to a previous call.",
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
