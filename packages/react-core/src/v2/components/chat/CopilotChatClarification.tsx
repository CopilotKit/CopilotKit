import React, { useState } from "react";
import type { CopilotClarificationRequest } from "../../hooks/use-copilot-clarification";
import { Button } from "../../components/ui/button";

export type CopilotChatClarificationProps = {
  request: CopilotClarificationRequest;
  onAnswer: (event: React.FormEvent<HTMLFormElement>, answer: string) => void;
  onCancel: () => void;
};

/** Replaceable, non-modal question surface for agent clarification. */
export function CopilotChatClarification({
  request,
  onAnswer,
  onCancel,
}: CopilotChatClarificationProps) {
  const [answer, setAnswer] = useState("");
  return (
    <form
      data-copilot-private
      aria-label="Clarification needed"
      data-testid="copilot-clarification"
      className="cpk:mx-4 cpk:mb-2 cpk:rounded-xl cpk:border cpk:border-border cpk:bg-background cpk:p-4 cpk:shadow-md"
      onSubmit={(event) => {
        event.preventDefault();
        onAnswer(event, answer);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
    >
      <label className="cpk:block cpk:text-sm cpk:font-semibold">
        {request.question}
        <input
          autoFocus
          value={answer}
          maxLength={500}
          onChange={(event) => setAnswer(event.target.value)}
          className="cpk:mt-2 cpk:w-full cpk:rounded-md cpk:border cpk:border-border cpk:bg-background cpk:p-2 cpk:text-sm"
        />
      </label>
      <div className="cpk:mt-3 cpk:flex cpk:justify-end cpk:gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!answer.trim()}>
          Send answer
        </Button>
      </div>
    </form>
  );
}
