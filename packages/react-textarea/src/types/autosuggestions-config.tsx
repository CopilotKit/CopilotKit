import { MinimalChatGPTMessage } from "./MinimalChatGPTMessage";

export type MakeSystemMessage = (
  textareaPurpose: string,
  contextString: string
) => string;

export interface BaseAutosuggestionsConfig {
  textareaPurpose: string;
  debounceTime: number;
  acceptAutosuggestionKey: string;
  disableWhenEmpty: boolean;
}

export const defaultBaseAutosuggestionsConfig: Omit<
  BaseAutosuggestionsConfig,
  "textareaPurpose"
> = {
  debounceTime: 500,
  acceptAutosuggestionKey: "Tab",
  disableWhenEmpty: true,
};

export interface AutosuggestionsConfig extends BaseAutosuggestionsConfig {
  apiEndpoint: string;
  contextCategories: string[] | undefined;
  makeSystemMessage: MakeSystemMessage;
  fewShotMessages: MinimalChatGPTMessage[];
}

export const defaultMakeSystemMessage: MakeSystemMessage = (
  textareaPurpose,
  contextString
) => {
  return `
You are a versatile writing assistant.

The user is writing some text. The purpose is: ${textareaPurpose}.
Your job is to help the user write - by guessing what they are going to write next as best as you can, and suggesting it to them.
Only guess a SHORT distance ahead. Usually 1 sentence, or at most 1 paragraph.

Adjust yourself to the user's style and implied intent.

The user will provide both the text before and after the cursor. You should use this to infer what the user is likely to write next.
<TextAfterCursor>
<TextBeforeCursor>
<YourSuggestion>

If we need to add a whitespace character to the suggested text, make sure to explicitly add it in.

The following external context is also provided. Draw on it whenever it is relevant!
\`\`\`
${contextString}
\`\`\`
`;
};

export const defaultFewShotMessages: MinimalChatGPTMessage[] = [
  {
    role: "user",
    name: "TextAfterCursor",
    content:
      "While I was there I also picked up some apples, oranges, and bananas.",
  },
  {
    role: "user",
    name: "TextBeforeCursor",
    content: "This morning I woke up and went straight to the grocery store.",
  },
  {
    role: "assistant",
    content:
      " When I arrived I went straight to the produce section and picked out a big watermelon. ",
  },
  {
    role: "user",
    name: "TextAfterCursor",
    content:
      "and (iii) to the appointment of the Equityholders' Representative pursuant to Section 10.7 of the Merger Agreement and to the provisions thereof.",
  },
  {
    role: "user",
    name: "TextBeforeCursor",
    content:
      'The Optionholder, in the Optionholder\'s capacity as a holder of vested Options, hereby irrevocably and unconditionally agrees: (i) that the Optionholder shall be deemed an "Equityholder" under the Merger Agreement and shall be entitled to the rights and benefits, and subject to the obligations, of an "Equityholder" thereunder;',
  },
  {
    role: "assistant",
    content:
      ' (ii) that, for purposes of this Agreement and the Merger Agreement, the applicable percentage set forth opposite the name of the Optionholder in the Distribution Waterfall shall be such the Optionholder\'s "Pro Rata Share"; ',
  },
];
export const defaultAutosuggestionsConfig: Omit<
  AutosuggestionsConfig,
  "textareaPurpose"
> = {
  ...defaultBaseAutosuggestionsConfig,

  apiEndpoint: "api/autosuggestions",
  makeSystemMessage: defaultMakeSystemMessage,
  fewShotMessages: defaultFewShotMessages,
  contextCategories: undefined,
};
