import { NotebookText } from "lucide-react";

/** The board's mark: a notebook, from the same icon set as the rest of the UI. */
export function BrandMark({ size = 16 }: { size?: number }) {
  return (
    <NotebookText
      className="brand-mark"
      size={size}
      strokeWidth={1.75}
      aria-hidden
    />
  );
}
