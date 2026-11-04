import { Injectable } from "@angular/core";
import { CopilotChatConfiguration as BaseConfiguration } from "@copilotkit/angular";

@Injectable()
export class RoutedChatConfiguration extends BaseConfiguration {
  openFromRoute(threadId: string) {
    this._setOverride(threadId, true);
  }

  resetFromRoute(threadId: string, explicit: boolean) {
    this._setOverride(threadId, explicit);
  }
}

@Injectable()
export class AuditedChatConfiguration extends BaseConfiguration {
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
