"use client";

import config from "@/config";
import { DemoConfig } from "@/types/demo";

export default function DemoList() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {config.map((demo: DemoConfig) => (
        <div
          key={demo.id}
          className="bg-white rounded-lg border border-gray-200 p-6 hover:shadow-md transition-shadow cursor-pointer"
          onClick={() => window.open(demo.path, '_blank')}
        >
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            {demo.name}
          </h3>
          <p className="text-gray-600 text-sm mb-4">
            {demo.description}
          </p>
          <div className="flex flex-wrap gap-2">
            {demo.tags.map((tag) => (
              <span
                key={tag}
                className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
