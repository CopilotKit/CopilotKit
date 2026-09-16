import * as store from "@/skins/keel/data/store";
import { findPersona } from "@/skins/keel/data/personas";

/**
 * Start a process run from a playbook.
 *
 * No `GET` here: the run LIST rides in `GET /ledger` with everything else, so a
 * page mounts with one request and its readables all describe one instant. The
 * per-run read lives at `runs/[runId]`, which is what the parameterized route
 * `/<skin>/runs/<runId>` needs.
 *
 * `requestedBy` is DERIVED from the resolved persona and never read off the
 * body, matching every other write in this substrate.
 */
export const POST = async (req: Request) => {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json(
      { error: "BAD_REQUEST", message: "A JSON body is required." },
      { status: 400 },
    );
  }
  const { playbookId, subject, values, personaId } = body as {
    playbookId?: string;
    subject?: string;
    values?: Record<string, string>;
    personaId?: string;
  };
  const persona = personaId ? findPersona(personaId) : undefined;
  if (!persona) {
    return Response.json(
      { error: "BAD_REQUEST", message: "A known personaId is required." },
      { status: 400 },
    );
  }
  if (!subject || !subject.trim()) {
    return Response.json(
      { error: "BAD_REQUEST", message: "A run needs a subject." },
      { status: 400 },
    );
  }

  const result = store.startRun(
    playbookId ?? "",
    { subject: subject.trim(), values },
    persona.name,
  );
  if (!result.ok) {
    return Response.json(
      { error: "UNKNOWN_PLAYBOOK", message: result.reason },
      { status: 404 },
    );
  }
  return Response.json(result.run, { status: 201 });
};
