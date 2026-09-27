import type { Meta, StoryObj } from "@storybook/angular";
import { moduleMetadata } from "@storybook/angular";
import { CopilotChatAttachmentRenderer } from "@copilotkit/angular";
import { sampleImageBase64, silentWavBase64 } from "./support/fixtures";
import { withMessageColumn } from "./support/layouts";
import { recordSampleVideoUrl } from "./support/media";

/** How a sent attachment renders inside a message. */
const meta: Meta<CopilotChatAttachmentRenderer> = {
  title: "UI/CopilotChatAttachmentRenderer",
  component: CopilotChatAttachmentRenderer,
  decorators: [
    moduleMetadata({ imports: [CopilotChatAttachmentRenderer] }),
    withMessageColumn,
  ],
  render: (args) => ({
    props: args,
    template: `
      <copilot-chat-attachment-renderer
        [type]="type"
        [source]="source"
        [filename]="filename"
      />
    `,
  }),
};

export default meta;
type Story = StoryObj<CopilotChatAttachmentRenderer>;

export const Image: Story = {
  args: {
    type: "image",
    source: {
      type: "data",
      value: sampleImageBase64(210),
      mimeType: "image/svg+xml",
    },
  },
};

export const Document: Story = {
  args: {
    type: "document",
    source: { type: "url", value: "about:blank", mimeType: "application/pdf" },
    filename: "Q3-launch-plan.pdf",
  },
};

export const Audio: Story = {
  args: {
    type: "audio",
    source: { type: "data", value: silentWavBase64(), mimeType: "audio/wav" },
    filename: "voice-note.wav",
  },
};

/** A short clip recorded in the browser, so no network asset is needed. */
export const Video: Story = {
  loaders: [async () => ({ videoUrl: await recordSampleVideoUrl() })],
  render: (args, { loaded }) => ({
    props: {
      type: "video",
      source: {
        type: "url",
        value: (loaded["videoUrl"] as string | undefined) ?? "",
        mimeType: "video/webm",
      },
    },
    template: `<copilot-chat-attachment-renderer [type]="type" [source]="source" />`,
  }),
};

/** An image that fails to load falls back to an inline error. */
export const ImageLoadError: Story = {
  args: {
    type: "image",
    source: { type: "data", value: "bm90LWFuLWltYWdl", mimeType: "image/png" },
  },
};

/** Every attachment type a message can carry, stacked. */
export const AllTypes: Story = {
  render: () => ({
    props: {
      image: {
        type: "data",
        value: sampleImageBase64(210),
        mimeType: "image/svg+xml",
      },
      document: {
        type: "url",
        value: "about:blank",
        mimeType: "application/pdf",
      },
      audio: { type: "data", value: silentWavBase64(), mimeType: "audio/wav" },
    },
    template: `
      <div class="story-stack">
        <copilot-chat-attachment-renderer type="image" [source]="image" />
        <copilot-chat-attachment-renderer type="document" [source]="document" filename="Q3-launch-plan.pdf" />
        <copilot-chat-attachment-renderer type="audio" [source]="audio" filename="voice-note.wav" />
      </div>
    `,
  }),
};
