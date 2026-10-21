import { TrajectoryFrame } from "@/intelligence-ui/screens/trajectory-frame";

export default async function TrajectoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ event?: string }>;
}) {
  const [{ id }, { event }] = await Promise.all([params, searchParams]);
  return (
    <TrajectoryFrame
      trajectoryId={decodeURIComponent(id)}
      focusEventId={event ?? null}
    />
  );
}
