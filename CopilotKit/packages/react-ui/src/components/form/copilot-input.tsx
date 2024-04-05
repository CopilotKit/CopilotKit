import React, { forwardRef, ChangeEvent, useEffect } from "react";
import { useCopilotFormContext } from "../../context/copilot-form-context";
import { TextualInput } from "./textual-input";

export interface CopilotInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  name: string;
  description?: string;
  type?: string;
}

/**
 * A CopilotInput is a semi-controlled input component can intelligently complete, suggest, and
 * validate user input.
 */
export const CopilotInput = forwardRef<HTMLInputElement, CopilotInputProps>((props, ref) => {
  switch (props.type) {
    // case "radio":
    //   return <RadioInput {...props} ref={ref} />;
    // case "checkbox":
    //   return <CheckboxInput {...props} ref={ref} />;
    case "text":
    case "password":
    case "email":
    case "search":
    case "url":
    case "tel":
    case "datetime-local":
    case "date":
    case "month":
    case "week":
    case "time":
    case "number":
    case "color":
      return <TextualInput {...props} ref={ref} />;
    default:
      throw new Error(`Unsupported input type: ${props.type}`);
  }
});

// const RadioInput = forwardRef<HTMLInputElement, CopilotInputProps>((props, ref) => {
//   const { name, description, onChange, ...rest } = props;
//   const { data, setData } = useCopilotFormContext();
//   useEffect(() => {
//     if (rest.value) {
//       setData((prevData) => {
//         const newData = prevData[name] || { name, description, type: "radio", values: [] };
//         if (!newData.description) {
//           newData.description = description;
//         }
//         if (!newData.values?.includes(rest.value as string)) {
//           newData.values!.push(rest.value as string);
//         }
//         if (rest.defaultChecked ?? false) {
//           newData.value = rest.value as string;
//         }
//         return { ...prevData, [name]: newData };
//       });
//     } else {
//       setData((prevData) => ({
//         ...prevData,
//         [name]: { name, description, value: rest.defaultChecked ?? false, type: "radio" },
//       }));
//     }

//     return () => {
//       setData((prevData) => {
//         const newData = { ...prevData };
//         const radioData = newData[name];
//         radioData.values = radioData.values?.filter((value) => value !== rest.value);
//         if (radioData.values?.length === 0) {
//           delete newData[name];
//         } else {
//           newData[name] = radioData;
//         }
//         return newData;
//       });
//     };
//   }, [name]);

//   return (
//     <input
//       {...rest}
//       name={name}
//       ref={ref}
//       type="radio"
//       onChange={(event: ChangeEvent<HTMLInputElement>) => {
//         if (event.target.checked) {
//           setData((prevData) => ({
//             ...prevData,
//             [name]: { name, description, value: event.target.value, type: "radio" },
//           }));
//         }
//         onChange?.(event);
//       }}
//       checked={data[name]?.value === rest.value}
//     />
//   );
// });

// const CheckboxInput = forwardRef<HTMLInputElement, CopilotInputProps>((props, ref) => {
//   const { name, description, onChange, ...rest } = props;
//   const { data, setData } = useCopilotFormContext();
//   useEffect(() => {
//     setData((prevData) => ({
//       ...prevData,
//       [name]: { name, description, value: rest.defaultChecked ?? false, type: "checkbox" },
//     }));

//     return () => {
//       setData((prevData) => {
//         const newData = { ...prevData };
//         delete newData[name];
//         return newData;
//       });
//     };
//   }, [name]);

//   return (
//     <input
//       {...rest}
//       name={name}
//       ref={ref}
//       type="checkbox"
//       onChange={(event: ChangeEvent<HTMLInputElement>) => {
//         setData((prevData) => ({
//           ...prevData,
//           [name]: { name, description, value: event.target.checked, type: "checkbox" },
//         }));
//         onChange?.(event);
//       }}
//       checked={!!data[name]?.value}
//     />
//   );
// });
