import { AngularSourceViewer } from "@/components/angular-source-viewer";
import { FrontendCellStatus } from "@/components/frontend-cell-status";
import ReactDemoCodeViewer from "@/components/react-demo-code-viewer";
import { resolveShowcaseCell } from "@/lib/frontend-route";
import { getRuntimeConfig } from "@/lib/runtime-config";

export default async function FrontendCodePage({
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

  return frontend === "angular" ? (
    <AngularSourceViewer feature={demo} />
  ) : (
    <ReactDemoCodeViewer />
  );
}
