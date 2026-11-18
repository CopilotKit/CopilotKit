/**
 * CSS for what only Angular renders: the components' host elements and a few
 * Angular-only parts. A custom element is inline by default, and React renders
 * no element in its place, so the shared CSS in `@copilotkit/core` does not
 * cover it.
 *
 * Every component that needs it lists this string in `styles`. Angular adds
 * one copy, also when `injectStyles` is `false`. The rules meet the app's CSS
 * the same way as the shared CSS: the theme variables are in the `base` layer,
 * and the other rules are outside cascade layers, with the specificity of two
 * element selectors. A global reset loses to them, and a class the app sets on
 * the element wins.
 */
export const hostStyles = `
@layer theme, base, components, utilities;
@layer base {
  :where(.dark [data-copilotkit], [data-copilotkit].dark) {
    --copilot-kit-error-background: #7f1d1d;
    --copilot-kit-error-border: #dc2626;
    --copilot-kit-error-text: #fca5a5;
  }
}
html body :where(
  copilot-chat,
  copilot-chat-view,
  copilot-chat-input,
  copilot-chat-message-view,
  copilot-chat-user-message,
  copilot-chat-assistant-message,
  copilot-chat-reasoning-message,
  copilot-chat-suggestion-view,
  copilot-chat-attachment-queue
) {
  display: block;
}
html body :where(copilot-chat, copilot-chat-view) {
  height: 100%;
  min-height: 0;
}
html body :where(
  copilot-chat-input,
  copilot-chat-user-message,
  copilot-chat-assistant-message
) {
  width: 100%;
}
/* <div copilotChatToolbar> */
html body :where(.copilot-chat-toolbar) {
  display: flex;
  width: 100%;
  height: 60px;
  align-items: center;
  justify-content: space-between;
  background-color: transparent;
}
`;
