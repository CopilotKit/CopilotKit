import React from "react";

interface BookIconProps {
  className?: string;
}

const DEFAULT_CLASSNAME = "text-icon";

// Open-book mark matching the BrandNav icon vocabulary
// (ConsoleIcon, CloudIcon — outline strokes on a 20x20 grid).
const BookIcon = ({ className }: BookIconProps) => {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      className={[DEFAULT_CLASSNAME, className].filter(Boolean).join(" ")}
    >
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  );
};

export default BookIcon;
