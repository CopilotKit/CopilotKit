import {
  ChatlikeApiEndpoint,
  CopilotTextarea,
} from "@copilotkit/react-textarea";
import { useState } from "react";

export function VacationNotes(): JSX.Element {
  const [text, setText] = useState("");

  return (
    <>
      <CopilotTextarea
        className="px-4 py-4"
        value={text}
        onValueChange={(value: string) => setText(value)}
        placeholder="What are your plans for your vacation?"
        autosuggestionsConfig={{
          textareaPurpose:
            "Travel notes from the user's previous vacations. Likely written in a colloquial style, but adjust as needed.",
          debounceTime: 250,
          acceptAutosuggestionKey: "Tab",
          contextCategories: [],
          disableWhenEmpty: true,
          chatApiConfigs: {
            suggestionsApiConfig: {
              forwardedParams: {
                max_tokens: 20,
                stop: [".", "?", "!"],
              },
            },
            insertionApiConfig: {},
          },
        }}
      />
    </>
  );
}
