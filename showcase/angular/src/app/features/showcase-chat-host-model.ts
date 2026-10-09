interface ChatInputController {
  changeInput(value: string): void;
}

/** Update the signal-backed chat composer when its controller is available. */
export function populateChatInput(
  chat: ChatInputController | undefined,
  value: string,
): boolean {
  if (!chat) return false;
  chat.changeInput(value);
  return true;
}
