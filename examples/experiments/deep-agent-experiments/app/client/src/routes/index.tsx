import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: IndexPage,
});

function IndexPage() {
  return (
    <div className="flex items-center justify-center h-full bg-gray-50">
      <div className="max-w-lg mx-auto space-y-6 text-center">
        <h1 className="text-2xl font-bold text-gray-900">
          Deep Agent — Generative UI
        </h1>
        <p className="text-gray-600">
          Two approaches to rendering custom components in the canvas.
        </p>
        <div className="flex gap-4 justify-center">
          <Link
            to="/use-frontend-tool"
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Approach A: useFrontendTool
          </Link>
          <Link
            to="/use-agent"
            className="px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
          >
            Approach C: useAgent
          </Link>
        </div>
      </div>
    </div>
  );
}
