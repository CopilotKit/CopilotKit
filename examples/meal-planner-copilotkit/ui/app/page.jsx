'use client'

import { CopilotKit } from '@copilotkit/react-core'
import { CopilotPopup } from '@copilotkit/react-ui'
import { MealPlanner } from './components/MealPlanner'
import { agentInstructions } from './agents/instructions'

export default function Home() {
  return (
    <CopilotKit
      publicApiKey={process.env.NEXT_PUBLIC_COPILOT_CLOUD_API_KEY}
    >
      {/* Your main app content */}
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-blue-50 to-cyan-50">
        {/* Header */}
        <header className="bg-gradient-to-r from-emerald-600 via-blue-600 to-cyan-600 text-white shadow-lg">
          <div className="container mx-auto px-4 py-16">
            <div className="text-center max-w-4xl mx-auto">
              <div className="flex justify-center items-center mb-4">
                <div className="bg-white/20 p-4 rounded-2xl backdrop-blur-sm">
                  <span className="text-4xl">🍽️</span>
                </div>
              </div>
              <h1 className="text-5xl md:text-6xl font-bold mb-4 bg-gradient-to-r from-white to-emerald-100 bg-clip-text text-transparent">
                Smart Meal Planner
              </h1>
              <p className="text-xl md:text-2xl opacity-95 mb-6 font-light">
                AI-Powered Recipe Generation
              </p>
              <div className="flex flex-wrap justify-center gap-3">
                {["🤖 AI-Powered", "⚡ Instant Results", "🍳 Chef-Inspired", "💬 Copilot AI"].map((badge, index) => (
                  <span
                    key={index}
                    className="bg-white/20 backdrop-blur-sm px-4 py-2 rounded-full text-sm font-medium border border-white/30"
                  >
                    {badge}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1">
          <div className="container mx-auto px-4 py-12">
            <MealPlanner />
          </div>
        </main>

        {/* Footer */}
        <footer className="bg-gray-900 text-white border-t border-gray-700">
          <div className="container mx-auto px-4 py-8">
            <div className="text-center">
              <p className="text-lg font-semibold mb-2">
                Built with ❤️ using Next.js & CopilotKit
              </p>
              <p className="text-gray-400 text-sm">
                Transform your ingredients into delicious meals with AI
              </p>
            </div>
          </div>
        </footer>
      </div>

      <CopilotPopup
        instructions={agentInstructions}
        defaultOpen={false}
        labels={{
          title: "MealMaster AI",
          initial: "Hi! I'm your cooking assistant. What ingredients do you have today?"
        }}
      />
    </CopilotKit>
  )
}