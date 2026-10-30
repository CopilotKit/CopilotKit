import type { Meta, StoryObj } from "@storybook/angular";
import { moduleMetadata } from "@storybook/angular";
import type { Attachment } from "@copilotkit/angular";
import { CopilotChatAttachmentQueue } from "@copilotkit/angular";
import {
  audioAttachment,
  imageAttachment,
  pdfAttachment,
  recordSampleVideoUrl,
  videoAttachment,
} from "./support/media";

/**
 * Pending attachments shown above the chat input before a message is sent,
 * like React's story. Click an image, or a video's play button, to open it in
 * the lightbox. Escape, the close button, or a click on the backdrop closes it.
 */
const meta: Meta<{ attachments: Attachment[] }> = {
  title: "UI/CopilotChatAttachmentQueue",
  decorators: [moduleMetadata({ imports: [CopilotChatAttachmentQueue] })],
  parameters: { layout: "fullscreen" },
  render: (args, { loaded }) => {
    const videoUrl = loaded["videoUrl"] as string | undefined;
    return {
      props: {
        // The video goes second, as in React's story. It is left out where
        // this browser can't record the sample video.
        attachments: [
          ...args.attachments.slice(0, 1),
          ...(videoUrl ? [videoAttachment(videoUrl)] : []),
          ...args.attachments.slice(1),
        ],
      },
      template: `
        <div style="display: flex; min-height: 100vh; align-items: center; justify-content: center; padding: 1.5rem;">
          <div data-copilotkit style="width: 100%; max-width: 42rem; border: 1px solid var(--border); border-radius: 1rem; background: var(--card); box-shadow: 0 1px 2px #0000000d;">
            <copilot-chat-attachment-queue
              [attachments]="attachments"
              (removeAttachment)="attachments = attachments.filter(a => a.id !== $event)"
            />
            <p style="padding: 0.25rem 1rem 0.75rem; font-size: 0.875rem; color: var(--muted-foreground);">
              Type a message...
            </p>
          </div>
        </div>
      `,
    };
  },
};

export default meta;
type Story = StoryObj<{ attachments: Attachment[] }>;

/** Every modality side by side. */
export const Mixed: Story = {
  loaders: [async () => ({ videoUrl: await recordSampleVideoUrl() })],
  args: {
    attachments: [
      imageAttachment("image-1", [260, 320]),
      pdfAttachment,
      audioAttachment,
    ],
  },
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
