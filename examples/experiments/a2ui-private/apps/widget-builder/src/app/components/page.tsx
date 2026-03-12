'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { COMPONENTS_DATA, ComponentDoc } from '@/lib/components-data';
import { A2UIViewer } from '@copilotkitnext/a2ui-renderer';

function ComponentSidebar({
  selectedComponent,
  onSelect,
}: {
  selectedComponent: string;
  onSelect: (name: string) => void;
}) {
  return (
    <nav className="w-48 shrink-0 border-r border-border overflow-auto">
      <div className="p-4">
        {COMPONENTS_DATA.map((category) => (
          <div key={category.name} className="mb-4">
            <div className="text-sm text-muted-foreground mb-2">{category.name}</div>
            <div className="flex flex-col gap-0.5">
              {category.components.map((component) => (
                <button
                  key={component.name}
                  onClick={() => onSelect(component.name)}
                  className={cn(
                    'text-left px-2 py-1.5 text-sm rounded-md transition-colors',
                    selectedComponent === component.name
                      ? 'font-medium text-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  )}
                >
                  {component.name}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </nav>
  );
}

function UsageBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative rounded-lg border border-border bg-white p-4 font-mono text-sm overflow-auto">
      <pre className="text-green-600 whitespace-pre">{code}</pre>
      <button
        onClick={handleCopy}
        className="absolute right-3 top-3 p-1.5 rounded hover:bg-muted"
        title="Copy to clipboard"
      >
        <svg className="h-4 w-4 text-muted-foreground" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
          <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
        </svg>
      </button>
      {copied && (
        <span className="absolute right-10 top-3.5 text-xs text-muted-foreground">
          Copied!
        </span>
      )}
    </div>
  );
}

function PropValues({ values }: { values: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5 mt-1">
      {values.map((value) => (
        <code
          key={value}
          className="px-1.5 py-0.5 text-xs rounded bg-green-50 text-green-700 border border-green-200"
        >
          "{value}"
        </code>
      ))}
    </div>
  );
}

function PropsTable({ component }: { component: ComponentDoc }) {
  return (
    <div className="border border-border rounded-lg overflow-hidden bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-neutral-50">
            <th className="text-left px-4 py-3 font-medium text-muted-foreground w-40">Name</th>
            <th className="text-left px-4 py-3 font-medium text-muted-foreground">Description</th>
            <th className="text-left px-4 py-3 font-medium text-muted-foreground w-24">Default</th>
          </tr>
        </thead>
        <tbody>
          {component.props.map((prop, index) => (
            <tr key={prop.name} className={index < component.props.length - 1 ? 'border-b border-border' : ''}>
              <td className="px-4 py-3 align-top">
                <code className="px-1.5 py-0.5 text-xs rounded bg-green-50 text-green-700 border border-green-200">
                  {prop.name}
                </code>
              </td>
              <td className="px-4 py-3 align-top">
                <div className="text-foreground">{prop.description}</div>
                {prop.values ? (
                  <PropValues values={prop.values} />
                ) : (
                  <code className="inline-block mt-1 px-1.5 py-0.5 text-xs rounded bg-muted text-muted-foreground">
                    {prop.type}
                  </code>
                )}
              </td>
              <td className="px-4 py-3 align-top">
                {prop.default ? (
                  <code className="px-1.5 py-0.5 text-xs rounded bg-muted text-muted-foreground">
                    {prop.default}
                  </code>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ComponentPreview({ component }: { component: ComponentDoc }) {
  if (!component.preview) {
    return null;
  }

  return (
    <div className="mb-8">
      <h2 className="text-xl font-semibold mb-4">Preview</h2>
      <div className="rounded-lg border border-border bg-neutral-50 p-6">
        <A2UIViewer
          root={component.preview.root}
          components={component.preview.components}
          data={component.preview.data ?? {}}
          onAction={(action) => console.log('Component action:', action)}
        />
      </div>
    </div>
  );
}

function ComponentContent({ component }: { component: ComponentDoc }) {
  return (
    <div className="flex-1 overflow-auto p-8">
      <h1 className="text-3xl font-semibold mb-2">{component.name}</h1>
      <p className="text-muted-foreground mb-6">{component.description}</p>

      <ComponentPreview component={component} />

      <h2 className="text-xl font-semibold mb-4">Usage</h2>
      <UsageBlock code={component.usage} />

      <h2 className="text-xl font-semibold mt-8 mb-4">Props</h2>
      <PropsTable component={component} />
    </div>
  );
}

export default function ComponentsPage() {
  const [selectedComponent, setSelectedComponent] = useState('Row');

  // Find the selected component
  const component = COMPONENTS_DATA
    .flatMap((cat) => cat.components)
    .find((c) => c.name === selectedComponent);

  return (
    <div className="flex h-full flex-1">
      <ComponentSidebar
        selectedComponent={selectedComponent}
        onSelect={setSelectedComponent}
      />
      {component && <ComponentContent component={component} />}
    </div>
  );
}
