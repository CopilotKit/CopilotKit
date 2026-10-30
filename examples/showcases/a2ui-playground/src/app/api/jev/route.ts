import { searchPlaces } from "@/agent/apis";
import { runJev } from "@/jev/decide.server";
import { parseWhere } from "@/jev/usecases";
import { USE_CASES, type UseCaseId } from "@/jev/usecases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const startedAt = performance.now();
  const body = (await req.json().catch(() => ({}))) as { usecase?: string; prompt?: string; fixture?: boolean; placesOnly?: boolean; stream?: boolean };
  // Dev only: check the real place lookup without a Jev call.
  if (body.placesOnly && process.env.NODE_ENV !== "production") {
    const where = parseWhere(body.prompt ?? "");
    const t0 = performance.now();
    const r = await searchPlaces("cafe", where.query, 36).catch((e) => ({ error: String(e) }));
    return Response.json({ where, ms: Math.round(performance.now() - t0), r });
  }
  const usecase = (body.usecase ?? "cafes") as UseCaseId;
  if (!(usecase in USE_CASES)) return Response.json({ error: "Unknown use case" }, { status: 400 });
  const prompt = (body.prompt ?? "").trim().slice(0, 500) || USE_CASES[usecase].prompt;
  if (body.stream) return streamRun({ usecase, prompt, fixture: !!body.fixture, signal: req.signal, startedAt });
  try {
    const result = await runJev({ usecase, prompt, fixture: !!body.fixture, signal: req.signal });
    return Response.json(result);
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    console.error("[jev]", raw);
    return Response.json({ error: shortError(raw) }, { status: 502 });
  }
}

/**
 * NDJSON stream of the same run: one `{"type":"event",...}` line per step the moment it completes on the server
 * (timestamps relative to the request arriving), then one final `result`, `notice` or `error` line.
 */
function streamRun(args: { usecase: UseCaseId; prompt: string; fixture: boolean; signal: AbortSignal; startedAt: number }) {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      send({ type: "event", t: Math.round(performance.now() - args.startedAt), kind: "request", label: "Request received", detail: args.fixture ? "replay" : undefined });
      try {
        const r = await runJev({ ...args, onEvent: (e) => send({ type: "event", ...e }) });
        send("notice" in r ? { type: "notice", notice: r } : { type: "result", result: r });
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        console.error("[jev]", raw);
        send({ type: "error", error: shortError(raw) });
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
}

/** One readable line for the UI. */
function shortError(raw: string) {
  if (/free tier/i.test(raw)) return "Jev needs paid AI Gateway credits on this team";
  const first = raw.split(/(?<=\.)\s/)[0] ?? raw;
  return first.length > 110 ? `${first.slice(0, 107)}...` : first;
}
