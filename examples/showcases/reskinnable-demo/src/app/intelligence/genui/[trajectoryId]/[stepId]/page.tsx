import { readFile } from "node:fs/promises";
import path from "node:path";
import { notFound } from "next/navigation";
import { recordedGenUi } from "@/intelligence-ui/genui/server";
import { GenUiView } from "@/intelligence-ui/genui/genui-view";

/**
 * One recorded generative UI step, drawn with Ledgerline's own component. The
 * trajectory view (`/intelligence/trajectory-view/[id]`) embeds this page in an
 * iframe wherever the agent drew UI. `stepId` is `<threadId>:<stepId>`.
 * Outside the `(workspace)` route group on purpose: it carries the app's
 * styles (root globals + the Ledgerline theme), not the Intelligence shell's.
 */
export const dynamic = "force-dynamic";

const WIDGET = path.join(
  process.cwd(),
  "src/skins/ledgerline/mcp-app/dist/ledgerline-app.html",
);

export default async function GenUiPage({
  params,
}: {
  params: Promise<{ trajectoryId: string; stepId: string }>;
}) {
  const { trajectoryId, stepId } = await params;
  const id = decodeURIComponent(trajectoryId);
  const ref = decodeURIComponent(stepId);
  const ui = recordedGenUi(id, ref);
  if (!ui) notFound();
  const widgetHtml =
    ui.component === "LedgerlineAppWidget"
      ? await readFile(WIDGET, "utf8").catch(() => null)
      : null;
  return (
    <GenUiView
      frameId={`${id}:${ref}`}
      component={ui.component}
      props={ui.props}
      widgetHtml={widgetHtml}
    />
  );
}
