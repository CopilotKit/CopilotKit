import { CopilotTextarea } from "@copilotkit/react-ui";
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
          purposePrompt:
            "Travel notes from the user's previous vacations. Likely written in a colloquial style, but adjust as needed.",
          debounceTime: 700,
          acceptAutosuggestionKey: "Tab",
          externalContextCategories: [],
          disableWhenEmpty: true,
        }}
      />
    </>
  );
}
