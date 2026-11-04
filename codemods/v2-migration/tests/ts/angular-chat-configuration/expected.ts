import { Injectable } from "@angular/core";
import { CopilotChatConfiguration as BaseConfiguration } from "@copilotkit/angular";

@Injectable()
export class RoutedChatConfiguration extends BaseConfiguration {
  openFromRoute(threadId: string) {
    this.setActiveThreadId(threadId, { explicit: true });
  }

  resetFromRoute(threadId: string, explicit: boolean) {
    this.setActiveThreadId(threadId, { explicit });
  }
}

@Injectable()
export class AuditedChatConfiguration extends BaseConfiguration {
  // TODO(copilotkit-2.0): `CopilotChatConfiguration._setOverride` was removed in 2.0, and `setActiveThreadId` and `startNewThread` do not call it. Override those methods instead. See https://docs.copilotkit.ai/migrate/chat-2.0#chat-configuration
  protected override _setOverride(threadId: string, explicit: boolean): void {
    console.log("thread", threadId, explicit);
    super._setOverride(threadId, explicit);
  }
}

class Unrelated {
  _setOverride(value: string, flag: boolean) {
    return [value, flag];
  }

  run() {
    return this._setOverride("a", true);
  }
}
