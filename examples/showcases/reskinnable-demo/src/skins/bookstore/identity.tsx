import type { ComponentType } from "react";

/**
 * An open-book mark, drawn as inline SVG so it inherits the theme through
 * currentColor and needs no asset pipeline.
 */
const BookstoreLogo: ComponentType<{ className?: string }> = ({
  className,
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.75}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M12 6.5C10.5 5 8.4 4.3 5 4.3v13c3.4 0 5.5.7 7 2.2 1.5-1.5 3.6-2.2 7-2.2v-13c-3.4 0-5.5.7-7 2.2Z" />
    <path d="M12 6.5v13" />
  </svg>
);

export const bookstoreIdentity = {
  brand: "Bookstore",
  tagline: "Books, read for you before you read them.",
  logo: BookstoreLogo,
  favicon: "📚",
  assistantName: "Bookstore",
  greeting: "Tell me what you're in the mood for — I remember what you like.",
};
