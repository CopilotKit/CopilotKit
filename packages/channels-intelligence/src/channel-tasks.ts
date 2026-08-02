import type {
  ChannelTask,
  ChannelTaskAdapter,
  ChannelTaskOperationContext,
  CreateChannelTaskInput,
  DeleteChannelTaskInput,
  ListChannelTasksInput,
  UpdateChannelTaskInput,
} from "@copilotkit/channels-core";

export interface ChannelTaskHttpClientOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly channelName: string;
  readonly fetch?: typeof globalThis.fetch;
}

interface TrustedDeliveryContext {
  readonly deliveryId: string;
  readonly surfaceId: string;
}

/** Runtime-authenticated client for one Intelligence Channel's Task routes. */
export class ChannelTaskHttpClient implements ChannelTaskAdapter {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof globalThis.fetch;

  constructor(private readonly options: ChannelTaskHttpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/u, "");
    this.fetchFn = options.fetch ?? globalThis.fetch;
  }

  async create(
    input: CreateChannelTaskInput,
    context?: ChannelTaskOperationContext,
  ): Promise<ChannelTask> {
    const trusted = trustedDeliveryContext(context);
    const surfaceId = trusted?.surfaceId ?? input.surfaceId;
    const payload = await this.request(
      "POST",
      this.collectionPath(),
      { surfaceId, goal: input.goal, when: input.when },
      trusted,
    );
    return readTaskResponse(payload);
  }

  async list(
    input: ListChannelTasksInput,
    context?: ChannelTaskOperationContext,
  ): Promise<ChannelTask[]> {
    const trusted = trustedDeliveryContext(context);
    const surfaceId = trusted?.surfaceId ?? input.surfaceId;
    const query = new URLSearchParams({ surfaceId });
    if (input.event !== undefined) query.set("event", input.event);
    if (input.enabled !== undefined) {
      query.set("enabled", String(input.enabled));
    }
    const payload = await this.request(
      "GET",
      `${this.collectionPath()}?${query.toString()}`,
      undefined,
      trusted,
    );
    if (!isRecord(payload) || !Array.isArray(payload.tasks)) {
      throw new TypeError("Channel Task list response is invalid");
    }
    return payload.tasks.map(readTask);
  }

  async update(
    input: UpdateChannelTaskInput,
    context?: ChannelTaskOperationContext,
  ): Promise<ChannelTask> {
    const trusted = trustedDeliveryContext(context);
    const query = trusted
      ? `?surfaceId=${encodeURIComponent(trusted.surfaceId)}`
      : "";
    const payload = await this.request(
      "PATCH",
      `${this.collectionPath()}/${encodeURIComponent(input.taskId)}${query}`,
      {
        ...(input.goal !== undefined ? { goal: input.goal } : {}),
        ...(input.when !== undefined ? { when: input.when } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      },
      trusted,
    );
    return readTaskResponse(payload);
  }

  async delete(
    input: DeleteChannelTaskInput,
    context?: ChannelTaskOperationContext,
  ): Promise<void> {
    const trusted = trustedDeliveryContext(context);
    const query = trusted
      ? `?surfaceId=${encodeURIComponent(trusted.surfaceId)}`
      : "";
    await this.request(
      "DELETE",
      `${this.collectionPath()}/${encodeURIComponent(input.taskId)}${query}`,
      undefined,
      trusted,
    );
  }

  private collectionPath(): string {
    return `/api/channels/${encodeURIComponent(this.options.channelName)}/tasks`;
  }

  private async request(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    body: unknown,
    trusted: TrustedDeliveryContext | undefined,
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.options.apiKey}`,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(trusted ? { "x-cpki-channel-delivery-id": trusted.deliveryId } : {}),
    };
    const response = await this.fetchFn(`${this.baseUrl}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      throw new Error(`Channel Task request failed with ${response.status}`);
    }
    return response.status === 204 ? undefined : response.json();
  }
}

/** Derive Task authority from a managed reply target, never model input. */
function trustedDeliveryContext(
  context: ChannelTaskOperationContext | undefined,
): TrustedDeliveryContext | undefined {
  if (context?.replyTarget === undefined) return undefined;
  const target = context.replyTarget;
  if (!isRecord(target) || !isRecord(target.delivery)) {
    throw new TypeError("Channel Task delivery context is invalid");
  }
  const { deliveryId, surfaceId } = target.delivery;
  if (
    typeof deliveryId !== "string" ||
    !deliveryId.startsWith("dlv_") ||
    typeof surfaceId !== "string" ||
    !surfaceId.startsWith("surface_")
  ) {
    throw new TypeError("Channel Task delivery context is invalid");
  }
  return { deliveryId, surfaceId };
}

/** Decode the App API Task response envelope. */
function readTaskResponse(value: unknown): ChannelTask {
  if (!isRecord(value)) {
    throw new TypeError("Channel Task response is invalid");
  }
  return readTask(value.task);
}

/** Validate the stable fields required from one App API Task. */
function readTask(value: unknown): ChannelTask {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.surfaceId !== "string" ||
    typeof value.goal !== "string" ||
    typeof value.enabled !== "boolean" ||
    !isRecord(value.when) ||
    !isRecord(value.createdBy) ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string"
  ) {
    throw new TypeError("Channel Task response is invalid");
  }
  return value as unknown as ChannelTask;
}

/** Narrow a JSON value to a non-array object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
