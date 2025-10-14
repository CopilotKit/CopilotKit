'use client'

import { useState } from 'react'

export function RecipeCard({ recipe, index }) {
  const [showAllInstructions, setShowAllInstructions] = useState(false)

  const displayedInstructions = showAllInstructions 
    ? recipe.instructions 
    : recipe.instructions.slice(0, 3)

  const getDifficultyColor = (difficulty) => {
    switch (difficulty) {
      case 'Easy': return 'bg-green-100 text-green-800 border-green-200'
      case 'Medium': return 'bg-yellow-100 text-yellow-800 border-yellow-200'
      case 'Hard': return 'bg-red-100 text-red-800 border-red-200'
      default: return 'bg-gray-100 text-gray-800 border-gray-200'
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-lg overflow-hidden hover:shadow-xl transition-all duration-300 transform hover:-translate-y-2">
      {/* Card Header */}
      <div className="bg-gradient-to-r from-blue-500 to-purple-500 p-6 text-white">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xl font-bold truncate">{recipe.name}</h3>
          <span className={`px-3 py-1 rounded-full text-sm font-semibold border ${getDifficultyColor(recipe.difficulty)}`}>
            {recipe.difficulty}
          </span>
        </div>
        
        <div className="flex items-center text-blue-100">
          <span className="flex items-center gap-2">
            <span className="text-lg">⏱️</span>
            <span className="font-semibold">{recipe.cookingTime} mins</span>
          </span>
        </div>
      </div>
      
      {/* Card Body */}
      <div className="p-6">
        <div className="mb-6">
          <h4 className="font-bold text-gray-700 mb-3 flex items-center gap-2">
            <span className="text-lg">🛒</span>
            Ingredients:
          </h4>
          <ul className="text-sm text-gray-600 space-y-2">
            {recipe.ingredients.slice(0, 6).map((ingredient, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                {ingredient}
              </li>
            ))}
            {recipe.ingredients.length > 6 && (
              <li className="text-blue-600 font-semibold text-sm">
                +{recipe.ingredients.length - 6} more ingredients
              </li>
            )}
          </ul>
        </div>
        
        <div className="mb-6">
          <h4 className="font-bold text-gray-700 mb-3 flex items-center gap-2">
            <span className="text-lg">👨‍🍳</span>
            Instructions:
          </h4>
          <ol className="text-sm text-gray-600 space-y-2">
            {displayedInstructions.map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 bg-blue-500 text-white rounded-full text-xs flex items-center justify-center font-bold">
                  {i + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
            {recipe.instructions.length > 3 && (
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6"></span>
                <button
                  onClick={() => setShowAllInstructions(!showAllInstructions)}
                  className="text-blue-600 font-semibold text-sm hover:text-blue-800 transition-colors duration-200 flex items-center gap-1"
                >
                  {showAllInstructions ? (
                    <>
                      <span>▲</span>
                      Show less
                    </>
                  ) : (
                    <>
                      <span>▼</span>
                      ...and {recipe.instructions.length - 3} more steps
                    </>
                  )}
                </button>
              </li>
            )}
          </ol>
        </div>
        
        <div className="flex gap-3">
          <button className="flex-1 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white font-semibold py-3 px-4 rounded-xl transition-all duration-200 transform hover:scale-105">
            Save Recipe 💾
          </button>
          <button className="flex-1 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white font-semibold py-3 px-4 rounded-xl transition-all duration-200 transform hover:scale-105">
            Cook This 🍳
          </button>
        </div>
      </div>
    </div>
  )
}