import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[ErrorBoundary caught an error]:", error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-[400px] flex items-center justify-center p-6 bg-gradient-to-b from-emerald-50/50 to-white">
          <div className="max-w-md w-full bg-white rounded-2xl border border-emerald-100 shadow-xl shadow-emerald-900/5 p-8 text-center">
            <div className="w-16 h-16 rounded-2xl bg-amber-50 border border-amber-200/60 flex items-center justify-center mx-auto mb-5 text-amber-600">
              <AlertTriangle className="w-8 h-8" />
            </div>

            <h3 className="text-xl font-bold text-[#17332c] mb-2 font-serif">
              Kendala Tampilan Terdeteksi
            </h3>
            <p className="text-sm text-[#5e7a70] mb-6 leading-relaxed">
              Komponen aplikasi mengalami hambatan rendering. Data saldo dan transaksi Anda di blockchain tetap aman.
            </p>

            {this.state.error && (
              <div className="mb-6 p-3 bg-gray-50 rounded-xl border border-gray-100 text-left">
                <p className="text-xs font-mono text-gray-600 break-all line-clamp-3">
                  {this.state.error.message || String(this.state.error)}
                </p>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button
                type="button"
                onClick={this.handleReset}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#1b765e] hover:bg-[#143f34] text-white font-medium text-sm transition-all shadow-sm cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                Coba Muat Ulang
              </button>
              <button
                type="button"
                onClick={() => (window.location.href = "/")}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-[#17332c] font-medium text-sm transition-all cursor-pointer"
              >
                <Home className="w-4 h-4" />
                Beranda
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
