export type A2UISkeletonSegment =
  | { type: "dot" }
  | { type: "spacer" }
  | {
      type: "bar";
      width: number;
      height: number;
      background: string;
      animationDelay?: number;
      opacity?: number;
    };

export type A2UISkeletonRow = {
  phase: number;
  delay: number;
  segments: A2UISkeletonSegment[];
};

/** Static skeleton layout for the A2UI tool-call progress placeholder. */
export const A2UI_TOOL_SKELETON_ROWS: A2UISkeletonRow[] = [
  {
    phase: 0,
    delay: 0,
    segments: [
      {
        type: "bar",
        width: 36,
        height: 7,
        background: "rgba(147,197,253,0.7)",
        animationDelay: 0,
      },
      {
        type: "bar",
        width: 80,
        height: 7,
        background: "rgba(219,234,254,0.8)",
        animationDelay: 0.2,
      },
    ],
  },
  {
    phase: 0,
    delay: 0.1,
    segments: [
      { type: "spacer" },
      { type: "dot" },
      {
        type: "bar",
        width: 100,
        height: 7,
        background: "rgba(24,24,27,0.2)",
        animationDelay: 0.3,
      },
    ],
  },
  {
    phase: 1,
    delay: 0.15,
    segments: [
      { type: "spacer" },
      {
        type: "bar",
        width: 48,
        height: 7,
        background: "rgba(24,24,27,0.15)",
        animationDelay: 0.1,
      },
      {
        type: "bar",
        width: 40,
        height: 7,
        background: "rgba(153,246,228,0.6)",
        animationDelay: 0.5,
      },
      {
        type: "bar",
        width: 56,
        height: 7,
        background: "rgba(147,197,253,0.6)",
        animationDelay: 0.3,
      },
    ],
  },
  {
    phase: 1,
    delay: 0.2,
    segments: [
      { type: "spacer" },
      { type: "dot" },
      {
        type: "bar",
        width: 60,
        height: 7,
        background: "rgba(24,24,27,0.15)",
        animationDelay: 0.4,
      },
    ],
  },
  {
    phase: 2,
    delay: 0.25,
    segments: [
      {
        type: "bar",
        width: 40,
        height: 7,
        background: "rgba(153,246,228,0.5)",
        animationDelay: 0.2,
      },
      { type: "dot" },
      {
        type: "bar",
        width: 48,
        height: 7,
        background: "rgba(24,24,27,0.15)",
        animationDelay: 0.6,
      },
      {
        type: "bar",
        width: 64,
        height: 7,
        background: "rgba(147,197,253,0.5)",
        animationDelay: 0.1,
      },
    ],
  },
  {
    phase: 2,
    delay: 0.3,
    segments: [
      {
        type: "bar",
        width: 36,
        height: 7,
        background: "rgba(147,197,253,0.6)",
        animationDelay: 0.5,
      },
      {
        type: "bar",
        width: 36,
        height: 7,
        background: "rgba(24,24,27,0.12)",
        animationDelay: 0.7,
      },
    ],
  },
  {
    phase: 3,
    delay: 0.35,
    segments: [
      { type: "dot" },
      {
        type: "bar",
        width: 44,
        height: 7,
        background: "rgba(24,24,27,0.18)",
        animationDelay: 0.3,
      },
      { type: "dot" },
      {
        type: "bar",
        width: 56,
        height: 7,
        background: "rgba(153,246,228,0.5)",
        animationDelay: 0.8,
      },
      {
        type: "bar",
        width: 48,
        height: 7,
        background: "rgba(147,197,253,0.5)",
        animationDelay: 0.4,
      },
    ],
  },
];
