/**
 * Source string of the ErrorBoundary + MountCard module written into the
 * generated aggregator directory at codegen time. Kept as a string constant
 * (not a real TSX file) so the extension host ships exactly one copy, and
 * so codegen can tweak it without touching disk fixtures.
 *
 * MountCard = styled wrapper that reports errors to a global sink the webview
 * reads from. Each user component mounts inside its own MountCard.
 */
export const ERROR_BOUNDARY_SOURCE = `
import * as React from "react";

export interface MountErrorPayload {
  componentName: string;
  filePath: string;
  error: { message: string; stack?: string };
}

declare global {
  interface Window {
    __copilotkit_playground_errors?: MountErrorPayload[];
  }
}

function recordError(payload: MountErrorPayload): void {
  if (!window.__copilotkit_playground_errors) {
    window.__copilotkit_playground_errors = [];
  }
  window.__copilotkit_playground_errors.push(payload);
}

interface BoundaryProps {
  componentName: string;
  filePath: string;
  children: React.ReactNode;
}

interface BoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error): void {
    recordError({
      componentName: this.props.componentName,
      filePath: this.props.filePath,
      error: { message: error.message, stack: error.stack },
    });
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div data-copilotkit-mount-error role="alert">
          <strong>{this.props.componentName} failed to mount</strong>
          <pre>{this.state.error.message}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

export interface MountCardProps {
  componentName: string;
  filePath: string;
  children: React.ReactNode;
}

export function MountCard({ componentName, filePath, children }: MountCardProps): React.ReactElement {
  return (
    <section data-copilotkit-mount-card data-component={componentName}>
      <header>
        <code>{componentName}</code>
      </header>
      <ErrorBoundary componentName={componentName} filePath={filePath}>
        {children}
      </ErrorBoundary>
    </section>
  );
}
`.trimStart();
