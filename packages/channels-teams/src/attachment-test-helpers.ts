import dns from "node:dns/promises";
import https from "node:https";
import type { ClientRequest, IncomingMessage } from "node:http";
import { PassThrough, Readable } from "node:stream";
import { vi } from "vitest";

export function publicDns() {
  return vi
    .spyOn(dns, "lookup")
    .mockResolvedValue([{ address: "13.107.136.9", family: 4 }] as never);
}

export function incoming(
  body: string | Uint8Array | Readable = "",
  status = 200,
  headers: Record<string, string> = {},
): IncomingMessage {
  return Object.assign(
    body instanceof Readable ? body : Readable.from([Buffer.from(body)]),
    { statusCode: status, headers },
  ) as IncomingMessage;
}

/** Replace only the network boundary; real URL, DNS, redirect and read logic run. */
export function mockHttps(
  respond: (options: https.RequestOptions) => IncomingMessage,
) {
  return vi.spyOn(https, "request").mockImplementation((...args: unknown[]) => {
    const options = args[0] as https.RequestOptions;
    const callback = args[1] as (message: IncomingMessage) => void;
    const request = new PassThrough({ autoDestroy: false });
    let response: IncomingMessage | undefined;
    const abort = () => {
      const error = options.signal?.reason ?? new Error("aborted");
      request.destroy(error);
      response?.destroy(error);
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    request.once("close", () =>
      options.signal?.removeEventListener("abort", abort),
    );
    request.once("finish", () => {
      if (options.signal?.aborted) return abort();
      response = respond(options);
      response.once("close", () => {
        options.signal?.removeEventListener("abort", abort);
        request.destroy();
      });
      callback(response);
    });
    return request as unknown as ClientRequest;
  });
}
