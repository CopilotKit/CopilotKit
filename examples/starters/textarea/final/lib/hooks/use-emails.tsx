import { createContext, useContext, useState, ReactNode } from "react";
import { Email } from "../emails.types";
import emailHistory from "./email-history.json";
import { useCopilotReadable } from "@copilotkit/react-core";

type EmailsContextType = {
  emails: Email[];
  sendEmail: ({
    body
  }: {
    body: string;
  }) => void;
};

const EmailsContext = createContext<EmailsContextType | undefined>(undefined);

export const EmailsProvider = ({ children }: { children: ReactNode }) => {
  const [emails, setEmails] = useState<Email[]>(emailHistory);

  useCopilotReadable({
    description: "The full history of this email thread",
    value: emails,
  });

  const sendEmail = ({
    body
  }: {
    body: string;
  }) => {
    const email = {
      from: "me",
      to: "John Doe <john@acme.com>",
      body,
      timestamp: new Date().toISOString(),
    };
    setEmails([...emails, email]);
  };

  return (
    <EmailsContext.Provider
      value={{ emails, sendEmail }}
    >
      {children}
    </EmailsContext.Provider>
  );
};

export const useEmails = () => {
  const context = useContext(EmailsContext);
  if (context === undefined) {
    throw new Error("useEmails must be used within a EmailsProvider");
  }
  return context;
};
