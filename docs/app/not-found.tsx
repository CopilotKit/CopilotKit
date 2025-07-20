'use client';

import Image from 'next/image';
import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen">
      <div className="text-center">
        <div className="relative w-32 h-32 mx-auto mb-8 animate-bounce">
          <Image
            src="https://cdn.copilotkit.ai/docs/copilotkit/images/copilotkit-logo.svg"
            alt="CopilotKit Logo"
            fill
            priority
            className="object-contain"
          />
        </div>
        <h1 className="text-4xl font-bold mb-4 bg-gradient-to-r from-blue-600 to-purple-600 text-transparent bg-clip-text">
          Page Not Found
        </h1>
        <p className="text-gray-600 dark:text-gray-300 mb-6 max-w-sm">
          Oops! The page you're looking for doesn't exist.
        </p>
        <Link 
          href="/" 
          className="inline-flex items-center px-6 py-3 text-base font-medium text-white bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg hover:opacity-90 transition-opacity"
        >
          Go to Documentation
        </Link>
      </div>
    </div>
  );
}
