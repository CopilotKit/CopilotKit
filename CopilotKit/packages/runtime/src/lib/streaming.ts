import { ReplaySubject } from "rxjs";
import { CopilotKitLowLevelError, CopilotKitError, CopilotKitErrorCode } from "@copilotkit/shared";

export async function writeJsonLineResponseToEventStream<T>(
  response: ReadableStream<Uint8Array>,
  eventStream$: ReplaySubject<T>,
) {
  const reader = response.getReader();
  const decoder = new TextDecoder();
  let buffer = [];

  function flushBuffer() {
    const currentBuffer = buffer.join("");
    if (currentBuffer.trim().length === 0) {
      return;
    }
    const parts = currentBuffer.split("\n");
    if (parts.length === 0) {
      return;
    }

    const lastPartIsComplete = currentBuffer.endsWith("\n");

    // truncate buffer
    buffer = [];

    if (!lastPartIsComplete) {
      // put back the last part
      buffer.push(parts.pop());
    }

    parts
      .map((part) => part.trim())
      .filter((part) => part != "")
      .forEach((part) => {
        eventStream$.next(JSON.parse(part));
      });
  }

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (!done) {
        buffer.push(decoder.decode(value, { stream: true }));
      }

      flushBuffer();

      if (done) {
        break;
      }
    }
  } catch (error) {
    console.error("Error in stream", error);

    // Convert network termination errors to structured errors
    const structuredError = convertStreamingErrorToStructured(error);
    eventStream$.error(structuredError);
    return;
  }
  eventStream$.complete();
}

function convertStreamingErrorToStructured(error: any): CopilotKitError {
  // Handle network termination errors
  if (
    error?.message?.includes("terminated") ||
    error?.cause?.code === "UND_ERR_SOCKET" ||
    error?.message?.includes("other side closed") ||
    error?.code === "UND_ERR_SOCKET"
  ) {
    return new CopilotKitError({
      message:
        "Connection to agent was unexpectedly terminated. This may be due to the agent service being restarted or network issues. Please try again.",
      code: CopilotKitErrorCode.NETWORK_ERROR,
    });
  }

  // Handle other network-related errors
  if (
    error?.message?.includes("fetch failed") ||
    error?.message?.includes("ECONNREFUSED") ||
    error?.message?.includes("ENOTFOUND") ||
    error?.message?.includes("ETIMEDOUT")
  ) {
    return new CopilotKitLowLevelError({
      error: error instanceof Error ? error : new Error(String(error)),
      url: "streaming connection",
      message:
        "Network error occurred during streaming. Please check your connection and try again.",
    });
  }

  // Handle abort/cancellation errors (these are usually normal)
  if (
    error?.message?.includes("aborted") ||
    error?.message?.includes("canceled") ||
    error?.message?.includes("signal is aborted")
  ) {
    return new CopilotKitError({
      message: "Request was cancelled",
      code: CopilotKitErrorCode.UNKNOWN,
    });
  }

  // Default: convert unknown streaming errors
  return new CopilotKitError({
    message: `Streaming error: ${error?.message || String(error)}`,
    code: CopilotKitErrorCode.UNKNOWN,
  });
}
