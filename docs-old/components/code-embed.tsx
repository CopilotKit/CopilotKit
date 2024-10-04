import sdk from "@stackblitz/sdk";
import { useEffect, useRef } from "react";

export function CodeEmbed() {
  const codeEmbedRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const embedProject = async () => {
      if (codeEmbedRef.current) {
        const vm = await sdk.embedProjectId(codeEmbedRef.current, "stackblitz-starters-65j6at", {
          forceEmbedLayout: true,
          openFile: [],
          height: 600,
          view: "default",
          terminalHeight: 0,
          hideDevTools: true,
          hideExplorer: true,
          hideNavigation: true,
        });

        vm.editor.openFile("app/page.tsx");

        await vm.applyFsDiff({ destroy: [".env"], create: {} });

        await vm.applyFsDiff({
          create: {
            ".env": "COPILOT_CLOUD_PUBLIC_API_KEY=123"
          },
          destroy: [],
        });
      }
    };

    embedProject();
  }, []);

  return <div ref={codeEmbedRef} id="code_embed_123" style={{ height: 800 }} />;
}
