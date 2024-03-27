import React, { forwardRef } from "react";
import { CopilotFormProvider } from "../../context/copilot-form-context";

interface CopilotFormProps extends React.HTMLProps<HTMLFormElement> {
  name: string;
  description?: string;
  children: React.ReactNode;
  onFill?: (args: any) => void;
}

export const CopilotForm = forwardRef<HTMLFormElement, CopilotFormProps>(
  ({ name, description, onFill, children, ...rest }, ref) => {
    return (
      <CopilotFormProvider name={name} description={description} onFill={onFill}>
        <form ref={ref} {...rest}>
          {children}
        </form>
      </CopilotFormProvider>
    );
  },
);
