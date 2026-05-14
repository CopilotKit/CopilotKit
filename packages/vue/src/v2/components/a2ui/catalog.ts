/**
 * Vue basic catalog for A2UI v0.9.
 *
 * Provides Vue component implementations for all 18 basic catalog components,
 * mirroring the React renderer's catalog/basic/.
 */

import { h, ref, type CSSProperties, type VNode } from "vue";
import { Catalog } from "@a2ui/web_core/v0_9";
import {
  TextApi,
  ImageApi,
  IconApi,
  VideoApi,
  AudioPlayerApi,
  RowApi,
  ColumnApi,
  ListApi,
  CardApi,
  TabsApi,
  DividerApi,
  ModalApi,
  ButtonApi,
  TextFieldApi,
  CheckBoxApi,
  ChoicePickerApi,
  SliderApi,
  DateTimeInputApi,
  BASIC_FUNCTIONS,
} from "@a2ui/web_core/v0_9/basic_catalog";

import { createVueComponent, type VueComponentImplementation } from "./adapter";
import {
  LEAF_MARGIN,
  STANDARD_BORDER,
  STANDARD_RADIUS,
  getBaseLeafStyle,
  getBaseContainerStyle,
  mapJustify,
  mapAlign,
} from "./utils";

// -- Helper: render a child list (arrays of { id, basePath } or string IDs) --
function renderChildList(
  childList: unknown,
  buildChild: (id: string, basePath?: string) => VNode,
): VNode[] {
  if (!Array.isArray(childList)) return [];
  return childList
    .map((item: unknown) => {
      if (item && typeof item === "object" && "id" in item) {
        const node = item as { id: string; basePath?: string };
        return buildChild(node.id, node.basePath);
      }
      if (typeof item === "string") {
        return buildChild(item);
      }
      return null;
    })
    .filter((v): v is VNode => v !== null);
}

// -- Unique ID counter for form elements --
let a2uiIdCounter = 0;
function useA2UIUniqueId(): string {
  return `a2ui-vue-${++a2uiIdCounter}`;
}

// ============================================================
// Component Implementations
// ============================================================

const Text = createVueComponent(TextApi, ({ props }) => {
  const text = props.text ?? "";
  const style = { ...getBaseLeafStyle(), display: "inline-block" };

  switch (props.variant) {
    case "h1":
      return h("h1", { style }, text);
    case "h2":
      return h("h2", { style }, text);
    case "h3":
      return h("h3", { style }, text);
    case "h4":
      return h("h4", { style }, text);
    case "h5":
      return h("h5", { style }, text);
    case "caption":
      return h(
        "small",
        { style: { ...style, color: "#666", textAlign: "left" } },
        text,
      );
    case "body":
    default:
      return h("span", { style }, text);
  }
});

const Image = createVueComponent(ImageApi, ({ props }) => {
  const mapFit = (fit?: string): string => {
    if (fit === "scaleDown") return "scale-down";
    return fit || "fill";
  };

  const style: CSSProperties = {
    ...getBaseLeafStyle(),
    objectFit: mapFit(props.fit) as CSSProperties["objectFit"],
    width: "100%",
    height: "auto",
    display: "block",
  };

  if (props.variant === "icon") {
    style.width = "24px";
    style.height = "24px";
  } else if (props.variant === "avatar") {
    style.width = "40px";
    style.height = "40px";
    style.borderRadius = "50%";
  } else if (props.variant === "smallFeature") {
    style.maxWidth = "100px";
  } else if (props.variant === "largeFeature") {
    style.maxHeight = "400px";
  } else if (props.variant === "header") {
    style.height = "200px";
    style.objectFit = "cover";
  }

  return h("img", { src: props.url, alt: props.description || "", style });
});

