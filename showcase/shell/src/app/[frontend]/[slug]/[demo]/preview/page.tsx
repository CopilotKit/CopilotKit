import { FrontendCellStatus } from "@/components/frontend-cell-status";
import { resolveShowcaseCell } from "@/lib/frontend-route";
import { getRuntimeConfig } from "@/lib/runtime-config";

export default async function FrontendPreviewPage({
  params,
}: {
  params: Promise<{ frontend: string; slug: string; demo: string }>;
}) {
  const { frontend, slug, demo } = await params;
  const resolution = resolveShowcaseCell({
    frontend,
    integration: slug,
    feature: demo,
    backendHostPattern: getRuntimeConfig().backendHostPattern,
  });

  if (resolution.kind !== "runnable") {
    return <FrontendCellStatus resolution={resolution} />;
  }

  return (
    <div className="h-[calc(100vh-52px)] w-full">
      <iframe
        src={resolution.iframeUrl}
        className="h-full w-full border-0"
        title={`${resolution.frontend.name} ${resolution.integrationName} ${resolution.featureName} demo`}
        allow="clipboard-read; clipboard-write; microphone"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      />
    </div>
  );
}
