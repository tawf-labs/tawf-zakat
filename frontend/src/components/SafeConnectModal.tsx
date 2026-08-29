import { useState, useEffect } from "react";
import { useConnect, useAccount } from "wagmi";
import { Card } from "./ui/Card";
import { Button } from "./ui/Button";
import { Badge } from "./ui/Badge";
import { Copy, Check, ExternalLink, X, Shield, RefreshCw } from "lucide-react";

interface SafeConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SafeConnectModal({ isOpen, onClose }: SafeConnectModalProps) {
  const { connectors, connect, isPending } = useConnect();
  const { isConnected, address } = useAccount();

  const [uri, setUri] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isConnected) {
      onClose();
    }
  }, [isConnected, onClose]);

  const startWalletConnect = async () => {
    setErrorMsg(null);
    setUri(null);
    setCopied(false);

    try {
      const wcConnector = connectors.find((c) => c.id === "walletConnect");
      if (!wcConnector) {
        setErrorMsg("WalletConnect connector tidak ditemukan.");
        return;
      }

      // 1. Listen to display_uri from provider
      const provider: any = await wcConnector.getProvider();
      if (provider && provider.on) {
        provider.once("display_uri", (rawUri: string) => {
          setUri(rawUri);
        });
      }

      // 2. Trigger connection
      connect(
        { connector: wcConnector },
        {
          onError: (err) => {
            console.warn("WalletConnect connection error:", err);
            // Even if user cancels or timeouts, display uri if available
          },
        }
      );
    } catch (err: any) {
      console.error("Failed to initialize Safe WalletConnect:", err);
      setErrorMsg(err.message || "Gagal menghubungkan WalletConnect");
    }
  };

  useEffect(() => {
    if (isOpen && !uri && !isConnected) {
      startWalletConnect();
    }
  }, [isOpen]);

  const handleCopy = () => {
    if (!uri) return;
    navigator.clipboard.writeText(uri);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <Card elevated className="max-w-md w-full bg-white p-6 space-y-4 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[#0F3D30]/10">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-[#0F3D30] text-[#C5A869] flex items-center justify-center font-bold">
              <Shield className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-serif font-bold text-base text-[#0F3D30]">
                Koneksi Safe Wallet (DPS)
              </h3>
              <p className="text-[11px] text-[#555555]">Copy URI Browser-ke-Browser</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-stone-400 hover:text-stone-700 cursor-pointer p-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Instructions */}
        <div className="text-xs text-stone-700 space-y-2 bg-[#F9F6F0] p-3.5 rounded-xl border border-[#0F3D30]/10">
          <span className="font-bold text-[#0F3D30] block">
            Langkah Menghubungkan ke Safe di Laptop:
          </span>
          <ol className="list-decimal list-inside space-y-1 text-[11px] text-stone-600 leading-relaxed">
            <li>Klik tombol <strong>"Salin Kode Koneksi"</strong> di bawah ini.</li>
            <li>Buka tab Safe Wallet Anda di browser.</li>
            <li>Klik icon <strong>WalletConnect</strong> di Safe dan paste kode tersebut.</li>
          </ol>
        </div>

        {/* URI Box & Copy Button */}
        <div className="space-y-2">
          <label className="block text-[10px] font-bold uppercase tracking-wider text-stone-500">
            Kode Sesi WalletConnect (wc:...):
          </label>

          {uri ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={uri}
                onClick={handleCopy}
                className="w-full bg-[#F9F6F0] border border-[#0F3D30]/20 rounded-xl px-3 py-2 text-xs font-mono text-stone-800 focus:outline-none select-all truncate"
              />
              <Button
                onClick={handleCopy}
                size="sm"
                className={`shrink-0 ${
                  copied
                    ? "bg-emerald-700 hover:bg-emerald-800"
                    : "bg-[#0F3D30] hover:bg-[#1A5242]"
                } text-white font-semibold flex items-center gap-1.5`}
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5" /> Tersalin!
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" /> Salin
                  </>
                )}
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2 p-4 bg-stone-50 rounded-xl border border-stone-200 text-xs text-stone-500">
              <RefreshCw className="w-4 h-4 animate-spin text-[#0F3D30]" />
              <span>Menyiapkan kode sesi WalletConnect...</span>
            </div>
          )}

          {errorMsg && (
            <p className="text-[11px] text-red-600 font-medium">{errorMsg}</p>
          )}
        </div>

        {/* Action Link to Safe */}
        <div className="pt-2 flex flex-col gap-2">
          <a
            href="https://app.safe.global/home?safe=sep:0xb4E4253e2aFfdC0710Cb9394b8C4E935F11B00f1"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-1.5 w-full py-2.5 rounded-full bg-emerald-800 text-white text-xs font-semibold hover:bg-emerald-900 transition-colors cursor-pointer shadow-xs"
          >
            Buka Safe Dashboard Sepolia <ExternalLink className="w-3.5 h-3.5" />
          </a>

          <Button
            variant="outline"
            size="sm"
            onClick={startWalletConnect}
            className="w-full text-xs text-stone-600 border-stone-300"
          >
            <RefreshCw className="w-3 h-3 mr-1" /> Buat Ulang Kode Sesi
          </Button>
        </div>
      </Card>
    </div>
  );
}
