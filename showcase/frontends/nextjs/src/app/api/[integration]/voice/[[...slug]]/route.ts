/**
 * Runtime route for the `/voice` demo.
 *
 * Why this cannot be the generic route: the demo passes a
 * `transcriptionService` — a CLASS INSTANCE with a `transcribeFile` method.
 * No manifest field can carry an object with behaviour.
 *
 * Setting it does two things the demo depends on: `/info` starts advertising
 * `audioFileTranscriptionEnabled: true`, so the composer renders the mic
 * button, and `POST /transcribe` starts answering.
 *
 * Everything else — which backend, which agent name, which runtime options —
 * comes from the manifest through the same resolver the generic route uses.
 *
 * Next.js prefers this static `voice` segment over the sibling `[demo]`
 * segment automatically, so `/api/<integration>/voice/...` lands here. The
 * generic route also refuses `demo === "voice"` outright, so the routing
 * preference is not the only thing keeping the two apart.
 *
 * Ported from showcase/integrations/*\/src/app/api/copilotkit-voice/[[...slug]]/route.ts.
 */

import { TranscriptionService } from "@copilotkit/runtime/v2";
import type { TranscribeFileOptions } from "@copilotkit/runtime/v2";
import { TranscriptionServiceOpenAI } from "@copilotkit/voice";
import OpenAI from "openai";

import { handleDemoRequest } from "@/lib/demo-runtime";

export const dynamic = "force-dynamic";

const DEMO_ID = "voice";

/**
 * Transcription service wrapper that reports a clean, typed auth error when
 * OPENAI_API_KEY is not configured, instead of an opaque 5xx. The V2
 * runtime's `handleTranscribe` maps error messages containing "api key" or
 * "unauthorized" to `AUTH_FAILED` -> HTTP 401, so throwing with that wording
 * funnels the missing-key case into the intended 4xx path.
 *
 * `baseURL` is pinned to real OpenAI (or `OPENAI_TRANSCRIPTION_BASE_URL`
 * when explicitly set) rather than falling through to `OPENAI_BASE_URL`. In
 * local docker and Railway preview environments `OPENAI_BASE_URL` points at
 * aimock so LLM completions stay deterministic, but aimock has a catch-all
 * `endpoint: "transcription"` fixture that would intercept every real mic
 * recording and return the canned "What is the weather in Tokyo?" phrase
 * regardless of what the user said. The sample-audio button is the
 * deterministic affordance; the mic is the only path that should exercise
 * real Whisper.
 */
class GuardedOpenAITranscriptionService extends TranscriptionService {
  private delegate: TranscriptionServiceOpenAI | null;

  constructor() {
    super();
    const apiKey = process.env.OPENAI_API_KEY;
    // `||`, never `??`, on THIS line. An unset variable in docker compose or
    // Railway arrives as `""`, not as `undefined`, so `??` would keep the empty
    // string and hand the OpenAI client `baseURL: ""` — every transcription
    // then fails with a URL error. `resolveAgentBaseUrl` uses `||` for the same
    // reason. The `apiKey` line above needs no operator: empty and undefined are
    // collapsed by the `apiKey ? … : null` test below, which is what turns a
    // missing key into the typed 401 rather than into a client that dials with
    // no credential. Do not "tidy" that read into `?? ""`: it changes nothing,
    // and it suggests the empty case is handled there when the test below is
    // what handles it.
    const baseURL =
      process.env.OPENAI_TRANSCRIPTION_BASE_URL || "https://api.openai.com/v1";
    this.delegate = apiKey
      ? new TranscriptionServiceOpenAI({
          openai: new OpenAI({ apiKey, baseURL }),
        })
      : null;
  }

  async transcribeFile(options: TranscribeFileOptions): Promise<string> {
    if (!this.delegate) {
      // "api key" substring -> handleTranscribe maps to AUTH_FAILED -> 401.
      throw new Error(
        "OPENAI_API_KEY not configured for this deployment (api key missing). " +
          "Set OPENAI_API_KEY to enable voice transcription.",
      );
    }
    return this.delegate.transcribeFile(options);
  }
}

/**
 * The `runtimeExtras` object this route contributes, built once per process.
 *
 * Two independent reasons it must be a singleton, and neither is the one an
 * earlier version of this comment gave:
 *
 *  - The service reads OPENAI_API_KEY in its constructor, so rebuilding it per
 *    request is pointless work.
 *  - `handleDemoRequest` MEMOISES the handler, runtime and agent per
 *    resolution, and `runtimeExtras` joins that cache key by object identity.
 *    A fresh object per request would therefore mint a fresh handler per
 *    request, refiring the per-handler telemetry the memoisation exists to
 *    stop.
 *
 * Per-demo isolation does NOT come from per-request construction (nothing here
 * is built per request any more) — it comes from the cache key, which carries
 * the slug, the demo id, this route's id and the resolved options.
 *
 * Lazy rather than a module-level `const` so importing this route never
 * constructs an OpenAI client as a side effect.
 */
let runtimeExtras: { transcriptionService: TranscriptionService } | null = null;
function getRuntimeExtras(): { transcriptionService: TranscriptionService } {
  runtimeExtras ??= {
    transcriptionService: new GuardedOpenAITranscriptionService(),
  };
  return runtimeExtras;
}

type RouteParams = { integration: string; slug?: string[] };

async function serve(
  req: Request,
  ctx: { params: Promise<RouteParams> },
): Promise<Response> {
  const { integration } = await ctx.params;
  return handleDemoRequest(req, {
    // `basePath` does not identify a route: the generic `[demo]` route with
    // `demo === "voice"` computes the same string. Without a distinct
    // `routeId` the two would share one cached handler, and the demo would
    // sometimes answer with no transcription service.
    routeId: "voice",
    slug: integration,
    demoId: DEMO_ID,
    basePath: `/api/${integration}/${DEMO_ID}`,
    // MULTI-ROUTE, and it must stay that way: `demos/voice/page.tsx` sets
    // `useSingleEndpoint={false}`, so its client requests `GET /info` (to read
    // `audioFileTranscriptionEnabled` and render the mic button) and
    // `POST /transcribe` as URLs. Single-route would serve neither shape, the
    // mic button would never appear, and the failure would look like a missing
    // OPENAI_API_KEY rather than a protocol mismatch.
    mode: "multi-route",
    runtimeExtras: getRuntimeExtras(),
  });
}

export const GET = serve;
export const POST = serve;
export const PUT = serve;
export const DELETE = serve;
export const OPTIONS = serve;
