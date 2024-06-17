import { Message, TextMessage } from "@copilotkit/runtime-client-gql";
import { MakeSystemPrompt } from "./subtypes/make-system-prompt";
import { plainToInstance } from "class-transformer";
import { nanoid } from "nanoid";

export interface EditingApiConfig {
  makeSystemPrompt: MakeSystemPrompt;
  fewShotMessages: Message[];
  forwardedParams: { [key: string]: any } | undefined;
}

export const defaultEditingMakeSystemPrompt: MakeSystemPrompt = (
  textareaPurpose,
  contextString,
) => {
  return `You are a versatile writing assistant helping the user edit a portion of their text.
  
The user is writing some text.
The purpose is: \"${textareaPurpose}\"

The following external context is also provided. Use it when relevant.
\`\`\`
${contextString}
\`\`\`

The user has provided you with a PROMPT for EDITING a PORTION of the text. 
Your job is to come up with a new EDITED version OF THE SEGMENT IN QUESTION - AS BEST YOU CAN.
Only rewrite the portion of the text that the user has marked as "TextToEdit"!!!

Adjust yourself to the user's style and implied intent.

The conversation will be structured as follows:
<TextBeforeCursor>
<TextToEdit>
<TextAfterCursor>
<EditingPrompt>

<YourEditSuggestion>
`;
};

export const defaultEditingFewShotMessages: Message[] = [
  plainToInstance(TextMessage, {
    id: nanoid(),
    role: "user",
    content:
      "<TextBeforeCursor>This morning I woke up and went straight to the grocery store. </TextBeforeCursor>",
    createdAt: new Date(),
  }),
  plainToInstance(TextMessage, {
    id: nanoid(),
    role: "user",
    content:
      "<TextToEdit>While I was there I picked up some apples, oranges, and bananas. </TextToEdit>",
    createdAt: new Date(),
  }),
  plainToInstance(TextMessage, {
    id: nanoid(),
    role: "user",
    content:
      "<TextAfterCursor>The grocery store was having a sale on fruit, so I decided to stock up.</TextAfterCursor>",
    createdAt: new Date(),
  }),
  plainToInstance(TextMessage, {
    id: nanoid(),
    role: "user",
    content: "<EditingPrompt>I also bought a big watermelon</EditingPrompt>",
    createdAt: new Date(),
  }),
  plainToInstance(TextMessage, {
    id: nanoid(),
    role: "assistant",
    content:
      "While I was there I picked up some apples, oranges, and bananas, and a big watermelon.",
    createdAt: new Date(),
  }),

  plainToInstance(TextMessage, {
    id: nanoid(),
    role: "user",
    content:
      "<TextBeforeCursor>Yesterday, I spent the afternoon working on my new project.</TextBeforeCursor>",
    createdAt: new Date(),
  }),
  plainToInstance(TextMessage, {
    id: nanoid(),
    role: "user",
    content: "<TextToEdit>It's quite challenging and requires a lot of focus.</TextToEdit>",
    createdAt: new Date(),
  }),
  plainToInstance(TextMessage, {
    id: nanoid(),
    role: "user",
    content:
      "<TextAfterCursor>I'm really excited about the potential outcomes of this project.</TextAfterCursor>",
    createdAt: new Date(),
  }),
  plainToInstance(TextMessage, {
    id: nanoid(),
    role: "user",
    content:
      "<EditingPrompt>emphasize the complexity and my enthusiasm for the project</EditingPrompt>",
    createdAt: new Date(),
  }),
  plainToInstance(TextMessage, {
    id: nanoid(),
    role: "assistant",
    content:
      "It's a highly complex task that demands intense concentration, but I'm incredibly enthusiastic about the promising prospects of this project.",
    createdAt: new Date(),
  }),
];

export const defaultEditingApiConfig: EditingApiConfig = {
  makeSystemPrompt: defaultEditingMakeSystemPrompt,
  fewShotMessages: defaultEditingFewShotMessages,
  forwardedParams: undefined,
};
