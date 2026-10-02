/*
 * Learning draws four small marks that the shared Material Symbols set does not
 * cover at this weight. They are inline so they inherit `currentColor` and the
 * surrounding font size instead of loading a second icon font.
 */

const strokeProps = {
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  viewBox: '0 0 24 24',
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

/**
 * Sits on the create-Container action.
 *
 * Drawn rather than typed: a text "+" is centred on the font's math axis, not
 * on its box, so it rides high inside a square button however the box is
 * centred. Two strokes on the viewBox centre cannot.
 */
export function PlusIcon(): React.JSX.Element {
  return (
    <svg aria-hidden="true" strokeWidth={2} {...strokeProps}>
      <path d="M12 5v14M5 12h14" />
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

/** Prefixes an evidence count: cited messages inside source Threads. */
export function EvidenceIcon(): React.JSX.Element {
  return (
    <svg aria-hidden="true" strokeWidth={1.7} {...strokeProps}>
      <rect height="16" rx="2" width="16" x="4" y="4" />
      <path d="M8 9h8M8 13h6M8 17h4" />
    </svg>
  );
}
