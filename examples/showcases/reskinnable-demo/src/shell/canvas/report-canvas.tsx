"use client";

import { OpenGenerativeUIActivityRenderer } from "@copilotkit/react-core/v2";
import { useSkin } from "@/shell/skin-provider";
import { useOguiSurface } from "./use-ogui-surface";
import { useCanvas } from "./canvas-context";

/**
 * The shared canvas dispatcher. The shell owns the canvas region, OGUI
 * rendering and surface-kind detection; a skin owns only its own a2ui report
 * surface (supplied as `skin.CanvasSurface`).
 *
 * - "ogui" surfaces render their sandboxed iframe full-region here, via the
 *   workspace `OpenGenerativeUIActivityRenderer` (this build ships it — the
 *   published-SDK "no full-canvas OGUI renderer" caveat does NOT apply here).
 * - "report" surfaces defer to the active skin's `CanvasSurface`. A skin with
 *   no a2ui report surface (bookstore and exec) simply renders nothing for
 *   that kind.
 */
export function ReportCanvas() {
  const { activeSurfaceKind } = useCanvas();
  const skin = useSkin();

  if (activeSurfaceKind === "ogui") return <OguiCanvas />;
  if (skin.CanvasSurface) {
    const Surface = skin.CanvasSurface;
    return <Surface />;
  }
  return null;
}

/** OGUI surfaces render their sandboxed iframe full-region on the canvas. */
function OguiCanvas() {
  const { content } = useOguiSurface();
  if (!content) return null;
  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 md:p-8" data-testid="ogui-surface">
        {/* message/agent are required by the renderer's prop type but only
            `content` is read; pass null to satisfy the type. */}
        <OpenGenerativeUIActivityRenderer
          activityType="open-generative-ui"
          content={content}
          message={null}
          agent={null}
        />
      </div>
    </div>
  );
}
