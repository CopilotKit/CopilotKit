import { useCopilotAction, useMakeCopilotReadable } from "@copilotkit/react-core";
import { Parameter } from "@copilotkit/shared";
import React, { createContext, useContext, useState, ReactNode, ReactElement } from "react";

interface CopilotFormData {
  name: string;
  description?: string;
  value: any;
  type: React.InputHTMLAttributes<HTMLInputElement>["type"];
  values?: string[];
}

interface CopilotFormContextType {
  data: Record<string, CopilotFormData>;
  name: string;
  description?: string;
  setData: React.Dispatch<React.SetStateAction<Record<string, CopilotFormData>>>;
}

interface CopilotFormProviderProps {
  name: string;
  description?: string;
  onFill?: (args: any) => void;
  children: ReactNode;
}

export const CopilotFormContext = createContext<CopilotFormContextType | undefined>(undefined);

export const CopilotFormProvider: React.FC<CopilotFormProviderProps> = ({
  name,
  description,
  onFill,
  children,
}) => {
  const [data, setData] = useState<Record<string, CopilotFormData>>({});

  // convert parameters
  const parameters: Parameter[] = Object.values(data).map(formDataToParameter);
  console.log(parameters);

  useMakeCopilotReadable(`Form: ${name}\nData: ${JSON.stringify(data)}\n\n`);

  const actionName = `update_form_${name.replace(/ /g, "_").toLowerCase()}`;

  // register the action
  useCopilotAction({
    name: actionName,
    description: description,
    parameters,
    handler: (args) => {
      console.log(args);
      onFill?.(args);
      setData((prevData) => {
        const newData = { ...prevData };
        for (const key in args) {
          if (args.hasOwnProperty(key)) {
            newData[key] = { ...newData[key], value: args[key] };
          }
        }
        return newData;
      });
    },
  });

  const contextValue = {
    data,
    name,
    description,
    setData,
  };

  return <CopilotFormContext.Provider value={contextValue}>{children}</CopilotFormContext.Provider>;
};

export function useCopilotFormContext(): CopilotFormContextType {
  const context = useContext(CopilotFormContext);
  if (!context) {
    throw new Error("useCopilotFormContext must be used within a CopilotFormProvider");
  }
  return context;
}

export function formDataToParameter(data: CopilotFormData): Parameter {
  switch (data.type) {
    case "radio":
      return {
        name: data.name,
        type: "string",
        description: data.description,
        required: false,
        enum: data.values,
      };
    case "checkbox":
      return {
        name: data.name,
        type: "boolean",
        description: data.description,
        required: false,
      };
    default:
      return {
        name: data.name,
        type: "string",
        description: data.description,
        required: false,
      };
  }
}
