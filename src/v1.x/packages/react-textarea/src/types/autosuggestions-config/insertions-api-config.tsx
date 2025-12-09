import { Message, Role, TextMessage } from "@copilotkit/runtime-client-gql";
import { MakeSystemPrompt } from "./subtypes/make-system-prompt";

export interface InsertionsApiConfig {
  makeSystemPrompt: MakeSystemPrompt;
  fewShotMessages: Message[];
  forwardedParams: { [key: string]: any } | undefined;
}

export const defaultInsertionsMakeSystemPrompt: MakeSystemPrompt = (
  textareaPurpose,
  contextString,
) => {
  return `You are a versatile writing assistant helping the user insert new text into their existing work.
  
The user is writing some text.
The purpose is: \"${textareaPurpose}\"

The following external context is also provided. Use it to inform your suggestions when relevant!!!
\`\`\`
${contextString}
\`\`\`

The user will provide you with a prompt for an INSERTION into the text they are writing. 
Your job is to come up with an INSERTION into the text that the user would like to use, AS BEST YOU CAN.
Only insert a SHORT segment. Usually 1 sentence, or at most 1 paragraph.

Adjust yourself to the user's style and implied intent.


The user will provide the text before and after the cursor, as well as the INSERTION prompt. You should use this to infer the best relevant insertion.
The conversation will be structured as follows:
<TextAfterCursor>
<TextBeforeCursor>
<InsertionPrompt>

<YourInsertionSuggestion>
`;
};

export const defaultInsertionsFewShotMessages: Message[] = [
  new TextMessage({
    role: Role.User,
    content:
      "<TextAfterCursor>While I was there I also picked up some apples, oranges, and bananas.</TextAfterCursor>",
  }),
  new TextMessage({
    role: Role.User,
    content:
      "<TextBeforeCursor>This morning I woke up and went straight to the grocery store.</TextBeforeCursor>",
  }),
  new TextMessage({
    role: Role.User,
    content: "<InsertionPrompt>I bought a big watermelon</InsertionPrompt>",
  }),
  new TextMessage({
    role: Role.Assistant,
    content:
      "When I arrived I went straight to the produce section and picked out a big watermelon.",
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
    role: Role.User,
    content:
      "<InsertionPrompt>add section about the optionholder's pro rata share</InsertionPrompt>",
  }),
  new TextMessage({
    role: Role.Assistant,
    content:
      ' (ii) that, for purposes of this Agreement and the Merger Agreement, the applicable percentage set forth opposite the name of the Optionholder in the Distribution Waterfall shall be such the Optionholder\'s "Pro Rata Share"; ',
  }),
];

export const defaultInsertionsApiConfig: InsertionsApiConfig = {
  makeSystemPrompt: defaultInsertionsMakeSystemPrompt,
  fewShotMessages: defaultInsertionsFewShotMessages,
  forwardedParams: undefined,
};
