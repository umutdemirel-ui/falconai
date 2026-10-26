import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/global.css';

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[falcon] arayüz hatası', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="app-bg flex h-full w-full flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="font-display text-[20px] font-bold text-white">Bir şeyler ters gitti</p>
          <p className="max-w-md text-[12.5px] leading-relaxed text-white/40">{this.state.error.message}</p>
          <button
            type="button"
            className="btn btn-primary mt-2"
            onClick={() => window.location.reload()}
          >
            Arayüzü yenile
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
