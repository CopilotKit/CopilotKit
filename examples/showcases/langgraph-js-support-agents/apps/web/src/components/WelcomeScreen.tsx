import React from "react";
import { FiZap, FiUsers, FiMessageSquare, FiAlertCircle } from "react-icons/fi";

export function WelcomeScreen() {
  return (
    <div className="max-w-5xl mx-auto">
      <div className="rounded-2xl p-8">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-500 rounded-full mb-4">
            <FiZap className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Multi-Agent Telecom Support System
          </h1>
          <p className="text-gray-600 text-sm max-w-2xl mx-auto">
            Built with CopilotKit & LangGraph - An intelligent AI system powered
            by 4 specialized agents working together to provide seamless
            customer support
          </p>
        </div>

        {/* Agents Overview */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
            <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center mb-2">
              <FiMessageSquare className="w-5 h-5 text-purple-600" />
            </div>
            <h3 className="font-semibold text-sm text-gray-800 mb-1">
              Intent Agent
            </h3>
            <p className="text-xs text-gray-500">
              Classifies customer issues & urgency
            </p>
          </div>

          <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center mb-2">
              <FiUsers className="w-5 h-5 text-blue-600" />
            </div>
            <h3 className="font-semibold text-sm text-gray-800 mb-1">
              Lookup Agent
            </h3>
            <p className="text-xs text-gray-500">
              Finds customer profiles instantly
            </p>
          </div>

          <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
            <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center mb-2">
              <FiMessageSquare className="w-5 h-5 text-green-600" />
            </div>
            <h3 className="font-semibold text-sm text-gray-800 mb-1">
              Reply Agent
            </h3>
            <p className="text-xs text-gray-500">
              Generates personalized responses
            </p>
          </div>

          <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
            <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center mb-2">
              <FiAlertCircle className="w-5 h-5 text-orange-600" />
            </div>
            <h3 className="font-semibold text-sm text-gray-800 mb-1">
              Escalation Agent
            </h3>
            <p className="text-xs text-gray-500">
              Routes complex issues to humans
            </p>
          </div>
        </div>

        {/* Getting Started */}
        <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-200">
          <h2 className="text-lg font-bold text-gray-800 mb-3">
            🚀 Get Started
          </h2>
          <p className="text-sm text-gray-600 mb-4">
            Select any customer from the dropdown above to begin. The AI
            assistant will help you manage accounts, troubleshoot issues, and
            provide support.
          </p>

          {/* Example Queries */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-700 mb-2">
              Try asking:
            </p>
            <div className="flex flex-wrap gap-2">
              <span className="px-3 py-1.5 bg-blue-50 text-blue-700 text-xs rounded-full border border-blue-200">
                "Show me customer 5575-GNVDE's services"
              </span>
              <span className="px-3 py-1.5 bg-purple-50 text-purple-700 text-xs rounded-full border border-purple-200">
                "Add StreamingTV to their account"
              </span>
              <span className="px-3 py-1.5 bg-green-50 text-green-700 text-xs rounded-full border border-green-200">
                "Switch internet to Fiber Optic"
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
