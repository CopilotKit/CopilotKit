import { useEffect, useRef, useState } from "react";

// Extracted form component to reduce nesting in main component
export default function AddServerForm({
  onAdd,
  onCancel,
}: {
  onAdd: (endpoint: string) => void;
  onCancel: () => void;
}) {
  const [endpoint, setEndpoint] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = () => {
    if (endpoint.trim()) {
      onAdd(endpoint.trim());
      setEndpoint("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSubmit();
    else if (e.key === "Escape") onCancel();
  };

  return (
    <div className="absolute right-0 top-full z-10 mt-1 mr-4 w-80 p-4 bg-gray-700 border border-gray-600 rounded-md shadow-xl">
      <div className="flex justify-between items-center mb-3">
        <h2 className="text-sm font-medium text-white">Add MCP Server</h2>
        <button
          onClick={onCancel}
          className="text-gray-300 hover:text-white transition-colors"
        >
          <span className="text-lg">&times;</span>
        </button>
      </div>

      <p className="mb-3 text-xs text-gray-300">
        Get your MCP server endpoint from{" "}
        <a
          href="https://mcp.composio.dev"
          target="_blank"
          rel="noopener noreferrer"
          className="text-gray-300 hover:text-white transition-colors"
        >
          mcp.composio.dev
        </a>
      </p>

      <div className="space-y-2">
        <input
          ref={inputRef}
          type="text"
          value={endpoint}
          onChange={(e) => setEndpoint(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="https://mcp.composio.dev/your-endpoint"
          className="w-full px-3 py-2 text-sm bg-gray-800 border border-gray-600 rounded-md focus:outline-none focus:ring-1 focus:ring-gray-500 placeholder-gray-400 text-white"
        />

        <div className="flex justify-between">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-sm text-gray-300 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!endpoint.trim()}
            className="px-3 py-1.5 text-sm text-white bg-gray-600 rounded-md hover:bg-gray-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Add Server
          </button>
        </div>
      </div>
    </div>
  );
}
