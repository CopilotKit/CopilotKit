import React from "react";
import { ReactActivityMessageRenderer, ReactToolCallRenderer } from "@/types";
import { ReactCustomMessageRenderer } from "@/types/react-custom-message-renderer";
import {
  CopilotKitCore,
  type CopilotKitCoreConfig,
  type CopilotKitCoreSubscriber,
  type CopilotKitCoreSubscription,
} from "@copilotkitnext/core";

export interface CopilotKitCoreReactConfig extends CopilotKitCoreConfig {
  // Add any additional configuration properties specific to the React implementation
  renderToolCalls?: ReactToolCallRenderer<any>[];
  renderActivityMessages?: ReactActivityMessageRenderer<any>[];

  // Add custom message renderers
  renderCustomMessages?: ReactCustomMessageRenderer[];
  
  /**
   * Enable direct AG-UI protocol integration.
   * When true, uses native AG-UI protocol for improved compatibility.
   * Issue #2186: Direct Integration Between AG-UI and CopilotKit
   */
  aguiDirectIntegration?: boolean;
  
  /**
   * Thread restoration configuration for conversation reloading.
   * Supports Issue #3256: V2 restore state and thread ID
   */
  threadRestoration?: {
    enabled: boolean;
    persistToStorage?: boolean;
    storageKey?: string;
  };
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
    return this._renderToolCalls;
  }

  setRenderToolCalls(renderToolCalls: ReactToolCallRenderer<any>[]): void {
    this._renderToolCalls = renderToolCalls;

    // Notify React-specific subscribers
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
}
