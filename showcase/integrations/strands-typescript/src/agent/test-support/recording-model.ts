import { Model } from "@strands-agents/sdk";
import type {
  BaseModelConfig,
  Message,
  ModelStreamEvent,
  StreamOptions,
} from "@strands-agents/sdk";

export class RecordingModel extends Model<BaseModelConfig> {
  requests: string[] = [];
  private config: BaseModelConfig = { modelId: "context-regression" };
  updateConfig(config: BaseModelConfig): void {
    this.config = { ...this.config, ...config };
  }
  getConfig(): BaseModelConfig {
    return this.config;
  }
  async *stream(
    messages: Message[],
    options?: StreamOptions,
  ): AsyncIterable<ModelStreamEvent> {
    this.requests.push(JSON.stringify({ messages, options }));
    yield { type: "modelMessageStartEvent", role: "assistant" };
    yield { type: "modelContentBlockStartEvent" };
    yield {
      type: "modelContentBlockDeltaEvent",
      delta: { type: "textDelta", text: "Done." },
    };
    yield { type: "modelContentBlockStopEvent" };
    yield { type: "modelMessageStopEvent", stopReason: "endTurn" };
  }
}
