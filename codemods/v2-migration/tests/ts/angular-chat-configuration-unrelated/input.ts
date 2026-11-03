import { CopilotChatConfiguration } from "./local-configuration";
import { injectChatConfiguration } from "@copilotkit/angular";

export class LocalConfiguration extends CopilotChatConfiguration {
  open(threadId: string) {
    this._setOverride(threadId, true);
  }
}

export const config = injectChatConfiguration;
