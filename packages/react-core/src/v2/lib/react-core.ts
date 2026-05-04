import React from "react";
import { ReactActivityMessageRenderer, ReactToolCallRenderer } from "../types";
import { ReactCustomMessageRenderer } from "../types/react-custom-message-renderer";
import {
  CopilotKitCore,
  type CopilotKitCoreConfig,
  type CopilotKitCoreSubscriber,
  type CopilotKitCoreSubscription,
} from "@copilotkit/core";

export interface CopilotKitCoreReactConfig extends CopilotKitCoreConfig {
  // Add any additional configuration properties specific to the React implementation
  renderToolCalls?: ReactToolCallRenderer<any>[];
  renderActivityMessages?: ReactActivityMessageRenderer<any>[];

  // Add custom message renderers
  renderCustomMessages?: ReactCustomMessageRenderer[];
}

export interface CopilotKitCoreReactSubscriber extends CopilotKitCoreSubscriber {
  onRenderToolCallsChanged?: (event: {
    copilotkit: CopilotKitCore;
    renderToolCalls: ReactToolCallRenderer<any>[];
  }) => void | Promise<void>;
  onInterruptElementChanged?: (event: {
    copilotkit: CopilotKitCore;
    interruptElement: React.ReactElement | null;
  }) => void | Promise<void>;
}

export class CopilotKitCoreReact extends CopilotKitCore {
  private _renderToolCalls: ReactToolCallRenderer<any>[] = [];
  private _hookRenderToolCalls: Map<string, ReactToolCallRenderer<any>> =
    new Map();
  private _cachedMergedRenderToolCalls: ReactToolCallRenderer<any>[] | null =
    null;
  private _renderCustomMessages: ReactCustomMessageRenderer[] = [];
  private _renderActivityMessages: ReactActivityMessageRenderer<any>[] = [];
  private _interruptElement: React.ReactElement | null = null;

  constructor(config: CopilotKitCoreReactConfig) {
    super(config);
    this._renderToolCalls = config.renderToolCalls ?? [];
    this._renderCustomMessages = config.renderCustomMessages ?? [];
    this._renderActivityMessages = config.renderActivityMessages ?? [];
  }

  get renderCustomMessages(): Readonly<ReactCustomMessageRenderer[]> {
    return this._renderCustomMessages;
  }

  get renderActivityMessages(): Readonly<ReactActivityMessageRenderer<any>>[] {
    return this._renderActivityMessages;
  }

  get renderToolCalls(): Readonly<ReactToolCallRenderer<any>>[] {
    if (this._hookRenderToolCalls.size === 0) {
      return this._renderToolCalls;
    }
    if (this._cachedMergedRenderToolCalls) {
      return this._cachedMergedRenderToolCalls;
    }
    // Merge: hook entries override prop entries with the same key
    const merged = new Map<string, ReactToolCallRenderer<any>>();
    for (const rc of this._renderToolCalls) {
      merged.set(`${rc.agentId ?? ""}:${rc.name}`, rc);
    }
    for (const [key, rc] of this._hookRenderToolCalls) {
      merged.set(key, rc);
    }
    this._cachedMergedRenderToolCalls = Array.from(merged.values());
    return this._cachedMergedRenderToolCalls;
  }

  setRenderActivityMessages(
    renderers: ReactActivityMessageRenderer<any>[],
  ): void {
    this._renderActivityMessages = renderers;
  }

  setRenderCustomMessages(renderers: ReactCustomMessageRenderer[]): void {
    this._renderCustomMessages = renderers;
  }

  setRenderToolCalls(renderToolCalls: ReactToolCallRenderer<any>[]): void {
    this._renderToolCalls = renderToolCalls;
    this._cachedMergedRenderToolCalls = null;
    this._notifyRenderToolCallsChanged();
  }

  addHookRenderToolCall(entry: ReactToolCallRenderer<any>): void {
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
      const reactSubscriber = subscriber as CopilotKitCoreReactSubscriber;
      if (reactSubscriber.onRenderToolCallsChanged) {
        reactSubscriber.onRenderToolCallsChanged({
          copilotkit: this,
          renderToolCalls: this.renderToolCalls,
        });
      }
    }, "Subscriber onRenderToolCallsChanged error:");
  }

  get interruptElement(): React.ReactElement | null {
    return this._interruptElement;
  }

  setInterruptElement(element: React.ReactElement | null): void {
    this._interruptElement = element;
    void this.notifySubscribers((subscriber) => {
      const reactSubscriber = subscriber as CopilotKitCoreReactSubscriber;
      reactSubscriber.onInterruptElementChanged?.({
        copilotkit: this,
        interruptElement: this._interruptElement,
      });
    }, "Subscriber onInterruptElementChanged error:");
  }

  // Override to accept React-specific subscriber type
  subscribe(
    subscriber: CopilotKitCoreReactSubscriber,
  ): CopilotKitCoreSubscription {
    return super.subscribe(subscriber);
  }

  /**
   * Wait for pending React state updates before the follow-up agent run.
   *
   * When a frontend tool handler calls setState(), React 18 batches the update
   * and schedules a commit via its internal scheduler (MessageChannel). The
   * useAgentContext hook registers context via useLayoutEffect, which runs
   * synchronously after React commits that batch.
   *
   * Awaiting a zero-delay timeout yields to the macrotask queue. React's
   * MessageChannel task runs first, committing the pending state and running
   * useLayoutEffect (which updates the context store). The follow-up runAgent
   * call then reads fresh context.
   */
  async waitForPendingFrameworkUpdates(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}
