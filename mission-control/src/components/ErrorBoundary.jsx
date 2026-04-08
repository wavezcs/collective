import React from 'react'

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] caught:', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-screen items-center justify-center bg-borg-bg p-8">
          <div className="max-w-xl w-full border border-red-800 rounded bg-borg-surface p-6 space-y-3">
            <div className="text-red-400 font-semibold text-sm">Render Error</div>
            <pre className="text-xs text-borg-muted whitespace-pre-wrap break-all">
              {this.state.error.message}
            </pre>
            <pre className="text-xs text-borg-dim whitespace-pre-wrap break-all opacity-60">
              {this.state.error.stack?.split('\n').slice(0, 6).join('\n')}
            </pre>
            <button
              onClick={() => this.setState({ error: null })}
              className="text-xs text-borg-green border border-borg-border px-3 py-1 rounded hover:border-borg-green/50"
            >
              Dismiss
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
