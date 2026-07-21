import ReactDemoCodeViewer from "@/components/react-demo-code-viewer";
import { FrontendCellStatus } from "@/components/frontend-cell-status";
import { resolveShowcaseCell } from "@/lib/frontend-route";
import { getRuntimeConfig } from "@/lib/runtime-config";

export default async function FrontendCodePage({
  params,
}: {
  params: Promise<{ frontend: string; slug: string; demo: string }>;
}) {
  const { frontend, slug, demo } = await params;
  const config = getRuntimeConfig();
  const resolution = resolveShowcaseCell({
    frontend,
    integration: slug,
    feature: demo,
    backendHostPattern: config.backendHostPattern,
    angularHostUrl: config.angularHostUrl,
  });

  if (resolution.kind !== "runnable") {
    return <FrontendCellStatus resolution={resolution} />;
  }

  if (frontend === "react") {
    return <ReactDemoCodeViewer />;
  }

  return (
    <section
      role="status"
      className="mx-auto mt-16 max-w-xl border border-[var(--border)] bg-[var(--bg-surface)] p-6"
    >
      <h1 className="text-lg font-semibold text-[var(--text)]">
        Angular source
      </h1>
      <p className="mt-2 text-sm text-[var(--text-secondary)]">
        This demo is implemented by the canonical Angular host. Its feature
        source will be shown here from that host&apos;s generated source index.
      </p>
      <p className="mt-4 break-all font-mono text-xs text-[var(--text-muted)]">
        {resolution.cellId}
      </p>
    </section>
  );
}
