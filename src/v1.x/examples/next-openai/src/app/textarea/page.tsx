"use client";

import {
  CopilotKit,
  DocumentPointer,
  useCopilotReadable,
  useMakeCopilotDocumentReadable,
} from "@copilotkit/react-core";
import { CopilotTextarea, HTMLCopilotTextAreaElement } from "@copilotkit/react-textarea";
import { useRef } from "react";
import { useStateWithLocalStorage } from "../utils";
import { useSearchParams } from "next/navigation";

export default function CopilotTextareaDemo() {
  const searchParams = useSearchParams();
  const serviceAdapter = searchParams.get("serviceAdapter") || "openai";
  const runtimeUrl =
    searchParams.get("runtimeUrl") || `/api/copilotkit?serviceAdapter=${serviceAdapter}`;
  const publicApiKey = searchParams.get("publicApiKey");

  const copilotKitProps: Partial<React.ComponentProps<typeof CopilotKit>> = {
    runtimeUrl,
    publicApiKey: publicApiKey || undefined,
  };

  return (
    <CopilotKit {...copilotKitProps}>
      <TextAreas />
    </CopilotKit>
  );
}

const clientTranscriptSummaryDocument: DocumentPointer = {
  id: "clientTranscriptSummary",
  name: "Client Call Gong Transcript",
  sourceApplication: "Gong",
  iconImageUri: "https://asset.brandfetch.io/idHyhmcKvT/idRu6db2HA.jpeg?updated=1690987844207",
  getContents: () => {
    return "This is the client transcript summary";
  },
};

function TextAreas() {
  const [detailsText, setDetailsText] = useStateWithLocalStorage("", "cacheKey_detailsText");
  const [copilotText, setCopilotText] = useStateWithLocalStorage("", "cacheKey_copilotText");

  const [textareaPurpose, setTextareaPurpose] = useStateWithLocalStorage(
    "A COOL & SMOOTH announcement post about CopilotTextarea. No pomp, no fluff, no BS. Just the facts. Be brief, be clear, be concise. Be cool.",
    "cacheKey_textareaPurpose",
  );

  const salesReplyCategoryId = "sales_reply";
  useCopilotReadable({
    description: "Details Text",
    value: detailsText,
    categories: [salesReplyCategoryId],
  });

  const copilotTextareaRef = useRef<HTMLCopilotTextAreaElement>(null);

  useMakeCopilotDocumentReadable(clientTranscriptSummaryDocument, [salesReplyCategoryId], []);

  return (
    <div className="w-full h-full gap-10 flex flex-col items-center p-10">
      <div className="flex w-1/2 items-start gap-3">
        <span className="text-3xl text-white whitespace-nowrap">Textarea Purpose:</span>
        <textarea
          className="p-2 h-12 rounded-lg flex-grow overflow-x-auto overflow-y-hidden whitespace-nowrap"
          value={textareaPurpose}
          onChange={(event) => setTextareaPurpose(event.target.value)}
        />
      </div>
      <CopilotTextarea
        value={copilotText}
        ref={copilotTextareaRef}
        onChange={(event) => setCopilotText(event.target.value)}
        className="p-4 w-1/2 aspect-square font-bold text-3xl bg-slate-800 text-white rounded-lg resize-none"
        placeholderStyle={{
          color: "white",
          opacity: 0.5,
        }}
        autosuggestionsConfig={{
          textareaPurpose: textareaPurpose,
          contextCategories: [salesReplyCategoryId],
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

      <textarea
        className="p-4 w-1/2 h-80 rounded-lg"
        value={detailsText}
        placeholder="the normal textarea"
        onChange={(event) => setDetailsText(event.target.value)}
      />

      <button
        className="p-4 w-1/2 bg-slate-800 text-white rounded-lg"
        onClick={() => {
          if (copilotTextareaRef.current) {
            copilotTextareaRef.current.focus();
          }
        }}
      >
        Focus CopilotTextarea
      </button>
    </div>
  );
}

// const makeSystemPrompt: MakeSystemPrompt = (textareaPurpose, contextString) => {
//   return `
// You are a versatile writing assistant.

// The user is writing some text.
// The purpose is: \"${textareaPurpose}\"

// Your job is to guess what the user will write next AS BEST YOU CAN.
// Only guess a SHORT distance ahead. Usually 1 sentence, or at most 1 paragraph.

// Adjust yourself to the user's style and implied intent.

// The user will provide both the text before and after the cursor. You should use this to infer what the user is likely to write next.
// <TextAfterCursor>
// <TextBeforeCursor>
// <YourSuggestion>

// If we need to add a whitespace character to the suggested text, make sure to explicitly add it in.

// The following external context is also provided. Use it to help you make better suggestions!!!
// \`\`\`
// ${contextString}
// \`\`\`
// `;
// };
