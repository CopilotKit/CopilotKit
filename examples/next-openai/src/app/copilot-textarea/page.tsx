"use client";

import {
  CopilotProvider,
  useMakeCopilotReadable,
} from "@copilotkit/react-core";
import {
  CopilotTextarea,
  MakeSystemMessage,
  MinimalChatGPTMessage,
} from "@copilotkit/react-textarea";
import { useState } from "react";

export default function CopilotTextareaDemo(): JSX.Element {
  return (
    <CopilotProvider>
      <TextAreas />
    </CopilotProvider>
  );
}

function TextAreas() {
  const [detailsText, setDetailsText] = useState("");
  const [copilotText, setCopilotText] = useState("");

  const announcementCategoryId = "announcement";
  useMakeCopilotReadable(detailsText, undefined, [announcementCategoryId]);

  return (
    <div className="w-full h-full gap-10 flex flex-col items-center p-10">
      <CopilotTextarea
        value={copilotText}
        onValueChange={(value) => setCopilotText(value)}
        className="p-4 bg-slate-100 w-1/2 h-80"
        placeholder="the copilot textarea"
        autosuggestionsConfig={{
          textareaPurpose:
            "An exciting announcement post about CopilotTextArea for sharing on social media!",
          contextCategories: [announcementCategoryId],
          makeSystemMessage,
          fewShotMessages,
        }}
      />

      <textarea
        className="p-4 w-1/2 h-80"
        value={detailsText}
        placeholder="the normal textarea"
        onChange={(event) => setDetailsText(event.target.value)}
      />
    </div>
  );
}

const makeSystemMessage: MakeSystemMessage = (
  textareaPurpose,
  contextString
) => {
  return `
You are a versatile writing assistant.

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

The following external context is also provided. Use it to help you make better suggestions!!!
\`\`\`
${contextString}
\`\`\`
`;
};

const fewShotMessages: MinimalChatGPTMessage[] = [
  // {
  //   role: "user",
  //   name: "TextAfterCursor",
  //   content:
  //     "While I was there I also picked up some apples, oranges, and bananas.",
  // },
  // {
  //   role: "user",
  //   name: "TextBeforeCursor",
  //   content: "This morning I woke up and went straight to the grocery store.",
  // },
  // {
  //   role: "assistant",
  //   content:
  //     " When I arrived I went straight to the produce section and picked out a big watermelon. ",
  // },
];
