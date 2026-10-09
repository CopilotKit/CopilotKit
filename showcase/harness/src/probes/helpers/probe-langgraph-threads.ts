const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RequestRoute = {
  continue(options?: { postData?: string }): Promise<void>;
};

type RunRequest = {
  url(): string;
  method(): string;
  postData(): string | null;
};

type RouteablePage = {
  route?(
    pattern: RegExp,
    handler: (route: RequestRoute, request: RunRequest) => Promise<void>,
  ): Promise<unknown>;
};

type ProbeLogger = {
  warn(event: string, meta?: Record<string, unknown>): void;
};

/** Mark fresh probe threads in LangGraph and retain their exact IDs for cleanup. */
export async function captureProbeThreads(
  page: RouteablePage,
  testId: string,
): Promise<Set<string>> {
  const threadIds = new Set<string>();
  await page.route?.(
    /\/api\/copilotkit(?:\/|-|$|\?)/,
    async (route, request) => {
      let postData: string | null = null;
      try {
        if (
          request.method() === "POST" &&
          /\/api\/copilotkit(?:-[a-z0-9-]+)?(?:\/agent\/[^/]+\/run)?$/.test(
            new URL(request.url()).pathname,
          )
        ) {
          const raw = request.postData();
          if (raw) {
            const requestBody = JSON.parse(raw) as Record<string, unknown>;
            const enveloped =
              requestBody.method === "agent/run" &&
              requestBody.body !== null &&
              typeof requestBody.body === "object";
            const input = enveloped
              ? (requestBody.body as Record<string, unknown>)
              : requestBody;
            if (
              typeof input.threadId === "string" &&
              UUID.test(input.threadId)
            ) {
              threadIds.add(input.threadId);
              const forwardedProps =
                input.forwardedProps && typeof input.forwardedProps === "object"
                  ? (input.forwardedProps as Record<string, unknown>)
                  : {};
              const threadMetadata =
                forwardedProps.threadMetadata &&
                typeof forwardedProps.threadMetadata === "object"
                  ? (forwardedProps.threadMetadata as Record<string, unknown>)
                  : {};
              const markedInput = {
                ...input,
                forwardedProps: {
                  ...forwardedProps,
                  threadMetadata: {
                    ...threadMetadata,
                    showcase_probe: true,
                    showcase_probe_id: testId,
                  },
                },
              };
              postData = JSON.stringify(
                enveloped ? { ...requestBody, body: markedInput } : markedInput,
              );
            }
          }
        }
      } catch {
        // Leave malformed or unrelated requests unchanged.
      }
      if (postData) {
        await route.continue({ postData });
      } else {
        await route.continue();
      }
    },
  );
  return threadIds;
}

/** Release only the probe's own LangGraph threads after its full conversation. */
export async function cleanupProbeThreads(
  backendUrl: string,
  testId: string,
  threadIds: Set<string>,
  logger: ProbeLogger,
): Promise<void> {
  if (threadIds.size === 0) return;
  try {
    const response = await fetch(`${backendUrl}/api/probe-threads`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ testId, threadIds: [...threadIds] }),
      signal: AbortSignal.timeout(5_000),
    });
    // Only LangGraph Python services expose this endpoint. Other integrations
    // run the same shared probe and return 404.
    if (!response.ok && response.status !== 404) {
      logger.warn("probe.e2e.langgraph-cleanup-failed", {
        status: response.status,
      });
    }
  } catch (error) {
    logger.warn("probe.e2e.langgraph-cleanup-failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
