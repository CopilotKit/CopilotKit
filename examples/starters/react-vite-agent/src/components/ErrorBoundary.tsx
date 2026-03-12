import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  declare context: unknown
  declare setState: Component<ErrorBoundaryProps, ErrorBoundaryState>['setState']
  declare forceUpdate: Component<ErrorBoundaryProps, ErrorBoundaryState>['forceUpdate']
  declare props: Readonly<ErrorBoundaryProps>
  declare state: Readonly<ErrorBoundaryState>
  declare refs: Record<string, never>

  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Error caught by boundary:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
          <h1>Something went wrong</h1>
          <p style={{ color: 'red' }}>{this.state.error?.message}</p>
          <button onClick={() => this.setState({ hasError: false, error: null })}>
            Try again
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
