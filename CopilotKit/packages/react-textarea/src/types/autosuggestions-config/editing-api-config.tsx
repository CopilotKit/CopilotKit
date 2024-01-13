import { MakeSystemPrompt } from "./subtypes/make-system-prompt";
import { MinimalChatGPTMessage } from "./subtypes/minimal-chat-gpt-message";

export interface EditingApiConfig {
  makeSystemPrompt: MakeSystemPrompt;
  fewShotMessages: MinimalChatGPTMessage[];
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

export const defaultEditingFewShotMessages: MinimalChatGPTMessage[] = [
  {
    role: "user",
    name: "TextBeforeCursor",
    content: "This morning I woke up and went straight to the grocery store. ",
  },
  {
    role: "user",
    name: "TextToEdit",
    content: "While I was there I picked up some apples, oranges, and bananas. ",
  },
  {
    role: "user",
    name: "TextAfterCursor",
    content: "The grocery store was having a sale on fruit, so I decided to stock up.",
  },
  {
    role: "user",
    name: "EditingPrompt",
    content: "I also bought a big watermelon",
  },
  {
    role: "assistant",
    content:
      "While I was there I picked up some apples, oranges, and bananas, and a big watermelon.",
  },

  {
    role: "user",
    name: "TextBeforeCursor",
    content: "Yesterday, I spent the afternoon working on my new project. ",
  },
  {
    role: "user",
    name: "TextToEdit",
    content: "It's quite challenging and requires a lot of focus. ",
  },
  {
    role: "user",
    name: "TextAfterCursor",
    content: "I'm really excited about the potential outcomes of this project.",
  },
  {
    role: "user",
    name: "EditingPrompt",
    content: "emphasize the complexity and my enthusiasm for the project",
  },
  {
    role: "assistant",
    content:
      "It's a highly complex task that demands intense concentration, but I'm incredibly enthusiastic about the promising prospects of this project.",
  },
];

export const defaultEditingApiConfig: EditingApiConfig = {
  makeSystemPrompt: defaultEditingMakeSystemPrompt,
  fewShotMessages: defaultEditingFewShotMessages,
  forwardedParams: undefined,
};
