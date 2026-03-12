import Markdown from "react-markdown";
import React from "react";

export default function Footer({ footer }: { footer?: string }) {
    return (
        <div className="border-t border-gray-200 mt-8 pt-2">
            <h4 className="text-xs font-medium text-gray-700 mb-2">References</h4>
            <div className="prose text-xs">
                <Markdown>{footer}</Markdown>
            </div>
        </div>
    )
}