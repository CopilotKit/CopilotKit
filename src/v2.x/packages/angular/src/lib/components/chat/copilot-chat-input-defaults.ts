import { CopilotChatTextarea } from "./copilot-chat-textarea";
import { CopilotChatAudioRecorder } from "./copilot-chat-audio-recorder";
import {
  CopilotChatSendButton,
  CopilotChatStartTranscribeButton,
  CopilotChatCancelTranscribeButton,
  CopilotChatFinishTranscribeButton,
  CopilotChatAddFileButton,
} from "./copilot-chat-buttons";
import { CopilotChatToolbar } from "./copilot-chat-toolbar";
import { CopilotChatToolsMenu } from "./copilot-chat-tools-menu";

/**
 * Default components used by CopilotChatInput.
 * These can be imported and reused when creating custom slot implementations.
 *
 * @example
 * ```typescript
 * import { CopilotChatInputDefaults } from '@copilotkitnext/angular';
 *
 * @Component({
  standalone: true,
*   template: `
 *     <copilot-chat-input [sendButtonSlot]="CustomSendButton">
 *     </copilot-chat-input>
 *   `
 * })
 * export class MyComponent {
 *   CustomSendButton = class extends CopilotChatInputDefaults.SendButton {
 *     // Custom implementation
 *   };
 * }
 * ```
 */
export class CopilotChatInputDefaults {
  static readonly TextArea = CopilotChatTextarea;
  static readonly AudioRecorder = CopilotChatAudioRecorder;
  static readonly SendButton = CopilotChatSendButton;
  static readonly StartTranscribeButton = CopilotChatStartTranscribeButton;
  static readonly CancelTranscribeButton = CopilotChatCancelTranscribeButton;
  static readonly FinishTranscribeButton = CopilotChatFinishTranscribeButton;
  static readonly AddFileButton = CopilotChatAddFileButton;
  static readonly Toolbar = CopilotChatToolbar;
  static readonly ToolsMenu = CopilotChatToolsMenu;
}
