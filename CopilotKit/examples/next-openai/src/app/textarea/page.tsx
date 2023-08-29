"use client";

import {
  CopilotProvider,
  useMakeCopilotReadable,
} from "@copilotkit/react-core";
import {
  CopilotTextarea,
  MakeSystemPrompt,
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
        onChange={(event) => setCopilotText(event.target.value)}
        className="p-4  w-1/2 aspect-square font-bold text-3xl bg-slate-800 text-white rounded-lg resize-none"
        placeholderStyle={{
          color: "white",
          opacity: 0.5,
        }}
        autosuggestionsConfig={{
          purposePrompt:
            "A COOL & SMOOTH announcement post about CopilotTextarea. No pomp, no fluff, no BS. Just the facts. Be brief, be clear, be concise. Be cool.",
          externalContextCategories: [announcementCategoryId],
          makeSystemPrompt,
          fewShotMessages,
          debounceTime: 650,
          forwardedParams: {
            max_tokens: 25,
            stop: ["\n", ".", ","],
          },
        }}
      />

      <textarea
        className="p-4 w-1/2 h-80 rounded-lg"
        value={detailsText}
        placeholder="the normal textarea"
        onChange={(event) => setDetailsText(event.target.value)}
      />
    </div>
  );
}

const makeSystemPrompt: MakeSystemPrompt = (purposePrompt, contextString) => {
  return `
You are a versatile writing assistant.

The user is writing some text.
The purpose is: \"${purposePrompt}\"

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
  {
    role: "user",
    content: "",
    name: "TextAfterCursor",
  },
  {
    role: "user",
    content: "Introducing:",
    name: "TextBeforeCursor",
  },
  {
    role: "assistant",
    content: "<CopilotTextarea />",
  },
];
