import { defineComponent, ref } from "vue";
import type { PropType } from "vue";
import type { Decorator, Meta, StoryObj } from "@storybook/vue3-vite";
import { CopilotChatAttachmentQueue } from "@copilotkit/vue";
import type { Attachment } from "@copilotkit/vue";
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
 * Removing an item emits `remove-attachment`; these stories keep the list in
 * local state so the remove buttons work. Click an image, video or previewable
 * document to open it in the lightbox.
 *
 * Attachments are either `uploading` or `ready`: there is no error state, since
 * failed uploads are reported through `onUploadFailed` and never queued.
 */
const QueueDemo = defineComponent({
  name: "QueueDemo",
  components: { CopilotChatAttachmentQueue },
  props: {
    attachments: {
      type: Array as PropType<Attachment[]>,
      required: true,
    },
  },
  setup(props) {
    const items = ref<Attachment[]>([...props.attachments]);
    const remove = (id: string) => {
      items.value = items.value.filter((attachment) => attachment.id !== id);
    };
    const restore = () => {
      items.value = [...props.attachments];
    };
    return { items, remove, restore };
  },
  template: `
    <button
      v-if="items.length === 0"
      type="button"
      class="story-button"
      @click="restore"
    >
      All removed. Restore attachments
    </button>
    <CopilotChatAttachmentQueue
      v-else
      :attachments="items"
      @remove-attachment="remove"
    />
  `,
});

/** The queue as it sits in the composer, above the text. */
const withComposerFrame: Decorator = (story) => ({
  components: { story },
  template: `
    <div class="story-stage">
      <div class="story-composer-frame">
        <story />
        <p class="story-composer-frame__placeholder">Type a message...</p>
      </div>
    </div>
  `,
});

const meta = {
  title: "UI/CopilotChatAttachmentQueue",
  component: CopilotChatAttachmentQueue,
  decorators: [withComposerFrame],
  parameters: {
    layout: "fullscreen",
  },
  args: {
    attachments: [],
  },
  render: (args) => ({
    components: { QueueDemo },
    setup() {
      return { args };
    },
    template: `<QueueDemo :attachments="args.attachments" />`,
  }),
} satisfies Meta<typeof CopilotChatAttachmentQueue>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Every modality side by side. */
export const Mixed: Story = {
  loaders: [async () => ({ videoUrl: await recordSampleVideoUrl() })],
  render: (_args, { loaded }) => ({
    components: { QueueDemo },
    setup() {
      return {
        attachments: [
          imageAttachment("image-1", [260, 320]),
          videoAttachment(loaded.videoUrl as string | undefined),
          pdfAttachment,
          audioAttachment,
        ],
      };
    },
    template: `<QueueDemo :attachments="attachments" />`,
  }),
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