const Icon = createVueComponent(IconApi, ({ props }) => {
  const iconName =
    typeof props.name === "string"
      ? props.name
      : (props.name as { path?: string })?.path;
  const style = {
    ...getBaseLeafStyle(),
    fontSize: "24px",
    width: "24px",
    height: "24px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  };

  return h("span", { class: "material-symbols-outlined", style }, iconName);
});

const Video = createVueComponent(VideoApi, ({ props }) => {
  const style = {
    ...getBaseLeafStyle(),
    width: "100%",
    aspectRatio: "16/9",
  };

  return h("video", { src: props.url, controls: true, style });
});

const AudioPlayer = createVueComponent(AudioPlayerApi, ({ props }) => {
  const style = { ...getBaseLeafStyle(), width: "100%" };

  return h(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        width: "100%",
      },
    },
    [
      props.description
        ? h(
            "span",
            { style: { fontSize: "12px", color: "#666" } },
            props.description,
          )
        : null,
      h("audio", { src: props.url, controls: true, style }),
    ],
  );
});

const Row = createVueComponent(RowApi, ({ props, buildChild }) => {
  return h(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "row",
        justifyContent: mapJustify(props.justify),
        alignItems: mapAlign(props.align),
        width: "100%",
        margin: "0",
        padding: "0",
      },
    },
    renderChildList(props.children, buildChild),
  );
});

const Column = createVueComponent(ColumnApi, ({ props, buildChild }) => {
  return h(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        justifyContent: mapJustify(props.justify),
        alignItems: mapAlign(props.align),
        width: "100%",
        margin: "0",
        padding: "0",
      },
    },
    renderChildList(props.children, buildChild),
  );
});

const List = createVueComponent(ListApi, ({ props, buildChild }) => {
  const isHorizontal = props.direction === "horizontal";
  const style = {
    display: "flex",
    flexDirection: isHorizontal ? ("row" as const) : ("column" as const),
    alignItems: mapAlign(props.align),
    overflowX: isHorizontal ? ("auto" as const) : ("hidden" as const),
    overflowY: isHorizontal ? ("hidden" as const) : ("auto" as const),
    width: "100%",
    margin: "0",
    padding: "0",
  };

  return h("div", { style }, renderChildList(props.children, buildChild));
});

const Card = createVueComponent(CardApi, ({ props, buildChild }) => {
  const style = {
    ...getBaseContainerStyle(),
    backgroundColor: "#fff",
    boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
    width: "100%",
  };

  return h("div", { style }, [props.child ? buildChild(props.child) : null]);
});

const Tabs = createVueComponent(
  TabsApi,
  ({ props, buildChild, state }) => {
    const tabs = props.tabs || [];

    return h(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          width: "100%",
          margin: LEAF_MARGIN,
        },
      },
      [
        h(
          "div",
          {
            style: {
              display: "flex",
              borderBottom: "1px solid #ccc",
              marginBottom: "8px",
            },
          },
          tabs.map((tab, i: number) => {
            const title =
              typeof tab.title === "string"
                ? tab.title
                : String(tab.title ?? "");
            return h(
              "button",
              {
                key: i,
                onClick: () => {
                  state.selectedIndex.value = i;
                },
                style: {
                  padding: "8px 16px",
                  border: "none",
                  background: "none",
                  borderBottom:
                    state.selectedIndex.value === i
                      ? "2px solid var(--a2ui-primary-color, #007bff)"
                      : "none",
                  fontWeight:
                    state.selectedIndex.value === i ? "bold" : "normal",
                  cursor: "pointer",
                  color:
                    state.selectedIndex.value === i
                      ? "var(--a2ui-primary-color, #007bff)"
                      : "inherit",
                },
              },
              title,
            );
          }),
        ),
        h("div", { style: { flex: "1" } }, [
          tabs[state.selectedIndex.value]?.child
            ? buildChild(tabs[state.selectedIndex.value]!.child)
            : null,
        ]),
      ],
    );
  },
  () => ({ selectedIndex: ref(0) }),
);

