import { deskUI } from "./generative-ui";

/**
 * The catalog gallery: one specimen of each component the agent can draw,
 * grouped the way the standard catalog groups them (layout, text, inputs,
 * feedback, data, media, composites). Each specimen is plain A2UI, rendered
 * by the same renderer as the agent's views.
 *
 * The standard catalog does not export its groups yet, so they are listed
 * here. A component the catalog adds later still shows, under "More".
 */

type Node = { id: string; component: string } & Record<string, unknown>;

export interface Specimen {
  /** The component the specimen shows. */
  name: string;
  /** Other components of its family, listed with it. */
  parts?: string[];
  /** Spans two columns of the gallery. */
  wide?: boolean;
  /** Opens an overlay under its trigger, so it sits at the top of its tile. */
  overlay?: boolean;
  /** The components; the root is "root". */
  nodes: Node[];
  /** The data model, for bound values. */
  data?: Record<string, unknown>;
}

export interface CatalogSection {
  id: string;
  title: string;
  blurb: string;
  specimens: Specimen[];
}

const n = (
  id: string,
  component: string,
  props: Record<string, unknown> = {},
) => ({ id, component, ...props }) as Node;
const at = (path: string) => ({ "@path": path });

const commons = (path: string) =>
  `https://upload.wikimedia.org/wikipedia/commons/thumb/${path}`;
const EARTH = commons(
  "9/97/The_Earth_seen_from_Apollo_17.jpg/500px-The_Earth_seen_from_Apollo_17.jpg",
);
const WAVE = commons(
  "0/0d/Great_Wave_off_Kanagawa2.jpg/500px-Great_Wave_off_Kanagawa2.jpg",
);
const SATURN = commons(
  "c/c7/Saturn_during_Equinox.jpg/500px-Saturn_during_Equinox.jpg",
);
const DEEP_FIELD = commons(
  "2/2f/Hubble_ultra_deep_field.jpg/500px-Hubble_ultra_deep_field.jpg",
);

