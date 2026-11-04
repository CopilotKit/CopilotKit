import { nextTick } from "vue";
import type {
  VueActivityMessageRenderer,
  VueToolCallRenderer,
  VueCustomMessageRenderer,
} from "../types";
import type { InterruptRenderProps } from "../types/interrupt";
import { CopilotKitCore, ɵRendererRegistry } from "@copilotkit/core";
import type {
  CopilotKitCoreConfig,
  CopilotKitCoreSubscriber,
  CopilotKitCoreSubscription,
  ɵRendererKind,
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
  onRenderActivityMessagesChanged?: (event: {
    copilotkit: CopilotKitCoreVue;
    renderActivityMessages: VueActivityMessageRenderer<unknown>[];
  }) => void | Promise<void>;
  onInterruptStateChanged?: (event: {
    copilotkit: CopilotKitCoreVue;
    interruptState: InterruptRenderProps<unknown, unknown> | null;
  }) => void | Promise<void>;
}

export class CopilotKitCoreVue extends CopilotKitCore {
  private readonly _renderers: ɵRendererRegistry<
    VueToolCallRenderer<unknown>,
    VueActivityMessageRenderer<unknown>,
    VueCustomMessageRenderer
  >;
  private _interruptState: InterruptRenderProps<unknown, unknown> | null = null;

  constructor(config: CopilotKitCoreVueConfig) {
    // Tool handlers can change reactive state. `nextTick` lets Vue flush those
    // updates before core starts the follow-up run.
    super({ ...config, ɵwaitForFrameworkUpdates: () => nextTick() });
    this._renderers = new ɵRendererRegistry({
      toolCalls: config.renderToolCalls,
      activity: config.renderActivityMessages,
      custom: config.renderCustomMessages,
    });
    this._renderers.subscribe((kind) => this.notifyRenderersChanged(kind));
  }

  get renderCustomMessages() {
    return this._renderers.custom;
  }

  get renderActivityMessages() {
    return this._renderers.activity;
  }

  setRenderActivityMessages(
    renderers: VueActivityMessageRenderer<unknown>[],
  ): void {
    this._renderers.setActivity(renderers);
  }

  setRenderCustomMessages(renderers: VueCustomMessageRenderer[]): void {
    this._renderers.setCustom(renderers);
  }

  /** The renderers the provider was given, without hook renderers. */
  get propRenderToolCalls() {
    return this._renderers.propToolCalls;
  }

  /** Prop and hook renderers merged; a hook renderer wins over a prop one. */
  get renderToolCalls() {
    return this._renderers.toolCalls;
  }

  get interruptState(): InterruptRenderProps<unknown, unknown> | null {
    return this._interruptState;
  }

  setRenderToolCalls(renderToolCalls: VueToolCallRenderer<unknown>[]): void {
    this._renderers.setPropToolCalls(renderToolCalls);
  }

  addHookRenderToolCall(entry: VueToolCallRenderer<unknown>): void {
    this._renderers.addHookToolCall(entry);
  }

  removeHookRenderToolCall(name: string, agentId?: string): void {
    this._renderers.removeHookToolCall(name, agentId);
  }

  private notifyRenderersChanged(kind: ɵRendererKind): void {
    void this.notifySubscribers((subscriber) => {
      const vueSubscriber = subscriber as CopilotKitCoreVueSubscriber;
      switch (kind) {
        case "toolCalls":
          return vueSubscriber.onRenderToolCallsChanged?.({
            copilotkit: this,
            renderToolCalls: [...this.renderToolCalls],
          });
        case "activity":
          return vueSubscriber.onRenderActivityMessagesChanged?.({
            copilotkit: this,
            renderActivityMessages: [...this.renderActivityMessages],
          });
        case "custom":
          return vueSubscriber.onRenderCustomMessagesChanged?.({
            copilotkit: this,
            renderCustomMessages: [...this.renderCustomMessages],
          });
      }
    }, `Subscriber renderer change (${kind}) error:`);
  }

  setInterruptState(
    interruptState: InterruptRenderProps<unknown, unknown> | null,
  ): void {
    this._interruptState = interruptState;
    void this.notifySubscribers((subscriber) => {
      const vueSubscriber = subscriber as CopilotKitCoreVueSubscriber;
      return vueSubscriber.onInterruptStateChanged?.({
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
