import { useCopilotChatInternal } from "@copilotkit/react-core";
import { SmallSpinnerIcon } from "./Icons";

interface SuggestionsProps {
  title: string;
  message: string;
  partial?: boolean;
  className?: string;
  onClick: () => void;
}

export function Suggestion({ title, onClick, partial, className }: SuggestionsProps) {
  const { isLoading } = useCopilotChatInternal();
  if (!title) return null;

  return (
    <button
      disabled={partial || isLoading}
      onClick={(e) => {
        e.preventDefault();
        onClick();
      }}
      className={cn(className, partial ? "suggestion loading" : "suggestion")}
      data-test-id="suggestion"
      type="button"
    >
      {partial ? SmallSpinnerIcon : <span>{title}</span>}
    </button>
  );
}