export const CATALOG: CatalogSection[] = [
  {
    id: "layout",
    title: "Layout",
    blurb:
      "How a view is arranged: stacks, rows, grids, cards, tabs and carousels.",
    specimens: [
      {
        name: "Card",
        parts: ["Column", "Row", "Spacer"],
        nodes: [
          n("root", "Card", { variant: "outline", child: "body" }),
          n("body", "Column", {
            gap: 3,
            children: ["title", "caption", "rule", "count", "sources"],
          }),
          n("title", "Title", { text: "Reading settings", size: "sm" }),
          n("caption", "Caption", {
            text: "Applies to every answer",
            size: "md",
          }),
          n("rule", "Divider"),
          n("count", "Row", {
            align: "center",
            children: ["label", "space", "value"],
          }),
          n("label", "Text", { text: "Answers this week", color: "secondary" }),
          n("space", "Spacer"),
          n("value", "Text", { text: "**42**", tabularNums: true }),
          n("sources", "CheckBox", {
            label: "Show sources under each answer",
            value: at("/sources"),
          }),
        ],
        data: { sources: true },
      },
      {
        name: "Grid",
        parts: ["GridItem"],
        nodes: [
          n("root", "Grid", {
            columns: 2,
            gap: 2,
            children: ["a", "b", "c", "d"],
          }),
          n("a", "GridItem", { span: 2, children: ["boxA"] }),
          n("b", "GridItem", { children: ["boxB"] }),
          n("c", "GridItem", { children: ["boxC"] }),
          n("d", "GridItem", { span: 2, children: ["boxD"] }),
          ...[
            ["boxA", "info", "Span 2"],
            ["boxB", "success", "1"],
            ["boxC", "warning", "1"],
            ["boxD", "discovery", "Span 2"],
          ].flatMap(([id, tone, text]) => [
            n(id, "Box", {
              background: tone,
              padding: 3,
              radius: "md",
              children: [`${id}Text`],
            }),
            n(`${id}Text`, "Caption", { text, size: "md" }),
          ]),
        ],
      },
      {
        name: "Tabs",
        nodes: [
          n("root", "Tabs", {
            tabs: [
              { title: "Summary", child: "summary" },
              { title: "Method", child: "method" },
              { title: "Caveats", child: "caveats" },
            ],
          }),
          n("summary", "Text", {
            text: "Global life expectancy rose from about 32 years in 1900 to 73 in 2023.",
          }),
          n("method", "Text", {
            text: "Period life expectancy at birth, from UN population estimates.",
          }),
          n("caveats", "Text", {
            text: "Early figures are reconstructions with wide error bands.",
          }),
        ],
      },
      {
        name: "Flow",
        parts: ["FlowItem"],
        wide: true,
        nodes: [
          n("root", "Flow", {
            columns: 3,
            gap: 2,
            children: ["f1", "f2", "f3", "f4"],
          }),
          ...[
            ["f1", 2, 1, "4 / 1", "info", "Span 2"],
            ["f2", 1, 2, "1 / 1", "discovery", "Two rows tall"],
            ["f3", 1, 1, "2 / 1", "success", "One cell"],
            ["f4", 1, 1, "2 / 1", "warning", "One cell"],
          ].flatMap(([id, span, rowSpan, aspectRatio, tone, text]) => [
            n(id as string, "FlowItem", {
              span,
              rowSpan,
              aspectRatio,
              children: [`${id}Box`],
            }),
            n(`${id}Box`, "Box", {
              background: tone,
              padding: 3,
              radius: "md",
              height: "100%",
              children: [`${id}Text`],
            }),
            n(`${id}Text`, "Caption", { text, size: "md" }),
          ]),
        ],
      },
      {
        name: "Box",
        nodes: [
          n("root", "Box", {
            direction: "row",
            align: "center",
            gap: 3,
            padding: 4,
            radius: "lg",
            background: "surface-secondary",
            children: ["icon", "text"],
          }),
          n("icon", "Icon", { name: "lightbulb", color: "warning" }),
          n("text", "Text", {
            text: "A Box groups its children with a gap, padding, a border or a background.",
          }),
        ],
      },
      {
        name: "Carousel",
        wide: true,
        parts: ["CarouselMediaItem", "CarouselItem"],
        nodes: [
          n("root", "Carousel", {
            label: "Pictures from space",
            children: ["earth", "saturn", "field", "note"],
          }),
          n("earth", "CarouselMediaItem", {
            size: "sm",
            url: EARTH,
            description: "The Earth seen from Apollo 17",
            children: ["earthCaption"],
          }),
          n("earthCaption", "Caption", { text: "Apollo 17, 1972 · NASA" }),
          n("saturn", "CarouselMediaItem", {
            size: "sm",
            url: SATURN,
            description: "Saturn at its equinox, seen by Cassini",
            children: ["saturnCaption"],
          }),
          n("saturnCaption", "Caption", { text: "Cassini, 2009 · NASA" }),
          n("field", "CarouselMediaItem", {
            size: "sm",
            url: DEEP_FIELD,
            description: "The Hubble Ultra Deep Field",
            children: ["fieldCaption"],
          }),
          n("fieldCaption", "Caption", { text: "Hubble, 2004 · NASA" }),
          n("note", "CarouselItem", { padding: 4, children: ["noteText"] }),
          n("noteText", "Text", {
            text: "A slide can hold any component, not only a picture.",
            color: "secondary",
          }),
        ],
      },
      {
        name: "Divider",
        nodes: [
          n("root", "Row", {
            gap: 4,
            align: "stretch",
            children: ["rise", "rule", "rate"],
          }),
          n("rule", "Divider", { axis: "vertical" }),
          ...[
            ["rise", "Sea level since 1993", "+10 cm"],
            ["rate", "Rising now", "4.5 mm a year"],
          ].flatMap(([id, label, value]) => [
            n(id, "Column", { gap: 1, children: [`${id}Label`, `${id}Value`] }),
            n(`${id}Label`, "Caption", { text: label, size: "md" }),
            n(`${id}Value`, "Title", {
              text: value,
              size: "lg",
              tabularNums: true,
            }),
          ]),
        ],
      },
    ],
  },
  {
    id: "text",
    title: "Text",
    blurb:
      "Headings, body text, labels and inline marks, plus code, math and markdown.",
    specimens: [
      {
        name: "Title",
        parts: ["Label", "Text", "Caption"],
        nodes: [
          n("root", "Column", {
            gap: 1,
            children: ["label", "title", "text", "caption"],
          }),
          n("label", "Label", { text: "World population" }),
          n("title", "Title", {
            text: "8.1 billion",
            size: "3xl",
            tabularNums: true,
          }),
          n("text", "Text", {
            text: "Growth has slowed to under 1% a year, the lowest since the 1950s.",
          }),
          n("caption", "Caption", {
            text: "UN World Population Prospects, 2024",
            size: "md",
          }),
        ],
      },
      {
        name: "Bold",
        parts: ["Italic", "Underline", "Strikethrough"],
        nodes: [
          n("root", "Row", {
            wrap: "wrap",
            gap: 3,
            align: "baseline",
            children: ["bold", "italic", "underline", "strike"],
          }),
          n("bold", "Bold", { text: "Bold" }),
          n("italic", "Italic", { text: "Italic" }),
          n("underline", "Underline", { text: "Underline" }),
          n("strike", "Strikethrough", { text: "Strikethrough" }),
        ],
      },
      {
        name: "Badge",
        nodes: [
          n("root", "Row", {
            wrap: "wrap",
            gap: 2,
            children: ["peer", "draft", "retracted", "new", "secondary"],
          }),
          n("peer", "Badge", { label: "Peer reviewed", color: "success" }),
          n("draft", "Badge", { label: "Preprint", color: "warning" }),
          n("retracted", "Badge", {
            label: "Retracted",
            color: "danger",
            variant: "solid",
          }),
          n("new", "Badge", { label: "New", color: "info", pill: true }),
          n("secondary", "Badge", { label: "2019", variant: "outline" }),
        ],
      },
      {
        name: "Blockquote",
        nodes: [
          n("root", "Blockquote", {
            text: "The good thing about science is that it's true whether or not you believe in it. — Neil deGrasse Tyson",
          }),
        ],
      },
      {
        name: "Code",
        nodes: [
          n("root", "Code", {
            language: "python",
            text: "def payment(p, rate, n):\n    r = rate / 12\n    return p * r / (1 - (1+r)**-n)",
          }),
        ],
      },
      {
        name: "Math",
        nodes: [
          n("root", "Math", {
            block: true,
            value: "A = P\\left(1 + \\frac{r}{n}\\right)^{nt}",
          }),
        ],
      },
      {
        name: "Markdown",
        nodes: [
          n("root", "Markdown", {
            text: "Three things moved the curve:\n\n1. **Clean water** and sanitation\n2. *Vaccines*, from smallpox on\n3. Antibiotics, after 1945",
          }),
        ],
      },
      {
        name: "Link",
        parts: ["Tooltip"],
        nodes: [
          n("root", "Column", { gap: 2, children: ["row", "link"] }),
          n("row", "Row", {
            gap: 1,
            align: "center",
            children: ["term", "tip"],
          }),
          n("term", "Text", { text: "Measured as period life expectancy" }),
          n("tip", "Tooltip", { trigger: "tipIcon", content: "tipText" }),
          n("tipIcon", "Icon", {
            name: "info",
            size: "sm",
            color: "secondary",
          }),
          n("tipText", "Text", {
            text: "How long a newborn would live at this year's death rates.",
          }),
          n("link", "Link", {
            text: "Our World in Data: Life expectancy",
            href: "https://ourworldindata.org/life-expectancy",
          }),
        ],
      },
      {
        name: "ShimmerText",
        nodes: [n("root", "ShimmerText", { text: "Reading 12 sources…" })],
      },
    ],
  },
  {
    id: "inputs",
    title: "Inputs",
    blurb:
      "Controls the reader can use. Their values live in the view's data model, so the rest of the view follows them with no call to the agent.",
    specimens: [
      {
        name: "Form",
        wide: true,
        parts: ["TextField", "Select", "DateTimeInput", "Button"],
        nodes: [
          n("root", "Form", {
            label: "Plan a trip",
            gap: 3,
            children: ["fields", "submit"],
          }),
          n("fields", "Grid", {
            columns: 3,
            gap: 3,
            children: ["city", "season", "date"],
          }),
          n("city", "TextField", {
            label: "City",
            placeholder: "Lisbon",
            value: at("/trip/city"),
          }),
          n("season", "Select", {
            label: "Travel style",
            options: ["Slow", "Balanced", "Packed"],
            value: at("/trip/style"),
          }),
          n("date", "DateTimeInput", {
            label: "Arrive",
            enableDate: true,
            value: at("/trip/date"),
          }),
          n("submit", "Button", {
            label: "Plan it",
            variant: "primary",
            submit: true,
          }),
        ],
        data: { trip: { city: "", style: "Balanced" } },
      },
      {
        name: "Slider",
        nodes: [
          n("root", "Column", { gap: 3, children: ["distance", "result"] }),
          n("distance", "Slider", {
            label: "One-way commute",
            value: at("/km"),
            min: 1,
            max: 60,
            unit: " km",
          }),
          n("result", "Row", {
            gap: 2,
            align: "baseline",
            children: ["tonnes", "unit"],
          }),
          n("tonnes", "Text", {
            size: "lg",
            strong: true,
            tabularNums: true,
            text: {
              "@call": "calc",
              args: {
                expression: "round(km * 2 * 220 * 0.17 / 100) / 10",
                km: at("/km"),
              },
            },
          }),
          n("unit", "Text", {
            text: "tonnes of CO₂ a year, driving alone",
            color: "secondary",
          }),
        ],
        data: { km: 18 },
      },
      {
        name: "SegmentedControl",
        nodes: [
          n("root", "SegmentedControl", {
            label: "Range",
            options: ["1 year", "10 years", "100 years"],
            value: at("/range"),
          }),
        ],
        data: { range: "10 years" },
      },
      {
        name: "RadioGroup",
        parts: ["Radio"],
        nodes: [
          n("root", "RadioGroup", {
            label: "Reading level",
            options: ["Plain", "Detailed", "Technical"],
            value: at("/level"),
          }),
        ],
        data: { level: "Detailed" },
      },
      {
        name: "ChoicePicker",
        nodes: [
          n("root", "ChoicePicker", {
            label: "Sources to include",
            variant: "multipleSelection",
            displayStyle: "chips",
            options: ["Journals", "News", "Government", "Preprints"],
            value: at("/sources"),
          }),
        ],
        data: { sources: ["Journals", "Government"] },
      },
      {
        name: "Button",
        parts: ["Pressable"],
        nodes: [
          n("root", "Column", { gap: 3, children: ["buttons", "press"] }),
          n("buttons", "Row", {
            wrap: "wrap",
            gap: 2,
            children: ["primary", "default", "soft", "borderless"],
          }),
          n("primary", "Button", {
            label: "Save",
            variant: "primary",
            icon: "bookmark",
          }),
          n("default", "Button", { label: "Export", icon: "download" }),
          n("soft", "Button", { label: "Compare", variant: "soft" }),
          n("borderless", "Button", {
            label: "Dismiss",
            variant: "borderless",
          }),
          n("press", "Pressable", {
            border: true,
            radius: "md",
            padding: 3,
            hoverBackground: "surface-secondary",
            children: ["pressRow"],
          }),
          n("pressRow", "Row", {
            gap: 2,
            align: "center",
            children: ["pressIcon", "pressText"],
          }),
          n("pressIcon", "Icon", { name: "file-text", size: "sm" }),
          n("pressText", "Text", { text: "A whole row that can be pressed" }),
        ],
      },
      {
        name: "CheckBox",
        nodes: [
          n("root", "Column", { gap: 2, children: ["a", "b", "c"] }),
          n("a", "CheckBox", { label: "Read the abstract", value: at("/a") }),
          n("b", "CheckBox", {
            label: "Check the sample size",
            value: at("/b"),
          }),
          n("c", "CheckBox", { label: "Find who funded it", value: at("/c") }),
        ],
        data: { a: true, b: true, c: false },
      },
      {
        name: "TextArea",
        nodes: [
          n("root", "TextArea", {
            label: "Notes for the agent",
            placeholder: "Museums, food, a day trip…",
            rows: 3,
            value: at("/notes"),
          }),
        ],
        data: { notes: "" },
      },
    ],
  },
  {
    id: "feedback",
    title: "Feedback",
    blurb:
      "Overlays and status: popovers, dialogs, flashcards and a live pulse.",
    specimens: [
      {
        name: "FlashcardFlip",
        wide: true,
        nodes: [
          n("root", "FlashcardFlip", {
            front: "What share of Earth's water is fresh?",
            back: "About 2.5%, and most of it is frozen.",
            hint: "Click to flip",
          }),
        ],
      },
      {
        name: "PulseIndicator",
        nodes: [
          n("root", "Row", {
            gap: 2,
            align: "center",
            children: ["pulse", "status"],
          }),
          n("pulse", "PulseIndicator", { label: "Live" }),
          n("status", "Text", { text: "Live: sea ice extent, updated daily" }),
        ],
      },
      {
        name: "Modal",
        nodes: [
          n("root", "Modal", {
            title: "Methodology",
            maxWidth: "30rem",
            trigger: "open",
            content: "body",
          }),
          n("open", "Button", {
            label: "Read the methodology",
            icon: "book-open",
          }),
          n("body", "Text", {
            text: "Figures are period estimates from the UN's World Population Prospects, revised every two years.",
          }),
        ],
      },
      {
        name: "Popover",
        wide: true,
        parts: ["PopoverTrigger", "PopoverContent"],
        overlay: true,
        nodes: [
          n("root", "Popover", {
            open: at("/open"),
            children: ["trigger", "content"],
          }),
          n("trigger", "PopoverTrigger", { children: ["triggerText"] }),
          n("triggerText", "Text", { text: "How was this measured?" }),
          n("content", "PopoverContent", { children: ["contentText"] }),
          n("contentText", "Text", {
            text: "Satellite gravity data (GRACE) since 2002, checked against well readings.",
            size: "sm",
          }),
        ],
        data: { open: true },
      },
    ],
  },
  {
    id: "data",
    title: "Data",
    blurb: "Tables, lists, charts and maps for the facts behind an answer.",
    specimens: [
      {
        name: "Chart",
        wide: true,
        nodes: [
          n("root", "Chart", {
            chartType: "line",
            height: 180,
            title: "Life expectancy at birth",
            xKey: "year",
            series: [
              { key: "africa", label: "Africa" },
              { key: "asia", label: "Asia" },
              { key: "europe", label: "Europe" },
            ],
            format: "number",
            yAxis: { label: "Years" },
            data: [
              { year: "1950", africa: 37, asia: 42, europe: 62 },
              { year: "1970", africa: 45, asia: 55, europe: 70 },
              { year: "1990", africa: 51, asia: 64, europe: 73 },
              { year: "2010", africa: 57, asia: 71, europe: 77 },
              { year: "2023", africa: 64, asia: 74, europe: 79 },
            ],
          }),
        ],
      },
      {
        name: "List",
        parts: ["ListItem"],
        nodes: [
          n("root", "List", { children: ["a", "b", "c"] }),
          n("a", "ListItem", {
            label: "Median age",
            value: "30.5 years",
            icon: "users",
          }),
          n("b", "ListItem", {
            label: "Urban share",
            value: "57%",
            icon: "building-2",
          }),
          n("c", "ListItem", {
            label: "Fertility rate",
            value: "2.3",
            icon: "baby",
          }),
        ],
      },
      {
        name: "Map",
        nodes: [
          n("root", "Map", {
            height: 200,
            route: true,
            markers: [
              { label: "Lisbon", lat: 38.7223, lng: -9.1393 },
              { label: "Sintra", lat: 38.8029, lng: -9.3817 },
              { label: "Cascais", lat: 38.6979, lng: -9.4215 },
            ],
          }),
        ],
      },
      {
        name: "Table",
        wide: true,
        parts: ["TableSection", "TableRow", "TableCell"],
        nodes: [
          n("root", "Table", {
            caption: "Largest lakes by area",
            children: ["head", "body"],
          }),
          n("head", "TableSection", { header: true, children: ["headRow"] }),
          n("headRow", "TableRow", { children: ["h1", "h2", "h3"] }),
          n("h1", "TableCell", { text: "Lake", header: true }),
          n("h2", "TableCell", {
            text: "Area (km²)",
            header: true,
            align: "end",
          }),
          n("h3", "TableCell", { text: "Status", header: true }),
          n("body", "TableSection", { children: ["r1", "r2", "r3"] }),
          ...[
            ["r1", "Caspian Sea", "371,000", "stable", "Stable", "secondary"],
            ["r2", "Superior", "82,100", "stable2", "Stable", "secondary"],
            ["r3", "Aral Sea", "6,990", "shrinking", "Shrinking", "danger"],
          ].flatMap(([id, lake, area, badge, label, color]) => [
            n(id, "TableRow", { children: [`${id}a`, `${id}b`, `${id}c`] }),
            n(`${id}a`, "TableCell", { text: lake }),
            n(`${id}b`, "TableCell", { text: area, align: "end" }),
            n(`${id}c`, "TableCell", { children: [badge] }),
            n(badge, "Badge", { label, color, size: "lg" }),
          ]),
        ],
      },
    ],
  },
  {
    id: "media",
    title: "Media",
    blurb: "Pictures, icons, drawings, video, audio and sandboxed HTML.",
    specimens: [
      {
        name: "AudioPlayer",
        wide: true,
        nodes: [
          n("root", "AudioPlayer", {
            url: "https://upload.wikimedia.org/wikipedia/commons/2/20/Gymnopedie_No._2_%28ISRC_USUAN1100786%29.mp3",
            description:
              "Erik Satie, Gymnopédie No. 2. Played by Kevin MacLeod, CC BY 3.0",
          }),
        ],
      },
      {
        name: "Image",
        nodes: [
          n("root", "Image", {
            url: EARTH,
            description: "The Earth seen from Apollo 17, 1972 (NASA)",
            aspectRatio: "16 / 9",
          }),
        ],
      },
      {
        name: "Video",
        nodes: [
          n("root", "Video", {
            url: "https://www.youtube.com/watch?v=o4OBKOlgmfo",
            title: "Apollo 11 launch commentary, 1969 (NASA)",
          }),
        ],
      },
      {
        name: "Icon",
        nodes: [
          n("root", "Row", {
            wrap: "wrap",
            gap: 4,
            align: "center",
            children: ["i1", "i2", "i3", "i4", "i5", "i6"],
          }),
          ...[
            ["i1", "globe", "default"],
            ["i2", "leaf", "success"],
            ["i3", "flame", "danger"],
            ["i4", "droplets", "info"],
            ["i5", "sun", "warning"],
            ["i6", "telescope", "discovery"],
          ].map(([id, name, color]) =>
            n(id, "Icon", { name, color, size: "lg" }),
          ),
        ],
      },
      {
        name: "Svg",
        nodes: [
          n("root", "Svg", {
            label: "A sun over two hills",
            viewBox: "0 0 240 100",
            circles: [{ cx: 170, cy: 38, r: 18, fill: "#b58900" }],
            paths: [
              {
                d: "M0 100 L0 70 Q60 30 120 70 T240 64 L240 100 Z",
                fill: "#859900",
              },
              {
                d: "M0 100 L0 84 Q80 56 160 84 T240 82 L240 100 Z",
                fill: "#2aa198",
              },
            ],
          }),
        ],
      },
      {
        name: "HtmlView",
        wide: true,
        nodes: [
          n("root", "HtmlView", {
            title: "A sandboxed HTML snippet",
            height: 120,
            html: '<div style="font:15px/1.5 system-ui;padding:12px;color:#586e75;background:#fdf6e3"><strong>Sandboxed HTML.</strong> No scripts and no access to the page, for content no component covers.</div>',
          }),
        ],
      },
      {
        name: "Favicon",
        nodes: [
          n("root", "Column", { gap: 2, children: ["a", "b", "c"] }),
          ...[
            ["a", "https://www.who.int", "World Health Organization"],
            ["b", "https://www.nature.com", "Nature"],
            ["c", "https://ourworldindata.org", "Our World in Data"],
          ].flatMap(([id, url, name]) => [
            n(id, "Row", {
              gap: 2,
              align: "center",
              children: [`${id}Icon`, `${id}Text`],
            }),
            n(`${id}Icon`, "Favicon", { url, size: 16 }),
            n(`${id}Text`, "Text", { text: name }),
          ]),
        ],
      },
    ],
  },
  {
    id: "composites",
    title: "Composites",
    blurb:
      "Ready-made patterns for research answers: link previews, citations, entity cards, picture grids and follow-ups.",
    specimens: [
      {
        name: "ImageGrid",
        wide: true,
        nodes: [
          n("root", "ImageGrid", {
            columns: 3,
            aspectRatio: "4 / 3",
            images: [
              {
                url: WAVE,
                description: "The Great Wave off Kanagawa",
                caption: "Hokusai, c. 1831",
              },
              {
                url: EARTH,
                description: "The Earth from Apollo 17",
                caption: "NASA, 1972",
              },
              {
                url: SATURN,
                description: "Saturn at equinox",
                caption: "NASA, 2009",
              },
            ],
          }),
        ],
      },
      {
        name: "EntityCard",
        nodes: [
          n("root", "EntityCard", {
            title: "Saturn",
            subtitle: "Gas giant",
            description: "Ringed, 95 times Earth's mass, with 146 known moons.",
            image: SATURN,
            meta: "1.4 billion km from the Sun",
            badge: { label: "Visible tonight", color: "success" },
            layout: "horizontal",
          }),
        ],
      },
      {
        name: "LinkCard",
        nodes: [
          n("root", "LinkCard", {
            href: "https://science.nasa.gov/earth/",
            title: "Earth: facts about our home planet",
            description:
              "NASA's overview of Earth's structure, atmosphere and climate.",
            domain: "science.nasa.gov",
            image: EARTH,
          }),
        ],
      },
      {
        name: "Citation",
        nodes: [
          n("root", "Text", {
            text: "The Aral Sea lost about 90% of its volume between 1960 and 2010.",
            children: ["cite"],
          }),
          n("cite", "Citation", {
            index: 1,
            title: "Aral Sea",
            url: "https://earthobservatory.nasa.gov/world-of-change/AralSea",
            source: "NASA Earth Observatory",
            snippet:
              "Once the fourth-largest lake in the world, the Aral Sea has shrunk dramatically since the 1960s.",
          }),
        ],
      },
      {
        name: "FollowUp",
        nodes: [
          n("root", "FollowUp", {
            title: "Keep going",
            items: [
              "Why did it shrink?",
              "Show it on a map",
              "Is it recovering?",
            ],
          }),
        ],
      },
    ],
  },
];

