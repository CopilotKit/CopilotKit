## 🚀 **AI Meal Planner & Recipe Generator**

### 📝 **Intelligent Ingredient to Recipe Assistant**

This project tackles the everyday problem of deciding *what to cook* with the ingredients you already have.  
It allows users to **add ingredients manually or using CopilotKit AI commands**, and instantly generates **3–5 structured recipes** that match the provided items.  
Each recipe is beautifully displayed as a card with title, description, ingredients, steps, time, calories, and tags.


### 🛠️ **Technologies Being Used**

List of technologies, tools, and frameworks powering this project:

- **Frameworks**: Next.js 14, React 18  
- **Styling**: Tailwind CSS, Radix-UI, Glassmorphism effects  
- **AI Runtime**: Copilot Cloud Runtime (Direct LLM Calls)  
- **Developer Tools**: CopilotKit UI (`@copilotkit/react-ui`, `@copilotkit/react-core`)  
- **Language**: TypeScript  


### 🌐 **App Link**

[Meal Planner](https://meal-planner-y2p3.onrender.com/)


### 🎯 **Twitter Post**
[Post](https://x.com/RajG0709/status/1974904870244327813)

### 📸 **Screenshot**

<img width="1348" height="598" alt="Screenshot 2025-10-05 202245" src="https://github.com/user-attachments/assets/11d6bbb0-6463-4f2e-8261-0cffe780f121" />



### 🙋‍♂️ **List your repo here**

[GitHub Repository](https://github.com/Raj-G07/Meal-Planner)

### 🍽️ **Core Functionality**

1. **Add Ingredients**
   - Add items manually (like *tomato, cheese, pasta*)  
   - Or use CopilotKit to generate ingredients via natural prompts

2. **Generate Recipes**
   - AI suggests 3–5 recipes matching your ingredients.
   - Each recipe strictly follows this JSON schema:
     ```json
     {
       "title": "string",
       "description": "string",
       "ingredientsUsed": [],
       "missingIngredients": [],
       "steps": [],
       "timeMinutes": 0,
       "tags": [],
       "calories": 0
     }
     
     ```

3. **View Recipe Cards**
   - Recipes appear instantly as interactive cards  
   - Includes cooking steps, total time, tags, and calorie estimate.


**Created by [Raj Gupta](https://github.com/Raj-G07)**  
