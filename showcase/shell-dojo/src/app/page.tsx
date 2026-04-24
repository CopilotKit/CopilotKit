"use client";

import { useState, useMemo, useCallback } from "react";
import {
  getIntegrations,
  getFeatureCategories,
  getFeature,
  type Integration,
  type Demo,
  type FeatureCategory,
} from "@/lib/registry";
import { CodeBlock } from "@/components/code-block";
import demoContentData from "@/data/demo-content.json";

type ViewMode = "preview" | "code";

interface DemoContentFile {
  filename: string;
  language: string;
  content: string;
}

interface DemoContent {
  readme: string | null;
  files: DemoContentFile[];
  backend_files: DemoContentFile[];
}

const demoContent = demoContentData as {
  demos: Record<string, DemoContent>;
};

function groupDemosByCategory(
  integration: Integration,
  categories: FeatureCategory[],
): { category: FeatureCategory; demos: Demo[] }[] {
  const groups: { category: FeatureCategory; demos: Demo[] }[] = [];
  const demoByCategoryId = new Map<string, Demo[]>();

  for (const demo of integration.demos) {
    const feature = getFeature(demo.id);
    const catId = feature?.category || "uncategorized";
    if (!demoByCategoryId.has(catId)) {
      demoByCategoryId.set(catId, []);
    }
    demoByCategoryId.get(catId)!.push(demo);
  }

  for (const cat of categories) {
    const demos = demoByCategoryId.get(cat.id);
    if (demos && demos.length > 0) {
      groups.push({ category: cat, demos });
    }
  }

  const uncategorized = demoByCategoryId.get("uncategorized");
  if (uncategorized && uncategorized.length > 0) {
    groups.push({
      category: { id: "uncategorized", name: "Other" },
      demos: uncategorized,
    });
  }

  return groups;
}

const UPPERCASE_WORDS = new Set(["ui", "io", "a2ui", "hitl", "mcp", "api"]);

function prettifyTag(tag: string): string {
  return tag
    .split("-")
    .map((w) =>
      UPPERCASE_WORDS.has(w)
        ? w.toUpperCase()
        : w.charAt(0).toUpperCase() + w.slice(1),
    )
    .join(" ");
}

