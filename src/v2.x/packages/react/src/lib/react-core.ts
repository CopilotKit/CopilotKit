import { ReactActivityMessageRenderer, ReactToolCallRenderer } from "@/types";
import { ReactCustomMessageRenderer } from "@/types/react-custom-message-renderer";
import {
  CopilotKitCore,
  CopilotKitCoreConfig,
  CopilotKitCoreSubscriber,
  CopilotKitCoreSubscription,
} from "@copilotkitnext/core";

export interface CopilotKitCoreReactConfig extends CopilotKitCoreConfig {
  // Add any additional configuration properties specific to the React implementation
  toolCallRenderers?: ReactToolCallRenderer<any>[];
  renderActivityMessages?: ReactActivityMessageRenderer<any>[];

  // Add custom message renderers
  renderCustomMessages?: ReactCustomMessageRenderer[];
}

export interface CopilotKitCoreReactSubscriber extends CopilotKitCoreSubscriber {
  onToolCallRenderersChanged?: (event: {
    copilotkit: CopilotKitCore;
    toolCallRenderers: ReactToolCallRenderer<any>[];
  }) => void | Promise<void>;
}

export class CopilotKitCoreReact extends CopilotKitCore {
  private _toolCallRenderers: ReactToolCallRenderer<any>[] = [];
  private _renderCustomMessages: ReactCustomMessageRenderer[] = [];
  private _renderActivityMessages: ReactActivityMessageRenderer<any>[] = [];

  constructor(config: CopilotKitCoreReactConfig) {
    super(config);
    this._toolCallRenderers = config.toolCallRenderers ?? [];
    this._renderCustomMessages = config.renderCustomMessages ?? [];
    this._renderActivityMessages = config.renderActivityMessages ?? [];
  }

  get renderCustomMessages(): Readonly<ReactCustomMessageRenderer[]> {
    return this._renderCustomMessages;
  }

  get renderActivityMessages(): Readonly<ReactActivityMessageRenderer<any>>[] {
    return this._renderActivityMessages;
  }

  get toolCallRenderers(): Readonly<ReactToolCallRenderer<any>>[] {
    return this._toolCallRenderers;
  }

  setToolCallRenderers(toolCallRenderers: ReactToolCallRenderer<any>[]): void {
    this._toolCallRenderers = toolCallRenderers;

    // Notify React-specific subscribers
    void this.notifySubscribers(
      (subscriber) => {
        const reactSubscriber = subscriber as CopilotKitCoreReactSubscriber;
        if (reactSubscriber.onToolCallRenderersChanged) {
          reactSubscriber.onToolCallRenderersChanged({
            copilotkit: this,
            toolCallRenderers: this.toolCallRenderers,
          });
        }
      },
      "Subscriber onToolCallRenderersChanged error:"
    );
  }

  // Override to accept React-specific subscriber type
  subscribe(subscriber: CopilotKitCoreReactSubscriber): CopilotKitCoreSubscription {
    return super.subscribe(subscriber);
  }
}
