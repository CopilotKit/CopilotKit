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
    generated_at: string;
    demos: Record<string, DemoContent>;
};

function groupDemosByCategory(
    integration: Integration,
    categories: FeatureCategory[]
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
        groups.push({ category: { id: "uncategorized", name: "Other" }, demos: uncategorized });
    }

    return groups;
}

const UPPERCASE_WORDS = new Set(["ui", "io", "a2ui", "hitl", "mcp", "api"]);

function prettifyTag(tag: string): string {
    return tag
        .split("-")
        .map((w) => UPPERCASE_WORDS.has(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
}

export default function DojoPage() {
    const integrations = useMemo(() => getIntegrations().filter((i) => i.deployed), []);
    const categories = useMemo(() => getFeatureCategories(), []);

    const [selectedSlug, setSelectedSlug] = useState(integrations[0]?.slug || "");
    const [selectedDemoId, setSelectedDemoId] = useState(integrations[0]?.demos[0]?.id || "");
    const [viewMode, setViewMode] = useState<ViewMode>("preview");
    const [selectedFileIndex, setSelectedFileIndex] = useState(0);

    const integration = useMemo(
        () => integrations.find((i) => i.slug === selectedSlug),
        [integrations, selectedSlug]
    );

    const groupedDemos = useMemo(
        () => (integration ? groupDemosByCategory(integration, categories) : []),
        [integration, categories]
    );

    const selectedDemo = useMemo(
        () => integration?.demos.find((d) => d.id === selectedDemoId),
        [integration, selectedDemoId]
    );

    const contentKey = integration && selectedDemo ? `${integration.slug}::${selectedDemo.id}` : null;
    const content = contentKey ? demoContent.demos[contentKey] : null;
    const allFiles = useMemo(() => {
        if (!content) return [];
        return [...content.files, ...content.backend_files];
    }, [content]);

    const handleIntegrationChange = useCallback(
        (slug: string) => {
            setSelectedSlug(slug);
            setSelectedFileIndex(0);
            const newIntegration = integrations.find((i) => i.slug === slug);
            if (newIntegration) {
                const hasDemo = newIntegration.demos.find((d) => d.id === selectedDemoId);
                if (!hasDemo && newIntegration.demos.length > 0) {
                    setSelectedDemoId(newIntegration.demos[0].id);
                }
            }
        },
        [integrations, selectedDemoId]
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
        <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: "var(--bg)" }}>
            {/* Purple accent bar at top */}
            <div
                style={{
                    position: "fixed",
                    top: 0,
                    left: 0,
                    right: 0,
                    height: 3,
                    background: "var(--accent)",
                    zIndex: 100,
                }}
            />

            {/* Sidebar — floating glass card */}
            <aside
                style={{
                    width: "var(--sidebar-width)",
                    minWidth: "var(--sidebar-width)",
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                    margin: "12px 0 12px 12px",
                    marginTop: 15,
                    borderRadius: 12,
                    background: "var(--glass-bg)",
                    backdropFilter: "blur(12px)",
                    WebkitBackdropFilter: "blur(12px)",
                    border: "1px solid var(--glass-border)",
                    boxShadow: "var(--shadow)",
                }}
            >
                {/* Header */}
                <div style={{ padding: "20px 20px 16px" }}>
                    <div style={{ fontWeight: 600, fontSize: 15, color: "var(--text)" }}>
                        CopilotKit Interactive Dojo
                    </div>
                </div>

                {/* Integration selector */}
                <div style={{ padding: "0 20px 16px" }}>
                    <div style={{
                        fontSize: 11,
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        color: "var(--text-muted)",
                        marginBottom: 8,
                    }}>
                        Integrations
                    </div>
                    <div style={{ paddingBottom: 4 }}>
                        <select
                            value={selectedSlug}
                            onChange={(e) => handleIntegrationChange(e.target.value)}
                            style={{
                                width: "100%",
                                padding: "8px 12px",
                                fontSize: 14,
                                fontWeight: 500,
                                border: "1px solid var(--border)",
                                borderRadius: 8,
                                background: "var(--bg-surface)",
                                color: "var(--text)",
                                cursor: "pointer",
                                appearance: "auto",
                            }}
                        >
                            {integrations.map((i) => (
                                <option key={i.slug} value={i.slug}>
                                    {i.name}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                {/* View mode toggle — inline text style */}
                <div style={{ padding: "0 20px 12px" }}>
                    <div style={{
                        fontSize: 11,
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        color: "var(--text-muted)",
                        marginBottom: 8,
                    }}>
                        View
                    </div>
                    <div style={{
                        display: "flex",
                        gap: 6,
                        paddingBottom: 4,
                    }}>
                        {(["preview", "code"] as const).map((mode) => {
                            const isActive = viewMode === mode;
                            return (
                                <button
                                    key={mode}
                                    onClick={() => setViewMode(mode)}
                                    style={{
                                        padding: "5px 14px",
                                        fontSize: 13,
                                        fontWeight: isActive ? 500 : 400,
                                        border: isActive ? "1px solid var(--border)" : "1px solid transparent",
                                        borderRadius: 6,
                                        cursor: "pointer",
                                        background: isActive ? "var(--bg-surface)" : "transparent",
                                        color: isActive ? "var(--text)" : "var(--text-muted)",
                                        boxShadow: isActive ? "0 1px 2px rgba(0,0,0,0.04)" : "none",
                                    }}
                                >
                                    {mode === "preview" ? "\u25C9 Preview" : "</> Code"}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Divider */}
                <div style={{ margin: "0 20px", borderTop: "1px solid var(--border)" }} />

                {/* Demo list grouped by feature category */}
                <div className="sidebar-scroll" style={{ flex: 1, overflow: "auto", padding: "4px 0 12px" }}>
                    {groupedDemos.map(({ category, demos }) => (
                        <div key={category.id} style={{ marginBottom: 2 }}>
                            <div
                                style={{
                                    fontSize: 11,
                                    fontWeight: 600,
                                    textTransform: "uppercase",
                                    letterSpacing: "0.05em",
                                    color: "var(--text-muted)",
                                    padding: "12px 20px 6px",
                                }}
                            >
                                {category.name}
                            </div>
                            {demos.map((demo) => {
                                const isSelected = demo.id === selectedDemoId;
                                return (
                                    <button
                                        key={demo.id}
                                        onClick={() => handleDemoSelect(demo.id)}
                                        style={{
                                            display: "block",
                                            width: "100%",
                                            textAlign: "left",
                                            padding: "10px 20px",
                                            border: "none",
                                            cursor: "pointer",
                                            background: isSelected ? "var(--bg-selected)" : "transparent",
                                            borderRadius: 0,
                                            transition: "background 0.1s",
                                        }}
                                        onMouseEnter={(e) => {
                                            if (!isSelected) e.currentTarget.style.background = "var(--bg-hover)";
                                        }}
                                        onMouseLeave={(e) => {
                                            if (!isSelected) e.currentTarget.style.background = "transparent";
                                        }}
                                    >
                                        <div style={{
                                            fontWeight: isSelected ? 600 : 500,
                                            fontSize: 14,
                                            color: "var(--text)",
                                        }}>
                                            {demo.name}
                                        </div>
                                        <div style={{
                                            fontSize: 12,
                                            color: "var(--text-muted)",
                                            marginTop: 2,
                                            lineHeight: 1.4,
                                        }}>
                                            {demo.description}
                                        </div>
                                        {demo.tags.length > 0 && (
                                            <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
                                                {demo.tags.map((tag) => (
                                                    <span
                                                        key={tag}
                                                        style={{
                                                            display: "inline-block",
                                                            fontSize: 11,
                                                            padding: "2px 10px",
                                                            borderRadius: 10,
                                                            background: "var(--tag-bg)",
                                                            color: "var(--tag-text)",
                                                            fontWeight: 500,
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
                    {integration && integration.demos.length === 0 && (
                        <div style={{ padding: "20px", color: "var(--text-muted)", fontSize: 13 }}>
                            No demos available for this integration.
                        </div>
                    )}
                </div>
            </aside>

            {/* Main content area */}
            <main style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
                margin: "12px 12px 12px 12px",
                marginTop: 15,
                borderRadius: 12,
                background: "var(--bg-surface)",
                border: "1px solid var(--glass-border)",
                boxShadow: "var(--shadow)",
            }}>
                {viewMode === "preview" && previewUrl ? (
                    <iframe
                        key={previewUrl}
                        src={previewUrl}
                        style={{
                            width: "100%",
                            height: "100%",
                            border: "none",
                            borderRadius: 12,
                        }}
                        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                    />
                ) : viewMode === "code" && allFiles.length > 0 ? (
                    <div style={{ display: "flex", flexDirection: "column", height: "100%", borderRadius: 12, overflow: "hidden" }}>
                        {/* File tabs */}
                        <div
                            style={{
                                display: "flex",
                                gap: 0,
                                borderBottom: "1px solid var(--border)",
                                background: "var(--bg-elevated)",
                                overflowX: "auto",
                                flexShrink: 0,
                                borderRadius: "12px 12px 0 0",
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
                                        borderBottom: idx === selectedFileIndex ? "2px solid var(--accent)" : "2px solid transparent",
                                        cursor: "pointer",
                                        background: idx === selectedFileIndex ? "var(--bg-surface)" : "transparent",
                                        color: idx === selectedFileIndex ? "var(--text)" : "var(--text-muted)",
                                        fontWeight: idx === selectedFileIndex ? 500 : 400,
                                        whiteSpace: "nowrap",
                                        fontFamily: "'SF Mono', 'Fira Code', Menlo, monospace",
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
                            color: "var(--text-muted)",
                            fontSize: 15,
                        }}
                    >
                        {viewMode === "code" ? "No code available for this demo." : "Select a demo to preview."}
                    </div>
                )}
            </main>
        </div>
    );
}
