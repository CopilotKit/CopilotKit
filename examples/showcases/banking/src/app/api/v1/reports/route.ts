import * as store from "@/lib/store";

// Get all reports (newest first — the store unshifts on file)
export const GET = async () => {
  return new Response(JSON.stringify(store.reports()), { status: 200 });
};

// File a new copilot-generated report
export const POST = async (req: Request) => {
  const body = await req.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const summary = typeof body?.summary === "string" ? body.summary.trim() : "";
  const highlights = Array.isArray(body?.highlights)
    ? body.highlights.filter((h: unknown): h is string => typeof h === "string")
    : [];
  const createdBy =
    typeof body?.createdBy === "string" && body.createdBy.trim()
      ? body.createdBy.trim()
      : "Copilot";

  if (!title || !summary) {
    return new Response(
      JSON.stringify({ error: "title and summary are required" }),
      { status: 400 },
    );
  }

  const report = store.addReport({ title, summary, highlights, createdBy });
  return new Response(JSON.stringify(report), { status: 201 });
};
