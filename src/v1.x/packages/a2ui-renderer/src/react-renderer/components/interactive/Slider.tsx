import { useState, useCallback, useEffect, useId, memo } from 'react';
import type { Types } from '@a2ui/lit/0.8';
import type { A2UIComponentProps } from '../../types';
import { useA2UIComponent } from '../../hooks/useA2UIComponent';
import { classMapToString, stylesToObject } from '../../lib/utils';

/**
 * Slider component - a numeric value selector with a range.
 *
 * Supports two-way data binding for the value.
 */
export const Slider = memo(function Slider({ node, surfaceId }: A2UIComponentProps<Types.SliderNode>) {
  const { theme, resolveNumber, resolveString, setValue, getValue } = useA2UIComponent(
    node,
    surfaceId
  );
  const props = node.properties;
  const id = useId();

  const valuePath = props.value?.path;
  const initialValue = resolveNumber(props.value) ?? 0;
  // Match Lit's default values (minValue=0, maxValue=0)
  const minValue = props.minValue ?? 0;
  const maxValue = props.maxValue ?? 0;

  const [value, setLocalValue] = useState(initialValue);

  // Sync with external data model changes (path binding)
  useEffect(() => {
    if (valuePath) {
      const externalValue = getValue(valuePath);
      if (externalValue !== null && Number(externalValue) !== value) {
        setLocalValue(Number(externalValue));
      }
    }
  }, [valuePath, getValue]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync when literal value changes from props (server-driven updates via surfaceUpdate)
  useEffect(() => {
    if (props.value?.literalNumber !== undefined) {
      setLocalValue(props.value.literalNumber);
    }
  }, [props.value?.literalNumber]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = Number(e.target.value);
      setLocalValue(newValue);

      // Two-way binding: update data model
      if (valuePath) {
        setValue(valuePath, newValue);
      }
    },
    [valuePath, setValue]
  );

  // Access label from props if it exists (Lit component supports it but type doesn't define it)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const labelValue = (props as any).label;
  const label = labelValue ? resolveString(labelValue) : '';

  // Structure mirrors Lit's Slider component:
  //   <div class="a2ui-slider">    ← :host equivalent
  //     <section class="...">      ← internal element
  //       <label>...</label>
  //       <input>...</input>
  //       <span>value</span>
  //     </section>
  //   </div>

  // Apply --weight CSS variable on root div (:host equivalent) for flex layouts
  const hostStyle: React.CSSProperties = node.weight !== undefined
    ? { '--weight': node.weight } as React.CSSProperties
    : {};

  return (
    <div className="a2ui-slider" style={hostStyle}>
      <section
        className={classMapToString(theme.components.Slider.container)}
      >
        <label
          htmlFor={id}
          className={classMapToString(theme.components.Slider.label)}
        >
          {label}
        </label>
        <input
          type="range"
          id={id}
          name="data"
          value={value}
          min={minValue}
          max={maxValue}
          onChange={handleChange}
          className={classMapToString(theme.components.Slider.element)}
          style={stylesToObject(theme.additionalStyles?.Slider)}
        />
        <span className={classMapToString(theme.components.Slider.label)}>
          {value}
        </span>
      </section>
    </div>
  );
});

export default Slider;
