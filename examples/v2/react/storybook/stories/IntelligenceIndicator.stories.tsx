import React, { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { IntelligenceIndicatorView } from "@copilotkit/react-core/v2";
import type { IntelligenceIndicatorViewProps } from "@copilotkit/react-core/v2";

/**
 * `IntelligenceIndicatorView` is the presentational face of the
 * "CopilotKit Intelligence" indicator — the default rendered by the
 * `intelligenceIndicator` slot on `CopilotChat`. Single-element
 * three-stage design: glassmorphism chrome around a 270° arc that
 * morphs to a checkmark on `status="finished"`, after which the
 * chrome fades and the label settles to a neutral gray with a slight
 * italic-like slant.
 *
 * The orchestration brain (`IntelligenceIndicator`) is provider- and
 * agent-driven, so it's covered by unit/e2e tests rather than stories.
 */

const mockMessage = {
  id: "story-message",
  role: "assistant" as const,
  content: "",
};

const meta = {
  title: "UI/IntelligenceIndicator",
  component: IntelligenceIndicatorView,
  decorators: [
    (Story) => (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          minHeight: "240px",
          padding: "32px",
        }}
      >
        <Story />
      </div>
    ),
  ],
  args: {
    message: mockMessage,
    label: "CopilotKit Intelligence",
    status: "in-progress",
  },
} satisfies Meta<typeof IntelligenceIndicatorView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Active phase: glassmorphism pill with a spinning ring. */
export const InProgress: Story = {
  args: { status: "in-progress" },
};

/**
 * Persistent finished phase: compact icon + text tag. This is what
 * sits quietly in chat history per turn — one tag per agent turn that
 * used Intelligence, kept forever in scroll-back.
 */
export const Finished: Story = {
  args: { status: "finished" },
};

/** Props-tier slot override demo: a custom label passed through the slot. */
export const WithCustomLabel: Story = {
  args: { status: "finished", label: "Recalling memory" },
};

/**
 * Animated timeline: enter as `in-progress`, then flip to `finished`
 * after ~1.5s. The face's built-in opacity cross-fade swaps the
 * spinner pill out for the persistent tag. Click "Restart" to replay.
 */
export const Playground: Story = {
  render: (args) => {
    const [tick, setTick] = useState(0);
    const [status, setStatus] = useState<"in-progress" | "finished">(
      "in-progress",
    );
    useEffect(() => {
      setStatus("in-progress");
      const t = setTimeout(() => setStatus("finished"), 1500);
      return () => clearTimeout(t);
    }, [tick]);
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "16px",
          alignItems: "center",
        }}
      >
        <IntelligenceIndicatorView {...args} status={status} />
        <button
          onClick={() => setTick((n) => n + 1)}
          style={{
            padding: "6px 14px",
            borderRadius: 6,
            border: "1px solid #d4d4d8",
            background: "#fafafa",
            cursor: "pointer",
          }}
        >
          Restart
        </button>
      </div>
    );
  },
};

/**
 * A fully custom face — what a slot consumer would render when they
 * pass `<CopilotChat intelligenceIndicator={MyCustomIndicator} />`. It
 * receives the same `{ status, label, message }` props the brain hands
 * the default face, and decides its own look from `status`.
 */
const CustomFace: React.FC<IntelligenceIndicatorViewProps> = ({
  status,
  label,
}) => {
  const isFinished = status === "finished";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 14px",
        borderRadius: 999,
        background: isFinished ? "#dcfce7" : "#fef3c7",
        color: isFinished ? "#166534" : "#92400e",
        fontSize: 13,
        fontWeight: 600,
        transition: "background 360ms ease-out, color 360ms ease-out",
      }}
    >
      <span>{isFinished ? "✅" : "⏳"}</span>
      <span>{isFinished ? `${label} — done` : `${label}…`}</span>
    </span>
  );
};

export const FullyCustomFace: Story = {
  render: (args) => {
    const [tick, setTick] = useState(0);
    const [status, setStatus] = useState<"in-progress" | "finished">(
      "in-progress",
    );
    useEffect(() => {
      setStatus("in-progress");
      const t = setTimeout(() => setStatus("finished"), 1500);
      return () => clearTimeout(t);
    }, [tick]);
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "16px",
          alignItems: "center",
        }}
      >
        <CustomFace {...args} status={status} />
        <button
          onClick={() => setTick((n) => n + 1)}
          style={{
            padding: "6px 14px",
            borderRadius: 6,
            border: "1px solid #d4d4d8",
            background: "#fafafa",
            cursor: "pointer",
          }}
        >
          Restart
        </button>
      </div>
    );
  },
};