const Divider = createVueComponent(DividerApi, ({ props }) => {
  const isVertical = props.axis === "vertical";
  const style: Record<string, string> = {
    margin: LEAF_MARGIN,
    border: "none",
    backgroundColor: "#ccc",
  };

  if (isVertical) {
    style.width = "1px";
    style.height = "100%";
  } else {
    style.width = "100%";
    style.height = "1px";
  }

  return h("div", { style });
});

const Modal = createVueComponent(
  ModalApi,
  ({ props, buildChild, state }) => {
    return h("div", {}, [
      h(
        "div",
        {
          onClick: () => {
            state.isOpen.value = true;
          },
          style: { display: "inline-block" },
        },
        [props.trigger ? buildChild(props.trigger) : null],
      ),
      state.isOpen.value
        ? h(
            "div",
            {
              style: {
                position: "fixed",
                top: "0",
                left: "0",
                right: "0",
                bottom: "0",
                backgroundColor: "rgba(0,0,0,0.5)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: "1000",
              },
              onClick: () => {
                state.isOpen.value = false;
              },
            },
            [
              h(
                "div",
                {
                  style: {
                    backgroundColor: "#fff",
                    padding: "24px",
                    borderRadius: "8px",
                    maxWidth: "90%",
                    maxHeight: "90%",
                    overflow: "auto",
                    display: "flex",
                    flexDirection: "column",
                  },
                  onClick: (e: Event) => e.stopPropagation(),
                },
                [
                  h(
                    "div",
                    { style: { display: "flex", justifyContent: "flex-end" } },
                    [
                      h(
                        "button",
                        {
                          onClick: () => {
                            state.isOpen.value = false;
                          },
                          style: {
                            border: "none",
                            background: "none",
                            fontSize: "20px",
                            cursor: "pointer",
                            padding: "4px",
                          },
                        },
                        "\u00D7",
                      ),
                    ],
                  ),
                  h("div", { style: { flex: "1" } }, [
                    props.content ? buildChild(props.content) : null,
                  ]),
                ],
              ),
            ],
          )
        : null,
    ]);
  },
  () => ({ isOpen: ref(false) }),
);

const Button = createVueComponent(ButtonApi, ({ props, buildChild }) => {
  const style = {
    margin: LEAF_MARGIN,
    padding: "8px 16px",
    cursor: "pointer",
    border: props.variant === "borderless" ? "none" : "1px solid #ccc",
    backgroundColor:
      props.variant === "primary"
        ? "var(--a2ui-primary-color, #007bff)"
        : props.variant === "borderless"
          ? "transparent"
          : "#fff",
    color: props.variant === "primary" ? "#fff" : "inherit",
    borderRadius: "4px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box",
  };

  return h(
    "button",
    {
      style,
      onClick: props.action,
      disabled: props.isValid === false,
    },
    [props.child ? buildChild(props.child) : null],
  );
});

const TextField = createVueComponent(
  TextFieldApi,
  ({ props, state }) => {
    const uniqueId = state.id;
    const isLong = props.variant === "longText";
    const type =
      props.variant === "number"
        ? "number"
        : props.variant === "obscured"
          ? "password"
          : "text";

    const inputStyle = {
      padding: "8px",
      width: "100%",
      border:
        props.validationErrors && props.validationErrors.length > 0
          ? "1px solid red"
          : STANDARD_BORDER,
      borderRadius: STANDARD_RADIUS,
      boxSizing: "border-box",
    };

    const hasError =
      props.validationErrors && props.validationErrors.length > 0;

    return h(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          gap: "4px",
          width: "100%",
          margin: LEAF_MARGIN,
        },
      },
      [
        props.label
          ? h(
              "label",
              {
                for: uniqueId,
                style: { fontSize: "14px", fontWeight: "bold" },
              },
              props.label,
            )
          : null,
        isLong
          ? h("textarea", {
              id: uniqueId,
              style: inputStyle,
              value: props.value || "",
              onInput: (e: Event) =>
                props.setValue((e.target as HTMLTextAreaElement).value),
            })
          : h("input", {
              id: uniqueId,
              type,
              style: inputStyle,
              value: props.value || "",
              onInput: (e: Event) =>
                props.setValue((e.target as HTMLInputElement).value),
            }),
        hasError
          ? h(
              "span",
              { style: { fontSize: "12px", color: "red" } },
              props.validationErrors![0],
            )
          : null,
      ],
    );
  },
  () => ({ id: useA2UIUniqueId() }),
);

