import type { Section as TSection } from "@/lib/types";
import Footer from "@/components/document-footer";
import React, { useMemo } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { DocumentEditor, DocumentEditorProps } from "@/components/documents-editor";

interface DocumentViewerProps {
    section?: TSection;
    zoomLevel: number,
    compact?: boolean;
    highlight?: boolean;
    onSelect?: (sectionId: string) => void;
    placeholder?: string;
    onSectionEdit: DocumentEditorProps['onSectionEdit']
    editMode: boolean
}

export function DocumentViewer({
    section,
    zoomLevel,
    compact = false,
    highlight = false,
    onSelect,
    placeholder,
    onSectionEdit,
    editMode,
}: DocumentViewerProps) {
    const { title, content, id, footer } = section ?? {};

    const scalingStyle = useMemo(() => {
        if (compact) {
            const scaleFactor = 0.1;
            return {
                width: `calc(210mm * ${scaleFactor})`,
                height: `calc(297mm * ${scaleFactor})`,
                fontSize: `calc(16px * ${scaleFactor})`,
                padding: '5px',
                '& *': {
                    fontSize: `calc(16px * ${scaleFactor})`,
                }
            }
        }
        return {
            transform: `scale(${zoomLevel / 100})`,
            transformOrigin: 'top left'
        }
    }, [compact, zoomLevel])

        if (editMode) {
        return (
            <DocumentEditor
                section={section!}
                zoomLevel={zoomLevel}
                onSectionEdit={onSectionEdit}
            />
        )
    }

    return (
        <div
            key={id}
            className={`bg-white shadow-sm p-6 overflow-auto border border-black/10 transition-all duration-200 ${
                compact ? `shadow hover:scale-105 ${highlight ? 'border-[var(--primary)]' : ''}` : 'shadow-lg z-10 flex-1'
            }`}
            style={scalingStyle}
            {...(compact ? {
                onClick: () => onSelect?.(id ?? ''),
                role: 'button',
                tabIndex: 0,
            } : {})}
        >
            {placeholder ? (<h1 className="text-xl font-noto text-center py-5 px-10">{placeholder}</h1>) : (
                <div id={`${id}`} className={compact ? 'max-h-full h-full overflow-hidden relative flex flex-col justify-center' : ''}>
                    {compact ? (
                        <h4 className="text-[10px] w-full text-center">{title}</h4>
                    ) : (
                        <div className="text-sm prose">
                            <h4 className={"text-xl font-semibold mb-4 w-full"}>{title}</h4>
                            <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
                            {footer?.length ? <Footer footer={footer ?? ''}/> : null}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
