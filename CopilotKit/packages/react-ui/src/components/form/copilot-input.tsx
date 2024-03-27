import React, { forwardRef, ChangeEvent, useEffect } from "react";
import { useCopilotFormContext } from "../../context/copilot-form-context";

interface CopilotInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  name: string;
  description?: string;
  type?: string;
}

export const CopilotInput = forwardRef<HTMLInputElement, CopilotInputProps>((props, ref) => {
  const { name, type = "text", description, onChange, ...rest } = props;

  const { data, setData } = useCopilotFormContext();

  const getInitialValue = () => {
    switch (type) {
      case "radio":
      case "checkbox":
        return rest.defaultChecked ?? false;
      default:
        return rest.defaultValue || "";
    }
  };

  const getInputValue = (event: ChangeEvent<HTMLInputElement>) => {
    switch (type) {
      case "checkbox":
        return event.target.checked;
      case "radio":
      default:
        return event.target.value;
    }
  };

  const getInputProps = () => {
    switch (type) {
      case "checkbox":
        return { checked: !!data[name]?.value };
      case "radio":
        return { checked: data[name]?.value === rest.value };
      default:
        return { value: data[name]?.value ?? "" };
    }
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    // For radio buttons, update the data only if the button is checked
    if (type !== "radio" || event.target.checked) {
      setData((prevData) => ({
        ...prevData,
        [name]: { name, description, value: getInputValue(event), type: type },
      }));
    }

    // If there's an original onChange prop, call it
    if (onChange) {
      onChange(event);
    }
  };

  // Initialize the data
  useEffect(() => {
    if (type === "radio" && rest.value) {
      setData((prevData) => {
        const newData = prevData[name] || { name, description, type: type, values: [] };
        if (!newData.description) {
          newData.description = description;
        }
        if (!newData.values?.includes(rest.value as string)) {
          newData.values!.push(rest.value as string);
        }
        if (getInitialValue()) {
          newData.value = rest.value as string;
        }
        return { ...prevData, [name]: newData };
      });
    } else {
      setData((prevData) => ({
        ...prevData,
        [name]: { name, description, value: getInitialValue(), type: type },
      }));
    }

    return () => {
      if (type !== "radio") {
        setData((prevData) => {
          const newData = { ...prevData };
          delete newData[name];
          return newData;
        });
      } else {
        setData((prevData) => {
          const newData = { ...prevData };
          const radioData = newData[name];
          radioData.values = radioData.values?.filter((value) => value !== rest.value);
          if (radioData.values?.length === 0) {
            delete newData[name];
          } else {
            newData[name] = radioData;
          }
          return newData;
        });
      }
    };
  }, [name, type]);

  return (
    <input
      {...rest}
      name={name}
      ref={ref}
      type={type}
      onChange={handleChange}
      {...getInputProps()}
    />
  );
});
