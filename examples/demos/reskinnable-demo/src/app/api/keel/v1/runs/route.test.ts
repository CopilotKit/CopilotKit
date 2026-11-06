import { describe, it, expect, beforeEach } from "vitest";
import { POST as START } from "./route";
import { GET as READ_RUN } from "./[runId]/route";
import { POST as APPROVE } from "./[runId]/steps/[stepId]/approve/route";
import { POST as REJECT } from "./[runId]/steps/[stepId]/reject/route";
import { POST as CANCEL } from "./[runId]/cancel/route";
import * as store from "@/skins/keel/data/store";
import { getPersona } from "@/skins/keel/data/personas";

beforeEach(() => store.reset());

const ANA = getPersona("ana-reyes");
const SAM = getPersona("sam-okafor");

const start = (body: unknown) =>
  START(
    new Request("http://localhost/x", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );

const readRun = (runId: string) =>
  READ_RUN(new Request("http://localhost/x"), {
    params: Promise.resolve({ runId }),
  });

const step = (
  handler: (
    req: Request,
    ctx: { params: Promise<{ runId: string; stepId: string }> },
  ) => Promise<Response>,
  runId: string,
  stepId: string,
  body: unknown,
) =>
  handler(
    new Request("http://localhost/x", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ runId, stepId }) },
  );

const cancel = (runId: string) =>
  CANCEL(new Request("http://localhost/x", { method: "POST" }), {
    params: Promise.resolve({ runId }),
  });

describe("GET /runs/[runId] — the parameterized run route", () => {
  it("returns the run and its playbook together", () => {
    // Fetched separately they could describe different moments, and the detail
    // page renders both at once.
    return readRun("RUN-1044").then(async (res) => {
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.run.id).toBe("RUN-1044");
      expect(body.playbook.id).toBe(body.run.playbookId);
      expect(body.run.steps.length).toBeGreaterThan(0);
    });
  });

  it("404s a run that does not exist", async () => {
    expect((await readRun("RUN-9999")).status).toBe(404);
  });
});

describe("POST /runs", () => {
  it("starts a run and derives requestedBy from the persona", async () => {
    const res = await start({
      playbookId: "phi-access-contractor",
      subject: "Priya Raman — Radiology contractor",
      values: { department: "Radiology" },
      personaId: ANA.id,
    });
    expect(res.status).toBe(201);
    const run = await res.json();
    expect(run.requestedBy).toBe(ANA.name);
    expect(run.subject).toBe("Priya Raman — Radiology contractor");
    expect(store.findRun(run.id)).toBeDefined();
  });

  it("400s a missing subject, a blank subject and an unknown persona", async () => {
    expect(
      (await start({ playbookId: "phi-access-contractor", personaId: ANA.id }))
        .status,
    ).toBe(400);
    expect(
      (
        await start({
          playbookId: "phi-access-contractor",
          subject: "   ",
          personaId: ANA.id,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await start({
          playbookId: "phi-access-contractor",
          subject: "x",
          personaId: "nobody",
        })
      ).status,
    ).toBe(400);
  });

  it("404s an unknown playbook without starting anything", async () => {
    const before = store.runs().length;
    const res = await start({
      playbookId: "nope",
      subject: "x",
      personaId: ANA.id,
    });
    expect(res.status).toBe(404);
    expect(store.runs()).toHaveLength(before);
  });

  it("400s a body that is not JSON", async () => {
    const res = await START(
      new Request("http://localhost/x", { method: "POST", body: "not json" }),
    );
    expect(res.status).toBe(400);
  });
});

describe("approving a gate honours the role the gate names", () => {
  // RUN-1044 is blocked at `scope-review`, which requires a Privacy Officer.
  it("409s the wrong role and says which role the gate wants", async () => {
    const res = await step(APPROVE, "RUN-1044", "scope-review", {
      personaId: ANA.id,
    });
    expect(res.status).toBe(409);
    expect((await res.json()).message).toContain("Privacy Officer");
    expect(store.findRun("RUN-1044")?.status).toBe("blocked");
  });

  it("advances the run for the right role", async () => {
    const res = await step(APPROVE, "RUN-1044", "scope-review", {
      personaId: SAM.id,
    });
    expect(res.status).toBe(200);
    const run = await res.json();
    expect(run.status).not.toBe("blocked");
    expect(
      run.steps.find((s: { id: string }) => s.id === "scope-review").approvedBy,
    ).toBe(SAM.name);
  });

  it("409s a gate that already advanced", async () => {
    await step(APPROVE, "RUN-1044", "scope-review", { personaId: SAM.id });
    const res = await step(APPROVE, "RUN-1044", "scope-review", {
      personaId: SAM.id,
    });
    expect(res.status).toBe(409);
  });

  it("400s an unknown persona", async () => {
    expect(
      (await step(APPROVE, "RUN-1044", "scope-review", { personaId: "x" }))
        .status,
    ).toBe(400);
  });
});

describe("rejecting records rejectedBy and NEVER approvedBy", () => {
  it("cancels the run and marks the step failed", async () => {
    const res = await step(REJECT, "RUN-1044", "scope-review", {
      personaId: SAM.id,
      note: "Scope is too wide.",
    });
    expect(res.status).toBe(200);
    const run = await res.json();
    const gate = run.steps.find((s: { id: string }) => s.id === "scope-review");
    expect(gate.rejectedBy).toBe(SAM.name);
    expect(gate.approvedBy).toBeUndefined();
    expect(run.status).toBe("cancelled");
  });

  it("409s the wrong role, exactly as approve does", async () => {
    expect(
      (await step(REJECT, "RUN-1044", "scope-review", { personaId: ANA.id }))
        .status,
    ).toBe(409);
  });
});

describe("cancelling", () => {
  it("cancels a live run", async () => {
    const res = await cancel("RUN-1044");
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("cancelled");
  });

  it("409s a run that is already finished", async () => {
    await cancel("RUN-1044");
    expect((await cancel("RUN-1044")).status).toBe(409);
    expect((await cancel("RUN-1041")).status).toBe(409);
  });

  it("404s a run that does not exist", async () => {
    expect((await cancel("RUN-9999")).status).toBe(404);
  });
});
