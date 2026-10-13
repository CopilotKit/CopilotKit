/*
 * Learning draws two small marks that the shared Material Symbols set does not
 * cover at this weight. They are inline so they inherit `currentColor` and the
 * surrounding font size instead of loading a second icon font.
 */

const strokeProps = {
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  viewBox: "0 0 24 24",
} as const;

/** Marks the Learning surface itself: a node with radiating connections. */
export function LearningMarkIcon(): React.JSX.Element {
  return (
    <svg aria-hidden="true" strokeWidth={1.7} {...strokeProps}>
      <path d="M12 3v4M12 17v4M4.2 7.5l3.5 2M16.3 14.5l3.5 2M4.2 16.5l3.5-2M16.3 9.5l3.5-2" />
      <circle cx="12" cy="12" r="4" />
    </svg>
  );
}

/** Sits on the analyze action: start reading the collected Threads. */
export function PlayIcon(): React.JSX.Element {
  return (
    <svg aria-hidden="true" strokeWidth={1.8} {...strokeProps}>
      <path d="m8 5 11 7-11 7V5Z" />
    </svg>
  );
}

/** Says a list row opens something rather than toggling in place. */
export function ChevronRightIcon(): React.JSX.Element {
  return (
    <svg aria-hidden="true" strokeWidth={1.8} {...strokeProps}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}
