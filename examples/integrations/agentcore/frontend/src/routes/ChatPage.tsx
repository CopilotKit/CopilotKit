import CopilotChatInterface from "@/components/chat/CopilotKit";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { GlobalContextProvider } from "@/app/context/GlobalContext";

export default function ChatPage() {
  const { isAuthenticated, signIn } = useAuth();

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <p className="text-4xl">Please sign in</p>
        <Button onClick={() => signIn()}>Sign In</Button>
      </div>
    );
  }

  return (
    <GlobalContextProvider>
      <div className="relative h-screen">
        <CopilotChatInterface />
      </div>
    </GlobalContextProvider>
  );
}