const VERSION = "v1.0";

/** The A2UI that draws a specimen, as the agent would send it. */
export function specimenOperations(surfaceId: string, specimen: Specimen) {
  const operations: unknown[] = [
    { version: VERSION, createSurface: { surfaceId, catalogId: deskUI.id } },
    {
      version: VERSION,
      updateComponents: { surfaceId, components: specimen.nodes },
    },
  ];
  if (specimen.data) {
    operations.push({
      version: VERSION,
      updateDataModel: { surfaceId, path: "/", value: specimen.data },
    });
  }
  return operations;
}

/** The first sentence of a component's description, for people. */
export function summary(name: string) {
  const description = deskUI.components.get(name)?.description ?? "";
  return description.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? description;
}

// The layout props that Box shares with every container component.
const LAYOUT_PROPS = new Set(
  deskUI.components.get("Box")?.propKeys.filter((key) => key !== "children"),
);

/**
 * What the agent reads about a component: its description, and its props.
 * A container lists its own props, and points at Box for the shared ones.
 */
export function describe(name: string) {
  const definition = deskUI.components.get(name);
  const keys = (definition?.propKeys ?? []).filter(
    (key) => key !== "accessibility",
  );
  const layout = name !== "Box" && keys.some((key) => LAYOUT_PROPS.has(key));
  return {
    description: definition?.description ?? "",
    props: layout ? keys.filter((key) => !LAYOUT_PROPS.has(key)) : [...keys],
    layout,
  };
}

/** Components of the catalog that no specimen shows yet. */
export function unshownComponents() {
  const shown = new Set(
    CATALOG.flatMap((section) =>
      section.specimens.flatMap((s) => [s.name, ...(s.parts ?? [])]),
    ),
  );
  return [...deskUI.components.keys()].filter((name) => !shown.has(name));
}
