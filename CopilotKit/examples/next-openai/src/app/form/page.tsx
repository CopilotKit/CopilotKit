"use client";
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotSidebar, CopilotForm, CopilotInput } from "@copilotkit/react-ui";
import "./styles.css";
import { useState } from "react";

export default function FormDemo() {
  const [dish, setDish] = useState("spaghetti carbonara");
  return (
    <CopilotKit url="/api/copilotkit/openai">
      <CopilotSidebar
        instructions="Help the user fill a form"
        defaultOpen={true}
        labels={{
          title: "Form Copilot",
          initial: "Hi you! 👋 I can help you fill a form.",
        }}
        clickOutsideToClose={false}
      >
        <div className="bg-white h-screen flex justify-center items-center flex-col">
          <h2 className="text-2xl font-bold uppercase mb-10">{dish}</h2>
          <CopilotForm
            name="recipe"
            description="Form to fill for a recipe"
            className="flex flex-col border p-4 rounded-md shadow-md space-y-4 w-96"
          >
            <h1 className="text-2xl font-bold">Recipe Form</h1>
            <CopilotInput
              name="dish"
              placeholder="Name of the dish"
              type="text"
              value={dish}
              onChange={(e) => setDish(e.target.value)}
              className="p-2 border rounded-md"
            />
            <CopilotInput
              name="ingredients"
              placeholder="List of ingredients"
              type="text"
              className="p-2 border rounded-md"
              description="When this is empty, you mus provide the ingredients"
            />

            {/* <div>
              <label className="block">
                <CopilotInput name="dishType" type="radio" value="Vegetarian" className="mr-2" />
                Vegetarian
              </label>
              <label className="block">
                <CopilotInput
                  name="dishType"
                  type="radio"
                  value="Non-Vegetarian"
                  className="mr-2"
                />
                Non-Vegetarian
              </label>
              <label className="block">
                <CopilotInput name="dishType" type="radio" value="Vegan" className="mr-2" />
                Vegan
              </label>
            </div>

            <label>
              <CopilotInput
                name="isSpicy"
                type="checkbox"
                className="mr-2"
                description="When this is checked, you must make the ingredients spicy"
              />
              Spicy
            </label> */}
          </CopilotForm>
        </div>
      </CopilotSidebar>
    </CopilotKit>
  );
}