export default function DojoPage() {
  const integrations = useMemo(
    () => getIntegrations().filter((i) => i.deployed),
    [],
  );
  const categories = useMemo(() => getFeatureCategories(), []);

  const [selectedSlug, setSelectedSlug] = useState(integrations[0]?.slug || "");
  const [selectedDemoId, setSelectedDemoId] = useState(
    integrations[0]?.demos[0]?.id || "",
  );
  const [viewMode, setViewMode] = useState<ViewMode>("preview");
  const [selectedFileIndex, setSelectedFileIndex] = useState(0);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const integration = useMemo(
    () => integrations.find((i) => i.slug === selectedSlug),
    [integrations, selectedSlug],
  );

  const groupedDemos = useMemo(
    () => (integration ? groupDemosByCategory(integration, categories) : []),
    [integration, categories],
  );

  const selectedDemo = useMemo(
    () => integration?.demos.find((d) => d.id === selectedDemoId),
    [integration, selectedDemoId],
  );

  const contentKey =
    integration && selectedDemo
      ? `${integration.slug}::${selectedDemo.id}`
      : null;
  const content = contentKey ? demoContent.demos[contentKey] : null;
  const allFiles = useMemo(() => {
    if (!content) return [];
    return [...content.files, ...content.backend_files];
  }, [content]);

  const handleIntegrationChange = useCallback(
    (slug: string) => {
      setSelectedSlug(slug);
      setSelectedFileIndex(0);
      setDropdownOpen(false);
      const newIntegration = integrations.find((i) => i.slug === slug);
      if (newIntegration) {
        const hasDemo = newIntegration.demos.find(
          (d) => d.id === selectedDemoId,
        );
        if (!hasDemo && newIntegration.demos.length > 0) {
          setSelectedDemoId(newIntegration.demos[0].id);
        }
      }
    },
    [integrations, selectedDemoId],
  );

  const handleDemoSelect = useCallback((demoId: string) => {
    setSelectedDemoId(demoId);
    setSelectedFileIndex(0);
  }, []);

  const previewUrl =
    integration && selectedDemo
      ? `${integration.backend_url}${selectedDemo.route}`
      : null;

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        height: "100vh",
        overflow: "hidden",
        background: "var(--surface-main)",
        padding: 8,
        gap: 8,
      }}
    >
      {/* Background blur circles — from dojo Figma specs */}
      <div
        style={{
          position: "absolute",
          width: 446,
          height: 446,
          left: 1040,
          top: 11,
          borderRadius: "50%",
          background: "rgba(255, 172, 77, 0.2)",
          filter: "blur(103px)",
          zIndex: 0,
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 609,
          height: 609,
          left: 1339,
          top: 625,
          borderRadius: "50%",
          background: "#C9C9DA",
          filter: "blur(103px)",
          zIndex: 0,
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 609,
          height: 609,
          left: 670,
          top: -365,
          borderRadius: "50%",
          background: "#C9C9DA",
          filter: "blur(103px)",
          zIndex: 0,
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 609,
          height: 609,
          left: 508,
          top: 702,
          borderRadius: "50%",
          background: "#F3F3FC",
          filter: "blur(103px)",
          zIndex: 0,
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 446,
          height: 446,
          left: 128,
          top: 331,
          borderRadius: "50%",
          background: "rgba(255, 243, 136, 0.3)",
          filter: "blur(103px)",
          zIndex: 0,
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 446,
          height: 446,
          left: -205,
          top: 803,
          borderRadius: "50%",
          background: "rgba(255, 172, 77, 0.2)",
          filter: "blur(103px)",
          zIndex: 0,
        }}
      />

      {/* Sidebar — matches dojo: bg-white/50 w-74 min-w-[296px] border-2 border-white rounded-lg */}
      <aside
        style={{
          width: "var(--sidebar-width)",
          minWidth: "var(--sidebar-width)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          borderRadius: 8,
          background: "rgba(255, 255, 255, 0.5)",
          border: "2px solid var(--border-default)",
          flexShrink: 0,
          zIndex: 1,
        }}
      >
        {/* Header — dojo: p-4, ml-1 */}
        <div style={{ padding: 16 }}>
          <div style={{ marginLeft: 4 }}>
            <div
              style={{
                fontWeight: 300,
                fontSize: 18,
                lineHeight: "20px",
                color: "#111827",
              }}
            >
              CopilotKit Interactive Dojo
            </div>
          </div>
        </div>

        {/* Controls section — dojo: p-4 border-b */}
        <div
          style={{
            padding: 16,
            paddingTop: 0,
            borderBottom: "1px solid var(--border-container)",
          }}
        >
          {/* Integration picker — dojo: mb-spacing-4 (16px) */}
          <div style={{ marginBottom: 16 }}>
            <SectionTitle title="Integrations" />
            {/* dojo: h-spacing-8 (32px) rounded-sm px-spacing-3 (12px) */}
            <div
              onClick={() => setDropdownOpen(!dropdownOpen)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                height: 32,
                borderRadius: 4,
                padding: "0 12px",
                cursor: "pointer",
                transition: "background 0.15s",
                background: dropdownOpen ? "rgba(0,0,0,0.03)" : "transparent",
              }}
              onMouseEnter={(e) => {
                if (!dropdownOpen) e.currentTarget.style.background = "#fafcfa";
              }}
              onMouseLeave={(e) => {
                if (!dropdownOpen)
                  e.currentTarget.style.background = "transparent";
              }}
            >
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  color: "var(--text-primary)",
                  lineHeight: "22px",
                  paddingBottom: 2,
                }}
              >
                {integration?.name || "Select Integration"}
              </span>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--text-primary)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{
                  transition: "transform 0.2s",
                  transform: dropdownOpen ? "rotate(180deg)" : "rotate(0deg)",
                }}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>
            {dropdownOpen && (
              <div
                style={{
                  marginTop: 4,
                  background: "var(--surface-container)",
                  border: "1px solid var(--border-container)",
                  borderRadius: 4,
                  boxShadow: "0px 6px 6px -2px rgba(1, 5, 7, 0.08)",
                  maxHeight: 300,
                  overflow: "auto",
                  zIndex: 10,
                  position: "relative",
                }}
              >
                {integrations.map((i) => (
                  <div
                    key={i.slug}
                    onClick={() => handleIntegrationChange(i.slug)}
                    style={{
                      padding: "10px 12px",
                      fontSize: 16,
                      height: 48,
                      display: "flex",
                      alignItems: "center",
                      cursor: "pointer",
                      borderRadius: 4,
                      color: "var(--text-primary)",
                      background:
                        i.slug === selectedSlug
                          ? "rgba(0,0,0,0.03)"
                          : "transparent",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = "#f0f0f4")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background =
                        i.slug === selectedSlug
                          ? "rgba(0,0,0,0.03)"
                          : "transparent")
                    }
                  >
                    {i.name}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* View toggle — dojo: mb-1, tabs h-8 rounded-lg */}
          <div style={{ marginBottom: 4 }}>
            <SectionTitle title="View" />
            <div
              style={{
                display: "flex",
                gap: 0,
                borderRadius: 8,
                background: "transparent",
              }}
            >
              {(["preview", "code"] as const).map((mode) => {
                const isActive = viewMode === mode;
                return (
                  <button
                    key={mode}
                    onClick={() => setViewMode(mode)}
                    style={{
                      flex: 1,
                      height: 32,
                      padding: "0 8px",
                      fontSize: 14,
                      fontWeight: 500,
                      border: "none",
                      borderRadius: 8,
                      cursor: "pointer",
                      background: isActive ? "#ffffff" : "transparent",
                      color: "var(--text-primary)",
                      boxShadow: "none",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 4,
                    }}
                  >
                    {mode === "preview" ? (
                      <>
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 256 256"
                          fill="currentColor"
                        >
                          <path d="M247.31,124.76c-.35-.79-8.82-19.58-27.65-38.41C194.57,61.26,162.88,48,128,48S61.43,61.26,36.34,86.35C17.51,105.18,9,124,8.69,124.76a8,8,0,0,0,0,6.5c.35.79,8.82,19.57,27.65,38.4C61.43,194.74,93.12,208,128,208s66.57-13.26,91.66-38.34c18.83-18.83,27.3-37.61,27.65-38.4A8,8,0,0,0,247.31,124.76ZM128,192c-30.78,0-57.67-11.19-79.93-33.29A169.47,169.47,0,0,1,24.4,128,169.47,169.47,0,0,1,48.07,97.29C70.33,75.19,97.22,64,128,64s57.67,11.19,79.93,33.29A169.47,169.47,0,0,1,231.6,128,169.47,169.47,0,0,1,207.93,158.71C185.67,180.81,158.78,192,128,192Zm0-112a48,48,0,1,0,48,48A48.05,48.05,0,0,0,128,80Zm0,80a32,32,0,1,1,32-32A32,32,0,0,1,128,160Z" />
                        </svg>
                        Preview
                      </>
                    ) : (
                      <>
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 256 256"
                          fill="currentColor"
                        >
                          <path d="M69.12,94.15,28.5,128l40.62,33.85a8,8,0,1,1-10.24,12.29l-48-40a8,8,0,0,1,0-12.29l48-40a8,8,0,0,1,10.24,12.3Zm176,27.7-48-40a8,8,0,1,0-10.24,12.3L227.5,128l-40.62,33.85a8,8,0,1,0,10.24,12.29l48-40a8,8,0,0,0,0-12.29ZM162.73,32.48a8,8,0,0,0-10.25,4.79l-64,176a8,8,0,0,0,4.79,10.26A8.14,8.14,0,0,0,96,224a8,8,0,0,0,7.52-5.27l64-176A8,8,0,0,0,162.73,32.48Z" />
                        </svg>
                        Code
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Demo list — dojo: flex-1 overflow-auto */}
        <div className="sidebar-scroll" style={{ flex: 1, overflow: "auto" }}>
          {/* dojo: px-4 pt-3 pb-2 */}
          <div style={{ padding: "12px 16px 8px" }}>
            <span
              style={{
                fontSize: 10,
                fontWeight: 400,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: "var(--text-secondary)",
              }}
            >
              Demos
            </span>
          </div>
          {/* dojo: px-2 space-y-1 */}
          <div
            style={{
              padding: "0 8px",
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            {groupedDemos.map(({ category, demos }) => (
              <div key={category.id}>
                {demos.map((demo) => {
                  const isSelected = demo.id === selectedDemoId;
                  return (
                    /* dojo: py-2 px-3 rounded-sm, flex flex-col gap-0.5 */
                    <button
                      key={demo.id}
                      onClick={() => handleDemoSelect(demo.id)}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 2,
                        width: "100%",
                        textAlign: "left",
                        padding: "8px 12px",
                        border: "none",
                        cursor: "pointer",
                        background: isSelected
                          ? "rgba(255, 255, 255, 0.7)"
                          : "transparent",
                        borderRadius: 4,
                        transition: "background 0.15s",
                      }}
                      onMouseEnter={(e) => {
                        if (!isSelected)
                          e.currentTarget.style.background =
                            "rgba(255, 255, 255, 0.5)";
                      }}
                      onMouseLeave={(e) => {
                        if (!isSelected)
                          e.currentTarget.style.background = "transparent";
                      }}
                    >
                      {/* dojo: text-sm font-medium leading-tight */}
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 500,
                          lineHeight: 1.25,
                        }}
                      >
                        {demo.name}
                      </div>
                      {/* dojo: text-xs text-muted-foreground line-clamp-2 leading-relaxed */}
                      <div
                        style={{
                          fontSize: 12,
                          color: "var(--text-disabled)",
                          lineHeight: 1.625,
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {demo.description}
                      </div>
                      {/* dojo: flex gap-1 flex-wrap mt-0.5, badge: text-xs px-1.5 py-0.5 rounded-full */}
                      {demo.tags.length > 0 && (
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: 4,
                            marginTop: 2,
                          }}
                        >
                          {demo.tags.map((tag) => (
                            <span
                              key={tag}
                              style={{
                                display: "inline-block",
                                fontSize: 12,
                                padding: "2px 6px",
                                borderRadius: 9999,
                                background: isSelected
                                  ? "var(--text-primary)"
                                  : "rgba(255, 255, 255, 0.65)",
                                color: isSelected
                                  ? "var(--text-invert)"
                                  : "var(--text-primary)",
                                fontWeight: 400,
                                lineHeight: 1.4,
                              }}
                            >
                              {prettifyTag(tag)}
                            </span>
                          ))}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          {integration && integration.demos.length === 0 && (
            <div
              style={{
                padding: "32px 16px",
                color: "var(--text-disabled)",
                fontSize: 14,
                textAlign: "center",
              }}
            >
              No demos available for this integration.
            </div>
          )}
        </div>
      </aside>

      {/* Main content area */}
      <main
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          zIndex: 1,
        }}
      >
        {viewMode === "preview" && previewUrl ? (
          <iframe
            key={previewUrl}
            src={previewUrl}
            style={{
              width: "100%",
              height: "100%",
              border: "none",
              borderRadius: 8,
              background: "#ffffff",
            }}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        ) : viewMode === "code" && allFiles.length > 0 ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              height: "100%",
              borderRadius: 8,
              overflow: "hidden",
              background: "#ffffff",
              border: "2px solid var(--border-default)",
            }}
          >
            {/* File tabs */}
            <div
              style={{
                display: "flex",
                gap: 0,
                borderBottom: "1px solid var(--border-container)",
                background: "#f8f8fb",
                overflowX: "auto",
                flexShrink: 0,
              }}
            >
              {allFiles.map((file, idx) => (
                <button
                  key={file.filename}
                  onClick={() => setSelectedFileIndex(idx)}
                  style={{
                    padding: "10px 18px",
                    fontSize: 13,
                    border: "none",
                    borderBottom:
                      idx === selectedFileIndex
                        ? "2px solid var(--text-primary)"
                        : "2px solid transparent",
                    cursor: "pointer",
                    background:
                      idx === selectedFileIndex ? "#ffffff" : "transparent",
                    color:
                      idx === selectedFileIndex
                        ? "var(--text-primary)"
                        : "var(--text-disabled)",
                    fontWeight: idx === selectedFileIndex ? 500 : 400,
                    whiteSpace: "nowrap",
                    fontFamily:
                      "'Spline Sans Mono', ui-monospace, SFMono-Regular, monospace",
                  }}
                >
                  {file.filename}
                </button>
              ))}
            </div>
            {allFiles[selectedFileIndex] && (
              <CodeBlock
                code={allFiles[selectedFileIndex].content}
                language={allFiles[selectedFileIndex].language}
              />
            )}
          </div>
        ) : (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              color: "var(--text-disabled)",
              fontSize: 15,
            }}
          >
            {viewMode === "code"
              ? "No code available for this demo."
              : "Select a demo to preview."}
          </div>
        )}
      </main>
    </div>
  );
}

function SectionTitle({ title }: { title: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "0 4px",
        marginBottom: 8,
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 400,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          color: "var(--text-secondary)",
          whiteSpace: "nowrap",
        }}
      >
        {title}
      </span>
      <div
        style={{
          flex: 1,
          height: 1,
          background: "var(--border-container)",
        }}
      />
    </div>
  );
}
