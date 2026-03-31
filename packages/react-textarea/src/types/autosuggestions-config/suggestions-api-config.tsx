import { Message, Role, TextMessage } from "@copilotkit/runtime-client-gql";
import { MakeSystemPrompt } from "./subtypes/make-system-prompt";

export interface SuggestionsApiConfig {
  makeSystemPrompt: MakeSystemPrompt;
  fewShotMessages: Message[];
  maxTokens?: number;
  stop?: string[];
  temperature?: number;
}

export const defaultSuggestionsMakeSystemPrompt: MakeSystemPrompt = (
  textareaPurpose,
  contextString,
) => {
  return `You are a versatile writing assistant.
  
The user is writing some text.
The purpose is: \"${textareaPurpose}\"

Your job is to guess what the user will write next AS BEST YOU CAN.
Only guess a SHORT distance ahead. Usually 1 sentence, or at most 1 paragraph.

Adjust yourself to the user's style and implied intent.

The user will provide both the text before and after the cursor. You should use this to infer what the user is likely to write next.
<TextAfterCursor>
<TextBeforeCursor>
<YourSuggestion>

If we need to add a whitespace character to the suggested text, make sure to explicitly add it in.
Refrain from adding <YourSuggestion> tags when responding

The following external context is also provided. Use it to help you make better suggestions!!!
\`\`\`
${contextString}
\`\`\`
`;
};

export const defaultSuggestionsFewShotMessages: Message[] = [
  new TextMessage({
    role: Role.User,
    content:
      "<TextAfterCursor>While I was there I also picked up some apples, oranges, and bananas.</TextAfterCursor>",
  }),
  new TextMessage({
    role: Role.User,
    content: "This morning I woke up and went straight to the grocery store.",
  }),
  new TextMessage({
    role: Role.Assistant,
    content:
      " When I arrived I went straight to the produce section and picked out a big watermelon. ",
  }),
  new TextMessage({
    role: Role.User,
    content:
      "<TextAfterCursor>and (iii) to the appointment of the Equityholders' Representative pursuant to Section 10.7 of the Merger Agreement and to the provisions thereof.</TextAfterCursor>",
  }),
  new TextMessage({
    role: Role.User,
    content:
      '<TextBeforeCursor>The Optionholder, in the Optionholder\'s capacity as a holder of vested Options, hereby irrevocably and unconditionally agrees: (i) that the Optionholder shall be deemed an "Equityholder" under the Merger Agreement and shall be entitled to the rights and benefits, and subject to the obligations, of an "Equityholder" thereunder;</TextBeforeCursor>',
  }),
  new TextMessage({
    role: Role.Assistant,
    content:
      ' (ii) that, for purposes of this Agreement and the Merger Agreement, the applicable percentage set forth opposite the name of the Optionholder in the Distribution Waterfall shall be such the Optionholder\'s "Pro Rata Share"; ',
  }),
];

export const defaultSuggestionsApiConfig: SuggestionsApiConfig = {
  makeSystemPrompt: defaultSuggestionsMakeSystemPrompt,
  fewShotMessages: defaultSuggestionsFewShotMessages,
};
