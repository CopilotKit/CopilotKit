/** Process liveness only; this does not certify hosted Omnara readiness. */
export function GET() {
  return Response.json({ status: "ok", integration: "omnara" });
}
