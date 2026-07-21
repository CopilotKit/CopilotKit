import { FrontendCellStatus } from "@/components/frontend-cell-status";
import { FrontendDemoViewer } from "@/components/frontend-demo-viewer";
import {
  getRunnableFrontends,
  resolveShowcaseCell,
} from "@/lib/frontend-route";
import { getRuntimeConfig } from "@/lib/runtime-config";

export default async function FrontendDemoPage({
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

  return (
    <FrontendDemoViewer
      resolution={resolution}
      integration={slug}
      feature={demo}
      frontends={getRunnableFrontends()}
    />
  );
}
