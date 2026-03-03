import type { Types } from "@a2ui/lit/0.8";

/**
 * Default theme for A2UI React components.
 *
 * This theme uses the same CSS class conventions as the Lit renderer,
 * ensuring visual consistency between React and Lit implementations.
 *
 * IMPORTANT: This theme must be kept in sync with the Lit renderer's internal
 * styling. If Lit components change their class maps, this file must be updated
 * to match. Ideally, Lit would export its default theme for direct import.
 *
 * Requires the structural styles to be injected:
 * @example
 * ```tsx
 * import { A2UIProvider } from '@a2ui/react';
 * import { injectStyles } from '@a2ui/react/styles';
 *
 * // Inject structural CSS at app startup
 * injectStyles();
 *
 * function App() {
 *   return (
 *     <A2UIProvider>
 *       <A2UIRenderer surfaceId="main" />
 *     </A2UIProvider>
 *   );
 * }
 * ```
 */

// =============================================================================
// Element Styles (used for markdown rendering and form elements)
// =============================================================================

const elementA = {
  "typography-f-sf": true,
  "typography-fs-n": true,
  "typography-w-500": true,
  "layout-as-n": true,
  "layout-dis-iflx": true,
  "layout-al-c": true,
  "typography-td-none": true,
  "color-c-p40": true,
};

const elementAudio = {
  "layout-w-100": true,
};

const elementBody = {
  "typography-f-s": true,
  "typography-fs-n": true,
  "typography-w-400": true,
  "layout-mt-0": true,
  "layout-mb-2": true,
  "typography-sz-bm": true,
  "color-c-n10": true,
};

const elementButton = {
  "typography-f-sf": true,
  "typography-fs-n": true,
  "typography-w-500": true,
  "layout-pt-3": true,
  "layout-pb-3": true,
  "layout-pl-5": true,
  "layout-pr-5": true,
  "layout-mb-1": true,
  "border-br-16": true,
  "border-bw-0": true,
  "border-c-n70": true,
  "border-bs-s": true,
  "color-bgc-s30": true,
  "behavior-ho-80": true,
};

const elementHeading = {
  "typography-f-sf": true,
  "typography-fs-n": true,
  "typography-w-500": true,
  "layout-mt-0": true,
  "layout-mb-2": true,
};

const elementIframe = {
  "behavior-sw-n": true,
};

const elementInput = {
  "typography-f-sf": true,
  "typography-fs-n": true,
  "typography-w-400": true,
  "layout-pl-4": true,
  "layout-pr-4": true,
  "layout-pt-2": true,
  "layout-pb-2": true,
  "border-br-6": true,
  "border-bw-1": true,
  "color-bc-s70": true,
  "border-bs-s": true,
  "layout-as-n": true,
  "color-c-n10": true,
};

const elementP = {
  "typography-f-s": true,
  "typography-fs-n": true,
  "typography-w-400": true,
  "layout-m-0": true,
  "typography-sz-bm": true,
  "layout-as-n": true,
  "color-c-n10": true,
};

const elementList = {
  "typography-f-s": true,
  "typography-fs-n": true,
  "typography-w-400": true,
  "layout-m-0": true,
  "typography-sz-bm": true,
  "layout-as-n": true,
  "color-c-n10": true,
};

const elementPre = {
  "typography-f-c": true,
  "typography-fs-n": true,
  "typography-w-400": true,
  "typography-sz-bm": true,
  "typography-ws-p": true,
  "layout-as-n": true,
};

const elementTextarea = {
  ...elementInput,
  "layout-r-none": true,
  "layout-fs-c": true,
};

const elementVideo = {
  "layout-el-cv": true,
};

// =============================================================================
// Theme Export
// =============================================================================

