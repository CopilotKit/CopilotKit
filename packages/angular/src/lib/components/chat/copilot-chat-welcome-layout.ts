import { InjectionToken } from "@angular/core";

/**
 * Which welcome screen `CopilotChatView` renders. `CopilotPopup` and
 * `CopilotSidebar` provide theirs, as React's popup and sidebar views do:
 * the message centered, the suggestions and input at the bottom.
 */
export const COPILOT_CHAT_WELCOME_LAYOUT = new InjectionToken<
  "default" | "popup" | "sidebar"
>("COPILOT_CHAT_WELCOME_LAYOUT");
