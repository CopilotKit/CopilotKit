import { CopilotTextarea } from "@copilotkit/react-textarea";
import { useState } from "react";

export function VacationNotes(): JSX.Element {
  const [text, setText] = useState("");

  return (
    <CopilotTextarea
      className="p-4"
      value={text}
      onChange={(value: string) => setText(value)}
      placeholder="What are your plans for your vacation?"
      autocompleteConfig={{
        autocomplete: (
          beforeText: string,
          afterText: string,
          abortSignal: AbortSignal
        ) =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve(
                `You want to go to ${beforeText}? That's a great place to visit!`
              );
            }, 3000);
          }),
        debounceTime: 1000,
      }}
    />
  );
}
