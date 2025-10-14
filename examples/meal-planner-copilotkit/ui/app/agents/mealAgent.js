import { OpenAI } from 'openai';

// Initialize OpenAI (you'll need to set OPENAI_API_KEY in environment variables)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'dummy-key-for-demo', // In production, use environment variables
});

// Recipe database for LlamaIndex to work with
const recipeDatabase = [
  {
    name: "Vegetable Stir Fry",
    ingredients: ["rice", "mixed vegetables", "soy sauce", "garlic", "ginger", "onion"],
    instructions: ["Cook rice according to package instructions", "Chop vegetables and aromatics", "Heat oil in a wok", "Stir fry vegetables until crisp-tender", "Add soy sauce and serve over rice"],
    cookingTime: 20,
    difficulty: "Easy",
    tags: ["vegetarian", "quick", "asian"]
  },
  {
    name: "Chicken Curry",
    ingredients: ["chicken", "onion", "garlic", "curry powder", "coconut milk", "rice"],
    instructions: ["Cook rice", "Dice chicken and chop onions", "Sauté onions and garlic", "Brown chicken pieces", "Add curry powder", "Pour coconut milk and simmer", "Serve over rice"],
    cookingTime: 40,
    difficulty: "Medium",
    tags: ["poultry", "spicy", "asian"]
  },
  {
    name: "Pasta with Tomato Sauce",
    ingredients: ["pasta", "tomatoes", "garlic", "olive oil", "basil", "onion"],
    instructions: ["Cook pasta", "Chop tomatoes and aromatics", "Sauté garlic and onion", "Add tomatoes and cook", "Stir in basil", "Toss with pasta and serve"],
    cookingTime: 25,
    difficulty: "Easy",
    tags: ["vegetarian", "italian", "pasta"]
  },
  {
    name: "Bean Burritos",
    ingredients: ["tortillas", "beans", "cheese", "salsa", "avocado", "rice"],
    instructions: ["Cook rice", "Heat beans", "Warm tortillas", "Assemble burritos", "Add toppings", "Roll and serve"],
    cookingTime: 15,
    difficulty: "Easy",
    tags: ["vegetarian", "mexican", "quick"]
  },
  {
    name: "Omelette",
    ingredients: ["eggs", "cheese", "milk", "butter", "vegetables"],
    instructions: ["Beat eggs with milk", "Chop vegetables", "Melt butter in pan", "Pour eggs and cook", "Add fillings", "Fold and serve"],
    cookingTime: 10,
    difficulty: "Easy",
    tags: ["breakfast", "quick", "protein"]
  }
];

// LlamaIndex-inspired recipe matching agent
export class MealPlanningAgent {
  constructor() {
    this.recipes = recipeDatabase;
  }

  // Simple semantic matching using keyword analysis
  findMatchingRecipes(ingredients) {
    const userIngredients = ingredients.toLowerCase().split(/[,.\s]+/).filter(Boolean);
    
    const scoredRecipes = this.recipes.map(recipe => {
      const recipeText = [
        recipe.name,
        ...recipe.ingredients,
        ...recipe.tags,
        recipe.difficulty
      ].join(' ').toLowerCase();
      
      // Calculate match score based on ingredient overlap
      const matchCount = userIngredients.filter(ingredient => 
        recipeText.includes(ingredient)
      ).length;
      
      const score = (matchCount / userIngredients.length) * 100;
      
      return {
        ...recipe,
        matchScore: score,
        matchedIngredients: userIngredients.filter(ing => recipeText.includes(ing))
      };
    });

    // Filter and sort by match score
    return scoredRecipes
      .filter(recipe => recipe.matchScore > 0)
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, 3); // Return top 3 matches
  }

  // AI-powered recipe generation using OpenAI
  async generateRecipesWithAI(ingredients, context = "") {
    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: `You are a creative chef AI. Generate recipe suggestions based on available ingredients.
            Return valid JSON in this format:
            {
              "recipes": [
                {
                  "name": "Recipe Name",
                  "ingredients": ["ing1", "ing2"],
                  "instructions": ["step1", "step2"],
                  "cookingTime": 30,
                  "difficulty": "Easy|Medium|Hard"
                }
              ]
            }`
          },
          {
            role: "user",
            content: `Available ingredients: ${ingredients}. ${context}`
          }
        ],
      });

      const content = completion.choices[0]?.message?.content;
      if (content) {
        return JSON.parse(content).recipes;
      }
    } catch (error) {
      console.error('AI recipe generation failed:', error);
      // Fallback to our matching algorithm
      return this.findMatchingRecipes(ingredients);
    }
  }

  // Main agent method
  async planMeals(ingredients, useAI = false) {
    if (useAI) {
      return await this.generateRecipesWithAI(ingredients);
    } else {
      return this.findMatchingRecipes(ingredients);
    }
  }
}

export const mealPlanningAgent = new MealPlanningAgent();