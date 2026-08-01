import React from "react";
import type {
  ReactActivityMessageRenderer,
  ReactToolCallRenderer,
} from "../types";
import type {
  ReactCustomMessageRenderer,
  ReactEphemeralMessage,
} from "../types/react-custom-message-renderer";
import { CopilotKitCore } from "@copilotkit/core";
import type {
  CopilotKitCoreConfig,
  CopilotKitCoreSubscriber,
  CopilotKitCoreSubscription,
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
  onEphemeralMessagesChanged?: (event: {
    copilotkit: CopilotKitCoreReact;
    agentId: string;
    threadId: string;
    messages: ReadonlyArray<ReactEphemeralMessage>;
  }) => void | Promise<void>;
}

const EMPTY_EPHEMERAL_MESSAGES: ReadonlyArray<ReactEphemeralMessage> =
  Object.freeze([]);

export class CopilotKitCoreReact extends CopilotKitCore {
  private _renderToolCalls: ReactToolCallRenderer<any>[] = [];
  private _hookRenderToolCalls: Map<string, ReactToolCallRenderer<any>> =
    new Map();
  private _cachedMergedRenderToolCalls: ReactToolCallRenderer<any>[] | null =
    null;
  private _renderCustomMessages: ReactCustomMessageRenderer[] = [];
  private _renderActivityMessages: ReactActivityMessageRenderer<any>[] = [];
  private _interruptElement: React.ReactElement | null = null;
  private _ephemeralMessages = new Map<
    string,
    ReadonlyArray<ReactEphemeralMessage>
  >();

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

  getEphemeralMessages(
    agentId: string,
    threadId: string,
  ): ReadonlyArray<ReactEphemeralMessage> {
    const key = this._ephemeralScopeKey(agentId, threadId);
    const messages = this._ephemeralMessages.get(key);
    if (!messages) {
      return EMPTY_EPHEMERAL_MESSAGES;
    }

    const agent = this.getAgent(agentId);
    if (!agent || agent.threadId !== threadId) {
      return messages;
    }

    const persistedIds = new Set(agent.messages.map((message) => message.id));
    const withoutCollisions = messages.filter(
      (message) => !persistedIds.has(message.id),
    );
    if (withoutCollisions.length === messages.length) {
      return messages;
    }

    if (withoutCollisions.length === 0) {
      this._ephemeralMessages.delete(key);
      return EMPTY_EPHEMERAL_MESSAGES;
    }

    const snapshot = Object.freeze(withoutCollisions);
    this._ephemeralMessages.set(key, snapshot);
    return snapshot;
  }

  addEphemeralMessage(
    agentId: string,
    threadId: string,
    message: ReactEphemeralMessage,
  ): boolean {
    const agent = this.getAgent(agentId);
    const persistedMessages =
      agent?.threadId === threadId ? agent.messages : [];
    if (
      persistedMessages.some(
        (persistedMessage) => persistedMessage.id === message.id,
      )
    ) {
      return false;
    }

    const previous = this.getEphemeralMessages(agentId, threadId);
    const existingIndex = previous.findIndex(
      (existingMessage) => existingMessage.id === message.id,
    );
    const {
      anchorMessageId: requestedAnchorMessageId,
      ...messageWithoutAnchor
    } = message;
    const existingMessage =
      existingIndex >= 0 ? previous[existingIndex] : undefined;
    const anchorMessageId =
      existingMessage !== undefined
        ? existingMessage.anchorMessageId
        : (requestedAnchorMessageId ??
          persistedMessages[persistedMessages.length - 1]?.id);
    const nextMessage = Object.freeze({
      ...messageWithoutAnchor,
      ...(anchorMessageId !== undefined ? { anchorMessageId } : {}),
    });
    const key = this._ephemeralScopeKey(agentId, threadId);
    const next = [...previous];
    if (existingIndex >= 0) {
      next[existingIndex] = nextMessage;
    } else {
      next.push(nextMessage);
    }
    const snapshot = Object.freeze(next);
    this._ephemeralMessages.set(key, snapshot);
    this._notifyEphemeralMessagesChanged(agentId, threadId, snapshot);
    return true;
  }

  removeEphemeralMessage(
    agentId: string,
    threadId: string,
    messageId: string,
  ): boolean {
    const key = this._ephemeralScopeKey(agentId, threadId);
    const previous = this.getEphemeralMessages(agentId, threadId);
    const existingIndex = previous.findIndex(
      (message) => message.id === messageId,
    );
    if (existingIndex < 0) {
      return false;
    }

    const next = Object.freeze(
      previous.filter((message) => message.id !== messageId),
    );
    if (next.length === 0) {
      this._ephemeralMessages.delete(key);
    } else {
      this._ephemeralMessages.set(key, next);
    }
    this._notifyEphemeralMessagesChanged(agentId, threadId, next);
    return true;
  }

  clearEphemeralMessages(agentId: string, threadId: string): boolean {
    const key = this._ephemeralScopeKey(agentId, threadId);
    const previous = this.getEphemeralMessages(agentId, threadId);
    if (previous.length === 0) {
      return false;
    }

    this._ephemeralMessages.delete(key);
    this._notifyEphemeralMessagesChanged(
      agentId,
      threadId,
      EMPTY_EPHEMERAL_MESSAGES,
    );
    return true;
  }

  private _ephemeralScopeKey(agentId: string, threadId: string): string {
    return JSON.stringify([agentId, threadId]);
  }

  private _notifyEphemeralMessagesChanged(
    agentId: string,
    threadId: string,
    messages: ReadonlyArray<ReactEphemeralMessage>,
  ): void {
    void this.notifySubscribers((subscriber) => {
      const reactSubscriber = subscriber as CopilotKitCoreReactSubscriber;
      reactSubscriber.onEphemeralMessagesChanged?.({
        copilotkit: this,
        agentId,
        threadId,
        messages,
      });
    }, "Subscriber onEphemeralMessagesChanged error:");
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
