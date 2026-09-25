import { parseInspectorLearningSnapshotV1 } from "@copilotkit/shared";
import type {
  InspectorLearningRequestV1,
  InspectorLearningSnapshotV1,
} from "@copilotkit/shared";

export class InspectorLearningUnsupportedError extends Error {}

/** Loads one Learning projection through either negotiated Runtime transport. */
export async function fetchInspectorLearning(input: {
  readonly runtimeUrl: string;
  readonly runtimeTransport: "rest" | "single" | "auto";
  readonly request: InspectorLearningRequestV1;
  readonly fetch: typeof globalThis.fetch;
  readonly headers?: Readonly<Record<string, string>>;
  readonly credentials?: RequestCredentials;
  readonly signal?: AbortSignal;
}): Promise<InspectorLearningSnapshotV1> {
  const base = input.runtimeUrl.replace(/\/+$/u, "");
  const single = input.runtimeTransport === "single";
  const url = single ? base : `${base}/inspector-learning`;
  const query = new URLSearchParams();
  if (input.request.agentId) query.set("agentId", input.request.agentId);
  if (input.request.skillsPage)
    query.set("skillsPage", String(input.request.skillsPage));
  if (input.request.insightsPage) {
    query.set("insightsPage", String(input.request.insightsPage));
  }
  const response = await input.fetch(single ? url : `${url}?${query}`, {
    method: single ? "POST" : "GET",
    headers: single
      ? { ...input.headers, "Content-Type": "application/json" }
      : { ...input.headers },
    credentials: input.credentials,
    signal: input.signal,
    ...(single
      ? {
          body: JSON.stringify({
            method: "inspector/learning",
            params: Object.fromEntries(query),
          }),
        }
      : {}),
  });
  if (response.status === 404) throw new InspectorLearningUnsupportedError();
  if (!response.ok)
    throw new Error(`Learning snapshot failed (HTTP ${response.status}).`);
  const snapshot = parseInspectorLearningSnapshotV1(await response.json());
  if (!snapshot) throw new Error("Learning snapshot response is invalid.");
  return snapshot;
}
