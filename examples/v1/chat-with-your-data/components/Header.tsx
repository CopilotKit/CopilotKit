"use client";

export function Header() {
  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-7xl flex-col items-start justify-between px-4 py-4 sm:flex-row sm:items-center sm:px-6 lg:px-8">
        <div>
          <h1 className="text-2xl font-medium text-gray-900">Data Dashboard</h1>
          <p className="mt-1 text-sm text-gray-500">
            Interactive data visualization with AI assistance
          </p>
        </div>
      </div>
    </header>
  );
}
