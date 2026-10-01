import { Component } from 'react';

import { ErrorState } from './States.jsx';

/**
 * Catches a crash while rendering a page and shows a way out, instead of a blank screen. No
 * technical details are shown to the visitor.
 */
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[Grand LMS] A page crashed:', error, info?.componentStack);
  }

  componentDidUpdate(previous) {
    // Navigating elsewhere clears the error.
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <ErrorState
        title="This page ran into a problem"
        error={{ message: 'Something unexpected happened. Reloading usually fixes it.' }}
        onRetry={() => window.location.reload()}
      />
    );
  }
}
