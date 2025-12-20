import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "fumadocs-ui/components/tabs";
import { Monitor, Code } from "lucide-react";

// Base props shared by both modes
interface BaseIframeSwitcherProps {
  id?: string;
  height?: string;
  exampleLabel?: string;
  codeLabel?: string;
}

// Static mode - simple string URLs, no urlProps
interface StaticIframeSwitcherProps extends BaseIframeSwitcherProps {
  exampleUrl: string;
  codeUrl: string;
  urlProps?: never;
}

// Dynamic mode - callback URLs with urlProps
// T is the urlProps object shape, e.g. { integration: ['langgraph', 'wayflow'] }
// The callback receives an object with one value from each array
type UrlPropsToCallbackParams<T extends Record<string, readonly string[]>> = {
  [K in keyof T]: T[K][number];
};

interface DynamicIframeSwitcherProps<T extends Record<string, readonly string[]>> extends BaseIframeSwitcherProps {
  urlProps: T;
  exampleUrl: (props: UrlPropsToCallbackParams<T>) => string;
  codeUrl: (props: UrlPropsToCallbackParams<T>) => string;
}

type IframeSwitcherProps<T extends Record<string, readonly string[]> = Record<string, readonly string[]>> =
  | StaticIframeSwitcherProps
  | DynamicIframeSwitcherProps<T>;

// Type guard to check if props are dynamic
function isDynamicProps<T extends Record<string, readonly string[]>>(
  props: IframeSwitcherProps<T>
): props is DynamicIframeSwitcherProps<T> {
  return props.urlProps !== undefined;
}

// Helper to capitalize first letter for display
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// Inner component that renders the Demo/Code tabs
function IframeTabs({
  id,
  exampleUrl,
  codeUrl,
  height,
  exampleLabel,
  codeLabel,
}: {
  id?: string;
  exampleUrl: string;
  codeUrl: string;
  height: string;
  exampleLabel: string;
  codeLabel: string;
}) {
  return (
    <Tabs defaultValue={exampleLabel} id={id}>
      <TabsList>
        <TabsTrigger value={exampleLabel}>
          <Monitor className="w-4 h-4" />
          {exampleLabel}
        </TabsTrigger>
        <TabsTrigger value={codeLabel}>
          <Code className="w-4 h-4" />
          {codeLabel}
        </TabsTrigger>
      </TabsList>
      <TabsContent className="p-0" value={exampleLabel}>
        <iframe
          src={exampleUrl}
          className="w-full rounded-lg"
          style={{ height }}
          title="Interactive Example"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
        />
      </TabsContent>
      <TabsContent className="p-0" value={codeLabel}>
        <iframe
          src={codeUrl}
          className="w-full rounded-lg"
          style={{ height }}
          title="Code View"
          sandbox="allow-scripts allow-same-origin"
        />
      </TabsContent>
    </Tabs>
  );
}

export function IframeSwitcher<T extends Record<string, readonly string[]>>(
  props: IframeSwitcherProps<T>
) {
  const {
    id,
    height = "600px",
    exampleLabel = "Example",
    codeLabel = "Code",
  } = props;

  if (isDynamicProps(props)) {
    const { urlProps, exampleUrl, codeUrl } = props;

    // Get the first (and typically only) key from urlProps
    const propKeys = Object.keys(urlProps) as Array<keyof T>;
    const primaryKey = propKeys[0];

    if (!primaryKey) {
      return null;
    }

    const values = urlProps[primaryKey];
    const items = values.map((v) => capitalize(String(v)));
    const defaultValue = items[0];

    if (!defaultValue) {
      return null;
    }

    return (
      <Tabs groupId={`iframe-switcher-${String(primaryKey)}`} items={items} defaultValue={defaultValue}>
        {values.map((value, index) => {
          const tabValue = items[index];
          if (!tabValue) return null;

          // Build the props object for the callbacks
          const callbackProps = { [primaryKey]: value } as UrlPropsToCallbackParams<T>;
          const resolvedExampleUrl = exampleUrl(callbackProps);
          const resolvedCodeUrl = codeUrl(callbackProps);

          return (
            <TabsContent key={value} value={tabValue} className="p-0">
              <IframeTabs
                id={id ? `${id}-${value}` : undefined}
                exampleUrl={resolvedExampleUrl}
                codeUrl={resolvedCodeUrl}
                height={height}
                exampleLabel={exampleLabel}
                codeLabel={codeLabel}
              />
            </TabsContent>
          );
        })}
      </Tabs>
    );
  }

  // Static mode - render directly without wrapper
  return (
    <IframeTabs
      id={id}
      exampleUrl={props.exampleUrl}
      codeUrl={props.codeUrl}
      height={height}
      exampleLabel={exampleLabel}
      codeLabel={codeLabel}
    />
  );
}
