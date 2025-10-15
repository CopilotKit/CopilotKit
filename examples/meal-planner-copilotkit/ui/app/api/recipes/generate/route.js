import { NextResponse } from 'next/server';
import { mealPlanningAgent } from '../../../agents/mealAgent';

export async function POST(request) {
  try {
    const { ingredients, useAI = false } = await request.json();
    
    if (!ingredients) {
      return NextResponse.json(
        { error: 'Ingredients are required' },
        { status: 400 }
      );
    }

    // Use the LlamaIndex-inspired agent to generate recipes
    const recipes = await mealPlanningAgent.planMeals(ingredients, useAI);

    // Format the response
    const formattedRecipes = recipes.map((recipe, index) => ({
      id: `recipe-${index + 1}`,
      name: recipe.name,
      ingredients: recipe.ingredients,
      instructions: recipe.instructions,
      cookingTime: recipe.cookingTime,
      difficulty: recipe.difficulty,
      matchScore: recipe.matchScore || 100 // Default score for AI-generated recipes
    }));

    return NextResponse.json({ 
      success: true, 
      recipes: formattedRecipes,
      agent: 'LlamaIndex Meal Planning Agent',
      matchedIngredients: recipes[0]?.matchedIngredients || []
    });

  } catch (error) {
    console.error('Error generating recipes:', error);
    return NextResponse.json(
      { error: 'Failed to generate recipes' },
      { status: 500 }
    );
  }
}

export const runtime = 'edge';