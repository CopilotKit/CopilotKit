"use client";

import { useState } from "react";
import { usePlaygroundConfig } from "@/hooks/usePlaygroundConfig";
import { SettingsPanel } from "./SettingsPanel";
import { PreviewPanel } from "./PreviewPanel";
import { CodeExporter } from "./CodeExporter";

export function PlaygroundContainer() {
  const [isExportOpen, setIsExportOpen] = useState(false);
  const {
    config,
    updateAgentConfig,
    updateLabel,
    updateColor,
    updateTypography,
    updateStyle,
    updateColorScheme,
    resetConfig,
  } = usePlaygroundConfig();

  return (
    <>
      <div className="relative flex h-screen overflow-hidden p-2">
        <div className="flex flex-1 overflow-hidden z-1 gap-2">
          <SettingsPanel
            config={config}
            onUpdateAgentConfig={updateAgentConfig}
            onUpdateLabel={updateLabel}
            onUpdateColor={updateColor}
            onUpdateTypography={updateTypography}
            onUpdateStyle={updateStyle}
            onUpdateColorScheme={updateColorScheme}
            onReset={resetConfig}
          />
          <PreviewPanel config={config} onExport={() => setIsExportOpen(true)} />
        </div>

        {/* Background blur circles - Dojo exact specs */}
        {/* Ellipse 1351 */}
        <div className="absolute w-[445.84px] h-[445.84px] left-[1040px] top-[11px] rounded-full z-0 pointer-events-none"
             style={{ background: 'rgba(255, 172, 77, 0.2)', filter: 'blur(103.196px)' }} />

        {/* Ellipse 1347 */}
        <div className="absolute w-[609.35px] h-[609.35px] left-[1338.97px] top-[624.5px] rounded-full z-0 pointer-events-none"
             style={{ background: '#C9C9DA', filter: 'blur(103.196px)' }} />

        {/* Ellipse 1350 */}
        <div className="absolute w-[609.35px] h-[609.35px] left-[670px] top-[-365px] rounded-full z-0 pointer-events-none"
             style={{ background: '#C9C9DA', filter: 'blur(103.196px)' }} />

        {/* Ellipse 1348 */}
        <div className="absolute w-[609.35px] h-[609.35px] left-[507.87px] top-[702.14px] rounded-full z-0 pointer-events-none"
             style={{ background: '#F3F3FC', filter: 'blur(103.196px)' }} />

        {/* Ellipse 1346 */}
        <div className="absolute w-[445.84px] h-[445.84px] left-[127.91px] top-[331px] rounded-full z-0 pointer-events-none"
             style={{ background: 'rgba(255, 243, 136, 0.3)', filter: 'blur(103.196px)' }} />

        {/* Ellipse 1268 */}
        <div className="absolute w-[445.84px] h-[445.84px] left-[-205px] top-[802.72px] rounded-full z-0 pointer-events-none"
             style={{ background: 'rgba(255, 172, 77, 0.2)', filter: 'blur(103.196px)' }} />
      </div>

      <CodeExporter
        config={config}
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
      />
    </>
  );
}
