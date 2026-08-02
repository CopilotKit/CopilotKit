import type {
  ChannelHistoryAdapter,
  ChannelHistoryAdapterInput,
  ChannelHistoryPage,
  ChannelTaskOperationContext,
} from "@copilotkit/channels-core";

export interface ChannelHistoryHttpClientOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly channelName: string;
  readonly fetch?: typeof globalThis.fetch;
}

/** Runtime-authenticated client for one current Intelligence provider surface. */
export class ChannelHistoryHttpClient implements ChannelHistoryAdapter {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof globalThis.fetch;

  constructor(private readonly options: ChannelHistoryHttpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/u, "");
    this.fetchFn = options.fetch ?? globalThis.fetch;
  }

  async read(
    input: ChannelHistoryAdapterInput,
    context?: ChannelTaskOperationContext,
  ): Promise<ChannelHistoryPage> {
    const trusted = trustedDeliveryContext(context);
    const query = new URLSearchParams({ surfaceId: trusted.surfaceId });
    if (input.limit !== undefined) query.set("limit", String(input.limit));
    if (input.cursor !== undefined) query.set("cursor", input.cursor);
    const response = await this.fetchFn(
      `${this.baseUrl}/api/channels/${encodeURIComponent(this.options.channelName)}/messages?${query.toString()}`,
      {
        method: "GET",
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          "x-cpki-channel-delivery-id": trusted.deliveryId,
        },
      },
    );
    if (!response.ok) {
      throw new Error(`Channel history request failed with ${response.status}`);
    }
    return readHistoryPage(await response.json());
  }
}

/** Derive history scope from the managed reply target, never tool input. */
function trustedDeliveryContext(
  context: ChannelTaskOperationContext | undefined,
): { deliveryId: string; surfaceId: string } {
  const target = context?.replyTarget;
  if (!isRecord(target) || !isRecord(target.delivery)) {
    throw new TypeError("Channel history delivery context is invalid");
  }
  const { deliveryId, surfaceId } = target.delivery;
  if (
    typeof deliveryId !== "string" ||
    !deliveryId.startsWith("dlv_") ||
    typeof surfaceId !== "string" ||
    !surfaceId.startsWith("surface_")
  ) {
    throw new TypeError("Channel history delivery context is invalid");
  }
  return { deliveryId, surfaceId };
}

/** Decode one normalized App API provider-history page. */
function readHistoryPage(value: unknown): ChannelHistoryPage {
  if (
    !isRecord(value) ||
    !Array.isArray(value.messages) ||
    !(value.nextCursor === null || typeof value.nextCursor === "string") ||
    !value.messages.every(isHistoryMessage)
  ) {
    throw new TypeError("Channel history response is invalid");
  }
  return value as unknown as ChannelHistoryPage;
}

/** Validate the stable fields required from one normalized history message. */
function isHistoryMessage(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.occurredAt === "string" &&
    isRecord(value.actor) &&
    typeof value.actor.id === "string" &&
    typeof value.actor.kind === "string" &&
    typeof value.text === "string" &&
    (value.position === "root" || value.position === "reply")
  );
}

/** Narrow a JSON value to a non-array object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
