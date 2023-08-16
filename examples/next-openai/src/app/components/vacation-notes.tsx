import { CopilotTextarea } from "@copilotkit/react-textarea";
import { useState } from "react";
import { useMakeAutosuggestionFunction } from "@copilotkit/react-textarea";

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
          textareaPurpose: "Notes for my upcoming vacation",
          debounceTime: 0.7,
          acceptAutosuggestionKey: "Tab",
          contextCategories: [],
          disableWhenEmpty: true,
        }}
      />
    </>
  );
}
