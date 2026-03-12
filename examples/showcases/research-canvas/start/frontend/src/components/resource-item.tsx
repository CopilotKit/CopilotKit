import { ChevronDown, File } from "lucide-react";
import { useResearch } from "./research-context";
import { Source } from "@/lib/types";
import { useState } from "react";

interface SourceItemProps {
    id: string;
    source: Source;
}

export function SourceItem({ id, source }: SourceItemProps) {
    const { state, setResearchState } = useResearch();
    const [isOpen, setIsOpen] = useState(false);

    const handleRemoveSource = (sourceId: string) => {
        const updatedSources = { ...state.sources };
        delete updatedSources[sourceId];
        setResearchState({
            ...state,
            sources: updatedSources
        });
    };

    return (
        <div key={id} className="border border-gray-200 rounded-lg">
            <div
                className={`flex items-center justify-between p-3 cursor-pointer bg-white hover:bg-gray-50 ${isOpen ? 'rounded-t-lg' : 'rounded-lg'} shadow-sm`}
                onClick={() => setIsOpen(!isOpen)}
            >
                <div className="flex items-center">
                    <File className="h-5 w-5 text-[var(--primary)] mr-3"/>
                    <h4 className="font-semibold">{source.title}</h4>
                </div>
                <div className="flex items-center gap-2">
                    <ChevronDown className="h-4 w-4 text-gray-500"/>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveSource(id);
                        }}
                        className="text-red-500 hover:text-red-700"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20"
                             fill="currentColor">
                            <path fillRule="evenodd"
                                  d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                                  clipRule="evenodd"/>
                        </svg>
                    </button>
                </div>
            </div>
            <div className={`${isOpen ? '' : 'hidden'} p-3 bg-white rounded-b-lg border-t border-gray-100`}>
                <p className="text-sm text-gray-600 mb-2">{source.content || 'No description available'}</p>
                {source.url && (
                    <a
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-500 hover:text-blue-700 text-sm"
                    >
                        View Source →
                    </a>
                )}
            </div>
        </div>
    )
}