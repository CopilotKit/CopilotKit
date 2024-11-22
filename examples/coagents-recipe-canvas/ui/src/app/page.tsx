import { CopilotPopup } from "@copilotkit/react-ui";

export default function Home() {
  return (
    <div className="grid grid-rows-[20px_1fr_20px] items-center justify-items-center min-h-screen p-8 pb-20 gap-16 sm:p-20 font-[family-name:var(--font-geist-sans)]">
      <CopilotPopup
        instructions={
          "You are a recipe assistant. You are given a recipe and you need to help the user create a recipe canvas."
        }
        labels={{
          title: "What's for dinner?",
          initial: "What do you want to cook?",
        }}
      />
    </div>
  );
}
