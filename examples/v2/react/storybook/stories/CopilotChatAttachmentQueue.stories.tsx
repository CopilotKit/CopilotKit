import React, { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { CopilotChatAttachmentQueue } from "@copilotkit/react-core/v2";
import type { Attachment } from "@copilotkit/react-core/v2";
import {
  audioAttachment,
  docAttachment,
  imageAttachment,
  pdfAttachment,
  recordSampleVideoUrl,
  spreadsheetAttachment,
  textAttachment,
  videoAttachment,
} from "./support/media";

/**
 * Pending attachments shown above the chat input before a message is sent.
 * Removing an item calls `onRemoveAttachment`; these stories keep the list in
 * local state so the remove buttons work. Click an image, video or previewable
 * document to open it in the lightbox.
 *
 * Attachments are either `uploading` or `ready`: there is no error state, since
 * failed uploads are reported through `onUploadFailed` and never queued.
 */
const QueueDemo: React.FC<{ attachments: Attachment[] }> = ({
  attachments: initial,
}) => {
  const [attachments, setAttachments] = useState(initial);
  if (attachments.length === 0) {
    return (
      <button
        type="button"
        onClick={() => setAttachments(initial)}
        className="px-4 pt-3 text-sm text-muted-foreground underline underline-offset-4"
      >
        All removed. Restore attachments
      </button>
    );
  }
  return (
    <CopilotChatAttachmentQueue
      attachments={attachments}
      onRemoveAttachment={(id) =>
        setAttachments((current) => current.filter((a) => a.id !== id))
      }
    />
  );
};

/** Frames the queue the way it sits in the composer, above the text area. */
const withComposerFrame = (Story: React.ComponentType) => (
  <div className="flex min-h-screen items-center justify-center p-6">
    <div className="w-full max-w-2xl rounded-2xl border border-border bg-card shadow-sm">
      <Story />
      <p className="px-4 pb-3 pt-1 text-sm text-muted-foreground">
        Type a message...
      </p>
    </div>
  </div>
);

const meta = {
  title: "UI/CopilotChatAttachmentQueue",
  component: CopilotChatAttachmentQueue,
  decorators: [withComposerFrame],
  parameters: {
    layout: "fullscreen",
  },
  args: {
    attachments: [],
    onRemoveAttachment: () => {},
  },
  render: (args) => <QueueDemo attachments={args.attachments} />,
} satisfies Meta<typeof CopilotChatAttachmentQueue>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Every modality side by side. */
export const Mixed: Story = {
  loaders: [async () => ({ videoUrl: await recordSampleVideoUrl() })],
  render: (args, { loaded }) => (
    <QueueDemo
      attachments={[
        imageAttachment("image-1", [260, 320]),
        videoAttachment(loaded.videoUrl as string | undefined),
        pdfAttachment,
        audioAttachment,
      ]}
    />
  ),
};

export const Images: Story = {
  args: {
    attachments: [
      imageAttachment("image-1", [260, 320], "hero.png"),
      imageAttachment("image-2", [20, 350], "sunset.png"),
      imageAttachment("image-3", [150, 200], "coast.png"),
    ],
  },
};

/** Document chips: PDF and plain text open a preview, other types show an info card. */
export const Documents: Story = {
  args: {
    attachments: [
      pdfAttachment,
      textAttachment,
      spreadsheetAttachment,
      docAttachment,
    ],
  },
};

/** Uploads in flight show a spinner over the tile until they are ready. */
export const Uploading: Story = {
  args: {
    attachments: [
      { ...imageAttachment("image-1", [260, 320]), status: "uploading" },
      imageAttachment("image-2", [20, 350]),
      { ...pdfAttachment, status: "uploading" },
      { ...audioAttachment, status: "uploading" },
    ],
  },
};

/** Audio is a chip like documents: play/pause, the filename, then the duration. */
export const Audio: Story = {
  args: {
    attachments: [audioAttachment],
  },
};
