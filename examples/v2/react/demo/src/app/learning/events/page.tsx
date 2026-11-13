import { listEvents, openLearningDb } from "@/lib/learning-db";
import type { LearningEventRow } from "@/lib/learning-db";

export const dynamic = "force-dynamic";

function groupByTrajectory(rows: LearningEventRow[]) {
  const groups = new Map<string, LearningEventRow[]>();
  for (const row of rows) {
    const group = groups.get(row.trajectoryId) ?? [];
    group.push(row);
    groups.set(row.trajectoryId, group);
  }
  return [...groups.entries()];
}

function threadLabel(row: LearningEventRow) {
  if (row.threadId !== null) return row.threadId.slice(0, 8);
  if ("threadAmbiguity" in row.value) return "ambiguous";
  return "threadId" in row.value ? "no Thread" : "page-level";
}

/** Server page: reads the local SQLite sink. Clicks here are not captured. */
export default function CapturedEventsPage() {
  // Newest Trajectory first.
  const trajectories = groupByTrajectory(
    listEvents(openLearningDb()),
  ).toReversed();

  return (
    <section data-copilotkit-ignore className="max-w-5xl">
      <h1 className="mb-4 text-2xl font-semibold">Captured events</h1>
      {trajectories.length === 0 ? (
        <p>No events yet. Use the deals pages first.</p>
      ) : null}
      {trajectories.map(([trajectoryId, rows]) => {
        const threads = [
          ...new Set(
            rows.flatMap((row) =>
              row.threadId === null ? [] : [row.threadId],
            ),
          ),
        ];
        return (
          <article key={trajectoryId} className="mb-8 rounded border">
            <header className="border-b bg-gray-50 p-3 text-sm">
              <div>
                Trajectory <code>{trajectoryId}</code> · {rows.length} events
              </div>
              <div>
                Threads:{" "}
                {threads.length === 0
                  ? "none"
                  : threads.map((id) => (
                      <code key={id} className="mr-2">
                        {id}
                      </code>
                    ))}
              </div>
            </header>
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b">
                  <th className="p-2">seq</th>
                  <th className="p-2">name</th>
                  <th className="p-2">Thread</th>
                  <th className="p-2">value</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b align-top">
                    <td className="p-2">{row.seq}</td>
                    <td className="p-2 font-mono">{row.name}</td>
                    <td className="p-2 font-mono">{threadLabel(row)}</td>
                    <td className="p-2">
                      <pre className="whitespace-pre-wrap break-all">
                        {JSON.stringify(row.value, null, 1)}
                      </pre>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
        );
      })}
    </section>
  );
}
