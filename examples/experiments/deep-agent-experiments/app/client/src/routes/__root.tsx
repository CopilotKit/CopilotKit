import { createRootRoute, Link, Outlet } from "@tanstack/react-router";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <div className="flex flex-col h-screen w-screen">
      <header className="sticky top-0 z-50 bg-white border-b border-gray-200">
        <nav className="px-6 h-12 flex items-center gap-6">
          <Link to="/" className="text-sm font-medium text-gray-700 hover:text-gray-900">
            Home
          </Link>
          <Link
            to="/use-frontend-tool"
            className="text-sm font-medium text-gray-700 hover:text-gray-900"
          >
            useFrontendTool
          </Link>
          <Link to="/use-agent" className="text-sm font-medium text-gray-700 hover:text-gray-900">
            useAgent
          </Link>
          <Link to="/hitl" className="text-sm font-medium text-gray-700 hover:text-gray-900">
            HITL
          </Link>
          <Link to="/headless-ui" className="text-sm font-medium text-gray-700 hover:text-gray-900">
            Headless UI
          </Link>
          <Link to="/tickets/$" params={{ _splat: "" }} className="text-sm font-medium text-gray-700 hover:text-gray-900">
            Tickets
          </Link>
        </nav>
      </header>
      <div className="flex-1 overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}
