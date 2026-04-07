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

// Group an integration's demos by feature category, preserving category order
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

    // Catch any uncategorized demos
    const uncategorized = demoByCategoryId.get("uncategorized");
    if (uncategorized && uncategorized.length > 0) {
        groups.push({ category: { id: "uncategorized", name: "Other" }, demos: uncategorized });
    }

    return groups;
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
            // Keep the same demo ID if the new integration has it, otherwise pick first
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
        <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
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
            {/* Sidebar */}
            <aside
                style={{
                    width: "var(--sidebar-width)",
                    minWidth: "var(--sidebar-width)",
                    borderRight: "1px solid var(--border)",
                    background: "var(--bg-surface)",
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                    paddingTop: 3,
                }}
            >
                {/* Header */}
                <div style={{ padding: "16px 16px 12px", borderBottom: "1px solid var(--border)" }}>
                    <div style={{ fontWeight: 600, fontSize: 15 }}>CopilotKit Interactive Dojo</div>
                </div>

                {/* Integration selector */}
                <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
                    <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-muted)", marginBottom: 8 }}>
                        Integrations
                    </div>
                    <select
                        value={selectedSlug}
                        onChange={(e) => handleIntegrationChange(e.target.value)}
                        style={{
                            width: "100%",
                            padding: "8px 12px",
                            fontSize: 14,
                            fontWeight: 500,
                            border: "1px solid var(--border)",
                            borderRadius: 6,
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

                {/* View mode toggle */}
                <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
                    <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-muted)", marginBottom: 8 }}>
                        View
                    </div>
                    <div style={{ display: "flex", gap: 4 }}>
                        {(["preview", "code"] as const).map((mode) => (
                            <button
                                key={mode}
                                onClick={() => setViewMode(mode)}
                                style={{
                                    flex: 1,
                                    padding: "6px 12px",
                                    fontSize: 13,
                                    fontWeight: 500,
                                    border: "1px solid var(--border)",
                                    borderRadius: 6,
                                    cursor: "pointer",
                                    background: viewMode === mode ? "var(--accent)" : "var(--bg-surface)",
                                    color: viewMode === mode ? "#fff" : "var(--text-secondary)",
                                }}
                            >
                                {mode === "preview" ? "\u25C9 Preview" : "</> Code"}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Demo list grouped by feature category */}
                <div style={{ flex: 1, overflow: "auto", padding: "8px 0" }}>
                    {groupedDemos.map(({ category, demos }) => (
                        <div key={category.id} style={{ marginBottom: 4 }}>
                            <div
                                style={{
                                    fontSize: 11,
                                    fontWeight: 600,
                                    textTransform: "uppercase",
                                    letterSpacing: "0.05em",
                                    color: "var(--text-muted)",
                                    padding: "8px 16px 4px",
                                }}
                            >
                                {category.name}
                            </div>
                            {demos.map((demo) => {
                                const isSelected = demo.id === selectedDemoId;
                                const feature = getFeature(demo.id);
                                return (
                                    <button
                                        key={demo.id}
                                        onClick={() => handleDemoSelect(demo.id)}
                                        style={{
                                            display: "block",
                                            width: "100%",
                                            textAlign: "left",
                                            padding: "10px 16px",
                                            border: "none",
                                            cursor: "pointer",
                                            background: isSelected ? "var(--accent-light)" : "transparent",
                                            borderLeft: isSelected ? "3px solid var(--accent)" : "3px solid transparent",
                                        }}
                                    >
                                        <div style={{ fontWeight: 500, fontSize: 14, color: "var(--text)" }}>
                                            {demo.name}
                                        </div>
                                        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2, lineHeight: 1.3 }}>
                                            {demo.description}
                                        </div>
                                        {feature && (
                                            <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
                                                {demo.tags.map((tag) => (
                                                    <span
                                                        key={tag}
                                                        style={{
                                                            display: "inline-block",
                                                            fontSize: 11,
                                                            padding: "2px 8px",
                                                            borderRadius: 10,
                                                            background: "var(--bg-elevated)",
                                                            color: "var(--text-secondary)",
                                                            border: "1px solid var(--border-dim)",
                                                        }}
                                                    >
                                                        {tag}
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
                        <div style={{ padding: "16px", color: "var(--text-muted)", fontSize: 13 }}>
                            No demos available for this integration.
                        </div>
                    )}
                </div>
            </aside>

            {/* Main content area */}
            <main style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", paddingTop: 3 }}>
                {viewMode === "preview" && previewUrl ? (
                    <iframe
                        key={previewUrl}
                        src={previewUrl}
                        style={{
                            width: "100%",
                            height: "100%",
                            border: "none",
                            background: "var(--bg)",
                        }}
                        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                    />
                ) : viewMode === "code" && allFiles.length > 0 ? (
                    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
                        {/* File tabs */}
                        <div
                            style={{
                                display: "flex",
                                gap: 0,
                                borderBottom: "1px solid var(--border)",
                                background: "var(--bg-elevated)",
                                overflowX: "auto",
                                flexShrink: 0,
                            }}
                        >
                            {allFiles.map((file, idx) => (
                                <button
                                    key={file.filename}
                                    onClick={() => setSelectedFileIndex(idx)}
                                    style={{
                                        padding: "8px 16px",
                                        fontSize: 13,
                                        border: "none",
                                        borderBottom: idx === selectedFileIndex ? "2px solid var(--accent)" : "2px solid transparent",
                                        cursor: "pointer",
                                        background: idx === selectedFileIndex ? "var(--bg-surface)" : "transparent",
                                        color: idx === selectedFileIndex ? "var(--text)" : "var(--text-muted)",
                                        fontWeight: idx === selectedFileIndex ? 500 : 400,
                                        whiteSpace: "nowrap",
                                        fontFamily: "monospace",
                                    }}
                                >
                                    {file.filename}
                                </button>
                            ))}
                        </div>
                        {/* Code content */}
                        <div style={{ flex: 1, overflow: "auto", background: "var(--bg-surface)" }}>
                            <pre
                                style={{
                                    margin: 0,
                                    padding: "16px",
                                    fontSize: 13,
                                    lineHeight: 1.5,
                                    fontFamily: "'SF Mono', 'Fira Code', 'Fira Mono', Menlo, Consolas, monospace",
                                    whiteSpace: "pre",
                                    overflowX: "auto",
                                }}
                            >
                                <code>
                                    {allFiles[selectedFileIndex]
                                        ? addLineNumbers(allFiles[selectedFileIndex].content)
                                        : ""}
                                </code>
                            </pre>
                        </div>
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

function addLineNumbers(code: string): string {
    const lines = code.split("\n");
    const pad = String(lines.length).length;
    return lines
        .map((line, i) => `${String(i + 1).padStart(pad, " ")}  ${line}`)
        .join("\n");
}
