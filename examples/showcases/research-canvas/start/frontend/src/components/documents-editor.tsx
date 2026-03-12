import type { Section as TSection } from "@/lib/types";
import Footer from "@/components/document-footer";

export interface DocumentEditorProps {
    section: TSection;
    zoomLevel: number;
    onSectionEdit: (section: TSection) => void;
}

export function DocumentEditor({
    section,
    zoomLevel,
    onSectionEdit,
}: DocumentEditorProps) {
    const { id } = section ?? {};

    const scalingStyle = {
            transform: `scale(${zoomLevel / 100})`,
            transformOrigin: 'top left'
        }

    return (
        <div
            key={id}
            className="bg-white p-6 overflow-auto border h-full border-black/10 transition-all duration-200 shadow-lg z-10 flex-1"
            style={scalingStyle}
        >
            <div className="flex flex-col h-full">
                <input
                    type="text"
                    value={section.title}
                    onChange={(e) => onSectionEdit({ ...section, title: e.target.value })}
                    className="text-2xl font-semibold text-center mb-4 px-4 py-2 border border-black/10 rounded bg-white/50 focus:outline-none focus:ring-1 focus:ring-black/10"
                />
                <textarea
                    value={section.content}
                    onChange={(e) => onSectionEdit({ ...section, content: e.target.value })}
                    className="flex-1 w-full font-mono p-4 border border-black/10 rounded bg-white/50 focus:outline-none focus:ring-1 focus:ring-black/10 resize-none"
                />
                {section.footer?.length ? <Footer footer={section.footer} /> : null}
            </div>
        </div>
    );
}
