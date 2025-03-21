'use client';

import React, { Suspense, useRef, useEffect } from 'react';
import { DemoConfig } from '@/types/demo';
import { createPortal } from 'react-dom';
import filesJSON from '../../files.json'

// Custom iframe component that renders React components inside
function IsolatedFrame({ demoId, children }: { demoId: string; children: React.ReactNode }) {
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
      const style = iframe.contentDocument.createElement('style');
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
      const root = iframe.contentDocument.createElement('div');
      root.id = 'root';
      iframe.contentDocument.body.appendChild(root);
      
      // Copy parent styles to iframe
      const parentStyles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'));
      parentStyles.forEach(styleNode => {
        const clone = styleNode.cloneNode(true);
        iframe.contentDocument!.head.appendChild(clone);
      });
      
      // Load demo-specific CSS if it exists
      const demoStyleLink = iframe.contentDocument.createElement('link');
      // Apply direct styles to iframe content
      // @ts-expect-error -- demoId is key of filesJSON
      const styles = filesJSON[demoId].files.find(f => f.name === 'style.css')?.content;
      const styleElement = iframe.contentDocument!.createElement('style');
      styleElement.textContent = styles;
      iframe.contentDocument!.head.appendChild(styleElement);
      
      setIframeRoot(root);
      setIframeLoaded(true);
    };

    iframe.addEventListener('load', handleLoad);
    
    // If the iframe is already loaded, call handleLoad immediately
    if (iframe.contentDocument?.readyState === 'complete') {
      handleLoad();
    }

    return () => {
      iframe.removeEventListener('load', handleLoad);
    };
  }, [demoId]);

  return (
    <iframe 
      key={demoId}
      ref={iframeRef}
      className="w-full h-full border-0 bg-background"
      title="Demo Preview"
      sandbox="allow-same-origin allow-scripts"
      srcDoc="<!DOCTYPE html><html><head></head><body></body></html>"
    >
      {iframeLoaded && iframeRoot && createPortal(children, iframeRoot)}
    </iframe>
  );
}

export function DemoPreview({ demo }: { demo: DemoConfig }) {
  const [Component, setComponent] = React.useState<React.ComponentType | null>(null);
  const [error, setError] = React.useState<string>();

  React.useEffect(() => {
    demo.component()
      .then(comp => setComponent(() => comp))
      .catch(err => {
        console.error('Error loading demo:', err);
        setError('Failed to load demo component');
      });
  }, [demo]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-red-500">
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
    <Suspense fallback={
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Loading...
      </div>
    }>
      <div className="w-full h-full overflow-hidden">
        <IsolatedFrame demoId={demo.id}>
          <Component />
        </IsolatedFrame>
      </div>
    </Suspense>
  );
} 