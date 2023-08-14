import {
  CopilotTextarea,
  AutosuggestionFunction,
} from "@copilotkit/react-textarea";
import { useCallback, useState } from "react";

export function VacationNotes(): JSX.Element {
  const [text, setText] = useState("");

  const autosuggestionFunction = useMakeAutosuggestionFunction();

  return (
    <CopilotTextarea
      className="p-4"
      value={text}
      onChange={(value: string) => setText(value)}
      placeholder="What are your plans for your vacation?"
      autocompleteConfig={{
        autosuggestionFunction: autosuggestionFunction,
        debounceTime: 0.7,
        acceptAutosuggestionKey: "Tab",
      }}
    />
  );
}

export interface BareBonesMessage {
  role: string;
  content: string;
  name?: string;
}
export function useMakeAutosuggestionFunction(
  apiEndpoint: string = "/api/autosuggest",
  makeSystemMessage: (message: string) => string = defaultMakeSystemMessage,
  fewShotMessages: BareBonesMessage[] = defaultFewShotMessages
): AutosuggestionFunction {
  const [contextString, setContextString] = useState("");

  return useCallback(
    async (beforeText: string, afterText: string, abortSignal: AbortSignal) => {
      const res = await fetch(apiEndpoint, {
        method: "POST",
        body: JSON.stringify({
          messages: [
            {
              role: "system",
              content: makeSystemMessage(contextString),
            },
            ...fewShotMessages,
            {
              role: "user",
              name: "TextAfterCursor",
              content: afterText,
            },
            {
              role: "user",
              name: "TextBeforeCursor",
              content: beforeText,
            },
          ],
        }),
        signal: abortSignal,
      });

      const json = await res.json();
      const suggestion = json.choices[0].message.content;

      return suggestion;
    },
    [apiEndpoint, makeSystemMessage, fewShotMessages, contextString]
  );
}

export function defaultMakeSystemMessage(contextString: string): string {
  return `
You are a hyper-competent and versatile writing assistant.

The user is writing some text. It may be a long document, or just a short message.
Your job is to help the user write - by guessing what they are going to write next as best as you can, and suggesting it to them.
Only guess a SHORT distance ahead. Usually 1 sentence, or at most 1 paragraph.

Infer from context WHAT the user is likely writing (and WHY they are writing it) -- and adapt accordingly.
You should also adapt to the user's writing style as best you can. If the user content is formal, be formal; if the user content is casual, be casual; etc.

The user will provide both the text before and after the cursor. You should use this to infer what the user is likely to write next.
<TextAfterCursor>
<TextBeforeCursor>
<YourSuggestion>

If we need space between the text before and after the cursor, make sure to explicitly add it in the suggestion.

The following external context is also provided. You may draw on it when appropriate.
\`\`\`
${contextString}
\`\`\`
`;
}

const defaultFewShotMessages: BareBonesMessage[] = [
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
