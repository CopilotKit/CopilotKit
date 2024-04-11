import { Message } from "@copilotkit/shared";
import { COPILOT_CLOUD_API_URL } from "./constants";

export interface CloudLogChatResponse {
  message: Message;
}

const COPILOT_CLOUD_LOG_CHAT_URL = `${COPILOT_CLOUD_API_URL}/api/copilotkit/chat/log`;

export async function cloudLogChat(apiKey: string, forwardedProps: any): Promise<string> {
  const response = await fetch(COPILOT_CLOUD_LOG_CHAT_URL, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `ApiKey ${apiKey}`,
    },
    body: JSON.stringify(forwardedProps),
  });
  if (!response.ok) {
    let message = response.statusText;
    try {
      const json = await response.json();
      if (json.message) {
        message = json.message;
      }
    } catch (error) {}
    throw new Error("Failed to log chat message: " + message);
  }
  const json = await response.json();
  return json.status;
}
