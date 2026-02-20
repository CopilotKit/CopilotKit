'use client'

import { useState, useEffect } from 'react'
import { useFrontendTool, useCopilotReadable } from '@copilotkit/react-core'
import { CopilotTextarea } from '@copilotkit/react-textarea'
import { RecipeCard } from './RecipeCard'
import { z } from 'zod'

export function MealPlanner() {
  const [ingredients, setIngredients] = useState('')
  const [recipes, setRecipes] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [useAI, setUseAI] = useState(false)

  // Make ingredients available to Copilot
  useCopilotReadable({
    description: "Available ingredients for recipe generation",
    value: ingredients
  })

  const handleGenerateRecipes = async (ingredientsInput = ingredients, useAIGeneration = useAI) => {
    if (!ingredientsInput.trim()) {
      alert("Please enter some ingredients first!")
      return
    }

    setIsLoading(true)
    try {
      const response = await fetch('/api/recipes/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingredients: ingredientsInput, useAI: useAIGeneration })
      })

      if (!response.ok) throw new Error('Failed to generate recipes')

      const data = await response.json()
      setRecipes(data.recipes || [])
    } catch (error) {
      console.error('Error generating recipes:', error)
      alert('Failed to generate recipes. Please check your connection and try again.')
    } finally {
      setIsLoading(false)
    }
  }

  useFrontendTool({
    name: "generateRecipes",
    description: "Generate recipe suggestions based on available ingredients. Always ask for ingredients if not provided.",
    parameters: z.object({
      ingredients: z.string().min(1, "Ingredients are required").describe("Comma-separated list of ingredients")
    }),
    handler: async ({ ingredients: ingredientInput }) => {
      if (!ingredientInput?.trim()) {
        throw new Error("Please provide ingredients to generate recipes")
      }
      await handleGenerateRecipes(ingredientInput, true)
      return `Generated recipes using: ${ingredientInput}`
    },
    render: ({ args, status }) => {
      if (status === "inProgress") {
        return (
          <div className="flex items-center gap-3 p-4 bg-blue-50 rounded-lg border border-blue-200">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
            <span className="text-blue-700 font-medium">Planning recipes with: {args?.ingredients}</span>
          </div>
        )
      }
      if (status === "executing") {
        return (
          <div className="flex items-center gap-3 p-4 bg-green-50 rounded-lg border border-green-200">
            <div className="animate-pulse">👨‍🍳</div>
            <span className="text-green-700 font-medium">Creating delicious recipes...</span>
          </div>
        )
      }
      return null
    }
  })

  useFrontendTool({
    name: "getCookingTips",
    description: "Provide expert cooking tips and techniques for various culinary topics",
    parameters: z.object({
      topic: z.string().default("general cooking").describe("Specific cooking area like 'baking', 'grilling', etc.")
    }),
    handler: async ({ topic }) => {
      const selectedTopic = topic || "general cooking"
      const tips = {
        "baking": "• Preheat your oven properly\n• Measure ingredients accurately\n• Don't overmix batter\n• Use room temperature ingredients",
        "grilling": "• Clean and oil the grill grates\n• Let meat come to room temperature\n• Don't press down on burgers\n• Use a meat thermometer",
        "meal prep": "• Plan your meals for the week\n• Cook proteins in batches\n• Use uniform cutting for even cooking\n• Store in airtight containers",
        "general cooking": "• Always prep ingredients first (mise en place)\n• Taste as you cook and adjust seasoning\n• Let meat rest before slicing\n• Use sharp knives for safety"
      }

      const selectedTips = tips[selectedTopic.toLowerCase()] || tips["general cooking"]
      alert(`🧑‍🍳 Cooking Tips for ${selectedTopic}:\n\n${selectedTips}`)
      return `Shared ${selectedTopic} cooking tips`
    },
    render: ({ args, status }) => {
      if (status === "executing") {
        return (
          <div className="flex items-center gap-3 p-4 bg-purple-50 rounded-lg border border-purple-200">
            <div className="animate-pulse">📚</div>
            <span className="text-purple-700 font-medium">Gathering {args?.topic} expertise...</span>
          </div>
        )
      }
      return null
    }
  })

  useFrontendTool({
    name: "clearRecipes",
    description: "Clear all currently displayed recipes from the screen",
    parameters: z.void(),
    handler: async () => {
      setRecipes([])
      return "Cleared recipe display"
    },
    render: ({ status }) => {
      if (status === "executing") {
        return (
          <div className="flex items-center gap-3 p-4 bg-orange-50 rounded-lg border border-orange-200">
            <span className="text-orange-700 font-medium">🧹 Clearing recipes...</span>
          </div>
        )
      }
      return null
    }
  })

  // Load sample recipes on mount
  useEffect(() => {
    const loadSample = async () => {
      try {
        const response = await fetch('/api/recipes/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ingredients: 'chicken, rice, vegetables, spices, olive oil', useAI: false })
        })
        const data = await response.json()
        setRecipes(data.recipes || [])
      } catch (error) {
        console.error('Error loading sample recipes:', error)
      }
    }
    loadSample()
  }, [])

  const ingredientCount = ingredients.split(/[,.\n]/).filter(word => word.trim().length > 0).length

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Your existing JSX remains the same */}
      {/* Hero Section */}
      <div className="text-center space-y-4">
        <h2 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-emerald-600 to-blue-600 bg-clip-text text-transparent">
          Discover Your Next Favorite Meal
        </h2>
        <p className="text-xl text-gray-600 max-w-2xl mx-auto">
          Transform your ingredients into delicious recipes with AI-powered suggestions
        </p>
      </div>

      {/* AI Assistant Card */}
      <div className="bg-gradient-to-r from-purple-500/10 to-blue-500/10 border border-purple-200/50 rounded-2xl p-6 backdrop-blur-sm">
        <div className="flex flex-col md:flex-row items-start gap-6">
          <div className="flex-shrink-0">
            <div className="bg-gradient-to-r from-purple-500 to-blue-500 p-4 rounded-2xl">
              <span className="text-2xl text-white">🤖</span>
            </div>
          </div>
          <div className="flex-1 space-y-4">
            <div>
              <h3 className="text-2xl font-bold text-gray-800 mb-2">AI Cooking Assistant</h3>
              <p className="text-gray-600 leading-relaxed">
                Click the chat icon in the bottom-right to open your AI assistant. 
                Get personalized recipe suggestions, cooking tips, and meal planning advice.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {[
                "generate recipes chicken rice",
                "cooking tips for baking", 
                "clear recipes",
                "vegetarian ideas"
              ].map((command, index) => (
                <span
                  key={index}
                  className="bg-white/80 backdrop-blur-sm px-3 py-1.5 rounded-full text-sm font-medium text-gray-700 border border-gray-200"
                >
                  {command}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8">
        <div className="flex flex-col lg:flex-row gap-8 items-start">
          <div className="flex-1 space-y-4">
            <h3 className="text-2xl font-bold text-gray-800">Quick Setup</h3>
            <p className="text-gray-600">
              Start with sample ingredients or enter your own. Choose between AI-powered generation or our recipe database.
            </p>
            <div className="flex flex-wrap gap-4">
              <button
                onClick={() => setIngredients('chicken, rice, tomatoes, onions, garlic, olive oil, spices, herbs')}
                className="bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white px-6 py-3 rounded-xl transition-all duration-200 font-semibold shadow-lg hover:shadow-xl transform hover:scale-105"
              >
                🛒 Load Sample Ingredients
              </button>
              <div className="flex items-center gap-3 bg-gray-50 px-4 py-3 rounded-xl border border-gray-200">
                <label className="flex items-center gap-3 cursor-pointer">
                  <div className="relative">
                    <input
                      type="checkbox"
                      checked={useAI}
                      onChange={(e) => setUseAI(e.target.checked)}
                      className="sr-only"
                    />
                    <div className={`w-12 h-6 rounded-full transition-colors ${useAI ? 'bg-emerald-500' : 'bg-gray-300'}`}>
                      <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${useAI ? 'transform translate-x-7' : 'transform translate-x-1'}`} />
                    </div>
                  </div>
                  <span className="font-medium text-gray-700">AI Generation</span>
                </label>
                <span className="text-sm text-gray-500 bg-white px-2 py-1 rounded border">
                  {useAI ? 'Enhanced' : 'Standard'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Ingredients Input */}
      <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8">
        <div className="text-center mb-8">
          <h2 className="text-3xl font-bold text-gray-800 mb-3">
            What's in Your Kitchen?
          </h2>
          <p className="text-gray-600 text-lg">
            List your ingredients separated by commas. Our AI will work its magic!
          </p>
        </div>
        
        <div className="space-y-6">
          <div className="relative">
            <CopilotTextarea
              value={ingredients}
              onChange={(e) => setIngredients(e.target.value)}
              placeholder="Enter your ingredients here...
Examples: 
• chicken breast, rice, tomatoes, onions, garlic
• pasta, mozzarella cheese, spinach, mushrooms, cream
• eggs, bread, milk, butter, cheese, herbs"
              className="w-full h-48 p-6 border-2 border-gray-200 rounded-xl resize-none focus:ring-3 focus:ring-blue-500/20 focus:border-blue-500 text-lg placeholder-gray-400 transition-all duration-200 bg-white"
              autosuggestionsConfig={{
                textareaPurpose: "List of cooking ingredients available for recipe suggestions",
                chatApiConfigs: {
                  suggestionsApiConfig: {
                    makeSystemPrompt: () => `You are a helpful cooking assistant. Suggest ingredient combinations and recipe ideas based on what the user is typing. Focus on practical cooking ingredients and common pantry items. Keep suggestions concise and relevant.`
                  },
                },
                contextCategories: ["ingredients", "cooking", "recipes"],
              }}
            />
            <div className="absolute bottom-4 right-4">
              <span className="bg-blue-500 text-white px-3 py-1 rounded-full text-sm font-medium shadow-lg">
                {ingredientCount} {ingredientCount === 1 ? 'ingredient' : 'ingredients'}
              </span>
            </div>
          </div>
          
          <div className="flex justify-center">
            <button
              onClick={() => handleGenerateRecipes(ingredients, useAI)}
              disabled={isLoading || !ingredients.trim()}
              className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 disabled:from-gray-400 disabled:to-gray-500 text-white font-bold py-4 px-12 rounded-xl transition-all duration-200 disabled:cursor-not-allowed text-lg flex items-center justify-center gap-3 shadow-2xl hover:shadow-3xl transform hover:scale-105 disabled:transform-none"
            >
              {isLoading ? (
                <>
                  <div className="animate-spin rounded-full h-6 w-6 border-2 border-white border-t-transparent"></div>
                  <span>{useAI ? 'AI Chef is Cooking...' : 'Finding Recipes...'}</span>
                </>
              ) : (
                <>
                  <span className="text-xl">✨</span>
                  <span>{useAI ? 'Generate with AI Chef' : 'Find Recipes'}</span>
                  <span className="text-xl">✨</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Recipes Display */}
      <div className="space-y-8">
        <div className="text-center">
          <h2 className="text-4xl font-bold text-gray-800 mb-4">
            🍳 Suggested Recipes
          </h2>
          
          {recipes.length > 0 && !isLoading && (
            <div className="inline-flex items-center gap-3 bg-gradient-to-r from-green-500 to-emerald-500 text-white px-6 py-3 rounded-full shadow-lg">
              <span className="text-xl">🎉</span>
              <span className="font-semibold">
                Found {recipes.length} amazing {recipes.length === 1 ? 'recipe' : 'recipes'}! 
                <span className="opacity-90 ml-2">{useAI ? '(AI Generated)' : '(Recipe Database)'}</span>
              </span>
            </div>
          )}
        </div>

        {recipes.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
            {recipes.map((recipe, index) => (
              <RecipeCard key={index} recipe={recipe} index={index} />
            ))}
          </div>
        ) : !isLoading && (
          <div className="text-center py-16 bg-white rounded-2xl border-2 border-dashed border-gray-200">
            <div className="text-8xl mb-6">👨‍🍳</div>
            <h3 className="text-3xl font-semibold text-gray-600 mb-4">
              Ready to Cook Something Amazing?
            </h3>
            <p className="text-gray-500 text-lg max-w-md mx-auto">
              Enter your ingredients above and let our AI chef suggest perfect recipes tailored to what you have!
            </p>
          </div>
        )}
      </div>
    </div>
  )
}