import React from "react";
import { DocumentViewer } from "@/components/document-viewer";
import { Section } from "@/lib/types";
import { NOOP } from "@/lib/utils";

interface DocumentsScrollbarProps {
    sections: Section[];
    onSelectSection: (sectionId: string) => void;
    selectedSectionId?: string;
}

export function DocumentsScrollbar({
    sections,
    onSelectSection,
    selectedSectionId
}: DocumentsScrollbarProps) {
    return (
        <div className="group h-full">
            <div className="p-2 overflow-y-auto space-y-2 flex flex-col overflow-x-hidden border border-black/10 bg-[#FAF9F6] h-full relative">
                {sections?.map(section => (
                    <DocumentViewer
                        key={section.id}
                        section={section}
                        zoomLevel={30}
                        compact
                        highlight={selectedSectionId === section.id}
                        onSelect={onSelectSection}
                        editMode={false}
                        onSectionEdit={NOOP}
                    />
                ))}
            </div>
        </div>
    )
}
