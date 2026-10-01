import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { CopilotChatAttachmentRenderer } from "@copilotkit/vue";
import { withCopilotKitRoot, withMessageColumn } from "./support/layouts";
import {
  recordSampleVideoUrl,
  sampleAudioBase64,
  sampleImageBase64,
  samplePdfBase64,
} from "./support/media";

/**
 * Renders one attachment inside a sent message: image thumbnails, native audio
 * and video players, and download chips for documents.
 */
const meta = {
  title: "UI/CopilotChatAttachmentRenderer",
  component: CopilotChatAttachmentRenderer,
  decorators: [withCopilotKitRoot, withMessageColumn],
  parameters: {
    layout: "fullscreen",
  },
  args: {
    type: "image",
    source: {
      type: "data",
      mimeType: "image/svg+xml",
      value: sampleImageBase64(260, 320),
    },
  },
  render: (args) => ({
    components: { CopilotChatAttachmentRenderer },
    setup() {
      return { args };
    },
    template: `<CopilotChatAttachmentRenderer v-bind="args" />`,
  }),
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
  args: {
    type: "document",
    source: {
      type: "data",
      mimeType: "application/pdf",
      value: samplePdfBase64,
    },
    filename: "Q3-launch-plan.pdf",
  },
};

export const Audio: Story = {
  args: {
    type: "audio",
    source: { type: "data", mimeType: "audio/wav", value: sampleAudioBase64 },
    filename: "voice-memo.wav",
  },
};

export const Video: Story = {
  args: { type: "video" },
  loaders: [async () => ({ videoUrl: await recordSampleVideoUrl() })],
  render: (args, { loaded }) => ({
    components: { CopilotChatAttachmentRenderer },
    setup() {
      return {
        args,
        source: {
          type: "url",
          mimeType: "video/webm",
          value: (loaded.videoUrl as string | undefined) ?? "",
        },
      };
    },
    template: `<CopilotChatAttachmentRenderer v-bind="args" :source="source" />`,
  }),
};

/** How the types sit together in a user message. */
export const AllTypes: Story = {
  loaders: Video.loaders,
  render: (_args, { loaded }) => ({
    components: { CopilotChatAttachmentRenderer },
    setup() {
      return {
        imageA: {
          type: "data",
          mimeType: "image/svg+xml",
          value: sampleImageBase64(260, 320),
        },
        imageB: {
          type: "data",
          mimeType: "image/svg+xml",
          value: sampleImageBase64(20, 350),
        },
        pdf: {
          type: "data",
          mimeType: "application/pdf",
          value: samplePdfBase64,
        },
        audio: {
          type: "data",
          mimeType: "audio/wav",
          value: sampleAudioBase64,
        },
        video: {
          type: "url",
          mimeType: "video/webm",
          value: (loaded.videoUrl as string | undefined) ?? "",
        },
      };
    },
    template: `
      <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 12px">
        <div style="display: flex; gap: 8px">
          <CopilotChatAttachmentRenderer type="image" :source="imageA" />
          <CopilotChatAttachmentRenderer type="image" :source="imageB" />
        </div>
        <CopilotChatAttachmentRenderer type="document" :source="pdf" filename="Q3-launch-plan.pdf" />
        <CopilotChatAttachmentRenderer type="audio" :source="audio" filename="voice-memo.wav" />
        <CopilotChatAttachmentRenderer type="video" :source="video" />
      </div>
    `,
  }),
};
