import { NextResponse } from "next/server";
import { createOpenBoxApprovalRoute } from "@openbox-ai/openbox-sdk/copilotkit";
import { z } from "zod";
import { enforceApprovalGuards } from "@/lib/approval-guard";

export const runtime = "nodejs";

const DecisionSchema = z.object({
  governanceEventId: z.string().min(1),
  decision: z.enum(["approve", "reject"]),
});

const approvalRoute = createOpenBoxApprovalRoute({
  clientName: "openbox-governed-copilotkit",
  backendTimeoutMs: 180_000,
});

export async function POST(request: Request) {
  const startedAt = Date.now();
  console.info(
    "[openbox-governed-copilotkit] /api/openbox/approvals/decide started",
  );

  // Abuse controls before any work: same-origin guard, optional operator
  // token, and a per-IP rate limit. See src/lib/approval-guard.ts.
  const blocked = enforceApprovalGuards(request);
  if (blocked) {
    console.info(
      `[openbox-governed-copilotkit] /api/openbox/approvals/decide rejected by guard in ${Date.now() - startedAt}ms`,
    );
    return blocked;
  }

  const parsed = DecisionSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    console.info(
      `[openbox-governed-copilotkit] /api/openbox/approvals/decide finished in ${Date.now() - startedAt}ms`,
    );
    return NextResponse.json(
      { ok: false, error: "Invalid OpenBox approval decision request." },
      { status: 400 },
    );
  }

  try {
    const resolved = await approvalRoute.decide(parsed.data);

    console.info(
      `[openbox-governed-copilotkit] /api/openbox/approvals/decide finished in ${Date.now() - startedAt}ms`,
    );
    return NextResponse.json({
      ok: true,
      decision: parsed.data.decision,
      eventId: resolved.eventId,
    });
  } catch (error) {
    console.error(
      "[openbox-governed-copilotkit] OpenBox approval decision failed",
      error,
    );
    return NextResponse.json(
      { ok: false, error: "Something went wrong. Try again later." },
      { status: 502 },
    );
  }
}
