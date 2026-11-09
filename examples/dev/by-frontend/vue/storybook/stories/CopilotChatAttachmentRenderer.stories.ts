import type { Meta, StoryObj } from "@storybook/vue3-vite";
import {
  CopilotChatAttachmentRenderer,
  CopilotChatConfigurationProvider,
} from "@copilotkit/vue";
import {
  audioAttachment,
  imageAttachment,
  pdfAttachment,
} from "./support/media";

/**
 * Renders one attachment inside a sent message: image thumbnails (click to
 * open the lightbox), native audio players, and download links for
 * documents. The same stories as the React storybook's.
 */
const meta = {
  title: "UI/CopilotChatAttachmentRenderer",
  component: CopilotChatAttachmentRenderer,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (story) => ({
      components: { story, CopilotChatConfigurationProvider },
      template: `
        <div style="margin: 0 auto; width: 100%; max-width: 42rem; padding: 2.5rem 1.5rem">
          <CopilotChatConfigurationProvider thread-id="storybook-thread">
            <story />
          </CopilotChatConfigurationProvider>
        </div>
      `,
    }),
  ],
  args: imageAttachment([260, 320]),
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
  args: pdfAttachment,
};

export const Audio: Story = {
  args: audioAttachment,
};

/** How the types sit together in a user message. */
export const AllTypes: Story = {
  render: () => ({
    components: { CopilotChatAttachmentRenderer },
    setup() {
      return {
        first: imageAttachment([260, 320], "image-1.png"),
        second: imageAttachment([20, 350], "image-2.png"),
        pdfAttachment,
        audioAttachment,
      };
    },
    template: `
      <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 0.75rem">
        <div style="display: flex; gap: 0.5rem">
          <CopilotChatAttachmentRenderer v-bind="first" />
          <CopilotChatAttachmentRenderer v-bind="second" />
        </div>
        <CopilotChatAttachmentRenderer v-bind="pdfAttachment" />
        <CopilotChatAttachmentRenderer v-bind="audioAttachment" />
      </div>
    `,
  }),
};
