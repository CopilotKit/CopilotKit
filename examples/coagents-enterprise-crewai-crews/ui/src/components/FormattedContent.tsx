import React, { useState } from "react";
import { Streamdown } from "streamdown";
import JSON5 from "json5";
import { ChevronDown, ChevronUp } from "lucide-react";

// Utilities to check and format content
const isJsonString = (str: string) => {
  try {
    JSON5.parse(str);
    return true;
  } catch {
    return false;
  }
};

const formatContent = (content: string) => {
  if (isJsonString(content)) {
    try {
      return JSON.stringify(JSON5.parse(content), null, 2);
    } catch {
      return content;
    }
  }
  return content;
};

// Helper function to check if content contains search results
const isSearchResults = (content: string) => {
  try {
    const data = JSON5.parse(content);
    return (
      data.searchParameters &&
      data.searchParameters.q &&
      data.organic &&
      Array.isArray(data.organic)
    );
  } catch {
    return false;
  }
};

interface FormattedContentProps {
  content: string;
  showJsonLabel?: boolean; // Controls whether to show the JSON label
  isCollapsed?: boolean; // Controls whether content is collapsed by default
}

export { isJsonString, formatContent, isSearchResults };

const FormattedContent: React.FC<FormattedContentProps> = ({
  content,
  showJsonLabel = true,
  isCollapsed = false,
}) => {
  const [collapsed, setCollapsed] = useState(isCollapsed);

  // Preview for collapsed state
  const getPreview = (content: string): string => {
    const trimmedContent = content.trim();
    return trimmedContent.length > 50
      ? trimmedContent.substring(0, 50) + "..."
      : trimmedContent;
  };

  const toggleCollapse = () => {
    setCollapsed(!collapsed);
  };

  // Collapsible wrapper component
  const CollapsibleContent: React.FC<{ children: React.ReactNode }> = ({
    children,
  }) => {
    return (
      <div>
        <div
          className="flex items-center cursor-pointer text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300 mb-1"
          onClick={toggleCollapse}
        >
          {collapsed ? (
            <>
              <ChevronDown className="h-3 w-3 mr-1" />
              <span>Expand {isJsonString(content) ? "JSON" : "content"}</span>
              <span className="ml-2 opacity-60">{getPreview(content)}</span>
            </>
          ) : (
            <>
              <ChevronUp className="h-3 w-3 mr-1" />
              <span>Collapse {isJsonString(content) ? "JSON" : "content"}</span>
            </>
          )}
        </div>
        {!collapsed && children}
      </div>
    );
  };

  if (isJsonString(content)) {
    // If it's JSON, format and display with syntax highlighting (Streamdown has built-in code blocks)
    return (
      <>
        {showJsonLabel && isJsonString(content) && !collapsed && (
          <span className="ml-2 text-xs px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded-full">
            JSON
          </span>
        )}
        <CollapsibleContent>
          <div
            className="bg-gray-800 rounded-md overflow-y-auto"
            style={{ wordBreak: "break-word" }}
          >
            <Streamdown>{`\`\`\`json\n${formatContent(content)}\n\`\`\``}</Streamdown>
          </div>
        </CollapsibleContent>
      </>
    );
  }

  // If it's not JSON, render as Markdown
  return (
    <CollapsibleContent>
      <div className="markdown-content bg-gray-50 dark:bg-zinc-700/40 p-3 rounded-md border border-gray-200 dark:border-zinc-700">
        <Streamdown>{content}</Streamdown>
      </div>
    </CollapsibleContent>
  );
};

export default FormattedContent;
