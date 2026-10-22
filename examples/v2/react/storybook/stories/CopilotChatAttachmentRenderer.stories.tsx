import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { CopilotChatAttachmentRenderer } from "@copilotkit/react-core/v2";
import type { Attachment } from "@copilotkit/react-core/v2";
import { withMessageColumn } from "./support/layouts";
import {
  audioAttachment,
  imageAttachment,
  pdfAttachment,
  recordSampleVideoUrl,
  videoAttachment,
} from "./support/media";

/** The renderer props for a sample attachment. */
const rendererProps = ({ type, source, filename }: Attachment) => ({
  type,
  source,
  filename,
});

/**
 * Renders one attachment inside a sent message: image thumbnails (click to
 * open the lightbox), native audio and video players, and download chips for
 * documents.
 */
const meta = {
  title: "UI/CopilotChatAttachmentRenderer",
  component: CopilotChatAttachmentRenderer,
  decorators: [withMessageColumn],
  parameters: {
    layout: "fullscreen",
  },
  args: {
    type: "image",
    source: imageAttachment("image", [260, 320]).source,
  },
} satisfies Meta<typeof CopilotChatAttachmentRenderer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Image: Story = {};

/** An image whose source cannot be decoded falls back to a placeholder. */
export const ImageLoadError: Story = {
  args: {
    source: { type: "data", mimeType: "image/png", value: "bm90IGFuIGltYWdl" },
  },
};

export const Document: Story = {
  args: rendererProps(pdfAttachment),
};

export const Audio: Story = {
  args: rendererProps(audioAttachment),
};

export const Video: Story = {
  args: { type: "video" },
  loaders: [async () => ({ videoUrl: await recordSampleVideoUrl() })],
  render: (args, { loaded }) => (
    <CopilotChatAttachmentRenderer
      {...args}
      source={videoAttachment(loaded.videoUrl as string | undefined).source}
    />
  ),
};

/** How the types sit together in a user message. */
export const AllTypes: Story = {
  loaders: Video.loaders,
  render: (_args, { loaded }) => (
    <div className="flex flex-col items-end gap-3">
      <div className="flex gap-2">
        <CopilotChatAttachmentRenderer
          {...rendererProps(imageAttachment("image-1", [260, 320]))}
        />
        <CopilotChatAttachmentRenderer
          {...rendererProps(imageAttachment("image-2", [20, 350]))}
        />
      </div>
      <CopilotChatAttachmentRenderer {...rendererProps(pdfAttachment)} />
      <CopilotChatAttachmentRenderer {...rendererProps(audioAttachment)} />
      <CopilotChatAttachmentRenderer
        {...rendererProps(
          videoAttachment(loaded.videoUrl as string | undefined),
        )}
      />
    </div>
  ),
};
