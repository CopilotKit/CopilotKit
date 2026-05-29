import React, { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import {
  CopilotChatMessageQueue,
  type CopilotChatMessageQueueProps,
} from "@copilotkit/react-core/v2";
import type { QueuedMessage } from "@copilotkit/react-core/v2";

const meta: Meta<typeof CopilotChatMessageQueue> = {
  title: "UI/CopilotChatMessageQueue",
  component: CopilotChatMessageQueue,
  parameters: {
    layout: "padded",
  },
};
export default meta;

type Story = StoryObj<typeof CopilotChatMessageQueue>;

const seedItems: QueuedMessage[] = [
  { id: "1", content: [{ type: "text", text: "Also include pinned tabs" }] },
  {
    id: "2",
    content: [
      { type: "text", text: "And sort by last visited" },
      {
        type: "image",
        source: { type: "url", value: "https://placehold.co/400" },
      },
      {
        type: "image",
        source: { type: "url", value: "https://placehold.co/400" },
      },
    ],
  },
  {
    id: "3",
    content: [{ type: "text", text: "Group them by domain if possible" }],
  },
];

/** Controlled wrapper so stories demonstrate live interactivity. */
const InteractiveQueue: React.FC<
  Partial<CopilotChatMessageQueueProps> & { initial: QueuedMessage[] }
> = ({ initial, ...rest }) => {
  const [items, setItems] = useState(initial);
  return (
    <div style={{ maxWidth: 640 }}>
      <CopilotChatMessageQueue
        messages={items}
        onEdit={(id, content) =>
          setItems((prev) =>
            prev.map((i) => (i.id === id ? { ...i, content } : i)),
          )
        }
        onRemove={(id) => setItems((prev) => prev.filter((i) => i.id !== id))}
        onMoveUp={(id) =>
          setItems((prev) => {
            const idx = prev.findIndex((i) => i.id === id);
            if (idx <= 0) return prev;
            const next = [...prev];
            [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
            return next;
          })
        }
        onMoveDown={(id) =>
          setItems((prev) => {
            const idx = prev.findIndex((i) => i.id === id);
            if (idx < 0 || idx >= prev.length - 1) return prev;
            const next = [...prev];
            [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
            return next;
          })
        }
        dispatch="sequential"
        {...rest}
      />
    </div>
  );
};

export const ThreeQueuedMessages: Story = {
  render: () => <InteractiveQueue initial={seedItems} />,
};

export const SingleMessage: Story = {
  render: () => <InteractiveQueue initial={[seedItems[0]]} />,
};

export const WithAttachments: Story = {
  render: () => <InteractiveQueue initial={[seedItems[1]]} />,
};

export const Empty: Story = {
  render: () => <InteractiveQueue initial={[]} />,
};

export const ManualDispatch: Story = {
  render: () => <InteractiveQueue initial={seedItems} dispatch="manual" />,
};
