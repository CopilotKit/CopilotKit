"""The demo's standard-catalog Express calling convention.

Catalog design, not an SDK workaround: Express interprets schema property order
as argument order. Props, slots and events must be ordered together. Keep these
short prefixes stable; use names for everything after them. JSON and custom
catalogs retain their existing meaning. New standard components require an
explicit prefix review, rather than guessing from which fields are required.
"""

# Content / children / common actions first, even when the field is optional.
# These are intentional positional API choices, not a required-first sort.
STANDARD_ARGUMENT_PREFIXES = {
    "Box": ("children",),
    "Column": ("children",),
    "Row": ("children",),
    "Grid": ("children", "columns"),
    "GridItem": ("children",),
    "Card": ("children", "child"),
    "Flow": ("children",),
    "FlowItem": ("children",),
    "Carousel": ("children", "activeIndex"),
    "CarouselItem": ("children",),
    "CarouselMediaItem": ("url", "children", "onClick"),
    "Spacer": ("minSize",),
    "Divider": ("axis",),
    "Tabs": ("tabs", "selectedIndex"),
    "Title": ("text",),
    "Text": ("text", "children"),
    "Caption": ("text",),
    "Label": ("text", "htmlFor"),
    "Bold": ("text",),
    "Italic": ("text",),
    "Underline": ("text",),
    "Strikethrough": ("text",),
    "Badge": ("label",),
    "Blockquote": ("text",),
    "Code": ("text", "language"),
    "Markdown": ("text",),
    "Math": ("value",),
    "ShimmerText": ("text",),
    "Link": ("text", "href"),
    "Tooltip": ("trigger", "content"),
    "Button": ("label", "onClick"),
    "Pressable": ("children", "onClick", "href"),
    "Form": ("children", "onSubmit"),
    "TextField": ("label", "value"),
    "TextArea": ("label", "value"),
    "Select": ("label", "options", "value"),
    "CheckBox": ("label", "value"),
    "Radio": ("label", "value"),
    "RadioGroup": ("label", "options", "value"),
    "Slider": ("label", "value", "min", "max"),
    "SegmentedControl": ("label", "options", "value"),
    "ChoicePicker": ("label", "options", "value"),
    "DateTimeInput": ("label", "value"),
    "PulseIndicator": ("label",),
    "FlashcardFlip": ("front", "back"),
    "Popover": ("children", "open"),
    "PopoverTrigger": ("children",),
    "PopoverContent": ("children",),
    "Modal": ("trigger", "content", "title"),
    "Table": ("columns", "rows", "children"),
    "TableSection": ("children",),
    "TableRow": ("children", "label"),
    "TableCell": ("text", "children"),
    "List": ("items", "children", "action"),
    "ListItem": ("label", "value", "action", "children"),
    "Chart": ("data", "xKey", "series", "chartType"),
    "Map": ("markers", "selected", "route"),
    "Image": ("url", "description", "onOverlayClick"),
    "Icon": ("name", "label"),
    "Favicon": ("url", "alt"),
    "Svg": ("paths", "viewBox"),
    "Video": ("url", "title", "captions"),
    "AudioPlayer": ("url", "description"),
    "HtmlView": ("html", "title"),
    "LinkCard": ("href", "title", "onClick"),
    "Citation": ("index", "title", "url"),
    "FollowUp": ("items", "onFollowUp", "title"),
    "EntityCard": ("title", "actions", "onAction", "onClick"),
    "ImageGrid": ("images",),
}

# Shared presentation fields go last. Component-specific fields stay in their
# original relative order unless included in the explicit prefix above. Avoid
# ambiguous names such as variant (TextField uses it for its input type).
PRESENTATION_PARAMETERS = frozenset(
    [
        "align",
        "justify",
        "wrap",
        "gap",
        "rowGap",
        "columnGap",
        "padding",
        "background",
        "border",
        "borderColor",
        "radius",
        "width",
        "height",
        "minWidth",
        "maxWidth",
        "minHeight",
        "maxHeight",
        "flex",
        "weight",
        "aspectRatio",
        "scrollable",
        "clip",
        "shadow",
        "inline",
        "role",
        "flush",
        "minSize",
        "maxSize",
        "disableAutoSpacing",
        "color",
        "fontWeight",
        "textAlign",
        "italic",
        "truncate",
        "maxLines",
        "tabularNums",
        "size",
        "fontSize",
        "lineHeight",
        "minLines",
        "strong",
        "underline",
        "lineThrough",
        "preserveWhitespace",
        "highlight",
        "pill",
        "shadowStyle",
        "hoverBackground",
        "insetBorder",
        "strokeWeight",
    ]
)


def order_parameters(catalog_id, name, schema):
    """Reorder a copy without changing any property schema or requiredness."""
    if catalog_id != "copilotkit/standard@1" or name not in STANDARD_ARGUMENT_PREFIXES:
        return schema
    properties = schema["properties"]
    prefix = [key for key in STANDARD_ARGUMENT_PREFIXES[name] if key in properties]
    remainder = [key for key in properties if key not in prefix]
    order = [
        *prefix,
        *(key for key in remainder if key not in PRESENTATION_PARAMETERS),
        *(key for key in remainder if key in PRESENTATION_PARAMETERS),
    ]
    return {**schema, "properties": {key: properties[key] for key in order}}
