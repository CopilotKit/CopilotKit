import { CopilotTextarea } from "@copilotkit/react-textarea";
import { useState } from "react";

export function VacationNotes() {
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
          disableWhenEmpty: true,

          // Accept on tab is the default behavior, but we can override it if we wanted to, as so:
          shouldAcceptAutosuggestionOnKeyPress: (event: React.KeyboardEvent<HTMLDivElement>) => {
            // if tab, accept the autosuggestion
            if (event.key === "Tab") {
              return true;
            }
            return false;
          },

          chatApiConfigs: {
            suggestionsApiConfig: {
              maxTokens: 20,
              stop: [".", "?", "!"],
            },
            insertionApiConfig: {},
          },
        }}
      />
    </>
  );
}
