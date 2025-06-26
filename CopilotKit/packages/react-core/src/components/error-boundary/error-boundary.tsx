import React, { useEffect } from "react";
import { Severity, CopilotKitError, ErrorVisibility } from "@copilotkit/shared";
import { StatusChecker } from "../../lib/status-checker";
import { renderCopilotKitUsage, UsageBanner } from "../usage-banner";
import { useErrorToast } from "./error-utils";

const statusChecker = new StatusChecker();

interface Props {
  children: React.ReactNode;
  publicApiKey?: string;
  showUsageBanner?: boolean;
}

interface State {
  hasError: boolean;
  error?: CopilotKitError;
  status?: {
    severity: Severity;
    message: string;
  };
}

export class CopilotErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
    };
  }

  static getDerivedStateFromError(error: CopilotKitError): State {
    return { hasError: true, error };
  }

  componentDidMount() {
    if (this.props.publicApiKey) {
      statusChecker.start(this.props.publicApiKey, (newStatus) => {
        this.setState((prevState) => {
          if (newStatus?.severity !== prevState.status?.severity) {
            return { status: newStatus ?? undefined };
          }
          return null;
        });
      });
    }
  }

  componentWillUnmount() {
    statusChecker.stop();
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("CopilotKit Error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.state.error instanceof CopilotKitError) {
        // Check if error should be shown as banner based on visibility
        if (this.state.error.visibility === ErrorVisibility.BANNER) {
          return (
            <ErrorToast error={this.state.error}>
              {renderCopilotKitUsage(this.state.error, () =>
                this.setState({ hasError: false, error: undefined }),
              )}
            </ErrorToast>
          );
        }

        return (
          <>
            {this.props.children}
            {this.props.showUsageBanner && (
              <UsageBanner
                severity={this.state.status?.severity}
                message={this.state.status?.message}
              />
            )}
          </>
        );
      }
      throw this.state.error;
    }

    return this.props.children;
  }
}

export function ErrorToast({ error, children }: { error?: Error; children: React.ReactNode }) {
  const addErrorToast = useErrorToast();

  useEffect(() => {
    if (error) {
      addErrorToast([error]);
    }
  }, [error, addErrorToast]);

  if (!error) throw error;
  return children;
}
