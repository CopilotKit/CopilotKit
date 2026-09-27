import type { Meta, StoryObj } from "@storybook/angular";
import { moduleMetadata } from "@storybook/angular";
import { CopilotChatAttachmentQueue } from "@copilotkit/angular";
import { sampleAttachments } from "./support/fixtures";
import { withCenteredStage } from "./support/layouts";

/** The row of pending attachments shown above the chat input. */
const meta: Meta<CopilotChatAttachmentQueue> = {
  title: "UI/CopilotChatAttachmentQueue",
  component: CopilotChatAttachmentQueue,
  decorators: [
    moduleMetadata({ imports: [CopilotChatAttachmentQueue] }),
    withCenteredStage,
  ],
  args: { attachments: sampleAttachments },
  render: (args) => ({
    props: {
      ...args,
      onRemove: (id: string) =>
        console.info("[Storybook] removeAttachment", id),
    },
    template: `
      <copilot-chat-attachment-queue
        [attachments]="attachments"
        (removeAttachment)="onRemove($event)"
      />
    `,
  }),
};

export default meta;
type Story = StoryObj<CopilotChatAttachmentQueue>;

/** Images, a document and an audio clip, all ready to send. */
export const Mixed: Story = {};

export const Images: Story = {
  args: { attachments: sampleAttachments.filter((a) => a.type === "image") },
};

export const Documents: Story = {
  args: {
    attachments: [
      sampleAttachments.find((a) => a.type === "document")!,
      {
        id: "doc-2",
        type: "document",
        source: { type: "url", value: "about:blank", mimeType: "text/csv" },
        filename: "launch-tasks.csv",
        size: 12_288,
        status: "ready",
      },
    ],
  },
};

/** Audio renders as a chip: a play/pause badge, the filename and duration. */
export const Audio: Story = {
  args: { attachments: sampleAttachments.filter((a) => a.type === "audio") },
};

/** Uploads in flight show a spinner over a placeholder. */
export const Uploading: Story = {
  args: {
    attachments: sampleAttachments.map((a, i) =>
      i % 2 === 0 ? { ...a, status: "uploading" as const } : a,
    ),
  },
};
