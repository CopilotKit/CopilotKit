import { useState, useCallback, useEffect, useId, memo } from 'react';
import type { Types } from '@a2ui/lit/0.8';
import type { A2UIComponentProps } from '../../types';
import { useA2UIComponent } from '../../hooks/useA2UIComponent';
import { classMapToString, stylesToObject } from '../../lib/utils';

type TextFieldType = 'shortText' | 'longText' | 'number' | 'date';

/**
 * TextField component - an input field for text entry.
 *
 * Supports various input types and two-way data binding.
 */
export const TextField = memo(function TextField({ node, surfaceId }: A2UIComponentProps<Types.TextFieldNode>) {
  const { theme, resolveString, setValue, getValue } = useA2UIComponent(node, surfaceId);
  const props = node.properties;
  const id = useId();

  const label = resolveString(props.label);
  const textPath = props.text?.path;
  const initialValue = resolveString(props.text) ?? '';
  const fieldType = props.type as TextFieldType | undefined;
  const validationRegexp = props.validationRegexp;

  const [value, setLocalValue] = useState(initialValue);
  // Validation state tracked for potential future use (e.g., error styling)
  const [_isValid, setIsValid] = useState(true);

  // Sync with external data model changes
  useEffect(() => {
    if (textPath) {
      const externalValue = getValue(textPath);
      if (externalValue !== null && String(externalValue) !== value) {
        setLocalValue(String(externalValue));
      }
    }
  }, [textPath, getValue]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      setLocalValue(newValue);

      // Validate if pattern provided
      if (validationRegexp) {
        setIsValid(new RegExp(validationRegexp).test(newValue));
      }

      // Two-way binding: update data model
      if (textPath) {
        setValue(textPath, newValue);
      }
    },
    [validationRegexp, textPath, setValue]
  );

  const inputType =
    fieldType === 'number'
      ? 'number'
      : fieldType === 'date'
        ? 'date'
        : 'text';
  const isTextArea = fieldType === 'longText';

  // Structure mirrors Lit's TextField component:
  //   <div class="a2ui-textfield">  ← :host equivalent
  //     <section class="...">       ← container with theme classes
  //       <label>...</label>
  //       <input>...</input>
  //     </section>
  //   </div>

  // Apply --weight CSS variable on root div (:host equivalent) for flex layouts
  const hostStyle: React.CSSProperties = node.weight !== undefined
    ? { '--weight': node.weight } as React.CSSProperties
    : {};

  return (
    <div className="a2ui-textfield" style={hostStyle}>
      <section className={classMapToString(theme.components.TextField.container)}>
        {label && (
          <label
            htmlFor={id}
            className={classMapToString(theme.components.TextField.label)}
          >
            {label}
          </label>
        )}
        {isTextArea ? (
          <textarea
            id={id}
            value={value}
            onChange={handleChange}
            placeholder="Please enter a value"
            className={classMapToString(theme.components.TextField.element)}
            style={stylesToObject(theme.additionalStyles?.TextField)}
          />
        ) : (
          <input
            type={inputType}
            id={id}
            value={value}
            onChange={handleChange}
            placeholder="Please enter a value"
            className={classMapToString(theme.components.TextField.element)}
            style={stylesToObject(theme.additionalStyles?.TextField)}
          />
        )}
      </section>
    </div>
  );
});

export default TextField;
