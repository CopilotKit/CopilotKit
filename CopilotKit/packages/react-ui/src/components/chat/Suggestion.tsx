import { SmallSpinnerIcon } from "./Icons";

interface SuggestionsProps {
  title: string;
  message: string;
  partial?: boolean;
  className?: string;
  onClick: () => void;
}

export function Suggestion({ title, onClick, partial, className }: SuggestionsProps) {
  return (
    <button
      disabled={partial}
      onClick={(e) => {
        e.preventDefault();
        onClick();
      }}
      className={className || (partial ? "suggestion loading" : "suggestion")}
      data-test-id="suggestion"
    >
      {partial ? SmallSpinnerIcon : <span>{title}</span>}
    </button>
  );
}
