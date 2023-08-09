import { CopilotTextarea } from "@copilotkit/react-textarea";
import { useState } from "react";

export function VacationNotes(): JSX.Element {
  const [text, setText] = useState("");

  return (
    <CopilotTextarea
      className="p-4"
      value={text}
      onChange={(value: string) => setText(value)}
    />
  );
}
