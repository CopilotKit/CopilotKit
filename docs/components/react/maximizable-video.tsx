"use client";

import { useState } from "react";
import { Maximize2 } from "lucide-react";

interface MaximizableVideoProps {
  src: string;
  className?: string;
}

export function MaximizableVideo({ src, className = "" }: MaximizableVideoProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <>
      <div className={`relative group ${className}`}>
        <div className="absolute -inset-1 rounded-3xl bg-gradient-to-r from-cyan-400 to-pink-500 opacity-75 blur-xl"></div>
        <video
          src={src}
          autoPlay
          loop
          muted
          playsInline
          className="relative rounded-2xl w-full"
        />
        <button
          onClick={() => setIsModalOpen(true)}
          className="absolute top-4 right-4 p-2 bg-black/50 hover:bg-black/70 rounded-lg transition-all duration-200 opacity-0 group-hover:opacity-100"
          aria-label="Maximize video"
        >
          <Maximize2 className="w-4 h-4 text-white" />
        </button>
      </div>

      {isModalOpen && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setIsModalOpen(false);
            }
          }}
        >
          <div className="relative max-w-4xl w-full">
            <button
              onClick={() => setIsModalOpen(false)}
              className="absolute -top-12 right-0 p-2 text-white hover:text-gray-300 transition-colors"
              aria-label="Close video"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <video
              src={src}
              autoPlay
              loop
              muted
              playsInline
              className="rounded-2xl w-full"
            />
          </div>
        </div>
      )}
    </>
  );
} 