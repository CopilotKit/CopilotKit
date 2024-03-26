import { CopilotKit } from "@copilotkit/react-core";
import { CopilotSidebar, CopilotForm, CopilotInput } from "@copilotkit/react-ui";
import "./styles.css";

export default function FormDemo() {
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
        <div className="bg-white h-screen flex justify-center items-center">
          <CopilotForm
            name="recipe"
            description="Form to fill for a recipe"
            className="flex flex-col"
          >
            <CopilotInput name="dish" placeholder="dish" />
            <CopilotInput name="ingredients" placeholder="ingredients" />
          </CopilotForm>
        </div>
      </CopilotSidebar>
    </CopilotKit>
  );
}
