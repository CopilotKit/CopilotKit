"use client";

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Search, Home, ArrowLeft, BookOpen, Code, Zap } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      <div className="max-w-2xl mx-auto px-4 text-center">
        <div className="mb-8">
          <div className="text-6xl font-bold text-indigo-600 dark:text-indigo-400 mb-4">
            404
          </div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">
            Page Not Found
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-300 mb-8">
            The page you're looking for doesn't exist or has been moved.
          </p>
        </div>

        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/"
              className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
            >
              <Home className="w-4 h-4" />
              Go Home
            </Link>
            
            <button
              onClick={() => {
                if (typeof window !== 'undefined') {
                  window.history.back();
                }
              }}
              className="inline-flex items-center gap-2 px-6 py-3 bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Go Back
            </button>
          </div>

          <div className="mt-8 p-6 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Looking for something specific?
            </h3>
            <p className="text-gray-600 dark:text-gray-300 mb-4">
              Try searching our documentation or browse our main sections:
            </p>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Link
                href="/direct-to-llm"
                className="p-4 text-left bg-blue-50 dark:bg-blue-900/20 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors group"
              >
                <div className="flex items-center gap-3 mb-2">
                  <Code className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  <div className="font-medium text-blue-900 dark:text-blue-100">Direct to LLM</div>
                </div>
                <div className="text-sm text-blue-700 dark:text-blue-300">Build copilots with any LLM</div>
              </Link>
              
              <Link
                href="/langgraph"
                className="p-4 text-left bg-green-50 dark:bg-green-900/20 rounded-lg hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors group"
              >
                <div className="flex items-center gap-3 mb-2">
                  <Zap className="w-5 h-5 text-green-600 dark:text-green-400" />
                  <div className="font-medium text-green-900 dark:text-green-100">LangGraph</div>
                </div>
                <div className="text-sm text-green-700 dark:text-green-300">Agentic workflows and state machines</div>
              </Link>
              
              <Link
                href="/mastra"
                className="p-4 text-left bg-purple-50 dark:bg-purple-900/20 rounded-lg hover:bg-purple-100 dark:hover:bg-purple-900/30 transition-colors group"
              >
                <div className="flex items-center gap-3 mb-2">
                  <BookOpen className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                  <div className="font-medium text-purple-900 dark:text-purple-100">Mastra</div>
                </div>
                <div className="text-sm text-purple-700 dark:text-purple-300">Multi-agent orchestration</div>
              </Link>
              
              <Link
                href="/reference"
                className="p-4 text-left bg-gray-50 dark:bg-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors group"
              >
                <div className="flex items-center gap-3 mb-2">
                  <Search className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                  <div className="font-medium text-gray-900 dark:text-gray-100">API Reference</div>
                </div>
                <div className="text-sm text-gray-700 dark:text-gray-300">Complete API documentation</div>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