const CheckBox = createVueComponent(
  CheckBoxApi,
  ({ props, state }) => {
    const uniqueId = state.id;
    const hasError =
      props.validationErrors && props.validationErrors.length > 0;

    return h(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          margin: LEAF_MARGIN,
        },
      },
      [
        h(
          "div",
          { style: { display: "flex", alignItems: "center", gap: "8px" } },
          [
            h("input", {
              id: uniqueId,
              type: "checkbox",
              checked: !!props.value,
              onChange: (e: Event) =>
                props.setValue((e.target as HTMLInputElement).checked),
              style: {
                cursor: "pointer",
                outline: hasError ? "1px solid red" : "none",
              },
            }),
            props.label
              ? h(
                  "label",
                  {
                    for: uniqueId,
                    style: {
                      cursor: "pointer",
                      color: hasError ? "red" : "inherit",
                    },
                  },
                  props.label,
                )
              : null,
          ],
        ),
        hasError
          ? h(
              "span",
              {
                style: { fontSize: "12px", color: "red", marginTop: "4px" },
              },
              props.validationErrors?.[0],
            )
          : null,
      ],
    );
  },
  () => ({ id: useA2UIUniqueId() }),
);

const ChoicePicker = createVueComponent(
  ChoicePickerApi,
  ({ props, context, state }) => {
    const values = Array.isArray(props.value) ? props.value : [];
    const isMutuallyExclusive = props.variant === "mutuallyExclusive";

    const onToggle = (val: string) => {
      if (isMutuallyExclusive) {
        props.setValue([val]);
      } else {
        const newValues = values.includes(val)
          ? values.filter((v: string) => v !== val)
          : [...values, val];
        props.setValue(newValues);
      }
    };

    type ChoiceOption = {
      label?: string | Record<string, unknown>;
      value: string;
    };
    const options = (props.options || []).filter(
      (opt: ChoiceOption) =>
        !props.filterable ||
        state.filter.value === "" ||
        String(typeof opt.label === "string" ? opt.label : "")
          .toLowerCase()
          .includes(state.filter.value.toLowerCase()),
    );

    return h(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          margin: LEAF_MARGIN,
          width: "100%",
        },
      },
      [
        props.label
          ? h("strong", { style: { fontSize: "14px" } }, props.label)
          : null,
        props.filterable
          ? h("input", {
              type: "text",
              placeholder: "Filter options...",
              value: state.filter.value,
              onInput: (e: Event) => {
                state.filter.value = (e.target as HTMLInputElement).value;
              },
              style: {
                padding: "4px 8px",
                border: STANDARD_BORDER,
                borderRadius: STANDARD_RADIUS,
              },
            })
          : null,
        h(
          "div",
          {
            style: {
              display: "flex",
              flexDirection: props.displayStyle === "chips" ? "row" : "column",
              flexWrap: props.displayStyle === "chips" ? "wrap" : "nowrap",
              gap: "8px",
            },
          },
          options.map((opt: ChoiceOption, i: number) => {
            const isSelected = values.includes(opt.value);
            const label =
              typeof opt.label === "string"
                ? opt.label
                : String(opt.label ?? opt.value);
            if (props.displayStyle === "chips") {
              return h(
                "button",
                {
                  key: i,
                  onClick: () => onToggle(opt.value),
                  style: {
                    padding: "4px 12px",
                    borderRadius: "16px",
                    border: isSelected
                      ? "1px solid var(--a2ui-primary-color, #007bff)"
                      : STANDARD_BORDER,
                    backgroundColor: isSelected
                      ? "var(--a2ui-primary-color, #007bff)"
                      : "#fff",
                    color: isSelected ? "#fff" : "inherit",
                    cursor: "pointer",
                    fontSize: "12px",
                  },
                },
                label,
              );
            }
            return h(
              "label",
              {
                key: i,
                style: {
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  cursor: "pointer",
                },
              },
              [
                h("input", {
                  type: isMutuallyExclusive ? "radio" : "checkbox",
                  checked: isSelected,
                  onChange: () => onToggle(opt.value),
                  name: isMutuallyExclusive
                    ? `choice-${context.componentModel.id}`
                    : undefined,
                }),
                h("span", { style: { fontSize: "14px" } }, label),
              ],
            );
          }),
        ),
      ],
    );
  },
  () => ({ filter: ref("") }),
);

