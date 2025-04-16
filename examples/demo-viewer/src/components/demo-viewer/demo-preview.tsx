"use client";

import React, { Suspense, useRef, useEffect } from 'react';
import { DemoConfig } from '@/types/demo';
import { createPortal } from 'react-dom';
// Assuming files.json is correctly placed relative to this component or imported elsewhere
import filesJSON from '../../files.json';

// Custom iframe component that renders React components inside
function IsolatedFrame({
  demoId,
  children,
}: {
  demoId: string;
  children: React.ReactNode;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeLoaded, setIframeLoaded] = React.useState(false);
  const [iframeRoot, setIframeRoot] = React.useState<HTMLElement | null>(null);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const handleLoad = () => {
      if (!iframe.contentDocument?.body) return;

      // Clear any existing content
      iframe.contentDocument.body.innerHTML = '';
      iframe.contentDocument.head.innerHTML = '';
      
      // Add base styles to iframe
      const style = iframe.contentDocument.createElement("style");
      style.textContent = `
        html, body {
          margin: 0;
          padding: 0;
          height: 100%;
          overflow: auto;
          font-family: sans-serif;
        }
        #root {
          min-height: 100%;
          height: 100%;
        }
      `;
      iframe.contentDocument.head.appendChild(style);

      // Create root element
      const root = iframe.contentDocument.createElement("div");
      root.id = "root";
      iframe.contentDocument.body.appendChild(root);

      // Copy parent styles to iframe
      const parentStyles = Array.from(
        document.querySelectorAll('style, link[rel="stylesheet"]')
      );
      parentStyles.forEach((styleNode) => {
        const clone = styleNode.cloneNode(true);
        // Ensure head exists before appending
        if (iframe.contentDocument?.head) {
          iframe.contentDocument.head.appendChild(clone);
        }
      });

      // Apply direct styles from files.json to iframe content
      // Use the full demoId (framework_agentId) as the key
      const demoStyleContent = (filesJSON as any)[demoId]?.files.find((f: any) => f.name === 'style.css')?.content;
      if (demoStyleContent && iframe.contentDocument?.head) {
        const styleElement = iframe.contentDocument.createElement('style');
        styleElement.textContent = demoStyleContent;
        iframe.contentDocument.head.appendChild(styleElement);
      }
      
      setIframeRoot(root);
      setIframeLoaded(true);
    };

    iframe.addEventListener("load", handleLoad);

    // If the iframe is already loaded, call handleLoad immediately
    if (iframe.contentDocument?.readyState === "complete") {
      handleLoad();
    }

    return () => {
      iframe.removeEventListener("load", handleLoad);
    };
  }, [demoId]); // Dependency array includes demoId

  return (
    <iframe
      ref={iframeRef}
      className="w-full h-full border-0 bg-background"
      title="Demo Preview"
      sandbox="allow-same-origin allow-scripts allow-forms"
      // Use srcDoc to ensure a clean initial state and trigger load event reliably
      srcDoc="<!DOCTYPE html><html><head></head><body></body></html>"
    >
      {iframeLoaded && iframeRoot && createPortal(children, iframeRoot)}
    </iframe>
  );
}

export function DemoPreview({ demo }: { demo: DemoConfig }) {
  const [Component, setComponent] = React.useState<React.ComponentType | null>(
    null
  );
  const [error, setError] = React.useState<string>();

  React.useEffect(() => {
    // Reset component and error state when demo changes
    setComponent(null);
    setError(undefined);

    // Dynamically import the component using the function from config
    demo
      .component() // This calls the import() function in config.ts
      .then((comp) => setComponent(() => comp))
      .catch((err) => {
        console.error("Error loading demo component:", err);
        setError("Failed to load demo component. Check console for details.");
      });
  }, [demo]); // Rerun when the demo object changes

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-red-500 p-4 text-center">
        {error}
      </div>
    );
  }

  if (!Component) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Loading demo...
      </div>
    );
  }

  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-full text-muted-foreground">
          Loading...
        </div>
      }
    >
      <div className="w-full h-full overflow-hidden">
        {/* Pass the full demo id (e.g., crewai_agentic_chat) */}
        <IsolatedFrame demoId={demo.id}>
          <Component />
        </IsolatedFrame>
      </div>
    </Suspense>
  );
} 