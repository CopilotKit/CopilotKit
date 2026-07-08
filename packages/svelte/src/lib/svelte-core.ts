import { tick } from "svelte";
import { CopilotKitCore } from "@copilotkit/core";
import type {
  CopilotKitCoreConfig,
  CopilotKitCoreSubscriber,
  CopilotKitCoreSubscription,
} from "@copilotkit/core";
import type {
  SvelteActivityMessageRenderer,
  SvelteToolCallRenderer,
  SvelteCustomMessageRenderer,
} from "../types";
import type { InterruptRenderProps } from "../types/interrupt";

export interface CopilotKitCoreSvelteConfig extends CopilotKitCoreConfig {
  renderToolCalls?: SvelteToolCallRenderer<unknown>[];
  renderActivityMessages?: SvelteActivityMessageRenderer<unknown>[];
  renderCustomMessages?: SvelteCustomMessageRenderer[];
}

export interface CopilotKitCoreSvelteSubscriber extends CopilotKitCoreSubscriber {
  onRenderToolCallsChanged?: (event: {
    copilotkit: CopilotKitCoreSvelte;
    renderToolCalls: SvelteToolCallRenderer<unknown>[];
  }) => void | Promise<void>;
  onRenderCustomMessagesChanged?: (event: {
    copilotkit: CopilotKitCoreSvelte;
    renderCustomMessages: SvelteCustomMessageRenderer[];
  }) => void | Promise<void>;
  onInterruptStateChanged?: (event: {
    copilotkit: CopilotKitCoreSvelte;
    interruptState: InterruptRenderProps<unknown, unknown> | null;
  }) => void | Promise<void>;
}

export class CopilotKitCoreSvelte extends CopilotKitCore {
  private _renderToolCalls: SvelteToolCallRenderer<unknown>[] = [];
  private _hookRenderToolCalls: Map<string, SvelteToolCallRenderer<unknown>> =
    new Map();
  private _cachedMergedRenderToolCalls:
    | SvelteToolCallRenderer<unknown>[]
    | null = null;
  private _renderCustomMessages: SvelteCustomMessageRenderer[] = [];
  private _renderActivityMessages: SvelteActivityMessageRenderer<unknown>[] =
    [];
  private _interruptState: InterruptRenderProps<unknown, unknown> | null = null;

  constructor(config: CopilotKitCoreSvelteConfig) {
    super(config);
    this._renderToolCalls = config.renderToolCalls ?? [];
    this._renderCustomMessages = config.renderCustomMessages ?? [];
    this._renderActivityMessages = config.renderActivityMessages ?? [];
  }

  get renderCustomMessages(): Readonly<SvelteCustomMessageRenderer[]> {
    return this._renderCustomMessages;
  }

  get renderActivityMessages(): Readonly<
    SvelteActivityMessageRenderer<unknown>[]
  > {
    return this._renderActivityMessages;
  }

  setRenderActivityMessages(
    renderers: SvelteActivityMessageRenderer<unknown>[],
  ): void {
    this._renderActivityMessages = [...renderers];
  }

  setRenderCustomMessages(renderers: SvelteCustomMessageRenderer[]): void {
    this._renderCustomMessages = [...renderers];
    void this.notifySubscribers((subscriber) => {
      const svelteSubscriber = subscriber as CopilotKitCoreSvelteSubscriber;
      svelteSubscriber.onRenderCustomMessagesChanged?.({
        copilotkit: this,
        renderCustomMessages: [...this.renderCustomMessages],
      });
    }, "Subscriber onRenderCustomMessagesChanged error:");
  }

  get propRenderToolCalls(): Readonly<SvelteToolCallRenderer<unknown>[]> {
    return this._renderToolCalls;
  }

  get renderToolCalls(): Readonly<SvelteToolCallRenderer<unknown>[]> {
    if (this._hookRenderToolCalls.size === 0) {
      return this._renderToolCalls;
    }
    if (this._cachedMergedRenderToolCalls) {
      return this._cachedMergedRenderToolCalls;
    }
    const merged = new Map<string, SvelteToolCallRenderer<unknown>>();
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

  setRenderToolCalls(renderToolCalls: SvelteToolCallRenderer<unknown>[]): void {
    this._renderToolCalls = [...renderToolCalls];
    this._cachedMergedRenderToolCalls = null;
    this._notifyRenderToolCallsChanged();
  }

  addHookRenderToolCall(entry: SvelteToolCallRenderer<unknown>): void {
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
      const svelteSubscriber = subscriber as CopilotKitCoreSvelteSubscriber;
      if (svelteSubscriber.onRenderToolCallsChanged) {
        svelteSubscriber.onRenderToolCallsChanged({
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
      const svelteSubscriber = subscriber as CopilotKitCoreSvelteSubscriber;
      svelteSubscriber.onInterruptStateChanged?.({
        copilotkit: this,
        interruptState: this._interruptState,
      });
    }, "Subscriber onInterruptStateChanged error:");
  }

  subscribe(
    subscriber: CopilotKitCoreSvelteSubscriber,
  ): CopilotKitCoreSubscription {
    return super.subscribe(subscriber);
  }

  async waitForPendingFrameworkUpdates(): Promise<void> {
    await tick();
  }
}
