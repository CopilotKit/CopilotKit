import React, { forwardRef, ChangeEvent, useEffect } from "react";
import { useCopilotFormContext } from "../../context/copilot-form-context"; // Adjust the import path as necessary

interface CopilotInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  name: string;
  description?: string;
  type?: string;
}

export const CopilotInput = forwardRef<HTMLInputElement, CopilotInputProps>((props, ref) => {
  props.type ||= "text";
  const { name, type, description, onChange, ...rest } = props;

  const { data, setData } = useCopilotFormContext(); // Using the context

  // Handler to update context data and call the original onChange if provided
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const { value } = event.target;
    // Update the form data in the context
    setData(name, { name, description, value, type: type || "text" });
    // If there's an original onChange prop, call it
    if (onChange) {
      onChange(event);
    }
  };

  // Effect to initialize the form data
  useEffect(() => {
    // Initialize the data with an empty value or default value if provided
    setData(name, { name, description, value: rest.defaultValue || "", type: type || "text" });
  }, [name, type, description]);

  const value = name in data ? data[name].value : "";

  return (
    <input {...rest} name={name} ref={ref} type={type} onChange={handleChange} value={value} />
  );
});