const Slider = createVueComponent(
  SliderApi,
  ({ props, state }) => {
    const uniqueId = state.id;

    return h(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          gap: "4px",
          margin: LEAF_MARGIN,
          width: "100%",
        },
      },
      [
        h(
          "div",
          { style: { display: "flex", justifyContent: "space-between" } },
          [
            props.label
              ? h(
                  "label",
                  {
                    for: uniqueId,
                    style: { fontSize: "14px", fontWeight: "bold" },
                  },
                  props.label,
                )
              : null,
            h(
              "span",
              { style: { fontSize: "12px", color: "#666" } },
              String(props.value),
            ),
          ],
        ),
        h("input", {
          id: uniqueId,
          type: "range",
          min: props.min ?? 0,
          max: props.max,
          value: props.value ?? 0,
          onInput: (e: Event) =>
            props.setValue(Number((e.target as HTMLInputElement).value)),
          style: { width: "100%", cursor: "pointer" },
        }),
      ],
    );
  },
  () => ({ id: useA2UIUniqueId() }),
);

const DateTimeInput = createVueComponent(
  DateTimeInputApi,
  ({ props, state }) => {
    const uniqueId = state.id;

    let type = "datetime-local";
    if (props.enableDate && !props.enableTime) type = "date";
    if (!props.enableDate && props.enableTime) type = "time";

    const style = {
      padding: "8px",
      width: "100%",
      border: STANDARD_BORDER,
      borderRadius: STANDARD_RADIUS,
      boxSizing: "border-box",
    };

    return h(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          gap: "4px",
          width: "100%",
          margin: LEAF_MARGIN,
        },
      },
      [
        props.label
          ? h(
              "label",
              {
                for: uniqueId,
                style: { fontSize: "14px", fontWeight: "bold" },
              },
              props.label,
            )
          : null,
        h("input", {
          id: uniqueId,
          type,
          style,
          value: props.value || "",
          onInput: (e: Event) =>
            props.setValue((e.target as HTMLInputElement).value),
          min: typeof props.min === "string" ? props.min : undefined,
          max: typeof props.max === "string" ? props.max : undefined,
        }),
      ],
    );
  },
  () => ({ id: useA2UIUniqueId() }),
);

// ============================================================
// Catalog Assembly
// ============================================================

const vueBasicComponents: VueComponentImplementation[] = [
  Text,
  Image,
  Icon,
  Video,
  AudioPlayer,
  Row,
  Column,
  List,
  Card,
  Tabs,
  Divider,
  Modal,
  Button,
  TextField,
  CheckBox,
  ChoicePicker,
  Slider,
  DateTimeInput,
];

export const vueBasicCatalog = new Catalog<VueComponentImplementation>(
  "https://a2ui.org/specification/v0_9/basic_catalog.json",
  vueBasicComponents,
  BASIC_FUNCTIONS,
);

export {
  Text,
  Image,
  Icon,
  Video,
  AudioPlayer,
  Row,
  Column,
  List,
  Card,
  Tabs,
  Divider,
  Modal,
  Button,
  TextField,
  CheckBox,
  ChoicePicker,
  Slider,
  DateTimeInput,
};
