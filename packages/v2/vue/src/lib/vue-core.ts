import type {
  VueActivityMessageRenderer,
  VueToolCallRenderer,
  VueCustomMessageRenderer,
} from "../types";
import type { InterruptRenderProps } from "../types/interrupt";
import {
  CopilotKitCore,
  type CopilotKitCoreConfig,
  type CopilotKitCoreSubscriber,
  type CopilotKitCoreSubscription,
} from "@copilotkitnext/core";

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
  onInterruptStateChanged?: (event: {
    copilotkit: CopilotKitCoreVue;
    interruptState: InterruptRenderProps<unknown, unknown> | null;
  }) => void | Promise<void>;
}

export class CopilotKitCoreVue extends CopilotKitCore {
  private _renderToolCalls: VueToolCallRenderer<unknown>[] = [];
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
    VueActivityMessageRenderer<unknown>
  >[] {
    return this._renderActivityMessages;
  }

  get renderToolCalls(): Readonly<VueToolCallRenderer<unknown>[]> {
    return this._renderToolCalls;
  }

  get interruptState(): InterruptRenderProps<unknown, unknown> | null {
    return this._interruptState;
  }

  setRenderToolCalls(renderToolCalls: VueToolCallRenderer<unknown>[]): void {
    this._renderToolCalls = [...renderToolCalls];
    void this.notifySubscribers((subscriber) => {
      const vueSubscriber = subscriber as CopilotKitCoreVueSubscriber;
      if (vueSubscriber.onRenderToolCallsChanged) {
        vueSubscriber.onRenderToolCallsChanged({
          copilotkit: this,
          renderToolCalls: [...this._renderToolCalls],
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
}
