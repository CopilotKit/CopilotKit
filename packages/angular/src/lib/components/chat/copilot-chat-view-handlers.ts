import { Injectable, signal } from "@angular/core";

@Injectable({ providedIn: "root" })
export class CopilotChatViewHandlers {
  // Assistant message handler availability
  hasAssistantThumbsUpHandler = signal(false);
  hasAssistantThumbsDownHandler = signal(false);
  hasAssistantReadAloudHandler = signal(false);
  hasAssistantRegenerateHandler = signal(false);

  // User message handler availability
  hasUserCopyHandler = signal(false);
  hasUserEditHandler = signal(false);
}
