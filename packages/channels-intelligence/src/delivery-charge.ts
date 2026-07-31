export interface ChannelDeliveryChargeClientOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly fetch?: typeof globalThis.fetch;
}

/** Idempotent App API client for one delivery's first substantive work. */
export class ChannelDeliveryChargeClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof globalThis.fetch;

  constructor(private readonly options: ChannelDeliveryChargeClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/u, "");
    this.fetchFn = options.fetch ?? globalThis.fetch;
  }

  async charge(deliveryId: string): Promise<void> {
    const response = await this.fetchFn(
      `${this.baseUrl}/api/channels/deliveries/${encodeURIComponent(deliveryId)}/charge`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${this.options.apiKey}` },
      },
    );
    if (!response.ok) {
      throw new Error(`Channel delivery charge failed with ${response.status}`);
    }

    const payload = (await response.json()) as unknown;
    if (
      typeof payload !== "object" ||
      payload === null ||
      (payload as { charged?: unknown }).charged !== true
    ) {
      throw new TypeError("Channel delivery charge response is invalid");
    }
  }
}
