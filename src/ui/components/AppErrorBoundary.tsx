import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Last-resort recovery for a shipped build. A failed lazy chunk, WebGL initialization
 * problem, or unexpected UI exception must never leave a paying player on a blank page.
 * Flight state is local-first and is saved after every profile mutation, so reloading is
 * the least surprising recovery action.
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[app] unrecoverable render error', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="fatal-recovery" role="alert" aria-live="assertive">
        <p className="fatal-recovery-kicker">PROJECT FLIGHT</p>
        <h1>No pudimos cargar este vuelo</h1>
        <p>Tu progreso guardado permanece intacto. Recarga para volver al hangar.</p>
        <button type="button" onClick={() => window.location.reload()}>
          RECARGAR JUEGO
        </button>
      </main>
    );
  }
}
