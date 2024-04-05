import { ChangeEvent, forwardRef, useEffect } from "react";
import { useCopilotFormContext } from "../../context/copilot-form-context";
import { CopilotInputProps } from "./copilot-input";

export const TextualInput = forwardRef<HTMLInputElement, CopilotInputProps>((props, ref) => {
  const { name, description, value: controlledValue, onChange, ...rest } = props;
  const { data, setData } = useCopilotFormContext();
  const type = props.type || "text";

  // Initialize the data object with the default value
  useEffect(() => {
    const defaultValue = rest.defaultValue || "";

    setData((prevData) => {
      const prevObject = prevData[name];

      // no previous entry, create a new one
      if (!prevObject) {
        return {
          ...prevData,
          [name]: { name, description, type, value: controlledValue || defaultValue },
        };
      }
      // if the controlled value is different from the previous value, update the value
      else if (prevObject.value !== controlledValue && controlledValue !== undefined) {
        return {
          ...prevData,
          [name]: { ...prevObject, description, type, value: controlledValue },
        };
      }
      // else, update the description and type
      else {
        return {
          ...prevData,
          [name]: { ...prevObject, description, type },
        };
      }
    });

    return () => {
      // Remove the data object when the component is unmounted
      setData((prevData) => {
        const newData = { ...prevData };
        delete newData[name];
        return newData;
      });
    };
  }, [name, type, description, controlledValue]);

  return (
    <input
      {...rest}
      name={name}
      ref={ref}
      type={type}
      onChange={(event: ChangeEvent<HTMLInputElement>) => {
        setData((prevData) => ({
          ...prevData,
          [name]: { name, description, value: event.target.value, type },
        }));
        onChange?.(event);
      }}
      value={data[name]?.value}
    />
  );
});
