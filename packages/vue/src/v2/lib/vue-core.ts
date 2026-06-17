import { nextTick } from "vue";
import type {
  VueActivityMessageRenderer,
  VueToolCallRenderer,
  VueCustomMessageRenderer,
} from "../types";
import type { InterruptRenderProps } from "../types/interrupt";
import { CopilotKitCore } from "@copilotkit/core";
import type {
  CopilotKitCoreConfig,
  CopilotKitCoreSubscriber,
  CopilotKitCoreSubscription,
} from "@copilotkit/core";

export interface CopilotKitCoreVueConfig extends CopilotKitCoreConfig {
  renderToolCalls?: VueToolCallRenderer<unknown>[];
  renderActivityMessages?: VueActivityMessageRenderer<unknown>[];
  renderCustomMessages?: VueCustomMessageRenderer[];
}

export interface CopilotKitCoreVueSubscriber extends CopilotKitCoreSubscriber {
  onRenderToolCallsChanged?: (event: {
    copilotkit: CopilotKitCoreVue;
    renderToolCalls: VueToolCallRenderer<unknown>[];
  }) => void | Promise<void>;
  onRenderCustomMessagesChanged?: (event: {
    copilotkit: CopilotKitCoreVue;
    renderCustomMessages: VueCustomMessageRenderer[];
  }) => void | Promise<void>;
  onInterruptStateChanged?: (event: {
    copilotkit: CopilotKitCoreVue;
    interruptState: InterruptRenderProps<unknown, unknown> | null;
  }) => void | Promise<void>;
}

export class CopilotKitCoreVue extends CopilotKitCore {
  private _renderToolCalls: VueToolCallRenderer<unknown>[] = [];
  private _hookRenderToolCalls: Map<string, VueToolCallRenderer<unknown>> =
    new Map();
  private _cachedMergedRenderToolCalls: VueToolCallRenderer<unknown>[] | null =
    null;
  private _renderCustomMessages: VueCustomMessageRenderer[] = [];
  private _renderActivityMessages: VueActivityMessageRenderer<unknown>[] = [];
  private _interruptState: InterruptRenderProps<unknown, unknown> | null = null;

  constructor(config: CopilotKitCoreVueConfig) {
    super(config);
    this._renderToolCalls = config.renderToolCalls ?? [];
    this._renderCustomMessages = config.renderCustomMessages ?? [];
    this._renderActivityMessages = config.renderActivityMessages ?? [];
  }

  get renderCustomMessages(): Readonly<VueCustomMessageRenderer[]> {
    return this._renderCustomMessages;
  }

  get renderActivityMessages(): Readonly<
    VueActivityMessageRenderer<unknown>[]
  > {
    return this._renderActivityMessages;
  }

  setRenderActivityMessages(
    renderers: VueActivityMessageRenderer<unknown>[],
  ): void {
    this._renderActivityMessages = [...renderers];
  }

  setRenderCustomMessages(renderers: VueCustomMessageRenderer[]): void {
    this._renderCustomMessages = [...renderers];
    void this.notifySubscribers((subscriber) => {
      const vueSubscriber = subscriber as CopilotKitCoreVueSubscriber;
      vueSubscriber.onRenderCustomMessagesChanged?.({
        copilotkit: this,
        renderCustomMessages: [...this.renderCustomMessages],
      });
    }, "Subscriber onRenderCustomMessagesChanged error:");
  }

  get propRenderToolCalls(): Readonly<VueToolCallRenderer<unknown>[]> {
    return this._renderToolCalls;
  }

  get renderToolCalls(): Readonly<VueToolCallRenderer<unknown>[]> {
    if (this._hookRenderToolCalls.size === 0) {
      return this._renderToolCalls;
    }
    if (this._cachedMergedRenderToolCalls) {
      return this._cachedMergedRenderToolCalls;
    }
    const merged = new Map<string, VueToolCallRenderer<unknown>>();
    for (const rc of this._renderToolCalls) {
      merged.set(`${rc.agentId ?? ""}:${rc.name}`, rc);
    }
    for (const [key, rc] of this._hookRenderToolCalls) {
      merged.set(key, rc);
    }
    this._cachedMergedRenderToolCalls = Array.from(merged.values());
    return this._cachedMergedRenderToolCalls;
  }

  get interruptState(): InterruptRenderProps<unknown, unknown> | null {
    return this._interruptState;
  }

  setRenderToolCalls(renderToolCalls: VueToolCallRenderer<unknown>[]): void {
    this._renderToolCalls = [...renderToolCalls];
    this._cachedMergedRenderToolCalls = null;
    this._notifyRenderToolCallsChanged();
  }

  addHookRenderToolCall(entry: VueToolCallRenderer<unknown>): void {
    const key = `${entry.agentId ?? ""}:${entry.name}`;
    this._hookRenderToolCalls.set(key, entry);
    this._cachedMergedRenderToolCalls = null;
    this._notifyRenderToolCallsChanged();
  }

  removeHookRenderToolCall(name: string, agentId?: string): void {
    const key = `${agentId ?? ""}:${name}`;
    if (this._hookRenderToolCalls.delete(key)) {
      this._cachedMergedRenderToolCalls = null;
      this._notifyRenderToolCallsChanged();
    }
  }

  private _notifyRenderToolCallsChanged(): void {
    void this.notifySubscribers((subscriber) => {
      const vueSubscriber = subscriber as CopilotKitCoreVueSubscriber;
      if (vueSubscriber.onRenderToolCallsChanged) {
        vueSubscriber.onRenderToolCallsChanged({
          copilotkit: this,
          renderToolCalls: [...this.renderToolCalls],
        });
      }
    }, "Subscriber onRenderToolCallsChanged error:");
  }

  setInterruptState(
    interruptState: InterruptRenderProps<unknown, unknown> | null,
  ): void {
    this._interruptState = interruptState;
    void this.notifySubscribers((subscriber) => {
      const vueSubscriber = subscriber as CopilotKitCoreVueSubscriber;
      vueSubscriber.onInterruptStateChanged?.({
        copilotkit: this,
        interruptState: this._interruptState,
      });
    }, "Subscriber onInterruptStateChanged error:");
  }

  subscribe(
    subscriber: CopilotKitCoreVueSubscriber,
  ): CopilotKitCoreSubscription {
    return super.subscribe(subscriber);
  }

  async waitForPendingFrameworkUpdates(): Promise<void> {
    await nextTick();
  }
}
