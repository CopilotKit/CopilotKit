import { CopilotTextarea } from "@copilotkit/react-textarea";
import { useState } from "react";
import { useMakeAutosuggestionFunction } from "@copilotkit/react-textarea";

export function VacationNotes(): JSX.Element {
  const [text, setText] = useState("");

  return (
    <CopilotTextarea
      className="p-4"
      value={text}
      onChange={(value: string) => setText(value)}
      placeholder="What are your plans for your vacation?"
      autosuggestionsConfig={{
        debounceTime: 0.7,
        acceptAutosuggestionKey: "Tab",
      }}
    />
  );
}
