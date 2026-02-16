"use client";

import { useState } from "react";
import { Maximize2 } from "lucide-react";

interface MaximizableVideoProps {
  src: string;
  className?: string;
}

export function MaximizableVideo({
  src,
  className = "",
}: MaximizableVideoProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <>
      <div className={`group relative ${className}`}>
        <div className="absolute -inset-1 rounded-3xl"></div>
        <video
          src={src}
          autoPlay
          loop
          muted
          playsInline
          className="relative w-full rounded-2xl"
        />
        <button
          onClick={() => setIsModalOpen(true)}
          className="absolute top-4 right-4 rounded-lg bg-black/50 p-2 opacity-0 transition-all duration-200 group-hover:opacity-100 hover:bg-black/70"
          aria-label="Maximize video"
        >
          <Maximize2 className="h-4 w-4 text-white" />
        </button>
      </div>

      {isModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setIsModalOpen(false);
            }
          }}
        >
          <div className="relative w-full max-w-4xl">
            <button
              onClick={() => setIsModalOpen(false)}
              className="absolute -top-12 right-0 p-2 text-white transition-colors hover:text-gray-300"
              aria-label="Close video"
            >
              <svg
                className="h-6 w-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
            <video
              src={src}
              autoPlay
              loop
              muted
              playsInline
              className="w-full rounded-2xl"
            />
          </div>
        </div>
      )}
    </>
  );
}
