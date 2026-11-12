import React from "react";
import type {
  ReactActivityMessageRenderer,
  ReactToolCallRenderer,
} from "../types";
import type { ReactCustomMessageRenderer } from "../types/react-custom-message-renderer";
import { CopilotKitCore, ɵRendererRegistry } from "@copilotkit/core";
import type {
  CopilotKitCoreConfig,
  CopilotKitCoreSubscriber,
  CopilotKitCoreSubscription,
  ɵRendererKind,
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
    renderToolCalls: readonly ReactToolCallRenderer<any>[];
  }) => void | Promise<void>;
  onRenderActivityMessagesChanged?: (event: {
    copilotkit: CopilotKitCore;
    renderActivityMessages: readonly ReactActivityMessageRenderer<any>[];
  }) => void | Promise<void>;
  onRenderCustomMessagesChanged?: (event: {
    copilotkit: CopilotKitCore;
    renderCustomMessages: readonly ReactCustomMessageRenderer[];
  }) => void | Promise<void>;
  onInterruptElementChanged?: (event: {
    copilotkit: CopilotKitCore;
    interruptElement: React.ReactElement | null;
  }) => void | Promise<void>;
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
function waitForReactCommit() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

export class CopilotKitCoreReact extends CopilotKitCore {
  private readonly _renderers: ɵRendererRegistry<
    ReactToolCallRenderer<any>,
    ReactActivityMessageRenderer<any>,
    ReactCustomMessageRenderer
  >;

  constructor(config: CopilotKitCoreReactConfig) {
    super({
      ...config,
      ɵwaitForFrameworkUpdates: waitForReactCommit,
    });
    this._renderers = new ɵRendererRegistry({
      toolCalls: config.renderToolCalls,
      activity: config.renderActivityMessages,
      custom: config.renderCustomMessages,
    });
    this._renderers.subscribe((kind) => this.notifyRenderersChanged(kind));
    // The element lives in core's generic interrupt slot; keep the React
    // subscriber event for existing listeners.
    this.ɵsubscribeToInterruptPayload(() => {
      void this.notifySubscribers((subscriber) => {
        const reactSubscriber = subscriber as CopilotKitCoreReactSubscriber;
        return reactSubscriber.onInterruptElementChanged?.({
          copilotkit: this,
          interruptElement: this.interruptElement,
        });
      }, "Subscriber onInterruptElementChanged error:");
    });
  }

  get renderCustomMessages() {
    return this._renderers.custom;
  }

  get renderActivityMessages() {
    return this._renderers.activity;
  }

  /**
   * Prop, hook and built-in renderers merged. For one name and agentId, a
   * hook renderer wins over a prop one, and both win over a built-in one.
   */
  get renderToolCalls() {
    return this._renderers.toolCalls;
  }

  setRenderActivityMessages(
    renderers: ReactActivityMessageRenderer<any>[],
  ): void {
    this._renderers.setActivity(renderers);
  }

  setRenderCustomMessages(renderers: ReactCustomMessageRenderer[]): void {
    this._renderers.setCustom(renderers);
  }

  setRenderToolCalls(renderToolCalls: ReactToolCallRenderer<any>[]): void {
    this._renderers.setPropToolCalls(renderToolCalls);
  }

  addHookRenderToolCall(entry: ReactToolCallRenderer<any>): void {
    this._renderers.addHookToolCall(entry);
  }

  removeHookRenderToolCall(name: string, agentId?: string): void {
    this._renderers.removeHookToolCall(name, agentId);
  }

  /**
   * @internal Add a renderer for a tool a built-in feature owns
   * (generative UI). Prop and hook renderers with the same name and agent win
   * over it, and `setRenderToolCalls` never removes it.
   *
   * @returns A function that removes the renderer.
   */
  ɵaddBuiltInRenderToolCall(entry: ReactToolCallRenderer): () => void {
    return this._renderers.addBuiltInToolCall(entry);
  }

  private notifyRenderersChanged(kind: ɵRendererKind): void {
    void this.notifySubscribers((subscriber) => {
      const reactSubscriber = subscriber as CopilotKitCoreReactSubscriber;
      switch (kind) {
        case "toolCalls":
          return reactSubscriber.onRenderToolCallsChanged?.({
            copilotkit: this,
            renderToolCalls: this.renderToolCalls,
          });
        case "activity":
          return reactSubscriber.onRenderActivityMessagesChanged?.({
            copilotkit: this,
            renderActivityMessages: this.renderActivityMessages,
          });
        case "custom":
          return reactSubscriber.onRenderCustomMessagesChanged?.({
            copilotkit: this,
            renderCustomMessages: this.renderCustomMessages,
          });
      }
    }, `Subscriber renderer change (${kind}) error:`);
  }

  get interruptElement(): React.ReactElement | null {
    return this.ɵinterruptPayload as React.ReactElement | null;
  }

  setInterruptElement(element: React.ReactElement | null): void {
    this.ɵsetInterruptPayload(element);
  }

  // Override to accept React-specific subscriber type
  subscribe(
    subscriber: CopilotKitCoreReactSubscriber,
  ): CopilotKitCoreSubscription {
    return super.subscribe(subscriber);
  }
}
