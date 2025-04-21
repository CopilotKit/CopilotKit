"use client";

import React, { Suspense, useRef, useEffect } from 'react';
import { DemoConfig } from '@/types/demo';
import { createPortal } from 'react-dom';
import filesJSON from '../../files.json';

// Custom iframe component that renders React components inside (Restored Definition)
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
          /* Force light theme within demo iframe */
          color-scheme: light;
        }
        #root {
          min-height: 100%;
          height: 100%;
          background-color: #fff; /* Explicit light background */
        }
      `;
      iframe.contentDocument.head.appendChild(style);

      // Create root element
      const root = iframe.contentDocument.createElement("div");
      root.id = "root";
      iframe.contentDocument.body.appendChild(root);

      // Copy relevant parent styles (e.g., Tailwind) to iframe
      // Note: This might need refinement depending on how styles are loaded
      const parentStyles = Array.from(
        document.querySelectorAll('link[rel="stylesheet"], style')
      );
      parentStyles.forEach((styleNode) => {
          // Avoid copying styles specific to the main app's dark mode if possible
          // This simple copy might bring dark mode styles; refinement might be needed.
          const clone = styleNode.cloneNode(true);
          if (iframe.contentDocument?.head) {
            iframe.contentDocument.head.appendChild(clone);
          }
      });

      // Apply direct styles from files.json to iframe content
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

    if (iframe.contentDocument?.readyState === "complete") {
      handleLoad();
    }

    return () => {
      iframe.removeEventListener("load", handleLoad);
    };
  }, [demoId]);

  return (
    <iframe
      ref={iframeRef}
      className="w-full h-full border-0 bg-background"
      title="Demo Preview"
      sandbox="allow-same-origin allow-scripts allow-forms"
      srcDoc="<!DOCTYPE html><html><head></head><body></body></html>"
    >
      {iframeLoaded && iframeRoot && createPortal(children, iframeRoot)}
    </iframe>
  );
}

export function DemoPreview({ demo }: { demo: DemoConfig }) {
  const [error, setError] = React.useState<string>();
  // State specifically for the dynamically loaded component for non-iframe demos
  const [DynamicComponent, setDynamicComponent] = React.useState<React.ComponentType | null>(null);

  React.useEffect(() => {
    // Reset states only relevant to component loading when demo changes
    setError(undefined);
    setDynamicComponent(null); 

    // If it is an iframe demo, we don't need to load a component.
    if (demo.iframeUrl) {
      return; 
    }

    // If it's not iframe, and component loader exists, load it.
    if (demo.component) {
      demo
        .component()
        .then((comp) => setDynamicComponent(() => comp)) // Load into specific state
        .catch((err) => {
          console.error("Error loading dynamic component:", err);
          setError("Failed to load dynamic component. Check console for details.");
        });
    } else if (!demo.iframeUrl) {
      // Should not happen if config is correct, but handle it.
      setError("Demo configuration is missing component function and iframeUrl.");
    }

  }, [demo]); // Rerun when the demo object changes

  // Handle error state first
  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-red-500 p-4 text-center">
        {error}
      </div>
    );
  }

  // Handle iframe rendering directly if url exists
  if (demo.iframeUrl) {
    return (
      <iframe
        key={demo.id} // Add key to ensure iframe instance changes cleanly
        src={demo.iframeUrl}
        className="w-full h-full border-0"
        title={demo.name}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      />
    );
  }

  // Handle component rendering path (if not iframe)
  if (!DynamicComponent) {
    // Component is loading
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Loading Component...
      </div>
    );
  }

  // Component loaded, render inside IsolatedFrame & Suspense
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-full text-muted-foreground">
          Loading Suspense...
        </div>
      }
    >
      {/* Add key here too for consistency */}
      <IsolatedFrame key={demo.id} demoId={demo.id}>
         <DynamicComponent />
      </IsolatedFrame>
    </Suspense>
  );
} 