export const litTheme: Types.Theme = {
  // ===========================================================================
  // Additional Styles (inline CSS properties)
  // ===========================================================================

  // additionalStyles is optional - only define if custom styling is needed
  // The default Lit theme does not apply any additional inline styles

  components: {
    // =========================================================================
    // Content Components
    // =========================================================================

    AudioPlayer: {},

    Divider: {},

    Icon: {},

    Image: {
      all: {
        "border-br-5": true,
        "layout-el-cv": true,
        "layout-w-100": true,
        "layout-h-100": true,
      },
      avatar: { "is-avatar": true },
      header: {},
      icon: {},
      largeFeature: {},
      mediumFeature: {},
      smallFeature: {},
    },

    Text: {
      all: {
        "layout-w-100": true,
        "layout-g-2": true,
      },
      h1: {
        "typography-f-sf": true,
        "typography-v-r": true,
        "typography-w-400": true,
        "layout-m-0": true,
        "layout-p-0": true,
        "typography-sz-hs": true,
      },
      h2: {
        "typography-f-sf": true,
        "typography-v-r": true,
        "typography-w-400": true,
        "layout-m-0": true,
        "layout-p-0": true,
        "typography-sz-tl": true,
      },
      h3: {
        "typography-f-sf": true,
        "typography-v-r": true,
        "typography-w-400": true,
        "layout-m-0": true,
        "layout-p-0": true,
        "typography-sz-tl": true,
      },
      h4: {
        "typography-f-sf": true,
        "typography-v-r": true,
        "typography-w-400": true,
        "layout-m-0": true,
        "layout-p-0": true,
        "typography-sz-bl": true,
      },
      h5: {
        "typography-f-sf": true,
        "typography-v-r": true,
        "typography-w-400": true,
        "layout-m-0": true,
        "layout-p-0": true,
        "typography-sz-bm": true,
      },
      body: {},
      caption: {},
    },

    Video: {
      "border-br-5": true,
      "layout-el-cv": true,
    },

    // =========================================================================
    // Layout Components
    // =========================================================================

    Card: {
      "border-br-9": true,
      "layout-p-4": true,
      "color-bgc-n100": true,
    },

    Column: {
      "layout-g-2": true,
    },

    List: {
      "layout-g-4": true,
      "layout-p-2": true,
    },

    Modal: {
      backdrop: {
        "color-bbgc-p60_20": true,
      },
      element: {
        "border-br-2": true,
        "color-bgc-p100": true,
        "layout-p-4": true,
        "border-bw-1": true,
        "border-bs-s": true,
        "color-bc-p80": true,
      },
    },

    Row: {
      "layout-g-4": true,
    },

    Tabs: {
      container: {},
      controls: {
        all: {},
        selected: {},
      },
      element: {},
    },

    // =========================================================================
    // Interactive Components
    // =========================================================================

    Button: {
      "layout-pt-2": true,
      "layout-pb-2": true,
      "layout-pl-3": true,
      "layout-pr-3": true,
      "border-br-12": true,
      "border-bw-0": true,
      "border-bs-s": true,
      "color-bgc-p30": true,
      "color-c-p100": true, // White text on dark purple background
      "behavior-ho-70": true,
      "typography-w-400": true,
    },

    CheckBox: {
      container: {
        "layout-dsp-iflex": true,
        "layout-al-c": true,
      },
      element: {
        "layout-m-0": true,
        "layout-mr-2": true,
        "layout-p-2": true,
        "border-br-12": true,
        "border-bw-1": true,
        "border-bs-s": true,
        "color-bgc-p100": true,
        "color-bc-p60": true,
        "color-c-n30": true,
        "color-c-p30": true,
      },
      label: {
        "color-c-p30": true,
        "typography-f-sf": true,
        "typography-v-r": true,
        "typography-w-400": true,
        "layout-flx-1": true,
        "typography-sz-ll": true,
      },
    },

    DateTimeInput: {
      container: {
        "typography-sz-bm": true,
        "layout-w-100": true,
        "layout-g-2": true,
        "layout-dsp-flexhor": true,
        "layout-al-c": true,
        "typography-ws-nw": true,
      },
      label: {
        "color-c-p30": true,
        "typography-sz-bm": true,
      },
      element: {
        "layout-pt-2": true,
        "layout-pb-2": true,
        "layout-pl-3": true,
        "layout-pr-3": true,
        "border-br-2": true,
        "border-bw-1": true,
        "border-bs-s": true,
        "color-bgc-p100": true,
        "color-bc-p60": true,
        "color-c-n30": true,
        "color-c-p30": true,
      },
    },

    MultipleChoice: {
      container: {},
      label: {},
      element: {},
    },

    Slider: {
      container: {},
      label: {},
      element: {},
    },

    TextField: {
      container: {
        "typography-sz-bm": true,
        "layout-w-100": true,
        "layout-g-2": true,
        "layout-dsp-flexhor": true,
        "layout-al-c": true,
        "typography-ws-nw": true,
      },
      label: {
        "layout-flx-0": true,
        "color-c-p30": true,
      },
      element: {
        "typography-sz-bm": true,
        "layout-pt-2": true,
        "layout-pb-2": true,
        "layout-pl-3": true,
        "layout-pr-3": true,
        "border-br-2": true,
        "border-bw-1": true,
        "border-bs-s": true,
        "color-bgc-p100": true,
        "color-bc-p60": true,
        "color-c-n30": true,
        "color-c-p30": true,
      },
    },
  },

  // ===========================================================================
  // HTML Elements (used for markdown rendering and raw HTML)
  // ===========================================================================

  elements: {
    a: elementA,
    audio: elementAudio,
    body: elementBody,
    button: elementButton,
    h1: elementHeading,
    h2: elementHeading,
    h3: elementHeading,
    h4: elementHeading,
    h5: elementHeading,
    iframe: elementIframe,
    input: elementInput,
    p: elementP,
    pre: elementPre,
    textarea: elementTextarea,
    video: elementVideo,
  },

  // ===========================================================================
  // Markdown (class arrays for markdown-it renderer)
  // ===========================================================================

  markdown: {
    p: Object.keys(elementP),
    h1: Object.keys(elementHeading),
    h2: Object.keys(elementHeading),
    h3: Object.keys(elementHeading),
    h4: Object.keys(elementHeading),
    h5: Object.keys(elementHeading),
    ul: Object.keys(elementList),
    ol: Object.keys(elementList),
    li: Object.keys(elementList),
    a: Object.keys(elementA),
    strong: [],
    em: [],
  },
};

/**
 * Alias for litTheme - the default theme for A2UI React components.
 * @see litTheme
 */
export const defaultTheme = litTheme;
