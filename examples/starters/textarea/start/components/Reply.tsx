import { useEmails } from "@/lib/hooks/use-emails";
import { useState } from "react";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";

export function Reply() {
  const { sendEmail } = useEmails();
  const [input, setInput] = useState("");

  const handleReply = () => {
    console.log(input);
    sendEmail({
      body: input,
    });
    setInput("");
  };

  return (
    <div className="mt-4 pt-4 space-y-2 bg-background p-4 rounded-md border">
      <Textarea value={input} onChange={(e) => setInput(e.target.value)} />
      <Button disabled={!input} onClick={handleReply}>
        Reply
      </Button>
    </div>
  );
}
