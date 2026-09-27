import type { Meta, StoryObj } from "@storybook/angular";
import { moduleMetadata } from "@storybook/angular";
import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from "@angular/core";
import { fn } from "storybook/test";
import { ChatState, CopilotChatInput } from "@copilotkit/angular";
import type { ToolsMenuItem } from "@copilotkit/angular";
import { CustomSendButtonComponent } from "../components/custom-send-button.component";
import { withFakeMicrophone } from "./support/fake-microphone";
import { withCenteredStage } from "./support/layouts";
import { StoryChatState } from "./support/story-chat-state";

/** A send button an app might pass as `sendButtonComponent`. */
@Component({
  selector: "story-arrow-send-button",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      class="story-send-button"
      aria-label="Send message"
      [disabled]="disabled()"
      (click)="clicked.emit()"
    >
      Send <span aria-hidden="true">→</span>
    </button>
  `,
})
class StoryArrowSendButton {
  readonly disabled = input(false);
  readonly clicked = output<void>();
}

const toolsMenu: (ToolsMenuItem | "-")[] = [
  { label: "Summarize page", action: () => console.info("[Storybook] tool") },
  { label: "Translate", action: () => console.info("[Storybook] tool") },
  "-",
  {
    label: "Advanced",
    items: [
      {
        label: "Export thread",
        action: () => console.info("[Storybook] tool"),
      },
      { label: "Clear memory", action: () => console.info("[Storybook] tool") },
    ],
  },
];

const meta: Meta<CopilotChatInput> = {
  title: "UI/CopilotChatInput",
  component: CopilotChatInput,
  decorators: [
    moduleMetadata({
      imports: [
        CopilotChatInput,
        CustomSendButtonComponent,
        StoryArrowSendButton,
      ],
      providers: [{ provide: ChatState, useClass: StoryChatState }],
    }),
    withCenteredStage,
  ],
  argTypes: {
    mode: {
      control: "inline-radio",
      options: ["input", "transcribe", "processing"],
    },
  },
  args: {
    mode: "input",
    value: "",
    autoFocus: false,
    toolsMenu: undefined,
    inputClass: undefined,
  },
  render: (args) => ({
    props: {
      ...args,
      submitMessage: fn(),
      addFile: fn(),
      valueChange: fn(),
    },
    template: `
      <copilot-chat-input
        [mode]="mode"
        [inputClass]="inputClass"
        [toolsMenu]="toolsMenu"
        [value]="value"
        [autoFocus]="autoFocus"
        (submitMessage)="submitMessage($event)"
        (addFile)="addFile()"
        (valueChange)="valueChange($event)"
      />
    `,
  }),
};

export default meta;
type Story = StoryObj<CopilotChatInput>;

export const Default: Story = {};

/** A run in flight (`mode="processing"`): the input is disabled until it finishes. */
export const Running: Story = {
  args: { mode: "processing" },
};

export const WithMenuItems: Story = {
  name: "With Menu Items",
  args: { toolsMenu },
};

/** Recording from a synthetic microphone, so no permission prompt appears. */
export const TranscribeMode: Story = {
  name: "Transcribe Mode",
  args: { mode: "transcribe" },
  decorators: [withFakeMicrophone],
};

export const PrefilledText: Story = {
  name: "Prefilled Text",
  args: { value: "Hello, this is a prefilled message!" },
};

export const ExpandedTextarea: Story = {
  name: "Expanded Textarea",
  args: {
    value:
      "This is a longer message that shows how the textarea grows.\n\nIt has multiple lines to demonstrate the auto-resize behavior.\n\nThe textarea grows up to its max rows, then scrolls.",
  },
};

/** Host CSS applied through `inputClass`, the way an app would restyle it. */
export const CustomStyling: Story = {
  name: "Custom Styling",
  args: { inputClass: "story-branded-input" },
};

export const WithAdditionalToolbarItems: Story = {
  name: "With Additional Toolbar Items",
  render: () => ({
    props: { onAction: fn() },
    template: `
      <ng-template #additionalItems>
        <button type="button" class="story-icon-button" title="Add emoji" (click)="onAction('emoji')">☺</button>
        <button type="button" class="story-icon-button" title="Mention" (click)="onAction('mention')">@</button>
      </ng-template>
      <copilot-chat-input [additionalToolbarItems]="additionalItems" />
    `,
  }),
};

/** `#sendButton` template slot: full control over markup and behavior. */
export const CustomSendButton: Story = {
  name: "Custom Send Button (Template Slot)",
  render: () => ({
    props: { submitMessage: fn() },
    template: `
      <copilot-chat-input (submitMessage)="submitMessage($event)">
        <ng-template #sendButton let-send="send" let-disabled="disabled">
          <button type="button" class="story-send-button" [disabled]="disabled" (click)="send()">
            Send
          </button>
        </ng-template>
      </copilot-chat-input>
    `,
  }),
};

/** The input driven from host state: `[value]` in, `(valueChange)` out. */
export const ControlledInputExample: Story = {
  render: () => ({
    props: {
      value: "Draft: ship the beta on July 8",
      setValue(this: { value: string }, next: string) {
        this.value = next;
      },
    },
    template: `
      <p class="story-note">Host value: <code>{{ value || "(empty)" }}</code></p>
      <copilot-chat-input [value]="value" (valueChange)="setValue($event)" />
      <p class="story-note" style="margin-top: 0.75rem">
        <button type="button" class="story-send-button" (click)="setValue('')">Clear from host</button>
      </p>
    `,
  }),
};

/** A reusable component rendered inside the `#sendButton` template slot. */
export const SlotWithComponent: Story = {
  name: "Slot: Using Custom Component",
  render: () => ({
    props: { submitMessage: fn() },
    template: `
      <copilot-chat-input (submitMessage)="submitMessage($event)">
        <ng-template #sendButton let-send="send" let-disabled="disabled">
          <custom-send-button [disabled]="disabled" (clicked)="send()" />
        </ng-template>
      </copilot-chat-input>
    `,
  }),
};

/** Passing a component class through `sendButtonComponent`. */
export const SlotDirectComponent: Story = {
  name: "Slot: Direct Component",
  render: () => ({
    props: { SendButton: StoryArrowSendButton, submitMessage: fn() },
    template: `
      <copilot-chat-input
        [sendButtonComponent]="SendButton"
        (submitMessage)="submitMessage($event)"
      />
    `,
  }),
};

/** Toolbar items and a custom send button together. */
export const SlotMultipleCustomizations: Story = {
  name: "Slot: Multiple Customizations",
  render: (args) => ({
    props: { ...args, onAction: fn(), submitMessage: fn() },
    template: `
      <ng-template #additionalItems>
        <button type="button" class="story-icon-button" title="Attach link" (click)="onAction('link')">🔗</button>
      </ng-template>
      <copilot-chat-input
        [additionalToolbarItems]="additionalItems"
        [toolsMenu]="toolsMenu"
        (submitMessage)="submitMessage($event)"
      >
        <ng-template #sendButton let-send="send" let-disabled="disabled">
          <custom-send-button [disabled]="disabled" (clicked)="send()" />
        </ng-template>
      </copilot-chat-input>
    `,
  }),
  args: { toolsMenu },
};

const markdownDraft = `Can you review this plan? It covers three things:
- migrate the chat to the v2 components
- update the [upgrade guide](https://docs.copilotkit.ai)
- link the demo at https://copilotkit.ai`;

/**
 * The composer styles list markers and links as you type, with the syntax
 * dimmed but still editable. Set `highlightMarkdown` to `false` for plain text.
 */
export const MarkdownDraft: Story = {
  args: { value: markdownDraft },
};

const CONTAINER_WIDTHS = [280, 340, 400, 520];
const WIDTH_DRAFT =
  "Summarize the launch thread and list owners for each open item";

/**
 * The input sizes itself by its container, not the viewport: a single short
 * row while the text fits, the text on its own full-width row once it wraps,
 * and voice input folded into the "+" menu under ~320px.
 */
export const ContainerWidths: Story = {
  parameters: { layout: "fullscreen" },
  render: () => ({
    props: { widths: CONTAINER_WIDTHS, draft: WIDTH_DRAFT },
    template: `
      <div class="story-widths">
        @for (width of widths; track width) {
          <div class="story-widths-column" [style.width.px]="width">
            <div class="story-widths-label">{{ width }}px</div>
            <copilot-chat-input value="" [autoFocus]="false" />
            <copilot-chat-input [value]="draft" [autoFocus]="false" />
          </div>
        }
      </div>
    `,
  }),
};
