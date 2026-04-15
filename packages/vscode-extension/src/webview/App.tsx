import React, { useState, useEffect, useCallback } from "react";
import {
  A2UIProvider,
  A2UIRenderer,
  basicCatalog,
  useA2UIActions,
} from "@copilotkit/a2ui-renderer";
import type {
  A2UIFixture,
  ExtensionToWebviewMessage,
} from "../extension/types";
import { bridge } from "./bridge";
import { FixturePicker } from "./FixturePicker";
import { ErrorOverlay } from "./ErrorOverlay";

/**
 * Inner component that processes fixture messages into the A2UI surface
 * and renders the surface. Must be rendered inside A2UIProvider.
 */
function FixtureView({
  fixture,
}: {
  fixture: A2UIFixture;
}): React.ReactElement {
  const { processMessages } = useA2UIActions();

  useEffect(() => {
    processMessages(fixture.messages as Array<Record<string, unknown>>);
  }, [fixture.messages, processMessages]);

  return <A2UIRenderer surfaceId={fixture.surfaceId} />;
}

export function App(): React.ReactElement {
  const [catalog, setCatalog] = useState(basicCatalog);
  const [catalogVersion, setCatalogVersion] = useState(0);
  const [fixtures, setFixtures] = useState<Record<string, A2UIFixture>>({});
  const [activeFixture, setActiveFixture] = useState<string>("default");
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const handleCatalogUpdate = useCallback(
    async (
      msg: Extract<ExtensionToWebviewMessage, { type: "catalog-update" }>,
    ) => {
      try {
        // Clean up previous catalog global
        (window as any).__copilotkit_catalog = undefined;

        // Load the IIFE-bundled catalog via a <script> tag.
        // The IIFE assigns to window.__copilotkit_catalog.
        // Using a Blob URL + <script src> is allowed by our CSP (blob: in script-src).
        const blob = new Blob([msg.code], { type: "application/javascript" });
        const url = URL.createObjectURL(blob);

        await new Promise<void>((resolve, reject) => {
          const script = document.createElement("script");
          script.src = url;
          script.onload = () => {
            URL.revokeObjectURL(url);
            script.remove();
            resolve();
          };
          script.onerror = () => {
            URL.revokeObjectURL(url);
            script.remove();
            reject(new Error("Failed to load catalog script"));
          };
          document.head.appendChild(script);
        });

        const catalogExport = (window as any).__copilotkit_catalog;
        (window as any).__copilotkit_catalog = undefined;

        const newCatalog =
          catalogExport?.default ?? catalogExport?.catalog ?? catalogExport;
        if (newCatalog) {
          setCatalog(newCatalog);
          setCatalogVersion((v) => v + 1);
          setError(null);

          // Inject component CSS (from imports + Tailwind JIT)
          const existingStyle = document.getElementById("copilotkit-component-css");
          if (existingStyle) existingStyle.remove();
          if (msg.css) {
            const style = document.createElement("style");
            style.id = "copilotkit-component-css";
            style.textContent = msg.css;
            document.head.appendChild(style);
          }
        } else {
          setError(
            "Module does not export a catalog. Expected a default export or named 'catalog' export.",
          );
        }
      } catch (err) {
        setError(
          `Failed to load catalog: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    [],
  );

  useEffect(() => {
    const unsubs = [
      bridge.on("catalog-update", handleCatalogUpdate),
      bridge.on("fixture-update", (msg) => {
        setFixtures(msg.fixtures);
        const names = Object.keys(msg.fixtures);
        if (msg.activeFixture && names.includes(msg.activeFixture)) {
          setActiveFixture(msg.activeFixture);
        } else {
          setActiveFixture((prev) =>
            names.includes(prev) ? prev : (names[0] ?? "default"),
          );
        }
      }),
      bridge.on("error", (msg) => setError(msg.message)),
    ];

    if (!ready) {
      bridge.send({ type: "ready" });
      setReady(true);
    }

    return () => unsubs.forEach((unsub) => unsub());
  }, [handleCatalogUpdate, ready]);

  const handleFixtureSelect = useCallback((name: string) => {
    setActiveFixture(name);
    bridge.send({ type: "select-fixture", name });
  }, []);

  const currentFixture = fixtures[activeFixture];
  const fixtureNames = Object.keys(fixtures);

  return (
    <div style={{ position: "relative", height: "100vh", overflow: "auto" }}>
      {error && (
        <ErrorOverlay message={error} onDismiss={() => setError(null)} />
      )}
      <FixturePicker
        fixtures={fixtureNames}
        active={activeFixture}
        onSelect={handleFixtureSelect}
      />
      {currentFixture && catalogVersion > 0 ? (
        <A2UIProvider
          key={`catalog-${catalogVersion}-${activeFixture}`}
          catalog={catalog}
          onAction={(msg) => bridge.send({ type: "action", payload: msg })}
        >
          <div style={{ padding: "16px" }}>
            <FixtureView fixture={currentFixture} />
          </div>
        </A2UIProvider>
      ) : (
        <div
          style={{
            padding: "24px",
            textAlign: "center",
            color: "var(--vscode-descriptionForeground)",
            fontFamily: "var(--vscode-font-family)",
          }}
        >
          {fixtureNames.length === 0 || catalogVersion === 0
            ? "Waiting for component data..."
            : `Fixture "${activeFixture}" not found`}
        </div>
      )}
    </div>
  );
}
