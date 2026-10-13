import { redirect } from "next/navigation";

/**
 * The copied Insight drawer links evidence to `/threads/<threadId>`. In this demo
 * a cited source is a signal, `<trajectoryId>~<eventId>`, so open the
 * trajectory at that exact event.
 */
export default async function ThreadRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [trajectoryId, eventId] = decodeURIComponent(id).split("~");
  redirect(
    `/intelligence/trajectories/${encodeURIComponent(trajectoryId ?? "")}${eventId ? `?event=${encodeURIComponent(eventId)}` : ""}`,
  );
}
