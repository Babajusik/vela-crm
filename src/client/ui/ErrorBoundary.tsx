import { Component, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error('Vela UI error', error); }
  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto mt-16 max-w-md rounded-2xl border border-line bg-surface p-6 text-center">
        <AlertTriangle className="mx-auto size-10 text-warning" />
        <p className="mt-3 text-lg font-bold">На этой странице что-то пошло не так</p>
        <p className="mt-1 text-sm text-muted">{this.state.error.message}</p>
        <button type="button" className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-fg" onClick={() => this.setState({ error: null })}>Попробовать снова</button>
      </div>
    );
  }
}
